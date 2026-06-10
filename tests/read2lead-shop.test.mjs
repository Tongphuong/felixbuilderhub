import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPackCompletion,
  equipItem,
  normalizeProgressState,
  purchaseItem,
  publicProgressState,
  saveAvatarMonster,
  unequipSlot,
} from '../functions/api/_read2lead-v2-state.js';

const baseState = () =>
  normalizeProgressState(
    { schema_version: 2, level_reset_version: 20260606, coins: 100, inventory: [], equipped: {} },
    { accessCode: 'R2L-SHOP-TEST' },
  );

test('purchaseItem buys once, rejects broke, and is idempotent when owned', () => {
  let state = baseState();
  const first = purchaseItem(state, 'hat_star');
  assert.equal(first.ok, true);
  assert.equal(first.purchased, true);
  assert.equal(first.state.coins, 70);
  assert.deepEqual(first.state.inventory, ['hat_star']);

  const broke = purchaseItem({ ...first.state, coins: 10 }, 'hat_crown');
  assert.equal(broke.ok, false);
  assert.equal(broke.error, 'insufficient_coins');

  const again = purchaseItem(first.state, 'hat_star');
  assert.equal(again.ok, true);
  assert.equal(again.already_owned, true);
  assert.equal(again.state.coins, 70);
});

test('equipItem only works when owned and unequipSlot clears slot', () => {
  const bought = purchaseItem(baseState(), 'pet_bunny');
  const denied = equipItem(baseState(), 'pet_bunny');
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'not_owned');

  const equipped = equipItem(bought.state, 'pet_bunny');
  assert.equal(equipped.ok, true);
  assert.equal(equipped.state.equipped.pet, 'pet_bunny');

  const cleared = unequipSlot(equipped.state, 'pet');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.state.equipped.pet, undefined);
});

test('saveAvatarMonster persists monster config for avatar shop action', () => {
  const base = baseState();
  const saved = saveAvatarMonster(base, {
    body: base.avatar.monster.body,
    eyes: base.avatar.monster.eyes,
    mouth: base.avatar.monster.mouth,
    arms: base.avatar.monster.arms,
    detail: base.avatar.monster.detail,
    color: 'lemon',
  }, 'R2L-SHOP-TEST');
  assert.equal(saved.ok, true);
  assert.equal(saved.state.avatar.monster.color, 'lemon');
});

test('old student record without shop fields does not crash', () => {
  const legacy = normalizeProgressState(null, { accessCode: 'R2L-LEGACY-SHOP' });
  const ladder = publicProgressState(legacy);
  assert.deepEqual(ladder.inventory, []);
  assert.deepEqual(ladder.equipped, {});
  assert.ok(Array.isArray(ladder.shop_catalog));
  assert.equal(ladder.shop_catalog.length, 8);

  const afterPack = applyPackCompletion(legacy, { packId: 'pack-a', rewardsEarned: { coins: 15, xp: 20 } });
  const pub = publicProgressState(afterPack.state);
  assert.deepEqual(pub.inventory, []);
});
