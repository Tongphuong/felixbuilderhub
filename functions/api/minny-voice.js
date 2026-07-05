import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { resolveOpenAiApiKey, getOrSynthesize } from './_minny-tts.js';
import { findPhrase } from './_minny-phrases.js';

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

  const phraseId = String(body.phrase_id || '').trim();
  const rawText = String(body.text || '').trim();
  let textToSynthesize = null;

  if (phraseId) {
    const phrase = findPhrase(phraseId);
    if (!phrase) {
      return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
    }
    textToSynthesize = phrase.text_en;
  } else if (rawText) {
    const sentences = Array.isArray(codeData?.homework?.sentences) ? codeData.homework.sentences : [];
    const match = sentences.find(s => String(s.text_en || '').trim() === rawText);
    if (!match) {
      return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
    }
    textToSynthesize = match.text_en;
  } else {
    return json({ ok: false, error: 'text_missing', message: 'Thiếu nội dung cần đọc.' }, 400);
  }

  const apiKey = resolveOpenAiApiKey(env);
  if (!apiKey) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình giọng nói.' }, 500);
  }

  try {
    const result = await getOrSynthesize(env.READ2LEAD_CODES, textToSynthesize, apiKey);
    return json({ ok: true, audio_b64: result.audio_b64, content_type: result.content_type });
  } catch (err) {
    console.error('[minny-voice] tts failed:', err?.message || err);
    return json({ ok: false, error: 'tts_failed', message: 'Minny chưa đọc được câu này, con bật loa điện thoại nhé!' }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
