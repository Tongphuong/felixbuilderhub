import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';

// R2L-REAL-GIFTS §6 + §7 — the founder's own admin tools. Mirrors
// tests/admin-classes.test.mjs's nav-wiring-by-source-read pattern and
// tests/gift-ux.test.mjs's Vite SSR harness for loading a .ts lib straight
// from source (node --test can't import TypeScript directly).

/** @type {import('vite').ViteDevServer | undefined} */
let viteServer;

async function ensureHarness() {
  if (viteServer) return;
  const configFn = getViteConfig({}, { root: process.cwd() });
  const config = await configFn({ command: 'serve', mode: 'development' });
  viteServer = await createServer({
    ...config,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  await viteServer.pluginContainer.buildStart({});
}

test.before(ensureHarness);
test.after(async () => {
  if (viteServer) await viteServer.close();
});

async function loadAdminGifts() {
  await ensureHarness();
  return viteServer.ssrLoadModule('/src/lib/admin-gifts.ts');
}

const adminIndexPage = readFileSync('src/pages/admin/index.astro', 'utf8');
const adminGiftsPage = readFileSync('src/pages/admin/gifts.astro', 'utf8');
const adminGiftsLib = readFileSync('src/lib/admin-gifts.ts', 'utf8');
const adminLayout = readFileSync('src/layouts/AdminLayout.astro', 'utf8');

// --- nav wiring -------------------------------------------------------------

test('admin dashboard exposes a nav card for the gift tools', () => {
  assert.match(adminIndexPage, /href: '\/admin\/gifts'/);
  assert.match(adminIndexPage, /title: 'Quà thật'/);
});

test('gifts.astro wraps in AdminLayout and IS reachable from the admin nav', () => {
  assert.match(adminGiftsPage, /import AdminLayout from '\.\.\/\.\.\/layouts\/AdminLayout\.astro'/);
  assert.match(adminGiftsPage, /<AdminLayout/);
  // This assertion was originally inverted (`doesNotMatch`) on purpose: a
  // concurrent logo-rebrand session owned AdminLayout.astro, so the packet was
  // forbidden from touching it and the test guarded that boundary. That session
  // has merged, the tab is added, and the guard now pins the real requirement —
  // an admin page nobody can navigate to is an admin page that does not exist.
  assert.match(adminLayout, /href: '\/admin\/gifts'/, 'AdminLayout must expose the Quà thật tab');
});

test('gifts.astro wires both the gift manager and the redemption queue on one page', () => {
  assert.match(adminGiftsPage, /id="gifts-mgr-rows"/);
  assert.match(adminGiftsPage, /id="gifts-mgr-add"/);
  assert.match(adminGiftsPage, /id="gifts-mgr-save"/);
  assert.match(adminGiftsPage, /id="gifts-queue"/);
  assert.match(adminGiftsPage, /initGiftManager/);
  assert.match(adminGiftsPage, /initRedemptionQueue/);
});

// --- HANDOFF §0 non-negotiables, checked directly on the source we shipped --

test('zero standalone cô/Cô anywhere in the admin gift tools (Coach Felix is male)', () => {
  for (const [name, src] of [['gifts.astro', adminGiftsPage], ['admin-gifts.ts', adminGiftsLib]]) {
    assert.doesNotMatch(src, /cô|Cô/, `${name} must never use "cô" — the founder is Coach Felix, male`);
  }
});

test('the gift manager never uses inventory language for the budget-cap "Giới hạn" field', () => {
  for (const [name, src] of [['gifts.astro', adminGiftsPage], ['admin-gifts.ts', adminGiftsLib]]) {
    assert.doesNotMatch(src, /tồn kho|hết hàng|\bkho\b/, `${name} must not describe "Giới hạn" as stock/inventory — it is a budget cap, buy-on-demand`);
  }
});

test('the private founder-only columns are marked 🔒', () => {
  assert.match(adminGiftsLib, /Giá thật ₫ 🔒/);
  assert.match(adminGiftsLib, /₫\/💎 🔒/);
  assert.match(adminGiftsLib, /chỉ Felix thấy 🔒/);
});

// --- §6 pure helpers ---------------------------------------------------------

test('costPerDiamond reproduces the HANDOFF §3 real catalogue (milk tea ≈3₫, Lego ≈20₫ — the quiet 6x signal)', async () => {
  const { costPerDiamond, costPerDiamondLabel, isNotableCostPerDiamond } = await loadAdminGifts();
  const milkTea = { price_diamonds: 10000, cost_vnd: 30000 };
  const lego = { price_diamonds: 20000, cost_vnd: 400000 };
  assert.equal(costPerDiamond(milkTea), 3);
  assert.equal(costPerDiamond(lego), 20);
  assert.equal(costPerDiamondLabel(milkTea), '≈ 3₫');
  assert.equal(costPerDiamondLabel(lego), '≈ 20₫');
  assert.equal(isNotableCostPerDiamond(milkTea), false, 'milk tea is normal value, not a highlighted outlier');
  assert.equal(isNotableCostPerDiamond(lego), true, 'Lego is ~6x worse value and should be quietly highlighted');
});

test('costPerDiamond returns null (not Infinity/NaN) for a free gift with price_diamonds 0', async () => {
  const { costPerDiamond, costPerDiamondLabel } = await loadAdminGifts();
  assert.equal(costPerDiamond({ price_diamonds: 0, cost_vnd: 5000 }), null);
  assert.equal(costPerDiamondLabel({ price_diamonds: 0, cost_vnd: 5000 }), '—');
});

test('activePhotoSource: an uploaded file wins over a pasted URL, matching the kid-facing shop precedence', async () => {
  const { activePhotoSource, adminPhotoSrc } = await loadAdminGifts();
  assert.equal(activePhotoSource({ image_key: 'gifts/sticker.jpg', image_url: 'https://example.com/x.jpg' }), 'upload');
  assert.equal(activePhotoSource({ image_key: null, image_url: 'https://example.com/x.jpg' }), 'url');
  assert.equal(activePhotoSource({ image_key: null, image_url: null }), 'none');
  assert.equal(adminPhotoSrc({ id: 'sticker', image_key: 'gifts/sticker.jpg', image_url: null }), '/api/read2lead-gift-image?id=sticker');
  assert.equal(adminPhotoSrc({ id: 'sticker', image_key: null, image_url: 'https://example.com/x.jpg' }), 'https://example.com/x.jpg');
  assert.equal(adminPhotoSrc({ id: 'sticker', image_key: null, image_url: null }), null);
});

test('escapeHtml neutralizes markup (admin-shared.mjs\'s copy is a documented no-op, so this file defines its own)', async () => {
  const { escapeHtml } = await loadAdminGifts();
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('Trà "sữa" & bánh'), 'Trà &quot;sữa&quot; &amp; bánh');
});

test('formatVnd / formatNumberVi use Vietnamese thousands separators (10.000 not 10,000)', async () => {
  const { formatVnd, formatNumberVi } = await loadAdminGifts();
  assert.equal(formatNumberVi(10000), '10.000');
  assert.equal(formatVnd(455000), '455.000₫');
});

test('renderGiftRow renders every input live-editable (the editable-rows pattern) with the real HANDOFF §3 milk-tea values', async () => {
  const { renderGiftRow } = await loadAdminGifts();
  const gift = {
    id: 'milk_tea', name_vi: 'Trà sữa', emoji: '🧋',
    image_key: null, image_url: 'https://cf.shopee.vn/tra-sua.jpg',
    price_diamonds: 10000, limit_total: null, redeemed_count: 0,
    cost_vnd: 30000, active: true,
  };
  const html = renderGiftRow(gift, 0);
  assert.match(html, /data-gift-id="milk_tea"/);
  assert.match(html, /value="Trà sữa"/);
  assert.match(html, /value="10000"/);
  assert.match(html, /value="30000"/);
  assert.match(html, /≈ 3₫/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /placeholder="—"/, 'blank limit_total (unlimited, the normal case) renders as an empty field, not 0');
  assert.match(html, /Đang dùng/, 'the pasted-URL path is the one in use and must carry the badge');
});

// --- §7 redemption queue -----------------------------------------------------

test('renderPreparingRow reproduces the HANDOFF §7 urgency example (Ryan, 9 days = danger; Percy, 2 days = calm)', async () => {
  const { renderPreparingRow } = await loadAdminGifts();
  const ryan = {
    redemption_id: 'r1', code: 'R2L-RYAN', student_name: 'Ryan', gift_id: 'pen', name_vi: 'Bút',
    price_diamonds: 5000, status: 'preparing', ts: new Date().toISOString(), cost_vnd: 8000, days_waiting: 9,
  };
  const percy = { ...ryan, redemption_id: 'r2', student_name: 'Percy', gift_id: 'milk_tea', name_vi: 'Trà sữa', price_diamonds: 10000, days_waiting: 2 };
  const ryanHtml = renderPreparingRow(ryan, new Map());
  const percyHtml = renderPreparingRow(percy, new Map());
  assert.match(ryanHtml, /⚠ chờ 9 ngày/);
  assert.match(ryanHtml, /ag-q-row--urgent/);
  assert.doesNotMatch(percyHtml, /⚠/);
  assert.match(percyHtml, /chờ 2 ngày/);
  assert.doesNotMatch(percyHtml, /ag-q-row--urgent/);
});

test('a diamonds_taken:false row gets the hard phantom warning and its buy/deliver action is disabled — never let Felix spend on a phantom', async () => {
  const { renderRequestedRow, renderPreparingRow } = await loadAdminGifts();
  const phantomRequested = {
    redemption_id: 'r3', code: 'R2L-X', student_name: 'X', gift_id: 'sticker', name_vi: 'Sticker',
    price_diamonds: 1000, status: 'requested', ts: new Date().toISOString(), cost_vnd: 2000, days_waiting: 0,
    diamonds_taken: false,
  };
  const html = renderRequestedRow(phantomRequested, new Map());
  assert.match(html, /⚠ Chưa trừ kim cương — đừng mua/);
  assert.match(html, /data-ag-q-action="accept"[^>]*disabled/);
  // Reject must stay fully enabled — clearing a phantom row is safe and desired.
  assert.doesNotMatch(html, /data-ag-q-action="reject"[^>]*disabled/);

  const phantomPreparing = { ...phantomRequested, status: 'preparing' };
  const preparingHtml = renderPreparingRow(phantomPreparing, new Map());
  assert.match(preparingHtml, /⚠ Chưa trừ kim cương — đừng mua/);
  assert.match(preparingHtml, /data-ag-q-action="deliver"[^>]*disabled/);
});

test('a normal (diamonds_taken true/undefined) row shows no phantom warning and both actions stay enabled', async () => {
  const { renderRequestedRow } = await loadAdminGifts();
  const normal = {
    redemption_id: 'r4', code: 'R2L-Y', student_name: 'Y', gift_id: 'sticker', name_vi: 'Sticker',
    price_diamonds: 1000, status: 'requested', ts: new Date().toISOString(), cost_vnd: 2000, days_waiting: 0,
  };
  const html = renderRequestedRow(normal, new Map());
  assert.doesNotMatch(html, /đừng mua/);
  assert.doesNotMatch(html, /data-ag-q-action="accept"[^>]*disabled/);
});

test('queue rows show the specific gift\'s own emoji (not one generic box) when the catalogue lookup has it', async () => {
  const { renderRequestedRow } = await loadAdminGifts();
  const row = {
    redemption_id: 'r6', code: 'R2L-H', student_name: 'Bé Hiếu', gift_id: 'sticker', name_vi: 'Sticker',
    price_diamonds: 1000, status: 'requested', ts: new Date().toISOString(), cost_vnd: 2000, days_waiting: 0,
  };
  const giftsById = new Map([['sticker', { id: 'sticker', emoji: '🌟', image_key: null, image_url: null }]]);
  const html = renderRequestedRow(row, giftsById);
  assert.match(html, />🌟</);
  const fallbackHtml = renderRequestedRow(row, new Map());
  assert.match(fallbackHtml, />🎁</, 'a gift_id missing from the catalogue lookup falls back to a generic gift box, never a broken image');
});

test('renderQueue shows the monthly total (private, 🔒) and the always-honest refund reassurance box', async () => {
  const { renderQueue } = await loadAdminGifts();
  const groups = { requested: [], preparing: [], delivered: [], rejected: [] };
  const html = renderQueue(groups, 455000);
  assert.match(html, /455\.000₫/);
  assert.match(html, /chi phí quà 🔒/);
  assert.match(html, /tự động hoàn lại toàn bộ 💎/);
  assert.match(html, /Coach Felix/);
});

test('renderDeliveredRow shows history with cost_vnd (admin-only) and a done date', async () => {
  const { renderDeliveredRow } = await loadAdminGifts();
  const delivered = {
    redemption_id: 'r5', code: 'R2L-Z', student_name: 'Bé Hiếu', gift_id: 'lego', name_vi: 'Bộ Lego',
    price_diamonds: 20000, status: 'delivered', ts: '2026-07-02T00:00:00.000Z', cost_vnd: 400000, days_waiting: 0,
  };
  const html = renderDeliveredRow(delivered);
  assert.match(html, /Bé Hiếu/);
  assert.match(html, /400\.000₫/);
  assert.match(html, /02\/07/);
});
