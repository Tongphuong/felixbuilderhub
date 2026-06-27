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
  assert.match(html, /Còn thiếu 60 xu/);
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
