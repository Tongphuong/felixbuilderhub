// functions/api/read2lead-voice.js endpoint tests.
// Exercises the pack-derived allowlist and TTS engine chain.
// Style follows tests/minny-voice.test.mjs (fake KV + fake AI binding).

import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost, deriveR2lPackAllowlist } from '../functions/api/read2lead-voice.js';

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

const fakeAi = {
  async run() {
    return new Response(new TextEncoder().encode('fake-mp3-bytes')).body;
  },
};

function makeRequest(body) {
  return new Request('https://example.com/api/read2lead-voice', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Helper: build a minimal v2 lesson pack context ──

function makeLessonPack(overrides = {}) {
  return {
    pack: {
      schema_version: 2,
      story: {
        title: 'The Park',
        sentences: [
          { text_en: 'We go to the park.' },
          { text_en: 'I see a big tree.' },
        ],
      },
      activities: [
        {
          type: 'qa',
          questions: [
            {
              question_en: 'Where do we go?',
              options: ['park', 'school', 'home'],
            },
            {
              question_en: 'What do you see?',
              options: ['a tree', 'a car', 'a book'],
            },
          ],
        },
        {
          type: 'read_aloud',
          items: [
            { text_en: 'The tree is tall.' },
            { text_en: 'I like the park.' },
          ],
        },
        {
          type: 'vocabulary',
          text_en: 'park tree big see',
        },
      ],
    },
    pack_id: 'test-pack-001',
    status: 'awaiting_review',
    ...overrides,
  };
}

// ── deriveR2lPackAllowlist tests ──

test('deriveR2lPackAllowlist: extracts sentences and words from a v2 pack', () => {
  const pack = makeLessonPack();
  const { sentences, words } = deriveR2lPackAllowlist(pack);

  assert.ok(sentences.has('We go to the park.'), 'story sentence 1');
  assert.ok(sentences.has('I see a big tree.'), 'story sentence 2');
  assert.ok(sentences.has('Where do we go?'), 'qa question 1');
  assert.ok(sentences.has('What do you see?'), 'qa question 2');
  assert.ok(sentences.has('The tree is tall.'), 'read aloud item 1');
  assert.ok(sentences.has('I like the park.'), 'read aloud item 2');
  assert.ok(sentences.has('park tree big see'), 'vocabulary text_en');

  assert.ok(words.has('park'), 'word from story');
  assert.ok(words.has('tree'), 'word from qa option');
  assert.ok(words.has('big'), 'word from vocabulary');
});

test('deriveR2lPackAllowlist: handles empty/missing pack gracefully', () => {
  assert.deepEqual(deriveR2lPackAllowlist(null), { sentences: new Set(), words: new Set() });
  assert.deepEqual(deriveR2lPackAllowlist(undefined), { sentences: new Set(), words: new Set() });
  assert.deepEqual(deriveR2lPackAllowlist({}), { sentences: new Set(), words: new Set() });
  assert.deepEqual(deriveR2lPackAllowlist({ pack: {} }), { sentences: new Set(), words: new Set() });
});

test('deriveR2lPackAllowlist: searches across pack.pack, pack.pack_json, pack.review_context', () => {
  const lesson = {
    schema_version: 2,
    story: { sentences: [{ text_en: 'Hello world.' }] },
    activities: [],
  };

  // pack.pack
  assert.ok(deriveR2lPackAllowlist({ pack: lesson }).sentences.has('Hello world.'));

  // pack.pack_json
  assert.ok(deriveR2lPackAllowlist({ pack_json: lesson }).sentences.has('Hello world.'));

  // pack.review_context
  assert.ok(deriveR2lPackAllowlist({ review_context: lesson }).sentences.has('Hello world.'));

  // direct pack (fallback)
  assert.ok(deriveR2lPackAllowlist(lesson).sentences.has('Hello world.'));
});

// ── onRequestPost tests ──

test('onRequestPost: requires access_code', async () => {
  const kv = makeFakeKv({});
  const res = await onRequestPost({
    request: makeRequest({ text: 'hello' }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'code_missing');
});

test('onRequestPost: requires text', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0001': JSON.stringify({ progress: { current_pack: makeLessonPack() } }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0001' }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'text_missing');
});

test('onRequestPost: rejects text not in the pack allowlist', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0001': JSON.stringify({ progress: { current_pack: makeLessonPack() } }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0001', text: 'This is not in the pack.' }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'not_allowed');
});

test('onRequestPost: allows story sentence from the pack', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0001': JSON.stringify({ progress: { current_pack: makeLessonPack() } }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0001', text: 'We go to the park.' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.audio_b64, 'has audio base64');
  assert.equal(body.content_type, 'audio/mpeg');
});

test('onRequestPost: allows individual word from the pack', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0001': JSON.stringify({ progress: { current_pack: makeLessonPack() } }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0001', text: 'park' }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.audio_b64, 'has audio base64');
});

test('onRequestPost: rejects code_not_found', async () => {
  const kv = makeFakeKv({});
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'R2L-NONEXIST', text: 'hello' }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'code_not_found');
});

test('onRequestPost: returns 500 when no AI binding or OpenAI key', async () => {
  const kv = makeFakeKv({ 'R2L-TEST-0001': JSON.stringify({ progress: { current_pack: makeLessonPack() } }) });
  const res = await onRequestPost({
    request: makeRequest({ access_code: 'r2l-test-0001', text: 'park' }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'config_error');
});

// ── Client-side lesson.astro tests ──

import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');

test('lesson.astro contains _r2lSpeakServerLine function', () => {
  assert.match(lessonPage, /function _r2lSpeakServerLine\(text, onEnd\)/);
});

test('lesson.astro _r2lSpeakEnglishLine delegates to _r2lSpeakServerLine', () => {
  // The function body should call _r2lSpeakServerLine, not _r2lSpeakLine directly
  const match = lessonPage.match(/function _r2lSpeakEnglishLine\(text, onEnd\)\s*\{[^}]+\}/);
  assert.ok(match, 'should find _r2lSpeakEnglishLine function');
  assert.ok(
    match[0].includes('_r2lSpeakServerLine'),
    '_r2lSpeakEnglishLine should delegate to _r2lSpeakServerLine',
  );
  assert.ok(
    !match[0].includes('_r2lSpeakLine'),
    '_r2lSpeakEnglishLine should NOT call _r2lSpeakLine directly',
  );
});

test('lesson.astro _r2lSpeakServerLine fetches from /api/read2lead-voice', () => {
  assert.match(lessonPage, /fetch\('\/api\/read2lead-voice'/);
  assert.match(lessonPage, /access_code: state\.accessCode/);
  assert.match(lessonPage, /text: line/);
});

test('lesson.astro _r2lSpeakServerLine falls back to browser speech on network error', () => {
  assert.match(lessonPage, /_r2lSpeakLine\(text, 'en-US', onEnd\)/);
});

test('lesson.astro _r2lSpeakVietnameseLine still uses browser speech', () => {
  assert.match(lessonPage, /function _r2lSpeakVietnameseLine/);
  assert.match(lessonPage, /_r2lSpeakLine\(text, 'vi-VN', onEnd\)/);
});