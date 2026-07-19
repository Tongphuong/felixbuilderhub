import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyPackCompletion,
  applyQuestProgress,
  awardPendingChest,
  normalizeProgressState,
  recordComboBonus,
  vietnamDateKey,
} from '../functions/api/_read2lead-v2-state.js';

const CODE = 'R2L-W2-SUBMIT';
const COMPLETED_AT = '2026-06-13T03:00:00.000Z';
const DATE_KEY = vietnamDateKey(COMPLETED_AT);

function stateWithQuests(ids, progress = {}) {
  const state = normalizeProgressState(null, {
    accessCode: CODE,
    nowIso: COMPLETED_AT,
  });
  return {
    ...state,
    daily_quests: {
      date: DATE_KEY,
      ids,
      progress: Object.fromEntries(ids.map((id) => [id, progress[id] || 0])),
      claimed: Object.fromEntries(ids.map((id) => [id, false])),
    },
  };
}

function completePackWithW2(
  state,
  {
    packId = 'pack-1',
    passed = true,
    scorePercent = 90,
    activityResults = [],
    comboXu = 0,
    rng = () => 0.5,
  } = {},
) {
  if (!passed) return state;
  const completion = applyPackCompletion(state, {
    packId,
    completedAt: COMPLETED_AT,
    rewardsEarned: { diamonds: 15, xp: 20 },
    activityResults,
    scorePercent,
  });
  if (completion.already_counted) return completion.state;

  const hasSpeakActivity = activityResults.some(
    (result) => result.type === 'listen_and_speak' || result.type === 'retell_summary',
  );
  let next = applyQuestProgress(
    completion.state,
    'pack_passed',
    { score: scorePercent, has_speak: hasSpeakActivity },
    DATE_KEY,
    CODE,
  );
  if (scorePercent >= 80) {
    next = applyQuestProgress(next, 'pack_passed_high_score', { score: scorePercent }, DATE_KEY, CODE);
  }
  if (hasSpeakActivity) {
    next = applyQuestProgress(next, 'speak_completed', {}, DATE_KEY, CODE);
  }
  const perfect = activityResults.find((result) => (
    result.percent === 100
    || result.score === 1
    || (result.total_count > 0
      && result.correct_count === result.total_count
      && Number(result.wrong_count || 0) === 0)
  ));
  if (perfect) {
    next = applyQuestProgress(next, 'activity_perfect', { activity_key: perfect.type }, DATE_KEY, CODE);
  }
  if (comboXu > 0) next = recordComboBonus(next, comboXu);
  return awardPendingChest(next, { passed: true, score: scorePercent }, rng);
}

test('submit source wires all W2 helpers into passed completion flow', () => {
  const source = readFileSync('functions/api/submit-read2lead-lesson.js', 'utf8');
  assert.match(source, /applyQuestProgress/);
  assert.match(source, /recordComboBonus/);
  assert.match(source, /awardPendingChest/);
  assert.match(source, /typeof env\.RNG === 'function'/);
});

test('submit pack_passed at 90 percent awards chest and q1 plus q2 progress', () => {
  const state = stateWithQuests(['q1', 'q2', 'q6']);
  const next = completePackWithW2(state);
  assert.equal(next.daily_quests.progress.q1, 1);
  assert.equal(next.daily_quests.progress.q2, 1);
  assert.ok(next.pending_chest);
});

test('submit pack_passed at 60 percent awards chest and q1 only', () => {
  const state = stateWithQuests(['q1', 'q2', 'q6']);
  const next = completePackWithW2(state, { scorePercent: 60 });
  assert.equal(next.daily_quests.progress.q1, 1);
  assert.equal(next.daily_quests.progress.q2, 0);
  assert.ok(next.pending_chest);
});

test('submit failed pack does not award chest', () => {
  const state = stateWithQuests(['q1', 'q2', 'q6']);
  const next = completePackWithW2(state, { passed: false });
  assert.equal(next.pending_chest, null);
  assert.equal(next.daily_quests.progress.q1, 0);
});

test('submit second passed pack today increments q6 to two', () => {
  let state = stateWithQuests(['q1', 'q2', 'q6']);
  state = completePackWithW2(state, { packId: 'pack-1' });
  state = { ...state, pending_chest: null };
  state = completePackWithW2(state, { packId: 'pack-2' });
  assert.equal(state.daily_quests.progress.q6, 2);
});

test('submit speak activity completed increments q3', () => {
  const state = stateWithQuests(['q1', 'q3', 'q6']);
  const next = completePackWithW2(state, {
    activityResults: [
      { type: 'listen_and_speak', attempted: true, correct_count: 1, total_count: 1 },
    ],
  });
  assert.equal(next.daily_quests.progress.q3, 1);
});

test('submit perfect activity increments q7', () => {
  const state = stateWithQuests(['q1', 'q6', 'q7']);
  const next = completePackWithW2(state, {
    activityResults: [
      { type: 'reading_comprehension', correct_count: 2, total_count: 2, wrong_count: 0 },
    ],
  });
  assert.equal(next.daily_quests.progress.q7, 1);
});

test('submit combo_xu ten is capped to three diamonds on server', () => {
  const state = stateWithQuests(['q1', 'q2', 'q6']);
  const next = completePackWithW2(state, { comboXu: 10 });
  assert.equal(next.combo_lifetime_xu, 3);
  assert.equal(next.diamonds, state.diamonds + 15 + 3);
});

test('submit with chest already pending does not overwrite it', () => {
  const pending = {
    rarity: 'epic',
    reward: { diamonds: 25, part_id: null },
    duplicate: false,
    awarded_at: COMPLETED_AT,
  };
  const state = {
    ...stateWithQuests(['q1', 'q2', 'q6']),
    pending_chest: pending,
  };
  const next = completePackWithW2(state);
  assert.deepEqual(next.pending_chest, pending);
});
