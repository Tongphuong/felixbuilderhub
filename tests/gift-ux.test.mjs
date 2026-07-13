import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';

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

async function loadGiftUx() {
  await ensureHarness();
  return viteServer.ssrLoadModule('/src/lib/gift-ux.ts');
}

async function loadGoalCard() {
  await ensureHarness();
  return viteServer.ssrLoadModule('/src/lib/gift-goal-card.ts');
}

// Buffet, MEDIUM: the goal card recomputes its own bar width instead of using
// the server's progress_percent, and its price<=0 fallback hard-coded 100%.
// Once a price-0 gift became `unavailable`, that produced a FULL GOLD BAR
// sitting directly above "Món quà này tạm thời chưa đổi được." — on the
// child's profile, the lesson-completion card AND the parent report.
//
// Note this test RENDERS the card and reads the bar out of the markup. The
// pre-existing goal-card tests only grep the source text, which is exactly
// why none of them caught it. A test that cannot see the bar cannot defend it.
// Rendered, not grepped. `read2lead-gift-goal.js` gates on isGiftAvailable()
// and answers 400 `gift_unavailable` for an unavailable gift — verified against
// the live deployed endpoint — so offering "Đặt làm mục tiêu ★" on that card is
// a button a child taps and is refused. The old source-grep test asserted the
// button's PRESENCE and stayed green the whole time.
test('shop: an unavailable gift card offers a child NO button the server would refuse', async () => {
  const { renderGiftCard } = await loadGiftUx();
  const brokenRow = {
    id: 'gift-blank', name_vi: 'Quà 8', emoji: '🎁', image_key: null, image_url: null,
    price_diamonds: 0, can_afford: false, available: false, progress_percent: 0,
  };
  const card = renderGiftCard(brokenRow, 'unavailable', undefined, 4295, 'band');

  assert.doesNotMatch(card, /qt-set-goal/, 'no "set as goal" button — the server answers 400 for this gift');
  assert.doesNotMatch(card, /Đặt làm mục tiêu/);
  assert.doesNotMatch(card, /qt-redeem/, 'and certainly no redeem button');
  // The card must still explain itself rather than going silent.
  assert.match(card, /tạm thời chưa đổi được/);
});

test('shop: an AVAILABLE gift a child cannot yet afford still offers the goal button', async () => {
  const { renderGiftCard } = await loadGiftUx();
  const football = {
    id: 'football', name_vi: 'Quả bóng đá', emoji: '⚽', image_key: null, image_url: null,
    price_diamonds: 30000, can_afford: false, available: true, progress_percent: 3,
  };
  const card = renderGiftCard(football, 'saving', undefined, 1000, 'band');
  assert.match(card, /qt-set-goal/, 'the fix above must not strip the goal button from normal gifts');
});

test('gift goal card: a price-0 (unavailable) pinned goal renders an EMPTY bar, not a full one', async () => {
  const { renderGiftGoalCard } = await loadGoalCard();
  const brokenRow = {
    id: 'gift-blank', name_vi: 'Quà 8', emoji: '🎁',
    price_diamonds: 0, can_afford: false, available: false, progress_percent: 0,
  };
  const html = renderGiftGoalCard(brokenRow, 4295, [], { variant: 'wide', code: 'R2L-TEST' });

  const width = html.match(/width:\s*(\d+)%/);
  assert.ok(width, 'the card must render a progress bar');
  assert.equal(width[1], '0', 'a gift no child can obtain must not show a completed bar');
  assert.match(html, /tạm thời chưa đổi được/, 'and it must still say so in words');
});

test('gift goal card: a normal priced goal still reports real progress', async () => {
  const { renderGiftGoalCard } = await loadGoalCard();
  const pen = {
    id: 'pen', name_vi: 'Bút', emoji: '🖊️',
    price_diamonds: 5000, can_afford: false, available: true, progress_percent: 63,
  };
  const html = renderGiftGoalCard(pen, 3135, [], { variant: 'wide', code: 'R2L-TEST' });
  const width = html.match(/width:\s*(\d+)%/);
  assert.equal(width[1], '63');
});

const giftUxSource = readFileSync('src/lib/gift-ux.ts', 'utf8');
const giftsPage = readFileSync('src/pages/read2lead/gifts.astro', 'utf8');

// Real demo data from Read2Lead Real Gifts Shop/HANDOFF.md §3. progress_percent
// is computed server-side the same way functions/api/_gifts-v2.js does it
// (buildGiftView): round((diamonds / price) * 100), capped 0..100.
const HIEUENZO_DIAMONDS = 4295;
const CATALOG = [
  { id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000 },
  { id: 'pen', name_vi: 'Bút', emoji: '🖊️', price_diamonds: 5000 },
  { id: 'pencil_case', name_vi: 'Hộp bút', emoji: '✏️', price_diamonds: 7000 },
  { id: 'milk_tea', name_vi: 'Trà sữa', emoji: '🧋', price_diamonds: 10000 },
  { id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 20000 },
  { id: 'books', name_vi: 'Sách', emoji: '📚', price_diamonds: 20000 },
  { id: 'football', name_vi: 'Quả bóng đá', emoji: '⚽', price_diamonds: 30000 },
];

function buildItem(base, diamonds) {
  const price = base.price_diamonds;
  const percent = price > 0 ? Math.max(0, Math.min(100, Math.round((diamonds / price) * 100))) : 100;
  return {
    ...base,
    image_key: null,
    image_url: null,
    can_afford: diamonds >= price,
    available: true,
    progress_percent: percent,
  };
}

test('gift progress_percent reproduces the HANDOFF §3 demo child (Hieuenzo, 4.295 💎)', () => {
  const items = CATALOG.map((g) => buildItem(g, HIEUENZO_DIAMONDS));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.sticker.progress_percent, 100);
  assert.equal(byId.sticker.can_afford, true);
  assert.equal(byId.pen.progress_percent, 86);
  assert.equal(byId.pencil_case.progress_percent, 61);
  assert.equal(byId.milk_tea.progress_percent, 43);
  assert.equal(byId.lego.progress_percent, 21);
  assert.equal(byId.books.progress_percent, 21);
  assert.equal(byId.football.progress_percent, 14);
});

test('deriveGiftCardState buckets the demo child correctly (affordable vs saving)', async () => {
  const { deriveGiftCardState } = await loadGiftUx();
  const items = CATALOG.map((g) => buildItem(g, HIEUENZO_DIAMONDS));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(deriveGiftCardState(byId.sticker, []), 'affordable');
  assert.equal(deriveGiftCardState(byId.pen, []), 'saving');
  assert.equal(deriveGiftCardState(byId.football, []), 'saving');
});

test('deriveGiftCardState flags near-miss at >=95%; only in-flight statuses (requested/preparing) override progress — delivered/rejected fall through', async () => {
  const { deriveGiftCardState } = await loadGiftUx();
  const nearMissItem = buildItem({ id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000 }, 990);
  assert.equal(nearMissItem.progress_percent, 99);
  assert.equal(deriveGiftCardState(nearMissItem, []), 'nearmiss');

  const pendingRedemptions = [{ id: 'r1', gift_id: 'sticker', name_vi: 'Sticker', price_diamonds: 1000, status: 'requested', ts: new Date().toISOString() }];
  assert.equal(deriveGiftCardState(nearMissItem, pendingRedemptions), 'pending');

  const preparingRedemptions = [{ id: 'r1', gift_id: 'sticker', name_vi: 'Sticker', price_diamonds: 1000, status: 'preparing', ts: new Date().toISOString() }];
  assert.equal(deriveGiftCardState(nearMissItem, preparingRedemptions), 'preparing');

  // Gifts are repeatable by founder decision (a child who loved their gift
  // can save for another), so a `delivered` redemption must NOT lock the
  // card forever — it falls through to the progress-based rules exactly
  // like having no redemption at all. The delivered redemption still shows
  // up separately in the trophy row (renderTrophyGroup); it just no longer
  // overrides this card's own affordability state.
  const deliveredRedemptions = [{ id: 'r1', gift_id: 'sticker', name_vi: 'Sticker', price_diamonds: 1000, status: 'delivered', ts: new Date().toISOString() }];
  assert.equal(deriveGiftCardState(nearMissItem, deliveredRedemptions), 'nearmiss');

  // A rejected redemption is terminal + refunded — falls through to the
  // progress-based rules as if no redemption existed.
  const rejectedRedemptions = [{ id: 'r1', gift_id: 'sticker', name_vi: 'Sticker', price_diamonds: 1000, status: 'rejected', ts: new Date().toISOString() }];
  assert.equal(deriveGiftCardState(nearMissItem, rejectedRedemptions), 'nearmiss');
});

test('giftBand buckets by proximity: now / soon / building', async () => {
  const { giftBand } = await loadGiftUx();
  const items = CATALOG.map((g) => buildItem(g, HIEUENZO_DIAMONDS));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(giftBand(byId.sticker), 'now');
  assert.equal(giftBand(byId.pen), 'soon');
  assert.equal(giftBand(byId.pencil_case), 'soon');
  assert.equal(giftBand(byId.milk_tea), 'building');
  assert.equal(giftBand(byId.lego), 'building');
  assert.equal(giftBand(byId.football), 'building');
});

// Regression coverage for Buffet's HIGH finding: available:false (toggled
// off, or its limit_total budget cap exhausted — functions/api/_gifts-v2.js
// isGiftAvailable) was not checked at all before this fix. A child crossing
// 95%/100% on a now-unavailable gift was told "sắp đủ rồi 🔥" /
// "Đổi được rồi!" for something no amount of diamonds will ever unlock —
// this closes that path with dedicated tests (previously zero coverage).
test('deriveGiftCardState returns "unavailable" — never "nearmiss" or "affordable" — for a gift with available:false, regardless of progress or can_afford', async () => {
  const { deriveGiftCardState } = await loadGiftUx();

  // 99% progress (would be near-miss if available).
  const nearMissButUnavailable = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 990);
  nearMissButUnavailable.available = false;
  assert.equal(nearMissButUnavailable.progress_percent, 99);
  assert.equal(deriveGiftCardState(nearMissButUnavailable, []), 'unavailable');

  // can_afford:true (would be affordable if available).
  const affordableButUnavailable = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 5000);
  affordableButUnavailable.available = false;
  assert.equal(affordableButUnavailable.can_afford, true);
  assert.equal(deriveGiftCardState(affordableButUnavailable, []), 'unavailable');

  // Still building (< 50%) and unavailable — also 'unavailable', not 'saving'.
  const buildingButUnavailable = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 100);
  buildingButUnavailable.available = false;
  assert.equal(deriveGiftCardState(buildingButUnavailable, []), 'unavailable');
});

test('deriveGiftCardState still lets an in-flight redemption (requested/preparing) win over available:false — a child already waiting on a gift must keep seeing that, even if the gift went unavailable in the meantime', async () => {
  const { deriveGiftCardState } = await loadGiftUx();
  const unavailableItem = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 1000);
  unavailableItem.available = false;

  const requested = [{ id: 'r1', gift_id: 'lego', name_vi: 'Bộ Lego', price_diamonds: 1000, status: 'requested', ts: new Date().toISOString() }];
  assert.equal(deriveGiftCardState(unavailableItem, requested), 'pending');

  const preparing = [{ id: 'r1', gift_id: 'lego', name_vi: 'Bộ Lego', price_diamonds: 1000, status: 'preparing', ts: new Date().toISOString() }];
  assert.equal(deriveGiftCardState(unavailableItem, preparing), 'preparing');
});

test('giftBand puts an unavailable gift in its own "unavailable" band, never "now"/"soon" regardless of affordability or progress', async () => {
  const { giftBand } = await loadGiftUx();
  const affordableButUnavailable = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 5000);
  affordableButUnavailable.available = false;
  assert.equal(giftBand(affordableButUnavailable), 'unavailable');

  const nearMissButUnavailable = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 990);
  nearMissButUnavailable.available = false;
  assert.equal(giftBand(nearMissButUnavailable), 'unavailable');

  const soonButUnavailable = buildItem({ id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 1000 }, 600);
  soonButUnavailable.available = false;
  assert.equal(giftBand(soonButUnavailable), 'unavailable');
});

test('the unavailable-gift card is honest and kind: no hype text, no inventory language, keeps the real photo/progress bar, no redeem CTA, and offers a goal-changing path instead', () => {
  const unavailableBranch = giftUxSource.slice(
    giftUxSource.indexOf("if (state === 'unavailable')"),
    giftUxSource.indexOf("if (state === 'affordable')"),
  );
  assert.doesNotMatch(unavailableBranch, /🔥/);
  assert.doesNotMatch(unavailableBranch, /Chỉ còn/);
  assert.doesNotMatch(unavailableBranch, /Đổi quà ngay/);
  assert.doesNotMatch(unavailableBranch, /qt-redeem/);
  assert.doesNotMatch(unavailableBranch, /hết hàng|còn lại \d|tồn kho|sold out/i);
  // The photo (imageSrc: img) and the real progress bar are kept.
  assert.match(unavailableBranch, /imageSrc: img/);
  assert.match(unavailableBranch, /progressBarHtml\(percent\)/);
  assert.match(unavailableBranch, /Món quà này tạm thời chưa đổi được\. Coach Felix sẽ mở lại sau nhé!/);
  // The goal variant offers a path to a DIFFERENT goal.
  assert.match(unavailableBranch, /Chọn mục tiêu khác ★/);

  // Whether the BAND variant offers a goal button is deliberately NOT asserted
  // here any more — see the rendered test 'an unavailable gift card offers a
  // child NO button the server would refuse'. This grep-the-source test used to
  // assert the button was PRESENT, on the theory the gift "may reopen later".
  // The theory was false (read2lead-gift-goal.js answers 400 gift_unavailable),
  // so it was a dead click, and this test stayed green through all of it.
  // Worse, when the code was fixed, the assertion could only be satisfied by
  // never mentioning the button — even in a COMMENT explaining its absence.
  // A test that greps source text cannot tell code from prose, and cannot see
  // what a child is offered. Render the card and look at it.
});

test('the "Tạm thời chưa mở" band exists and renders below "Con đang xây dựng" at the very bottom of the catalogue', () => {
  const labelsBlock = giftUxSource.slice(giftUxSource.indexOf('const labels: Record<GiftBand'), giftUxSource.indexOf('const label = labels[band];'));
  assert.match(labelsBlock, /unavailable: \{ title: 'Tạm thời chưa mở'/);

  const bandsFn = giftUxSource.slice(giftUxSource.indexOf('const renderBands ='), giftUxSource.indexOf('const render = ()'));
  assert.match(bandsFn, /giftBand\(item\) === 'unavailable' && item\.id !== giftGoal/);
  const nowIdx = bandsFn.indexOf("renderBandSection('now'");
  const soonIdx = bandsFn.indexOf("renderBandSection('soon'");
  const buildingIdx = bandsFn.indexOf("renderBandSection('building'");
  const unavailableIdx = bandsFn.indexOf("renderBandSection('unavailable'");
  assert.ok(nowIdx > 0 && soonIdx > nowIdx && buildingIdx > soonIdx && unavailableIdx > buildingIdx, 'unavailable band must render last, below building');
});

test('an unavailable pinned goal (GiftGoalCard, reused on lesson/profile/parent screens) tells the child honestly and offers a one-tap path to a different goal — never a bare progress bar toward something they can never have', () => {
  const goalCardSource = readFileSync('src/lib/gift-goal-card.ts', 'utf8');
  // deriveGiftCardState is imported, never re-implemented (see gift-ux.ts
  // tests above) — so this file inherits the 'unavailable' classification
  // for free. It must still (a) caption it honestly and (b) offer an escape
  // hatch, since a child's pinned goal going unavailable is the sharpest
  // edge of this whole feature.
  assert.match(goalCardSource, /case 'unavailable':/);
  assert.match(goalCardSource, /Món quà này tạm thời chưa đổi được\. Coach Felix sẽ mở lại sau nhé!/);
  assert.match(goalCardSource, /Chọn mục tiêu khác/);
  assert.doesNotMatch(goalCardSource.slice(goalCardSource.indexOf("case 'unavailable':"), goalCardSource.indexOf('default: {')), /🔥/);
});

test('the "còn N 💎" shortfall is computed from the real balance, not the rounded percentage', () => {
  // Regression guard for the bug where deficit was reconstructed as
  // price - round(percent/100 * price), which silently drops precision
  // (Bút: round(0.86 * 5000) = 4300 -> deficit 700, vs the true 705).
  assert.doesNotMatch(giftUxSource, /price_diamonds\s*-\s*Math\.round\(/);
  // The goal card no longer has its own deficit calc — it delegates to
  // renderGiftCard (see the near-miss regression test below), so only the
  // nearmiss + saving branches compute this directly.
  const deficitMatches = giftUxSource.match(/const deficit = Math\.max\(0, item\.price_diamonds - diamonds\);/g) || [];
  assert.ok(deficitMatches.length >= 2, 'expected the nearmiss/saving deficit calcs to use the real diamonds balance');
});

test('the pinned goal card renders through the same per-state branches as a band card (no forked "saving-only" goal template)', async () => {
  // Regression guard: a child's goal is very often also their near-miss (the
  // whole point of pinning it), so if the goal card had its own generic
  // template it would never show the pulse/badge/CTA for that state.
  const { deriveGiftCardState } = await loadGiftUx();
  const nearMissGoal = buildItem({ id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000 }, 990);
  assert.equal(deriveGiftCardState(nearMissGoal, []), 'nearmiss');

  // renderGoalCard must delegate into renderGiftCard(..., 'goal') rather
  // than building its own markup.
  const goalCardFn = giftUxSource.slice(giftUxSource.indexOf('function renderGoalCard'));
  const goalCardBody = goalCardFn.slice(0, goalCardFn.indexOf('\n}') + 2);
  assert.match(goalCardBody, /deriveGiftCardState\(item, redemptions\)/);
  assert.match(goalCardBody, /return renderGiftCard\(item, state, redemption, diamonds, 'goal', blocked\)/);

  // renderGiftCard's nearmiss branch (shared by band and goal cards) must
  // still carry the loud treatment: pulse, fire badge, and both copy lines.
  const nearmissBranch = giftUxSource.slice(giftUxSource.indexOf("state === 'nearmiss'"), giftUxSource.indexOf("// state === 'saving'"));
  assert.match(nearmissBranch, /qt-pulse/);
  assert.match(nearmissBranch, /🔥 Sắp đổi được!/);
  assert.match(nearmissBranch, /Chỉ còn \$\{escapeHtml\(formatDiamonds\(deficit\)\)\} 💎 nữa thôi! 🔥/);
  assert.match(nearmissBranch, /Buổi học tới của con là đủ rồi!/);
});

test('the pinned goal is unconditionally excluded from every catalogue band (one gift, one card)', () => {
  const bandsFn = giftUxSource.slice(giftUxSource.indexOf('const renderBands ='), giftUxSource.indexOf('const render = ()'));
  assert.match(bandsFn, /giftBand\(item\) === 'now' && item\.id !== giftGoal/);
  assert.match(bandsFn, /giftBand\(item\) === 'soon' && item\.id !== giftGoal/);
  assert.match(bandsFn, /giftBand\(item\) === 'building' && item\.id !== giftGoal/);
});

test('the code-entry box is hidden once the shop loads', () => {
  const loadFn = giftUxSource.slice(giftUxSource.indexOf('const loadGifts ='), giftUxSource.indexOf('const handleLoadError ='));
  assert.match(loadFn, /qs\('#gifts-entry'\)\?\.classList\.add\('hidden'\)/);
});

test('gift-ux never mixes in the coin economy (💎 only, no 🪙, no cost_vnd/₫)', () => {
  assert.doesNotMatch(giftUxSource, /🪙/);
  assert.doesNotMatch(giftUxSource, /cost_vnd/);
  assert.doesNotMatch(giftUxSource, /₫/);
  assert.match(giftUxSource, /💎/);
});

test('no inventory language leaks into gift-ux rendering', () => {
  assert.doesNotMatch(giftUxSource, /hết hàng|còn lại \d|tồn kho|sold out/i);
});

test('numbers are formatted vi-VN (dot thousands separators, not commas)', () => {
  assert.match(giftUxSource, /toLocaleString\('vi-VN'\)/);
});

test('redeem confirm click disables the button before the network call (race guard)', () => {
  const handlerStart = giftUxSource.indexOf('const handleConfirmRedeem');
  const disableAt = giftUxSource.indexOf('yesBtn.disabled = true;', handlerStart);
  const fetchAt = giftUxSource.indexOf('redeemGiftRequest(', handlerStart);
  assert.ok(handlerStart >= 0 && disableAt > handlerStart && fetchAt > disableAt, 'button must be disabled before the redeem request is sent');
  assert.match(giftUxSource, /if \(!dialog \|\| !yesBtn \|\| yesBtn\.disabled \|\| !pendingGiftId\) return;/);
});

test('interpolated gift name/id strings are escaped', () => {
  assert.match(giftUxSource, /function escapeHtml/);
  assert.match(giftUxSource, /escapeHtml\(item\.id\)/);
  assert.match(giftUxSource, /escapeHtml\(name\)/);
});

test('gifts.astro page shell has no ?v3=1 gate (the diamond price is the only gate)', () => {
  assert.doesNotMatch(giftsPage, /v3=1/);
  assert.doesNotMatch(giftsPage, /isV3Enabled/);
});

test('gifts.astro reuses fx-* primitives and bans r2l-kid-* classes / Baloo 2', () => {
  assert.match(giftsPage, /fx-btn/);
  assert.match(giftsPage, /fx-field/);
  assert.doesNotMatch(giftsPage, /r2l-kid-/);
  assert.doesNotMatch(giftsPage, /Baloo/);
});

test('no standalone "cô" (female-teacher classifier) in any kid-facing gift string — the founder, Coach Felix, is male (HANDOFF §0 rule 10)', () => {
  // Matches a bare "cô"/"Cô" word (the pronoun/classifier), not as a
  // substring of another word ("công", "có", "cơ", "Coach") and not as part
  // of the "Coach Felix" name itself.
  const standaloneCo = /(?<![a-zà-ỹ])cô(?![a-zà-ỹ])/i;
  const confirmModalSource = readFileSync('src/components/read2lead/gifts/GiftConfirmModal.astro', 'utf8');
  const successModalSource = readFileSync('src/components/read2lead/gifts/GiftSuccessModal.astro', 'utf8');
  assert.doesNotMatch(giftUxSource, standaloneCo, 'src/lib/gift-ux.ts');
  assert.doesNotMatch(giftsPage, standaloneCo, 'src/pages/read2lead/gifts.astro');
  assert.doesNotMatch(confirmModalSource, standaloneCo, 'GiftConfirmModal.astro');
  assert.doesNotMatch(successModalSource, standaloneCo, 'GiftSuccessModal.astro');

  // Extended per Buffet's review (this guard originally covered only the 4
  // files above): GiftGoalCard renders on these surfaces too, and this is
  // exactly the kind of shared/marketing file where "cô" leaked in the
  // first place. No live violation as of this fix — this closes the hole,
  // it does not report a regression.
  const goalCardSource = readFileSync('src/lib/gift-goal-card.ts', 'utf8');
  const lessonSource = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');
  const kidViewSource = readFileSync('src/pages/ho-so/ho-so-kid-view.ts', 'utf8');
  const parentViewSource = readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf8');
  const read2leadSource = readFileSync('src/pages/read2lead.astro', 'utf8');
  const leaderboardSource = readFileSync('src/pages/read2lead/leaderboard.astro', 'utf8');
  assert.doesNotMatch(goalCardSource, standaloneCo, 'src/lib/gift-goal-card.ts');
  assert.doesNotMatch(lessonSource, standaloneCo, 'src/pages/read2lead/lesson.astro');
  assert.doesNotMatch(kidViewSource, standaloneCo, 'src/pages/ho-so/ho-so-kid-view.ts');
  assert.doesNotMatch(parentViewSource, standaloneCo, 'src/pages/ho-so/ho-so-parent-view.ts');
  assert.doesNotMatch(read2leadSource, standaloneCo, 'src/pages/read2lead.astro');
  assert.doesNotMatch(leaderboardSource, standaloneCo, 'src/pages/read2lead/leaderboard.astro');
});

const quaThatCss = readFileSync('src/styles/qua-that.css', 'utf8');

test('qua-that.css keyframes are gated by prefers-reduced-motion', () => {
  assert.match(quaThatCss, /@keyframes qt-pulse/);
  assert.match(quaThatCss, /@keyframes qt-shimmer/);
  assert.match(quaThatCss, /@keyframes qt-float/);
  const reduceBlock = quaThatCss.slice(quaThatCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduceBlock, /\.qt-pulse/);
  assert.match(reduceBlock, /\.qt-shimmer/);
  assert.match(reduceBlock, /\.qt-float/);
});

test('the photo well falls back from photo to emoji via onerror', () => {
  assert.match(giftUxSource, /onerror="this\.remove\(\)"/);
});

// --- emoji-is-a-fallback regression (production bug: a mostly-transparent
// Shopee campaign PNG stacked the emoji AND the img, so the emoji showed
// through a broken photo instead of being hidden by a working one) --------

test('renderPhotoWell emits an onload hook that hides the emoji once a real photo has decoded, and emits no <img> at all when there is no image source', async () => {
  const { renderPhotoWell } = await loadGiftUx();
  const withImg = renderPhotoWell({ emoji: '🌟', name: 'Sticker', imageSrc: 'https://cf.shopee.vn/sticker.jpg' });
  assert.match(withImg, /<img /);
  assert.match(withImg, /onload="this\.closest\('\.qt-photo-well'\)\?\.classList\.add\('qt-photo-well--has-img'\)"/);
  assert.match(withImg, /onerror="this\.remove\(\)"/);

  const withoutImg = renderPhotoWell({ emoji: '🌟', name: 'Sticker' });
  assert.doesNotMatch(withoutImg, /<img/);
  // The emoji itself is still rendered — it is the fallback, always present
  // in the markup; only CSS (gated on the --has-img class) hides it.
  assert.match(withoutImg, /qt-photo-well__emoji/);
});

test('qua-that.css only hides the emoji fallback once the has-img class is present (never unconditionally)', () => {
  assert.match(quaThatCss, /\.qt-photo-well--has-img \.qt-photo-well__emoji \{\s*display: none;/);
  // Regression guard: no bare rule hides qt-photo-well__emoji outright.
  assert.doesNotMatch(quaThatCss, /^\.qt-photo-well__emoji\s*\{\s*display: none/m);
});
