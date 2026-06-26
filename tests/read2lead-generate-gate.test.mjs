import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generateEndpoint = readFileSync('functions/api/generate-read2lead-pack.js', 'utf-8');
const hoSoAll = readFileSync('src/pages/ho-so/index.astro', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-kid-view.ts', 'utf-8');

test('generate gate uses web-first copy when previous pack is unfinished', () => {
  assert.match(generateEndpoint, /hoàn thành bài đang mở trên web/);
  assert.doesNotMatch(generateEndpoint, /nộp ảnh bài làm/);
});

test('unified profile handles reviewed_pass_web_v2 state', () => {
  assert.match(hoSoAll, /reviewed_pass_web_v2/);
  assert.match(hoSoAll, /data\.state === 'reviewed'/);
});
