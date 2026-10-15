// tests/minny-conversation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickStarterTopic,
  buildSystemPrompt,
  parseModelReply,
  coerceReply,
  sessionCapsExceeded,
  nextSession,
  gateReplyForLevel,
  isBeginnerLevel,
  LEVEL_REGISTER,
  STARTER_TOPICS,
  TOPIC_SEEDS,
  DEBATE_TOPICS,
  GAMES,
} from '../functions/api/_minny-convo.js';

import { findPhrase, fillPhrase } from '../functions/api/_minny-phrases.js';
import { isVietnamese, isLowContent, matchesExpected, nextRepairStep } from '../functions/api/_minny-repair.js';
import { wordSimilarity } from '../functions/api/read2lead-speaking-check.js';

import { onRequestPost } from '../functions/api/minny-conversation.js';

// ---------------------------------------------------------------------------
// Helper: create an in-memory KV mock that mirrors Cloudflare KV behaviour
// ---------------------------------------------------------------------------
function createFakeKv() {
  const store = new Map();
  return {
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts?.type === 'json') {
        return JSON.parse(raw);
      }
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

test('pickStarterTopic L1 indices 0 and 1 return two different L1 topics', () => {
  const t0 = pickStarterTopic('L1', 0);
  const t1 = pickStarterTopic('L1', 1);
  assert.notEqual(t0, t1);
  // both should be from the L1 topic list
  const l1Topics = STARTER_TOPICS.L1;
  assert.ok(l1Topics.includes(t0));
  assert.ok(l1Topics.includes(t1));
});

test('pickStarterTopic L1 index 2 wraps back to index 0', () => {
  const t0 = pickStarterTopic('L1', 0);
  const t2 = pickStarterTopic('L1', 2);
  assert.equal(t0, t2);
});

test('pickStarterTopic unknown level falls back to L3', () => {
  const t = pickStarterTopic('L9', 0);
  const l3Topics = STARTER_TOPICS.L3;
  assert.ok(l3Topics.includes(t));
});

test('buildSystemPrompt includes level register and starter topic', () => {
  const prompt = buildSystemPrompt('L1', 'their favorite color');
  assert.ok(prompt.includes(LEVEL_REGISTER.L1));
  assert.ok(prompt.includes('their favorite color'));
});

test('buildSystemPrompt unknown level falls back to L3 register', () => {
  const prompt = buildSystemPrompt('L9', 'x');
  assert.ok(prompt.includes(LEVEL_REGISTER.L3));
  assert.ok(prompt.includes('x'));
});



test('buildSystemPrompt persona is the red robot, never a koala', () => {
  // Minny is a red robot (the design mock's koala was a stand-in) — the
  // persona line must never regress or Minny tells kids she is a koala.
  const prompt = buildSystemPrompt('L3', 'their favorite food');
  assert.match(prompt, /red robot/);
  assert.doesNotMatch(prompt, /koala/i);
});

test('parseModelReply valid JSON returns object', () => {
  const result = parseModelReply('{"reply_en":"Hi there!","mood":"celebrate"}');
  assert.deepEqual(result, { reply_en: 'Hi there!', mood: 'celebrate' });
});

test('parseModelReply non-JSON returns null', () => {
  const result = parseModelReply('not json at all');
  assert.equal(result, null);
});

test('parseModelReply empty reply_en returns null', () => {
  const result = parseModelReply('{"reply_en":"","mood":"idle"}');
  assert.equal(result, null);
});

test('parseModelReply invalid mood returns null', () => {
  const result = parseModelReply('{"reply_en":"hi","mood":"angry"}');
  assert.equal(result, null);
});

test('parseModelReply markdown-fenced JSON still parses', () => {
  const result = parseModelReply('```json\n{"reply_en":"Hi!","mood":"idle"}\n```');
  assert.deepEqual(result, { reply_en: 'Hi!', mood: 'idle' });
});

test('coerceReply salvages JSON wrapped in prose', () => {
  const result = coerceReply('Sure thing! {"reply_en":"That sounds so fun!","mood":"celebrate"} Hope you like it.');
  assert.deepEqual(result, { reply_en: 'That sounds so fun!', mood: 'celebrate' });
});

test('coerceReply salvages loose JSON with a missing/invalid mood (defaults to idle)', () => {
  const result = coerceReply('{"reply_en":"Yay, cats!","mood":"happy"}');
  assert.deepEqual(result, { reply_en: 'Yay, cats!', mood: 'idle' });
});

test('coerceReply salvages a plain-prose reply with a speaker label', () => {
  const result = coerceReply('Minny: That sounds like a lot of fun!');
  assert.deepEqual(result, { reply_en: 'That sounds like a lot of fun!', mood: 'idle' });
});

test('coerceReply returns null on empty / non-string input', () => {
  assert.equal(coerceReply(''), null);
  assert.equal(coerceReply('   '), null);
  assert.equal(coerceReply(null), null);
  assert.equal(coerceReply(42), null);
});

test('coerceReply caps an over-long prose reply at a sentence boundary', () => {
  const long = 'This is fun. ' + 'x'.repeat(300);
  const result = coerceReply(long);
  assert.ok(result.reply_en.length <= 220);
});

test('coerceReply still finds valid JSON located after a long (>2000 char) preamble', () => {
  // Regression guard: a chatty fallback may ramble for thousands of chars
  // before emitting its JSON. The salvage must still find it, not deliver the
  // ramble as Minny's reply. (Caught by review of an earlier input-slice fix.)
  const ramble = 'Sure, I can help with that. '.repeat(90); // ~2500 chars
  const raw = ramble + '{"reply_en":"Wow, a puppy! What is its name?","mood":"celebrate"}';
  const result = coerceReply(raw);
  assert.deepEqual(result, { reply_en: 'Wow, a puppy! What is its name?', mood: 'celebrate' });
});

test('sessionCapsExceeded turn cap exceeded returns true', () => {
  const now = Date.now();
  const session = { turns: 12, started_at: now };
  assert.equal(sessionCapsExceeded(session, now), true);
});

test('sessionCapsExceeded time cap exceeded returns true', () => {
  const now = Date.now();
  const session = { turns: 0, started_at: now - 6 * 60 * 1000 }; // 6 minutes ago
  assert.equal(sessionCapsExceeded(session, now), true);
});

test('sessionCapsExceeded within both caps returns false', () => {
  const now = Date.now();
  const session = { turns: 5, started_at: now };
  assert.equal(sessionCapsExceeded(session, now), false);
});

test('nextSession increments turns and appends history without mutation', () => {
  const original = { turns: 2, history: [{ a: 1 }, { b: 2 }] };
  const newEntry = { c: 3 };
  const result = nextSession(original, newEntry);
  assert.equal(result.turns, 3);
  assert.deepEqual(result.history, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  // original unchanged
  assert.equal(original.turns, 2);
  assert.deepEqual(original.history, [{ a: 1 }, { b: 2 }]);
});

test('nextSession drops oldest entry when history length would exceed 6', () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push({ idx: i });
  }
  const original = { turns: 6, history };
  const newEntry = { idx: 6 };
  const result = nextSession(original, newEntry);
  assert.equal(result.history.length, 6);
  // oldest (idx 0) dropped, newest (idx 6) appended
  assert.deepEqual(result.history[0], { idx: 1 });
  assert.deepEqual(result.history[5], { idx: 6 });
});

// ---------------------------------------------------------------------------
// Endpoint tests (with fake KV, no real network)
// ---------------------------------------------------------------------------



























// ---------------------------------------------------------------------------
// Two-phase turn audio (2026-07-10): when TTS is still running once the guard
// clears, the reply goes out text-first (audio_pending) and the audio lands in
// KV via waitUntil, fetchable through action:'audio'.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// AI mock where the guard answers fast and Aura-2 is deliberately slow —
// forces the deferred-audio path deterministically.
function slowTtsAi({ ttsDelayMs = 120, guardVerdict = 'safe' } = {}) {
  return {
    async run(model) {
      if (String(model).includes('llama-guard')) return guardVerdict;
      if (String(model).includes('aura')) {
        await sleep(ttsDelayMs);
        return 'fake-aura-mp3-bytes';
      }
      // conversation fallback model — unused in these tests (OpenRouter mock answers)
      return JSON.stringify({ reply_en: 'Fallback!', mood: 'idle' });
    },
  };
}

function openRouterFetchMock(replyEn) {
  return async (url) => {
    if (String(url).includes('chat/completions')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: replyEn, mood: 'idle' }) } }] }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
  };
}







// ---------------------------------------------------------------------------
// Test-code cap bypass (2026-07-11): is_test codes get unlimited daily
// sessions and never touch the daily/global counters; normal codes keep
// every cap exactly as before.
// ---------------------------------------------------------------------------









// ---------------------------------------------------------------------------
// V1.1 (2026-07-11): free-talk brain -- level-branched buildSystemPrompt,
// options/expected/hint parsing + level gating, topic/game session start,
// the repair ladder, and the Whisper prompt bias.
// ---------------------------------------------------------------------------

test('buildSystemPrompt L1-L2 appends ANSWER-SUPPORT rules and the options/expected JSON tail', () => {
  const prompt = buildSystemPrompt('L1', 'their favorite color');
  assert.match(prompt, /ANSWER-SUPPORT/);
  assert.match(prompt, /"options"/);
  assert.match(prompt, /"expected"/);
  assert.doesNotMatch(prompt, /"hint"/);
});

test('buildSystemPrompt L3+ without a topic falls back to starterTopic as the label, no seed list, hint tail', () => {
  const prompt = buildSystemPrompt('L3', 'their favorite food');
  assert.match(prompt, /Today's talk is about their favorite food/);
  assert.doesNotMatch(prompt, /Weave these words/);
  assert.match(prompt, /"hint"/);
  assert.doesNotMatch(prompt, /ANSWER-SUPPORT/);
});

test('buildSystemPrompt L3+ with a valid topic includes the topic label and its seed words', () => {
  const prompt = buildSystemPrompt('L4', 'x', { topic: 'animals_pets' });
  assert.match(prompt, /Today's talk is about animals and pets/);
  assert.match(prompt, /Weave these words in naturally when they fit: dog, cat, fish/);
});

test('buildSystemPrompt unknown topic key falls back to starterTopic, same as no topic', () => {
  const prompt = buildSystemPrompt('L3', 'starter fallback topic', { topic: 'not_a_real_topic' });
  assert.match(prompt, /Today's talk is about starter fallback topic/);
  assert.doesNotMatch(prompt, /Weave these words/);
});

test('buildSystemPrompt appends the matching game protocol only at L4/L5 with a valid game id', () => {
  const debateTopic = DEBATE_TOPICS[2];
  const promptL4 = buildSystemPrompt('L4', 'x', { topic: 'sports', game: 'debate', debateTopic });
  assert.match(promptL4, /GAME: Friendly debate/);
  assert.ok(promptL4.includes(debateTopic));

  const promptL3 = buildSystemPrompt('L3', 'x', { topic: 'sports', game: 'debate', debateTopic });
  assert.doesNotMatch(promptL3, /GAME:/, 'game protocol never appended below L4');

  const promptNoGame = buildSystemPrompt('L5', 'x', { topic: 'sports' });
  assert.doesNotMatch(promptNoGame, /GAME:/);

  const promptBadGame = buildSystemPrompt('L4', 'x', { topic: 'sports', game: 'made_up_game' });
  assert.doesNotMatch(promptBadGame, /GAME:/, 'unrecognized game id is ignored, not appended');
});

test('buildSystemPrompt debate protocol falls back to the first allowlist topic when debateTopic is not on the allowlist', () => {
  const prompt = buildSystemPrompt('L5', 'x', { game: 'debate', debateTopic: 'a topic the kid invented' });
  assert.ok(prompt.includes(DEBATE_TOPICS[0]));
  assert.doesNotMatch(prompt, /a topic the kid invented/);
});

test('buildSystemPrompt build_a_story and would_you_rather protocols append verbatim', () => {
  const story = buildSystemPrompt('L4', 'x', { game: 'build_a_story' });
  assert.match(story, /GAME: Build a story together/);
  const wyr = buildSystemPrompt('L5', 'x', { game: 'would_you_rather' });
  assert.match(wyr, /GAME: Would You Rather/);
});

// --- parseModelReply optional fields ---------------------------------------

test('parseModelReply accepts valid options/expected and lowercases expected', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['DOG', 'A Cat'] });
  const result = parseModelReply(raw);
  assert.deepEqual(result.options, ['Dogs!', 'Cats!']);
  assert.deepEqual(result.expected, ['dog', 'a cat']);
});

test('parseModelReply accepts a valid hint string', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', hint: 'fetch' });
  const result = parseModelReply(raw);
  assert.equal(result.hint, 'fetch');
});

test('parseModelReply drops options with too many entries, keeps required fields', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['a', 'b', 'c', 'd'] });
  const result = parseModelReply(raw);
  assert.equal(result.options, undefined);
  assert.equal(result.reply_en, 'Hi');
});

test('parseModelReply drops a lone (1-element) options array -- the prompt mandates 2-3 choices (SHOULD-FIX 6)', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['Only one!'] });
  const result = parseModelReply(raw);
  assert.equal(result.options, undefined);
  assert.equal(result.reply_en, 'Hi', 'the reply still parses without options');
});

test('parseModelReply accepts a valid 2-element options array', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['A dog!', 'A cat!'] });
  assert.deepEqual(parseModelReply(raw).options, ['A dog!', 'A cat!']);
});

test('parseModelReply drops an options entry over 30 chars', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['x'.repeat(31)] });
  assert.equal(parseModelReply(raw).options, undefined);
});

test('parseModelReply drops empty expected array and an expected entry over 40 chars', () => {
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', expected: [] })).expected, undefined);
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', expected: ['x'.repeat(41)] })).expected, undefined);
});

test('parseModelReply drops a hint over 80 chars or a non-string hint', () => {
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', hint: 'x'.repeat(81) })).hint, undefined);
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', hint: 42 })).hint, undefined);
});

test('parseModelReply drops invalid optional fields independently -- a valid hint survives an invalid options value', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: 'not-an-array', hint: 'fetch' });
  const result = parseModelReply(raw);
  assert.equal(result.options, undefined);
  assert.equal(result.hint, 'fetch');
});

// --- gateReplyForLevel (single source of truth for level gating) ----------

test('gateReplyForLevel strips hint and keeps options/expected at L1/L2', () => {
  const parsed = { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'], hint: 'x' };
  const result = gateReplyForLevel(parsed, 'L1');
  assert.deepEqual(result, { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'] });
  // input not mutated
  assert.ok('hint' in parsed);
});

test('gateReplyForLevel strips options/expected and keeps hint at L3+', () => {
  const parsed = { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'], hint: 'x' };
  const result = gateReplyForLevel(parsed, 'L4');
  assert.deepEqual(result, { reply_en: 'hi', mood: 'idle', hint: 'x' });
});

test('isBeginnerLevel is true only for L1/L2, unknown levels normalize to L3 (not beginner)', () => {
  assert.equal(isBeginnerLevel('L1'), true);
  assert.equal(isBeginnerLevel('L2'), true);
  assert.equal(isBeginnerLevel('L3'), false);
  assert.equal(isBeginnerLevel('L5'), false);
  assert.equal(isBeginnerLevel('L9'), false);
});

// --- fillPhrase --------------------------------------------------------

test('fillPhrase fills known placeholders in both text_en and subtitle_vi without mutating the source phrase', () => {
  const phrase = findPhrase('repair_choices');
  const filled = fillPhrase(phrase, { a: 'A dog!', b: 'A cat!' });
  assert.ok(filled.text_en.includes('A dog!') && filled.text_en.includes('A cat!'));
  assert.ok(filled.subtitle_vi.includes('A dog!') && filled.subtitle_vi.includes('A cat!'));
  assert.doesNotMatch(filled.text_en, /\{a\}|\{b\}/);
  // source phrase constant untouched
  assert.match(findPhrase('repair_choices').text_en, /\{a\}/);
});

test('fillPhrase leaves an unfilled placeholder intact when no matching var is given', () => {
  const filled = fillPhrase(findPhrase('repair_model'), {});
  assert.match(filled.text_en, /\{model\}/);
});

// --- repair-ladder pure helpers (_minny-repair.js) --------------------------

test('isVietnamese detects diacritics and is false for plain English', () => {
  assert.equal(isVietnamese('con rất thích đi học'), true);
  assert.equal(isVietnamese('I like dogs'), false);
});

test('isLowContent: fewer than 2 words or fewer than 6 chars is low-content', () => {
  assert.equal(isLowContent('hi'), true);
  assert.equal(isLowContent('dog'), true);
  assert.equal(isLowContent('I like dogs'), false);
});

test('matchesExpected: direct phrase match and per-word fuzzy match both count; unrelated speech does not', () => {
  assert.equal(matchesExpected('i like dogs', ['dog', 'i like dogs'], wordSimilarity), true);
  assert.equal(matchesExpected('i lik dogz', ['i like dogs'], wordSimilarity), true, 'garbled-but-near transcript still resolves');
  assert.equal(matchesExpected('banana', ['dog', 'cat'], wordSimilarity), false);
});

test('nextRepairStep L1-L2 ladder: step1 rephrase -> step2 choices (from last_options) -> step3 move_on + reset', () => {
  const base = { last_options: ['A dog!', 'A cat!'], last_expected: ['dog', 'cat'] };
  const step1 = nextRepairStep({ ...base, repair: { step: 0, active: false } }, 'L1');
  assert.equal(step1.phraseId, 'repair_rephrase');
  assert.deepEqual(step1.repair, { step: 1, active: true });

  const step2 = nextRepairStep({ ...base, repair: step1.repair }, 'L1');
  assert.equal(step2.phraseId, 'repair_choices');
  assert.deepEqual(step2.vars, { a: 'A dog!', b: 'A cat!' });
  assert.deepEqual(step2.repair, { step: 2, active: true });

  const step3 = nextRepairStep({ ...base, repair: step2.repair }, 'L1');
  assert.equal(step3.phraseId, 'repair_move_on');
  assert.deepEqual(step3.repair, { step: 0, active: false }, 'ladder resets after max 2 repair turns -- normal LLM turn resumes next');
});

test('nextRepairStep L1-L2 step2 falls back to repair_model when fewer than 2 last_options are on record', () => {
  const step = nextRepairStep({ repair: { step: 1, active: true }, last_options: ['only one'], last_expected: ['dog'] }, 'L2');
  assert.equal(step.phraseId, 'repair_model');
  assert.deepEqual(step.vars, { model: 'dog' });
});

test('nextRepairStep L3+ ladder SKIPS the two-choice step: step2 is repair_model, never repair_choices', () => {
  const step = nextRepairStep({ repair: { step: 1, active: true }, last_hint: 'fetch' }, 'L4');
  assert.equal(step.phraseId, 'repair_model');
  assert.notEqual(step.phraseId, 'repair_choices');
  assert.equal(step.vars.model, 'I like fetch');
});

test('nextRepairStep Vietnamese trigger at L1-L2 models the first expected variant and consumes repair step 1', () => {
  const step = nextRepairStep({ repair: { step: 2, active: true }, last_expected: ['dog', 'cat'] }, 'L2', { vietnamese: true });
  assert.equal(step.phraseId, 'vn_nudge');
  assert.equal(step.vars.model, 'dog');
  assert.deepEqual(step.repair, { step: 1, active: true });
});

test('nextRepairStep Vietnamese trigger at L3+ models the last hint only when it is a single word, else falls back', () => {
  const withWordHint = nextRepairStep({ last_hint: 'fetch' }, 'L4', { vietnamese: true });
  assert.equal(withWordHint.vars.model, 'fetch');

  const withQuestionHint = nextRepairStep({ last_hint: 'What does Bun eat?' }, 'L4', { vietnamese: true });
  assert.equal(withQuestionHint.vars.model, 'i like it');
});

// --- start: topic/game validation -------------------------------------

function seedCode(fakeKv, code, level, extra = {}) {
  return fakeKv.put(code, JSON.stringify({ is_test: true, progress: { current_level: level }, ...extra }));
}















// --- turn: guardrail screens the whole kid-visible surface -----------------

function openRouterJsonMock(replyObj) {
  return async (url) => {
    if (String(url).includes('chat/completions')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(replyObj) } }] }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
  };
}







// --- repair ladder, wired through the endpoint end-to-end -------------------



// "Real speech always wins" (Phương, 2026-07-11): the ladder only rescues
// input that is BOTH low-content AND unmatched. Any real spoken attempt --
// a fluent off-list sentence, or a short-but-correct answer -- reaches the
// LLM instead of being answered with a canned "let me ask again".








// --- Whisper prompt bias (Task 5) -------------------------------------------





// ---------------------------------------------------------------------------
// V1.1 review fixes (Elon, second pass, 2026-07-11):
//   MUST-FIX 1: R2L's L0 (START_LEVEL, most pilot kids) must map onto the
//     L1 chips branch everywhere, not fall back to L3+.
//   MUST-FIX 2: repair_move_on must clear stale last_options/last_expected/
//     last_hint so the ladder doesn't re-trigger against an abandoned
//     question, and must not re-serve that question's chips.
//   SHOULD-FIX 3: matchesExpected must be word-boundary aware ("cat" must
//     not match inside "catapult").
//   MUST-FIX 4: expected[] must be screened by the guardrail surface scan
//     too (it is both client-visible in the turn response and later SPOKEN
//     via TTS by the repair ladder's {model} fill).
// ---------------------------------------------------------------------------

test('buildSystemPrompt L0 gets the L1 branch (ANSWER-SUPPORT block), not the L3+ hint branch', () => {
  const prompt = buildSystemPrompt('L0', 'their favorite color');
  assert.match(prompt, /ANSWER-SUPPORT/);
  assert.match(prompt, /"options"/);
  assert.doesNotMatch(prompt, /"hint"/);
});

test('gateReplyForLevel keeps options/expected (and strips hint) at L0', () => {
  const parsed = { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'], hint: 'x' };
  const result = gateReplyForLevel(parsed, 'L0');
  assert.deepEqual(result, { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'] });
});

test('isBeginnerLevel is true for L0 (R2L START_LEVEL)', () => {
  assert.equal(isBeginnerLevel('L0'), true);
});



test('nextRepairStep treats L0 as beginner: step2 is repair_choices (not the L3+ repair_model path)', () => {
  const step = nextRepairStep({ repair: { step: 1, active: true }, last_options: ['A dog!', 'A cat!'], last_expected: ['dog', 'cat'] }, 'L0');
  assert.equal(step.phraseId, 'repair_choices');
  assert.deepEqual(step.vars, { a: 'A dog!', b: 'A cat!' });
});

test('matchesExpected is word-boundary aware: "cat" must not match inside "catapult"', () => {
  assert.equal(matchesExpected('i like catapult', ['cat'], wordSimilarity), false);
});





// ---------------------------------------------------------------------------
// V1.1 review fixes, third pass (Elon/Buffet, 2026-07-11):
//   MUST-FIX 5: EVERY path that abandons the current question (not just
//     repair_move_on) must clear last_options/last_expected/last_hint and
//     reset repair -- handleGuardrailFlag's single-flag redirect branch, and
//     the !parsed LLM-parse-failure redirect path. Both pose a brand-new
//     canned question; the kid's genuine answer to THAT question must not
//     be compared against the abandoned chips.
// ---------------------------------------------------------------------------
