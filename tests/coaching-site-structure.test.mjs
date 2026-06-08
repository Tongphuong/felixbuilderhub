import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homePage = readFileSync('src/pages/index.astro', 'utf-8');
const header = readFileSync('src/components/Header.astro', 'utf-8');
const parentPortal = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');
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
  assert.match(homePage, /id="msmw"/);
  assert.match(homePage, /MSMW — My Story, My World/);
  assert.match(homePage, /ogImage="\/images\/felix\.jpg"/);
  assert.match(homePage, /Lớp online nhóm nhỏ tối đa 4 bé/);
  assert.doesNotMatch(homePage, /Felix Sharing Space/);
});

test('header navigation prioritizes coaching, parent portal, and separate products', () => {
  assert.match(header, /href="\/coaching"/);
  assert.match(header, /href="\/hoc-sinh"/);
  assert.match(header, /href="\/read2lead"/);
  assert.match(header, /Luyện đọc/);
  assert.match(header, /href="\/msmw"/);
  assert.match(header, /Sách cho con/);
  assert.match(header, /Xem tiến độ con/);
  assert.doesNotMatch(header, /Công cụ khác/);
});

test('parent portal supports code login and coaching hub', () => {
  assert.match(parentPortal, /Xem tiến độ của con/);
  assert.match(parentPortal, /Đăng nhập/);
  assert.match(parentPortal, /read2lead-progress/);
  assert.match(parentPortal, /Luyện nói riêng/);
  assert.match(parentPortal, /Sắp ra mắt/);
});

test('parent portal disables header gamification HUD', () => {
  assert.match(parentPortal, /<Header read2LeadState=\{false\} \/>/);
  assert.doesNotMatch(parentPortal, /syncHeaderState/);
});

test('parent portal hides login form after session and offers change-code', () => {
  assert.match(parentPortal, /id="profile-entry"/);
  assert.match(parentPortal, /id="profile-session-bar"/);
  assert.match(parentPortal, /Đổi mã/);
  assert.match(parentPortal, /showLoggedInSession/);
  assert.match(parentPortal, /profileEntry\.classList\.add\('hidden'\)/);
});

test('statusMeta treats reviewed_pass_web_v2 and reviewed state as completed', () => {
  assert.match(parentPortal, /pack\.status === 'reviewed_pass_web_v2'/);
  assert.match(parentPortal, /pack\.status === 'reviewed_retry_web_v2'/);
  assert.match(parentPortal, /state === 'reviewed'/);
  assert.match(parentPortal, /completed: true/);
  assert.match(parentPortal, /Bài vừa xong/);
});

test('buildPrimaryAction offers create-next when data.state is reviewed', () => {
  assert.match(parentPortal, /data\.state === 'reviewed'/);
  assert.match(parentPortal, /Tạo bài mới cho con/);
  assert.doesNotMatch(parentPortal, /coaching-lesson-link/);
});

test('parent portal dashboard puts primary CTA above fold before stats', () => {
  const heroIdx = parentPortal.indexOf('${renderHero(progress, read2LeadState, storyProgress)}');
  const nextIdx = parentPortal.indexOf('${renderNextStep(primary, status)}');
  const statsIdx = parentPortal.indexOf('${renderStats(read2LeadState, progress, storyProgress)}');
  assert.ok(heroIdx >= 0 && nextIdx > heroIdx, 'hero should precede next step');
  assert.ok(nextIdx < statsIdx, 'primary CTA should precede stats row');
});

test('parent portal uses parent-friendly level labels', () => {
  assert.match(parentPortal, /function formatLevel/);
  assert.match(parentPortal, /Cấp \$\{match\[1\]\}/);
});

test('legacy review route redirects to parent portal', () => {
  assert.match(reviewRedirect, /Astro\.redirect/);
  assert.match(reviewRedirect, /\/hoc-sinh/);
});
