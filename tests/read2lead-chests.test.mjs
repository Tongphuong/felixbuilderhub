import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHEST_ODDS,
  CHEST_REWARDS,
  DUPLICATE_CONVERSION,
  rollRarity,
  buildReward,
  rollChest,
  autoConvertDuplicate,
  chestPreviewText,
} from '../functions/api/_read2lead-chests.js';

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('CHEST_ODDS sum to 1.0', () => {
  const total = CHEST_ODDS.common + CHEST_ODDS.rare + CHEST_ODDS.epic;
  assert.equal(total, 1.0);
});

test('rollRarity with rng=0.01 → epic', () => {
  assert.deepEqual(rollRarity(() => 0.01), { rarity: 'epic' });
});

test('rollRarity with rng=0.1 → rare', () => {
  assert.deepEqual(rollRarity(() => 0.1), { rarity: 'rare' });
});

test('rollRarity with rng=0.5 → common', () => {
  assert.deepEqual(rollRarity(() => 0.5), { rarity: 'common' });
});

test('rollRarity distribution close to odds over 10000 rolls (±2%)', () => {
  const rngFn = lcg(0x5eed);
  const counts = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < 10000; i += 1) {
    counts[rollRarity(rngFn).rarity] += 1;
  }
  const tolerance = 0.02;
  for (const [rarity, odds] of Object.entries(CHEST_ODDS)) {
    const actual = counts[rarity] / 10000;
    assert.ok(
      Math.abs(actual - odds) <= tolerance,
      `${rarity}: expected ~${odds}, got ${actual}`,
    );
  }
});

test('buildReward common returns diamonds in 5..10', () => {
  const reward = buildReward('common', () => 0.5);
  assert.ok(reward.diamonds >= 5 && reward.diamonds <= 10);
  assert.equal(reward.part_id, null);
});

test('buildReward rare returns diamonds in 12..20', () => {
  const reward = buildReward('rare', () => 0.25);
  assert.ok(reward.diamonds >= 12 && reward.diamonds <= 20);
});

test('buildReward epic returns 25 diamonds', () => {
  const reward = buildReward('epic', () => 0.99);
  assert.equal(reward.diamonds, 25);
  // After 2026-06-13 manifest tagging, epic pool has parts → part_id non-null.
  assert.ok(reward.part_id !== null, 'epic reward should include a part_id from non-common pool');
});

test('buildReward unknown rarity returns zero reward', () => {
  assert.deepEqual(buildReward('mythic', () => 0.5), { diamonds: 0, part_id: null });
});

test('rollChest combines roll + build', () => {
  const chest = rollChest(() => 0.01);
  assert.equal(chest.rarity, 'epic');
  assert.equal(typeof chest.reward.diamonds, 'number');
  assert.ok('part_id' in chest.reward);
});

test('autoConvertDuplicate replaces dup part with bonus diamonds', () => {
  const chest = {
    rarity: 'rare',
    reward: { diamonds: 15, part_id: 'png-default-eyes-a' },
  };
  const converted = autoConvertDuplicate(chest, ['png-default-eyes-a']);
  assert.equal(converted.duplicate, true);
  assert.equal(converted.reward.diamonds, 15 + DUPLICATE_CONVERSION.rare);
  assert.equal(converted.reward.part_id, null);
});

test('autoConvertDuplicate keeps part if not in owned set', () => {
  const chest = {
    rarity: 'epic',
    reward: { diamonds: 25, part_id: 'png-default-body-bluea' },
  };
  const kept = autoConvertDuplicate(chest, ['other-part']);
  assert.equal(kept.duplicate, false);
  assert.equal(kept.reward.part_id, 'png-default-body-bluea');
});

test('autoConvertDuplicate accepts Set or Array for ownedPartIds', () => {
  const chest = {
    rarity: 'common',
    reward: { diamonds: 8, part_id: 'dup-part' },
  };
  const fromArray = autoConvertDuplicate(chest, ['dup-part']);
  const fromSet = autoConvertDuplicate(chest, new Set(['dup-part']));
  assert.equal(fromArray.duplicate, true);
  assert.equal(fromSet.duplicate, true);
  assert.equal(fromArray.reward.diamonds, 8 + DUPLICATE_CONVERSION.common);
});

test('chestPreviewText transparent — exposes ranges in 💎', () => {
  assert.match(chestPreviewText('common'), /5–10💎/);
  assert.match(chestPreviewText('rare'), /12–20💎/);
  assert.match(chestPreviewText('rare'), /phần thưởng/);
  assert.match(chestPreviewText('epic'), /25💎/);
  assert.equal(chestPreviewText('unknown'), '');
});

test('CHEST_REWARDS and DUPLICATE_CONVERSION match spec constants (diamonds, 1💎=2🪙)', () => {
  assert.equal(CHEST_REWARDS.common.part_pool, null);
  assert.equal(CHEST_REWARDS.epic.diamonds_min, CHEST_REWARDS.epic.diamonds_max);
  assert.equal(CHEST_REWARDS.common.diamonds_min, 5);
  assert.equal(CHEST_REWARDS.common.diamonds_max, 10);
  assert.equal(CHEST_REWARDS.rare.diamonds_min, 12);
  assert.equal(CHEST_REWARDS.rare.diamonds_max, 20);
  assert.equal(CHEST_REWARDS.epic.diamonds_min, 25);
  assert.equal(DUPLICATE_CONVERSION.common, 9);
  assert.equal(DUPLICATE_CONVERSION.rare, 15);
  assert.equal(DUPLICATE_CONVERSION.epic, 30);
});
