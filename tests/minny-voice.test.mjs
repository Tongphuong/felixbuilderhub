// functions/api/minny-voice.js had no dedicated test file before the
// speakup-word-level-feedback packet (2026-07-12) — this is the first
// coverage of the endpoint, so it exercises the two pre-existing branches
// (phrase_id, homework `text`) alongside the new `word` branch's adversarial
// fixtures. Style follows tests/minny-tts.test.mjs (fake KV + fake AI
// binding, no real network calls).

import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost, deriveHomeworkTapAllowlist } from '../functions/api/minny-voice.js';
import { MINNY_PHRASES } from '../functions/api/_minny-phrases.js';

function makeFakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts?.type === 'json') return typeof raw === 'string' ? JSON.parse(raw) : raw;
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// Fake Aura-2 binding — never touches the network, matches
// tests/minny-tts.test.mjs's convention.
const fakeAi = {
  async run() {
    return new Response(new TextEncoder().encode('fake-mp3-bytes')).body;
  },
};

function makeRequest(body) {
  return new Request('https://example.com/api/minny-voice', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const KNOWN_PHRASE_ID = MINNY_PHRASES[0].id;

test('phrase_id branch (pre-existing, unchanged): known id synthesizes audio', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0001': JSON.stringify({}) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0001', phrase_id: KNOWN_PHRASE_ID }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.audio_b64);
});

test('homework `text` branch (pre-existing, unchanged): a sentence from the code\'s own homework synthesizes audio', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0002': JSON.stringify({ homework: { sentences: [{ text_en: 'I like apples.' }] } }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0002', text: 'I like apples.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.audio_b64);
});

test('homework `text` branch: a sentence NOT in the code\'s homework → 403 not_allowed (unchanged)', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0002': JSON.stringify({ homework: { sentences: [{ text_en: 'I like apples.' }] } }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0002', text: 'Something else entirely.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

// ---------------------------------------------------------------------------
// New `word` branch (speakup-word-level-feedback, V1, 2026-07-12): single
// word, allowlisted only against the SAME code's own flagged-words KV record
// (written by read2lead-speaking-check.js). Never an open TTS proxy.
// ---------------------------------------------------------------------------

test('word branch: a word present in the code\'s own flagged-words record synthesizes audio', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0003': JSON.stringify({}),
    'flagged-words:R2L-TEST-0003': JSON.stringify({ words: ['apples', 'runs'], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0003', word: 'Apples' }), // case-insensitive input
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.audio_b64);
});

test('word branch: an arbitrary word NOT in the flagged-words record → 403 not_allowed', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0003': JSON.stringify({}),
    'flagged-words:R2L-TEST-0003': JSON.stringify({ words: ['apples'], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0003', word: 'banana' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

test('word branch: a word flagged under ANOTHER access code → 403 (per-code scoping, not a shared allowlist)', async () => {
  const kv = makeFakeKv({
    'R2L-CODE-A': JSON.stringify({}),
    'R2L-CODE-B': JSON.stringify({}),
    'flagged-words:R2L-CODE-A': JSON.stringify({ words: ['apples'], at: Date.now() }),
    // R2L-CODE-B has no flagged-words record of its own.
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-code-b', word: 'apples' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

test('word branch: missing/expired flagged-words record (KV returns null) → 403', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0004': JSON.stringify({}) }); // no flagged-words key at all
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0004', word: 'apples' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

test('word + phrase_id together: the phrase branch wins, byte-identical to the phrase_id-only branch', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0005': JSON.stringify({}),
    'flagged-words:R2L-TEST-0005': JSON.stringify({ words: ['banana'], at: Date.now() }),
  });
  const withWord = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0005', phrase_id: KNOWN_PHRASE_ID, word: 'banana' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  const withoutWord = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0005', phrase_id: KNOWN_PHRASE_ID }),
    env: { READ2LEAD_CODES: makeFakeKv({ 'R2L-TEST-0005': JSON.stringify({}) }), AI: fakeAi },
  });
  const dataWithWord = await withWord.json();
  const dataWithoutWord = await withoutWord.json();
  assert.equal(withWord.status, 200);
  assert.deepEqual(dataWithWord, dataWithoutWord, 'the extra `word` field must not change the phrase_id response at all');
});

test('word branch: injection-shaped strings are rejected before any flagged-words lookup matters → 403', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0006': JSON.stringify({}),
    // Even if the exact injection string were (implausibly) flagged, the
    // regex gate must reject it first.
    'flagged-words:R2L-TEST-0006': JSON.stringify({ words: ['hello; rm -rf'], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0006', word: 'hello; rm -rf' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

test('word branch: multi-word (space-separated) input → 403 even if each word alone is flagged', async () => {
  const kv = makeFakeKv({
    'R2L-TEST-0007': JSON.stringify({}),
    'flagged-words:R2L-TEST-0007': JSON.stringify({ words: ['dog', 'cat'], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0007', word: 'dog cat' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

test('word branch: a 40-character word (over the 30-char cap) → 403', async () => {
  const longWord = 'a'.repeat(40);
  const kv = makeFakeKv({
    'R2L-TEST-0008': JSON.stringify({}),
    'flagged-words:R2L-TEST-0008': JSON.stringify({ words: [longWord], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0008', word: longWord }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_allowed');
});

test('word branch: empty word with no phrase_id/text → 400 text_missing (existing fallback, unchanged)', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0009': JSON.stringify({}) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0009' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'text_missing');
});

// ---------------------------------------------------------------------------
// deriveHomeworkTapAllowlist (grading-honesty packet, 2026-07-14): schema v3
// tap-to-hear — a genuinely v3-authored record (no top-level .sentences at
// all) previously left every one of its own task texts un-tappable.
// ---------------------------------------------------------------------------

const V3_HOMEWORK = {
  schema_version: 3,
  tasks: [
    { id: 't_read', type: 'read', items: [{ id: 's1', text_en: 'I have two cats.' }] },
    { id: 't_present', type: 'present', stems: [{ id: 'f1', text_en: 'Last summer, I went to ___.', anchor_words: ['last', 'summer', 'went'] }], duration_s: 60 },
    { id: 't_story', type: 'story', prompt_en: 'Tell a story about your best friend.', prompt_vi: '', must_use: ['because', 'happy'], duration_s: 90, use_photo: false },
    {
      id: 't_build', type: 'build', sentences_required: 2,
      columns: [{ id: 'c1', label_en: 'We...', options: ['play football', 'draw pictures'] }, { id: 'c2', label_en: 'At...', options: ['school', 'the park'] }],
    },
    { id: 't_qa', type: 'qa', cards: [{ id: 'q1', question_en: 'Is your friend funny?', stem: { text_en: 'Yes, my friend is ___.', anchor_words: ['yes'] } }], duration_s: 30 },
    { id: 't_picture', type: 'picture', anchors: ['dog', 'ball', 'park'], duration_s: 60 },
  ],
};

test('deriveHomeworkTapAllowlist: covers read items, present stems, story prompt, build options, qa question+stem — as both sentences and words', () => {
  const { words, sentences } = deriveHomeworkTapAllowlist(V3_HOMEWORK);
  assert.ok(sentences.has('I have two cats.'));
  assert.ok(sentences.has('Last summer, I went to ___.'));
  assert.ok(sentences.has('Tell a story about your best friend.'));
  assert.ok(sentences.has('play football'));
  assert.ok(sentences.has('the park'));
  assert.ok(sentences.has('Is your friend funny?'));
  assert.ok(sentences.has('Yes, my friend is ___.'));
  assert.ok(words.has('cats'));
  assert.ok(words.has('summer'));
  assert.ok(words.has('football'));
  assert.ok(words.has('park'));
});

test('deriveHomeworkTapAllowlist: picture task anchors are the answer key — never tappable', () => {
  const { words, sentences } = deriveHomeworkTapAllowlist(V3_HOMEWORK);
  assert.equal(words.has('ball'), false);
  assert.equal([...sentences].some((s) => s.includes('dog')), false);
});

test('deriveHomeworkTapAllowlist: no homework / malformed input -> empty sets, never throws', () => {
  const empty1 = deriveHomeworkTapAllowlist(null);
  assert.equal(empty1.words.size, 0);
  assert.equal(empty1.sentences.size, 0);
  const empty2 = deriveHomeworkTapAllowlist(undefined);
  assert.equal(empty2.words.size, 0);
});

test('minny-voice `text` branch: a v3 read-task sentence (no legacy .sentences field at all) now taps through', async () => {
  const kv = makeFakeKv({ 'R2L-V3-0001': JSON.stringify({ homework: V3_HOMEWORK }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-v3-0001', text: 'I have two cats.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
});

test('minny-voice `text` branch: a build-column option phrase taps through', async () => {
  const kv = makeFakeKv({ 'R2L-V3-0002': JSON.stringify({ homework: V3_HOMEWORK }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-v3-0002', text: 'play football' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 200);
});

test('minny-voice `text` branch: arbitrary text NOT derivable from the v3 record still 403s', async () => {
  const kv = makeFakeKv({ 'R2L-V3-0003': JSON.stringify({ homework: V3_HOMEWORK }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-v3-0003', text: 'Something entirely unrelated.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
});

test('minny-voice `word` branch: a word derivable from the v3 homework record (not in flagged-words) now taps through', async () => {
  const kv = makeFakeKv({ 'R2L-V3-0004': JSON.stringify({ homework: V3_HOMEWORK }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-v3-0004', word: 'football' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 200);
});

test('minny-voice `word` branch: a picture-task anchor word (the answer key) is still NOT tappable via homework derivation', async () => {
  const kv = makeFakeKv({ 'R2L-V3-0005': JSON.stringify({ homework: V3_HOMEWORK }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-v3-0005', word: 'ball' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// The coach's model_sentence_en, persisted alongside the flagged-words merge
// (read2lead-speaking-check.js) — a NOVEL sentence, never derivable from the
// static homework record.
// ---------------------------------------------------------------------------

test('minny-voice `text` branch: a coach model_sentence_en persisted in the flagged-words KV record taps through', async () => {
  const kv = makeFakeKv({
    'R2L-COACH-0001': JSON.stringify({}),
    'flagged-words:R2L-COACH-0001': JSON.stringify({ words: ['park'], sentences: ['I play at the park.'], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-coach-0001', text: 'I play at the park.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 200);
});

test('minny-voice `text` branch: a coach sentence from ANOTHER access code does not leak across codes', async () => {
  const kv = makeFakeKv({
    'R2L-COACH-0002': JSON.stringify({}),
    'flagged-words:R2L-COACH-0003': JSON.stringify({ words: [], sentences: ['I play at the park.'], at: Date.now() }),
  });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-coach-0002', text: 'I play at the park.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 403);
});
