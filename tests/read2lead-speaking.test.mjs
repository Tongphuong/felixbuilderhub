import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_AUDIO_BYTES,
  collectFlaggedWords,
  feedbackOpenVi,
  feedbackVi,
  inferAudioFilename,
  normalizePracticeWord,
  onRequestPost,
  resolveOpenAIApiKey,
  runSpeakingCheck,
  scoreOpenTranscript,
  scoreTranscript,
  transcribeAudio,
  wordSimilarity,
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
