import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_AUDIO_BYTES,
  EFFORT_ONLY_SCORE_CEILING,
  collectFlaggedWords,
  feedbackOpenVi,
  feedbackVi,
  inferAudioFilename,
  normalizePracticeWord,
  onRequestPost,
  resolveOpenAIApiKey,
  runSpeakingCheck,
  scoreOpenTranscript,
  scoreSpeechFrame,
  scoreTranscript,
  transcribeAudio,
  wordSimilarity,
  isLikelyContentMatch,
  deriveHomeworkVocabulary,
  findNearMissVocabularyWords,
  computeContentPrecision,
  hasLowContentRelevance,
  OPEN_NO_REFERENCE_SENTINELS,
} from '../functions/api/read2lead-speaking-check.js';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const speakingEndpoint = readFileSync('functions/api/read2lead-speaking-check.js', 'utf-8');

test('inferAudioFilename prefers MIME type over mismatched client filename', () => {
  const safariBlob = { name: 'audio.webm', type: 'audio/mp4' };
  assert.equal(inferAudioFilename(safariBlob), 'audio.mp4');

  const chromeBlob = { name: 'audio.webm', type: 'audio/webm' };
  assert.equal(inferAudioFilename(chromeBlob), 'audio.webm');

  const nameOnly = { name: 'audio.ogg', type: '' };
  assert.equal(inferAudioFilename(nameOnly), 'audio.ogg');
});

test('exact match → 100%', () => {
  const result = scoreTranscript(
    'Boy runs fast green park',
    'boy runs fast green park',
  );
  assert.equal(result.score_percent, 100);
  assert.equal(result.exact_count, 5);
  assert.equal(result.close_count, 0);
  assert.equal(result.correct_count, 5);
  assert.equal(result.total_count, 5);
  assert.deepEqual(result.words_exact, ['Boy', 'runs', 'fast', 'green', 'park']);
  assert.deepEqual(result.words_missed, []);
});

test('close words count as partial credit, not full 100%', () => {
  const result = scoreTranscript(
    'bird landed near him and pecked seed',
    'bird land near him and peck at seed',
  );
  assert.ok(result.close_count >= 1);
  assert.ok(result.score_percent < 100);
  assert.ok(result.exact_count < result.total_count);
  assert.deepEqual(result.words_close, result.words_close.filter(Boolean));
});

test('mispronounced words within threshold → counted as close', () => {
  const result = scoreTranscript('bird landed pecked', 'bird land peck');
  assert.equal(result.close_count, 2);
  assert.equal(result.exact_count, 1);
  assert.equal(result.score_percent, 67);
});

test('completely wrong words → counted missed', () => {
  const result = scoreTranscript('The boy runs fast in the park', 'hello world goodbye');
  assert.ok(result.words_missed.length >= 3);
  assert.ok(result.score_percent < 50);
});

test('skip words (the, a, is) not penalized', () => {
  const withArticles = scoreTranscript('The boy is a runner', 'boy runner');
  const withoutArticles = scoreTranscript('boy runner', 'boy runner');
  assert.equal(withArticles.total_count, withoutArticles.total_count);
  assert.equal(withArticles.score_percent, 100);
});

test('empty transcript → transcription_failed error', async () => {
  await assert.rejects(
    () =>
      runSpeakingCheck({
        audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
        expectedText: 'The boy runs fast',
        openaiApiKey: 'test-key',
        fetchFn: async () => ({
          ok: true,
          json: async () => ({ text: '   ' }),
        }),
      }),
    (error) => error.code === 'transcription_failed',
  );
});

test('OpenAI timeout → transcription_timeout error', async () => {
  await assert.rejects(
    () =>
      runSpeakingCheck({
        audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
        expectedText: 'The boy runs fast',
        openaiApiKey: 'test-key',
        fetchFn: async () => {
          const err = new Error('aborted');
          err.name = 'TimeoutError';
          throw err;
        },
      }),
    (error) => error.code === 'transcription_timeout',
  );
});

test('speaking endpoint caps the OpenAI call with a timeout', () => {
  assert.match(speakingEndpoint, /AbortSignal\.timeout/);
  assert.match(speakingEndpoint, /transcription_timeout/);
  assert.match(speakingEndpoint, /TRANSCRIBE_TIMEOUT_MS/);
  assert.doesNotMatch(speakingEndpoint, /groq/i);
});

test('audio too large → 413 rejected before calling OpenAI', async () => {
  let openaiCalled = false;
  const formData = new FormData();
  formData.append('access_code', 'R2L-TEST-1234');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'The boy runs fast');
  formData.append('audio', new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/webm' }), 'audio.webm');

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', {
      method: 'POST',
      body: formData,
    }),
    env: {
      READ2LEAD_CODES: {
        get: async () => ({
          progress: { current_pack: { pack_id: 'pack-1' } },
        }),
      },
      OPENAI_API_KEY: 'test-key',
    },
    fetchFn: async () => {
      openaiCalled = true;
      return { ok: true, json: async () => ({ text: 'the boy runs fast' }) };
    },
  });

  assert.equal(response.status, 413);
  assert.equal(openaiCalled, false);
});

test('invalid access_code → 404', async () => {
  const formData = new FormData();
  formData.append('access_code', 'R2L-MISSING-CODE');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'The boy runs fast');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', {
      method: 'POST',
      body: formData,
    }),
    env: {
      READ2LEAD_CODES: {
        get: async () => null,
      },
      OPENAI_API_KEY: 'test-key',
    },
  });

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error, 'code_not_found');
});

// ---------------------------------------------------------------------------
// speakup-word-level-feedback (V1, 2026-07-12): onRequestPost's best-effort
// flagged-words KV write, right before the response goes out. Local scorer
// (read mode) exercised here since it needs no Azure config; the frame-mode
// + Azure case lives below with its own fetch stub.
// ---------------------------------------------------------------------------

function makeFlaggedWordsKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const puts = [];
  return {
    store,
    puts,
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts?.type === 'json') return typeof raw === 'string' ? JSON.parse(raw) : raw;
      return raw;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

test('onRequestPost (read mode, local scorer): flags words_missed + words_close into a short-TTL KV record, lowercased', async () => {
  const kv = makeFlaggedWordsKv({
    'R2L-TEST-1234': JSON.stringify({ progress: { current_pack: { pack_id: 'pack-1' } } }),
  });

  const formData = new FormData();
  formData.append('access_code', 'r2l-test-1234'); // endpoint uppercases it
  formData.append('pack_id', 'pack-1');
  // Capitalized on purpose: scoreTranscript's words_close/words_missed carry
  // the EXPECTED word's raw case, so this also proves the write lowercases.
  formData.append('expected_text', 'Bird Landed near him and Pecked seed');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');

  const fakeAi = { async run() { return { text: 'bird land near him and peck at seed' }; } };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.words_close.length + payload.words_missed.length > 0, 'sanity: fixture produces non-exact words');

  const put = kv.puts.find((p) => p.key === 'flagged-words:R2L-TEST-1234');
  assert.ok(put, 'flagged-words record written');
  const value = JSON.parse(put.value);
  assert.deepEqual([...value.words].sort(), ['landed', 'pecked'], 'lowercased regardless of the expected text\'s original casing');
  assert.ok(Number.isFinite(value.at));
  assert.equal(put.options?.expirationTtl, 3600);
});

test('onRequestPost (read mode): a perfect-score attempt (no missed/close words) writes nothing', async () => {
  const kv = makeFlaggedWordsKv({
    'R2L-TEST-1234': JSON.stringify({ progress: { current_pack: { pack_id: 'pack-1' } } }),
  });

  const formData = new FormData();
  formData.append('access_code', 'r2l-test-1234');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'Boy runs fast green park');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');

  const fakeAi = { async run() { return { text: 'boy runs fast green park' }; } };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.score_percent, 100);

  assert.equal(kv.puts.find((p) => p.key.startsWith('flagged-words:')), undefined, 'no flagged words -> no write');
});

test('onRequestPost: a KV failure on the flagged-words write never breaks the scored response', async () => {
  const formData = new FormData();
  formData.append('access_code', 'r2l-test-1234');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'hello world goodbye');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');

  const fakeAi = { async run() { return { text: 'completely different words' }; } };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
    env: {
      READ2LEAD_CODES: {
        async get(key) {
          if (key === 'R2L-TEST-1234') return { progress: { current_pack: { pack_id: 'pack-1' } } };
          return null;
        },
        async put() { throw new Error('kv unavailable'); },
      },
      AI: fakeAi,
    },
  });

  assert.equal(response.status, 200, 'best-effort write failure must not surface as a request failure');
  const payload = await response.json();
  assert.equal(payload.ok, true);
});

// ---------------------------------------------------------------------------
// speakup-word-level-feedback fix round (2026-07-12, Elon ruling): a word
// carrying the original sentence's punctuation (e.g. "banana.") must still
// land in the flagged-words KV record as exactly the string minny-voice's
// own allowlist regex accepts ("banana"); anything that normalizes to
// nothing (an ASR artifact like "...") must never land in KV at all.
// ---------------------------------------------------------------------------

test('normalizePracticeWord: strips everything outside [a-z\'-] after lowercasing; drops empty or >30-char results', () => {
  assert.equal(normalizePracticeWord('banana.'), 'banana');
  assert.equal(normalizePracticeWord('DOG!'), 'dog');
  assert.equal(normalizePracticeWord("don't"), "don't", 'apostrophe preserved — matches minny-voice\'s own allowlist');
  assert.equal(normalizePracticeWord('well-known'), 'well-known', 'hyphen preserved');
  assert.equal(normalizePracticeWord('...'), '', 'punctuation-only input normalizes to empty');
  assert.equal(normalizePracticeWord(''), '');
  assert.equal(normalizePracticeWord(null), '');
  assert.equal(normalizePracticeWord('a'.repeat(31)), '', 'over minny-voice\'s 30-char cap once stripped is dropped');
  assert.equal(normalizePracticeWord('a'.repeat(30)), 'a'.repeat(30), 'exactly 30 chars is kept');
});

test('collectFlaggedWords: normalizes every entry via normalizePracticeWord and drops entries that become empty', () => {
  const result = {
    words_missed: ['banana.', '...', 'Dog!'],
    words_close: [],
    pronunciation: { words: [{ word: '...', accuracy_percent: 10 }, { word: 'RAN', accuracy_percent: 20 }] },
  };
  assert.deepEqual([...collectFlaggedWords(result)].sort(), ['banana', 'dog', 'ran']);
});

test('collectFlaggedWords: empty result when every candidate normalizes away', () => {
  assert.deepEqual(collectFlaggedWords({ words_missed: ['...', '???'], words_close: [] }), []);
});

test('onRequestPost (read mode): a homework word carrying trailing punctuation ("banana.") lands in the flagged-words KV record normalized ("banana")', async () => {
  const kv = makeFlaggedWordsKv({
    'R2L-TEST-1234': JSON.stringify({ progress: { current_pack: { pack_id: 'pack-1' } } }),
  });

  const formData = new FormData();
  formData.append('access_code', 'r2l-test-1234');
  formData.append('pack_id', 'pack-1');
  formData.append('expected_text', 'banana. is yummy');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');

  const fakeAi = { async run() { return { text: 'yummy time now' }; } };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
    env: { READ2LEAD_CODES: kv, AI: fakeAi },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.words_missed.includes('banana.'), 'sanity: the raw missed word from scoreTranscript still carries the period');

  const put = kv.puts.find((p) => p.key === 'flagged-words:R2L-TEST-1234');
  assert.ok(put, 'flagged-words record written');
  const value = JSON.parse(put.value);
  assert.deepEqual(value.words, ['banana'], 'stored normalized — no trailing period, matching minny-voice\'s own allowlist regex');
});

function writeFrameWavAscii(bytes, offset, str) {
  for (let i = 0; i < str.length; i += 1) bytes[offset + i] = str.charCodeAt(i);
}

function makeFrameWavBlob(durationSeconds) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(byteRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + dataSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  writeFrameWavAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeFrameWavAscii(bytes, 8, 'WAVE');
  writeFrameWavAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeFrameWavAscii(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

test('onRequestPost (frame mode + Azure): pronunciation.words[] land in the same flagged-words KV record, normalized; a word that normalizes to empty is dropped, not stored', async () => {
  const kv = makeFlaggedWordsKv({
    'R2L-FRAME-0001': JSON.stringify({ progress: { current_pack: { pack_id: 'pack-1' } } }),
  });

  const FRAME_NBEST = {
    RecognitionStatus: 'Success',
    NBest: [{
      Display: 'The dog ran.',
      PronScore: 60,
      AccuracyScore: 60,
      FluencyScore: 60,
      Words: [
        { Word: 'dog', ErrorType: 'Mispronunciation', AccuracyScore: 40 },
        { Word: '...', ErrorType: 'None', AccuracyScore: 10 }, // ASR artifact -- normalizes to empty
      ],
    }],
  };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(FRAME_NBEST), { status: 200 });

    const formData = new FormData();
    formData.append('access_code', 'r2l-frame-0001');
    formData.append('pack_id', 'pack-1');
    formData.append('check_mode', 'frame');
    formData.append('stems', JSON.stringify([]));
    formData.append('max_seconds', '60');
    formData.append('audio', makeFrameWavBlob(10), 'audio.wav');

    const fakeAi = { async run() { return { text: 'The dog ran.' }; } };

    const response = await onRequestPost({
      request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
      env: {
        READ2LEAD_CODES: kv,
        AI: fakeAi,
        AZURE_SPEECH_KEY: 'k',
        AZURE_SPEECH_REGION: 'southeastasia',
      },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(
      payload.pronunciation?.words?.some((w) => w.word === '...'),
      'sanity: mapper still surfaces the punctuation-only ASR word (the length check alone lets it through)',
    );

    const put = kv.puts.find((p) => p.key === 'flagged-words:R2L-FRAME-0001');
    assert.ok(put, 'flagged-words record written from the one word that normalizes to something');
    const value = JSON.parse(put.value);
    assert.deepEqual(value.words, ['dog'], '"..." never lands in the KV record');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost (frame mode + Azure): when every pronunciation word normalizes to empty, nothing is written at all', async () => {
  const kv = makeFlaggedWordsKv({
    'R2L-FRAME-0002': JSON.stringify({ progress: { current_pack: { pack_id: 'pack-1' } } }),
  });

  const FRAME_NBEST = {
    RecognitionStatus: 'Success',
    NBest: [{
      Display: '...',
      PronScore: 20,
      AccuracyScore: 20,
      FluencyScore: 20,
      Words: [{ Word: '...', ErrorType: 'None', AccuracyScore: 10 }],
    }],
  };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(FRAME_NBEST), { status: 200 });

    const formData = new FormData();
    formData.append('access_code', 'r2l-frame-0002');
    formData.append('pack_id', 'pack-1');
    formData.append('check_mode', 'frame');
    formData.append('stems', JSON.stringify([]));
    formData.append('max_seconds', '60');
    formData.append('audio', makeFrameWavBlob(10), 'audio.wav');

    const fakeAi = { async run() { return { text: '...' }; } };

    const response = await onRequestPost({
      request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
      env: {
        READ2LEAD_CODES: kv,
        AI: fakeAi,
        AZURE_SPEECH_KEY: 'k',
        AZURE_SPEECH_REGION: 'southeastasia',
      },
    });

    assert.equal(response.status, 200);
    assert.equal(kv.puts.find((p) => p.key.startsWith('flagged-words:')), undefined, 'no valid words -> no write at all');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('score_percent thresholds → correct feedback_vi string', () => {
  assert.equal(feedbackVi(95), 'Tuyệt vời! Con đọc cực kỳ rõ ràng!');
  assert.equal(feedbackVi(78), 'Giỏi lắm! Con đọc được hầu hết các từ rồi!');
  assert.equal(feedbackVi(55), 'Cố lên! Con đang tiến bộ rất tốt!');
  assert.equal(feedbackVi(20), 'Không sao, thử lại nào! Đọc to hơn một chút nhé!');
});

test('wordSimilarity treats near matches as close', () => {
  assert.ok(wordSimilarity('runs', 'run') >= 0.5);
  assert.ok(wordSimilarity('park', 'park') === 1);
});

// ---------------------------------------------------------------------------
// isLikelyContentMatch — Buffet's reject finding 1 (2026-07-14, revision 2).
// Raw wordSimilarity (above) is fine for read-aloud partial credit but is
// NOT what content-grounding/near-miss code should use directly — see the
// function's own header. Buffet's exact probe list from the reject report.
// ---------------------------------------------------------------------------

test('isLikelyContentMatch: short-word rhyme pairs are never a match, regardless of raw similarity (Buffet\'s reject probes)', () => {
  assert.equal(isLikelyContentMatch('park', 'dark'), false, 'wordSimilarity is 0.75 but this is a false accusation');
  assert.equal(isLikelyContentMatch('cat', 'hat'), false);
  assert.equal(isLikelyContentMatch('book', 'look'), false, 'wordSimilarity is 0.75');
  assert.equal(isLikelyContentMatch('sing', 'ring'), false, 'wordSimilarity is 0.75');
});

test('isLikelyContentMatch: real typos/mishearings still match (Buffet\'s reject probes)', () => {
  assert.equal(isLikelyContentMatch('hapy', 'happy'), true);
  assert.equal(isLikelyContentMatch('becase', 'because'), true);
  assert.equal(isLikelyContentMatch('footbal', 'football'), true);
});

test('isLikelyContentMatch: 5-6 letter words also need the first-letter tiebreak — house/mouse (0.8, first letters differ) does not match', () => {
  assert.equal(wordSimilarity('house', 'mouse'), 0.8, 'sanity check: raw similarity alone would pass the 0.8 bucket floor');
  assert.equal(isLikelyContentMatch('house', 'mouse'), false);
});

test('isLikelyContentMatch: the packet\'s own genuine near-miss fixture ("pack" heard for "park") still matches at length 4', () => {
  assert.equal(isLikelyContentMatch('pack', 'park'), true, 'same first letter, 0.75 similarity — a real likely mis-hearing, not a rhyme');
});

test('isLikelyContentMatch: identical words and empty inputs', () => {
  assert.equal(isLikelyContentMatch('park', 'park'), true);
  assert.equal(isLikelyContentMatch('', 'park'), false);
  assert.equal(isLikelyContentMatch('park', ''), false);
});

test('speaking endpoint runs Whisper inside Cloudflare first, OpenAI as fallback', () => {
  // Workers AI primary — direct OpenAI/Groq calls from VN-serving colos get
  // geo-blocked (403 unsupported_country_region_territory).
  assert.match(speakingEndpoint, /@cf\/openai\/whisper-large-v3-turbo/);
  assert.match(speakingEndpoint, /env\.AI/);
  // OpenAI kept as fallback when the AI binding is absent or errors.
  assert.match(speakingEndpoint, /whisper-1/);
  assert.match(speakingEndpoint, /api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.match(speakingEndpoint, /OPENAI_API_KEY/);
  assert.match(speakingEndpoint, /READ2LEAD_OPENAI_API_KEY/);
  assert.doesNotMatch(speakingEndpoint, /groq/i);
});

test('resolveOpenAIApiKey accepts either env var name', () => {
  assert.equal(resolveOpenAIApiKey({ OPENAI_API_KEY: 'a' }), 'a');
  assert.equal(resolveOpenAIApiKey({ READ2LEAD_OPENAI_API_KEY: 'b' }), 'b');
  assert.equal(resolveOpenAIApiKey({}), '');
});

test('transcribeAudio uses Workers AI when bound (no geo-blockable egress)', async () => {
  let model = '';
  let gotBase64 = false;
  const text = await transcribeAudio(new Blob(['audio'], { type: 'audio/webm' }), {
    ai: {
      run: async (m, input) => {
        model = m;
        gotBase64 = typeof input.audio === 'string' && input.audio.length > 0;
        return { text: 'hello world' };
      },
    },
  });
  assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
  assert.equal(gotBase64, true);
  assert.equal(text, 'hello world');
});

test('transcribeAudio falls back to OpenAI when Workers AI fails', async () => {
  let url = '';
  const text = await transcribeAudio(new Blob(['audio'], { type: 'audio/webm' }), {
    ai: { run: async () => { throw new Error('capacity'); } },
    openaiApiKey: 'openai-key',
    fetchFn: async (target) => {
      url = String(target);
      return {
        ok: true,
        json: async () => ({ text: 'hello world' }),
      };
    },
  });
  assert.match(url, /api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.equal(text, 'hello world');
});

test('transcribeAudio without any provider → config_error', async () => {
  await assert.rejects(
    () => transcribeAudio(new Blob(['audio'], { type: 'audio/webm' }), {}),
    (error) => error.code === 'config_error',
  );
});

test('open response scores story relevance instead of read-aloud match', () => {
  const result = scoreOpenTranscript(
    'I liked when Pilot holds the rabbit softly and walks the dog',
    'Pilot learns how to hold the rabbit softly and feed the turtle with small leaves.',
  );
  assert.equal(result.check_mode, 'open');
  assert.ok(result.words_matched.length >= 2);
  assert.ok(result.score_percent >= 35);
  assert.match(result.feedback_vi, /Minny|truyện|Giỏi|Hay/);
});

test('open response feedback thresholds', () => {
  assert.match(feedbackOpenVi(85), /Hay quá/);
  assert.match(feedbackOpenVi(60), /Minny thấy con hiểu/);
  assert.match(feedbackOpenVi(40), /Thử nói thêm/);
});

test('runSpeakingCheck supports open check_mode', async () => {
  const payload = await runSpeakingCheck({
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    expectedText: 'Pilot walks the dog in the park every morning.',
    checkMode: 'open',
    openaiApiKey: 'test-key',
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ text: 'Pilot walks the dog every morning because he likes animals.' }),
    }),
  });
  assert.equal(payload.check_mode, 'open');
  assert.ok(payload.score_percent >= 35);
});

test('lesson page wires legacy speaking and book read-aloud through the speaking check', () => {
  assert.match(lessonPage, /listen_and_speak/);
  assert.match(lessonPage, /read_aloud/);
  assert.match(lessonPage, /BOOK_ACTIVITY_ORDER/);
  assert.match(lessonPage, /read2lead-speaking-check/);
  assert.match(lessonPage, /function renderSpeakActivity/);
  assert.match(lessonPage, /_r2lMicIsReady/);
  assert.match(lessonPage, /data-speak-feedback/);
  assert.doesNotMatch(lessonPage, /speaking-check-section/);
});

// ===========================================================================
// Grading-honesty packet (2026-07-14) — 13-row live battery acceptance.
// ===========================================================================

// Mirrors the real battery scenario: a build task (shared vocabulary with
// the photo answer) + a bare zero-anchor picture task (the photo_talk step).
const BATTERY_HOMEWORK = {
  schema_version: 3,
  tasks: [
    {
      id: 't_build', type: 'build', sentences_required: 2,
      columns: [
        { id: 'c1', label_en: 'We...', options: ['play football', 'draw pictures', 'eat snacks'] },
        { id: 'c2', label_en: 'At...', options: ['school', 'the park', 'break time'] },
        { id: 'c3', label_en: 'we feel...', options: ['happy', 'excited', 'relaxed'] },
        { id: 'c4', label_en: 'because...', options: ['it is fun', 'we learn new things', 'we laugh a lot'] },
      ],
    },
    { id: 't_picture', type: 'picture', anchors: [], duration_s: 60 },
  ],
};

// ---------------------------------------------------------------------------
// deriveHomeworkVocabulary
// ---------------------------------------------------------------------------

test('deriveHomeworkVocabulary: pulls build columns\' label_en + options, drops picture anchors (the answer key)', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  for (const word of ['play', 'football', 'school', 'park', 'happy', 'fun', 'draw', 'pictures', 'eat', 'snacks']) {
    assert.ok(vocab.includes(word), `expected "${word}" in derived vocabulary`);
  }
  assert.equal(vocab.includes('the'), false, 'SKIP_WORDS excluded');
});

test('deriveHomeworkVocabulary: read items, present/qa anchor_words, story must_use all contribute', () => {
  const homework = {
    schema_version: 3,
    tasks: [
      { id: 't1', type: 'read', items: [{ id: 's1', text_en: 'I have two cats.' }] },
      { id: 't2', type: 'present', stems: [{ id: 'f1', text_en: 'Last summer, I went to ___.', anchor_words: ['last', 'summer', 'went'] }], duration_s: 60 },
      { id: 't3', type: 'story', prompt_en: 'Tell a story.', prompt_vi: '', must_use: ['because', 'friend'], duration_s: 90, use_photo: false },
      { id: 't4', type: 'qa', cards: [{ id: 'q1', question_en: 'Is it fun?', stem: { text_en: 'Yes, it is ___.', anchor_words: ['yes'] } }], duration_s: 30 },
    ],
  };
  const vocab = deriveHomeworkVocabulary(homework);
  for (const word of ['cats', 'summer', 'went', 'because', 'friend', 'fun', 'yes']) {
    assert.ok(vocab.includes(word), `expected "${word}"`);
  }
});

test('deriveHomeworkVocabulary: no homework / empty tasks -> [] (the bare-photo live case)', () => {
  assert.deepEqual(deriveHomeworkVocabulary(null), []);
  assert.deepEqual(deriveHomeworkVocabulary(undefined), []);
  assert.deepEqual(deriveHomeworkVocabulary({ schema_version: 3, tasks: [] }), []);
  assert.deepEqual(deriveHomeworkVocabulary({ schema_version: 3, tasks: [{ id: 't_picture', type: 'picture', anchors: [], duration_s: 60 }] }), []);
});

test('deriveHomeworkVocabulary: legacy v1/v2 .sentences upgrades via normalizeHomeworkRecord', () => {
  const legacy = { schema_version: 2, sentences: [{ id: 's1', text_en: 'The dog runs fast.' }], frame: null, photo: null, photo_talk: null };
  const vocab = deriveHomeworkVocabulary(legacy);
  assert.ok(vocab.includes('dog'));
  assert.ok(vocab.includes('runs'));
  assert.ok(vocab.includes('fast'));
});

// ---------------------------------------------------------------------------
// findNearMissVocabularyWords — row 13's "grid-grounded" detection
// ---------------------------------------------------------------------------

test('findNearMissVocabularyWords: "pack" resembles the vocabulary word "park" (row 13)', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const near = findNearMissVocabularyWords('We play football at the Pack. We feel happy because it is fun.', vocab);
  const match = near.find((n) => n.said === 'pack');
  assert.ok(match, 'pack flagged as a near-miss');
  assert.equal(match.nearest, 'park');
});

test('findNearMissVocabularyWords: an exact vocabulary word is never flagged', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const near = findNearMissVocabularyWords('We play football at the park.', vocab);
  assert.equal(near.find((n) => n.said === 'park'), undefined);
});

test('findNearMissVocabularyWords: a word unrelated to any vocabulary word is not flagged (no false accusation)', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const near = findNearMissVocabularyWords('We saw a giant dinosaur yesterday.', vocab);
  assert.equal(near.length, 0);
});

test('findNearMissVocabularyWords: empty vocabulary -> [] (never throws)', () => {
  assert.deepEqual(findNearMissVocabularyWords('anything at all', []), []);
});

test('findNearMissVocabularyWords / scoreOpenTranscript: Buffet\'s reject repro — "dark" is never flagged as a near-miss of "park", nor credited as words_matched (finding 1, live vocabulary)', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK); // includes park, happy, football, school
  const transcript = 'We went to a dark place and had a great time every single day';
  const near = findNearMissVocabularyWords(transcript, vocab);
  assert.equal(near.find((n) => n.nearest === 'park'), undefined, '"dark" must not be flagged as a near-miss of "park" — false accusation');

  const scored = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(scored.words_matched.includes('park'), false, 'the child never said "park" — no green-chip credit for "dark"');
});

// ---------------------------------------------------------------------------
// Founder ruling, 2026-07-15 (exact-only score credit; see CONTROL.md's
// Current Task block) — round-1/2's live-reproduced boundary probes, at the
// full scoreOpenTranscript level. These pairs are trivially zero-credit now
// that fuzzy/commonness-gated credit is retired entirely: only an exact
// normalized match can light up words_matched. Candidates may still exist
// (near_miss_words is not asserted away here — that is correct behaviour,
// unchanged coaching-layer output via findNearMissVocabularyWords); what
// must never happen is score/words_matched credit for a word the child did
// not say.
// ---------------------------------------------------------------------------

test('scoreOpenTranscript: Buffet\'s live repro — "pork" (ordinary, intentional food word) never credits "park"', () => {
  const vocab = ['park', 'happy', 'football', 'school'];
  const transcript = 'We ate pork for dinner and it was happy time with my family every single day';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(result.words_matched.includes('park'), false, 'the child said "pork" (food), not "park" — no false credit');
});

test('scoreOpenTranscript: Buffet\'s live repro — "horse" never credits "house"', () => {
  const vocab = ['house', 'garden', 'family'];
  const transcript = 'I saw a horse running in the garden with my family yesterday afternoon';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(result.words_matched.includes('house'), false, 'the child said "horse" (animal), not "house" — no false credit');
});

test('scoreOpenTranscript: Buffet\'s live repro — "bell" never credits "ball"', () => {
  const vocab = ['ball', 'game', 'friend'];
  const transcript = 'I heard the bell ring and then played with my friend after the game';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(result.words_matched.includes('ball'), false, 'the child said "bell" (heard it ring), not "ball" — no false credit');
});

test('scoreOpenTranscript: full boundary-probe sweep — every Buffet round-2 pair earns zero words_matched credit, said as the sole transcript content word against its neighbor as the sole vocabulary word', () => {
  const pairs = [
    ['pork', 'park'], ['ball', 'bell'], ['bell', 'ball'],
    ['house', 'horse'], ['horse', 'house'],
    ['mouse', 'moose'], ['moose', 'mouse'],
    ['ship', 'shop'], ['shop', 'ship'],
    ['fill', 'fall'], ['fall', 'fill'],
    ['dark', 'park'], ['cat', 'hat'], ['book', 'look'], ['sing', 'ring'],
  ];
  for (const [said, vocabWord] of pairs) {
    const result = scoreOpenTranscript(`I really like the ${said} a lot today`, 'photo_talk', { homeworkVocabulary: [vocabWord] });
    assert.equal(result.words_matched.includes(vocabWord), false, `"${said}" must not credit "${vocabWord}"`);
  }
});

// Founder ruling, 2026-07-15 (exact-only score credit — supersedes this
// packet's earlier "hapy/becase/footbal still credit" clause). Misspellings
// and mis-transcriptions no longer earn automatic score/words_matched
// credit; near-miss handling moves entirely to the coaching layer
// (findNearMissVocabularyWords), which stays unaffected since it still uses
// isLikelyContentMatch. Verified empirically before asserting: all three
// tokens do surface as near-miss candidates for their intended word.
test('scoreOpenTranscript: misspellings/mis-transcriptions no longer credit (founder ruling, 2026-07-15) — but still surface as near-miss CANDIDATES for coaching', () => {
  const vocab = ['happy', 'because', 'football'];
  const transcript = 'We are hapy becase footbal is so much fun';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(result.words_matched.includes('happy'), false, 'hapy -> happy no longer credits (exact-only)');
  assert.equal(result.words_matched.includes('because'), false, 'becase -> because no longer credits (exact-only)');
  assert.equal(result.words_matched.includes('football'), false, 'footbal -> football no longer credits (exact-only)');

  const near = findNearMissVocabularyWords(transcript, vocab);
  assert.ok(near.some((n) => n.said === 'hapy' && n.nearest === 'happy'), 'hapy still surfaces as a near-miss candidate for happy');
  assert.ok(near.some((n) => n.said === 'becase' && n.nearest === 'because'), 'becase still surfaces as a near-miss candidate for because');
  assert.ok(near.some((n) => n.said === 'footbal' && n.nearest === 'football'), 'footbal still surfaces as a near-miss candidate for football');
});

test('scoreOpenTranscript: computeContentPrecision-level regression — "pack" no longer inflates content_relevance_percent the way it did pre-v3 (exact-only ruling)', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const transcript = 'We play football at the Pack. We feel happy because it is fun.';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  // "pack" is excluded from the precision numerator now (exact-only ruling);
  // this is a precision measure over 7 content words (play, football, pack,
  // feel, happy, because, fun) with 5 real exact vocabulary hits — informative
  // regression guard, not a spec'd exact number.
  assert.ok(result.content_relevance_percent < 100, 'pack must not count as a vocabulary hit');
  assert.ok(result.content_relevance_percent >= 60, `still comfortably high on an otherwise-correct answer, got ${result.content_relevance_percent}`);
});

// ---------------------------------------------------------------------------
// Permanent regression tests, founder ruling 2026-07-15 (exact-only score
// credit — see CONTROL.md's Current Task block). Buffet's round-3 report
// live-reproduced the commonness gate's own leak through the real
// scoreOpenTranscript pipeline: a DIFFERENT real word the child actually
// said was earning false score credit for a homework vocabulary word it
// merely resembled. These are Buffet's exact repro cases, kept as permanent
// regressions now that fuzzy/commonness-gated credit is retired entirely.
// ---------------------------------------------------------------------------

test('scoreOpenTranscript: Buffet\'s round-3 finding 1 live repro — "housework" never credits "homework" (founder exact-only ruling, 2026-07-15)', () => {
  const result = scoreOpenTranscript(
    'I had to finish my housework before I could go outside and play',
    'photo_talk',
    { homeworkVocabulary: ['homework', 'family', 'school'] },
  );
  assert.equal(result.words_matched.includes('homework'), false, 'the child said "housework", not "homework" — no false credit');
});

test('scoreOpenTranscript: Buffet\'s round-3 repro — "speakers" never credits "sneakers", but an exact match ("party") still credits (founder exact-only ruling, 2026-07-15)', () => {
  const result = scoreOpenTranscript(
    'The speakers were so loud at the party last night',
    'photo_talk',
    { homeworkVocabulary: ['sneakers', 'party', 'music'] },
  );
  assert.equal(result.words_matched.includes('sneakers'), false, 'the child said "speakers", not "sneakers" — no false credit');
  assert.ok(result.words_matched.includes('party'), 'the child said "party" exactly — exact matches must still credit');
});

test('scoreOpenTranscript: Buffet\'s round-3 leak-list spot check — "backspace" never credits "backpack" (founder exact-only ruling, 2026-07-15)', () => {
  const result = scoreOpenTranscript(
    'I put my pencil in my backspace this morning',
    'photo_talk',
    { homeworkVocabulary: ['backpack', 'pencil', 'school'] },
  );
  assert.equal(result.words_matched.includes('backpack'), false, 'the child said "backspace", not "backpack" — no false credit');
  assert.ok(result.words_matched.includes('pencil'), 'the child said "pencil" exactly — exact matches must still credit');
});

// ---------------------------------------------------------------------------
// scoreOpenTranscript — sentinel-aware content grounding (rows 1, 3, 13)
// ---------------------------------------------------------------------------

test('scoreOpenTranscript: sentinel text itself is never treated as content — no bogus "phototalk"/"freetalkingnoscore" keyword', () => {
  // Before this packet, scoreOpenTranscript(transcript, 'photo_talk') greped
  // the literal sentinel string for keywords ("phototalk"), which a real
  // transcript could never contain -> relevance always 0. Confirm the
  // sentinel path with NO vocabulary degrades to pure effort, not a
  // relevance-zeroed ceiling.
  const result = scoreOpenTranscript('We play football at the park and have a great time every day', 'photo_talk');
  assert.equal(result.graded_against, 'pronunciation_effort');
  // Revision 2 (2026-07-14, Buffet's reject finding 2) added
  // EFFORT_ONLY_SCORE_CEILING as defense in depth: this exact branch has NO
  // content basis (gibberish scored 100 + top praise through it before the
  // fix), so it is now capped well below top praise regardless of how long
  // or genuine the answer is — no fake-keyword ceiling (the original bug
  // this test guarded against), but also no gibberish-reaches-100 hole.
  assert.equal(result.score_percent, EFFORT_ONLY_SCORE_CEILING, 'capped below top praise, not the old fake-keyword ceiling either');
  assert.doesNotMatch(result.feedback_vi, /Hay quá/, 'an effort-only score must never trigger top-tier praise');
});

test('scoreOpenTranscript row 1: perfect on-topic English against real homework vocabulary scores HIGH, not 45', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const transcript = 'We play football at the park. We feel happy because it is fun. We draw pictures at school.';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(result.graded_against, 'homework_content');
  assert.ok(result.score_percent >= 70, `expected >=70, got ${result.score_percent}`);
});

test('scoreOpenTranscript row 3: gibberish against real homework vocabulary scores LOW, not a pronunciation-only 81', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const transcript = 'Slum Backs, Joe Tab was Appendix, Smurf, Vinyl Craft, Sybil Morfin, Generalplan, Frumpy.';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal(result.graded_against, 'homework_content');
  assert.ok(result.score_percent <= 40, `expected <=40, got ${result.score_percent}`);
});

test('scoreOpenTranscript: no derivable vocabulary + an Azure pronunciation score -> blended effort+pronunciation, graded_against pronunciation_effort', () => {
  const shortTranscript = 'I like apples';
  const result = scoreOpenTranscript(shortTranscript, 'photo_talk', { homeworkVocabulary: [], azurePronunciationPercent: 88 });
  assert.equal(result.graded_against, 'pronunciation_effort');
  const expectedEffort = Math.min(100, Math.round((3 / 10) * 100));
  assert.equal(result.score_percent, Math.round(expectedEffort * 0.45 + 88 * 0.55));
});

test('scoreOpenTranscript: genuine story-context scoring (non-sentinel) carries no graded_against field — contract unchanged', () => {
  const result = scoreOpenTranscript(
    'I liked when Pilot holds the rabbit softly and walks the dog',
    'Pilot learns how to hold the rabbit softly and feed the turtle with small leaves.',
  );
  assert.equal('graded_against' in result, false);
  assert.equal('near_miss_words' in result, false);
});

test('scoreOpenTranscript row 13: a near-miss word attaches near_miss_words and steps the praise tone down, but does not tank the score', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const transcript = 'We play football at the Pack. We feel happy because it is fun.';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.ok(result.near_miss_words?.length, 'pack/park near-miss surfaced');
  assert.equal(result.near_miss_words[0].said, 'pack');
  assert.equal(result.near_miss_words[0].nearest, 'park');
  assert.ok(result.score_percent >= 70, 'one near-miss word must not tank an otherwise-perfect score');
  assert.doesNotMatch(result.feedback_vi, /Hay quá/, 'top-tier praise must not fire when a word was flagged');
});

test('scoreOpenTranscript: a clean recording against real vocabulary has zero near_miss_words and gets the top praise tier', () => {
  const vocab = deriveHomeworkVocabulary(BATTERY_HOMEWORK);
  const transcript = 'We play football at the park. We feel happy because it is fun.';
  const result = scoreOpenTranscript(transcript, 'photo_talk', { homeworkVocabulary: vocab });
  assert.equal('near_miss_words' in result, false);
  assert.match(result.feedback_vi, /Hay quá/);
});

test('OPEN_NO_REFERENCE_SENTINELS contains exactly the two known sentinels', () => {
  assert.equal(OPEN_NO_REFERENCE_SENTINELS.has('photo_talk'), true);
  assert.equal(OPEN_NO_REFERENCE_SENTINELS.has('free_talking_no_score'), true);
  assert.equal(OPEN_NO_REFERENCE_SENTINELS.has('a real story about a rabbit'), false);
});

test('computeContentPrecision: fraction of the TRANSCRIPT\'s own content words that are real vocabulary — precision, not recall', () => {
  const vocab = ['play', 'football', 'park', 'happy'];
  // Only 2 of 4 vocabulary words are used, but 100% of what was SAID is real
  // vocabulary — a menu of alternatives must not punish this as low relevance.
  assert.equal(computeContentPrecision('We play football', vocab), 100);
});

test('computeContentPrecision: gibberish that shares nothing with the vocabulary scores 0', () => {
  const vocab = ['play', 'football', 'park', 'happy'];
  assert.equal(computeContentPrecision('Slum backs joe tab appendix smurf', vocab), 0);
});

test('computeContentPrecision: one coincidental common-word match among many irrelevant words stays low, not a false "relevant"', () => {
  const vocab = ['play', 'football', 'park', 'happy', 'because', 'fun', 'new'];
  const precision = computeContentPrecision('You entered ABBA Malcolm being vitamin paid video click new version bank', vocab);
  assert.ok(precision < 20, `expected a low precision, got ${precision}`);
});

test('computeContentPrecision: empty vocabulary or empty transcript -> 0, never throws', () => {
  assert.equal(computeContentPrecision('hello world', []), 0);
  assert.equal(computeContentPrecision('', ['play']), 0);
});

// ---------------------------------------------------------------------------
// hasLowContentRelevance — the VN-redirect trigger (row 4)
// ---------------------------------------------------------------------------

test('hasLowContentRelevance: homework_content + near-zero content_relevance_percent -> true regardless of score (row 4: fluent Vietnamese must redirect even if Azure liked the pronunciation)', () => {
  assert.equal(hasLowContentRelevance({ graded_against: 'homework_content', content_relevance_percent: 8, score_percent: 80 }), true);
});

test('hasLowContentRelevance: homework_content + high content_relevance_percent -> false (row 1: genuine English never redirects)', () => {
  assert.equal(hasLowContentRelevance({ graded_against: 'homework_content', content_relevance_percent: 100, score_percent: 20 }), false);
});

test('hasLowContentRelevance: homework_content + missing content_relevance_percent -> treated as 0 (never throws, defensive default)', () => {
  assert.equal(hasLowContentRelevance({ graded_against: 'homework_content', score_percent: 90 }), true);
});

test('hasLowContentRelevance: pronunciation_effort (no vocabulary) falls back to the original score<20 gate, unchanged', () => {
  assert.equal(hasLowContentRelevance({ graded_against: 'pronunciation_effort', score_percent: 19 }), true);
  assert.equal(hasLowContentRelevance({ graded_against: 'pronunciation_effort', score_percent: 20 }), false);
});

// ---------------------------------------------------------------------------
// scoreSpeechFrame — zero-anchor carve-out (row 8)
// ---------------------------------------------------------------------------

test('scoreSpeechFrame row 8: a zero-anchor stem with an EMPTY transcript is not an automatic 100', () => {
  const result = scoreSpeechFrame('', [{ id: 'story', text_en: 'Tell a story.', anchor_words: [] }], 90, {});
  assert.equal(result.stems[0].coveragePct, 0);
  assert.equal(result.stems[0].matched, false);
  assert.equal(result.matchPct, 0, 'not an auto-100');
});

test('scoreSpeechFrame: a zero-anchor stem still rewards genuine spoken effort (matched once enough words were said)', () => {
  const longTranscript = 'Once upon a time there was a happy dog who loved to run in the park every single day';
  const result = scoreSpeechFrame(longTranscript, [{ id: 'story', text_en: 'Tell a story.', anchor_words: [] }], 90, {});
  assert.equal(result.stems[0].matched, true);
  assert.ok(result.stems[0].coveragePct >= 50);
});

test('scoreSpeechFrame: zero-anchor stem mixed with a real-anchor stem — only the zero-anchor one uses the effort carve-out', () => {
  const transcript = 'I saw a big dog and a park';
  const stems = [
    { id: 'f1', text_en: 'I saw ___.', anchor_words: ['dog', 'park'] },
    { id: 'story', text_en: 'Tell a story.', anchor_words: [] },
  ];
  const result = scoreSpeechFrame(transcript, stems, 60, {});
  assert.equal(result.stems[0].coveragePct, 100, 'real-anchor stem unaffected by the carve-out');
  assert.ok(result.stems[1].coveragePct > 0, 'zero-anchor stem scored on effort, not auto-100');
});

// ---------------------------------------------------------------------------
// feedbackVi / feedbackOpenVi — praise-copy honesty (design point 7)
// ---------------------------------------------------------------------------

test('feedbackVi: a flagged word steps the top-tier praise down one level, never claims "cực kỳ rõ ràng"', () => {
  assert.match(feedbackVi(96, false), /Tuyệt vời! Con đọc cực kỳ rõ ràng!/);
  const stepped = feedbackVi(96, true);
  assert.doesNotMatch(stepped, /cực kỳ rõ ràng/);
  assert.match(stepped, /Giỏi lắm/);
});

test('feedbackVi: default hasFlaggedWord is false — existing one-arg call sites are unchanged', () => {
  assert.match(feedbackVi(96), /cực kỳ rõ ràng/);
});

test('feedbackOpenVi: a flagged word steps the top-tier praise down one level, never claims "rất tốt" top tier', () => {
  assert.match(feedbackOpenVi(90, false), /Hay quá/);
  const stepped = feedbackOpenVi(90, true);
  assert.doesNotMatch(stepped, /Hay quá/);
  assert.match(stepped, /Giỏi lắm/);
});

// ---------------------------------------------------------------------------
// runSpeakingCheck integration — Whisper-transcribed open path with homework
// vocabulary (rows 1/3/4 without Azure configured, i.e. the non-WAV / no-key
// fallback path also gets the honesty fix, not just the Azure-eligible one).
// ---------------------------------------------------------------------------

function fakeAiFixedText(text) {
  return { async run() { return { text }; } };
}

test('runSpeakingCheck (Whisper path): perfect on-topic photo answer against real homework vocabulary scores high', async () => {
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    ai: fakeAiFixedText('We play football at the park. We feel happy because it is fun. We draw pictures at school.'),
    homework: BATTERY_HOMEWORK,
  });
  assert.equal(result.graded_against, 'homework_content');
  assert.ok(result.score_percent >= 70, `expected >=70, got ${result.score_percent}`);
});

test('runSpeakingCheck (Whisper path): gibberish photo answer against real homework vocabulary scores low', async () => {
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    ai: fakeAiFixedText('Slum Backs, Joe Tab was Appendix, Smurf, Vinyl Craft, Sybil Morfin.'),
    homework: BATTERY_HOMEWORK,
  });
  assert.equal(result.graded_against, 'homework_content');
  assert.ok(result.score_percent <= 40, `expected <=40, got ${result.score_percent}`);
});

test('runSpeakingCheck (Whisper path): garbled/off-topic transcript (simulated Vietnamese) with real vocabulary redirects regardless of raw score', async () => {
  let calls = 0;
  const ai = {
    async run(model, input) {
      calls += 1;
      if (input?.language === 'en') {
        // Whisper forced to English on real Vietnamese speech -> garbage
        // English words that share nothing with the homework vocabulary.
        return { text: 'You entered ABBA Malcolm being vitamin paid video click new version bank' };
      }
      return { text: 'con muốn nói tiếng Việt' };
    },
  };
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    ai,
    homework: BATTERY_HOMEWORK,
  });
  assert.equal(result.vietnamese_detected, true);
  assert.equal(calls, 2, 'the scored pass, then the VN detection pass');
});

test('runSpeakingCheck (Whisper path): a bare photo homework (no derivable vocabulary) grades on effort, capped below top praise — the current live case, honestly labeled', async () => {
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    expectedText: 'photo_talk',
    checkMode: 'open',
    ai: fakeAiFixedText('We play football at the park and we have a great time every single day'),
    homework: { schema_version: 3, tasks: [{ id: 't_picture', type: 'picture', anchors: [], duration_s: 60 }] },
  });
  assert.equal(result.graded_against, 'pronunciation_effort');
  // Revision 2 (2026-07-14, Buffet's reject finding 2): this exact branch —
  // no homework vocabulary, no Azure blend — has zero content basis, so it
  // is capped at EFFORT_ONLY_SCORE_CEILING regardless of how genuine the
  // answer is (the branch cannot tell genuine effort from gibberish, which
  // is exactly what let gibberish reach 100 + "Hay quá!" before this fix).
  assert.equal(result.score_percent, EFFORT_ONLY_SCORE_CEILING);
  assert.doesNotMatch(result.feedback_vi, /Hay quá/, 'an effort-only score must never trigger top-tier praise');
});

// ---------------------------------------------------------------------------
// row 11: scripted read/build with a close (mispronounced) word — flags
// exactly the expected word and steps the praise tone down.
// ---------------------------------------------------------------------------

test('runSpeakingCheck row 11 (read/Azure): a close word both flags the word AND steps feedback_vi down from top praise', async () => {
  const AZURE_NBEST_PARK_CLOSE = {
    RecognitionStatus: 'Success',
    NBest: [{
      Display: 'We play football at the park, we feel happy because it is fun.',
      PronScore: 96,
      AccuracyScore: 96,
      FluencyScore: 95,
      Words: [
        { Word: 'We', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'play', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'football', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'at', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'the', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'park', ErrorType: 'Mispronunciation', AccuracyScore: 65 }, // close, not exact
        { Word: 'we', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'feel', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'happy', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'because', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'it', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'is', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'fun', ErrorType: 'None', AccuracyScore: 95 },
      ],
    }],
  };
  const kv = new Map();
  const fakeKv = {
    async get(key, opts) { return kv.has(key) ? (opts?.type === 'json' ? JSON.parse(kv.get(key)) : kv.get(key)) : null; },
    async put(key, value) { kv.set(key, value); },
  };
  const fetchFn = async () => new Response(JSON.stringify(AZURE_NBEST_PARK_CLOSE), { status: 200 });
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav'], { type: 'audio/wav' }),
    expectedText: 'We play football at the park, we feel happy because it is fun.',
    checkMode: 'read',
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: fakeKv },
    fetchFn,
  });
  assert.ok(result.words_close.includes('park'), 'exactly "park" flagged close');
  assert.equal(result.words_missed.length, 0);
  assert.doesNotMatch(result.feedback_vi, /cực kỳ rõ ràng/, 'top praise must not fire when "park" was flagged');
});
