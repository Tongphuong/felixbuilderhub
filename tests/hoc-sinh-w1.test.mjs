import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacyHub = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');
const kidHub = readFileSync('src/pages/hoc-sinh/_KidHubW1.astro', 'utf-8');
const indexHub = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');
const w1Script = readFileSync('src/pages/hoc-sinh/hoc-sinh-w1.ts', 'utf-8');
const parentPage = readFileSync('src/pages/phu-huynh/index.astro', 'utf-8');
const parentScript = readFileSync('src/pages/phu-huynh/phu-huynh.ts', 'utf-8');
const topics = readFileSync('src/pages/hoc-sinh/hoc-sinh-topics.ts', 'utf-8');

test('hoc-sinh index gates W1 via env SSR branch', () => {
  assert.match(indexHub, /KidHubW1/);
  assert.match(indexHub, /PUBLIC_R2L_W1/);
  assert.match(indexHub, /w1Ssr \?/);
  assert.match(indexHub, /Xem tiến độ của con/);
});

test('legacy hub preserved for W1-off path', () => {
  assert.match(legacyHub, /renderDashboard/);
  assert.match(legacyHub, /Xem tiến độ của con/);
  assert.doesNotMatch(legacyHub, /initHocSinhW1/);
});

test('W1 kid hub has hook, create sheet, wait scene, and parent footer link', () => {
  assert.match(kidHub, /autocapitalize="characters"/);
  assert.match(kidHub, /hub-create-sheet/);
  assert.match(kidHub, /hub-wait-scene/);
  assert.match(kidHub, /isW1Enabled/);
  assert.match(kidHub, /kidMode=\{true\}/);
});

test('W1 script ports pack generation polling and resume storage', () => {
  assert.match(w1Script, /generate-read2lead-pack/);
  assert.match(w1Script, /check-generation-status/);
  assert.match(w1Script, /r2l_hub_gen_v1/);
  assert.match(w1Script, /Chọn một thẻ chủ đề/);
  assert.match(w1Script, /Đọc ngay 🚀/);
  assert.match(w1Script, /renderQuestPath/);
  assert.match(w1Script, /data-clarity-mask/);
});

test('hub topics list has 12 picture cards', () => {
  const matches = topics.match(/\['[a-z_]+',/g);
  assert.equal(matches?.length, 12);
});

test('parent page is sober read-only with six sections including weekly tasks', () => {
  assert.match(parentPage, /Tiến độ học sinh/);
  assert.doesNotMatch(parentPage, /r2l-kid/);
  assert.match(parentPage, /data-clarity-mask/);
  assert.match(parentScript, /read2lead-progress/);
  assert.match(parentScript, /read2lead-lesson/);
  assert.match(parentScript, /Việc cho tuần này/);
  assert.match(parentScript, /Tóm tắt/);
  assert.match(parentScript, /Bài đang học/);
  assert.match(parentScript, /Tiến bộ theo tuần/);
  assert.match(parentScript, /Truyện đã học/);
  assert.match(parentScript, /Liên hệ/);
});

test('W1 kid hub removes parent-oriented legacy sections from new path', () => {
  assert.doesNotMatch(w1Script, /renderGrowthSection/);
  assert.doesNotMatch(w1Script, /renderStoryPortfolio/);
  assert.doesNotMatch(w1Script, /renderActionMenu/);
  assert.doesNotMatch(kidHub, /Xem tiến độ của con/);
});
