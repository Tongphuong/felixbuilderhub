import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateOverallScoreFromStars,
  calculateReward,
  comboVisualLevel,
  createGameState,
  endPhase,
  recordAnswer,
  resetPhaseCombo,
  rollChestTier,
} from '../src/lib/r2l-game-state.ts';

test('test_combo_increments_on_correct', () => {
  let state = createGameState();
  state = recordAnswer(state, 'vocab_blitz', true, 5000);
  assert.equal(state.combo.current, 1);
  assert.equal(state.combo.max, 1);
  state = recordAnswer(state, 'vocab_blitz', true, 4000);
  assert.equal(state.combo.current, 2);
  assert.equal(state.combo.max, 2);
});

test('test_combo_resets_on_wrong', () => {
  let state = createGameState();
  state = recordAnswer(state, 'vocab_blitz', true, 4000);
  state = recordAnswer(state, 'vocab_blitz', true, 4000);
  state = recordAnswer(state, 'vocab_blitz', false, 4000);
  assert.equal(state.combo.current, 0);
  assert.equal(state.combo.max, 2);
});

test('test_combo_resets_between_phases', () => {
  let state = createGameState();
  state = recordAnswer(state, 'vocab_blitz', true, 2000);
  state = recordAnswer(state, 'vocab_blitz', true, 2000);
  state = endPhase(state, 'vocab_blitz', {
    items: [
      { correct: true },
      { correct: true },
      { correct: true },
      { correct: true },
      { correct: true },
      { correct: false },
    ],
  });
  assert.equal(state.combo.current, 0);
  state = recordAnswer(state, 'sentence_builder', true, 2000);
  assert.equal(state.combo.current, 1);
  assert.equal(state.combo.phase_max.vocab_blitz, 2);
});

test('test_badge_earned_at_threshold', () => {
  const cases = [
    {
      phase: 'story_discovery',
      result: { items: Array.from({ length: 10 }, (_, i) => ({ correct: i < 8 })) },
      badge: 'Nhà thám hiểm',
    },
    {
      phase: 'vocab_blitz',
      result: { items: [{ correct: true }, { correct: true }, { correct: true }, { correct: true }, { correct: true }, { correct: false }] },
      badge: 'Phù thủy chữ',
    },
    {
      phase: 'sentence_builder',
      result: { items: [{ correct: true, attempts: 1 }, { correct: true, attempts: 1 }] },
      badge: 'Kiến trúc sư',
    },
    {
      phase: 'story_detective',
      result: { questions: [{ correct: true }, { correct: true }] },
      badge: 'Thám tử Vàng',
    },
    {
      phase: 'listen_and_fill',
      result: {
        items: Array.from({ length: 5 }, () => ({ correct: true, first_try: true })),
      },
      badge: 'Tai Thần',
    },
    {
      phase: 'echo_challenge',
      result: {
        items: [{ scores: { overall: 85 } }, { scores: { overall: 80 } }],
      },
      badge: 'Giọng ca Vàng',
    },
    {
      phase: 'speed_round',
      result: { items: Array.from({ length: 10 }, (_, i) => ({ correct: i < 8 })) },
      badge: 'Tia Chớp',
    },
  ];

  for (const { phase, result, badge } of cases) {
    let state = createGameState();
    state = endPhase(state, phase, result);
    const earned = state.badges.find((entry) => entry.phase === phase);
    assert.equal(earned?.earned, true, `${phase} should earn badge`);
    assert.equal(earned?.name_vi, badge);
  }
});

test('test_score_100_calculation', () => {
  const stars = {
    story_discovery: 3,
    vocab_blitz: 3,
    sentence_builder: 3,
    story_detective: 2,
    listen_and_fill: 2,
    echo_challenge: 2,
    speed_round: 0,
  };
  assert.equal(calculateOverallScoreFromStars(stars), Math.round((15 / 21) * 100));
});

test('test_speed_bonus_within_3s', () => {
  let state = createGameState();
  state = recordAnswer(state, 'vocab_blitz', true, 2500);
  state = recordAnswer(state, 'vocab_blitz', true, 5000);
  assert.equal(state.speed_items, 1);
  state = endPhase(state, 'vocab_blitz', {
    items: [
      { correct: true, time_ms: 2500 },
      { correct: true, time_ms: 5000 },
    ],
  });
  assert.ok(state.coins.speed_bonus >= 2);
});

test('test_chest_tier_distribution', () => {
  const tiers = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < 1000; i += 1) {
    const chest = rollChestTier(() => i / 1000);
    tiers[chest.tier] += 1;
  }
  assert.ok(tiers.common >= 600 && tiers.common <= 800, `common ~70% got ${tiers.common}`);
  assert.ok(tiers.rare >= 150 && tiers.rare <= 350, `rare ~25% got ${tiers.rare}`);
  assert.ok(tiers.epic >= 0 && tiers.epic <= 150, `epic ~5% got ${tiers.epic}`);
});

test('combo visual thresholds', () => {
  assert.equal(comboVisualLevel(2), 'normal');
  assert.equal(comboVisualLevel(3), 'fire');
  assert.equal(comboVisualLevel(5), 'lightning');
  assert.equal(comboVisualLevel(8), 'rainbow');
});

test('resetPhaseCombo clears current streak only', () => {
  let state = createGameState();
  state = recordAnswer(state, 'vocab_blitz', true, 1000);
  state = resetPhaseCombo(state);
  assert.equal(state.combo.current, 0);
  assert.equal(state.combo.max, 1);
});

test('calculateReward includes chest coins', () => {
  let state = createGameState();
  state = endPhase(state, 'vocab_blitz', {
    items: Array.from({ length: 6 }, () => ({ correct: true })),
  });
  state.stars = { vocab_blitz: 3 };
  const reward = calculateReward(state, () => 0.15);
  assert.equal(reward.chest_tier, 'rare');
  assert.equal(reward.chest_coins, 15);
  assert.ok(reward.coins >= reward.chest_coins);
});
