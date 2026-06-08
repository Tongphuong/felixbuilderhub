import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const landingPage = readFileSync('src/pages/read2lead.astro', 'utf-8');
const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const reviewPage = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');

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
  assert.doesNotMatch(landingPage, /\bPDF\b|\bMP3\b|\/read2lead\/(story|chunk|parents)\.png/);
  assert.match(landingPage, /tăng cường bởi AI/);
  assert.doesNotMatch(landingPage, /tự học tại nhà|học tại nhà|file nghe|đóng gói file/i);
});

test('Read2Lead landing page is profile-first and web-first', () => {
  assert.match(
    landingPage,
    /Luyện đọc và nghe qua truyện — tăng cường bởi AI/,
  );
  assert.match(landingPage, /Tạo bài cho con/);
  assert.match(landingPage, /Bảng xếp hạng/);
  assert.match(landingPage, /Xem tiến độ con/);
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

test('student profile shows completed stories in plain parent language', () => {
  assert.match(reviewPage, /Các truyện con đã học/);
  assert.match(reviewPage, /Cho con làm lại/);
  assert.match(reviewPage, /Bước tiếp theo cho con/);
  assert.match(reviewPage, /profile-hero/);
  assert.match(reviewPage, /robots="noindex, follow"/);
  assert.match(reviewPage, /for="access-code"/);
  assert.match(reviewPage, /<h1[^>]*>Xem tiến độ của con<\/h1>/);
  assert.doesNotMatch(reviewPage, /Thư viện truyện|Rừng kỳ diệu|Felixar làm gì\?/i);
});

test('web lesson still keeps internal story audio for in-browser playback', () => {
  assert.match(lessonPage, /full_audio_url/);
  assert.match(lessonPage, /audio_url/);
});
