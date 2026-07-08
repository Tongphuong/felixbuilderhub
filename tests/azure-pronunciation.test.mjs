import test from 'node:test';
import assert from 'node:assert/strict';

import {
  azureSpeechConfigured,
  azureUsageKey,
  azureUnderFreeTier,
  azureBumpUsage,
  assessPronunciationWithAzure,
  mapAzureReadResult,
  mapAzureOpenResult,
  AZURE_PA_MONTHLY_FREE_SECONDS,
} from '../functions/api/_azure-pronunciation.js';
import {
  runSpeakingCheck,
  VIETNAMESE_REDIRECT_VI,
  detectVietnameseSpeech,
} from '../functions/api/read2lead-speaking-check.js';

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

const AZURE_NBEST = {
  RecognitionStatus: 'Success',
  NBest: [{
    Display: 'I like apples.',
    PronScore: 88,
    AccuracyScore: 90,
    FluencyScore: 85,
    CompletenessScore: 100,
    Words: [
      { Word: 'I', ErrorType: 'None', AccuracyScore: 95 },
      { Word: 'like', ErrorType: 'Mispronunciation', AccuracyScore: 70 },
      { Word: 'apples', ErrorType: 'Omission', AccuracyScore: 0 },
      { Word: 'um', ErrorType: 'Insertion', AccuracyScore: 50 },
    ],
  }],
};

test('azureSpeechConfigured requires both key and region', () => {
  assert.equal(azureSpeechConfigured({}), false);
  assert.equal(azureSpeechConfigured({ AZURE_SPEECH_KEY: 'k' }), false);
  assert.equal(azureSpeechConfigured({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia' }), true);
});

test('azure usage meter: key format, free-tier check, bump', async () => {
  const kv = makeFakeKv();
  const now = new Date('2026-07-06T12:00:00Z');
  assert.equal(azureUsageKey(now), 'azure-pa-secs:2026-07');

  assert.equal(await azureUnderFreeTier(kv, 30, now), true);
  await azureBumpUsage(kv, AZURE_PA_MONTHLY_FREE_SECONDS - 10, now);
  assert.equal(await azureUnderFreeTier(kv, 30, now), false, 'over the free tier → do not spend');
  assert.equal(await azureUnderFreeTier(null, 30, now), false, 'no meter → do not spend');
});

test('mapAzureReadResult maps word statuses and excludes insertions', () => {
  const mapped = mapAzureReadResult(AZURE_NBEST.NBest[0]);
  assert.equal(mapped.score_percent, 88);
  assert.equal(mapped.scorer, 'azure_pronunciation');
  assert.equal(mapped.transcript, 'I like apples.');
  assert.deepEqual(mapped.words_exact, ['i']);
  assert.deepEqual(mapped.words_close, ['like']);
  assert.deepEqual(mapped.words_missed, ['apples']);
  assert.equal(mapped.total_count, 3, 'insertion excluded');
  assert.equal(mapped.fluency_percent, 85);
  const missed = mapped.word_feedback.find((w) => w.expected === 'apples');
  assert.equal(missed.status, 'missed');
  assert.equal(missed.spoken, null, 'omission has no spoken form');
});

test('runSpeakingCheck read mode uses Azure PA for WAV audio and keeps the client contract', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async (url, init) => {
    azureCalls += 1;
    assert.match(url, /southeastasia\.stt\.speech\.microsoft\.com/);
    assert.ok(init.headers['Pronunciation-Assessment'], 'PA header present');
    const params = JSON.parse(atob(init.headers['Pronunciation-Assessment']));
    assert.equal(params.ReferenceText, 'I like apples.');
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };

  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav-bytes'], { type: 'audio/wav' }),
    expectedText: 'I like apples.',
    checkMode: 'read',
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });

  assert.equal(azureCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.check_mode, 'read');
  assert.equal(result.score_percent, 88);
  assert.ok(result.feedback_vi.length > 0, 'Vietnamese feedback template applied');
  assert.ok(Array.isArray(result.words_missed));

  const meterKey = [...kv.store.keys()].find((k) => k.startsWith('azure-pa-secs:'));
  assert.ok(meterKey, 'usage meter written');
  assert.ok(JSON.parse(kv.store.get(meterKey)) >= 30, 'usage meter bumped');
});

test('PA header is UTF-8-safe for curly-apostrophe reference text', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async (url, init) => {
    azureCalls += 1;
    assert.match(url, /southeastasia\.stt\.speech\.microsoft\.com/);
    assert.ok(init.headers['Pronunciation-Assessment'], 'PA header present');
    const params = JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    assert.equal(params.ReferenceText, 'Let\u2019s practice speaking together!');
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };

  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav-bytes'], { type: 'audio/wav' }),
    expectedText: 'Let\u2019s practice speaking together!',
    checkMode: 'read',
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });

  assert.equal(azureCalls, 1);
  assert.equal(result.score_percent, 88);
});

test('runSpeakingCheck falls back to the local scorer when Azure fails', async () => {
  const kv = makeFakeKv();
  const fetchFn = async () => new Response('boom', { status: 500 });
  const fakeAi = {
    async run() {
      return { text: 'i like apples' };
    },
  };

  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav-bytes'], { type: 'audio/wav' }),
    expectedText: 'I like apples.',
    checkMode: 'read',
    ai: fakeAi,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scorer, undefined, 'local scorer path');
  assert.equal(result.score_percent, 100, 'Levenshtein scorer still works as fallback');
});

test('non-WAV audio never goes to Azure (falls to local scorer)', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  const fakeAi = { async run() { return { text: 'i like apples' }; } };

  const result = await runSpeakingCheck({
    audioBlob: new Blob(['webm'], { type: 'audio/webm' }),
    expectedText: 'I like apples.',
    checkMode: 'read',
    ai: fakeAi,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 0);
  assert.equal(result.score_percent, 100);
});

test('Vietnamese speech gets the warm redirect instead of a garbage score', async () => {
  let calls = 0;
  const fakeAi = {
    async run(model, input) {
      calls += 1;
      if (input.language === 'en') {
        // garbage English transcript of Vietnamese speech
        return { text: 'con muon noise banana' };
      }
      // unpinned auto-detect pass returns real Vietnamese with diacritics
      return { text: 'con muốn nói tiếng Việt' };
    },
  };

  const result = await runSpeakingCheck({
    audioBlob: new Blob(['webm'], { type: 'audio/webm' }),
    expectedText: 'The little dog runs across the bright meadow every morning.',
    checkMode: 'read',
    ai: fakeAi,
  });

  assert.equal(result.ok, true);
  assert.equal(result.vietnamese_detected, true);
  assert.equal(result.score_percent, null);
  assert.equal(result.feedback_vi, VIETNAMESE_REDIRECT_VI);
  assert.equal(result.check_mode, 'read');
  assert.equal(calls, 2, 'detection pass ran exactly once after the scored pass');
});

test('free-talk submissions are never redirected (LLM handles Vietnamese there)', async () => {
  const fakeAi = {
    async run(model, input) {
      return { text: input.language === 'en' ? 'xin chao whatever' : 'xin chào Minny ơi' };
    },
  };
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['webm'], { type: 'audio/webm' }),
    expectedText: 'free_talking_no_score',
    checkMode: 'open',
    ai: fakeAi,
  });
  assert.equal(result.vietnamese_detected, undefined);
  assert.equal(result.check_mode, 'open');
});

test('detectVietnameseSpeech is safe without an AI binding', async () => {
  assert.equal(await detectVietnameseSpeech(new Blob(['x']), null), false);
});

test('unscripted PA: header has NO ReferenceText and EnableMiscue false; scripted keeps both', async () => {
  let header = null;
  const fetchFn = async (url, init) => {
    header = JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  await assessPronunciationWithAzure({
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia' },
    audioBlob: new Blob(['wav'], { type: 'audio/wav' }),
    referenceText: '',
    fetchFn,
  });
  assert.equal('ReferenceText' in header, false);
  assert.equal(header.EnableMiscue, false);
  await assessPronunciationWithAzure({
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia' },
    audioBlob: new Blob(['wav'], { type: 'audio/wav' }),
    referenceText: 'I like apples.',
    fetchFn,
  });
  assert.equal(header.ReferenceText, 'I like apples.');
  assert.equal(header.EnableMiscue, true);
});

test('runSpeakingCheck: photo_talk WAV ≤30s graded unscripted, keeps open contract', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async (url, init) => {
    azureCalls += 1;
    const params = JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    assert.equal('ReferenceText' in params, false);
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav-bytes'], { type: 'audio/wav' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 1);
  assert.equal(result.scorer, 'azure_pronunciation_unscripted');
  assert.equal(result.check_mode, 'open');
  assert.equal(result.score_percent, 88);
  assert.ok(Array.isArray(result.words_matched));
  assert.ok(result.feedback_vi.length > 0);
});

test('runSpeakingCheck: photo_talk clip over 30s skips Azure and uses the open scorer', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  const bigWav = new Blob([new Uint8Array(31 * 32000)], { type: 'audio/wav' });
  const fakeAi = {
    async run() {
      return { text: 'I can see a big mountain and a river in the picture.' };
    },
  };
  const result = await runSpeakingCheck({
    audioBlob: bigWav,
    expectedText: 'photo_talk',
    checkMode: 'open',
    ai: fakeAi,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 0);
  assert.equal(result.scorer, undefined);
  assert.equal(result.check_mode, 'open');
  assert.ok(result.score_percent >= 0);
});
