import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSpeechFrame } from '../functions/api/read2lead-speaking-check.js';

const stemsFixture = [
  { id: 'f1', text_en: 'Last summer, I went to ___.', anchor_words: ['last','summer','i','went','to'] },
  { id: 'f2', text_en: 'I saw ___.', anchor_words: ['i','saw'] },
  { id: 'f3', text_en: 'The weather was ___.', anchor_words: ['the','weather','was'] },
  { id: 'f4', text_en: 'I ate ___.', anchor_words: ['i','ate'] },
  { id: 'f5', text_en: 'I felt ___.', anchor_words: ['i','felt'] },
  { id: 'f6', text_en: 'It was a great trip.', anchor_words: ['it','was','a','great','trip'] },
];

test('scoreSpeechFrame full coverage, on-target duration', () => {
  const transcript = 'Last summer I went to Da Nang. I saw many beautiful beaches. The weather was sunny. I ate delicious seafood. I felt happy. It was a great trip.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0.8', duration_seconds: 58 });
  assert.ok(result.matchPct >= 90);
  assert.equal(result.rubric.spokeAllStems, true);
  assert.equal(result.rubric.durationOnTarget, true);
  assert.equal(result.rubric.spokeClearly, true);
  assert.equal(result.stems.length, 6);
  assert.ok(result.wordCount > 10);
  assert.equal(result.durationSec, 58);
});

test('scoreSpeechFrame partial coverage, short duration', () => {
  const transcript = 'I went to Da Nang. I saw beaches.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0.3', duration_seconds: 12 });
  assert.ok(result.matchPct < 70);
  assert.equal(result.rubric.spokeAllStems, false);
  assert.equal(result.rubric.durationOnTarget, false);
  assert.equal(result.rubric.spokeClearly, true);
  const matchedCount = result.stems.filter(s => s.matched).length;
  assert.ok(matchedCount >= 1 && matchedCount < stemsFixture.length);
});

test('scoreSpeechFrame empty transcript', () => {
  const result = scoreSpeechFrame('', stemsFixture, 60, {});
  assert.equal(result.matchPct, 0);
  assert.equal(result.rubric.spokeAllStems, false);
  assert.equal(result.rubric.durationOnTarget, false);
  assert.equal(result.rubric.spokeClearly, true);
  assert.equal(result.wordCount, 0);
  assert.equal(result.durationSec, 0);
});

test('scoreSpeechFrame duration far outside tolerance', () => {
  const transcript = 'Last summer I went to Da Nang. I saw many beautiful beaches. The weather was sunny. I ate delicious seafood. I felt happy. It was a great trip.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0.9', duration_seconds: 10 });
  assert.equal(result.rubric.durationOnTarget, false);
  assert.ok(result.matchPct >= 90);
  assert.equal(result.rubric.spokeAllStems, true);
});

test('scoreSpeechFrame spokeClearly false when peak_level zero', () => {
  const transcript = 'I went to Da Nang.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0', duration_seconds: 55 });
  assert.equal(result.rubric.spokeClearly, false);
});

test('scoreSpeechFrame spokeClearly true when peak_level missing', () => {
  const transcript = 'I went to Da Nang.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { duration_seconds: 55 });
  assert.equal(result.rubric.spokeClearly, true);
});
