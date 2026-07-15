// Vision draft: reads an already-uploaded homework photo and proposes text
// for the two homework boxes. The teacher reviews/edits before saving —
// extraction is best-effort and never blocks assignment, so any model or
// parsing failure returns { ok: true, draft: null } rather than an error.
// Basic-Auth via functions/_middleware.js like all /api/admin routes.
//
// PRIMARY reader is OpenAI's gpt-4o-mini vision (speakup-vision-upgrade
// packet, founder-ratified 2026-07-15): the free CF Workers AI 11B vision
// model below could not reliably follow VISION_PROMPT's card-sheet branch —
// a live rerun on a real flavour sheet drafted words-only twice. Same
// OpenAI account/key as the existing Whisper transcription fallback
// (read2lead-speaking-check.js's transcribeWithOpenAI/resolveOpenAIApiKey,
// reused here rather than reimplemented). Teacher-triggered, assign-time
// only, low volume -- cost is roughly <1c/photo, well inside the
// founder-ratified ceiling. CF Workers AI (VISION_MODEL below) is the free
// fallback: no OpenAI key configured, or the OpenAI call errors/times
// out/returns something unparseable, and we degrade to it silently -- a
// teacher-facing feature must never fail the request because the premium
// reader hiccupped.
import { json } from '../../_classes.js';
import { normalizeTeacherLine, parseHomeworkLines, parseFrameStems } from '../../../_homework.js';
import { resolveOpenAIApiKey } from '../../../read2lead-speaking-check.js';

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const OPENAI_VISION_MODEL = 'gpt-4o-mini';
export const OPENAI_VISION_TIMEOUT_MS = 30000;

// build_columns added (grading-honesty packet, 2026-07-14): a slide photo of
// a mix-and-match grid (columns of choices the child picks from to build
// their own sentence) previously had no matching draft shape at all — the
// existing frame_lines/sentence_lines instructions are untouched.
export const VISION_PROMPT = [
  'This image is homework for Vietnamese children (age 7-11) learning to SPEAK English.',
  'Extract the English speaking task from the image and answer with STRICT JSON only, no other text:',
  '{"frame_lines": [], "sentence_lines": [], "build_columns": []}',
  '- frame_lines: presentation sentence starters that contain blanks for the child to fill while speaking. Write each starter as one line and mark every blank as exactly ___ (three underscores). Do not include labels like "Where?" or numbering.',
  '- sentence_lines: complete English sentences or single words the child must read aloud, one per line, no numbering.',
  '- build_columns: use for TWO patterns. (1) MIX AND MATCH: the image shows columns, a table, or lists of choices the child picks from to build their own sentence. Copy the column heading and each option exactly as written in the image. (2) VOCAB CARDS + SENTENCE: the image shows vocabulary cards (a set of highlighted words, often with example sentences) plus a fill-in-the-blank sentence or speaking task. Output one column per blank, in sentence order. Each column\'s label_en is the sentence fragment leading up to that blank (e.g. "My favourite food is...", "It tastes...", "and..."). For a blank whose meaning matches the cards (adjectives, flavours), the options are the card words copied exactly. For a free-noun blank (like the food itself), use concrete nouns visible in the sheet\'s example sentences (e.g. cake, chips, lemons, chilli, coffee, fried chicken, vegetables) as options. Each entry is {"label_en": "...", "options": ["...", "..."]}. 2 to 4 columns, 2 to 8 options each.',
  'Many photos are plain sentences to read or a blank-frame WITHOUT vocabulary cards — use sentence_lines or frame_lines for those and leave build_columns empty; only use build_columns when the image actually shows columns/cards to pick from.',
  'FULL WORKED EXAMPLE. Image shows: a title; a small SUBTITLE line with blanks ("Say the word -> make the face -> use it..."); 8 vocabulary word cards (delicious, sweet, sour, spicy, salty, bitter, fresh, crunchy), each with its own example sentence; and, below the cards, a highlighted SPEAKING TASK box: "My favourite food is ______. It tastes ______ and ______. Say TWO flavour words!" The subtitle line is instructions for the page, NOT the exercise -- ignore it, do not use it as a frame_line. The highlighted SPEAKING TASK box at the bottom IS the exercise. The 8 vocabulary cards are choices to pick from even though the image never draws them as a column -- treat them as one. Correct output: {"frame_lines":[],"sentence_lines":[],"build_columns":[{"label_en":"My favourite food is...","options":["cake","chips","lemons","chilli","coffee","fried chicken","vegetables"]},{"label_en":"It tastes...","options":["delicious","sweet","sour","spicy","salty","bitter","fresh","crunchy"]},{"label_en":"and...","options":["delicious","sweet","sour","spicy","salty","bitter","fresh","crunchy"]}]}',
  'Use frame_lines, sentence_lines, OR build_columns, whichever matches the image; leave the other(s) empty.',
  'If the image has no readable English speaking task, return all three arrays empty.',
].join('\n');

// The model may wrap JSON in prose or code fences — take the first {...}
// block. Returns null when nothing parseable comes back.
export function parseVisionReply(reply) {
  const text = String(reply || '');
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Keep only lines the real validators would accept, so the draft the
// teacher sees is exactly what a save would accept.
export function buildDraft(parsed) {
  if (!parsed) return null;
  const frameLines = (Array.isArray(parsed.frame_lines) ? parsed.frame_lines : [])
    .map((l) => normalizeTeacherLine(l).replace(/_{2,}/g, '___'))
    .filter((l) => l && parseFrameStems(l).ok)
    .slice(0, 8);
  const sentenceLines = (Array.isArray(parsed.sentence_lines) ? parsed.sentence_lines : [])
    .map((l) => normalizeTeacherLine(l))
    .filter((l) => l && parseHomeworkLines(l).ok)
    .slice(0, 12);
  if (!frameLines.length && !sentenceLines.length) return null;
  return {
    frame_text: frameLines.join('\n'),
    sentences_text: sentenceLines.join('\n'),
  };
}

// Chunked to avoid blowing the call-stack limit of String.fromCharCode.apply
// on a full-size photo buffer -- mirrors read2lead-speaking-check.js's
// private arrayBufferToBase64 helper (not exported there, so duplicated
// rather than imported; kept in lockstep by inspection, same small shape).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// PRIMARY vision path -- gpt-4o-mini via OpenAI's chat completions API.
// VISION_PROMPT is shared VERBATIM with the CF fallback model below (one
// prompt, two models); it already satisfies OpenAI's json_object-mode
// requirement that the word "JSON" appear in the messages ("STRICT JSON
// only" in the prompt's second line). Never throws -- returns the parsed
// draft object, or null on ANY failure (no key handling is the caller's
// job; this function assumes apiKey is truthy). Exported so
// homework-extract.js's draftFromPhoto (the live teacher-facing photo-draft
// path) can call it directly too. `fetchFn` is injectable for tests, same
// pattern as read2lead-speaking-check.js's transcribeWithOpenAI and
// _homework-feedback.js's generateHomeworkFeedback.
export async function extractWithOpenAI({ imageBuffer, contentType, apiKey, fetchFn = fetch }) {
  try {
    const dataUrl = `data:${contentType || 'image/jpeg'};base64,${arrayBufferToBase64(imageBuffer)}`;
    const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        messages: [
          { role: 'system', content: VISION_PROMPT },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(OPENAI_VISION_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Connection hygiene (07-15 leak lesson): drain before discarding, or
      // the subrequest connection stays open toward Workers' 6-connection
      // isolate cap -- same pattern as read2lead-speaking-check.js's
      // transcribeWithOpenAI and _homework-feedback.js's
      // generateHomeworkFeedback.
      let detail = '';
      try { detail = await res.text(); } catch { /* best-effort drain */ }
      console.error(`[homework-photo-extract] openai vision ${res.status}:`, detail.slice(0, 200));
      return null;
    }

    // res.json() fully drains the stream even if the JSON.parse it does
    // internally throws (same guarantee _homework-feedback.js relies on) --
    // a parse failure of the MODEL'S reply text below is a separate,
    // non-network concern and needs no extra drain step.
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const parsed = raw && typeof raw === 'object' ? raw : parseVisionReply(raw);
    if (!parsed) {
      console.error('[homework-photo-extract] openai vision reply unparseable');
      return null;
    }
    return parsed;
  } catch (err) {
    // Covers fetchFn throwing (network error, AbortSignal.timeout's
    // TimeoutError) and any unexpected failure above.
    console.error(`[homework-photo-extract] openai vision failed: ${err?.message}`);
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!env.R2L_MEDIA) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống ảnh chưa được cấu hình.' }, 500);
  }
  const openaiApiKey = resolveOpenAIApiKey(env);
  if (!env.AI && !openaiApiKey) {
    return json({ ok: true, draft: null, reason: 'no_ai_binding' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }


  const classId = String(params.id || '');
  const key = String(body.r2_key || '');
  if (!/^[a-z0-9_-]+$/.test(classId)
    || !new RegExp(`^homework/${classId}/hp_[a-z0-9]{12}\\.(jpg|png|webp)$`).test(key)) {
    return json({ ok: false, error: 'photo_not_found' }, 404);
  }

  const object = await env.R2L_MEDIA.get(key);
  if (!object) {
    return json({ ok: false, error: 'photo_not_found' }, 404);
  }

  try {
    const buffer = await object.arrayBuffer();
    const contentType = object.httpMetadata?.contentType || 'image/jpeg';

    // Fallback chain: no OpenAI key -> CF model directly (today's original
    // behavior, unchanged below); OpenAI error/timeout/unparseable -> CF
    // model. Teacher-facing feature: degrade gracefully, never fail the
    // request because the premium reader hiccupped.
    // draft_source (speakup-vision-tuning packet, 2026-07-15): which reader
    // actually answered was previously invisible in the response, making a
    // wrong-frame draft undiagnosable (gpt-4o-mini vs. the CF fallback?).
    // Admin-authed teacher API only -- no kid surface reads this endpoint.
    let draftSource = null;
    let parsed = openaiApiKey
      ? await extractWithOpenAI({ imageBuffer: buffer, contentType, apiKey: openaiApiKey })
      : null;
    if (parsed) draftSource = 'openai';

    if (!parsed) {
      if (!env.AI) {
        return json({ ok: true, draft: null, reason: 'no_ai_binding' });
      }
      // Input shape pinned live 2026-07-08: prompt + byte-array image works;
      // messages+image errors with 3030 on this model build. NOTE: the model
      // requires a one-time per-account Meta license acceptance (send the
      // literal prompt 'agree' once — done 2026-07-08; a new CF account would
      // need it again, symptom is error 5016 in `detail`).
      const result = await env.AI.run(VISION_MODEL, {
        prompt: VISION_PROMPT,
        image: [...new Uint8Array(buffer)],
        max_tokens: 1024,
      });
      const raw = result?.response ?? result?.description ?? '';
      // Some Workers AI builds return `response` as an already-parsed object
      // (JSON mode); others as a string to parse.
      parsed = raw && typeof raw === 'object' ? raw : parseVisionReply(raw);
      if (parsed) draftSource = 'workers-ai';
    }

    const draft = buildDraft(parsed);
    return json({ ok: true, draft, draft_source: draft ? draftSource : null });
  } catch (err) {
    console.error(`[homework-photo-extract] vision failed: ${err?.message}`);
    // detail is admin-facing (Basic-Auth route) — makes live failures
    // diagnosable without Cloudflare log access.
    return json({ ok: true, draft: null, reason: 'vision_failed', detail: String(err?.message || '').slice(0, 200) });
  }
}
