import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generateEndpoint = readFileSync('functions/api/generate-read2lead-pack.js', 'utf-8');
// r2l-hero.ts is part of this surface: statusMeta/buildHeroCta (which encode the
// reviewed_pass_web_v2 handling asserted below) were extracted out of ho-so-kid-view.ts
// so the student home hub can apply the identical rules. Same logic, one definition.
const hoSoAll = readFileSync('src/pages/ho-so/index.astro', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-kid-view.ts', 'utf-8') + '\n' + readFileSync('src/lib/r2l-hero.ts', 'utf-8');

test('generate gate does not ask for photo submission when previous pack is unfinished', () => {
  assert.match(generateEndpoint, /hoàn thành bài cũ trước khi mở bài mới/);
  assert.doesNotMatch(generateEndpoint, /nộp ảnh bài làm/);
});

test('unified profile handles reviewed_pass_web_v2 state', () => {
  assert.match(hoSoAll, /reviewed_pass_web_v2/);
  assert.match(hoSoAll, /data\.state === 'reviewed'/);
});
