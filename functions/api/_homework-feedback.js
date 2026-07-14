// V1.3 homework feedback sandwich (2026-07-12) — pure module, no I/O beyond
// the single OpenRouter fetch in generateHomeworkFeedback. Founder gate:
// Phương explicitly ack'd the V1-D1 zero-LLM relaxation (AskUserQuestion,
// 2026-07-12) for exactly this one fenced place: an LLM feedback layer ON
// TOP of the deterministic scorer, never replacing it.
//
// THE PILOT IS LIVE. The one non-negotiable, restated here because every
// function in this file exists to serve it: ANY failure (no key, LLM
// error/timeout, parse failure, ungrounded claim, guardrail flag) must
// leave the caller free to do nothing — never alter, delay, or replace a
// deterministic field. generateHomeworkFeedback never throws and returns
// null on anything but a fully validated, grounded feedback object.
//
// normalizePracticeWord is imported from read2lead-speaking-check.js (that
// file in turn imports buildFeedbackContext/generateHomeworkFeedback from
// here — a deliberate two-way import; both symbols are plain functions only
// ever called from inside request-time function bodies, never at module
// top-level, so the cycle is safe). SKIP_WORDS is NOT imported the same way
// — it is passed in by the caller (skipWords param), mirroring
// mapAzureFramePronunciation's existing precedent in _azure-pronunciation.js
// for the same reason: avoid a top-level circular value import.
import { normalizePracticeWord } from './read2lead-speaking-check.js';

// Replicated from functions/api/minny-conversation.js (CONVO_MODEL /
// CONVO_PROVIDER, ~line 24) — not exported there, so kept in sync manually.
// Same model/provider choice: Llama-3.3-70B via OpenRouter, routed to the
// fastest JSON-mode-capable provider (Groq/Cerebras-class throughput).
const FEEDBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct';
const FEEDBACK_PROVIDER = { sort: 'throughput', require_parameters: true };

const MAX_TRANSCRIPT_CHARS = 600;
const MAX_PRAISE_VI = 140;
const MAX_FOCUS_WORD = 40;
const MAX_MODEL_SENTENCE_EN = 60;
const MAX_TINY_CHALLENGE_VI = 140;
const MAX_RECAST_EN = 80;

// ---------------------------------------------------------------------------
// 1. buildFeedbackContext
// ---------------------------------------------------------------------------

// Builds the compact plain-object the prompt consumes. Pure — no I/O, never
// throws (every field is defensively read with optional chaining / type
// guards so a malformed `result`/`homework` degrades to an empty context
// rather than a crash).
export function buildFeedbackContext({ checkMode, result, transcript, homework, azure, skipWords, taskType } = {}) {
  const mode = checkMode === 'frame' ? 'frame' : (checkMode === 'open' ? 'open' : 'read');

  // The expected homework text relevant to THIS attempt — read from the
  // deterministic result itself (word_feedback carries the exact expected
  // words in order for read steps; stems carry the exact text_en for frame
  // steps) rather than re-deriving it from the homework block, so it always
  // matches what was actually scored.
  // (Fix, Elon review 2026-07-12: the read path referenced a field name that
  // doesn't exist on real results — `word_feedback`; real read results carry
  // `words: [{word,status}]`. That left homeworkText empty on every perfect
  // read, so allowed_focus_words fell back to [] and the model emitted an
  // empty focus_word → parse-reject → the high scorer got no coach at all,
  // the founder's original complaint. Derive from the result where present
  // AND always union in the homework block's own texts.)
  const homeworkParts = [];
  if (mode === 'frame' && Array.isArray(result?.stems)) {
    for (const st of result.stems) if (typeof st?.text_en === 'string') homeworkParts.push(st.text_en);
  }
  if (mode === 'read' && Array.isArray(result?.word_feedback)) {
    // local scorer shape (scoreTranscript)
    for (const w of result.word_feedback) if (typeof w?.expected === 'string') homeworkParts.push(w.expected);
  }
  if (mode === 'read' && Array.isArray(result?.words)) {
    // Azure scorer shape (mapAzureReadResult)
    for (const w of result.words) if (typeof w?.word === 'string') homeworkParts.push(w.word);
  }
  if (Array.isArray(homework?.sentences)) {
    for (const it of homework.sentences) if (typeof it?.text_en === 'string') homeworkParts.push(it.text_en);
  }
  if (Array.isArray(homework?.frame?.stems)) {
    for (const st of homework.frame.stems) if (typeof st?.text_en === 'string') homeworkParts.push(st.text_en);
  }
  const homeworkText = homeworkParts.join(' ');

  const wordsMissed = Array.isArray(result?.words_missed) ? result.words_missed : [];
  const wordsClose = Array.isArray(result?.words_close) ? result.words_close : [];
  const pronunciationWords = Array.isArray(result?.pronunciation?.words) ? result.pronunciation.words : [];

  // allowed_focus_words = flagged (pronunciation weak words) ∪ missed ∪
  // close, normalized. If the kid did great (set empty), fall back to the
  // content words of the expected homework text — or, when no reference
  // text exists at all (photo_talk has none), the kid's own transcript — so
  // a perfect or unscripted attempt still has a safe, real-word pool to
  // pick a focus word from.
  const skip = skipWords instanceof Set ? skipWords : new Set();
  const focusSet = new Set();
  for (const raw of [...wordsMissed, ...wordsClose, ...pronunciationWords.map((w) => w?.word)]) {
    const norm = normalizePracticeWord(raw);
    if (norm) focusSet.add(norm);
  }

  // Grid-grounded near-miss words (grading-honesty packet, 2026-07-14): for a
  // no-reference open attempt (photo_talk), scoreOpenTranscript already
  // deterministically compared the transcript against the child's homework
  // vocabulary and attaches result.near_miss_words for any transcript word
  // that isn't an exact vocabulary member but closely resembles one (e.g.
  // said "pack", the homework's build grid has "park"). Both the said word
  // and the homework's word are allowed focus-word choices — the honesty
  // rule (validateFeedbackGrounding) still enforces focus_word ∈
  // allowed_focus_words either way; near_miss_words additionally rides the
  // context JSON so the prompt can target the correction at the real
  // homework word instead of parroting the mistake back.
  const nearMissWords = mode === 'open' && Array.isArray(result?.near_miss_words) ? result.near_miss_words : [];
  if (nearMissWords.length) {
    for (const nm of nearMissWords) {
      const saidNorm = normalizePracticeWord(nm?.said);
      const nearestNorm = normalizePracticeWord(nm?.nearest);
      if (saidNorm) focusSet.add(saidNorm);
      if (nearestNorm) focusSet.add(nearestNorm);
    }
  }

  let allowedFocusWords = [...focusSet];
  if (!allowedFocusWords.length) {
    const fallbackSource = homeworkText || (mode === 'open' ? transcript : '');
    const fallbackSet = new Set();
    for (const token of String(fallbackSource || '').split(/\s+/)) {
      const norm = normalizePracticeWord(token);
      if (norm && !skip.has(norm)) fallbackSet.add(norm);
    }
    allowedFocusWords = [...fallbackSet];
  }

  const rubric = (mode === 'frame' && result?.rubric && typeof result.rubric === 'object')
    ? {
        spoke_all_stems: Boolean(result.rubric.spokeAllStems),
        duration_on_target: Boolean(result.rubric.durationOnTarget),
        spoke_clearly: Boolean(result.rubric.spokeClearly),
      }
    : null;

  const scorePercent = mode === 'frame'
    ? (Number.isFinite(result?.matchPct) ? result.matchPct : null)
    : (Number.isFinite(result?.score_percent) ? result.score_percent : null);

  const azureBlock = (azure && typeof azure === 'object' && Number.isFinite(azure.accuracy_percent))
    ? {
        accuracy_percent: azure.accuracy_percent,
        fluency_percent: Number.isFinite(azure.fluency_percent) ? azure.fluency_percent : null,
        ...(Array.isArray(azure.words) && azure.words.length ? { words: azure.words.slice(0, 3) } : {}),
      }
    : null;

  // Schema v3 target words (2026-07-13): the homework compiler
  // (minny-speaking-context.js) puts a task's must_use/anchors/stem anchor
  // words uniformly into the compiled step's stems[].anchor_words, for
  // every frame-check_mode task type (present/story/qa/picture-with-
  // anchors) — so result.stems[].anchor_words IS "the task's target words"
  // for whichever task this attempt was. Informational only: this is a
  // SEPARATE field from allowed_focus_words, not a new source for it — the
  // focus_word grounding fence (validateFeedbackGrounding) is unchanged and
  // still only accepts a word from allowed_focus_words.
  const targetWordsSet = new Set();
  if (mode === 'frame' && Array.isArray(result?.stems)) {
    for (const st of result.stems) {
      if (Array.isArray(st?.anchor_words)) {
        for (const w of st.anchor_words) {
          const norm = normalizePracticeWord(w);
          if (norm) targetWordsSet.add(norm);
        }
      }
    }
  }

  return {
    // task_type (from the compiled step, when the caller has it) takes
    // priority over the check_mode-derived value; falls back to today's
    // derivation when absent so an untouched caller (read2lead-speaking-
    // check.js, frozen) keeps working unchanged.
    exercise_type: typeof taskType === 'string' && taskType ? taskType : (mode === 'open' ? 'photo_talk' : mode),
    homework: {
      note_vi: typeof homework?.note_vi === 'string' ? homework.note_vi.slice(0, 300) : '',
      text: homeworkText.slice(0, 600),
    },
    outcome: {
      score_percent: scorePercent,
      words_missed: wordsMissed.slice(0, 20),
      words_close: wordsClose.slice(0, 20),
      rubric,
    },
    azure: azureBlock,
    transcript: String(transcript || '').slice(0, MAX_TRANSCRIPT_CHARS),
    allowed_focus_words: allowedFocusWords,
    target_words: [...targetWordsSet].slice(0, 20),
    ...(nearMissWords.length
      ? { near_miss_words: nearMissWords.slice(0, 5).map((nm) => ({ said: nm.said, nearest: nm.nearest })) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 2. FEEDBACK_SYSTEM_PROMPT — Lead-authored (Elon), paste VERBATIM. Do not
//    edit this string's wording; it is the safety-adjacent prompt text.
//    2026-07-14 (grading-honesty packet, dispatched by Elon): ONE new rule
//    bullet appended for near_miss_words (the grid-grounded recast for a
//    no-reference photo attempt) plus the input-JSON sentence updated to
//    mention it — every character before this line is untouched.
// ---------------------------------------------------------------------------

export const FEEDBACK_SYSTEM_PROMPT = `You are Minny, a warm Vietnamese teaching assistant writing ONE short feedback note for a young child (age 6-12) who just finished an English speaking exercise. You write Vietnamese warmly, like a kind teacher — never like a report.

You will receive JSON with: the exercise content the teacher assigned, what the child actually said (an automatic transcript — may contain small errors, be generous), the exercise results, allowed_focus_words, pronunciation data (may be null), and near_miss_words (may be absent).

Respond with strict JSON only, no other text, no markdown:
{"praise_vi": "...", "focus_word": "...", "model_sentence_en": "...", "tiny_challenge_vi": "...", "recast_en": "..."}

Rules:
- Address the child as "con" — a teacher speaking warmly to a young child. Never "bạn", "em", or any other form of address.
- praise_vi (Vietnamese, max 140 chars): praise ONE specific thing the child actually did — a real word or phrase they said, their completeness, their fluency. If you quote their words, copy them EXACTLY as written in the transcript (even if the spelling looks odd), inside double quotes, at most 4 words. If you are not sure of the exact words, do not quote at all. Never invent something they did not say. Never mention numbers or percentages.
- focus_word: EXACTLY ONE word chosen from allowed_focus_words. Never any other word.
- model_sentence_en (English, max 60 chars): one short, natural sentence using focus_word, close to the exercise content. Simple words a child can repeat.
- tiny_challenge_vi (Vietnamese, max 140 chars): one tiny, concrete thing to try next time (speak louder at the end, pause between sentences, try the focus word in a new sentence). Never negative, never a number, never more than one thing.
- recast_en (English, max 80 chars): ONLY if the transcript contains a clear grammar slip, write the corrected version of that one phrase naturally. Otherwise omit this key entirely.
- Mention pronunciation ONLY if pronunciation data is provided, and only in words ("rõ ràng", "trôi chảy"), never numbers.
- If near_miss_words is provided, each entry means the child said a real word ("said") that does not match the homework's own word ("nearest") but sounds close to it — the child was NOT wrong to try, they likely meant the homework word. When this happens: prefer focus_word = the "nearest" value, ALWAYS include recast_en modeling that homework word naturally in place of what was said, and never say the child made a mistake.
- Never mention: being an AI, scores, the transcript itself, personal information, anything outside this exercise.`;

// ---------------------------------------------------------------------------
// 3. parseFeedback
// ---------------------------------------------------------------------------

// Same fence-strip approach as _minny-convo.js's parseModelReply (strip a
// leading/trailing ```json ... ``` fence before JSON.parse).
const FENCE_PATTERN = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

export function parseFeedback(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  const fenced = text.match(FENCE_PATTERN);
  if (fenced) text = fenced[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const allowedKeys = new Set(['praise_vi', 'focus_word', 'model_sentence_en', 'tiny_challenge_vi', 'recast_en']);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) return null; // reject anything else
  }

  const str = (value) => (typeof value === 'string' ? value.trim() : null);

  const praise_vi = str(parsed.praise_vi);
  const focus_word = str(parsed.focus_word);
  const model_sentence_en = str(parsed.model_sentence_en);
  const tiny_challenge_vi = str(parsed.tiny_challenge_vi);

  if (!praise_vi || praise_vi.length > MAX_PRAISE_VI) return null;
  if (!focus_word || focus_word.length > MAX_FOCUS_WORD) return null;
  if (!model_sentence_en || model_sentence_en.length > MAX_MODEL_SENTENCE_EN) return null;
  if (!tiny_challenge_vi || tiny_challenge_vi.length > MAX_TINY_CHALLENGE_VI) return null;

  const result = { praise_vi, focus_word, model_sentence_en, tiny_challenge_vi };

  if (Object.prototype.hasOwnProperty.call(parsed, 'recast_en')) {
    const recast_en = str(parsed.recast_en);
    // JSON-mode models routinely emit "" instead of omitting an optional key
    // (Elon fix, 2026-07-12: this null-rejected every otherwise-valid
    // feedback whose model chose not to recast) — treat empty as absent.
    if (recast_en) {
      if (recast_en.length > MAX_RECAST_EN) return null;
      result.recast_en = recast_en;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. validateFeedbackGrounding — deterministic, pure. The heart of the fence.
//
// Buffet red-team fix round (2026-07-12, Elon rulings, 3 MUST-FIXes):
//   1. Unpaired/mismatched quote characters must reject, not just be
//      silently ignored by the extraction regex (a lone opening quote, or a
//      "two openers, one closer" curly-quote mismatch, previously let the
//      naive greedy regex swallow one real quote boundary and silently drop
//      an ungrounded fragment from the check).
//   2. The number filter is now \p{Nd} (every Unicode decimal-digit script,
//      not just ASCII 0-9 — fullwidth/Arabic-Indic digits used to slip
//      through) plus a same-meaning-different-spelling check for '%',
//      'phần trăm', 'percent' (a spelled-out percentage is still a leaked
//      score even with zero digit characters).
//   3. recast_en now has its own grounding check: a fabricated sentence
//      unrelated to what the kid actually said must reject, not just pass
//      through untouched because it isn't Vietnamese/isn't a quote.
// ---------------------------------------------------------------------------

// Straight and curly quotes are checked as two SEPARATE, same-style pairs
// (never a straight-open/curly-close mix) — this is what makes the
// "two openers, one closer" mismatch a clean, unambiguous count check below
// rather than something a greedy cross-style regex has to disambiguate.
const STRAIGHT_QUOTE_PATTERN = /"([^"]*)"/g;
const CURLY_QUOTE_PATTERN = /“([^”]*)”/g;

const DIGIT_PATTERN = /\p{Nd}/u; // every Unicode decimal-digit script (fullwidth, Arabic-Indic, ...)
const PERCENT_PATTERN = /%|phần trăm|percent/iu;

// Removes exactly the matched spans (by index, not by string value — so two
// identical quoted fragments each get removed once, not the same occurrence
// twice) and returns what's left.
function stripMatchedSpans(text, matches) {
  let result = '';
  let cursor = 0;
  for (const m of matches) {
    result += text.slice(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  return result + text.slice(cursor);
}

// Every double-quoted fragment must (a) form a real, same-style pair — an
// odd count of ASCII " or an unequal count of curly “/” rejects outright —
// and (b) exist case-insensitively in the transcript. After removing every
// matched pair, zero quote characters may remain; if any do, some quote
// character was left unaccounted for (the old bug) and this rejects too.
function quotesAreGrounded(text, transcriptLower) {
  const straightCount = (text.match(/"/g) || []).length;
  if (straightCount % 2 !== 0) return false;
  const openCurlyCount = (text.match(/“/g) || []).length;
  const closeCurlyCount = (text.match(/”/g) || []).length;
  if (openCurlyCount !== closeCurlyCount) return false;

  const matches = [...text.matchAll(STRAIGHT_QUOTE_PATTERN), ...text.matchAll(CURLY_QUOTE_PATTERN)]
    .sort((a, b) => a.index - b.index);
  for (const m of matches) {
    const quote = m[1].trim().toLowerCase();
    if (!quote || !transcriptLower.includes(quote)) return false;
  }

  const remainder = stripMatchedSpans(text, matches);
  if (/["“”]/.test(remainder)) return false;

  return true;
}

// A real recast corrects the kid's own phrase, so most of its content words
// (normalized, minus the caller's SKIP_WORDS) should already be present in
// what the kid said. A fabricated sentence about something the kid never
// said will share few or no words with the transcript. "At least half"
// checked as overlap*2 >= count to avoid float rounding.
function recastIsGrounded(recastEn, transcript, skipWords) {
  const skip = skipWords instanceof Set ? skipWords : new Set();
  const recastWords = String(recastEn || '')
    .split(/\s+/)
    .map((w) => normalizePracticeWord(w))
    .filter((w) => w && !skip.has(w));
  if (!recastWords.length) return false; // nothing left to check -> can't ground it

  const transcriptWords = new Set(
    String(transcript || '').split(/\s+/).map((w) => normalizePracticeWord(w)).filter(Boolean),
  );
  const overlapCount = recastWords.filter((w) => transcriptWords.has(w)).length;
  return overlapCount * 2 >= recastWords.length;
}

export function validateFeedbackGrounding(feedback, { transcript, allowedFocusWords, skipWords } = {}) {
  if (!feedback || typeof feedback !== 'object') return false;
  const { praise_vi, focus_word, model_sentence_en, tiny_challenge_vi, recast_en } = feedback;

  if (typeof praise_vi !== 'string' || !praise_vi || praise_vi.length > MAX_PRAISE_VI) return false;
  if (typeof focus_word !== 'string' || !focus_word || focus_word.length > MAX_FOCUS_WORD) return false;
  if (typeof model_sentence_en !== 'string' || !model_sentence_en || model_sentence_en.length > MAX_MODEL_SENTENCE_EN) return false;
  if (typeof tiny_challenge_vi !== 'string' || !tiny_challenge_vi || tiny_challenge_vi.length > MAX_TINY_CHALLENGE_VI) return false;
  if (recast_en !== undefined && (typeof recast_en !== 'string' || !recast_en || recast_en.length > MAX_RECAST_EN)) return false;

  // focus_word must be exactly one of the allowed words.
  const allowed = new Set(Array.isArray(allowedFocusWords) ? allowedFocusWords : []);
  const normalizedFocus = normalizePracticeWord(focus_word);
  if (!normalizedFocus || !allowed.has(normalizedFocus)) return false;

  // Every quoted fragment in praise_vi must exist, case-insensitively, in
  // the transcript — this is the deterministic anti-hallucination gate.
  const transcriptLower = String(transcript || '').toLowerCase();
  if (!quotesAreGrounded(praise_vi, transcriptLower)) return false;
  // Buffet re-verify round (2026-07-12): the founder rule is "every claim in
  // the feedback", not "every claim in praise_vi" -- a fabricated quote in
  // the challenge field is the same bug class, so it gets the same fence.
  if (!quotesAreGrounded(tiny_challenge_vi, transcriptLower)) return false;

  // Never a number (any script) or a spelled-out percentage in the
  // Vietnamese fields (V1-D1: never invent/leak scores).
  if (DIGIT_PATTERN.test(praise_vi) || DIGIT_PATTERN.test(tiny_challenge_vi)) return false;
  if (PERCENT_PATTERN.test(praise_vi) || PERCENT_PATTERN.test(tiny_challenge_vi)) return false;

  // recast_en must itself be grounded in what the kid actually said.
  if (recast_en !== undefined && !recastIsGrounded(recast_en, transcript, skipWords)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// 5. generateHomeworkFeedback — one OpenRouter JSON-mode call, no retry.
// ---------------------------------------------------------------------------

// Never throws. Returns the validated feedback object or null on ANY
// failure (no key, empty focus pool, fetch error/timeout, non-2xx, parse
// failure, or a grounding-validator rejection). Per spec: one attempt only
// — a miss is a silent omission, never retried (unlike minny-conversation's
// two-attempt convo brain, which a human is waiting on live; here the
// deterministic panel already rendered, so there is nothing to retry for).
export async function generateHomeworkFeedback({ env, context, fetchFn = fetch, skipWords } = {}) {
  try {
    if (!context || !Array.isArray(context.allowed_focus_words) || !context.allowed_focus_words.length) {
      return null; // no valid focus word can ever be chosen — don't spend the call
    }
    const apiKey = env?.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    const messages = [
      { role: 'system', content: FEEDBACK_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(context) },
    ];

    const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: FEEDBACK_MODEL,
        provider: FEEDBACK_PROVIDER,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.8,
      }),
      // 4s, same reasoning as minny-conversation.js's CONVO call: a
      // Groq/Cerebras-class host answers this size of reply well inside 4s;
      // past that, treat it as a miss (no retry) rather than make a kid who
      // already sees their deterministic result wait on a coach note.
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const feedback = parseFeedback(raw);
    if (!feedback) return null;

    const grounded = validateFeedbackGrounding(feedback, {
      transcript: context.transcript,
      allowedFocusWords: context.allowed_focus_words,
      skipWords,
    });
    return grounded ? feedback : null;
  } catch {
    return null;
  }
}
