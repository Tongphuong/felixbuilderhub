// Vision draft: reads an already-uploaded homework photo and proposes text
// for the two homework boxes. The teacher reviews/edits before saving —
// extraction is best-effort and never blocks assignment, so any model or
// parsing failure returns { ok: true, draft: null } rather than an error.
// Basic-Auth via functions/_middleware.js like all /api/admin routes.
import { json } from '../../_classes.js';
import { normalizeTeacherLine, parseHomeworkLines, parseFrameStems } from '../../../_homework.js';

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

export const VISION_PROMPT = [
  'This image is homework for Vietnamese children (age 7-11) learning to SPEAK English.',
  'Extract the English speaking task from the image and answer with STRICT JSON only, no other text:',
  '{"frame_lines": [], "sentence_lines": []}',
  '- frame_lines: presentation sentence starters that contain blanks for the child to fill while speaking. Write each starter as one line and mark every blank as exactly ___ (three underscores). Do not include labels like "Where?" or numbering.',
  '- sentence_lines: complete English sentences or single words the child must read aloud, one per line, no numbering.',
  'Use frame_lines OR sentence_lines, whichever matches the image; leave the other empty.',
  'If the image has no readable English speaking task, return both arrays empty.',
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

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!env.R2L_MEDIA) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống ảnh chưa được cấu hình.' }, 500);
  }
  if (!env.AI) {
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
    const parsed = raw && typeof raw === 'object' ? raw : parseVisionReply(raw);
    const draft = buildDraft(parsed);
    return json({ ok: true, draft });
  } catch (err) {
    console.error(`[homework-photo-extract] vision failed: ${err?.message}`);
    // detail is admin-facing (Basic-Auth route) — makes live failures
    // diagnosable without Cloudflare log access.
    return json({ ok: true, draft: null, reason: 'vision_failed', detail: String(err?.message || '').slice(0, 200) });
  }
}
