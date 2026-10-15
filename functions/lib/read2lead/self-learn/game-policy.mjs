/** Pure self-learning game policy. No legacy normalization, rollover, award or storage writes. */
import { MONSTER_MANIFEST, MONSTER_SLOTS, MONSTER_COLORS } from '../../../api/_monster-manifest.js';
import { buildRankLadderFromPoints, rankPointsFromHistory } from '../../../api/_read2lead-v2-state.js';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const uint = x => Number.isSafeInteger(x) && x >= 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const text = (x, max = 300) => typeof x === 'string' && x.length <= max;
const level = x => typeof x === 'string' && /^L[0-5]$/.test(x);
const iso = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
export class GamePolicyError extends Error { constructor(code) { super(code); this.code = code; } }
const requireThat = (ok, code) => { if (!ok) throw new GamePolicyError(code); };
const slots = [...MONSTER_SLOTS], colors = [...MONSTER_COLORS];
const optionalSlots = new Set(['detail', 'hat', 'pet', 'wings', 'effects', 'frame']);
// Take a private snapshot: consumers cannot mutate the validator through a catalogue response.
const parts = Object.fromEntries(slots.map(slot => [slot, MONSTER_MANIFEST[slot].map(p => ({ id: p.id, file: p.file, rarity: p.rarity || 'common', ...(p.color ? { color: p.color } : {}) }))]));
const ids = Object.fromEntries(slots.map(slot => [slot, new Set(parts[slot].map(p => p.id))]));
export function freeMonsterCatalogue() {
  return { policy: 'all-supported-free-v1', slots: [...slots], colors: [...colors], parts: Object.fromEntries(slots.map(slot => [slot,
    [...(optionalSlots.has(slot) ? [{ id: '', file: '', rarity: 'common' }] : []), ...parts[slot]].map(p => ({ ...p, free: true, price_diamonds: 0 }))])) };
}
export function defaultFreeMonster() {
  const defaults = { body: 'png-default-body-whitea', eyes: 'png-default-eye-blue', mouth: 'png-default-moutha', arms: 'png-default-arm-whitea' };
  return validateFreeMonster(Object.fromEntries([...slots.map(slot => [slot, optionalSlots.has(slot) ? '' : defaults[slot]]), ['color', 'mint']]));
}
export function validateFreeMonster(choice) {
  requireThat(exact(choice, [...slots, 'color']), 'invalid_monster_shape');
  for (const slot of slots) requireThat(typeof choice[slot] === 'string' && (ids[slot].has(choice[slot]) || choice[slot] === '' && optionalSlots.has(slot)), 'invalid_monster_part');
  requireThat(colors.includes(choice.color), 'invalid_monster_color');
  return structuredClone(choice);
}
/** Pure transition only; the transactional adapter must authenticate and check revision/replay. */
export function applyGameOperation(snapshot, operation) {
  requireThat(object(snapshot), 'invalid_game_snapshot');
  requireThat(object(operation), 'invalid_game_operation');
  if (['buy_monster', 'buy_cosmetic', 'equip_cosmetic_paid'].includes(operation.type)) throw new GamePolicyError('monster_purchase_retired');
  requireThat(operation.type === 'select_monster', 'game_operation_not_supported');
  requireThat(exact(operation, ['type', 'monster']), 'invalid_game_operation');
  return { ...structuredClone(snapshot), monster: validateFreeMonster(operation.monster) };
}
function numberOrUnknown(raw, key) {
  if (!Object.hasOwn(raw, key)) return null;
  requireThat(uint(raw[key]), 'invalid_legacy_progress'); return raw[key];
}
function projectedMedals(raw) {
  if (raw === undefined) return [];
  requireThat(Array.isArray(raw) && raw.length <= 1000, 'invalid_legacy_medals');
  return raw.map(m => {
    requireThat(object(m) && id(m.season_id), 'invalid_legacy_medals');
    const out = { season_id: m.season_id };
    for (const key of ['name_vi', 'emoji', 'peak_label_vi', 'kind']) if (Object.hasOwn(m, key)) { requireThat(text(m[key]), 'invalid_legacy_medals'); out[key] = m[key]; }
    for (const key of ['peak_tier_index', 'reward_diamonds', 'honors_rank']) if (Object.hasOwn(m, key)) { requireThat(uint(m[key]) && (key !== 'peak_tier_index' || m[key] <= 7) && (key !== 'honors_rank' || m[key] > 0), 'invalid_legacy_medals'); out[key] = m[key]; }
    if (Object.hasOwn(m, 'ts')) { requireThat(m.ts === null || iso(m.ts), 'invalid_legacy_medals'); out.ts = m.ts; }
    return out;
  });
}
function historyPoints(raw) {
  const hasHistory = Object.hasOwn(raw, 'pack_history'), hasIds = Object.hasOwn(raw, 'completed_pack_ids'), hasCount = Object.hasOwn(raw, 'completed_packs');
  if (!hasHistory && !hasIds && !hasCount) return null;
  if (hasHistory) {
    requireThat(Array.isArray(raw.pack_history) && raw.pack_history.length <= 10000, 'invalid_legacy_progress');
    for (const row of raw.pack_history) {
      requireThat(object(row) && (!Object.hasOwn(row, 'passed') || typeof row.passed === 'boolean'), 'invalid_legacy_progress');
      if (row.score_percent !== undefined && row.score_percent !== null) requireThat(typeof row.score_percent === 'number' && Number.isFinite(row.score_percent) && row.score_percent >= 0 && row.score_percent <= 100, 'invalid_legacy_progress');
    }
  }
  if (hasIds) requireThat(Array.isArray(raw.completed_pack_ids) && raw.completed_pack_ids.length <= 10000 && raw.completed_pack_ids.every(id) && new Set(raw.completed_pack_ids).size === raw.completed_pack_ids.length, 'invalid_legacy_progress');
  if (hasCount) requireThat(uint(raw.completed_packs), 'invalid_legacy_progress');
  const points = rankPointsFromHistory(raw); requireThat(uint(points), 'invalid_legacy_progress'); return points;
}
/** Allowlisted view only: the original import must be stored unchanged outside this projection. */
export function legacyGameView(raw, { declaredLevel = 'L0' } = {}) {
  requireThat(level(declaredLevel), 'invalid_declared_level');
  if (raw === null) return { origin: 'new_local', current_level: declaredLevel, lifetime_xp: 0, xp_in_level: 0, lifetime_rank_points: 0, legacy_rank_points: 0,
    rank_ladder: buildRankLadderFromPoints(0, { currentLevel: declaredLevel }), legacy_season: null, medals: [], mastery_validated: false, xp_spendable: false };
  requireThat(object(raw) && level(raw.current_level), 'invalid_legacy_progress');
  const xp = numberOrUnknown(raw, 'total_xp'), levelXp = numberOrUnknown(raw, 'xp_in_level'), rank = numberOrUnknown(raw, 'rank_points'), lifetime = numberOrUnknown(raw, 'lifetime_rp');
  let season = null;
  if (Object.hasOwn(raw, 'season') && raw.season !== null) {
    requireThat(object(raw.season) && id(raw.season.id) && uint(raw.season.rp), 'invalid_legacy_season');
    season = { id: raw.season.id, rp: raw.season.rp };
    if (Object.hasOwn(raw.season, 'peak_tier_index')) { requireThat(uint(raw.season.peak_tier_index) && raw.season.peak_tier_index <= 7, 'invalid_legacy_season'); season.peak_tier_index = raw.season.peak_tier_index; }
    if (Object.hasOwn(raw.season, 'peak_label_vi')) { requireThat(text(raw.season.peak_label_vi), 'invalid_legacy_season'); season.peak_label_vi = raw.season.peak_label_vi; }
  }
  const fallback = rank === null ? historyPoints(raw) : rank;
  const points = season?.rp ?? fallback;
  return { origin: 'legacy_snapshot', current_level: raw.current_level, lifetime_xp: xp, xp_in_level: levelXp, lifetime_rank_points: lifetime ?? fallback, legacy_rank_points: rank,
    rank_ladder: points === null ? null : buildRankLadderFromPoints(points, { currentLevel: raw.current_level }), legacy_season: season, medals: projectedMedals(raw.medals), mastery_validated: false, xp_spendable: false };
}
/** Explicit half-open UTC intervals; no extrapolation, inferred duration, resets or rewards. */
export function activeGameTheme(catalogue, nowIso, interestIds) {
  requireThat(iso(nowIso), 'invalid_theme_time');
  requireThat(Array.isArray(interestIds) && interestIds.length > 0 && interestIds.length <= 100 && interestIds.every(id) && new Set(interestIds).size === interestIds.length, 'invalid_theme_interests');
  requireThat(Array.isArray(catalogue) && catalogue.length <= 100, 'invalid_theme_catalogue');
  const seen = new Set();
  const themes = catalogue.map(t => {
    requireThat(exact(t, ['id', 'name_vi', 'starts_at', 'ends_at', 'interest_ids']) && id(t.id) && text(t.name_vi, 120) && t.name_vi.trim() && iso(t.starts_at) && iso(t.ends_at) && t.starts_at < t.ends_at && Array.isArray(t.interest_ids) && t.interest_ids.length > 0 && t.interest_ids.length <= 10 && t.interest_ids.every(id) && new Set(t.interest_ids).size === t.interest_ids.length && !seen.has(t.id), 'invalid_theme_catalogue');
    requireThat(t.interest_ids.every(value => interestIds.includes(value)), 'unknown_theme_interest');
    seen.add(t.id); return structuredClone(t);
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (let i = 1; i < themes.length; i++) requireThat(themes[i - 1].ends_at <= themes[i].starts_at, 'overlapping_themes');
  return themes.find(t => t.starts_at <= nowIso && nowIso < t.ends_at) || null;
}
