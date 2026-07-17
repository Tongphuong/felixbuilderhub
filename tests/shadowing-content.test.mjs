import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateShadowingVideo } from '../src/lib/shadowing-content.mjs';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Every shipped video in src/data/shadowing/*.json must validate cleanly --
// a hand-authored or hand-edited file (segments nudged, questions authored
// without the LLM step) is just as much a schema-compliance risk as a
// prep-script bug. Globs the directory rather than hardcoding filenames so a
// newly-added video rides this automatically (speakup-shadowing-v1-p4-content).
// ---------------------------------------------------------------------------

const SHADOWING_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'shadowing');

function shippedVideoFiles() {
  if (!fs.existsSync(SHADOWING_DATA_DIR)) return [];
  return fs.readdirSync(SHADOWING_DATA_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(SHADOWING_DATA_DIR, name));
}

test('every shipped src/data/shadowing/*.json validates cleanly', () => {
  const files = shippedVideoFiles();
  assert.ok(files.length > 0, 'expected at least one shipped shadowing video JSON file');
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, `${path.basename(file)} must be valid JSON`);
    const { ok, errors } = validateShadowingVideo(parsed);
    assert.equal(ok, true, `${path.basename(file)} failed validation: ${JSON.stringify(errors)}`);
  }
});

const VALID_VIDEO = {
  schema_version: 1,
  id: 'the-tiny-seed',
  youtube_id: 'dQw4w9WgXcQ',
  title_vi: 'Hạt Giống Nhỏ',
  title_en: 'The Tiny Seed',
  level: 'L2',
  content_status: 'dev_draft',
  duration_s: 185.5,
  prepared_at: '2026-07-17T10:00:00.000Z',
  source: { caption_kind: 'manual' },
  segments: [
    { i: 0, start: 0, end: 3.5, text_en: 'Once upon a time', text_vi: 'Ngày xửa ngày xưa', shadow: true },
    { i: 1, start: 3.5, end: 7, text_en: 'there was a tiny seed', shadow: true },
    { i: 2, start: 7.2, end: 9, text_en: '[Music]', shadow: false },
  ],
  questions: [
    {
      id: 'q1', after_segment: 0, type: 'yes_no',
      question_en: 'Did the story begin?', question_vi: 'Câu chuyện đã bắt đầu chưa?',
      answer: true,
    },
    {
      id: 'q2', after_segment: 1, type: 'choice',
      question_en: 'What was tiny?', question_vi: 'Cái gì nhỏ?',
      options_en: ['a seed', 'a house'], options_vi: ['hạt giống', 'ngôi nhà'],
      correct_index: 0,
    },
  ],
};

function expectError(video, pattern, label) {
  const { ok, errors } = validateShadowingVideo(video);
  assert.equal(ok, false, `${label}: expected ok=false, errors=${JSON.stringify(errors)}`);
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `${label}: expected an error matching ${pattern}, got ${JSON.stringify(errors)}`,
  );
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

test('accepts a fully valid video', () => {
  const { ok, errors, video } = validateShadowingVideo(VALID_VIDEO);
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(errors.length, 0);
  assert.equal(video.id, 'the-tiny-seed');
  assert.equal(video.segments.length, 3);
  assert.equal(video.questions.length, 2);
});

test('accepts touching segments (end of one === start of next)', () => {
  const video = clone(VALID_VIDEO);
  video.segments[2].start = video.segments[1].end; // exactly touching, no gap
  const { ok, errors } = validateShadowingVideo(video);
  assert.equal(ok, true, JSON.stringify(errors));
});

test('accepts a video with zero questions', () => {
  const video = clone(VALID_VIDEO);
  video.questions = [];
  const { ok, errors } = validateShadowingVideo(video);
  assert.equal(ok, true, JSON.stringify(errors));
});

// ---------------------------------------------------------------------------
// Reject — top-level fields
// ---------------------------------------------------------------------------

test('rejects wrong schema_version', () => {
  const video = clone(VALID_VIDEO);
  video.schema_version = 2;
  expectError(video, /schema_version/, 'schema_version');
});

test('rejects a non-slug id', () => {
  const video = clone(VALID_VIDEO);
  video.id = 'The Tiny Seed!';
  expectError(video, /id must be a slug/, 'id');
});

test('rejects a youtube_id of the wrong length', () => {
  const video = clone(VALID_VIDEO);
  video.youtube_id = 'short';
  expectError(video, /youtube_id/, 'youtube_id length');
});

test('rejects a youtube_id with invalid characters', () => {
  const video = clone(VALID_VIDEO);
  video.youtube_id = 'dQw4w9WgX!!';
  expectError(video, /youtube_id/, 'youtube_id chars');
});

test('rejects a missing title_vi', () => {
  const video = clone(VALID_VIDEO);
  delete video.title_vi;
  expectError(video, /title_vi/, 'title_vi missing');
});

test('rejects an empty title_en', () => {
  const video = clone(VALID_VIDEO);
  video.title_en = '   ';
  expectError(video, /title_en/, 'title_en empty');
});

test('rejects a non-string title_vi (non-string kid-facing text)', () => {
  const video = clone(VALID_VIDEO);
  video.title_vi = 12345;
  expectError(video, /title_vi/, 'title_vi non-string');
});

test('rejects an invalid level', () => {
  const video = clone(VALID_VIDEO);
  video.level = 'L6';
  expectError(video, /level must be one of/, 'level');
});

// ---------------------------------------------------------------------------
// content_status (Buffet review round, 2026-07-17): required going forward --
// exactly 'dev_draft' or 'approved', missing entirely is also an error. The
// field flip to 'approved' is Phuong's own content-review sign-off artifact.
// ---------------------------------------------------------------------------

test('accepts content_status: dev_draft', () => {
  const video = clone(VALID_VIDEO);
  video.content_status = 'dev_draft';
  const { ok, errors } = validateShadowingVideo(video);
  assert.equal(ok, true, JSON.stringify(errors));
});

test('accepts content_status: approved', () => {
  const video = clone(VALID_VIDEO);
  video.content_status = 'approved';
  const { ok, errors } = validateShadowingVideo(video);
  assert.equal(ok, true, JSON.stringify(errors));
});

test('rejects a missing content_status', () => {
  const video = clone(VALID_VIDEO);
  delete video.content_status;
  expectError(video, /content_status/, 'content_status missing');
});

test('rejects an invalid content_status value', () => {
  const video = clone(VALID_VIDEO);
  video.content_status = 'published';
  expectError(video, /content_status/, 'content_status invalid value');
});

test('rejects a non-positive duration_s', () => {
  const video = clone(VALID_VIDEO);
  video.duration_s = 0;
  expectError(video, /duration_s/, 'duration_s zero');
});

test('rejects a non-numeric duration_s', () => {
  const video = clone(VALID_VIDEO);
  video.duration_s = '185';
  expectError(video, /duration_s/, 'duration_s non-numeric');
});

test('rejects a non-ISO prepared_at', () => {
  const video = clone(VALID_VIDEO);
  video.prepared_at = 'not-a-date';
  expectError(video, /prepared_at/, 'prepared_at');
});

test('rejects an invalid source.caption_kind', () => {
  const video = clone(VALID_VIDEO);
  video.source = { caption_kind: 'subtitles' };
  expectError(video, /caption_kind/, 'caption_kind');
});

// ---------------------------------------------------------------------------
// Reject — segments
// ---------------------------------------------------------------------------

test('rejects empty segments', () => {
  const video = clone(VALID_VIDEO);
  video.segments = [];
  expectError(video, /segments must be non-empty/, 'segments empty');
});

test('rejects a segment where end <= start', () => {
  const video = clone(VALID_VIDEO);
  video.segments[0].end = video.segments[0].start;
  expectError(video, /end must be greater than/, 'segment end<=start');
});

test('rejects a negative segment start', () => {
  const video = clone(VALID_VIDEO);
  video.segments[0].start = -1;
  expectError(video, /start must not be negative/, 'segment start negative');
});

test('rejects a negative segment end', () => {
  const video = clone(VALID_VIDEO);
  // Keep end > start (both negative) so this fixture isolates the
  // negative-end check from the separate end>start check above.
  video.segments[0].start = -5;
  video.segments[0].end = -1;
  expectError(video, /end must not be negative/, 'segment end negative');
});

test('rejects overlapping segments', () => {
  const video = clone(VALID_VIDEO);
  video.segments[1].start = video.segments[0].start; // overlaps segment 0 entirely
  expectError(video, /overlap/, 'segments overlap');
});

test('rejects non-sequential segment i', () => {
  const video = clone(VALID_VIDEO);
  video.segments[1].i = 5;
  expectError(video, /\.i must equal its 0-based index/, 'segment i sequential');
});

test('rejects a segment missing text_en', () => {
  const video = clone(VALID_VIDEO);
  delete video.segments[0].text_en;
  expectError(video, /text_en must be a non-empty string/, 'segment text_en missing');
});

test('rejects a segment with a non-string text_vi', () => {
  const video = clone(VALID_VIDEO);
  video.segments[0].text_vi = 42;
  expectError(video, /text_vi must be a string/, 'segment text_vi non-string');
});

test('rejects a segment with a non-boolean shadow', () => {
  const video = clone(VALID_VIDEO);
  video.segments[0].shadow = 'true';
  expectError(video, /shadow must be a boolean/, 'segment shadow non-boolean');
});

// ---------------------------------------------------------------------------
// Reject — questions
// ---------------------------------------------------------------------------

test('rejects an after_segment out of range', () => {
  const video = clone(VALID_VIDEO);
  video.questions[0].after_segment = 99;
  expectError(video, /after_segment must be a valid segment index/, 'after_segment range');
});

test('rejects an unknown question type', () => {
  const video = clone(VALID_VIDEO);
  video.questions[0].type = 'multi_select';
  expectError(video, /type must be one of/, 'unknown question type');
});

test('rejects yes_no missing answer', () => {
  const video = clone(VALID_VIDEO);
  delete video.questions[0].answer;
  expectError(video, /answer must be a boolean/, 'yes_no missing answer');
});

test('rejects yes_no with options present', () => {
  const video = clone(VALID_VIDEO);
  video.questions[0].options_en = ['yes', 'no'];
  expectError(video, /must not have options_en\/options_vi/, 'yes_no with options');
});

test('rejects choice missing options', () => {
  const video = clone(VALID_VIDEO);
  delete video.questions[1].options_en;
  delete video.questions[1].options_vi;
  expectError(video, /options_en must be an array of 2-4/, 'choice missing options');
});

test('rejects choice with only one option', () => {
  const video = clone(VALID_VIDEO);
  video.questions[1].options_en = ['a seed'];
  video.questions[1].options_vi = ['hạt giống'];
  video.questions[1].correct_index = 0;
  expectError(video, /options_en must be an array of 2-4/, 'choice one option');
});

test('rejects choice with five options', () => {
  const video = clone(VALID_VIDEO);
  video.questions[1].options_en = ['a', 'b', 'c', 'd', 'e'];
  video.questions[1].options_vi = ['a', 'b', 'c', 'd', 'e'];
  expectError(video, /options_en must be an array of 2-4/, 'choice five options');
});

test('rejects choice with mismatched options_en/options_vi lengths', () => {
  const video = clone(VALID_VIDEO);
  video.questions[1].options_vi = ['hạt giống'];
  expectError(video, /options_vi must be an array of 2-4/, 'choice mismatched option lengths');
});

test('rejects choice with an out-of-range correct_index', () => {
  const video = clone(VALID_VIDEO);
  video.questions[1].correct_index = 7;
  expectError(video, /correct_index must be a valid index/, 'choice bad correct_index');
});

test('rejects choice with answer present', () => {
  const video = clone(VALID_VIDEO);
  video.questions[1].answer = true;
  expectError(video, /must not have answer/, 'choice with answer');
});

test('rejects a non-string question_vi', () => {
  const video = clone(VALID_VIDEO);
  video.questions[0].question_vi = 42;
  expectError(video, /question_vi must be a non-empty string/, 'question_vi non-string');
});

// ---------------------------------------------------------------------------
// Collect ALL errors
// ---------------------------------------------------------------------------

test('collects every error at once, not just the first', () => {
  const video = clone(VALID_VIDEO);
  video.schema_version = 2;
  video.id = 'Not A Slug';
  video.level = 'L9';
  video.segments[0].end = video.segments[0].start;
  video.questions[0].type = 'unknown_type';
  const { ok, errors } = validateShadowingVideo(video);
  assert.equal(ok, false);
  assert.ok(errors.length >= 5, `expected at least 5 collected errors, got ${errors.length}: ${JSON.stringify(errors)}`);
  assert.ok(errors.some((e) => /schema_version/.test(e)));
  assert.ok(errors.some((e) => /id must be a slug/.test(e)));
  assert.ok(errors.some((e) => /level must be one of/.test(e)));
  assert.ok(errors.some((e) => /end must be greater than/.test(e)));
  assert.ok(errors.some((e) => /type must be one of/.test(e)));
});

test('non-object input is rejected without throwing', () => {
  const { ok, errors } = validateShadowingVideo(null);
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test('non-object input (array) is rejected without throwing', () => {
  const { ok, errors } = validateShadowingVideo([1, 2, 3]);
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});
