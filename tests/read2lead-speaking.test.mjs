import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_AUDIO_BYTES,
  feedbackOpenVi,
  feedbackVi,
  inferAudioFilename,
  onRequestPost,
  runSpeakingCheck,
  scoreOpenTranscript,
  scoreTranscript,
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
        groqApiKey: 'test-key',
        fetchFn: async () => ({
          ok: true,
          json: async () => ({ text: '   ' }),
        }),
      }),
    (error) => error.code === 'transcription_failed',
  );
});

test('audio too large → 413 rejected before calling Groq', async () => {
  let groqCalled = false;
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
      GROQ_API_KEY: 'test-key',
    },
    fetchFn: async () => {
      groqCalled = true;
      return { ok: true, json: async () => ({ text: 'the boy runs fast' }) };
    },
  });

  assert.equal(response.status, 413);
  assert.equal(groqCalled, false);
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
      GROQ_API_KEY: 'test-key',
    },
  });

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error, 'code_not_found');
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

test('speaking endpoint uses Groq whisper-large-v3', () => {
  assert.match(speakingEndpoint, /whisper-large-v3/);
  assert.match(speakingEndpoint, /api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
  assert.match(speakingEndpoint, /GROQ_API_KEY/);
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
    groqApiKey: 'test-key',
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ text: 'Pilot walks the dog every morning because he likes animals.' }),
    }),
  });
  assert.equal(payload.check_mode, 'open');
  assert.ok(payload.score_percent >= 35);
});

test('lesson page wires retell activity with open speaking check', () => {
  assert.match(lessonPage, /retell_summary/);
  assert.match(lessonPage, /read2lead-speaking-check/);
  assert.match(lessonPage, /RETELL_MAX_SECONDS = 60/);
  assert.match(lessonPage, /data-retell-record/);
  assert.match(lessonPage, /_r2lMicIsReady/);
  assert.match(lessonPage, /data-speak-feedback/);
  assert.doesNotMatch(lessonPage, /speaking-check-section/);
});
