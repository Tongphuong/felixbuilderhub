import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { resolveOpenAiApiKey, getOrSynthesize } from './_minny-tts.js';
import { findPhrase } from './_minny-phrases.js';
import { normalizeHomeworkRecord } from './_homework.js';
import { normalizePracticeWord } from './read2lead-speaking-check.js';

// Tap-to-hear allowlist, schema v3 (grading-honesty packet, 2026-07-14): the
// old `text` branch only ever matched legacy v1/v2 `homework.sentences[]` —
// a genuinely v3-authored homework record (read/present/story/build/qa
// tasks[], no top-level .sentences at all) left every one of its own task
// texts un-tappable, a real gap this packet closes. normalizeHomeworkRecord
// is the one tolerant-read chokepoint for any stored schema version. Picture
// task anchors are the answer key (hidden from the child — see
// minny-speaking-context.js's picture branch, which never puts them in a
// step) and are deliberately excluded here, same as deriveHomeworkVocabulary
// excludes them for scoring. Pure, never throws.
export function deriveHomeworkTapAllowlist(homeworkRaw) {
  const homework = normalizeHomeworkRecord(homeworkRaw);
  const tasks = Array.isArray(homework?.tasks) ? homework.tasks : [];
  const words = new Set();
  const sentences = new Set();
  const addWords = (text) => {
    for (const token of String(text || '').split(/\s+/)) {
      const w = normalizePracticeWord(token);
      if (w) words.add(w);
    }
  };
  const addSentence = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    sentences.add(trimmed);
    addWords(trimmed);
  };
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    if (task.type === 'read') {
      for (const item of task.items || []) addSentence(item?.text_en);
    } else if (task.type === 'present') {
      for (const stem of task.stems || []) addSentence(stem?.text_en);
    } else if (task.type === 'story') {
      addSentence(task.prompt_en);
      for (const w of task.must_use || []) addWords(w);
    } else if (task.type === 'build') {
      // "grid options" + "assembled grid combinations' individual words":
      // every option is tappable as its own phrase, and its individual
      // words are covered by addSentence's addWords call — any assembled
      // combination is just a concatenation of these same option words, so
      // nothing further is needed once every option is walked.
      for (const col of task.columns || []) {
        for (const opt of col?.options || []) addSentence(opt);
      }
    } else if (task.type === 'qa') {
      for (const card of task.cards || []) {
        addSentence(card?.question_en);
        addSentence(card?.stem?.text_en);
      }
    }
    // picture: anchors are the answer key — never added.
  }
  return { words, sentences };
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

  const phraseId = String(body.phrase_id || '').trim();
  const rawText = String(body.text || '').trim();
  // Buffet hygiene nit (2026-07-12): only a real JSON string may enter the
  // word branch — String() would otherwise coerce e.g. ["banana"] via
  // Array.prototype.toString (analyzed non-exploitable, guarded anyway).
  const rawWord = typeof body.word === 'string' ? body.word.trim().toLowerCase() : '';
  let textToSynthesize = null;

  if (phraseId) {
    const phrase = findPhrase(phraseId);
    if (!phrase) {
      return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
    }
    textToSynthesize = phrase.text_en;
  } else if (rawText) {
    // Legacy v1/v2 field, kept for byte-identical behaviour on old records.
    const legacySentences = Array.isArray(codeData?.homework?.sentences) ? codeData.homework.sentences : [];
    const legacyMatch = legacySentences.find(s => String(s.text_en || '').trim() === rawText);
    // Schema v3 (grading-honesty packet, 2026-07-14): every sentence a child
    // can currently see on their own homework (read items, present/qa stem
    // text, story prompt, build column options) — see deriveHomeworkTapAllowlist.
    const { sentences: tapSentences } = deriveHomeworkTapAllowlist(codeData?.homework);
    // The coach's own model_sentence_en for the child's CURRENT record
    // (persisted short-TTL by read2lead-speaking-check.js alongside
    // flagged-words, once a coach note fires) — a novel sentence the model
    // composed, so it can never be derived from the static homework record.
    const flaggedForText = await env.READ2LEAD_CODES.get(`flagged-words:${accessCode}`, { type: 'json' });
    const coachSentences = Array.isArray(flaggedForText?.sentences) ? flaggedForText.sentences : [];
    const allowed = Boolean(legacyMatch) || tapSentences.has(rawText) || coachSentences.includes(rawText);
    if (!allowed) {
      return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
    }
    textToSynthesize = legacyMatch ? legacyMatch.text_en : rawText;
  } else if (rawWord) {
    // V1 word-level feedback (2026-07-12): tap-a-chip-to-hear-Minny. A single
    // word is only ever synthesized when it is in THIS code's own
    // flagged-words record (written by read2lead-speaking-check.js after a
    // scored attempt) OR derivable from the child's CURRENT homework record
    // (schema v3 extension, grading-honesty packet 2026-07-14) — never an
    // open TTS proxy for arbitrary text.
    if (!/^[a-z''-]{1,30}$/.test(rawWord) || /\s/.test(rawWord)) {
      return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
    }
    const flagged = await env.READ2LEAD_CODES.get(`flagged-words:${accessCode}`, { type: 'json' });
    const flaggedWords = Array.isArray(flagged?.words) ? flagged.words : [];
    const { words: homeworkWords } = deriveHomeworkTapAllowlist(codeData?.homework);
    if (!flaggedWords.includes(rawWord) && !homeworkWords.has(rawWord)) {
      return json({ ok: false, error: 'not_allowed', message: 'Nội dung không hợp lệ.' }, 403);
    }
    textToSynthesize = rawWord;
  } else {
    return json({ ok: false, error: 'text_missing', message: 'Thiếu nội dung cần đọc.' }, 400);
  }

  // Voice runs on the Workers AI binding — no API key required. The OpenAI
  // key only matters for the last-resort path when the binding is absent.
  if (!env.AI && !resolveOpenAiApiKey(env)) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình giọng nói.' }, 500);
  }

  try {
    const result = await getOrSynthesize(env, textToSynthesize);
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
