// Trusted server receipts only. These records never grant a reward.
const KINDS = new Set(['original_complete', 'original_pages', 'story_questions', 'story_retell', 'story_recall']);
const COMPLETIONS = new Set(['original_complete', 'story_questions']);
const DAY = 86400000;
const VN_OFFSET = 7 * 3600000;

export function normalizeLearningReceipts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), records = [];
  for (const row of raw) {
    if (!row || !KINDS.has(row.kind) || typeof row.source !== 'string' || !row.source || row.source.length > 500) continue;
    if (!Number.isSafeInteger(row.diamonds) || row.diamonds < 0 || !Number.isFinite(Date.parse(row.at))) continue;
    const key = JSON.stringify([row.source, row.kind]);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ source: row.source, kind: row.kind, at: new Date(row.at).toISOString(), diamonds: row.diamonds });
  }
  return records;
}

export function recordLearningReceipt(raw, receipt) {
  const valid = normalizeLearningReceipts([receipt]);
  if (valid.length !== 1) throw Error('invalid_learning_receipt');
  return normalizeLearningReceipts([...(raw || []), valid[0]]);
}

/** Vietnam uses UTC+07 year-round. Monday start inclusive, next Monday exclusive. */
export function vietnamWeek(now = new Date()) {
  const ms = new Date(now).getTime();
  if (!Number.isFinite(ms)) throw Error('invalid_week_date');
  const local = new Date(ms + VN_OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const monday = midnight - ((local.getUTCDay() + 6) % 7) * DAY - VN_OFFSET;
  return { start: new Date(monday).toISOString(), end: new Date(monday + 7 * DAY).toISOString(), timezone: 'Asia/Ho_Chi_Minh' };
}

export function learningStarTotals(receipts, { now = new Date(), startsAt } = {}) {
  const week = vietnamWeek(now), release = Date.parse(startsAt);
  if (!Number.isFinite(release)) return { reading: 0, diamonds: 0 };
  const start = Math.max(Date.parse(week.start), release), end = Date.parse(week.end), sources = new Set();
  let diamonds = 0;
  for (const row of normalizeLearningReceipts(receipts)) {
    const at = Date.parse(row.at);
    if (at < start || at >= end || at > new Date(now).getTime()) continue;
    if (COMPLETIONS.has(row.kind)) sources.add(row.source);
    diamonds += row.diamonds;
    if (!Number.isSafeInteger(diamonds)) throw Error('learning_total_overflow');
  }
  return { reading: sources.size, diamonds };
}
