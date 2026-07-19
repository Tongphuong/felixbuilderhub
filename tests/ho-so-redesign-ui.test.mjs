import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/ho-so/index.astro', 'utf8');
const css = readFileSync('src/pages/ho-so/ho-so.css', 'utf8');
const controller = readFileSync('src/pages/ho-so/ho-so.ts', 'utf8');
const kid = readFileSync('src/pages/ho-so/ho-so-kid-view.ts', 'utf8');
// PROFILE_TIERS was extracted to the shared hero module (the student home hub renders the
// same rank ladder), so the eight-tier assertion below reads it from there.
const hero = readFileSync('src/lib/r2l-hero.ts', 'utf8');
const parent = readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf8');
const modal = readFileSync('src/components/read2lead/v3/rank/RankUpModal.astro', 'utf8');
const modalController = readFileSync('src/lib/rank-up-celebration.ts', 'utf8');

test('Ho-so page exposes dedicated entry, kid, parent, loading, and error states', () => {
  for (const id of ['ho-so-entry', 'ho-so-kid', 'ho-so-parent', 'ho-so-loading', 'ho-so-error']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  for (const id of ['ho-so-kid-hero', 'ho-so-kid-rank', 'ho-so-parent-charts', 'ho-so-parent-portfolio']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(page, /r2l-kid\.css|rank-ladder\.css|SeasonBanner|MedalCabinet|baloo-2/);
});

test('Ho-so controller validates codes and synchronizes role URL state', () => {
  assert.match(controller, /CODE_PATTERN = \/\^R2L-/);
  assert.match(controller, /url\.searchParams\.set\('role', role\)/);
  assert.match(controller, /data-ho-so-switch-role/);
  assert.match(controller, /window\.print\(\)/);
  assert.match(controller, /code_not_found/);
  assert.match(controller, /popstate/);
});

test('Ho-so responsive CSS supports eight-tier layout and accessible targets', () => {
  assert.match(css, /@media \(min-width: 520px\)/);
  assert.match(css, /@media \(min-width: 640px\)/);
  assert.match(css, /@media \(min-width: 1080px\)/);
  assert.match(css, /\.ho-so-ladder \{ grid-template-columns: repeat\(4/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media print/);
  assert.equal((hero.match(/^  \['/gm) || []).length, 8);
});

test('parent redesign keeps real data and persistence interactions', () => {
  assert.match(parent, /skill_quality/);
  assert.match(parent, /\/api\/parent\/weekly-tasks/);
  assert.match(parent, /\/api\/parent\/portfolio-seen/);
  assert.match(parent, /\/api\/parent\/portfolio-react/);
  assert.match(parent, /lesson_path/);
  assert.match(parent, /data-ho-so-print/);
});

// R2L Rewards Redesign (founder decision #5): coins no longer exist — the
// parent stats view drops the separate "🪙 Xu thưởng" card and states the
// diamond card's sources/uses plainly and truthfully (no celebration copy;
// parents read this).
test('parent stats view has no coin card — diamonds state their sources and uses plainly', () => {
  assert.doesNotMatch(parent, /🪙/);
  assert.doesNotMatch(parent, /Xu thưởng/);
  assert.doesNotMatch(parent, /\bxu\b/);
  assert.match(parent, /Kim cương/);
  assert.match(parent, /Kiếm khi đọc bài & buổi coaching, dùng để trang trí quái vật & đổi quà thật/);
});

test('rank modal keeps lesson contract and adds truthful optional context', () => {
  for (const id of ['rank-up-modal', 'rank-up-title', 'rank-up-label', 'rank-up-minny-copy', 'rank-up-close']) {
    assert.match(modal, new RegExp(`id="${id}"`));
  }
  assert.match(modalController, /showRankUpModal\(rankUp: RankUpPayload, ladder\?: RankLadderView, context: RankUpContext = \{\}\)/);
  assert.match(modalController, /navigator\.share/);
  assert.match(modalController, /navigator\.clipboard/);
  // R2L Rewards Redesign: the rank-up reward now sources rewards.diamonds
  // (Mark's renamed backend field) — the DOM hookup key stays 'coins'
  // (RankUpModal.astro's data-rank-reward attribute is outside this packet's
  // file set), only the value field changed.
  assert.match(modalController, /rewards\?\.diamonds/);
  assert.doesNotMatch(modalController, /rewards\?\.coins/);
});
