// The Read2Lead student home hub (/r2l/start) — Claude Design's approved redesign.
//
// The founder's acceptance criterion was fidelity to the design, so these tests pin the
// things that would silently break it: the structure of the two columns, the contextual
// continue-vs-create rule, the wired destinations, and the promise that a child never gets
// a home screen with no primary button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/r2l/start.astro', 'utf8');
const client = readFileSync('src/scripts/r2l-start.client.ts', 'utf8');
const hero = readFileSync('src/lib/r2l-hero.ts', 'utf8');
const kidView = readFileSync('src/pages/ho-so/ho-so-kid-view.ts', 'utf8');

const sweptFiles = {
  'src/components/Footer.astro': readFileSync('src/components/Footer.astro', 'utf8'),
  'src/layouts/BaseLayout.astro': readFileSync('src/layouts/BaseLayout.astro', 'utf8'),
  'src/pages/coaching.astro': readFileSync('src/pages/coaching.astro', 'utf8'),
  'src/pages/index.astro': readFileSync('src/pages/index.astro', 'utf8'),
  'src/pages/san-pham.astro': readFileSync('src/pages/san-pham.astro', 'utf8'),
};

// ---- Column A: the child's world --------------------------------------------------------
// This column is the whole reason attempt 1 was rejected ("missing the child's world").
// If any of it disappears, the redesign has regressed to what the founder turned down.

test("the world column renders the child's pet, rank medal, streak and coins", () => {
  assert.match(page, /id="pet-slot"/);
  assert.match(page, /id="rank-medal"/);
  assert.match(page, /id="rank-label"/);
  assert.match(page, /id="stat-streak"/);
  assert.match(page, /id="stat-coins"/);
  assert.match(page, /HỌC SINH READ2LEAD/);
  // Founder ruling 2026-07-13: greet the child by name only — "Chào Ong!", not "Chào con Ong!".
  assert.match(page, /Chào <span id="greeting-name"/);
  assert.doesNotMatch(page, /Chào con <span id="greeting-name"/);
  assert.match(page, /id="greeting-level"/);
});

test('the client fills the world from the existing progress endpoint (no new backend)', () => {
  assert.match(client, /\/api\/read2lead-progress\?code=/);
  assert.match(client, /read2lead_state/);
  assert.match(client, /streak_days/);
  assert.match(client, /state\.coins/);
  assert.match(client, /rank_ladder/);
});

test("the child's own monster is rendered when they have one, not the placeholder", () => {
  assert.match(client, /renderMonster/);
  assert.match(client, /avatar\?\.monster/);
  // renderMonster() rewrites the className of whatever element it is handed, so it must be
  // given a child — handing it #pet-slot directly would strip the animated wrapper's class.
  assert.match(client, /petSlot\.replaceChildren\(inner\)/);
});

// ---- Column B: the contextual primary action --------------------------------------------

test('both primary cards exist: continue the open book, or create a new one', () => {
  assert.match(page, /id="cta-continue"/);
  assert.match(page, /id="cta-create"/);
  assert.match(page, /ĐỌC TIẾP/);
  assert.match(page, /BÀI ĐỌC MỚI/);
  assert.match(page, /Con đang đọc dở cuốn/);
  assert.match(page, /id="book-title"/);
  assert.match(page, /id="book-pct"/);
  assert.match(page, /id="continue-link"/);
  // Both generate buttons are real <button>s (one per card; only one card is visible).
  assert.match(page, /<button[^>]*id="generate-btn"/);
  assert.match(page, /id="generate-btn-create"/);
});

test('the continue-vs-create decision reuses the profile rule — one definition only', () => {
  assert.match(client, /buildHeroCta/);
  assert.match(client, /from '\.\.\/lib\/r2l-hero'/);
  // The canonical rule lives in the shared module...
  assert.match(hero, /export function buildHeroCta/);
  assert.match(hero, /export function statusMeta/);
  // ...and nowhere else. The design handoff shipped trimmed copies; they must not be here.
  assert.doesNotMatch(kidView, /function buildHeroCta/);
  assert.doesNotMatch(kidView, /function statusMeta/);
  assert.match(kidView, /from '\.\.\/\.\.\/lib\/r2l-hero'/);
});

test('a child is never left without a primary button if the progress call fails', () => {
  // Both cards ship hidden, so something must always reveal one.
  assert.match(page, /id="cta-continue" hidden/);
  assert.match(page, /id="cta-create" hidden/);
  assert.match(client, /function showCreateCta/);
  assert.match(client, /showCreateCta\(\);/);
});

test('a pack still being generated disables create rather than inviting a second one', () => {
  assert.match(client, /showCreateCta\(cta\.action === 'wait'\)/);
  assert.match(client, /Đang chuẩn bị bài đọc cho con…/);
});

// ---- SpeakUp + the three destinations ----------------------------------------------------

test('SpeakUp shows Minny (the red robot) and every destination carries the access code', () => {
  assert.match(page, /id="speak-link"/);
  assert.match(page, /\/assets\/minny\/minny\.png/);
  assert.doesNotMatch(page, /koala|🐨/i);
  assert.match(page, /id="hoso-link"/);
  assert.match(page, /id="shop-link"/);
  assert.match(page, /href="\/read2lead\/leaderboard"/);
  assert.match(page, /id="shop-coins"/);

  assert.match(client, /speakLink\.href = `\/speak-up\?code=\$\{code\}`/);
  assert.match(client, /hosoLink\.href = `\/ho-so\?code=\$\{code\}`/);
  assert.match(client, /shopLink\.href = `\/read2lead\/shop\?code=\$\{code\}&v3=1`/);
});

// ---- What the redesign removed -----------------------------------------------------------

test('the topic picker is gone and generate posts an empty topic', () => {
  assert.doesNotMatch(page, /Chọn chủ đề/);
  assert.doesNotMatch(page, /TopicTile/);
  assert.doesNotMatch(page, /const TOPICS/);
  assert.doesNotMatch(page, /name="interests"/);
  assert.match(client, /topic: '', interests: ''/);
  // The honeypot stays — it is what stops a bot creating packs.
  assert.match(page, /r2l-honeypot/);
  assert.match(client, /honeypotInput && honeypotInput\.value/);
});

test('all six phases still exist and the page stays unindexed', () => {
  for (const phase of ['resolving', 'error', 'ready', 'generating', 'result', 'gen-error']) {
    assert.match(page, new RegExp(`phase-${phase}`), `missing phase: ${phase}`);
  }
  assert.match(page, /robots="noindex, nofollow"/);
});

// ---- Fidelity guards ---------------------------------------------------------------------

test('the design is built from tokens, not stray hex', () => {
  const style = page.slice(page.indexOf('<style>'));
  const hexes = [...new Set([...style.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]))];
  // Exactly two artwork-derived colours are allowed, and only as named locals: Minny's red
  // ring and the book-cover blue. Anything else means someone bypassed the design system.
  assert.deepEqual(hexes.sort(), ['#2f6285', '#e0533f']);
  assert.match(style, /--minny-red: #e0533f/);
  assert.match(style, /--book-cover-lit: #2f6285/);
});

test('motion is disabled for children who ask for reduced motion', () => {
  assert.match(page, /prefers-reduced-motion/);
  assert.match(client, /animate: !prefersReducedMotion\(\)/);
});

// ---- The AI-copy sweep that ships alongside this redesign ---------------------------------

test('AI-copy sweep: nothing claims the reading books are made by AI', () => {
  for (const [path, contents] of Object.entries(sweptFiles)) {
    assert.doesNotMatch(contents, /tăng cường bởi AI/, `${path} still claims AI-enhanced`);
  }
  assert.doesNotMatch(sweptFiles['src/pages/index.astro'], /\bAI\b/);
});
