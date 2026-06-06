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
  assert.doesNotMatch(landingPage, /\bAI\b|\bPDF\b|\bMP3\b|\/read2lead\/(story|chunk|parents)\.png/);
  assert.doesNotMatch(landingPage, /tự học tại nhà|học tại nhà|file nghe|đóng gói file/i);
});

test('Read2Lead landing page is profile-first and web-first', () => {
  assert.match(
    landingPage,
    /Tự học nghe và đọc tiếng Anh thông qua câu chuyện con tự chọn/,
  );
  assert.match(landingPage, /Mỗi bé có một profile học riêng/);
  assert.match(landingPage, /Bắt đầu với mã học sinh/);
  assert.match(landingPage, /5 bước sử dụng trên web/);
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
  assert.doesNotMatch(reviewPage, /nộp ảnh|bài giấy|phiếu giấy/i);
  assert.doesNotMatch(reviewPage, /review-form|worksheet-photo|record-btn|audio-preview/);
});

test('web lesson still keeps internal story audio for in-browser playback', () => {
  assert.match(lessonPage, /full_audio_url/);
  assert.match(lessonPage, /audio_url/);
});
