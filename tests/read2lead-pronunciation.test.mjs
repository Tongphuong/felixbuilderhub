import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessPronunciation,
  setAzureAssessorForTests,
} from '../src/lib/r2l-azure-pronunciation.ts';

const audio = new Blob(['fake-audio'], { type: 'audio/webm' });

test('test_effort_mode_l1_any_speech_passes', async () => {
  setAzureAssessorForTests(async () => ({
    overall_score: 12,
    accuracy_score: 10,
    fluency_score: 8,
    prosody_score: 5,
    words: [],
    passed: false,
    grading_mode: 'effort',
  }));
  const result = await assessPronunciation(audio, 'The dog sat.', 'L1', {
    speechKey: 'test-key',
    speechRegion: 'southeastasia',
  });
  assert.ok(result);
  assert.equal(result?.grading_mode, 'effort');
  assert.equal(result?.passed, true);
  setAzureAssessorForTests(null);
});

test('test_accuracy_mode_l3_threshold', async () => {
  setAzureAssessorForTests(async () => ({
    overall_score: 65,
    accuracy_score: 65,
    fluency_score: 70,
    prosody_score: 60,
    words: [],
    passed: false,
    grading_mode: 'accuracy',
  }));
  const fail = await assessPronunciation(audio, 'The dog sat.', 'L3', {
    speechKey: 'test-key',
    speechRegion: 'southeastasia',
  });
  assert.equal(fail?.passed, false);

  setAzureAssessorForTests(async () => ({
    overall_score: 75,
    accuracy_score: 75,
    fluency_score: 70,
    prosody_score: 60,
    words: [],
    passed: false,
    grading_mode: 'accuracy',
  }));
  const pass = await assessPronunciation(audio, 'The dog sat.', 'L3', {
    speechKey: 'test-key',
    speechRegion: 'southeastasia',
  });
  assert.equal(pass?.passed, true);
  setAzureAssessorForTests(null);
});

test('test_fallback_to_null_on_azure_fail', async () => {
  setAzureAssessorForTests(async () => {
    throw new Error('network error');
  });
  const result = await assessPronunciation(audio, 'Hello', 'L2', {
    speechKey: 'test-key',
    speechRegion: 'southeastasia',
  });
  assert.equal(result, null);
  setAzureAssessorForTests(null);
});
