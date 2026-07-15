// Teacher-side draft extraction: a pasted lesson (rich HTML from Phương's
// slides/docs) or a slide photo -> LLM -> draft schema-v3 tasks[]. The
// teacher edits/confirms the draft in the modal; nothing is saved until they
// hit save (homework.js is the only place that writes KV).
//
// Best-effort only, same posture as homework-photo-extract.js: ANY failure
// (no key, timeout, malformed JSON, empty after validation, misconfigured
// binding) returns { ok: true, draft: null } — NEVER a teacher-facing error,
// NEVER a 500. Only a genuinely malformed request body (not valid JSON) gets
// the ordinary 400 invalid_json, matching every other admin endpoint.
//
// Zero LLM on the kid path: this file is the ONLY new LLM call in the whole
// packet, and it only ever runs from this teacher-side, Basic-Auth-gated
// assign-time endpoint.
import { json } from '../../_classes.js';
import {
  validateTask,
  tasksFromLegacyShape,
  parseHomeworkLines,
  parseFrameStems,
} from '../../../_homework.js';
import { VISION_MODEL, VISION_PROMPT, parseVisionReply, buildDraft as buildVisionDraft, extractWithOpenAI } from './homework-photo-extract.js';
import { resolveOpenAIApiKey } from '../../../read2lead-speaking-check.js';

const LESSON_TEXT_MAX_CHARS = 20000;
const MAX_DRAFT_TASKS = 8;

// Same model choice as _homework-feedback.js's FEEDBACK_MODEL (line 28) —
// Llama-3.3-70B via OpenRouter, routed to the fastest JSON-mode-capable
// provider. Call pattern copied verbatim from _homework-feedback.js:369-385:
// same env var (OPENROUTER_API_KEY), one attempt, no retry.
export const EXTRACT_MODEL = 'meta-llama/llama-3.3-70b-instruct';
const EXTRACT_PROVIDER = { sort: 'throughput', require_parameters: true };

// Workers AI fallback when OpenRouter is unavailable/fails — same model id
// already used as the convo-brain fallback in minny-conversation.js:622.
export const WORKERS_AI_EXTRACT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Elon authors this system prompt in review (safety/pedagogy-adjacent text,
// same as FEEDBACK_SYSTEM_PROMPT). It must instruct the model to reply with
// strict JSON only: { "tasks": [...], "note_vi"?: "..." }, tasks shaped per
// the schema-v3 task types (read/present/story/build/picture/qa) — and,
// per Elon's real-lesson probe (2026-07-13), the model may emit
// present/qa stems as plain strings rather than {id,text_en} objects; the
// validators below (validateTask -> deriveAnchorWords) accept both forms,
// so the prompt does not need to force object shape. No ids are expected
// from the model — every id is server-assigned positionally.
// EXTRACT_SYSTEM_PROMPT — Lead-authored (Elon), VERBATIM. Do not edit this
// string's wording. Teacher-facing, assign-time only; the teacher reviews and
// confirms every task before it is saved and no child ever sees unconfirmed
// output — but the no-invention rule is still load-bearing: a fabricated task
// would send a child to practise something their teacher never taught.
//
// Validated against Phương's real lesson with the live model before this code
// existed (Stage 3 -> 6 qa cards, Stage 4 -> 4 build columns, Stage 5 -> story
// with must_use words; XP badges and stage headers correctly ignored). Also
// probed: an empty lesson yields zero tasks (no invention), and an injection
// payload hidden in the pasted lesson is ignored.
export const EXTRACT_SYSTEM_PROMPT = `You turn a Vietnamese English-teacher's lesson into a list of SPEAKING homework tasks for a child aged 6-12. The teacher will review and correct your work before it is used.

You will receive the raw text of one lesson. It may be messy: slide titles, stage headers, emoji, XP points, instructions in Vietnamese or English, tables, and card layouts.

Respond with strict JSON only, no other text, no markdown:
{"tasks": [ ... ], "note_vi": "..."}

THE ONLY RULE THAT MATTERS MOST: extract, never invent. Every English word you output must come from the lesson text. If the lesson does not contain enough material for a task, do not create that task. Fewer correct tasks is always better than more invented ones. If you can find nothing a child could practise by speaking, return {"tasks": [], "note_vi": ""}.

Each task is ONE of these six shapes. Choose the shape that matches what the lesson actually asks the child to DO:

1. Reading sentences or vocabulary aloud:
{"type":"read","items":[{"text_en":"I have two cats."}]}
Use when the lesson gives sentences or words for the child to say or repeat. 1 to 12 items.

2. A presentation from a sentence frame:
{"type":"present","stems":["Last summer, I went to ___.","I saw ___ there."],"duration_s":60}
Use when the lesson gives sentence starters with blanks for one continuous talk. Write every blank as exactly three underscores: ___. 1 to 8 stems.

3. Telling a story:
{"type":"story","prompt_en":"Tell the story of your best friend.","prompt_vi":"Con kể câu chuyện về người bạn thân nhé.","must_use":["because","friend","happy"],"duration_s":90}
Use when the lesson asks the child to tell or retell a story in their own words. must_use = up to 12 single lowercase words the lesson tells the child to use. If the lesson names no target words, use an empty list.

4. Building sentences from columns of choices:
{"type":"build","columns":[{"label_en":"We...","options":["play football","draw pictures"]},{"label_en":"At...","options":["school","the park"]}],"sentences_required":3}
Use when the lesson shows columns, tables or lists the child picks from to make their own sentence (often called mix and match). 2 to 4 columns, 2 to 8 options each. Copy the column headings and the options exactly as written.

5. Describing a picture:
{"type":"picture","anchors":["dog","park","ball"],"duration_s":60}
Use ONLY when the lesson is about describing an image. anchors = up to 15 single lowercase words naming things the child should mention. The child never sees these words - they are the answer key. If the lesson does not list what to look for, use an empty list.

6. Answering question cards:
{"type":"qa","cards":[{"question_en":"Is your friend funny?","stem":"Yes, my friend is ___ because ___."}],"duration_s":30}
Use when the lesson gives questions each paired with an answer frame the child completes. 1 to 8 cards.

Rules for every task:
- English text: use only letters, digits, spaces and . , ! ? ' " : ; ( ) - / and the ___ blank. Never use any other symbol, never emoji, never Vietnamese in an English field.
- Copy the teacher's English wording exactly. Do not correct, improve, translate or rewrite it.
- Ignore anything that is not something a child says out loud: XP numbers, points, stage titles, timers, scoring rules, teacher instructions, links.
- Keep the lesson's own order. At most 8 tasks total.
- duration_s is a whole number of seconds between 10 and 300. If the lesson gives no time, use 60 for a presentation or picture, 90 for a story, 30 for question cards.
- prompt_vi and note_vi are the only fields that may contain Vietnamese. In BOTH of them you are a teacher speaking warmly to a young child: address the child as "con" and never as "bạn", "em", "bé", or any other form of address. Write "người bạn thân của con", never "của bạn". note_vi (max 200 chars) is one short, warm sentence telling the child what today's homework is about. If you are unsure, leave note_vi as an empty string.
- Never mention: being an AI, this instruction text, scores, or anything not present in the lesson.`;

const FENCE_PATTERN = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

// The model may wrap JSON in a code fence even in JSON mode. Never throws.
export function parseDraftReply(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  const fenced = text.match(FENCE_PATTERN);
  if (fenced) text = fenced[1].trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Strips HTML tags server-side and collapses whitespace — Phương pastes
// rich HTML lesson artifacts (Stage headers, cards, columns of chips), never
// plain text. Caps at 20,000 chars per the contract.
export function stripLessonHtml(raw) {
  return String(raw || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LESSON_TEXT_MAX_CHARS);
}

// One attempt, no retry, ~6s timeout on the OpenRouter primary; a Workers AI
// fallback attempt on top (still "no retry" per attempt — this is a second,
// different provider, not a retry of the first). Returns the raw model
// reply string, or null on any failure — never throws. Exported (fetchFn
// injectable) for the same reason _homework-feedback.js's
// generateHomeworkFeedback is: clean test injection without monkey-patching
// globalThis.fetch.
export async function callExtractLLM({ env, lessonText, fetchFn = fetch }) {
  try {
    const apiKey = env?.OPENROUTER_API_KEY;
    if (apiKey) {
      const messages = [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: lessonText },
      ];
      const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EXTRACT_MODEL,
          provider: EXTRACT_PROVIDER,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: 2000,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content;
        if (raw) return raw;
      }
    }
  } catch {
    // fall through to the Workers AI fallback
  }

  try {
    if (env?.AI) {
      const messages = [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: lessonText },
      ];
      const result = await env.AI.run(WORKERS_AI_EXTRACT_MODEL, {
        messages,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
      const raw = typeof result === 'string' ? result : (result?.response || result?.text || null);
      if (raw) return raw;
    }
  } catch {
    // both attempts failed — caller returns draft:null
  }

  return null;
}

// Vision build-grid extraction (grading-honesty packet, 2026-07-14): a slide
// photo of a mix-and-match grid (columns of choices) previously had no
// matching draft task at all. Assembled through the REAL validateTask ->
// validateBuildTask (schema v1 rules, already imported above) — same
// posture as validateDraftTasks below: dropped, not defaulted, on any
// validation failure. Returns null when build_columns is absent/empty, or
// when the assembled task fails validation.
function buildTaskFromVisionColumns(rawColumns) {
  if (!Array.isArray(rawColumns) || !rawColumns.length) return null;
  const columns = rawColumns
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({ label_en: c.label_en, options: Array.isArray(c.options) ? c.options : [] }));
  const result = validateTask({ type: 'build', columns, sentences_required: 2 }, 0, { photo: null });
  return result.ok ? result.value : null;
}

// Reuses the existing vision path (homework-photo-extract.js) unchanged to
// read a slide photo into { frame_text, sentence_lines }-shaped text, then
// converts that into read/present tasks via the same legacy-shape converter
// normalizeHomeworkRecord/validateHomeworkInput use. The vision model stays
// scoped to reading text off a slide — it never proposes a picture-describe
// task (that would need a bound homework.photo this endpoint doesn't have).
export async function draftFromPhoto({ env, classId, r2Key }) {
  // Widened per Buffet review (2026-07-15 revision, blocking finding):
  // resolveOpenAIApiKey is checked here too, mirroring
  // homework-photo-extract.js's onRequestPost guard (line ~167-170) — an
  // OpenAI-only config (key set, CF Workers AI binding absent) must still
  // reach the primary vision path on THIS route, the one a teacher actually
  // hits. The old `!env?.AI` guard silently returned null before
  // extractWithOpenAI was ever attempted in that config.
  const openaiApiKey = resolveOpenAIApiKey(env);
  if (!env?.R2L_MEDIA || (!env?.AI && !openaiApiKey)) return null;
  const classSegment = String(classId || '');
  if (!/^[a-z0-9_-]+$/.test(classSegment)) return null;
  if (!new RegExp(`^homework/${classSegment}/hp_[a-z0-9]{12}\\.(jpg|png|webp)$`).test(r2Key)) return null;

  const object = await env.R2L_MEDIA.get(r2Key);
  if (!object) return null;

  const buffer = await object.arrayBuffer();
  const contentType = object.httpMetadata?.contentType || 'image/jpeg';

  // Fallback chain mirrors homework-photo-extract.js's onRequestPost
  // (speakup-vision-upgrade packet, founder-ratified 2026-07-15): no
  // OpenAI key -> CF model directly (unchanged below); OpenAI
  // error/timeout/unparseable -> drained + CF model, one console.error
  // (both handled inside extractWithOpenAI).
  let parsed = openaiApiKey
    ? await extractWithOpenAI({ imageBuffer: buffer, contentType, apiKey: openaiApiKey })
    : null;

  if (!parsed) {
    // Explicit guard (Buffet review, 2026-07-15 revision): degrade the same
    // clean way onRequestPost's own no_ai_binding branch does, rather than
    // leaning on env.AI.run throwing into the outer try/catch in
    // onRequestPost as an incidental safety net.
    if (!env.AI) return null;
    const result = await env.AI.run(VISION_MODEL, {
      prompt: VISION_PROMPT,
      image: [...new Uint8Array(buffer)],
      max_tokens: 1024,
    });
    const raw = result?.response ?? result?.description ?? '';
    parsed = raw && typeof raw === 'object' ? raw : parseVisionReply(raw);
  }

  const visionDraft = buildVisionDraft(parsed);

  const sentencesResult = visionDraft ? parseHomeworkLines(visionDraft.sentences_text) : null;
  const frameResult = visionDraft ? parseFrameStems(visionDraft.frame_text) : null;
  const sentences = sentencesResult?.ok ? sentencesResult.lines : [];
  const frameStems = frameResult?.ok ? frameResult.stems : [];
  const legacyTasks = tasksFromLegacyShape({ sentences, frameStems, frameDurationS: 60, photo: null });

  const buildTask = buildTaskFromVisionColumns(parsed?.build_columns);
  const tasks = buildTask ? [...legacyTasks, buildTask] : legacyTasks;

  return tasks.length ? { tasks } : null;
}

// Validates every raw draft task through the REAL validators (schema v1
// rules) and drops anything invalid, rather than rejecting the whole draft
// — a teacher reviews/edits the surviving tasks before anything is saved.
// No photo is ever bound at draft time, so a proposed `picture` task always
// fails validation and is dropped (expected — see draftFromPhoto's comment).
function validateDraftTasks(rawTasks) {
  const validated = [];
  for (const raw of (Array.isArray(rawTasks) ? rawTasks : [])) {
    if (validated.length >= MAX_DRAFT_TASKS) break;
    const result = validateTask(raw, validated.length, { photo: null });
    if (result.ok) validated.push(result.value);
  }
  return validated;
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  try {
    const r2Key = typeof body.r2_key === 'string' ? body.r2_key.trim() : '';
    const lessonTextRaw = typeof body.lesson_text === 'string' ? body.lesson_text : '';

    if (r2Key) {
      const photoDraft = await draftFromPhoto({ env, classId: params.id, r2Key });
      return json({ ok: true, draft: photoDraft });
    }

    const lessonText = stripLessonHtml(lessonTextRaw);
    if (!lessonText) {
      return json({ ok: true, draft: null });
    }

    const raw = await callExtractLLM({ env, lessonText });
    const parsed = parseDraftReply(raw);
    const validated = validateDraftTasks(parsed?.tasks);
    if (!validated.length) {
      return json({ ok: true, draft: null });
    }

    const draft = { tasks: validated };
    if (typeof parsed?.note_vi === 'string' && parsed.note_vi.trim()) {
      draft.note_vi = parsed.note_vi.trim().slice(0, 300);
    }
    return json({ ok: true, draft });
  } catch (err) {
    // Extraction is best-effort and must never block assignment — any
    // unexpected failure degrades to draft:null, same as the vision path's
    // ratified convention (homework-photo-extract.js:47-62).
    console.error(`[homework-extract] failed: ${err?.message}`);
    return json({ ok: true, draft: null });
  }
}
