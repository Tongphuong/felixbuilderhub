import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyQuestProgress,
  awardPendingChest,
  claimDailyLoginChest,
  claimQuestReward,
  consumePendingChest,
  getDailyQuestsView,
  normalizeProgressState,
  previewDailyLoginChest,
  recordComboBonus,
} from '../functions/api/_read2lead-v2-state.js';
import { QUEST_IDS } from '../functions/api/_read2lead-quests.js';

const DATE_KEY = '2026-06-13';
const NOW_ISO = '2026-06-13T02:00:00.000Z';
const CODE = 'R2L-W2-STATE';

function baseState(raw = null) {
  return normalizeProgressState(raw, {
    accessCode: CODE,
    nowIso: NOW_ISO,
  });
}

function withQuests(ids, progress = {}, claimed = {}) {
  const state = baseState();
  return {
    ...state,
    daily_quests: {
      date: DATE_KEY,
      ids,
      progress: Object.fromEntries(ids.map((id) => [id, progress[id] || 0])),
      claimed: Object.fromEntries(ids.map((id) => [id, Boolean(claimed[id])])),
    },
  };
}

test('normalizeProgressState fills W2 defaults for pre-V3 record without crash', () => {
  const state = baseState({ completed_packs: 2, coins: 7 });
  assert.equal(state.coins, 7);
  assert.equal(state.daily_quests.ids.length, 3);
  assert.equal(state.pending_chest, null);
  assert.deepEqual(state.chest_history, []);
  assert.deepEqual(state.daily_login_chest, { last_claim_date: null });
  assert.equal(state.combo_lifetime_xu, 0);
  assert.deepEqual(state.unlocked_parts, []);
});

test('normalizeProgressState fills W2 defaults for V3-only record without crash', () => {
  const state = baseState({
    schema_version: 2,
    level_reset_version: 20260606,
    current_level: 'L2',
    initial_level: 'L1',
    inventory: ['hat_star'],
    equipped: { hat: 'hat_star' },
  });
  assert.equal(state.current_level, 'L2');
  // R2L-REWARDS-REDESIGN: the old coin-priced inventory shop is retired —
  // getShopItem() always returns null now, so a legacy 'hat_star' id no
  // longer resolves and is filtered out of inventory.
  assert.deepEqual(state.inventory, []);
  assert.equal(state.daily_quests.date, DATE_KEY);
});

test('normalizeProgressState fills W2 defaults for V3+season record without crash', () => {
  const state = baseState({
    schema_version: 2,
    level_reset_version: 20260606,
    season: { id: '2026-S0', rp: 8, peak_tier_index: 0 },
    lifetime_rp: 8,
    rank_points: 8,
  });
  assert.equal(state.lifetime_rp, 8);
  assert.equal(state.season.rp, 8);
  assert.equal(state.pending_chest, null);
});

test('normalizeProgressState rebuilds daily_quests if date changed', () => {
  const state = baseState({
    daily_quests: {
      date: '2026-06-12',
      ids: ['q1', 'q2', 'q3'],
      progress: { q1: 1, q2: 1, q3: 1 },
      claimed: { q1: true, q2: true, q3: true },
    },
  });
  assert.equal(state.daily_quests.date, DATE_KEY);
  assert.deepEqual(Object.values(state.daily_quests.progress), [0, 0, 0]);
});

test('normalizeProgressState validates daily_quests ids against QUEST_IDS', () => {
  const state = baseState({
    daily_quests: {
      date: DATE_KEY,
      ids: ['q1', 'bad-id', 'q1'],
      progress: {},
      claimed: {},
    },
  });
  assert.equal(state.daily_quests.ids.length, 3);
  assert.equal(new Set(state.daily_quests.ids).size, 3);
  assert.ok(state.daily_quests.ids.every((id) => QUEST_IDS.includes(id)));
});

test('normalizeProgressState trims and sanitizes W2 persisted fields', () => {
  const history = Array.from({ length: 55 }, (_, index) => ({
    opened_at: `2026-06-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    rarity: index === 0 ? 'invalid' : 'common',
    reward: { diamonds: index, part_id: null },
    duplicate: false,
  }));
  const state = baseState({
    chest_history: history,
    combo_lifetime_xu: '9',
    unlocked_parts: ['part-a', '', 'part-a', 'part-b'],
  });
  assert.equal(state.chest_history.length, 50);
  assert.equal(state.combo_lifetime_xu, 9);
  assert.deepEqual(state.unlocked_parts, ['part-a', 'part-b']);
});

test('getDailyQuestsView returns 3 quests with target progress claimed and complete', () => {
  const state = withQuests(['q1', 'q2', 'q6'], { q1: 1, q2: 0, q6: 2 }, { q2: true });
  const view = getDailyQuestsView(state, DATE_KEY, CODE);
  assert.equal(view.quests.length, 3);
  assert.deepEqual(
    view.quests.map(({ id, progress, claimed, complete }) => ({ id, progress, claimed, complete })),
    [
      { id: 'q1', progress: 1, claimed: false, complete: true },
      { id: 'q2', progress: 0, claimed: true, complete: false },
      { id: 'q6', progress: 2, claimed: false, complete: true },
    ],
  );
  assert.ok(view.quests.every((quest) => quest.target > 0 && quest.reward_diamonds > 0));
});

test('getDailyQuestsView includes pending chest preview text', () => {
  const state = {
    ...withQuests(['q1', 'q2', 'q3']),
    pending_chest: {
      rarity: 'common',
      reward: { diamonds: 12, part_id: null },
      duplicate: false,
      awarded_at: NOW_ISO,
    },
  };
  const view = getDailyQuestsView(state, DATE_KEY, CODE);
  assert.equal(view.pending_chest.rarity, 'common');
  assert.ok(view.pending_chest.preview_text.length > 0);
});

test('applyQuestProgress increments q1 on pack_passed if active', () => {
  const state = withQuests(['q1', 'q2', 'q3']);
  const next = applyQuestProgress(state, 'pack_passed', {}, DATE_KEY, CODE);
  assert.equal(next.daily_quests.progress.q1, 1);
});

test('applyQuestProgress increments q6 on second pack_passed', () => {
  const state = withQuests(['q6', 'q2', 'q3'], { q6: 1 });
  const next = applyQuestProgress(state, 'pack_passed', {}, DATE_KEY, CODE);
  assert.equal(next.daily_quests.progress.q6, 2);
});

test('applyQuestProgress leaves inactive quests unchanged', () => {
  const state = withQuests(['q2', 'q3', 'q5']);
  const next = applyQuestProgress(state, 'pack_passed', {}, DATE_KEY, CODE);
  assert.deepEqual(next.daily_quests.progress, state.daily_quests.progress);
});

test('applyQuestProgress clamps at target', () => {
  const state = withQuests(['q1', 'q6', 'q3'], { q1: 1, q6: 2 });
  const next = applyQuestProgress(state, 'pack_passed', {}, DATE_KEY, CODE);
  assert.equal(next.daily_quests.progress.q1, 1);
  assert.equal(next.daily_quests.progress.q6, 2);
});

test('claimQuestReward adds diamonds and claimed flag', () => {
  const state = withQuests(['q1', 'q3', 'q5'], { q1: 1 });
  const result = claimQuestReward(state, 'q1', DATE_KEY, CODE);
  assert.equal(result.state.diamonds, state.diamonds + 5);
  assert.equal(result.state.daily_quests.claimed.q1, true);
  assert.deepEqual(result.reward, { diamonds: 5, rp: 0 });
});

test('claimQuestReward rejects already_claimed', () => {
  const state = withQuests(['q1', 'q3', 'q5'], { q1: 1 }, { q1: true });
  assert.equal(claimQuestReward(state, 'q1', DATE_KEY, CODE).error, 'already_claimed');
});

test('claimQuestReward rejects not_complete', () => {
  const state = withQuests(['q1', 'q3', 'q5']);
  assert.equal(claimQuestReward(state, 'q1', DATE_KEY, CODE).error, 'not_complete');
});

test('claimQuestReward rejects quest not active today', () => {
  const state = withQuests(['q1', 'q3', 'q5']);
  assert.equal(claimQuestReward(state, 'q2', DATE_KEY, CODE).error, 'quest_not_active_today');
});

test('claimQuestReward applies RP bonus when reward has RP', () => {
  const state = withQuests(['q2', 'q3', 'q5'], { q2: 1 });
  const beforeLifetime = state.lifetime_rp;
  const beforeSeason = state.season.rp;
  const result = claimQuestReward(state, 'q2', DATE_KEY, CODE);
  assert.equal(result.state.lifetime_rp, beforeLifetime + 1);
  assert.equal(result.state.rank_points, beforeLifetime + 1);
  assert.equal(result.state.season.rp, beforeSeason + 1);
});

test('awardPendingChest sets pending_chest with deterministic Z3 reward', () => {
  const state = baseState();
  const next = awardPendingChest(state, { passed: true, score: 90 }, () => 0.5);
  assert.equal(next.pending_chest.rarity, 'common');
  // common diamonds_min=5, diamonds_max=10: 5 + floor(0.5*(10-5+1)) = 8
  assert.equal(next.pending_chest.reward.diamonds, 8);
  assert.equal(next.pending_chest.duplicate, false);
});

test('awardPendingChest does not overwrite an existing pending chest', () => {
  const state = {
    ...baseState(),
    pending_chest: {
      rarity: 'epic',
      reward: { diamonds: 25, part_id: null },
      duplicate: false,
      awarded_at: NOW_ISO,
    },
  };
  assert.equal(awardPendingChest(state, { passed: true }, () => 0.5), state);
});

test('awardPendingChest no-ops when pack did not pass', () => {
  const state = baseState();
  assert.equal(awardPendingChest(state, { passed: false }, () => 0.5), state);
});

test('consumePendingChest adds diamonds and part to unlocked_parts', () => {
  const state = {
    ...withQuests(['q1', 'q3', 'q5']),
    pending_chest: {
      rarity: 'rare',
      reward: { diamonds: 15, part_id: 'part-rare' },
      duplicate: false,
      awarded_at: NOW_ISO,
    },
  };
  const result = consumePendingChest(state, DATE_KEY, CODE);
  assert.equal(result.state.diamonds, state.diamonds + 15);
  assert.deepEqual(result.state.unlocked_parts, ['part-rare']);
  assert.equal(result.state.pending_chest, null);
});

test('consumePendingChest duplicate path adds diamonds only', () => {
  const state = {
    ...withQuests(['q1', 'q3', 'q5']),
    unlocked_parts: ['part-owned'],
    pending_chest: {
      rarity: 'rare',
      reward: { diamonds: 30, part_id: null },
      duplicate: true,
      awarded_at: NOW_ISO,
    },
  };
  const result = consumePendingChest(state, DATE_KEY, CODE);
  assert.deepEqual(result.state.unlocked_parts, ['part-owned']);
  assert.equal(result.reward.part_id, null);
  assert.equal(result.reward.duplicate, true);
});

test('consumePendingChest triggers chest_opened quest event', () => {
  const state = {
    ...withQuests(['q1', 'q3', 'q5']),
    pending_chest: {
      rarity: 'common',
      reward: { diamonds: 5, part_id: null },
      duplicate: false,
      awarded_at: NOW_ISO,
    },
  };
  const result = consumePendingChest(state, DATE_KEY, CODE);
  assert.equal(result.state.daily_quests.progress.q5, 1);
});

test('consumePendingChest trims chest_history at 50', () => {
  const chestHistory = Array.from({ length: 50 }, (_, index) => ({
    opened_at: `old-${index}`,
    rarity: 'common',
    reward: { diamonds: 5, part_id: null },
    duplicate: false,
  }));
  const state = {
    ...withQuests(['q1', 'q3', 'q5']),
    chest_history: chestHistory,
    pending_chest: {
      rarity: 'common',
      reward: { diamonds: 5, part_id: null },
      duplicate: false,
      awarded_at: NOW_ISO,
    },
  };
  const result = consumePendingChest(state, DATE_KEY, CODE);
  assert.equal(result.state.chest_history.length, 50);
  assert.equal(result.state.chest_history[0].opened_at, 'old-1');
});

// R2L-REWARDS-REDESIGN: base 5 coins -> 3💎, per_streak 2 coins -> 1💎;
// MAX_STREAK stays 10 days (Elon/Phương ruling 2026-07-18 — a day count,
// not a currency amount, only the coin->diamond amounts convert).
test('claimDailyLoginChest formula uses 3 + 1 times streak', () => {
  const state = { ...baseState(), streak_days: 4 };
  const result = claimDailyLoginChest(state, DATE_KEY);
  assert.equal(result.reward.diamonds, 7);
  assert.equal(result.state.diamonds, state.diamonds + 7);
});

test('claimDailyLoginChest is idempotent on the same day', () => {
  const state = {
    ...baseState(),
    daily_login_chest: { last_claim_date: DATE_KEY },
  };
  assert.equal(claimDailyLoginChest(state, DATE_KEY).error, 'already_claimed_today');
});

test('claimDailyLoginChest at streak zero returns 3 diamonds', () => {
  assert.equal(claimDailyLoginChest({ ...baseState(), streak_days: 0 }, DATE_KEY).reward.diamonds, 3);
});

test('claimDailyLoginChest caps streak 15 reward at 13 diamonds (10-day cap unchanged)', () => {
  const result = claimDailyLoginChest({ ...baseState(), streak_days: 15 }, DATE_KEY);
  assert.equal(result.reward.diamonds, 13);
  assert.equal(result.reward.formula.streak_used, 10);
});

test('previewDailyLoginChest returns availability and next claim date', () => {
  const available = previewDailyLoginChest({ ...baseState(), streak_days: 3 }, DATE_KEY);
  assert.deepEqual(available, { available: true, diamonds: 6, next_claim_date: null });
  const claimed = previewDailyLoginChest({
    ...baseState(),
    streak_days: 3,
    daily_login_chest: { last_claim_date: DATE_KEY },
  }, DATE_KEY);
  assert.deepEqual(claimed, { available: false, diamonds: 6, next_claim_date: '2026-06-14' });
});

test('recordComboBonus caps each pack at three diamonds', () => {
  const state = baseState();
  const next = recordComboBonus(state, 10);
  assert.equal(next.diamonds, state.diamonds + 3);
});

test('recordComboBonus increments combo_lifetime_xu', () => {
  const state = { ...baseState(), combo_lifetime_xu: 7 };
  const next = recordComboBonus(state, 3);
  assert.equal(next.combo_lifetime_xu, 10);
});
