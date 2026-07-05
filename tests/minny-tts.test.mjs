import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ttsCacheKey,
  getOrSynthesize,
  synthesizeWithOpenAI,
} from '../functions/api/_minny-tts.js';
import {
  MINNY_PHRASES,
  findPhrase,
  isKnownPhraseId,
} from '../functions/api/_minny-phrases.js';

test('ttsCacheKey is stable for same text and voice', async () => {
  const key1 = await ttsCacheKey('Hello', 'nova');
  const key2 = await ttsCacheKey('Hello', 'nova');
  assert.equal(key1, key2);
});

test('ttsCacheKey differs for different text', async () => {
  const keyA = await ttsCacheKey('Hello', 'nova');
  const keyB = await ttsCacheKey('World', 'nova');
  assert.notEqual(keyA, keyB);
});

test('ttsCacheKey differs for same text with different voice', async () => {
  const keyA = await ttsCacheKey('Hello', 'nova');
  const keyB = await ttsCacheKey('Hello', 'alloy');
  assert.notEqual(keyA, keyB);
});

test('getOrSynthesize caches result and calls fetch only once', async () => {
  const store = new Map();
  const fakeKv = {
    async get(key, opts) {
      const raw = store.get(key);
      if (!raw) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };

  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    const fakeBytes = new TextEncoder().encode('fake-mp3-bytes');
    return new Response(fakeBytes, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  };

  const first = await getOrSynthesize(fakeKv, 'Hello there', 'fake-key', mockFetch, 'nova');
  const second = await getOrSynthesize(fakeKv, 'Hello there', 'fake-key', mockFetch, 'nova');

  assert.equal(fetchCalls, 1);
  assert.equal(first.audio_b64, second.audio_b64);
  assert.equal(first.content_type, 'audio/mpeg');
});

test('MINNY_PHRASES has unique ids and non-empty fields', () => {
  const ids = MINNY_PHRASES.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids found');
  for (const p of MINNY_PHRASES) {
    assert.ok(p.text_en && p.text_en.length > 0, `phrase ${p.id} missing text_en`);
    assert.ok(p.subtitle_vi && p.subtitle_vi.length > 0, `phrase ${p.id} missing subtitle_vi`);
  }
});

test('findPhrase and isKnownPhraseId work correctly', () => {
  const greeting = findPhrase('greeting');
  assert.ok(greeting);
  assert.equal(greeting.id, 'greeting');
  assert.equal(findPhrase('not_a_real_id'), null);
  assert.equal(isKnownPhraseId('goodbye'), true);
  assert.equal(isKnownPhraseId('nope'), false);
});

test('MINNY_PHRASES contains exactly 6 redirect and 2 wrap_up ids', () => {
  const redirectIds = MINNY_PHRASES.filter(p => /^redirect_[1-6]$/.test(p.id));
  const wrapUpIds = MINNY_PHRASES.filter(p => /^wrap_up_[12]$/.test(p.id));
  assert.equal(redirectIds.length, 6);
  assert.equal(wrapUpIds.length, 2);
});
