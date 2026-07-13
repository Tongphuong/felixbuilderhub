import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFeedbackContext,
  FEEDBACK_SYSTEM_PROMPT,
  parseFeedback,
  validateFeedbackGrounding,
  generateHomeworkFeedback,
} from '../functions/api/_homework-feedback.js';
import { onRequestPost, scoreTranscript, SKIP_WORDS } from '../functions/api/read2lead-speaking-check.js';

// ---------------------------------------------------------------------------
// buildFeedbackContext
// ---------------------------------------------------------------------------

test('buildFeedbackContext (read mode): packages deterministic outcome + homework text from word_feedback', () => {
  const result = { ...scoreTranscript('The cat is happy', 'the cat is happy'), check_mode: 'read' };
  const context = buildFeedbackContext({
    checkMode: 'read',
    result,
    transcript: 'the cat is happy',
    homework: { note_vi: 'Học thuộc câu này nhé' },
    azure: null,
    skipWords: SKIP_WORDS,
  });
  assert.equal(context.exercise_type, 'read');
  assert.equal(context.homework.note_vi, 'Học thuộc câu này nhé');
  assert.equal(context.homework.text, 'cat happy', 'expected text derived from word_feedback, SKIP_WORDS (the/is) already excluded upstream');
  assert.equal(context.outcome.score_percent, 100);
  assert.deepEqual(context.outcome.words_missed, []);
  assert.deepEqual(context.outcome.words_close, []);
  assert.equal(context.outcome.rubric, null, 'rubric is frame-only');
  assert.equal(context.azure, null);
  assert.equal(context.transcript, 'the cat is happy');
});

test('buildFeedbackContext: allowed_focus_words = missed ∪ close ∪ pronunciation weak words when non-empty', () => {
  const result = { words_missed: ['banana.'], words_close: ['DOG'], pronunciation: { words: [{ word: 'RAN', accuracy_percent: 40 }] } };
  const context = buildFeedbackContext({ checkMode: 'read', result, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.deepEqual([...context.allowed_focus_words].sort(), ['banana', 'dog', 'ran']);
});

test('buildFeedbackContext: kid did great (nothing missed/close/weak) falls back to homework content words, minus SKIP_WORDS', () => {
  const result = { words_missed: [], words_close: [], word_feedback: [{ expected: 'cat' }, { expected: 'happy' }] };
  const context = buildFeedbackContext({ checkMode: 'read', result, transcript: 'the cat is happy', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.deepEqual([...context.allowed_focus_words].sort(), ['cat', 'happy']);
});

test('buildFeedbackContext (frame mode): homework text from result.stems; rubric booleans surfaced', () => {
  const result = {
    matchPct: 40,
    rubric: { spokeAllStems: false, durationOnTarget: true, spokeClearly: true },
    stems: [{ id: 'f1', text_en: 'I ate breakfast.', matched: true, coveragePct: 100 }],
  };
  const context = buildFeedbackContext({ checkMode: 'frame', result, transcript: 'i ate breakfast', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.equal(context.exercise_type, 'frame');
  assert.equal(context.homework.text, 'I ate breakfast.');
  assert.equal(context.outcome.score_percent, 40);
  assert.deepEqual(context.outcome.rubric, { spoke_all_stems: false, duration_on_target: true, spoke_clearly: true });
  // Fallback fires because scoreSpeechFrame never produces words_missed/words_close.
  assert.deepEqual([...context.allowed_focus_words].sort(), ['ate', 'breakfast', 'i']);
});

test('buildFeedbackContext (photo_talk, no reference text): fallback uses the transcript itself', () => {
  const result = { words_missed: [], words_close: [] };
  const context = buildFeedbackContext({ checkMode: 'open', result, transcript: 'I saw a big dog today', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.equal(context.exercise_type, 'photo_talk');
  assert.equal(context.homework.text, '', 'no reference text exists for photo-only homework');
  assert.deepEqual([...context.allowed_focus_words].sort(), ['big', 'dog', 'i', 'saw', 'today']);
});

test('buildFeedbackContext: empty transcript + nothing missed/close + no homework text -> empty allowed_focus_words (never crashes)', () => {
  const context = buildFeedbackContext({ checkMode: 'read', result: { words_missed: [], words_close: [] }, transcript: '', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.deepEqual(context.allowed_focus_words, []);
});

test('buildFeedbackContext: taskType (from the compiled step) overrides the check_mode-derived exercise_type', () => {
  const result = { words_missed: [], words_close: [] };
  const withTaskType = buildFeedbackContext({ checkMode: 'frame', result, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS, taskType: 'story' });
  assert.equal(withTaskType.exercise_type, 'story');
});

test('buildFeedbackContext: falls back to the current check_mode derivation when taskType is absent (untouched caller stays correct)', () => {
  const result = { words_missed: [], words_close: [] };
  const readCtx = buildFeedbackContext({ checkMode: 'read', result, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.equal(readCtx.exercise_type, 'read');
  const frameCtx = buildFeedbackContext({ checkMode: 'frame', result: { stems: [] }, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.equal(frameCtx.exercise_type, 'frame');
  const openCtx = buildFeedbackContext({ checkMode: 'open', result, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.equal(openCtx.exercise_type, 'photo_talk');
});

test('buildFeedbackContext: target_words surfaces every stem anchor_words from the graded result (frame mode) — must_use/anchors/qa-stem all ride the same field', () => {
  const result = {
    matchPct: 80,
    stems: [
      { id: 'story', text_en: 'Tell a story.', anchor_words: ['because', 'friend', 'happy'] },
    ],
  };
  const context = buildFeedbackContext({ checkMode: 'frame', result, transcript: 'because my friend is happy', homework: null, azure: null, skipWords: SKIP_WORDS, taskType: 'story' });
  assert.deepEqual(context.target_words, ['because', 'friend', 'happy']);
});

test('buildFeedbackContext: target_words is empty for read/open modes (no anchor-word concept there)', () => {
  const readCtx = buildFeedbackContext({ checkMode: 'read', result: { words_missed: [], words_close: [] }, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.deepEqual(readCtx.target_words, []);
  const openCtx = buildFeedbackContext({ checkMode: 'open', result: { words_missed: [], words_close: [] }, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.deepEqual(openCtx.target_words, []);
});

test('buildFeedbackContext: target_words does not widen the focus_word grounding fence (allowed_focus_words derivation is unchanged)', () => {
  // A picture task's anchors are hidden from the kid; even though they now
  // surface in target_words for the coach note, they must NOT become a new
  // source for allowed_focus_words (the set validateFeedbackGrounding
  // actually checks focus_word against).
  const result = { stems: [{ id: 'picture', text_en: '', anchor_words: ['dog', 'park'] }] };
  const context = buildFeedbackContext({ checkMode: 'frame', result, transcript: 'i saw a cat', homework: null, azure: null, skipWords: SKIP_WORDS, taskType: 'picture' });
  assert.deepEqual(context.target_words, ['dog', 'park']);
  // allowed_focus_words is untouched by target_words: nothing missed/close,
  // no homework/stem text, and the transcript-fallback path is 'open'-only
  // (frame mode has no reference text to fall back to) -- so it stays
  // empty rather than silently picking up 'dog'/'park' from target_words.
  assert.deepEqual(context.allowed_focus_words, []);
});

test('buildFeedbackContext: azure block passed through only when accuracy_percent is a finite number, capped to 3 words', () => {
  const withAzure = buildFeedbackContext({
    checkMode: 'frame',
    result: { stems: [] },
    transcript: 't',
    homework: null,
    azure: { accuracy_percent: 72, fluency_percent: 80, words: [{ word: 'a', accuracy_percent: 1 }, { word: 'b', accuracy_percent: 2 }, { word: 'c', accuracy_percent: 3 }, { word: 'd', accuracy_percent: 4 }] },
    skipWords: SKIP_WORDS,
  });
  assert.deepEqual(withAzure.azure, { accuracy_percent: 72, fluency_percent: 80, words: [{ word: 'a', accuracy_percent: 1 }, { word: 'b', accuracy_percent: 2 }, { word: 'c', accuracy_percent: 3 }] });

  const withoutAzure = buildFeedbackContext({ checkMode: 'frame', result: { stems: [] }, transcript: 't', homework: null, azure: null, skipWords: SKIP_WORDS });
  assert.equal(withoutAzure.azure, null);

  const malformedAzure = buildFeedbackContext({ checkMode: 'frame', result: { stems: [] }, transcript: 't', homework: null, azure: { words: [] }, skipWords: SKIP_WORDS });
  assert.equal(malformedAzure.azure, null, 'no accuracy_percent -> treated as absent');
});

// ---------------------------------------------------------------------------
// FEEDBACK_SYSTEM_PROMPT — pasted verbatim, never edited.
// ---------------------------------------------------------------------------

test('FEEDBACK_SYSTEM_PROMPT: carries the required JSON shape and the never-a-number rule', () => {
  assert.match(FEEDBACK_SYSTEM_PROMPT, /praise_vi/);
  assert.match(FEEDBACK_SYSTEM_PROMPT, /focus_word/);
  assert.match(FEEDBACK_SYSTEM_PROMPT, /model_sentence_en/);
  assert.match(FEEDBACK_SYSTEM_PROMPT, /tiny_challenge_vi/);
  assert.match(FEEDBACK_SYSTEM_PROMPT, /recast_en/);
  assert.match(FEEDBACK_SYSTEM_PROMPT, /Never mention numbers or percentages/);
});

// ---------------------------------------------------------------------------
// parseFeedback
// ---------------------------------------------------------------------------

test('parseFeedback: strict JSON, strips a markdown fence like parseModelReply does', () => {
  const raw = '```json\n{"praise_vi":"Con nói to rõ!","focus_word":"cat","model_sentence_en":"I like cats.","tiny_challenge_vi":"Lần sau nói to hơn nhé."}\n```';
  const parsed = parseFeedback(raw);
  assert.ok(parsed);
  assert.equal(parsed.focus_word, 'cat');
  assert.equal(parsed.recast_en, undefined);
});

test('parseFeedback: rejects non-JSON, arrays, and unknown keys', () => {
  assert.equal(parseFeedback('not json at all'), null);
  assert.equal(parseFeedback('[]'), null);
  assert.equal(parseFeedback(JSON.stringify(['a', 'b'])), null);
  assert.equal(parseFeedback(JSON.stringify({
    praise_vi: 'a', focus_word: 'cat', model_sentence_en: 'b', tiny_challenge_vi: 'c', extra_field: 'nope',
  })), null, 'an unexpected key rejects the whole object');
});

test('parseFeedback: enforces every length cap', () => {
  const base = { praise_vi: 'a', focus_word: 'cat', model_sentence_en: 'b', tiny_challenge_vi: 'c' };
  assert.ok(parseFeedback(JSON.stringify(base)));
  assert.equal(parseFeedback(JSON.stringify({ ...base, praise_vi: 'x'.repeat(141) })), null);
  assert.equal(parseFeedback(JSON.stringify({ ...base, focus_word: 'x'.repeat(41) })), null);
  assert.equal(parseFeedback(JSON.stringify({ ...base, model_sentence_en: 'x'.repeat(61) })), null);
  assert.equal(parseFeedback(JSON.stringify({ ...base, tiny_challenge_vi: 'x'.repeat(141) })), null);
  assert.equal(parseFeedback(JSON.stringify({ ...base, recast_en: 'x'.repeat(81) })), null);
  assert.ok(parseFeedback(JSON.stringify({ ...base, recast_en: 'x'.repeat(80) })), 'exactly at the cap is kept');
});

test('parseFeedback: missing a required field, or a non-string value, rejects', () => {
  assert.equal(parseFeedback(JSON.stringify({ focus_word: 'cat', model_sentence_en: 'b', tiny_challenge_vi: 'c' })), null);
  assert.equal(parseFeedback(JSON.stringify({ praise_vi: 'a', focus_word: 5, model_sentence_en: 'b', tiny_challenge_vi: 'c' })), null);
});

// ---------------------------------------------------------------------------
// validateFeedbackGrounding — the heart of the fence.
// ---------------------------------------------------------------------------

function feedback(overrides = {}) {
  return {
    praise_vi: 'Con nói rất tốt!',
    focus_word: 'cat',
    model_sentence_en: 'I like my cat.',
    tiny_challenge_vi: 'Lần sau nói to hơn nhé!',
    ...overrides,
  };
}

test('validateFeedbackGrounding: happy path passes', () => {
  assert.equal(validateFeedbackGrounding(feedback(), { transcript: 'the cat is happy', allowedFocusWords: ['cat', 'happy'] }), true);
});

test('validateFeedbackGrounding: ungrounded quote in praise_vi rejects', () => {
  const fb = feedback({ praise_vi: 'Con nói "the dog runs fast" rất tốt!' });
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: a quote that genuinely exists in the transcript (straight or curly quotes) passes', () => {
  const straight = feedback({ praise_vi: 'Con nói "the cat" rất rõ!' });
  assert.equal(validateFeedbackGrounding(straight, { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), true);
  const curly = feedback({ praise_vi: 'Con nói “the cat” rất rõ!' });
  assert.equal(validateFeedbackGrounding(curly, { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), true);
});

test('validateFeedbackGrounding: focus_word outside allowed set rejects', () => {
  const fb = feedback({ focus_word: 'elephant' });
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'the cat is happy', allowedFocusWords: ['cat', 'happy'] }), false);
});

test('validateFeedbackGrounding: empty allowedFocusWords always rejects', () => {
  assert.equal(validateFeedbackGrounding(feedback(), { transcript: 'the cat is happy', allowedFocusWords: [] }), false);
});

test('validateFeedbackGrounding: digits anywhere in praise_vi or tiny_challenge_vi reject', () => {
  assert.equal(validateFeedbackGrounding(feedback({ praise_vi: 'Con đạt 90% rồi!' }), { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), false);
  assert.equal(validateFeedbackGrounding(feedback({ tiny_challenge_vi: 'Thử lại 3 lần nhé!' }), { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: length caps re-checked independent of parseFeedback', () => {
  assert.equal(validateFeedbackGrounding(feedback({ praise_vi: 'x'.repeat(141) }), { transcript: 'x'.repeat(141), allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: malformed feedback object rejects', () => {
  assert.equal(validateFeedbackGrounding(null, { transcript: 't', allowedFocusWords: ['cat'] }), false);
  assert.equal(validateFeedbackGrounding({}, { transcript: 't', allowedFocusWords: ['cat'] }), false);
});

// ---------------------------------------------------------------------------
// Buffet red-team fix round (2026-07-12, Elon rulings, 3 MUST-FIXes). Buffet's
// literal payload strings live in his report (not reproduced verbatim here —
// not available to this session); the fixtures below are constructed to match
// his three described bug shapes exactly, for his re-verification pass.
// ---------------------------------------------------------------------------

// MUST-FIX 1: unpaired/mismatched quote characters must reject the whole
// feedback, not silently skip grounding for whatever they "quote". Before
// this fix, an extraction regex that requires both an opening AND a closing
// quote character to form any match meant a dangling quote produced ZERO
// matches -- the loop that checks each match had nothing to iterate, so the
// text after (or around) the dangling quote rode through completely
// unchecked while still *looking* quoted (implying a direct-quote claim) to
// whoever reads it.
test('validateFeedbackGrounding: a single unpaired opening quote (odd ASCII quote count) rejects', () => {
  const fb = feedback({ praise_vi: 'Con nói "giỏi lắm rất tốt' }); // one straight quote, never closed
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'giỏi lắm', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: two curly openers, one curly closer (greedy-span mismatch) rejects', () => {
  // Pre-fix bypass: the first "“xin chào”" pair closes correctly and passes
  // grounding, but the second, dangling “ before "tạm biệt" (an invented,
  // never-said claim) never formed a match under the old code -- it was
  // simply dropped, not checked -- so the whole string used to pass.
  const fb = feedback({ praise_vi: 'Con nói “xin chào” và “tạm biệt các bạn rất vui vẻ' });
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'xin chào các bạn', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: three straight quotes (one pair + one dangling) rejects instead of only checking the paired one', () => {
  const fb = feedback({ praise_vi: 'Con nói "hello" và "world rất tốt' });
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'hello there', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: well-formed, fully grounded quotes (straight and curly) still pass', () => {
  const straight = feedback({ praise_vi: 'Con nói "the cat" rất rõ!' });
  assert.equal(validateFeedbackGrounding(straight, { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), true);
  const curly = feedback({ praise_vi: 'Con nói “xin chào” rất tự tin!' });
  assert.equal(validateFeedbackGrounding(curly, { transcript: 'xin chào các bạn', allowedFocusWords: ['cat'] }), true);
  const twoSeparatePairs = feedback({ praise_vi: 'Con nói "hello" và "world" rất tốt!' });
  assert.equal(validateFeedbackGrounding(twoSeparatePairs, { transcript: 'hello world', allowedFocusWords: ['cat'] }), true);
});

// MUST-FIX 2: every Unicode decimal-digit script, plus spelled-out percent.
test('validateFeedbackGrounding: fullwidth digits reject (not just ASCII 0-9)', () => {
  const fb = feedback({ praise_vi: 'Con đạt ９０ điểm rồi!' }); // fullwidth 9, 0
  assert.equal(validateFeedbackGrounding(fb, { transcript: 't', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: Arabic-Indic digits reject', () => {
  const fb = feedback({ tiny_challenge_vi: 'Con đạt ٩٠ điểm rồi nhé!' }); // Arabic-Indic 9, 0
  assert.equal(validateFeedbackGrounding(fb, { transcript: 't', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: spelled-out percentage rejects even with zero digit characters', () => {
  const fb = feedback({ praise_vi: 'Con đạt một trăm phần trăm rồi!' }); // "one hundred percent", no digits at all
  assert.equal(validateFeedbackGrounding(fb, { transcript: 't', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: bare "%" and English "percent" leaking into a VI field both reject', () => {
  assert.equal(validateFeedbackGrounding(feedback({ praise_vi: 'Con đạt 100% rồi!' }), { transcript: 't', allowedFocusWords: ['cat'] }), false);
  assert.equal(validateFeedbackGrounding(feedback({ tiny_challenge_vi: 'Con đạt full percent rồi!' }), { transcript: 't', allowedFocusWords: ['cat'] }), false);
});

test('validateFeedbackGrounding: ordinary Vietnamese number WORDS (không score-shaped) are not banned -- "một chút" still passes', () => {
  const fb = feedback({ tiny_challenge_vi: 'Lần sau nói to hơn một chút nhé!' });
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'the cat is happy', allowedFocusWords: ['cat'] }), true);
});

// MUST-FIX 3: recast_en must itself be grounded in what the kid actually said.
test('validateFeedbackGrounding: a fabricated recast_en unrelated to the transcript rejects (Buffet\'s off-topic-claim shape)', () => {
  const fb = feedback({ recast_en: 'John hit me at school yesterday' });
  const dogTopicTranscript = 'i have a big dog he is very fluffy and brown';
  assert.equal(validateFeedbackGrounding(fb, { transcript: dogTopicTranscript, allowedFocusWords: ['cat'], skipWords: SKIP_WORDS }), false);
});

test('validateFeedbackGrounding: a genuine recast (same phrase, grammar fixed) passes -- at least half its content words overlap', () => {
  const fb = feedback({ recast_en: 'I went to school' });
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'i go to school yesterday', allowedFocusWords: ['cat'], skipWords: SKIP_WORDS }), true);
});

test('validateFeedbackGrounding: recast_en that normalizes to nothing but SKIP_WORDS rejects (empty content-word set)', () => {
  const fb = feedback({ recast_en: 'to at on' }); // every token is in SKIP_WORDS
  assert.equal(validateFeedbackGrounding(fb, { transcript: 'to at on and more words here', allowedFocusWords: ['cat'], skipWords: SKIP_WORDS }), false);
});

test('validateFeedbackGrounding: recast_en check is skipped entirely when the key is absent (unchanged happy path)', () => {
  assert.equal(validateFeedbackGrounding(feedback(), { transcript: 'the cat is happy', allowedFocusWords: ['cat', 'happy'], skipWords: SKIP_WORDS }), true);
});

// ---------------------------------------------------------------------------
// generateHomeworkFeedback — one OpenRouter call, no retry, never throws.
// ---------------------------------------------------------------------------

function baseContext(overrides = {}) {
  return {
    exercise_type: 'read',
    homework: { note_vi: '', text: 'cat happy' },
    outcome: { score_percent: 100, words_missed: [], words_close: [], rubric: null },
    azure: null,
    transcript: 'the cat is happy',
    allowed_focus_words: ['cat', 'happy'],
    ...overrides,
  };
}

function openRouterResponse(contentObj) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(contentObj) } }] }), { status: 200 });
}

test('generateHomeworkFeedback: no OPENROUTER_API_KEY -> null, never fetches', async () => {
  let called = false;
  const result = await generateHomeworkFeedback({ env: {}, context: baseContext(), fetchFn: async () => { called = true; } });
  assert.equal(result, null);
  assert.equal(called, false);
});

test('generateHomeworkFeedback: empty allowed_focus_words -> null, never spends the call', async () => {
  let called = false;
  const result = await generateHomeworkFeedback({
    env: { OPENROUTER_API_KEY: 'k' },
    context: baseContext({ allowed_focus_words: [] }),
    fetchFn: async () => { called = true; },
  });
  assert.equal(result, null);
  assert.equal(called, false, 'no valid focus word possible -- never worth spending the call');
});

test('generateHomeworkFeedback: happy path returns the validated, grounded feedback object', async () => {
  const result = await generateHomeworkFeedback({
    env: { OPENROUTER_API_KEY: 'k' },
    context: baseContext(),
    fetchFn: async () => openRouterResponse({
      praise_vi: 'Con nói "the cat" rất rõ ràng!',
      focus_word: 'cat',
      model_sentence_en: 'I like my cat.',
      tiny_challenge_vi: 'Lần sau nói to hơn xíu nhé!',
    }),
  });
  assert.deepEqual(result, {
    praise_vi: 'Con nói "the cat" rất rõ ràng!',
    focus_word: 'cat',
    model_sentence_en: 'I like my cat.',
    tiny_challenge_vi: 'Lần sau nói to hơn xíu nhé!',
  });
});

test('generateHomeworkFeedback: HTTP 500 -> null', async () => {
  const result = await generateHomeworkFeedback({
    env: { OPENROUTER_API_KEY: 'k' },
    context: baseContext(),
    fetchFn: async () => new Response('server error', { status: 500 }),
  });
  assert.equal(result, null);
});

test('generateHomeworkFeedback: timeout/network throw -> null, never throws itself', async () => {
  await assert.doesNotReject(async () => {
    const result = await generateHomeworkFeedback({
      env: { OPENROUTER_API_KEY: 'k' },
      context: baseContext(),
      fetchFn: async () => { const err = new Error('aborted'); err.name = 'TimeoutError'; throw err; },
    });
    assert.equal(result, null);
  });
});

test('generateHomeworkFeedback: garbage (unparsable) model output -> null', async () => {
  const result = await generateHomeworkFeedback({
    env: { OPENROUTER_API_KEY: 'k' },
    context: baseContext(),
    fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all, sorry' } }] }), { status: 200 }),
  });
  assert.equal(result, null);
});

test('generateHomeworkFeedback: ungrounded quote from the model -> null (validator catches what parsing alone would not)', async () => {
  const result = await generateHomeworkFeedback({
    env: { OPENROUTER_API_KEY: 'k' },
    context: baseContext(),
    fetchFn: async () => openRouterResponse({
      praise_vi: 'Con nói "I love dogs" rất tốt!', // never in the transcript
      focus_word: 'cat',
      model_sentence_en: 'I like my cat.',
      tiny_challenge_vi: 'Lần sau nói to hơn nhé!',
    }),
  });
  assert.equal(result, null);
});

test('generateHomeworkFeedback: focus_word outside allowed set from the model -> null', async () => {
  const result = await generateHomeworkFeedback({
    env: { OPENROUTER_API_KEY: 'k' },
    context: baseContext(),
    fetchFn: async () => openRouterResponse({
      praise_vi: 'Con nói rất tốt!',
      focus_word: 'elephant',
      model_sentence_en: 'I like elephants.',
      tiny_challenge_vi: 'Lần sau nói to hơn nhé!',
    }),
  });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Endpoint-level (onRequestPost): the PROTECTED call site's guardrail
// screening and the byte-identical-on-failure guarantee.
// ---------------------------------------------------------------------------

function makeCodeKv(seed) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts = [];
  return {
    puts,
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

function homeworkCodeData() {
  return {
    progress: { current_pack: { pack_id: 'pack-1' } },
    homework: {
      schema_version: 2,
      note_vi: 'Học thuộc câu này nhé',
      sentences: [{ id: 's1', text_en: 'The cat is happy', hint_vi: null }],
      frame: null,
      photo: null,
      photo_talk: null,
    },
  };
}

function fakeAiSpeaking(transcriptText) {
  return { async run(model) { return String(model).includes('llama-guard') ? 'safe' : { text: transcriptText }; } };
}

async function postHomeworkRead({ env, transcriptText }) {
  const formData = new FormData();
  formData.append('access_code', 'r2l-hw-0001');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'The cat is happy');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');
  return onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
    env: {
      READ2LEAD_CODES: makeCodeKv({ 'R2L-HW-0001': homeworkCodeData() }),
      AI: fakeAiSpeaking(transcriptText),
      ...env,
    },
  });
}

test('onRequestPost: no OPENROUTER_API_KEY -> no coach key (today\'s baseline)', async () => {
  const response = await postHomeworkRead({ env: {}, transcriptText: 'the cat is happy' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.coach, undefined);
  assert.equal(payload.score_percent, 100);
});

test('onRequestPost: OPENROUTER_API_KEY present but LLM 500/timeout/garbage -> result byte-identical to the no-key baseline, no coach key', async () => {
  const baselineResponse = await postHomeworkRead({ env: {}, transcriptText: 'the cat is happy' });
  const baseline = await baselineResponse.json();

  const originalFetch = globalThis.fetch;
  try {
    const variants = [
      async () => new Response('server error', { status: 500 }),
      async () => { const err = new Error('aborted'); err.name = 'TimeoutError'; throw err; },
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }),
    ];
    for (const fetchImpl of variants) {
      globalThis.fetch = fetchImpl;
      const response = await postHomeworkRead({ env: { OPENROUTER_API_KEY: 'or-key' }, transcriptText: 'the cat is happy' });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.coach, undefined, 'a failed/garbage LLM attempt must never surface a coach key');
      assert.deepEqual(payload, baseline, 'the deterministic result must be byte-identical to today on any feedback failure');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: a banned word in any feedback field is rejected by the guardrail stack -> no coach key', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              praise_vi: 'Con nói rất tốt!',
              focus_word: 'cat',
              model_sentence_en: 'The cat is an asshole.',
              tiny_challenge_vi: 'Lần sau nói to hơn nhé!',
            }),
          },
        }],
      }), { status: 200 });
    };
    const response = await postHomeworkRead({ env: { OPENROUTER_API_KEY: 'or-key' }, transcriptText: 'the cat is happy' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.coach, undefined, 'the deterministic shape/topic guardrail must reject a banned word before it ever reaches the kid');
    assert.equal(payload.score_percent, 100, 'deterministic scoring is unaffected');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: happy path attaches result.coach on top of the unchanged deterministic fields', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            praise_vi: 'Con nói "the cat" rất rõ ràng!',
            focus_word: 'cat',
            model_sentence_en: 'I like my cat.',
            tiny_challenge_vi: 'Lần sau nói to hơn xíu nhé!',
          }),
        },
      }],
    }), { status: 200 });

    const baselineResponse = await postHomeworkRead({ env: {}, transcriptText: 'the cat is happy' });
    const baseline = await baselineResponse.json();

    const response = await postHomeworkRead({ env: { OPENROUTER_API_KEY: 'or-key' }, transcriptText: 'the cat is happy' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.coach);
    assert.deepEqual(payload.coach, {
      praise_vi: 'Con nói "the cat" rất rõ ràng!',
      focus_word: 'cat',
      model_sentence_en: 'I like my cat.',
      tiny_challenge_vi: 'Lần sau nói to hơn xíu nhé!',
    });
    const { coach, ...withoutCoach } = payload;
    assert.deepEqual(withoutCoach, baseline, 'every deterministic field is unchanged; coach is purely additive');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Steve's UI review (2026-07-12): on the kid-did-great path, focus_word
// comes from the allowed_focus_words FALLBACK (homework content words), so
// it was never in the flagged-words:<code> KV record collectFlaggedWords
// wrote (nothing was missed/close, so that first write is skipped
// entirely) -- minny-voice's `word` branch would silently 403 the tap.
test('onRequestPost: kid-did-great (nothing flagged) still merges the coach\'s fallback focus_word into flagged-words KV, so tap-to-hear works', async () => {
  const originalFetch = globalThis.fetch;
  const kv = makeCodeKv({ 'R2L-HW-0001': homeworkCodeData() });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            praise_vi: 'Con nói "the cat" rất rõ ràng!',
            focus_word: 'cat', // from the fallback set (homework content words), not words_missed/close
            model_sentence_en: 'I like my cat.',
            tiny_challenge_vi: 'Lần sau nói to hơn xíu nhé!',
          }),
        },
      }],
    }), { status: 200 });

    const response = await onRequestPost({
      request: (() => {
        const formData = new FormData();
        formData.append('access_code', 'r2l-hw-0001');
        formData.append('pack_id', 'pack-1');
        formData.append('expected_text', 'The cat is happy');
        formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');
        return new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData });
      })(),
      env: { READ2LEAD_CODES: kv, AI: fakeAiSpeaking('the cat is happy'), OPENROUTER_API_KEY: 'or-key' },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.score_percent, 100, 'sanity: perfect score -> nothing missed/close');
    assert.ok(payload.coach, 'sanity: coach feedback attached');

    const flagPuts = kv.puts.filter((p) => p.key === 'flagged-words:R2L-HW-0001');
    assert.equal(flagPuts.length, 1, 'the deterministic collectFlaggedWords write is skipped (nothing flagged); only the coach merge writes');
    assert.deepEqual(JSON.parse(flagPuts[0].value).words, ['cat'], 'the fallback focus_word is merged in so minny-voice\'s word branch allows the tap');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: when focus_word is already an actually-flagged word, the merge write is skipped (no redundant duplicate put)', async () => {
  const originalFetch = globalThis.fetch;
  const kv = makeCodeKv({ 'R2L-HW-0001': homeworkCodeData() });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            praise_vi: 'Con thử lại tốt hơn nhé!',
            focus_word: 'happy', // one of the actually-missed words below
            model_sentence_en: 'I feel happy.',
            tiny_challenge_vi: 'Lần sau nói to hơn xíu nhé!',
          }),
        },
      }],
    }), { status: 200 });

    const response = await onRequestPost({
      request: (() => {
        const formData = new FormData();
        formData.append('access_code', 'r2l-hw-0001');
        formData.append('pack_id', 'pack-1');
        formData.append('expected_text', 'The cat is happy');
        formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');
        return new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData });
      })(),
      env: { READ2LEAD_CODES: kv, AI: fakeAiSpeaking('the cat is'), OPENROUTER_API_KEY: 'or-key' }, // "happy" missed
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.words_missed.includes('happy'), 'sanity: "happy" is genuinely missed this attempt');
    assert.ok(payload.coach);

    const flagPuts = kv.puts.filter((p) => p.key === 'flagged-words:R2L-HW-0001');
    assert.equal(flagPuts.length, 1, 'only the original collectFlaggedWords write happens -- focus_word was already in it, so no second write');
    assert.deepEqual(JSON.parse(flagPuts[0].value).words, ['happy']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: no homework on the code record -> feedback never attempted, even with a key (never leaks into plain R2L reading)', async () => {
  const formData = new FormData();
  formData.append('access_code', 'r2l-plain-0001');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'The cat is happy');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
    const response = await onRequestPost({
      request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
      env: {
        READ2LEAD_CODES: makeCodeKv({ 'R2L-PLAIN-0001': { progress: { current_pack: { pack_id: 'pack-1' } } } }),
        AI: fakeAiSpeaking('the cat is happy'),
        OPENROUTER_API_KEY: 'or-key',
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.coach, undefined);
    assert.equal(fetchCalled, false, 'no homework block -> feedback is never attempted, so the OpenRouter fetch is never made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('validateFeedbackGrounding: a fabricated quote in tiny_challenge_vi rejects (Buffet re-verify payload -- same fence as praise_vi)', () => {
  const feedback = {
    praise_vi: 'Con đọc to và rõ ràng lắm!',
    focus_word: 'dog',
    model_sentence_en: 'I have a dog.',
    tiny_challenge_vi: 'Lần sau nhớ nói "con không thích học tiếng Anh" cho rõ hơn nhé!',
  };
  assert.equal(
    validateFeedbackGrounding(feedback, { transcript: 'i have a dog at home', allowedFocusWords: ['dog'], skipWords: new Set(['a', 'i']) }),
    false,
  );
});

test('buildFeedbackContext: perfect read (nothing missed) still yields allowed_focus_words from the real result words[] + homework block (regression: word_feedback field never existed)', () => {
  const context = buildFeedbackContext({
    checkMode: 'read',
    result: { check_mode: 'read', score_percent: 97, words_missed: [], words_close: [], words: [{ word: 'Hello', status: 'ok' }, { word: 'together', status: 'ok' }] },
    transcript: 'hello we play together',
    homework: { note_vi: 'x', sentences: [{ id: 's1', text_en: 'We play together in the garden' }] },
    azure: null,
    skipWords: new Set(['we', 'in', 'the']),
  });
  assert.ok(context.allowed_focus_words.length >= 3, 'fallback pool is populated');
  assert.ok(context.allowed_focus_words.includes('together'));
  assert.ok(context.allowed_focus_words.includes('garden'));
});

test('parseFeedback: recast_en as an EMPTY string is treated as absent, not a rejection (JSON-mode models emit "" instead of omitting)', () => {
  const parsed = parseFeedback(JSON.stringify({
    praise_vi: 'Con đọc rất tốt!', focus_word: 'dog', model_sentence_en: 'I have a dog.',
    tiny_challenge_vi: 'Con thử nói to hơn nhé', recast_en: '',
  }));
  assert.ok(parsed, 'parses successfully');
  assert.equal('recast_en' in parsed, false, 'empty recast dropped, not kept');
});
