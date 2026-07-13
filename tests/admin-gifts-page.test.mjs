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
  assert.equal(
    adminPhotoSrc({ id: 'sticker', image_key: 'gifts/sticker-123.jpg', image_url: null }),
    '/api/read2lead-gift-image?id=sticker&v=gifts%2Fsticker-123.jpg',
  );
  assert.equal(adminPhotoSrc({ id: 'sticker', image_key: null, image_url: 'https://example.com/x.jpg' }), 'https://example.com/x.jpg');
  assert.equal(adminPhotoSrc({ id: 'sticker', image_key: null, image_url: null }), null);
});

// Regression, found on the LIVE shop: the eight new photos were uploaded and the
// server served them correctly (curl proved it: 1000x750 WebP), but the browser
// still showed the old Shopee voucher badge — because read2lead-gift-image.js
// answers `Cache-Control: max-age=31536000, immutable` and the URL was just
// `?id=<id>`, identical before and after. The photo was cached for a YEAR.
// Coach Felix would have replaced a bad photo, reloaded, seen the bad photo, and
// concluded the upload was broken — the exact complaint that started this task.
test('a photo URL CHANGES when the photo changes (or a replaced photo is cached for a year)', async () => {
  const { adminPhotoSrc } = await loadAdminGifts();
  const before = adminPhotoSrc({ id: 'sticker', image_key: 'gifts/sticker-1000.webp', image_url: null });
  const after = adminPhotoSrc({ id: 'sticker', image_key: 'gifts/sticker-2000.webp', image_url: null });
  assert.notEqual(before, after, 'same URL for two different photos = the new one never reaches a child');
  assert.match(after, /v=/, 'the cache-busting param must survive');
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

// --- delete a gift (§A) -------------------------------------------------

test('isInvalidActiveGift / findInvalidActiveGiftIndex flag an active price-0 row, and only that shape (§B save guard)', async () => {
  const { isInvalidActiveGift, findInvalidActiveGiftIndex } = await loadAdminGifts();
  const brokenActive = { active: true, price_diamonds: 0 };
  const inactiveZero = { active: false, price_diamonds: 0 };
  const activePriced = { active: true, price_diamonds: 500 };
  assert.equal(isInvalidActiveGift(brokenActive), true, 'active + price 0 must be refused — the production "Quà 8" shape');
  assert.equal(isInvalidActiveGift(inactiveZero), false, 'a toggled-off price-0 draft row is fine — it is not live');
  assert.equal(isInvalidActiveGift(activePriced), false);

  assert.equal(findInvalidActiveGiftIndex([activePriced, brokenActive, inactiveZero]), 1);
  assert.equal(findInvalidActiveGiftIndex([activePriced, inactiveZero]), -1, 'a save-safe catalogue reports no invalid index');
});

test('saveAll refuses to call saveGifts when an active gift is priced 0, highlights the row, and reports through hooks.onError — never alert()', () => {
  const saveAllFn = adminGiftsLib.slice(adminGiftsLib.indexOf('const saveAll = async'), adminGiftsLib.indexOf('addBtn.addEventListener'));
  assert.match(saveAllFn, /findInvalidActiveGiftIndex\(gifts\)/);
  assert.match(saveAllFn, /ag-row--invalid/);
  assert.match(saveAllFn, /return null;/, 'must bail out before reaching saveGifts()');
  assert.doesNotMatch(saveAllFn, /\balert\(/);
  assert.match(saveAllFn, /hooks\.onError\(`Quà "\$\{name\}" đang bật phải có giá lớn hơn 0 💎\.`\)/);
});

test('removeGiftAt (pure model backing the delete-gift row removal) preserves order and does not mutate its input', async () => {
  const { removeGiftAt } = await loadAdminGifts();
  const gifts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const after = removeGiftAt(gifts, 1);
  assert.deepEqual(after.map((g) => g.id), ['a', 'c']);
  assert.equal(gifts.length, 3, 'the original array must be untouched');
  assert.deepEqual(removeGiftAt(gifts, 0).map((g) => g.id), ['b', 'c']);
  assert.deepEqual(removeGiftAt(gifts, 2).map((g) => g.id), ['a', 'b']);
});

test('renderGiftRow carries a >=44px delete button wired to data-ag-action="delete-gift"', async () => {
  const { renderGiftRow } = await loadAdminGifts();
  const gift = {
    id: 'g1', name_vi: 'Sticker', emoji: '🌟', image_key: null, image_url: null,
    price_diamonds: 1000, limit_total: null, redeemed_count: 0, cost_vnd: 0, active: true,
  };
  const html = renderGiftRow(gift, 0);
  assert.match(html, /data-ag-action="delete-gift"/);
  assert.match(html, /ag-delete-btn/);
  assert.match(html, /aria-label="Xoá quà — Sticker"/);
});

test('the delete-gift handler confirms via confirm() (never a silent delete), naming the gift, and warns harder when redeemed_count > 0', () => {
  const anchor = `const deleteBtn = target.closest<HTMLElement>('[data-ag-action="delete-gift"]');`;
  const deleteBranchStart = adminGiftsLib.indexOf(anchor);
  assert.ok(deleteBranchStart >= 0, 'expected the delete-gift click-delegation branch to exist');
  const deleteBranch = adminGiftsLib.slice(deleteBranchStart, adminGiftsLib.indexOf('});', deleteBranchStart));
  assert.match(deleteBranch, /if \(!confirm\(message\)\) return;/);
  assert.match(deleteBranch, /Con nào đang chờ món này vẫn nhận được quà — nhưng món này sẽ biến mất khỏi cửa hàng\./);
  assert.match(deleteBranch, /rowEl\.remove\(\);/);
  // Deleting must NOT auto-save — matches every other edit in this manager
  // (name/price/photo edits are all live-in-DOM-only until "✓ Đã lưu").
  assert.doesNotMatch(deleteBranch, /saveAll\(\)/);
});

test('"Xoá ảnh" clears both image_key and image_url (dataset + url input + upload status) so the gift falls back to its emoji', () => {
  const removeAnchor = `const removePhotoBtn = target.closest<HTMLElement>('[data-ag-action="remove-photo"]');`;
  const deleteAnchor = `const deleteBtn = target.closest<HTMLElement>('[data-ag-action="delete-gift"]');`;
  const removeStart = adminGiftsLib.indexOf(removeAnchor);
  const deleteStart = adminGiftsLib.indexOf(deleteAnchor);
  assert.ok(removeStart >= 0 && deleteStart > removeStart, 'expected the remove-photo branch to exist before the delete-gift branch');
  const removePhotoBranch = adminGiftsLib.slice(removeStart, deleteStart);
  assert.match(removePhotoBranch, /rowEl\.dataset\.imageKey = '';/);
  assert.match(removePhotoBranch, /urlInput\.value = '';/);
  assert.match(removePhotoBranch, /updateRowPhotoUi\(rowEl, readGiftFromRow\(rowEl\)\)/);
});

test('renderGiftRow renders the "Xoá ảnh" button next to "Đóng" inside the photo details panel', async () => {
  const { renderGiftRow } = await loadAdminGifts();
  const gift = {
    id: 'g1', name_vi: 'Sticker', emoji: '🌟', image_key: null, image_url: 'https://cf.shopee.vn/x.jpg',
    price_diamonds: 1000, limit_total: null, redeemed_count: 0, cost_vnd: 0, active: true,
  };
  const html = renderGiftRow(gift, 0);
  const actionsBlock = html.slice(html.indexOf('ag-photo-actions'));
  assert.match(actionsBlock, /data-ag-action="remove-photo">Xoá ảnh</);
  assert.match(actionsBlock, /data-ag-action="close-photo">Đóng</);
});

test('the gift manager grid template gained an 8th (44px) column for the delete button, identically in .ag-columns and .ag-row__grid', () => {
  const occurrences = (adminGiftsPage.match(/grid-template-columns: 64px 1\.3fr 100px 120px 56px 116px 92px 44px;/g) || []).length;
  assert.equal(occurrences, 2, 'both .ag-columns and .ag-row__grid must share the identical 8-column template');
});

test('renderGiftManagerColumnHeaders and the hardcoded gifts.astro header both carry 8 column headers (7 labeled + 1 blank for the delete button)', async () => {
  const { renderGiftManagerColumnHeaders } = await loadAdminGifts();
  const helperHtml = renderGiftManagerColumnHeaders();
  assert.equal((helperHtml.match(/<span/g) || []).length, 8);

  const start = adminGiftsPage.indexOf('class="ag-columns"');
  const pageHeaderBlock = adminGiftsPage.slice(start, adminGiftsPage.indexOf('</div>', start));
  assert.equal((pageHeaderBlock.match(/<span/g) || []).length, 8);
});

// --- emoji-is-a-fallback on the admin side (§C) --------------------------

test('renderGiftPhotoThumb emits the onload has-img hook when a photo exists, and no <img> at all when there is none', async () => {
  const { renderGiftPhotoThumb } = await loadAdminGifts();
  const withPhoto = renderGiftPhotoThumb({ id: 'sticker', emoji: '🌟', image_key: null, image_url: 'https://cf.shopee.vn/x.jpg' });
  assert.match(withPhoto, /<img /);
  assert.match(withPhoto, /onload="this\.closest\('\.ag-thumb'\)\?\.classList\.add\('ag-thumb--has-img'\)"/);
  assert.match(withPhoto, /onerror="this\.remove\(\)"/);

  const withoutPhoto = renderGiftPhotoThumb({ id: 'sticker', emoji: '🌟', image_key: null, image_url: null });
  assert.doesNotMatch(withoutPhoto, /<img/);
  assert.match(withoutPhoto, /ag-thumb__emoji/, 'the emoji fallback itself is still always rendered');
});

test('updateRowPhotoUi resets the has-img class before conditionally re-adding it, and wires the same onload hook as the initial render', () => {
  const fnBody = adminGiftsLib.slice(adminGiftsLib.indexOf('function updateRowPhotoUi'), adminGiftsLib.indexOf('export type GiftManagerHooks'));
  assert.match(fnBody, /well\.classList\.remove\('ag-thumb--has-img'\)/);
  assert.match(fnBody, /img\.onload = \(\) => well\.classList\.add\('ag-thumb--has-img'\)/);
});

test('gifts.astro only hides the admin thumb emoji once the has-img class is present (never unconditionally)', () => {
  assert.match(adminGiftsPage, /:global\(\.ag-thumb--has-img \.ag-thumb__emoji\) \{ display: none; \}/);
});

// --- image-URL field teaches, not silently accepts (§D) ------------------

test('isLikelyImageUrl accepts known image-CDN hosts and direct image extensions, rejects a Shopee product-page URL, accepts empty (clearing is allowed)', async () => {
  const { isLikelyImageUrl } = await loadAdminGifts();
  assert.equal(isLikelyImageUrl('https://down-vn.img.susercontent.com/file/abc123'), true, 'Shopee\'s actual image host');
  assert.equal(isLikelyImageUrl('https://cf.shopee.vn/file/sticker.webp'), true);
  assert.equal(isLikelyImageUrl('https://example.com/photos/gift.jpg'), true, 'any host is fine as long as the path ends in an image extension');
  assert.equal(isLikelyImageUrl('https://shopee.vn/San-pham-i.1253087927.26035316034'), false, 'the exact production incident: a product page, not an image');
  assert.equal(isLikelyImageUrl(''), true, 'empty is valid — clearing the field is always allowed');
  assert.equal(isLikelyImageUrl('   '), true);
  assert.equal(isLikelyImageUrl('not a url'), false);
});

test('renderGiftRow replaces the generic hint with a teaching one, and adds a hidden-by-default warning line for the URL field', async () => {
  const { renderGiftRow } = await loadAdminGifts();
  const gift = {
    id: 'g1', name_vi: 'Sticker', emoji: '🌟', image_key: null, image_url: null,
    price_diamonds: 1000, limit_total: null, redeemed_count: 0, cost_vnd: 0, active: true,
  };
  const html = renderGiftRow(gift, 0);
  assert.match(html, /Cần LINK ẢNH, không phải link sản phẩm/);
  assert.match(html, /Sao chép địa chỉ hình ảnh/);
  assert.doesNotMatch(html, /Cách thường dùng — dán link ảnh tìm được trên mạng\./, 'the old generic hint must be gone');
  assert.match(html, /data-ag-url-warning hidden/);
});

test('renderGiftRow adds the "ảnh con sẽ thấy" honesty line under the Xem trước preview', async () => {
  const { renderGiftRow } = await loadAdminGifts();
  const gift = {
    id: 'g1', name_vi: 'Sticker', emoji: '🌟', image_key: null, image_url: null,
    price_diamonds: 1000, limit_total: null, redeemed_count: 0, cost_vnd: 0, active: true,
  };
  const html = renderGiftRow(gift, 0);
  assert.match(html, /Ảnh này chính là ảnh con sẽ thấy\. Nếu ở đây trông sai, con cũng sẽ thấy sai\./);
});

test('the URL field is validated on focusout (blur\'s bubbling equivalent), teaching rather than blocking Save', () => {
  const focusoutHandler = adminGiftsLib.slice(adminGiftsLib.indexOf("rowsHost.addEventListener('focusout'"), adminGiftsLib.indexOf("rowsHost.addEventListener('change'"));
  assert.match(focusoutHandler, /isLikelyImageUrl\(input\.value\)/);
  assert.match(focusoutHandler, /warningEl\.hidden = looksLikeImage/);
  assert.doesNotMatch(focusoutHandler, /\balert\(/);
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
