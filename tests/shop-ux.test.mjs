import test from 'node:test';
import assert from 'node:assert/strict';
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

const SHOP_ITEM = {
  id: 'png-default-detail-blue-horn-small',
  rarity: 'rare',
  price: 80,
  name: 'Sừng xanh nhỏ',
  owned: false,
  can_afford: true,
};

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

test('ShopItem rare has blue border data-rarity', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ShopItem.astro', {
    ...SHOP_ITEM,
    rarity: 'rare',
  });
  assert.match(html, /class="shop-item"/);
  assert.match(html, /data-rarity="?rare"?/);
});

test('ShopItem epic has purple border + glow', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ShopItem.astro', {
    ...SHOP_ITEM,
    rarity: 'epic',
    price: 200,
  });
  assert.match(html, /data-rarity="?epic"?/);
  assert.match(html, /#a855f7|168 85 247/);
});

test('ShopItem disabled when !can_afford', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ShopItem.astro', {
    ...SHOP_ITEM,
    can_afford: false,
  });
  assert.match(html, /data-can-afford="?false"?/);
  assert.match(html, /disabled/);
});

test('ShopGrid groups items into epic / rare sections', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ShopGrid.astro', {
    items: [
      { ...SHOP_ITEM, id: 'r1', rarity: 'rare' },
      { ...SHOP_ITEM, id: 'e1', rarity: 'epic', price: 200 },
    ],
  });
  assert.match(html, /data-tier="epic"/);
  assert.match(html, /data-tier="rare"/);
  assert.match(html, /Sử Thi — 1 món/);
  assert.match(html, /Hiếm — 1 món/);
});

test('ShopGrid hides empty tier section', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ShopGrid.astro', {
    items: [{ ...SHOP_ITEM, rarity: 'rare' }],
  });
  assert.doesNotMatch(html, /data-tier="epic"/);
  assert.match(html, /data-tier="rare"/);
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
