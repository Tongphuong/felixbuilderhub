import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPackCompletion,
  equipItem,
  getShopItem,
  normalizeProgressState,
  publicShopCatalog,
  purchaseItem,
  publicProgressState,
  saveAvatarMonster,
  unequipSlot,
} from '../functions/api/_read2lead-v2-state.js';

const baseState = () =>
  normalizeProgressState(
    { schema_version: 2, level_reset_version: 20260606, diamonds: 100, inventory: [], equipped: {} },
    { accessCode: 'R2L-SHOP-TEST' },
  );

// R2L-REWARDS-REDESIGN (2026-07-18): the old coin-priced inventory shop
// (hat_star, pet_bunny, etc — 8 items) is retired, superseded by the monster
// part shop (_read2lead-shop-v2.js / read2lead-shop-buy.js, paid in
// diamonds). These tests now assert the RETIRED behavior: nothing in this
// catalog can be found, bought, or equipped, and the endpoint degrades
// cleanly instead of erroring.

test('getShopItem and publicShopCatalog: old catalog is empty — nothing resolves', () => {
  assert.equal(getShopItem('hat_star'), null);
  assert.equal(getShopItem('pet_bunny'), null);
  assert.deepEqual(publicShopCatalog(), []);
});

test('purchaseItem always returns item_not_found — old catalog retired', () => {
  const state = baseState();
  const result = purchaseItem(state, 'hat_star');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'item_not_found');
  assert.equal(result.state, state, 'state is returned unchanged');
});

test('equipItem always returns item_not_found and unequipSlot still clears an (already-empty) slot', () => {
  const state = baseState();
  const denied = equipItem(state, 'pet_bunny');
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'item_not_found');

  const cleared = unequipSlot(state, 'pet');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.state.equipped.pet, undefined);
});

test('saveAvatarMonster persists monster config for avatar shop action (untouched by the retirement)', () => {
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

test('old student record without shop fields does not crash; shop_catalog is now empty', () => {
  const legacy = normalizeProgressState(null, { accessCode: 'R2L-LEGACY-SHOP' });
  const ladder = publicProgressState(legacy);
  assert.deepEqual(ladder.inventory, []);
  assert.deepEqual(ladder.equipped, {});
  assert.ok(Array.isArray(ladder.shop_catalog));
  assert.equal(ladder.shop_catalog.length, 0);

  const afterPack = applyPackCompletion(legacy, { packId: 'pack-a', rewardsEarned: { diamonds: 15, xp: 20 } });
  const pub = publicProgressState(afterPack.state);
  assert.deepEqual(pub.inventory, []);
  assert.equal(pub.diamonds, 15);
});
