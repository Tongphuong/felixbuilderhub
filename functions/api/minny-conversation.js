import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { buildSystemPrompt, parseModelReply, sessionCapsExceeded, nextSession, pickStarterTopic } from './_minny-convo.js';
import { resolveOpenAiApiKey, getOrSynthesize } from './_minny-tts.js';
import { findPhrase } from './_minny-phrases.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Best-effort inline TTS for Free Talking replies (Phase 8a, closing a gap
// in Phase 5's own spec). Never throws -- a TTS failure must never block
// a reply; the client already falls back to speechSynthesis when
// audio_b64 is absent. Independent of, and does not touch, the is_test
// gate below.
async function synthesizeOrNull(env, apiKey, text) {
  if (!apiKey || !env.READ2LEAD_CODES || !text) return null;
  try {
    return await getOrSynthesize(env.READ2LEAD_CODES, text, apiKey);
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
  }

  const accessCode = String(body.access_code || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) return rateLimitedResponse(rl.retryAfter);

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  // ⚠️ Phase‑1 gate — must stay until the full safety surface is built.
  if (codeData.is_test !== true) {
    return json({ ok: false, error: 'not_available', message: 'Chế độ trò chuyện tự do chưa mở cho mã này.' }, 403);
  }

  const apiKey = resolveOpenAiApiKey(env);
  const level = codeData?.progress?.current_level || codeData?.student_profile?.level || 'L1';

  const action = String(body.action || '').trim().toLowerCase();
  if (!action || (action !== 'start' && action !== 'turn')) {
    return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
  }

  if (action === 'start') {
    /* ── daily / global caps ── */
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dailyKey = `convo-daily:${accessCode}:${today}`;
    const globalKey = `convo-global:${today}`;
    const ttlSeconds = 60 * 60 * 48; // 48 hours

    let dailyCount = 0;
    let globalCount = 0;

    try {
      const dRaw = await env.READ2LEAD_CODES.get(dailyKey, { type: 'json' });
      dailyCount = Number.isFinite(dRaw) ? dRaw : 0;
    } catch {
      // best‑effort read
    }
    try {
      const gRaw = await env.READ2LEAD_CODES.get(globalKey, { type: 'json' });
      globalCount = Number.isFinite(gRaw) ? gRaw : 0;
    } catch {
      // best‑effort
    }

    if (dailyCount >= 3) {
      return json({ ok: false, error: 'daily_cap', message: 'Hôm nay con đã trò chuyện đủ 3 lần với Minny rồi, hẹn con ngày mai nhé!' }, 429);
    }
    if (globalCount >= 60) {
      return json({ ok: false, error: 'global_cap', message: 'Minny đang nghỉ một chút hôm nay — con luyện bài tập nhé!' }, 429);
    }

    /* ── create session ── */
    const sessionId = crypto.randomUUID();
    const starterTopic = pickStarterTopic(level, Math.floor(Math.random() * 2));
    const session = {
      code: accessCode,
      level,
      started_at: Date.now(),
      turns: 0,
      strikes: 0,
      history: [],
      starter_topic: starterTopic,
    };

    await env.READ2LEAD_CODES.put(`convo-session:${sessionId}`, JSON.stringify(session), {
      expirationTtl: 600,
    });

    /* increment counters (best‑effort) */
    try {
      await env.READ2LEAD_CODES.put(dailyKey, JSON.stringify(dailyCount + 1), { expirationTtl: ttlSeconds });
    } catch {
      // ignore
    }
    try {
      await env.READ2LEAD_CODES.put(globalKey, JSON.stringify(globalCount + 1), { expirationTtl: ttlSeconds });
    } catch {
      // ignore
    }

    const greeting = findPhrase('greeting');
    const greetingAudio = await synthesizeOrNull(env, apiKey, greeting.text_en);
    return json({
      ok: true,
      session_id: sessionId,
      level,
      greeting: {
        text_en: greeting.text_en,
        subtitle_vi: greeting.subtitle_vi,
        ...(greetingAudio ? { audio_b64: greetingAudio.audio_b64, content_type: greetingAudio.content_type } : {}),
      },
      turns_left: 12,
      seconds_left: 300,
    });
  }

  /* ─────────────── action = 'turn' ─────────────── */
  const sessionId = String(body.session_id || '').trim();
  if (!sessionId) {
    return json({ ok: false, error: 'session_missing', message: 'Thiếu phiên trò chuyện.' }, 400);
  }

  const transcript = String(body.transcript || '').trim();
  if (!transcript) {
    return json({ ok: false, error: 'transcript_missing', message: 'Minny chưa nghe được con nói gì.' }, 400);
  }

  const sessionKey = `convo-session:${sessionId}`;
  let session;
  try {
    session = await env.READ2LEAD_CODES.get(sessionKey, { type: 'json' });
  } catch {
    return json({ ok: true, ended: true, message_vi: 'Phiên trò chuyện đã kết thúc rồi. Con bắt đầu phiên mới nhé!' });
  }

  if (!session || session.code !== accessCode) {
    return json({ ok: true, ended: true, message_vi: 'Phiên trò chuyện đã kết thúc rồi. Con bắt đầu phiên mới nhé!' });
  }

  const now = Date.now();

  if (sessionCapsExceeded(session, now)) {
    const wrapUp = findPhrase('wrap_up_1');
    try { await env.READ2LEAD_CODES.delete(sessionKey); } catch {}
    const wrapUpAudio = await synthesizeOrNull(env, apiKey, wrapUp.text_en);
    return json({
      ok: true,
      ended: true,
      reply_en: wrapUp.text_en,
      subtitle_vi: wrapUp.subtitle_vi,
      mood: 'celebrate',
      turns_left: 0,
      seconds_left: 0,
      ...(wrapUpAudio ? { audio_b64: wrapUpAudio.audio_b64, content_type: wrapUpAudio.content_type } : {}),
    });
  }

  // ── try LLM ──
  const systemPrompt = buildSystemPrompt(session.level, session.starter_topic);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(session.history) ? session.history.flatMap(h => [
      { role: 'user', content: h.kid_transcript },
      { role: 'assistant', content: JSON.stringify({ reply_en: h.reply_en, mood: h.mood }) },
    ]) : []),
    { role: 'user', content: transcript },
  ];

  let rawReply = null;

  if (apiKey) {
    try {
      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.4-mini',
          messages,
          response_format: { type: 'json_object' },
          max_tokens: 150,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (gptRes.ok) {
        const gptData = await gptRes.json();
        rawReply = gptData?.choices?.[0]?.message?.content;
      }
    } catch {
      // fall through
    }
  }

  if (!rawReply && env.AI) {
    try {
      const aiRes = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages });
      rawReply = typeof aiRes === 'string' ? aiRes : (aiRes?.response || aiRes?.text || null);
    } catch {
      // fall through
    }
  }

  const parsed = rawReply ? parseModelReply(rawReply) : null;

  if (!parsed) {
    // ── canned redirect path ──
    // A technical LLM/parse failure just gets a canned redirect line and still
    // counts against the normal 12-turn/5-min cap below -- it does NOT end the
    // session early. Ending early on repeated failures is a guardrail-flag
    // concept (2 *safety* flags -> early wrap-up, per the spec's Phase 6),
    // not a provider-outage concept: a kid mid-conversation during an LLM
    // hiccup should still get their full session, just with canned lines
    // until the provider recovers or the normal caps are reached.
    session.strikes = (session.strikes || 0) + 1;

    const redirectId = `redirect_${((session.turns || 0) % 6) + 1}`;
    const redirect = findPhrase(redirectId);
    const turnRecord = { kid_transcript: transcript, reply_en: redirect.text_en, mood: 'idle' };
    const newSession = nextSession(session, turnRecord);

    try {
      await env.READ2LEAD_CODES.put(sessionKey, JSON.stringify(newSession), { expirationTtl: 600 });
    } catch {
      // best‑effort
    }

    const turnsLeft = Math.max(0, 12 - newSession.turns);
    const secondsLeft = Math.max(0, 300 - Math.floor((now - newSession.started_at) / 1000));

    const redirectAudio = await synthesizeOrNull(env, apiKey, redirect.text_en);
    return json({
      ok: true,
      reply_en: redirect.text_en,
      mood: 'idle',
      turns_left: turnsLeft,
      seconds_left: secondsLeft,
      ...(redirectAudio ? { audio_b64: redirectAudio.audio_b64, content_type: redirectAudio.content_type } : {}),
    });
  }

  // ── LLM success path ──
  const updatedSession = nextSession(session, {
    kid_transcript: transcript,
    reply_en: parsed.reply_en,
    mood: parsed.mood,
  });

  try {
    await env.READ2LEAD_CODES.put(sessionKey, JSON.stringify(updatedSession), { expirationTtl: 600 });
  } catch {
    // best‑effort
  }

  const turnsLeft = Math.max(0, 12 - updatedSession.turns);
  const secondsLeft = Math.max(0, 300 - Math.floor((now - updatedSession.started_at) / 1000));

  const replyAudio = await synthesizeOrNull(env, apiKey, parsed.reply_en);
  return json({
    ok: true,
    reply_en: parsed.reply_en,
    mood: parsed.mood,
    turns_left: turnsLeft,
    seconds_left: secondsLeft,
    ...(replyAudio ? { audio_b64: replyAudio.audio_b64, content_type: replyAudio.content_type } : {}),
  });
}
