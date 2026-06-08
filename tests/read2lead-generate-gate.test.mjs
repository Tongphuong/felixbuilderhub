import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generateEndpoint = readFileSync('functions/api/generate-read2lead-pack.js', 'utf-8');
const parentPortal = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');

test('generate gate uses web-first copy when previous pack is unfinished', () => {
  assert.match(generateEndpoint, /hoàn thành bài đang mở trên web/);
  assert.doesNotMatch(generateEndpoint, /nộp ảnh bài làm/);
});

test('parent portal offers create-next after V2 lesson completion', () => {
  assert.match(parentPortal, /reviewed_pass_web_v2/);
  assert.match(parentPortal, /data\.state === 'reviewed'/);
  assert.match(parentPortal, /Tạo bài mới cho con/);
  assert.match(parentPortal, /primary\.kind === 'lesson'/);
});
