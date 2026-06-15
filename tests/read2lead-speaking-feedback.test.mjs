import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  runSpeakingCheck,
  scoreTranscript,
} from '../functions/api/read2lead-speaking-check.js';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');

test('word feedback preserves expected word order', () => {
  const result = scoreTranscript('The monster eats apples', 'monster eat apples');
  assert.deepEqual(result.word_feedback.map((entry) => entry.expected), ['monster', 'eats', 'apples']);
});

test('word feedback marks exact close and missed words', () => {
  const result = scoreTranscript('monster landed turtle', 'monster land chair');
  assert.equal(result.word_feedback[0].status, 'exact');
  assert.equal(result.word_feedback[1].status, 'close');
  assert.equal(result.word_feedback[2].status, 'missed');
});

test('word feedback includes spoken word and kid-safe Vietnamese hint', () => {
  const result = scoreTranscript('monster', 'monter');
  assert.equal(result.word_feedback[0].spoken, 'monter');
  assert.match(result.word_feedback[0].feedback_vi, /monter/);
  assert.match(result.word_feedback[0].feedback_vi, /monster/);
});

test('legacy word bucket fields remain for existing UI/tests', () => {
  const result = scoreTranscript('monster landed turtle', 'monster land chair');
  assert.deepEqual(result.words_exact, ['monster']);
  assert.deepEqual(result.words_close, ['landed']);
  assert.deepEqual(result.words_missed, ['turtle']);
});

test('runSpeakingCheck exposes word_feedback in read mode', async () => {
  const payload = await runSpeakingCheck({
    audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
    expectedText: 'monster apples',
    openaiApiKey: 'test-key',
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ text: 'monter apples' }),
    }),
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.check_mode, 'read');
  assert.equal(payload.word_feedback.length, 2);
});

test('lesson renders accessible word replay and slow replay controls', () => {
  assert.match(lessonPage, /data-r2l-word-replay/);
  assert.match(lessonPage, /aria-label="Nghe lại từ này/);
  assert.match(lessonPage, /data-r2l-replay-rate="0\.5"/);
  assert.match(lessonPage, /data-r2l-replay-rate="0\.75"/);
  assert.match(lessonPage, /data-r2l-replay-rate="1"/);
});
