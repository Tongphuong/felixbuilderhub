// Read2Lead vocabulary TTS endpoint — sibling to minny-voice.js, reuses the
// same engine chain and KV cache. Authorizes text against the child's current
// lesson pack vocabulary rather than SpeakUp homework.
//
// SPEC: SPEC_R2L_VOCAB_TTS.md (Option A, new sibling endpoint).
// REUSE: getOrSynthesize from _minny-tts.js (engine chain + KV cache).
// AUTHORIZATION: text is allowed only when it appears in the child's current
// lesson pack (story sentences, question stems, read-aloud items, activities).
// The endpoint is NOT an open TTS proxy — arbitrary off-pack text returns 403.

import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { resolveOpenAiApiKey, getOrSynthesize } from './_minny-tts.js';
import { normalizePracticeWord } from './read2lead-speaking-check.js';

/**
 * Extract every English text string from a v2 lesson pack that a child can
 * tap: story sentences, Q&A question stems, read-aloud items, and all
 * activity-level text_en fields. Returns a Set of exact-matching strings.
 *
 * Pure function, never throws, always returns a Set.
 */
export function deriveR2lPackAllowlist(pack) {
  if (!pack || typeof pack !== 'object') return { sentences: new Set(), words: new Set() };

  // The pack lesson context is stored at pack.pack, pack.pack_json,
  // pack.review_context, or in the pack itself. extractV2LessonContext in
  // submit-read2lead-lesson.js searches these candidates.
  const candidates = [pack.pack, pack.pack_json, pack.review_context, pack];
  const lesson = candidates.find(isV2Lesson) || null;

  if (!lesson) return { sentences: new Set(), words: new Set() };

  const sentences = new Set();
  const words = new Set();

  const addSentence = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    sentences.add(trimmed);
    // Also add individual words so the child can tap a single word
    for (const token of trimmed.split(/\s+/)) {
      const w = normalizePracticeWord(token);
      if (w) words.add(w);
    }
  };

  // Story sentences
  if (lesson.story) {
    for (const sentence of lesson.story.sentences || []) {
      addSentence(sentence.text_en);
    }
  }

  // Activities
  for (const activity of lesson.activities || []) {
    if (!activity || typeof activity !== 'object') continue;

    // Q&A questions
    if (Array.isArray(activity.questions)) {
      for (const q of activity.questions) {
        addSentence(q.question_en);
        // Options (multiple choice)
        for (const opt of q.options || []) {
          addSentence(opt.text_en || opt);
        }
      }
    }

    // Read aloud items
    if (Array.isArray(activity.items)) {
      for (const item of activity.items) {
        addSentence(item.text_en);
      }
    }

    // General activity-level text_en (e.g. vocabulary, prompts)
    if (activity.text_en) {
      addSentence(activity.text_en);
    }

    // Sub-items
    if (Array.isArray(activity.sentences)) {
      for (const sentence of activity.sentences) {
        addSentence(sentence.text_en);
      }
    }
  }

  return { sentences, words };
}

function isV2Lesson(context) {
  return Boolean(
    context &&
      typeof context === 'object' &&
      context.schema_version === 2 &&
      context.story &&
      Array.isArray(context.activities),
  );
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

  const text = String(body.text || '').trim();
  if (!text) {
    return json({ ok: false, error: 'text_missing', message: 'Thiếu nội dung cần đọc.' }, 400);
  }

  // Derive the allowlist from the child's current pack in KV — never from
  // caller-supplied data. The pack stores the lesson context at
  // codeData.progress.current_pack.
  const currentPack = codeData?.progress?.current_pack || {};
  const { sentences, words } = deriveR2lPackAllowlist(currentPack);

  // Check if the requested text is in the current pack's vocabulary.
  // Allow exact sentence match OR individual word match.
  const normalizedWord = normalizePracticeWord(text);
  const allowed = sentences.has(text) || (normalizedWord && words.has(normalizedWord));

  if (!allowed) {
    return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
  }

  // Voice runs on the Workers AI binding — no API key required. The OpenAI
  // key only matters for the last-resort path when the binding is absent.
  if (!env.AI && !resolveOpenAiApiKey(env)) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình giọng nói.' }, 500);
  }

  try {
    const result = await getOrSynthesize(env, text);
    return json({ ok: true, audio_b64: result.audio_b64, content_type: result.content_type });
  } catch (err) {
    console.error('[read2lead-voice] tts failed:', err?.message || err);
    return json({ ok: false, error: 'tts_failed', message: 'Minny chưa đọc được câu này, con bật loa điện thoại nhé!' }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}