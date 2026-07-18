import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

import { RARITY_COLORS } from '../functions/api/_read2lead-chests.js';

/** @type {import('vite').ViteDevServer | undefined} */
let viteServer;
/** @type {import('astro/container').experimental_AstroContainer | undefined} */
let container;

async function ensureHarness() {
  if (container) return;
  const configFn = getViteConfig({}, { root: process.cwd() });
  const config = await configFn({ command: 'serve', mode: 'development' });
  viteServer = await createServer({
    ...config,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  await viteServer.pluginContainer.buildStart({});
  container = await AstroContainer.create();
}

async function renderComponent(modulePath, props) {
  await ensureHarness();
  const Component = (await viteServer.ssrLoadModule(modulePath)).default;
  return container.renderToString(Component, { props });
}

test.before(async () => {
  await ensureHarness();
});

test.after(async () => {
  if (viteServer) await viteServer.close();
});

const shopUxSource = readFileSync('src/lib/shop-ux.ts', 'utf8');
const shopPage = readFileSync('src/pages/read2lead/shop.astro', 'utf8');

test('RarityBadge renders Vietnamese label per rarity', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'rare',
  });
  assert.match(html, /Hiếm/);
  assert.match(html, /data-rarity="?rare"?/);
});

test('RarityBadge epic includes sparkle emoji', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'epic',
  });
  assert.match(html, /✨/);
  assert.match(html, /Sử Thi/);
});

test('RarityBadge color CSS var matches mobile convention', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'epic',
  });
  assert.match(html, new RegExp(RARITY_COLORS.epic.replace('#', '#')));
  assert.match(html, /--badge-color/);
});

test('active shop renderer emits item rarity and affordability metadata', () => {
  assert.match(shopUxSource, /class=\"shop-item\"/);
  assert.match(shopUxSource, /data-rarity=\"/);
  assert.match(shopUxSource, /data-can-afford=\"/);
  assert.match(shopUxSource, /item\.can_afford \? \x27\x27 : \x27disabled\x27/);
});

test('active shop renderer groups epic, rare, then common and hides empty sections', () => {
  const epic = shopUxSource.indexOf("renderSection('epic'");
  const rare = shopUxSource.indexOf("renderSection('rare'");
  const common = shopUxSource.indexOf("renderSection('common'");
  assert.ok(epic >= 0 && rare > epic && common > rare);
  assert.match(shopUxSource, /if \(!items\.length\) return \x27\x27/);
});

test('dark shop styles apply W6 rarity borders and reduced motion', () => {
  assert.match(shopPage, /var\(--w6-rare\)/);
  assert.match(shopPage, /var\(--w6-epic\)/);
  assert.match(shopPage, /prefers-reduced-motion: reduce/);
});

test('InsufficientCoinsModal opens with correct deficit number', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/InsufficientCoinsModal.astro', {
    coins_needed: 80,
    current_coins: 20,
  });
  // R2L Rewards Redesign (founder decision #5): 🪙 xu wording replaced by 💎.
  assert.match(html, /Còn thiếu 60💎/);
  assert.doesNotMatch(html, /\bxu\b/);
  assert.match(html, /data-deficit="?60"?/);
  assert.match(html, /Đi học/);
});

test('UnlockCelebration includes Vietnamese rarity label', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/UnlockCelebration.astro', {
    part_name: 'Sừng xanh lớn',
    rarity: 'epic',
  });
  assert.match(html, /Mới có Sử Thi!/);
  assert.match(html, /Sừng xanh lớn/);
  assert.match(html, /Đeo ngay/);
});

// R2L Rewards Redesign (SPEC_R2L_REWARDS_REDESIGN.md, approved 2026-07-18) —
// diamonds are now the only shop currency; the 🪙 coin badge is gone.

test('shop page shows a diamond balance, not a coin balance', () => {
  assert.match(shopPage, /id="shop-diamonds"/);
  assert.match(shopPage, /💎 <span id="shop-diamonds">0<\/span>/);
  assert.doesNotMatch(shopPage, /id="shop-coins"/);
  assert.doesNotMatch(shopPage, /🪙/);
  assert.doesNotMatch(shopPage, /\bxu\b/);
});

// Reuse-first convergence: the monster shop's 💎 display must match the
// live "Quà thật" gift shop's established convention (gold, "Kim cương của
// con"), not invent a second diamond visual language.
test('shop balance box reuses the gift shop\'s label wording and gold emphasis', () => {
  assert.match(shopPage, /Kim cương của con/);
  assert.doesNotMatch(shopPage, /Số dư của con/);
  assert.match(shopPage, /border-gold\/30 bg-gold\/10/);
  assert.match(shopPage, /text-gold">💎/);
  assert.doesNotMatch(shopPage, /cyan/);
});

// Linking work (founder decision): kids must be able to find the shop —
// the ?v3=1 preview gate is gone, and each diamond shop links to the other.
test('shop page has no v3 preview gate and cross-links to the gift shop', () => {
  assert.doesNotMatch(shopPage, /shop-gate/);
  assert.doesNotMatch(shopPage, /isV3Enabled/);
  assert.doesNotMatch(shopPage, /v3 preview/);
  assert.match(shopPage, /href="\/read2lead\/gifts"/);
});

test('shop-ux tracks a diamond balance and falls back to the legacy coins field during rollout', () => {
  assert.match(shopUxSource, /let shopDiamonds = 0;/);
  assert.match(shopUxSource, /const setShopDiamonds = /);
  assert.match(shopUxSource, /qs\('#shop-diamonds'\)/);
  assert.match(shopUxSource, /setShopDiamonds\(payload\.diamonds \?\? payload\.coins \?\? 0\)/);
  assert.doesNotMatch(shopUxSource, /shop-item-coin\b/);
  assert.doesNotMatch(shopUxSource, /🪙/);
});

test('renderShopItem shows Silver+ free items as an always-visible "Nhận miễn phí" pill, backend can_afford still gates the button', () => {
  const start = shopUxSource.indexOf('function renderShopItem');
  const end = shopUxSource.indexOf('const SHOP_FILTERS');
  assert.ok(start > -1 && end > start);
  const body = shopUxSource.slice(start, end);
  assert.match(body, /const isFree = item\.price === 0;/);
  assert.match(body, /Nhận miễn phí/);
  // Unchanged from before this redesign — buildShopView (backend) already
  // sends can_afford: true whenever price is 0, so the button-disabled
  // logic itself doesn't need an extra isFree check (SPEC §3.2/§5).
  assert.match(body, /item\.can_afford \? '' : 'disabled'/);
});

test('showInsufficient reports the diamond deficit, not a coin deficit', () => {
  const start = shopUxSource.indexOf('export function showInsufficient');
  const end = shopUxSource.indexOf('export function wireShopModals');
  assert.ok(start > -1 && end > start);
  const body = shopUxSource.slice(start, end);
  assert.match(body, /Còn thiếu \$\{deficit\} 💎/);
});
