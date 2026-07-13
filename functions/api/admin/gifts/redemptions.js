// The founder's real-world shopping list: who to buy what for, grouped by
// status, newest first. Includes cost_vnd (private budgeting field — this is
// an admin-only route, gated by Basic Auth) and a this-month spend rollup.
import { loadGiftStore } from '../_gifts.js';
import { loadProgressState } from '../../_read2lead-v2-state.js';

const GIFT_QUEUE_KEY = 'admin:gift-redemptions:v1';
const STATUSES = ['requested', 'preparing', 'delivered', 'rejected'];
// Statuses the founder still has to act on — these are the only rows worth
// spending a KV read to verify, and there are only ever a handful (a child
// may hold one pending request at a time).
const OPEN_STATUSES = new Set(['requested', 'preparing']);
// Real money is committed once the founder is out buying it (preparing) or
// has handed it over (delivered); requested/rejected have no spend yet.
const SPENT_STATUSES = new Set(['preparing', 'delivered']);

function vnMonthKey(ms) {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const kv = env.READ2LEAD_CODES;
    if (!kv) return json({ ok: false, error: 'config_error' }, 500);

    const raw = await kv.get(GIFT_QUEUE_KEY, { type: 'json' });
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    const giftStore = await loadGiftStore(env);
    const costByGiftId = new Map(giftStore.gifts.map((gift) => [gift.id, gift.cost_vnd || 0]));

    const now = Date.now();
    const currentMonthKey = vnMonthKey(now);

    const groups = { requested: [], preparing: [], delivered: [], rejected: [] };
    let totalCostVndThisMonth = 0;

    for (const entry of entries) {
      const tsMs = Date.parse(entry?.ts || '');
      const validTsMs = Number.isFinite(tsMs) ? tsMs : now;
      const daysWaiting = Math.max(0, Math.floor((now - validTsMs) / (24 * 60 * 60 * 1000)));
      const costVnd = costByGiftId.get(entry?.gift_id) ?? 0;

      if (SPENT_STATUSES.has(entry?.status) && vnMonthKey(validTsMs) === currentMonthKey) {
        totalCostVndThisMonth += costVnd;
      }

      const row = { ...entry, cost_vnd: costVnd, days_waiting: daysWaiting };

      // The queue index is written BEFORE the child's diamonds are debited
      // (read2lead-gifts-redeem.js), deliberately: a queue entry with no debit
      // costs nobody anything, whereas a debit with no queue entry would mean a
      // child paid for a gift the founder never learns to buy. The cost of that
      // choice is that a failure between the two writes leaves a phantom row.
      // Verify open rows against the child's own ledger — the source of truth —
      // so the founder is never sent out to buy a gift nobody actually paid for.
      if (OPEN_STATUSES.has(entry?.status)) {
        row.diamonds_taken = await isRedemptionInChildLedger(env, kv, entry);
      }

      if (groups[entry?.status]) groups[entry.status].push(row);
    }

    for (const status of STATUSES) {
      groups[status].sort((a, b) => (Date.parse(b.ts || 0) || 0) - (Date.parse(a.ts || 0) || 0));
    }

    return json({ ok: true, groups, total_cost_vnd_this_month: totalCostVndThisMonth });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}

/**
 * Did this redemption actually reach the child's ledger (i.e. were their
 * diamonds really taken)? Returns false for a phantom queue row, so the UI can
 * warn the founder rather than send him shopping for a gift nobody paid for.
 * Fails SAFE: on any lookup error we return true, because wrongly crying
 * "unpaid" over a real redemption would deny a child the gift they earned —
 * a far worse outcome than the founder eyeballing one suspect row.
 */
async function isRedemptionInChildLedger(env, kv, entry) {
  try {
    const codeData = await kv.get(entry.code, { type: 'json' });
    if (!codeData) return true;
    const state = await loadProgressState(env, entry.code, codeData);
    const ledger = Array.isArray(state?.redemptions) ? state.redemptions : [];
    return ledger.some((item) => item?.id === entry.redemption_id);
  } catch {
    return true;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
