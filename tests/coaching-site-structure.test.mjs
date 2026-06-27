import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homePage = readFileSync('src/pages/index.astro', 'utf-8');
const header = readFileSync('src/components/Header.astro', 'utf-8');
const parentPortal = readFileSync('src/pages/ho-so/index.astro', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf-8');
const reviewRedirect = readFileSync('src/pages/read2lead/review.astro', 'utf-8');

test('homepage features coaching as primary service', () => {
  assert.match(homePage, /Huấn luyện kĩ năng nói/);
  assert.match(homePage, /rèn tự tin cho con/);
  assert.match(homePage, /tiếng Anh làm phương tiện/);
  assert.doesNotMatch(homePage, /Luyện giao tiếp tiếng Anh/);
  assert.doesNotMatch(homePage, /dạy tiếng Anh/);
  assert.match(homePage, /Đặt lịch tư vấn miễn phí/);
  assert.match(homePage, /Xem tiến độ con/);
  assert.match(homePage, /Nhập mã học sinh Felix cấp/);
  assert.match(homePage, /Nhóm nhỏ tối đa 4 bé/);
  assert.doesNotMatch(homePage, /Lớp 1-1/);
  assert.match(homePage, /id="ai-products"/);
  assert.match(homePage, /tăng cường bởi AI/);
  assert.match(homePage, /tích điểm và leo cấp/);
  assert.match(homePage, /Read2Lead/);
  assert.match(homePage, /Sản phẩm giáo dục/);
  assert.match(homePage, /ogImage="\/images\/felix\.jpg"/);
  assert.match(homePage, /Lớp online nhóm nhỏ tối đa 4 bé/);
  assert.doesNotMatch(homePage, /Felix Sharing Space/);
});

test('header navigation prioritizes coaching, parent portal, and separate products', () => {
  assert.match(header, /href="\/coaching"/);
  assert.match(header, /ho-so|ho-so/);
  assert.match(header, /href="\/read2lead"/);
  assert.match(header, /Luyện đọc/);
  assert.match(header, /href="\/speak-up"/);
  assert.match(header, /SpeakUp/);
  assert.match(header, /Xem tiến độ con/);
  assert.doesNotMatch(header, /Công cụ khác/);
});

test('lesson header keeps achievement context compact and moves site links into overflow', () => {
  assert.match(header, /r2l-lesson-focus/);
  assert.match(header, /data-r2l-lesson-menu/);
  assert.match(header, /Mở thành tích và liên kết khác/);
  assert.match(header, /data-r2l-coins/);
  assert.match(header, /data-r2l-streak/);
  assert.match(header, /read2LeadState \? \(/);
  assert.match(header, /\) : \(\s*<header/);
});

test('unified profile page supports code entry and role switching', () => {
  assert.match(parentPortal, /ho-so-entry/);
  assert.match(parentPortal, /ho-so-code-input/);
  assert.match(parentPortal, /read2lead-progress/);
  assert.match(parentPortal, /ho-so-role-picker/);
  assert.match(parentPortal, /renderParentView/);
});

test('parent portal formats story portfolio levels for parents', () => {
  assert.match(parentPortal, /formatLevel\(story\.level\)/);
  assert.doesNotMatch(parentPortal, /profile-coaching-hub/);
});

test('unified profile renders growth before stories in parent view', () => {
  const growthIdx = parentPortal.indexOf('renderGrowthSection');
  const storyIdx = parentPortal.indexOf('renderStoryList');
  assert.ok(growthIdx >= 0 && storyIdx > growthIdx, 'growth section should precede story list');
});

test('parent portal uses parent-friendly level labels', () => {
  assert.match(parentPortal, /function formatLevel/);
  assert.match(parentPortal, /Cấp \$\{match\[1\]\}/);
});

test('legacy review route redirects to parent portal', () => {
  assert.match(reviewRedirect, /Astro\.redirect/);
  assert.match(reviewRedirect, /\/ho-so/);
});
