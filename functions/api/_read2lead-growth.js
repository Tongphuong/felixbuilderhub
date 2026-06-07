import { vietnamDateKey } from './_read2lead-v2-state.js';
import { listCompletedStories } from './_read2lead-library.js';

export const GROWTH_WEEKS_SHOWN = 6;

const VN_MONTHS = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** Monday-based week id (YYYY-MM-DD) in Vietnam calendar days. */
export function vietnamWeekKey(iso = new Date().toISOString()) {
  const dateKey = vietnamDateKey(iso);
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const dow = new Date(utc).getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return new Date(utc + mondayOffset * 86400000).toISOString().slice(0, 10);
}

function shiftWeekKey(weekKey, deltaWeeks) {
  const parsed = Date.parse(`${weekKey}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed + deltaWeeks * 7 * 86400000).toISOString().slice(0, 10);
}

function formatWeekLabel(weekKey, indexFromCurrent) {
  if (indexFromCurrent === 0) return 'Tuần này';
  if (indexFromCurrent === 1) return 'Tuần trước';
  const [, month, day] = weekKey.split('-');
  return `${Number(day)}/${VN_MONTHS[Number(month)] || month}`;
}

function childDisplayName(studentName = '') {
  const trimmed = String(studentName || '').trim();
  if (!trimmed) return 'Con';
  return trimmed.split(/\s+/)[0];
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildWeekBuckets(nowIso, weeksShown) {
  const currentKey = vietnamWeekKey(nowIso);
  const keys = [];
  for (let offset = weeksShown - 1; offset >= 0; offset -= 1) {
    keys.push(shiftWeekKey(currentKey, -offset));
  }
  return keys.map((key, index) => ({
    week_key: key,
    label_vi: formatWeekLabel(key, keys.length - 1 - index),
    is_current: key === currentKey,
    packs: 0,
    xp: 0,
  }));
}

/** Parent-friendly weekly growth section for the student profile. */
export function buildWeeklyGrowthForProfile({
  packHistory = [],
  reviewHistory = [],
  studentName = '',
  nowIso = new Date().toISOString(),
  weeksShown = GROWTH_WEEKS_SHOWN,
} = {}) {
  const buckets = buildWeekBuckets(nowIso, weeksShown);
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.week_key, bucket]));
  const seenPackIds = new Set();

  for (const entry of Array.isArray(packHistory) ? packHistory : []) {
    const packId = String(entry?.pack_id || '').trim();
    if (!packId || seenPackIds.has(packId)) continue;
    const completedAt = entry?.completed_at;
    const weekKey = vietnamWeekKey(completedAt);
    const bucket = bucketByKey.get(weekKey);
    if (!bucket) continue;
    seenPackIds.add(packId);
    bucket.packs += 1;
    bucket.xp += numberOrZero(entry?.xp);
  }

  for (const story of listCompletedStories(reviewHistory)) {
    if (!story.pack_id || seenPackIds.has(story.pack_id)) continue;
    const weekKey = vietnamWeekKey(story.completed_at);
    const bucket = bucketByKey.get(weekKey);
    if (!bucket) continue;
    seenPackIds.add(story.pack_id);
    bucket.packs += 1;
    bucket.xp += 20;
  }

  const maxPacks = Math.max(1, ...buckets.map((bucket) => bucket.packs));
  const totalPacks = buckets.reduce((sum, bucket) => sum + bucket.packs, 0);
  const thisWeek = buckets.find((bucket) => bucket.is_current) || buckets[buckets.length - 1];
  const childName = childDisplayName(studentName);

  const headline =
    thisWeek.packs > 0
      ? `Tuần này ${childName} đã học ${thisWeek.packs} truyện`
      : totalPacks > 0
        ? `${childName} chưa học tuần này — xem các tuần trước bên dưới`
        : 'Biểu đồ sẽ hiện khi con hoàn thành bài đầu tiên';

  return {
    headline,
    empty_hint: 'Mỗi cột là một tuần (theo giờ Việt Nam). Cao hơn = con học nhiều truyện hơn.',
    weeks_shown: weeksShown,
    total_packs: totalPacks,
    this_week_packs: thisWeek.packs,
    this_week_xp: thisWeek.xp,
    weeks: buckets.map((bucket) => ({
      week_key: bucket.week_key,
      label_vi: bucket.label_vi,
      is_current: bucket.is_current,
      packs: bucket.packs,
      xp: bucket.xp,
      bar_percent: bucket.packs ? Math.max(12, Math.round((bucket.packs / maxPacks) * 100)) : 0,
      bar_label: bucket.packs ? `${bucket.packs} truyện` : '0',
    })),
  };
}
