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

test('ttsCacheKey differs across engines (stale nova audio never served as aura2)', async () => {
  const keyA = await ttsCacheKey('Hello', 'luna', 'aura2');
  const keyB = await ttsCacheKey('Hello', 'luna', 'openai');
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^tts:aura2:luna:/);
});

function makeFakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const raw = store.get(key);
      if (!raw) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

test('getOrSynthesize without AI binding uses OpenAI path, caches, calls fetch once', async () => {
  const fakeKv = makeFakeKv();

  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    const fakeBytes = new TextEncoder().encode('fake-mp3-bytes');
    return new Response(fakeBytes, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  };

  const env = { READ2LEAD_CODES: fakeKv, OPENAI_API_KEY: 'fake-key' };
  const first = await getOrSynthesize(env, 'Hello there', { fetchFn: mockFetch });
  const second = await getOrSynthesize(env, 'Hello there', { fetchFn: mockFetch });

  assert.equal(fetchCalls, 1);
  assert.equal(first.audio_b64, second.audio_b64);
  assert.equal(first.content_type, 'audio/mpeg');
});

test('getOrSynthesize with AI binding uses Aura-2, caches under the aura2 key', async () => {
  const fakeKv = makeFakeKv();
  let aura2Calls = 0;
  const fakeAi = {
    async run(model, input) {
      assert.equal(model, '@cf/deepgram/aura-2-en');
      assert.equal(input.text, 'Hi Minny');
      assert.ok(input.speaker, 'speaker is set');
      aura2Calls += 1;
      return new Response(new TextEncoder().encode('aura2-mp3')).body;
    },
  };

  const env = { READ2LEAD_CODES: fakeKv, AI: fakeAi };
  const first = await getOrSynthesize(env, 'Hi Minny');
  const second = await getOrSynthesize(env, 'Hi Minny');

  assert.equal(aura2Calls, 1, 'second call served from KV cache');
  assert.equal(first.audio_b64, second.audio_b64);
  assert.equal(first.content_type, 'audio/mpeg');
  const cachedKeys = [...fakeKv.store.keys()];
  assert.equal(cachedKeys.length, 1);
  assert.match(cachedKeys[0], /^tts:aura2:/);
});

test('getOrSynthesize falls back to MeloTTS when Aura-2 fails, and does not cache the fallback', async () => {
  const fakeKv = makeFakeKv();
  let meloCalls = 0;
  const fakeAi = {
    async run(model) {
      if (model === '@cf/deepgram/aura-2-en') throw new Error('aura2 down');
      assert.equal(model, '@cf/myshell-ai/melotts');
      meloCalls += 1;
      return { audio: 'bWVsby1tcDM=' };
    },
  };

  const env = { READ2LEAD_CODES: fakeKv, AI: fakeAi };
  const result = await getOrSynthesize(env, 'Hi again');
  assert.equal(result.audio_b64, 'bWVsby1tcDM=');
  assert.equal(result.content_type, 'audio/mpeg');
  assert.equal(meloCalls, 1);
  assert.equal(fakeKv.store.size, 0, 'fallback audio must not be cached under the primary key');
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
