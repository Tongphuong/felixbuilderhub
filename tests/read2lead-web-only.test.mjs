import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const landingPage = readFileSync('src/pages/read2lead.astro', 'utf-8');
const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const reviewPage = readFileSync('src/pages/read2lead/review.astro', 'utf-8');

const publicPackEndpoints = [
  'functions/api/generate-read2lead-pack.js',
  'functions/api/check-generation-status.js',
  'functions/api/read2lead-progress.js',
  'functions/api/submit-read2lead-lesson.js',
].map((path) => [path, readFileSync(path, 'utf-8')]);

test('Read2Lead landing page does not expose PDF or MP3 download surfaces', () => {
  assert.doesNotMatch(landingPage, /id="pdf-link"/);
  assert.doesNotMatch(landingPage, /id="mp3-link"/);
  assert.doesNotMatch(landingPage, /pdf_url/);
  assert.doesNotMatch(landingPage, /mp3_url/);
  assert.doesNotMatch(landingPage, /Read2Lead-Sample-Pack\.pdf/);
  assert.doesNotMatch(landingPage, /\bPDF\b|\bMP3\b/);
});

test('public Read2Lead API payloads do not expose standalone PDF or MP3 urls', () => {
  for (const [path, source] of publicPackEndpoints) {
    assert.doesNotMatch(source, /pdf_url/, `${path} should not expose pdf_url`);
    assert.doesNotMatch(source, /mp3_url/, `${path} should not expose mp3_url`);
  }
});

test('review dashboard does not offer PDF or MP3 action links', () => {
  assert.doesNotMatch(reviewPage, /Mở PDF/);
  assert.doesNotMatch(reviewPage, /Mở MP3/);
  assert.doesNotMatch(reviewPage, /Nghe lại MP3/);
});

test('web lesson still keeps internal story audio for in-browser playback', () => {
  assert.match(lessonPage, /full_audio_url/);
  assert.match(lessonPage, /audio_url/);
});
