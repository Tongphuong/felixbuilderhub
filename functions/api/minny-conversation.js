import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import {
  buildSystemPrompt, parseModelReply, coerceReply, sessionCapsExceeded, nextSession, pickStarterTopic,
  gateReplyForLevel, isBeginnerLevel, TOPIC_SEEDS, DEBATE_TOPICS, GAMES,
} from './_minny-convo.js';
import { resolveOpenAiApiKey, getOrSynthesize } from './_minny-tts.js';
import { findPhrase, fillPhrase } from './_minny-phrases.js';
import { screenTranscript, validateReplyShape, detectCharacterBreak, scanBannedTopics, screenWithLlamaGuard } from './_minny-guardrails.js';
// Step C (2026-07-10): merged voice turn — the client now uploads audio straight
// to this endpoint (one round-trip) instead of calling read2lead-speaking-check
// for STT first. Reuse that route's proven Whisper orchestrator, don't re-roll it.
// V1.1 (2026-07-11): also reuse wordSimilarity for the repair ladder's fuzzy
// expected-answer match (import allowed, modification not -- see
// _minny-repair.js's header note).
import { transcribeAudio, wordSimilarity } from './read2lead-speaking-check.js';
import { isVietnamese, isLowContent, matchesExpected, nextRepairStep } from './_minny-repair.js';

// Conversation brain: Llama-3.3-70B via OpenRouter, routed to the fastest
// provider (Groq/Cerebras) — see CONVO_PROVIDER below. Swapped 2026-07-10 from
// deepseek-v4-pro: a live test measured ~24s/turn and DeepSeek (esp. pro) was
// the bottleneck. Groq/Cerebras answer this in ~0.5-1s and Llama-3.3-70B is
// warm enough for kids. Bonus: our Workers-AI fallback is the SAME model, so a
// provider blip degrades to identical wording on slower infra, not a worse model.
const CONVO_MODEL = 'meta-llama/llama-3.3-70b-instruct';
// OpenRouter provider preference: pick the highest-throughput host that still
// supports our JSON response_format. Keeps us on Groq/Cerebras/SambaNova-class
// infra without pinning a single provider (allow_fallbacks stays on by default).
const CONVO_PROVIDER = { sort: 'throughput', require_parameters: true };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// V1.1 (2026-07-11) — Whisper prompt bias (spec V1-D2): L1-L2 biases toward
// the last turn's expected variants (a garbled "i like dogs" is more likely
// to transcribe correctly when Whisper already expects those words); L3+
// biases toward the chosen topic's seed word list. No topic/no expected ->
// no prompt (undefined), which is byte-identical to today's behavior.
const WHISPER_PROMPT_MAX_CHARS = 200;

function buildWhisperPromptBias(session) {
  if (isBeginnerLevel(session.level)) {
    const expected = Array.isArray(session.last_expected) ? session.last_expected : [];
    if (!expected.length) return undefined;
    return expected.join(', ').slice(0, WHISPER_PROMPT_MAX_CHARS);
  }
  const topicSeeds = session.topic && TOPIC_SEEDS[session.topic] ? TOPIC_SEEDS[session.topic].seeds : null;
  if (!topicSeeds) return undefined;
  return topicSeeds.join(', ').slice(0, WHISPER_PROMPT_MAX_CHARS);
}

// Best-effort inline TTS for Free Talking replies (Phase 8a, closing a gap
// in Phase 5's own spec). Never throws -- a TTS failure must never block
// a reply; the client already falls back to speechSynthesis when
// audio_b64 is absent. Runs on the Workers AI binding (no API key); the
// apiKey argument is kept for the binding-less last-resort path only.
async function synthesizeOrNull(env, apiKey, text) {
  if (!env.READ2LEAD_CODES || !text) return null;
  if (!env.AI && !apiKey) return null;
  try {
    return await getOrSynthesize(env, text);
  } catch {
    return null;
  }
}

// Phase 6: append a flagged turn to the debug ring Phuong reviews (mirrors
// the existing debug:speaking-errors ring pattern in
// read2lead-speaking-check.js -- same shape, same best-effort semantics).
async function recordConvoFlag(env, record) {
  try {
    if (!env.READ2LEAD_CODES) return;
    const KEY = 'debug:convo-flags';
    const existing = await env.READ2LEAD_CODES.get(KEY, { type: 'json' });
    const ring = Array.isArray(existing) ? existing : [];
    ring.unshift(record);
    await env.READ2LEAD_CODES.put(KEY, JSON.stringify(ring.slice(0, 50)), { expirationTtl: 604800 });
  } catch {
    /* diagnostics are best-effort; never break the response */
  }
}

// Per-turn latency ring (2026-07-10) — same best-effort pattern as the flag
// ring above, read via GET /api/debug-convo-flags (returns both rings). Lets us
// see the real llm/guard/tts split from a live session without dev-tools.
async function recordConvoTiming(env, record) {
  try {
    if (!env.READ2LEAD_CODES) return;
    const KEY = 'debug:convo-timing';
    const existing = await env.READ2LEAD_CODES.get(KEY, { type: 'json' });
    const ring = Array.isArray(existing) ? existing : [];
    ring.unshift(record);
    await env.READ2LEAD_CODES.put(KEY, JSON.stringify(ring.slice(0, 50)), { expirationTtl: 604800 });
  } catch {
    /* diagnostics are best-effort; never break the response */
  }
}

// Phase 6: a kid transcript or model reply was flagged by the guardrail
// stack. Never surface the flagged content -- always a canned redirect.
// 2 flags in one session -> early warm wrap-up, session marked flagged:true.
async function handleGuardrailFlag(env, apiKey, session, sessionKey, accessCode, kidTranscript, matchedRule, direction, now) {
  const newFlags = (session.flags || 0) + 1;
  const redirectId = `redirect_${((session.turns || 0) % 6) + 1}`;
  const redirect = findPhrase(redirectId);
  const turnRecord = { kid_transcript: kidTranscript, reply_en: redirect.text_en, mood: 'idle' };
  // Fix (Elon/Buffet review, 2026-07-11): the canned redirect ABANDONS
  // whatever question was on the table (flagged transcript or flagged model
  // reply) and poses a brand-new one of its own. The stale
  // last_options/last_expected/last_hint from the abandoned question must
  // not survive, or the kid's genuine answer to the redirect's NEW question
  // gets wrongly compared against the old chips and routed into the repair
  // ladder. Same fix as repair_move_on (MUST-FIX 2, first review round).
  const updatedSession = {
    ...nextSession(session, turnRecord),
    flags: newFlags,
    last_options: null,
    last_expected: null,
    last_hint: null,
    repair: { step: 0, active: false },
  };

  await recordConvoFlag(env, {
    code: accessCode,
    at: now,
    direction,
    matched_rule: matchedRule || 'unknown',
  });

  const turnsLeft = Math.max(0, 12 - updatedSession.turns);
  const secondsLeft = Math.max(0, 300 - Math.floor((now - updatedSession.started_at) / 1000));

  if (newFlags >= 2) {
    try { await env.READ2LEAD_CODES.delete(sessionKey); } catch {}
    const wrapUp = findPhrase('wrap_up_1');
    const wrapUpAudio = await synthesizeOrNull(env, apiKey, wrapUp.text_en);
    return json({
      ok: true,
      ended: true,
      flagged: true,
      transcript: kidTranscript,
      reply_en: wrapUp.text_en,
      subtitle_vi: wrapUp.subtitle_vi,
      mood: 'celebrate',
      turns_left: 0,
      seconds_left: 0,
      ...(wrapUpAudio ? { audio_b64: wrapUpAudio.audio_b64, content_type: wrapUpAudio.content_type } : {}),
    });
  }

  try {
    await env.READ2LEAD_CODES.put(sessionKey, JSON.stringify(updatedSession), { expirationTtl: 600 });
  } catch {
    // best-effort
  }

  const redirectAudio = await synthesizeOrNull(env, apiKey, redirect.text_en);
  return json({
    ok: true,
    transcript: kidTranscript,
    reply_en: redirect.text_en,
    mood: 'idle',
    turns_left: turnsLeft,
    seconds_left: secondsLeft,
    ...(redirectAudio ? { audio_b64: redirectAudio.audio_b64, content_type: redirectAudio.content_type } : {}),
  });
}

// How long a background-synthesized reply audio stays fetchable in KV. The
// client polls for ~8s; 120s covers slow polls and a tap-to-play retry without
// accumulating audio blobs (the TTS cache proper lives under tts:* keys).
const PENDING_AUDIO_TTL_S = 120;

export async function onRequestPost(context) {
  const { request, env } = context;
  // Pages Functions gives us waitUntil to finish work after the response is
  // sent (background TTS below). Plain node tests call this handler without
  // it — fall back to fire-and-forget so the promise still runs to completion.
  const waitUntil = typeof context.waitUntil === 'function'
    ? context.waitUntil.bind(context)
    : (p) => { Promise.resolve(p).catch(() => {}); };

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  // Body is JSON for `start` (and legacy JSON `turn` with a client-supplied
  // transcript), OR multipart/form-data for the merged voice turn (audio upload).
  let body = {};
  let audioBlob = null;
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      body = {
        access_code: form.get('access_code'),
        action: form.get('action'),
        session_id: form.get('session_id'),
        transcript: form.get('transcript'),
      };
      const a = form.get('audio');
      if (a && typeof a.arrayBuffer === 'function') audioBlob = a;
    } catch {
      return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
    }
  } else {
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
    }
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

  // Phase 8b (2026-07-06): is_test gate removed on Phương's explicit order —
  // Free Talk is open to every valid code. All safety caps stay: 3 sessions/
  // day/kid, 5-min + 12-turn session caps, guardrail screening, global cap.

  const apiKey = resolveOpenAiApiKey(env);
  const level = codeData?.progress?.current_level || codeData?.student_profile?.level || 'L1';

  const action = String(body.action || '').trim().toLowerCase();
  if (!action || (action !== 'start' && action !== 'turn' && action !== 'audio')) {
    return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
  }

  if (action === 'audio') {
    // Two-phase turn, phase 2 (2026-07-10): fetch the reply audio that a
    // `turn` response announced with audio_pending. Cheap KV read, owner-
    // checked against the access code that started the session. `ready:false`
    // just means "keep polling"; `failed:true` means stop and use the client
    // fallback (speechSynthesis) — same behavior as a missing audio_b64 today.
    const audioSessionId = String(body.session_id || '').trim();
    const audioTurn = Number(body.turn);
    if (!audioSessionId || !Number.isInteger(audioTurn) || audioTurn < 1 || audioTurn > 20) {
      return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
    }
    let audioRecord = null;
    try {
      audioRecord = await env.READ2LEAD_CODES.get(`convo-audio:${audioSessionId}:${audioTurn}`, { type: 'json' });
    } catch {
      // KV hiccup — report not-ready; the client keeps polling or falls back.
    }
    if (!audioRecord || audioRecord.code !== accessCode) {
      return json({ ok: true, ready: false });
    }
    if (audioRecord.failed || !audioRecord.audio_b64) {
      return json({ ok: true, ready: false, failed: true });
    }
    return json({ ok: true, ready: true, audio_b64: audioRecord.audio_b64, content_type: audioRecord.content_type });
  }

  if (action === 'start') {
    /* ── topic / game validation (V1.1) ── */
    // L1-L2 codes ignore topic/game silently — no validation, no error: the
    // V1.2 UI won't send them at this level, but a stale client must not
    // break (spec: "L1-L2 codes ignore topic/game silently").
    const isBeginnerCode = isBeginnerLevel(level);
    const rawTopic = (body.topic === undefined || body.topic === null || body.topic === '') ? '' : String(body.topic).trim();
    const rawGame = (body.game === undefined || body.game === null || body.game === '') ? '' : String(body.game).trim();
    let topic = null;
    let game = null;
    let debateTopic = null;

    if (!isBeginnerCode) {
      if (rawTopic) {
        if (rawTopic === 'minny_choice') {
          const keys = Object.keys(TOPIC_SEEDS);
          topic = keys[Math.floor(Math.random() * keys.length)];
        } else if (TOPIC_SEEDS[rawTopic]) {
          topic = rawTopic;
        } else {
          return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
        }
      }
      if (rawGame) {
        const isGameLevel = level === 'L4' || level === 'L5';
        if (!isGameLevel || !GAMES.includes(rawGame)) {
          return json({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' }, 400);
        }
        game = rawGame;
        if (game === 'debate') {
          // Server picks the debate topic from the allowlist — never from
          // the client (founder rule: the kid never sets the debate topic).
          debateTopic = DEBATE_TOPICS[Math.floor(Math.random() * DEBATE_TOPICS.length)];
        }
      }
    }

    /* ── daily / global caps ── */
    // Test-code exemption (2026-07-11, Phương-approved): a code whose KV
    // record carries the existing admin-set `is_test: true` flag skips the
    // daily-3 cap AND never increments the daily/global counters, so founder
    // testing can't burn the kids' global kill-switch budget. Server-side
    // record field only — nothing the client sends can set it. Everything
    // else (guardrails, 12-turn/5-min session caps, rate limiting) applies
    // to test codes unchanged: what gets tested is what kids get.
    const isTestCode = codeData?.is_test === true;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dailyKey = `convo-daily:${accessCode}:${today}`;
    const globalKey = `convo-global:${today}`;
    const ttlSeconds = 60 * 60 * 48; // 48 hours

    let dailyCount = 0;
    let globalCount = 0;

    if (!isTestCode) {
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
      flags: 0,
      history: [],
      starter_topic: starterTopic,
      topic,
      game,
      debate_topic: debateTopic,
      // V1.1 repair-ladder bookkeeping: the last turn's kid-visible optional
      // fields (post-gating), and the repair ladder's own step counter.
      last_options: null,
      last_expected: null,
      last_hint: null,
      repair: { step: 0, active: false },
    };

    await env.READ2LEAD_CODES.put(`convo-session:${sessionId}`, JSON.stringify(session), {
      expirationTtl: 600,
    });

    /* increment counters (best‑effort); test codes never touch them */
    if (!isTestCode) {
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

  // Resolve the kid's words: either a client-supplied transcript (legacy JSON
  // path) or, in the merged voice turn, transcribe the uploaded audio here so
  // the whole record→reply round-trip is a single request. STT reuses the
  // read2lead Whisper orchestrator (Workers AI, OpenAI fallback).
  let transcript = String(body.transcript || '').trim();
  let sttMs = 0;
  if (!transcript && audioBlob) {
    if (audioBlob.size > 6 * 1024 * 1024) {
      return json({ ok: false, error: 'audio_too_large', message: 'Đoạn ghi âm quá dài. Con nói ngắn hơn nhé!' }, 413);
    }
    const sttStart = Date.now();
    try {
      transcript = String(await transcribeAudio(audioBlob, { ai: env.AI, openaiApiKey: apiKey, prompt: buildWhisperPromptBias(session) }) || '').trim();
    } catch {
      transcript = '';
    }
    sttMs = Date.now() - sttStart;
  }
  if (!transcript) {
    return json({ ok: false, error: 'transcript_missing', message: 'Minny chưa nghe được con nói gì.' }, 400);
  }

  const now = Date.now();

  // Phase 6 guardrail layer 1: screen the kid's own transcript before it
  // ever reaches the LLM. An unsafe/off-bounds transcript never gets sent
  // to the model at all.
  const transcriptScreen = screenTranscript(transcript);
  if (transcriptScreen.flagged) {
    return handleGuardrailFlag(env, apiKey, session, sessionKey, accessCode, transcript, transcriptScreen.category, 'kid', now);
  }

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

  // V1.1 (2026-07-11) repair ladder + Vietnamese/low-content heuristic (spec
  // V1-D2): evaluated BEFORE any LLM spend, right after the guardrail
  // transcript screen above. Trigger: the last Minny turn carried `expected`
  // (L1-L2 only) AND the child's transcript is low-content or doesn't fuzzy-
  // match any expected variant -- or, at any level, the transcript looks
  // Vietnamese. A repair turn consumes the normal 12-turn/5-min cap (a
  // deliberate default -- the kid is still "in session" -- documented here
  // rather than exempted), but NEVER increments flags/strikes and NEVER
  // calls the LLM; it replies with a pre-written, pre-cached canned phrase.
  const vietnameseTriggered = isVietnamese(transcript);
  const lastExpected = Array.isArray(session.last_expected) ? session.last_expected : [];
  const stallTriggered = isBeginnerLevel(session.level)
    && lastExpected.length > 0
    && (isLowContent(transcript) || !matchesExpected(transcript, lastExpected, wordSimilarity));

  if (vietnameseTriggered || stallTriggered) {
    const step = nextRepairStep(session, session.level, { vietnamese: vietnameseTriggered });
    const phrase = findPhrase(step.phraseId);
    const filled = fillPhrase(phrase, step.vars);
    // Fix (Elon review, 2026-07-11): repair_move_on (repair.active === false)
    // means the ladder is abandoning THIS question entirely ("let's talk
    // about something else fun") -- the stale last_options/last_expected/
    // last_hint must not survive into the next turn, or the kid's next
    // genuine answer gets compared against a question Minny already
    // dropped, restarting the ladder in a loop until the 12-turn cap.
    // Steps 1-2 keep re-serving the SAME chips (today's behavior).
    const ladderReset = !step.repair.active;
    const repairSession = {
      ...nextSession(session, { kid_transcript: transcript, reply_en: filled.text_en, mood: 'idle' }),
      repair: step.repair,
      ...(ladderReset ? { last_options: null, last_expected: null, last_hint: null } : {}),
    };

    try {
      await env.READ2LEAD_CODES.put(sessionKey, JSON.stringify(repairSession), { expirationTtl: 600 });
    } catch {
      // best-effort
    }

    const turnsLeft = Math.max(0, 12 - repairSession.turns);
    const secondsLeft = Math.max(0, 300 - Math.floor((now - repairSession.started_at) / 1000));
    const repairAudio = await synthesizeOrNull(env, apiKey, filled.text_en);
    return json({
      ok: true,
      transcript,
      reply_en: filled.text_en,
      subtitle_vi: filled.subtitle_vi,
      mood: 'idle',
      repair: true,
      // V1.2 packet 1 (2026-07-11): the approved Wave D mock renders each
      // ladder step differently (screen 4 rephrase = normal chips, screen 5
      // choices = oversized tap-to-resolve buttons, screen 6 model = plain
      // chrome, each with its own label) -- the client needs to know which
      // step this is. Derived from the canned phrase id, never free text.
      repair_step: step.phraseId.replace(/^repair_/, ''),
      turns_left: turnsLeft,
      seconds_left: secondsLeft,
      // Same options/expected as the previous turn so the client can
      // re-render the same chips (spec: "response carries the same options
      // as the previous turn so the client can re-render them") -- EXCEPT
      // on the move_on turn, which abandons the question, so re-showing its
      // chips would be wrong UX as well as stale state.
      ...(!ladderReset && Array.isArray(session.last_options) ? { options: session.last_options } : {}),
      ...(!ladderReset && lastExpected.length ? { expected: lastExpected } : {}),
      ...(repairAudio ? { audio_b64: repairAudio.audio_b64, content_type: repairAudio.content_type } : {}),
    });
  }

  // ── try LLM ──
  const systemPrompt = buildSystemPrompt(session.level, session.starter_topic, {
    topic: session.topic || null,
    game: session.game || null,
    debateTopic: session.debate_topic || null,
  });
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(session.history) ? session.history.flatMap(h => [
      { role: 'user', content: h.kid_transcript },
      { role: 'assistant', content: JSON.stringify({ reply_en: h.reply_en, mood: h.mood }) },
    ]) : []),
    { role: 'user', content: transcript },
  ];

  let rawReply = null;

  // Latency instrumentation (2026-07-10): time each brain stage and record
  // which path actually answered, so a real session reveals exactly where the
  // per-turn seconds go (llm vs guard vs tts) rather than us guessing. Written
  // to the debug:convo-timing ring + echoed in the response `timing` field.
  const llmStart = Date.now();
  let llmAttempts = 0;
  let llmSource = 'none';

  // Primary brain swapped from OpenAI (credit retired 2026-07-08) to
  // DeepSeek via OpenRouter — same OpenAI-compatible request shape.
  // apiKey (OpenAI) remains in use below only for the TTS last-resort path.
  // Retry once on a transient failure (rate-limit / timeout / 5xx): a single
  // hiccup on one turn must not cost the child a real reply and drop them to a
  // canned redirect. Rapid or throttled turns can make OpenRouter blip — the
  // retry absorbs that.
  const convoKey = env.OPENROUTER_API_KEY || null;
  if (convoKey) {
    for (let attempt = 0; attempt < 2 && !rawReply; attempt++) {
      llmAttempts++;
      try {
        const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${convoKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: CONVO_MODEL,
            provider: CONVO_PROVIDER,
            messages,
            response_format: { type: 'json_object' },
            max_tokens: 150,
            temperature: 0.8,
          }),
          // 4s: a Groq/Cerebras-class host answers a 150-token reply in ~0.5-1s.
          // Anything past 4s means the fast provider is degraded -- fail fast to
          // the retry / Workers-AI fallback rather than leave the child waiting.
          signal: AbortSignal.timeout(4000),
        });
        if (llmRes.ok) {
          const llmData = await llmRes.json();
          rawReply = llmData?.choices?.[0]?.message?.content || null;
          if (rawReply) llmSource = 'openrouter';
        }
      } catch {
        // transient — try again, then the fallback
      }
    }
  }

  // Fallback brain: Workers AI Llama 3.3. Ask for JSON first (so parseModelReply
  // succeeds), and retry as a plain call if the model rejects response_format —
  // the old plain-only call returned free-form prose that never parsed, which is
  // why fallback turns became canned redirects.
  if (!rawReply && env.AI) {
    for (const input of [{ messages, max_tokens: 150, response_format: { type: 'json_object' } }, { messages, max_tokens: 150 }]) {
      if (rawReply) break;
      llmAttempts++;
      try {
        const aiRes = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', input);
        rawReply = typeof aiRes === 'string' ? aiRes : (aiRes?.response || aiRes?.text || null);
        if (rawReply) llmSource = 'llama_fallback';
      } catch {
        // try the plain shape / fall through
      }
    }
  }

  const llmMs = Date.now() - llmStart;

  // Prefer strict JSON; if the model wrapped it in prose/fences or bent the
  // format, salvage a usable reply rather than dropping to a canned redirect.
  // The salvaged reply still passes through every guardrail below.
  const parsed = rawReply ? (parseModelReply(rawReply) || coerceReply(rawReply)) : null;

  if (parsed) {
    // V1.1: level-gate the optional fields (options/expected only at L1-L2,
    // hint only at L3+) BEFORE guardrail screening, so the guardrails scan
    // exactly the surface the kid will actually see (single source of truth:
    // gateReplyForLevel).
    const gated = gateReplyForLevel(parsed, session.level);

    // Phase 6 guardrail layers 2-4. Deterministic shape/character/topic checks
    // run first (cheap, sync). Only if they pass do we spend on the Llama Guard
    // ML backstop -- and we run that guard call CONCURRENTLY with TTS synthesis
    // (each up to ~6-8s) instead of one after the other. A guard flag is rare,
    // and the deterministic word-list gate has already cleared the reply before
    // any audio is made, so on the rare ML flag we simply drop the synthesized
    // audio and fall to the redirect path -- safety is unchanged, latency drops
    // by ~min(guard, TTS) on every good turn.
    //
    // V1.1: the WHOLE kid-visible surface is screened, not just reply_en --
    // every options[] string, every expected[] string, and the hint, too (a
    // banned word could hide in any of them). expected[] is screened for two
    // reasons: it rides in the turn response JSON (client-visible surface
    // like options/hint), AND a repair/VN-nudge turn later SPEAKS
    // last_expected[0] via TTS (repair_model/vn_nudge fill {model} from it)
    // without ever re-screening it at that point -- so an unscreened banned
    // word in expected[0] would reach the kid's ears on a later turn even if
    // this turn's own reply_en/options were clean. The length check
    // (validateReplyShape's over_long reason) stays on reply_en alone;
    // options (<=30 chars), expected (<=40 chars), and hint (<=80 chars) are
    // already far under that cap by construction, so scanning them
    // individually only ever exercises the URL/email/phone/empty checks.
    const surfaceExtras = [
      ...(Array.isArray(gated.options) ? gated.options : []),
      ...(Array.isArray(gated.expected) ? gated.expected : []),
      ...(gated.hint ? [gated.hint] : []),
    ];
    const shapeCheck = validateReplyShape(gated.reply_en);
    const extraShapeFlag = surfaceExtras.map((extra) => validateReplyShape(extra)).find((r) => r.flagged);
    const surfaceText = [gated.reply_en, ...surfaceExtras].join('\n');
    const characterCheck = detectCharacterBreak(surfaceText);
    const topicCheck = scanBannedTopics(surfaceText);
    const deterministicFlag = shapeCheck.flagged || Boolean(extraShapeFlag) || characterCheck.flagged || topicCheck.flagged;

    if (deterministicFlag) {
      const category = shapeCheck.reason || extraShapeFlag?.reason || characterCheck.marker || topicCheck.category;
      return handleGuardrailFlag(env, apiKey, session, sessionKey, accessCode, transcript, category, 'model', now);
    }

    // Deterministic gate passed -> safe to synthesize while the ML backstop
    // screens the same words in parallel. Two-phase since 2026-07-10: only the
    // guard is AWAITED — it alone gates showing the reply. TTS keeps running;
    // if it happens to finish first (KV cache hit, short line) the audio rides
    // inline as before, otherwise the response goes out text-first and the
    // audio lands in KV via waitUntil for the client's action:'audio' fetch.
    // Live measurement showed Aura-2 at 3.2-3.5s on cache misses — awaiting it
    // was the single biggest share of the kid's wait.
    const parStart = Date.now();
    let guardMs = 0;
    let ttsMs = null;
    const ttsPromise = (async () => { const r = await synthesizeOrNull(env, apiKey, gated.reply_en); ttsMs = Date.now() - parStart; return r; })();
    const guardResult = await (async () => { const r = await screenWithLlamaGuard(env.AI, gated.reply_en, transcript); guardMs = Date.now() - parStart; return r; })();

    if (guardResult.flagged) {
      // Rare: discard the just-synthesized audio and send a canned redirect.
      return handleGuardrailFlag(env, apiKey, session, sessionKey, accessCode, transcript, guardResult.category || 'llama_guard', 'model', now);
    }

    // The ML backstop couldn't produce a usable verdict (outage/timeout/empty).
    // The deterministic word-list gate already passed, so per the approved
    // "degrade gracefully" posture we deliver the reply -- but record the guard
    // degradation to the debug ring for visibility. This does NOT count as a
    // safety flag and never triggers the 2-flag early wrap-up.
    if (guardResult.degraded) {
      await recordConvoFlag(env, {
        code: accessCode,
        at: now,
        direction: 'guard_degraded',
        matched_rule: guardResult.category || 'guard_degraded',
      });
    }

    // ── LLM success path ──
    // Session history keeps recording reply_en/mood only (unchanged); the
    // gated optional fields are tracked separately as last_options/
    // last_expected/last_hint for the repair ladder's next-turn lookups.
    // A successful (non-repair, non-flagged) turn resets the repair ladder.
    const updatedSession = {
      ...nextSession(session, {
        kid_transcript: transcript,
        reply_en: gated.reply_en,
        mood: gated.mood,
      }),
      last_options: gated.options || null,
      last_expected: gated.expected || null,
      last_hint: gated.hint || null,
      repair: { step: 0, active: false },
    };

    try {
      await env.READ2LEAD_CODES.put(sessionKey, JSON.stringify(updatedSession), { expirationTtl: 600 });
    } catch {
      // best‑effort
    }

    const turnsLeft = Math.max(0, 12 - updatedSession.turns);
    const secondsLeft = Math.max(0, 300 - Math.floor((now - updatedSession.started_at) / 1000));

    // Zero-wait check: if the TTS already finished (cache hit / fast synth),
    // inline the audio exactly like the old single-phase response. The
    // sentinel wins the race only when the audio is still in flight.
    const TTS_STILL_PENDING = Symbol('tts_pending');
    const raced = await Promise.race([ttsPromise, Promise.resolve(TTS_STILL_PENDING)]);
    const ttsSettled = raced !== TTS_STILL_PENDING;
    // Settled-but-null means the synth already failed — say so now (no
    // audio_pending) and the client falls straight to speechSynthesis instead
    // of polling for audio that will never come.
    const inlineAudio = ttsSettled ? raced : null;
    const audioTurn = updatedSession.turns;

    if (!ttsSettled) {
      // Text goes out now; the voice finishes after the response. The audio
      // record is owner-stamped with the access code and short-lived; a null
      // synth result is stored as failed:true so the client stops polling
      // immediately instead of burning its whole poll window.
      const audioKey = `convo-audio:${sessionId}:${audioTurn}`;
      waitUntil((async () => {
        const audio = await ttsPromise;
        const payload = audio
          ? { code: accessCode, audio_b64: audio.audio_b64, content_type: audio.content_type }
          : { code: accessCode, failed: true };
        try {
          await env.READ2LEAD_CODES.put(audioKey, JSON.stringify(payload), { expirationTtl: PENDING_AUDIO_TTL_S });
        } catch {
          // best-effort — the client falls back to speechSynthesis on timeout
        }
        // The timing ring entry waits for the real tts_ms so the debug data
        // stays truthful about where the seconds went.
        await recordConvoTiming(env, {
          code: accessCode,
          at: now,
          stt_ms: sttMs, llm_ms: llmMs, guard_ms: guardMs, tts_ms: ttsMs,
          llm_source: llmSource, llm_attempts: llmAttempts, model: CONVO_MODEL,
          tts_deferred: true,
        });
      })());
    }

    // Server-side latency breakdown for this turn -> debug ring + response.
    // When the audio is deferred, tts_ms is not known yet at response time —
    // the ring entry written in waitUntil above carries the real number.
    const timing = { stt_ms: sttMs, llm_ms: llmMs, guard_ms: guardMs, tts_ms: ttsSettled ? ttsMs : null, llm_source: llmSource, llm_attempts: llmAttempts, model: CONVO_MODEL };
    if (ttsSettled) await recordConvoTiming(env, { code: accessCode, at: now, ...timing });

    return json({
      ok: true,
      transcript,
      reply_en: gated.reply_en,
      mood: gated.mood,
      ...(gated.options ? { options: gated.options } : {}),
      ...(gated.expected ? { expected: gated.expected } : {}),
      ...(gated.hint ? { hint: gated.hint } : {}),
      turns_left: turnsLeft,
      seconds_left: secondsLeft,
      timing,
      ...(inlineAudio ? { audio_b64: inlineAudio.audio_b64, content_type: inlineAudio.content_type } : {}),
      ...(!ttsSettled ? { audio_pending: true, audio_turn: audioTurn } : {}),
    });
  }

  if (!parsed) {
    // ── canned redirect path (LLM/parse failure) ──
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
    // Fix (Elon/Buffet review, 2026-07-11): this canned redirect also
    // abandons whatever question was on the table and poses a new one --
    // same stale-chips hazard as handleGuardrailFlag/repair_move_on, so the
    // same three fields + repair state must be cleared here too.
    const newSession = {
      ...nextSession(session, turnRecord),
      last_options: null,
      last_expected: null,
      last_hint: null,
      repair: { step: 0, active: false },
    };

    try {
      await env.READ2LEAD_CODES.put(sessionKey, JSON.stringify(newSession), { expirationTtl: 600 });
    } catch {
      // best‑effort
    }

    const turnsLeft = Math.max(0, 12 - newSession.turns);
    const secondsLeft = Math.max(0, 300 - Math.floor((now - newSession.started_at) / 1000));

    const ttsStart = Date.now();
    const redirectAudio = await synthesizeOrNull(env, apiKey, redirect.text_en);
    // A redirect turn means the brain failed/parsed empty -- llm_ms here is the
    // time we burned before giving up, the key signal for a slow/hung brain.
    const timing = { stt_ms: sttMs, llm_ms: llmMs, guard_ms: 0, tts_ms: Date.now() - ttsStart, llm_source: llmSource, llm_attempts: llmAttempts, model: CONVO_MODEL, path: 'redirect' };
    await recordConvoTiming(env, { code: accessCode, at: now, ...timing });
    return json({
      ok: true,
      transcript,
      reply_en: redirect.text_en,
      mood: 'idle',
      turns_left: turnsLeft,
      seconds_left: secondsLeft,
      timing,
      ...(redirectAudio ? { audio_b64: redirectAudio.audio_b64, content_type: redirectAudio.content_type } : {}),
    });
  }
}
