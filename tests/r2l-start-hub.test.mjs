import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/r2l/start.astro', 'utf8');
const client = readFileSync('src/scripts/r2l-start.client.ts', 'utf8');

const sweptFiles = {
  'src/components/Footer.astro': readFileSync('src/components/Footer.astro', 'utf8'),
  'src/layouts/BaseLayout.astro': readFileSync('src/layouts/BaseLayout.astro', 'utf8'),
  'src/pages/coaching.astro': readFileSync('src/pages/coaching.astro', 'utf8'),
  'src/pages/index.astro': readFileSync('src/pages/index.astro', 'utf8'),
  'src/pages/san-pham.astro': readFileSync('src/pages/san-pham.astro', 'utf8'),
};

test('start.astro ready phase exposes all 5 home-hub buttons with VN explainer copy', () => {
  // 1. Tạo bài đọc (button, generate flow)
  assert.match(page, /id="generate-btn"/);
  assert.match(page, /Tạo bài đọc/);
  assert.match(page, /Nhận một cuốn truyện mới và bắt đầu đọc ngay/);
  assert.match(page, /<button[^>]*id="generate-btn"/);

  // 2. SpeakUp (anchor, href set by client)
  assert.match(page, /id="speak-link"/);
  assert.match(page, /SpeakUp/);
  assert.match(page, /Luyện nói tiếng Anh cùng Minny/);
  assert.match(page, /<a[^>]*id="speak-link"/);

  // 3. Hồ sơ – Báo cáo tiến độ
  assert.match(page, /id="hoso-link"/);
  assert.match(page, /Hồ sơ – Báo cáo tiến độ/);
  assert.match(page, /Xem con đã học được gì và giỏi lên thế nào/);
  assert.match(page, /<a[^>]*id="hoso-link"/);

  // 4. Bảng xếp hạng (plain link, no wiring needed)
  assert.match(page, /href="\/read2lead\/leaderboard"/);
  assert.match(page, /Bảng xếp hạng/);
  assert.match(page, /Xem thứ hạng của con so với các bạn/);

  // 5. Cửa hàng (anchor, href set by client)
  assert.match(page, /id="shop-link"/);
  assert.match(page, /Cửa hàng/);
  assert.match(page, /Dùng xu con kiếm được để mua đồ cho thú cưng/);
  assert.match(page, /<a[^>]*id="shop-link"/);
});

test('start.astro no longer has the topic picker or interests input', () => {
  assert.doesNotMatch(page, /Chọn chủ đề/);
  assert.doesNotMatch(page, /TopicTile/);
  assert.doesNotMatch(page, /const TOPICS/);
  assert.doesNotMatch(page, /name="interests"/);
  assert.doesNotMatch(page, /Sở thích của con/);
  // Honeypot must still be present (anti-bot, read by the client).
  assert.match(page, /r2l-honeypot/);
  assert.match(page, /input\[name="website"\]|name="website"/);
});

test('start.astro result phase only shows the topic line when a topic exists', () => {
  assert.match(page, /id="result-topic-wrap"[^>]*hidden/);
  assert.match(page, /id="result-topic"/);
  assert.match(page, /id="result-story"[^>]*hidden/);
});

test('client script wires the SpeakUp and shop hrefs with the access code and v3 flag', () => {
  assert.match(client, /speakLink\.href = `\/speak-up\?code=\$\{encodeURIComponent\(accessCode\)\}`/);
  assert.match(client, /shopLink\.href = `\/read2lead\/shop\?code=\$\{encodeURIComponent\(accessCode\)\}&v3=1`/);
  assert.match(client, /shop-link/);
  assert.match(client, /speak-link/);
});

test('client script no longer drives topic-tile selection', () => {
  assert.doesNotMatch(client, /topicLabels/);
  assert.doesNotMatch(client, /topicValues/);
  assert.doesNotMatch(client, /topicIndex/);
  assert.doesNotMatch(client, /data-topic/);
  assert.doesNotMatch(client, /fx-topic--selected/);
});

test('client script posts an empty topic/interests for the one-tap generate flow', () => {
  assert.match(client, /const topic = '';/);
  assert.match(client, /const interests = '';/);
  assert.doesNotMatch(client, /interestsInput/);
});

test('client script keeps the result-topic wrapper toggled on data.topic presence', () => {
  assert.match(client, /resultTopicWrap/);
  assert.match(client, /if \(data\.topic && resultTopic && resultTopicWrap\)/);
});

test('AI-copy sweep: none of the swept marketing files claim "tăng cường bởi AI"', () => {
  for (const [path, contents] of Object.entries(sweptFiles)) {
    assert.doesNotMatch(contents, /tăng cường bởi AI/, `${path} still contains the false AI-positioning claim`);
  }
});

// The books are human-written (StoryWeaver library), so the homepage must not claim
// Felix uses AI to author the reading lessons. Minny/SpeakUp may still be described as
// AI — that one is true — so this guard is deliberately narrow (founder ruling 2026-07-13).
test('AI-copy sweep: the homepage no longer claims AI authors the reading lessons', () => {
  assert.doesNotMatch(sweptFiles['src/pages/index.astro'], /dùng AI để tạo bài/);
  assert.doesNotMatch(sweptFiles['src/pages/index.astro'], /\bAI\b/);
});
