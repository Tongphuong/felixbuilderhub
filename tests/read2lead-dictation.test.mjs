import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canUseDictationItem,
  firstEmptyDictationSlot,
  hasDictationProgress,
  normalizeDictationHeard,
} from '../src/lib/read2lead-dictation.ts';

test('audio-backed dictation stays locked until the learner listens', () => {
  assert.equal(canUseDictationItem({ hasAudio: true, heard: false }), false);
  assert.equal(canUseDictationItem({ hasAudio: true, heard: true }), true);
});

test('missing audio never creates a dead end', () => {
  assert.equal(canUseDictationItem({ hasAudio: false, heard: false }), true);
});

test('saved tile progress unlocks grandfathered sessions', () => {
  assert.equal(hasDictationProgress([null, 2, null]), true);
  assert.equal(canUseDictationItem({ hasAudio: true, heard: false, hasProgress: true }), true);
});

test('mobile tap flow chooses the first empty slot and preserves duplicate indexes', () => {
  const slots = [1, null, 0, null];
  assert.equal(firstEmptyDictationSlot(slots), 1);
  slots[firstEmptyDictationSlot(slots)] = 3;
  assert.deepEqual(slots, [1, 3, 0, null]);
});

test('heard progress restore ignores duplicates and invalid item indexes', () => {
  assert.deepEqual(normalizeDictationHeard([0, '1', 1, -1, 9, 'x'], 3), [0, 1]);
});

test('lesson injects the tested helper into the inline runtime', () => {
  const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
  assert.match(lessonPage, /read2lead-dictation\.ts\?raw/);
  assert.match(lessonPage, /set:html=\{dictationHelperInline\}/);
  assert.match(lessonPage, /firstEmptyDictationSlot\(st\)/);
});
