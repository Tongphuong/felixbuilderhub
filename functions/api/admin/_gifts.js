// KV store module for the "Quà thật" (real gift) catalogue. Mirrors
// functions/api/admin/_classes.js (loadClassStore/saveClassStore/normalizeClass).
//
// Fulfilment is BUY-ON-DEMAND: the founder holds zero inventory and buys
// each gift only after a child redeems it. `limit_total` is therefore a
// BUDGET CAP the founder can optionally set (e.g. "Lego: 2 this term" so a
// few kids can't commit his cash flow at once) — it is NOT stock/inventory.
// `null` = unlimited, the normal case. Never name anything "stock" and never
// use inventory language anywhere this module's data reaches a child.

export const GIFT_STORE_KEY = 'config:gifts:v1';

// Seed catalogue — a deliberate ladder from an affordable first rung (the
// sticker) up to the big-ticket items, per founder decision 2026-07-13.
// cost_vnd is the founder's real-world purchase cost (Read2Lead Real Gifts
// Shop/HANDOFF.md §3) — without it the admin's ≈₫/💎 column and monthly-cost
// rollup read as "—"/₫0 until he types every figure by hand.
// limit_total is deliberately left unset (unlimited) on every seed gift —
// blank/unlimited is the founder's stated normal case; a cap is an optional
// budget guard he sets himself, never seeded.
export const DEFAULT_GIFTS = [
  { id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000, cost_vnd: 2000 },
  { id: 'pen', name_vi: 'Bút', emoji: '🖊️', price_diamonds: 5000, cost_vnd: 8000 },
  { id: 'pencil_case', name_vi: 'Hộp bút', emoji: '✏️', price_diamonds: 7000, cost_vnd: 25000 },
  { id: 'milk_tea', name_vi: 'Trà sữa', emoji: '🧋', price_diamonds: 10000, cost_vnd: 30000 },
  { id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 20000, cost_vnd: 400000 },
  { id: 'books', name_vi: 'Sách', emoji: '📚', price_diamonds: 20000, cost_vnd: 90000 },
  { id: 'football', name_vi: 'Quả bóng đá', emoji: '⚽', price_diamonds: 30000, cost_vnd: 150000 },
];

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function giftKv(env) {
  return env.READ2LEAD_CODES || null;
}

function cleanGiftId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function makeGiftId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `gift-${Date.now().toString(36)}-${rand}`;
}

export function normalizeGift(raw = {}, i = 0) {
  const nameVi = String(raw?.name_vi || raw?.name || '').trim().slice(0, 80);
  // A NEW row (the admin sends id: '') always gets a fresh random id. It used
  // to fall back to a slug of the name — harmless while gifts could only ever
  // be ADDED, but delete now frees ids for reuse: delete "Sticker" (id
  // `sticker`) while a child's redemption for it is still in the queue, add a
  // new gift also called "Sticker", and it would inherit the SAME id — so the
  // old redemption's thumbnail, and its budget-cap restore on reject, would
  // silently resolve against the new gift. (Buffet, LOW-MEDIUM.) Every gift in
  // DEFAULT_GIFTS carries an explicit id, so nothing depends on the slug path.
  const id = cleanGiftId(raw?.id) || makeGiftId();
  const priceDiamonds = Math.max(0, Math.trunc(Number(raw?.price_diamonds) || 0));
  const limitTotalRaw = raw?.limit_total;
  const limitTotal = limitTotalRaw === null || limitTotalRaw === undefined || limitTotalRaw === ''
    ? null
    : Math.max(0, Math.trunc(Number(limitTotalRaw) || 0));
  const redeemedCount = Math.max(0, Math.trunc(Number(raw?.redeemed_count) || 0));
  const costVnd = Math.max(0, Math.trunc(Number(raw?.cost_vnd) || 0));
  return {
    id,
    name_vi: nameVi || `Quà ${i + 1}`,
    emoji: String(raw?.emoji || '').trim().slice(0, 8) || '🎁',
    image_key: raw?.image_key ? String(raw.image_key).trim().slice(0, 200) : null,
    image_url: raw?.image_url ? String(raw.image_url).trim().slice(0, 500) : null,
    price_diamonds: priceDiamonds,
    limit_total: limitTotal,
    redeemed_count: redeemedCount,
    cost_vnd: costVnd,
    active: raw?.active !== false,
  };
}

// Strips the founder's private budgeting field. cost_vnd must NEVER reach a
// kid-facing response.
export function publicGift(gift) {
  const { cost_vnd, ...rest } = gift || {};
  return rest;
}

export async function loadGiftStore(env) {
  const kv = giftKv(env);
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');
  const raw = await kv.get(GIFT_STORE_KEY, { type: 'json' });
  const gifts = raw && Array.isArray(raw.gifts) ? raw.gifts : DEFAULT_GIFTS;
  return {
    schema_version: 1,
    gifts: gifts.map(normalizeGift),
  };
}

export async function saveGiftStore(env, store) {
  const kv = giftKv(env);
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');
  const next = {
    schema_version: 1,
    gifts: (Array.isArray(store?.gifts) ? store.gifts : []).map(normalizeGift),
    updated_at: new Date().toISOString(),
  };
  await kv.put(GIFT_STORE_KEY, JSON.stringify(next));
  return next;
}
