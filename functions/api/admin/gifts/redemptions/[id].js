// Founder marks a redemption preparing/delivered/rejected. Enforces the
// lifecycle transition rules in _gifts-v2.js; rejected refunds the child's
// diamonds in their progress state AND decrements the gift's redeemed_count
// (the budget cap this redemption had consumed). Keeps the KV queue index
// and the child's state.redemptions[] ledger in sync.
//
// state.redemptions[] (the ledger) is the source of truth; this KV queue
// index is a derived view that can go stale in two ways since KV has no
// transactions: (a) a crash between the ledger write and the writes that
// follow it (gift store + queue index) leaves the queue pointing at a
// terminal status the ledger never actually reached, and a retried PATCH
// used to 400 forever on that; (b) the redeem race in
// read2lead-gifts-redeem.js can leave a queue entry whose redemption id
// never made it into any child's ledger at all (a "ghost"). Both are
// reconciled below instead of erroring — see onRequestPatch.
//
// Fix (Buffet MEDIUM): the redeemed_count restore on rejection used to be
// inferred from whether the queue-index write (step C below) had landed —
// but that write is unrelated to whether the restore itself (step B) ever
// ran, so a crash between B and C made a retry double-decrement. The
// redemption ledger entry now carries its own `cap_restored` flag, stamped
// in the SAME write that performs the restore (restoreCap below), so a
// retry can tell "already restored" from "not yet restored" without any
// reference to the queue index. `cap_restored` must stay allow-listed in
// normalizeRedemptions() (_read2lead-v2-state.js) or it is silently
// stripped on the next load and this fix goes dark.
import { loadProgressState, saveProgressState } from '../../../_read2lead-v2-state.js';
import { loadGiftStore, saveGiftStore } from '../../_gifts.js';
import { applyRedemptionStatus } from '../../../_gifts-v2.js';

const GIFT_QUEUE_KEY = 'admin:gift-redemptions:v1';
const ALLOWED_STATUSES = new Set(['preparing', 'delivered', 'rejected']);

// Restores one unit of the gift's budget cap (redeemed_count - 1) and, once
// that decrement has actually landed, stamps cap_restored: true onto the
// matching ledger entry in the SAME saveProgressState call — never before,
// since claiming the restore is done before the decrement has run would let
// a crash right after this call permanently skip a decrement that never
// happened. Returns the state with the stamp applied.
// KV has no cross-key transactions, so these two writes can never be atomic and
// a crash between them is always possible. What we CAN choose is which way that
// crash falls. Stamp the ledger FIRST, decrement the cap SECOND:
//
//   crash after the stamp  -> a retry sees cap_restored and skips the decrement,
//                             so the slot stays counted as used. Fail-CLOSED:
//                             the founder sees "đã dùng 2/2" in the admin table
//                             and raises the limit himself. Costs him nothing.
//
//   (the other order would fail-OPEN: the retry would decrement a second time,
//    silently under-counting the cap and committing him to buy MORE expensive
//    gifts than he budgeted for — a bug that spends his real money.)
//
// Diamonds are untouched here; the refund is applied once, upstream, and is
// already idempotent via LEGAL_TRANSITIONS.
async function restoreCap(env, code, state, giftId, redemptionId) {
  const nextRedemptions = state.redemptions.map((item) =>
    (item.id === redemptionId ? { ...item, cap_restored: true } : item));
  const stamped = { ...state, redemptions: nextRedemptions };
  await saveProgressState(env, code, stamped);

  const giftStore = await loadGiftStore(env);
  const nextGifts = giftStore.gifts.map((item) =>
    (item.id === giftId
      ? { ...item, redeemed_count: Math.max(0, (item.redeemed_count || 0) - 1) }
      : item));
  await saveGiftStore(env, { ...giftStore, gifts: nextGifts });

  return stamped;
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const redemptionId = String(params.id || '').trim();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const nextStatus = String(body.status || '').trim();
  if (!ALLOWED_STATUSES.has(nextStatus)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  const kv = env.READ2LEAD_CODES;
  if (!kv) return json({ ok: false, error: 'config_error' }, 500);

  const raw = await kv.get(GIFT_QUEUE_KEY, { type: 'json' });
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const entryIndex = entries.findIndex((item) => item?.redemption_id === redemptionId);
  if (entryIndex === -1) {
    return json({ ok: false, error: 'redemption_not_found' }, 404);
  }
  const entry = entries[entryIndex];

  const codeData = await kv.get(entry.code, { type: 'json' });
  if (!codeData) {
    return json({ ok: false, error: 'code_not_found' }, 404);
  }

  const state = await loadProgressState(env, entry.code, codeData);
  const redemptions = Array.isArray(state.redemptions) ? state.redemptions : [];
  const ledgerEntry = redemptions.find((item) => item?.id === redemptionId);

  // Fix (Buffet MEDIUM, self-heal): ledger entry genuinely missing — a
  // ghost queue row from the redeem race (read2lead-gifts-redeem.js), never
  // backed by any actual diamond debit in the persisted truth. Do not 400
  // forever: mark it so the founder can see it's a ghost and clear it. No
  // diamonds or redeemed_count move — nothing was ever really taken.
  if (!ledgerEntry) {
    const nextEntries = [...entries];
    nextEntries[entryIndex] = { ...entry, status: 'rejected', ledger_missing: true };
    await kv.put(GIFT_QUEUE_KEY, JSON.stringify({ entries: nextEntries, updated_at: new Date().toISOString() }));
    return json({ ok: true, ghost: true, redemption: null });
  }

  if (ledgerEntry.status === nextStatus) {
    // The ledger already reflects the requested status. Either this PATCH
    // is a retry after a crash that landed the ledger write but died before
    // the gift-store/queue writes that follow it, or it's a retry of a call
    // that already fully completed. Converge instead of 400ing — this also
    // makes any 3rd, 4th, ... retry safe.
    if (entry.status === nextStatus) {
      // Queue index already caught up too — fully converged, nothing left.
      return json({ ok: true, redemption: ledgerEntry });
    }
    // Finish the job: run the writes the earlier crash never reached. The
    // redeemed_count restore is gated on cap_restored, not merely on
    // nextStatus === 'rejected' — a retry after a crash between the restore
    // (restoreCap, below) and the queue write just below must NOT decrement
    // a second time, and cap_restored is the only record of whether that
    // restore already landed (see the top-of-file note).
    let convergedLedgerEntry = ledgerEntry;
    if (nextStatus === 'rejected' && !ledgerEntry.cap_restored) {
      const stamped = await restoreCap(env, entry.code, state, entry.gift_id, redemptionId);
      convergedLedgerEntry = stamped.redemptions.find((item) => item.id === redemptionId);
    }
    const nextEntries = [...entries];
    nextEntries[entryIndex] = { ...entry, status: nextStatus };
    await kv.put(GIFT_QUEUE_KEY, JSON.stringify({ entries: nextEntries, updated_at: new Date().toISOString() }));
    return json({ ok: true, redemption: convergedLedgerEntry });
  }

  // Fresh transition. LEGAL_TRANSITIONS in _gifts-v2.js is untouched, so a
  // genuinely illegal transition (e.g. delivered -> rejected) is still
  // refused here and moves no diamonds.
  const result = applyRedemptionStatus(state, redemptionId, nextStatus);
  if (result.error) {
    return json({ ok: false, error: result.error }, 400);
  }

  await saveProgressState(env, entry.code, result.state);

  let finalState = result.state;
  if (nextStatus === 'rejected') {
    // The decrement always runs after the status/diamonds write above has
    // already landed — see restoreCap's own comment for why cap_restored
    // must never be stamped before the decrement it describes has happened.
    finalState = await restoreCap(env, entry.code, result.state, entry.gift_id, redemptionId);
  }

  const nextEntries = [...entries];
  nextEntries[entryIndex] = { ...entry, status: nextStatus };
  await kv.put(GIFT_QUEUE_KEY, JSON.stringify({ entries: nextEntries, updated_at: new Date().toISOString() }));

  return json({ ok: true, redemption: finalState.redemptions.find((item) => item.id === redemptionId) });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
