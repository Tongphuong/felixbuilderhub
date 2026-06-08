import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const schema = readFileSync('schemas/pack.schema.v2.json', 'utf-8');

test('pack schema exposes optional story.trivia_vi', () => {
  assert.match(schema, /"trivia_vi"/);
});

test('lesson page wires W11 trivia reveal after lesson pass', () => {
  assert.match(lessonPage, /trivia-reveal-section/);
  assert.match(lessonPage, /Bí mật sau truyện/);
  assert.match(lessonPage, /_r2lMaybeRevealTriviaSecret/);
  assert.match(lessonPage, /TRIVIA_REVEAL_MIN_SCORE = 75/);
  assert.match(lessonPage, /trivia-reveal-continue/);
  assert.match(lessonPage, /r2l-trivia-reveal/);
});

test('retell prompt uses story context, not trivia reveal text', () => {
  const resolveStart = lessonPage.indexOf('function _r2lResolveRetellPrompt');
  const resolveEnd = lessonPage.indexOf('function _r2lCleanupRetellRecording');
  assert.ok(resolveStart > -1 && resolveEnd > resolveStart);
  const resolveBody = lessonPage.slice(resolveStart, resolveEnd);
  assert.doesNotMatch(resolveBody, /story\.trivia_vi/);
  assert.match(resolveBody, /story\?\.title/);
});
