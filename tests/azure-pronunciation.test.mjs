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
  mapAzureFramePronunciation,
  trimWavToSeconds,
  splitWavIntoChunks,
  mergeAzureChunkResults,
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

// Grading-honesty packet (2026-07-14): the photo_talk Azure path now
// requires a genuinely parseable canonical WAV (it chunks the buffer itself
// instead of forwarding raw bytes untouched) — makeWavBuffer (below, hoisted
// function declaration) builds a real one instead of the old placeholder
// string-blob fixture. score_percent is no longer a bare PronScore
// passthrough: with no homework passed, there is no vocabulary to ground
// relevance on, so the score blends effort + Azure pronunciation
// (graded_against: 'pronunciation_effort'), and the Azure numbers move under
// the additive `pronunciation` block (mirrors frame mode's existing shape)
// instead of living at the top level.
test('runSpeakingCheck: photo_talk WAV ≤30s graded unscripted, pronunciation_effort when no homework vocabulary exists', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async (url, init) => {
    azureCalls += 1;
    const params = JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    assert.equal('ReferenceText' in params, false);
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  const result = await runSpeakingCheck({
    audioBlob: new Blob([makeWavBuffer({ durationSeconds: 5 })], { type: 'audio/wav' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 1, 'a single ≤30s clip is exactly one chunk');
  assert.equal(result.check_mode, 'open');
  assert.equal(result.graded_against, 'pronunciation_effort', 'no homework -> nothing to ground content relevance on');
  assert.equal(result.pronunciation.scorer, 'azure_pronunciation_unscripted');
  assert.equal(result.pronunciation.accuracy_percent, 90);
  assert.equal(result.pronunciation.fluency_percent, 85);
  // AZURE_NBEST's Display "I like apples." is 3 words -> effort 30; blended
  // with Azure's PronScore (88) at the same 0.45/0.55 split scoreOpenTranscript
  // already uses for effort+relevance.
  assert.equal(result.score_percent, Math.round(30 * 0.45 + 88 * 0.55));
  assert.ok(Array.isArray(result.words_matched));
  assert.ok(result.feedback_vi.length > 0);
});

// "The Ear on long clips" (design point 5, grading-honesty packet
// 2026-07-14): Azure's short-audio REST endpoint caps at 30s/call, so a
// longer photo_talk clip used to skip Azure entirely past the first 30s and
// fall to the local open scorer -- now it is chunked into sequential ≤30s
// pieces, each graded, and merged (duration-weighted) instead of being
// abandoned. This replaces the old "clip over 30s skips Azure" test, which
// documented the exact limitation this packet closes.
test('runSpeakingCheck: photo_talk clip over 30s is chunked into sequential ≤30s pieces and merged, not skipped', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  const longWav = new Blob([makeWavBuffer({ durationSeconds: 45 })], { type: 'audio/wav' });
  const result = await runSpeakingCheck({
    audioBlob: longWav,
    expectedText: 'photo_talk',
    checkMode: 'open',
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 2, 'two chunks: 30s + 15s -- the clip is graded in full, not truncated to the first 30s');
  assert.equal(result.check_mode, 'open');
  assert.ok(result.pronunciation, 'the long clip still gets graded, not abandoned past 30s');
  assert.equal(result.pronunciation.sampled_seconds, 45);
  const meterKey = [...kv.store.keys()].find((k) => k.startsWith('azure-pa-secs:'));
  assert.equal(JSON.parse(kv.store.get(meterKey)), 45, 'both chunks metered, not a flat 30s estimate');
});

// Meter denial mid-clip (grading-honesty packet, 2026-07-14): "Respect
// azureUnderFreeTier for EVERY chunk -- the meter is the hard stop." When
// the free tier runs out before the FIRST chunk, no chunk ever succeeds, so
// the whole attempt gracefully falls through to the local Whisper-based open
// scorer -- never blocks the child.
test('runSpeakingCheck: photo_talk clip whose Azure meter is already exhausted falls through to the local open scorer', async () => {
  const kv = makeFakeKv();
  await kv.put('azure-pa-secs:' + new Date().toISOString().slice(0, 7), JSON.stringify(5 * 3600));
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(AZURE_NBEST), { status: 200 });
  };
  const fakeAi = { async run() { return { text: 'I can see a big mountain and a river in the picture.' }; } };
  const result = await runSpeakingCheck({
    audioBlob: new Blob([makeWavBuffer({ durationSeconds: 5 })], { type: 'audio/wav' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    ai: fakeAi,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 0, 'meter denied before any chunk -- Azure never called');
  assert.equal(result.pronunciation, undefined);
  assert.equal(result.check_mode, 'open');
  assert.ok(result.score_percent >= 0, 'the child still gets a graceful local score, never blocked');
});

// ---------------------------------------------------------------------------
// trimWavToSeconds (speakup-azure-frame-grading, V1): pure WAV-sampling
// helper for the frame homework step. Builds a real canonical 44-byte-header
// PCM WAV so the byte-field assertions below are exact, not approximate.
// ---------------------------------------------------------------------------

function writeAscii(bytes, offset, str) {
  for (let i = 0; i < str.length; i += 1) bytes[offset + i] = str.charCodeAt(i);
}

function makeWavBuffer({ sampleRate = 16000, channels = 1, bitsPerSample = 16, durationSeconds = 1 } = {}) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(byteRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + dataSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true); // canonical fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);
  // Non-zero, non-repeating filler so a byte-slice bug (wrong offset/length)
  // would show up as a mismatch instead of silently passing on all-zero data.
  for (let i = 44; i < bytes.length; i += 1) bytes[i] = (i % 251) + 1;
  return buffer;
}

test('trimWavToSeconds: WAV longer than maxSeconds is trimmed with byte-exact RIFF/data size fields', () => {
  const buffer = makeWavBuffer({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationSeconds: 45 });
  const result = trimWavToSeconds(buffer, 30);
  assert.ok(result, 'valid canonical WAV must trim, not skip');
  const expectedDataSize = 16000 * 2 * 30; // sampleRate * blockAlign * maxSeconds
  assert.equal(result.wav.length, 44 + expectedDataSize);
  assert.equal(result.sampledSeconds, 30);

  const view = new DataView(result.wav.buffer, result.wav.byteOffset, result.wav.byteLength);
  assert.equal(view.getUint32(4, true), 44 + expectedDataSize - 8, 'RIFF chunk size field');
  assert.equal(view.getUint32(40, true), expectedDataSize, 'data chunk size field');
  // The trimmed data bytes must be the FIRST 30s slice, unmodified.
  const original = new Uint8Array(buffer);
  assert.deepEqual(result.wav.subarray(44), original.subarray(44, 44 + expectedDataSize));
});

test('trimWavToSeconds: odd/non-standard sample rate still trims to whole sample frames, byte-exact', () => {
  const buffer = makeWavBuffer({ sampleRate: 11025, channels: 1, bitsPerSample: 16, durationSeconds: 35 });
  const result = trimWavToSeconds(buffer, 30);
  assert.ok(result);
  const blockAlign = 2;
  const expectedDataSize = Math.floor((11025 * blockAlign * 30) / blockAlign) * blockAlign;
  assert.equal(result.wav.length, 44 + expectedDataSize);
  const view = new DataView(result.wav.buffer, result.wav.byteOffset, result.wav.byteLength);
  assert.equal(view.getUint32(40, true), expectedDataSize);
  assert.equal(view.getUint32(4, true), 44 + expectedDataSize - 8);
  assert.equal(result.sampledSeconds, expectedDataSize / (11025 * blockAlign));
});

test('trimWavToSeconds: input already at/under maxSeconds passes through unchanged (zero-copy)', () => {
  const buffer = makeWavBuffer({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationSeconds: 10 });
  const bytes = new Uint8Array(buffer);
  const result = trimWavToSeconds(bytes, 30);
  assert.ok(result);
  assert.strictEqual(result.wav, bytes, 'zero-copy: same reference, no slicing when already short enough');
  assert.equal(result.sampledSeconds, 10);
});

test('trimWavToSeconds: exactly at maxSeconds passes through unchanged', () => {
  const buffer = makeWavBuffer({ durationSeconds: 30 });
  const result = trimWavToSeconds(buffer, 30);
  assert.ok(result);
  assert.equal(result.sampledSeconds, 30);
  assert.equal(result.wav.length, buffer.byteLength);
});

test('trimWavToSeconds: junk/nonstandard input returns null so the caller skips Azure', () => {
  assert.equal(trimWavToSeconds(new ArrayBuffer(10), 30), null, 'too short to hold a header');
  assert.equal(trimWavToSeconds(null, 30), null, 'no input');

  const badRiff = new Uint8Array(makeWavBuffer({ durationSeconds: 1 }));
  writeAscii(badRiff, 0, 'JUNK');
  assert.equal(trimWavToSeconds(badRiff, 30), null, 'bad RIFF magic');

  const badWave = new Uint8Array(makeWavBuffer({ durationSeconds: 1 }));
  writeAscii(badWave, 8, 'JUNK');
  assert.equal(trimWavToSeconds(badWave, 30), null, 'bad WAVE magic');

  const badFmt = new Uint8Array(makeWavBuffer({ durationSeconds: 1 }));
  writeAscii(badFmt, 12, 'JUNK');
  assert.equal(trimWavToSeconds(badFmt, 30), null, 'bad fmt tag');

  const noDataTag = new Uint8Array(makeWavBuffer({ durationSeconds: 1 }));
  writeAscii(noDataTag, 36, 'JUNK');
  assert.equal(trimWavToSeconds(noDataTag, 30), null, 'non-canonical header (no data chunk at byte 36)');

  const buffer = makeWavBuffer({ durationSeconds: 1 });
  const notPcm = new Uint8Array(buffer);
  new DataView(buffer).setUint16(20, 3, true); // IEEE float, not PCM
  assert.equal(trimWavToSeconds(notPcm, 30), null, 'non-PCM audio format');

  const truncated = new Uint8Array(makeWavBuffer({ durationSeconds: 1 })).subarray(0, 100);
  assert.equal(trimWavToSeconds(truncated, 30), null, 'header claims more data than the buffer actually has');
});

test('mapAzureFramePronunciation maps accuracy/fluency, omits prosody when absent, carries sampled_seconds through', () => {
  const mapped = mapAzureFramePronunciation(AZURE_NBEST.NBest[0], 27.4);
  assert.equal(mapped.accuracy_percent, 90);
  assert.equal(mapped.fluency_percent, 85);
  assert.equal(mapped.scorer, 'azure_pronunciation_unscripted');
  assert.equal(mapped.sampled_seconds, 27.4);
  assert.equal('prosody_percent' in mapped, false, 'omitted, not null, when Azure does not return ProsodyScore');
});

test('mapAzureFramePronunciation includes prosody_percent when Azure returns it', () => {
  const withProsody = { ...AZURE_NBEST.NBest[0], ProsodyScore: 78 };
  const mapped = mapAzureFramePronunciation(withProsody, 30);
  assert.equal(mapped.prosody_percent, 78);
});

// ---------------------------------------------------------------------------
// speakup-word-level-feedback (V1, 2026-07-12): mapAzureFramePronunciation's
// new optional words[] — up to 3 lowest-accuracy practice words for the
// presentation's "Từ cần luyện" chips.
// ---------------------------------------------------------------------------

const SKIP_WORDS_FIXTURE = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at',
]);

const FRAME_WORDS_BEST = {
  Display: 'The dog ran to the park and it was fun.',
  PronScore: 60,
  AccuracyScore: 60,
  FluencyScore: 60,
  Words: [
    { Word: 'The', ErrorType: 'None', AccuracyScore: 95 }, // stopword + high accuracy
    { Word: 'dog', ErrorType: 'Mispronunciation', AccuracyScore: 40 }, // candidate
    { Word: 'ran', ErrorType: 'Mispronunciation', AccuracyScore: 55 }, // candidate
    { Word: 'to', ErrorType: 'None', AccuracyScore: 20 }, // stopword + too short
    { Word: 'the', ErrorType: 'None', AccuracyScore: 10 }, // stopword (lowest score of all)
    { Word: 'park', ErrorType: 'Mispronunciation', AccuracyScore: 65 }, // candidate, 4th-lowest
    { Word: 'and', ErrorType: 'None', AccuracyScore: 30 }, // NOT a stopword — candidate
    { Word: 'um', ErrorType: 'Insertion', AccuracyScore: 5 }, // insertion — always excluded
    { Word: 'it', ErrorType: 'None', AccuracyScore: 15 }, // too short (len 2)
    { Word: 'fun', ErrorType: 'None', AccuracyScore: 90 }, // accuracy >= 70 — excluded
  ],
};

test('mapAzureFramePronunciation words[]: without skipWords, excludes Insertion/length<3/accuracy>=70, sorts ascending, caps at 3', () => {
  const mapped = mapAzureFramePronunciation(FRAME_WORDS_BEST, 20);
  // No skipWords passed -> 'the' (accuracy 10) is eligible and is the lowest.
  assert.deepEqual(mapped.words, [
    { word: 'the', accuracy_percent: 10 },
    { word: 'and', accuracy_percent: 30 },
    { word: 'dog', accuracy_percent: 40 },
  ]);
  // Base fields untouched by the words[] addition.
  assert.equal(mapped.accuracy_percent, 60);
  assert.equal(mapped.fluency_percent, 60);
  assert.equal(mapped.scorer, 'azure_pronunciation_unscripted');
  assert.equal(mapped.sampled_seconds, 20);
});

test('mapAzureFramePronunciation words[]: skipWords (SKIP_WORDS) additionally excludes stopwords', () => {
  const mapped = mapAzureFramePronunciation(FRAME_WORDS_BEST, 20, SKIP_WORDS_FIXTURE);
  // 'the'/'to' dropped as stopwords; 'it' still dropped for length; 'fun'/'The'
  // still dropped for accuracy >= 70; 'um' still dropped as an Insertion.
  // Remaining candidates ascending: and(30), dog(40), ran(55), park(65) -> top 3.
  assert.deepEqual(mapped.words, [
    { word: 'and', accuracy_percent: 30 },
    { word: 'dog', accuracy_percent: 40 },
    { word: 'ran', accuracy_percent: 55 },
  ]);
});

test('mapAzureFramePronunciation words[]: key entirely absent (not an empty array) when no candidate qualifies', () => {
  const allClean = {
    Display: 'I like apples.',
    AccuracyScore: 95,
    FluencyScore: 95,
    Words: [
      { Word: 'I', ErrorType: 'None', AccuracyScore: 95 },
      { Word: 'like', ErrorType: 'None', AccuracyScore: 90 },
      { Word: 'apples', ErrorType: 'None', AccuracyScore: 88 },
    ],
  };
  const mapped = mapAzureFramePronunciation(allClean, 10, SKIP_WORDS_FIXTURE);
  assert.equal('words' in mapped, false);
});

test('mapAzureFramePronunciation words[]: missing/non-array Words[] is safe (no words key, no throw)', () => {
  const mapped = mapAzureFramePronunciation({ AccuracyScore: 50, FluencyScore: 50 }, 10, SKIP_WORDS_FIXTURE);
  assert.equal('words' in mapped, false);
});

// ---------------------------------------------------------------------------
// splitWavIntoChunks / mergeAzureChunkResults — "The Ear on long clips"
// (grading-honesty packet, 2026-07-14). splitWavIntoChunks covers the ENTIRE
// clip (unlike trimWavToSeconds, which keeps only the first slice).
// ---------------------------------------------------------------------------

test('splitWavIntoChunks: a clip under maxSeconds is a single whole chunk', () => {
  const buffer = makeWavBuffer({ durationSeconds: 10 });
  const chunks = splitWavIntoChunks(buffer, 30);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sampledSeconds, 10);
  assert.equal(chunks[0].wav.length, buffer.byteLength);
});

test('splitWavIntoChunks: a 45s clip splits into a 30s chunk + a 15s chunk covering the FULL clip, byte-exact', () => {
  const buffer = makeWavBuffer({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationSeconds: 45 });
  const chunks = splitWavIntoChunks(buffer, 30);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].sampledSeconds, 30);
  assert.equal(chunks[1].sampledSeconds, 15);
  const original = new Uint8Array(buffer);
  const chunk0Bytes = 16000 * 2 * 30;
  assert.deepEqual(chunks[0].wav.subarray(44), original.subarray(44, 44 + chunk0Bytes));
  assert.deepEqual(chunks[1].wav.subarray(44), original.subarray(44 + chunk0Bytes));
  // Each chunk is itself a valid canonical WAV header.
  for (const c of chunks) {
    const view = new DataView(c.wav.buffer, c.wav.byteOffset, c.wav.byteLength);
    assert.equal(view.getUint32(4, true), c.wav.length - 8);
    assert.equal(view.getUint32(40, true), c.wav.length - 44);
  }
});

test('splitWavIntoChunks: a clip covering many chunks (e.g. a 105s presentation) produces one chunk per 30s, plus a remainder', () => {
  const buffer = makeWavBuffer({ durationSeconds: 105 });
  const chunks = splitWavIntoChunks(buffer, 30);
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks.map((c) => c.sampledSeconds), [30, 30, 30, 15]);
});

test('splitWavIntoChunks: junk/nonstandard input returns null, same constraints as trimWavToSeconds', () => {
  assert.equal(splitWavIntoChunks(new ArrayBuffer(10), 30), null);
  assert.equal(splitWavIntoChunks(null, 30), null);
  const badRiff = new Uint8Array(makeWavBuffer({ durationSeconds: 1 }));
  writeAscii(badRiff, 0, 'JUNK');
  assert.equal(splitWavIntoChunks(badRiff, 30), null);
});

test('mergeAzureChunkResults: duration-weighted average of PronScore/AccuracyScore/FluencyScore, Display concatenated in order, Words[] concatenated', () => {
  const merged = mergeAzureChunkResults([
    { best: { Display: 'Once upon a time', PronScore: 90, AccuracyScore: 92, FluencyScore: 88, Words: [{ Word: 'Once', AccuracyScore: 90 }] }, sampledSeconds: 30 },
    { best: { Display: 'there was a dog', PronScore: 60, AccuracyScore: 62, FluencyScore: 58, Words: [{ Word: 'dog', AccuracyScore: 60 }] }, sampledSeconds: 15 },
  ]);
  assert.equal(merged.Display, 'Once upon a time there was a dog');
  // weighted: (90*30 + 60*15) / 45 = 80
  assert.equal(merged.PronScore, 80);
  assert.equal(merged.AccuracyScore, (92 * 30 + 62 * 15) / 45);
  assert.equal(merged.FluencyScore, (88 * 30 + 58 * 15) / 45);
  assert.equal(merged.Words.length, 2);
  assert.equal(merged.sampledSeconds, 45);
});

test('mergeAzureChunkResults: empty/non-array input -> null, never throws', () => {
  assert.equal(mergeAzureChunkResults([]), null);
  assert.equal(mergeAzureChunkResults(null), null);
});
