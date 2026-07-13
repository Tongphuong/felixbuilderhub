// Pure engine for the "Quà thật" (real gift) shop — zero I/O, the testable
// seam. Mirrors functions/api/_read2lead-shop-v2.js (buildShopView/executeBuy).
//
// Unlike the monster shop, a gift is CONSUMABLE (a kid may redeem the same
// gift again later), so redemptions are an append-only LEDGER
// (state.redemptions[]), not an idempotent owned-set like unlocked_parts.
//
// Fulfilment lifecycle (buy-on-demand — the founder holds zero inventory and
// buys each gift only after a child redeems it):
//   requested -> preparing (founder is out buying it) -> delivered
//   requested -> rejected
//   preparing -> rejected
// delivered/rejected are terminal. rejected refunds the diamonds spent.

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Mirrors makePortfolioId() in functions/api/admin/portfolio/upload.js.
export function makeRedemptionId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) {
    if (byte >= 252) continue;
    value += ID_CHARS[byte % ID_CHARS.length];
    if (value.length === 12) return `gr_${value}`;
  }
  return makeRedemptionId();
}

function isCapped(gift) {
  return typeof gift?.limit_total === 'number';
}

// Exported so callers that only need to validate a gift choice (e.g. setting
// a gift_goal) reuse this exact rule instead of re-implementing it.
export function isGiftAvailable(gift) {
  if (!gift?.active) return false;
  // A gift priced at 0 is not a gift, it is an unfinished admin row — "+ Thêm
  // quà" creates one with price 0, and until this check existed it went live
  // as FREE: can_afford is `diamonds >= price`, which every child satisfies.
  // One such row ("Quà 8") reached production and every child could claim it,
  // each claim landing in Coach Felix's queue as a real object he was expected
  // to go out and buy. The admin now refuses to save a priced-0 active gift,
  // but THIS is the load-bearing check: it holds for rows already in KV.
  if (numberOrZero(gift.price_diamonds) <= 0) return false;
  if (isCapped(gift) && numberOrZero(gift.redeemed_count) >= gift.limit_total) return false;
  return true;
}

export function buildGiftView(state, catalog) {
  const diamonds = numberOrZero(state?.diamonds);
  return (Array.isArray(catalog) ? catalog : []).map((gift) => {
    const price = numberOrZero(gift.price_diamonds);
    const available = isGiftAvailable(gift);
    // A priced-0 gift is a broken admin row, never available (see
    // isGiftAvailable). It used to report 100% — a full green bar reading
    // "Con đủ kim cương rồi 🎉" on a gift no child may have. 0 is the honest
    // number: there is no progress to make toward a gift with no price.
    const progressPercent = price > 0
      ? Math.max(0, Math.min(100, Math.round((diamonds / price) * 100)))
      : 0;
    return {
      ...gift,
      can_afford: available && diamonds >= price,
      available,
      progress_percent: progressPercent,
    };
  });
}

export const PENDING_STATUSES = new Set(['requested', 'preparing']);

export function executeRedeem(state, catalog, giftId) {
  const id = String(giftId || '').trim();
  const gift = (Array.isArray(catalog) ? catalog : []).find((item) => item.id === id);
  if (!gift) return { state, error: 'gift_not_found' };
  if (!gift.active) return { state, error: 'gift_inactive' };
  if (!isGiftAvailable(gift)) return { state, error: 'gift_unavailable' };

  const price = numberOrZero(gift.price_diamonds);
  const diamonds = numberOrZero(state?.diamonds);
  if (diamonds < price) return { state, error: 'insufficient_diamonds' };

  const redemptions = Array.isArray(state?.redemptions) ? state.redemptions : [];
  const hasPending = redemptions.some((entry) => PENDING_STATUSES.has(entry?.status));
  if (hasPending) return { state, error: 'pending_request_exists' };

  const redemption = {
    id: makeRedemptionId(),
    gift_id: gift.id,
    name_vi: gift.name_vi,
    price_diamonds: price,
    status: 'requested',
    ts: new Date().toISOString(),
  };

  return {
    state: {
      ...state,
      diamonds: diamonds - price,
      redemptions: [...redemptions, redemption],
    },
    redemption,
  };
}

const LEGAL_TRANSITIONS = {
  requested: new Set(['preparing', 'delivered', 'rejected']),
  preparing: new Set(['delivered', 'rejected']),
};

export function applyRedemptionStatus(state, redemptionId, nextStatus) {
  const redemptions = Array.isArray(state?.redemptions) ? state.redemptions : [];
  const index = redemptions.findIndex((entry) => entry?.id === redemptionId);
  if (index === -1) return { state, error: 'invalid_transition' };

  const current = redemptions[index];
  const allowedNext = LEGAL_TRANSITIONS[current.status];
  if (!allowedNext || !allowedNext.has(nextStatus)) {
    return { state, error: 'invalid_transition' };
  }

  const updated = { ...current, status: nextStatus, updated_at: new Date().toISOString() };
  const nextRedemptions = [...redemptions];
  nextRedemptions[index] = updated;

  let diamonds = numberOrZero(state?.diamonds);
  if (nextStatus === 'rejected') {
    diamonds += numberOrZero(current.price_diamonds);
  }

  return {
    state: {
      ...state,
      diamonds,
      redemptions: nextRedemptions,
    },
    redemption: updated,
  };
}
