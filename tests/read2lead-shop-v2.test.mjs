import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHOP_PRICES,
  buildShopCatalog,
  buildShopView,
  executeBuy,
  getPartRarity,
  humanizePartId,
  listPartsByRarity,
} from '../functions/api/_read2lead-shop-v2.js';

const RARE_PART = 'png-default-detail-blue-horn-small';
const EPIC_PART = 'png-default-detail-blue-horn-large';
const COMMON_PART = 'png-default-detail-blue-ear';

test('SHOP_PRICES exposes 3 tiers', () => {
  assert.deepEqual(SHOP_PRICES, { common: 0, rare: 80, epic: 200 });
});

test('buildShopCatalog only includes rare + epic parts', () => {
  const catalog = buildShopCatalog();
  assert.ok(catalog.length > 0);
  for (const item of catalog) {
    assert.ok(item.rarity === 'rare' || item.rarity === 'epic');
    assert.equal(item.price, SHOP_PRICES[item.rarity]);
    assert.ok(item.name);
  }
  const ids = new Set(catalog.map((item) => item.id));
  assert.ok(ids.has(RARE_PART));
  assert.ok(ids.has(EPIC_PART));
  assert.ok(!ids.has(COMMON_PART));
});

test('buildShopView marks owned items', () => {
  const view = buildShopView({
    coins: 500,
    unlocked_parts: [RARE_PART],
  });
  const owned = view.find((item) => item.id === RARE_PART);
  const fresh = view.find((item) => item.id === EPIC_PART);
  assert.equal(owned?.owned, true);
  assert.equal(fresh?.owned, false);
});

test('buildShopView marks can_afford based on coins', () => {
  const rich = buildShopView({ coins: 500, unlocked_parts: [] });
  const poor = buildShopView({ coins: 10, unlocked_parts: [] });
  const epicRich = rich.find((item) => item.id === EPIC_PART);
  const epicPoor = poor.find((item) => item.id === EPIC_PART);
  assert.equal(epicRich?.can_afford, true);
  assert.equal(epicPoor?.can_afford, false);
});

test('executeBuy success deducts coins + adds to unlocked_parts', () => {
  const state = { coins: 100, unlocked_parts: [] };
  const result = executeBuy(state, RARE_PART);
  assert.equal(result.error, undefined);
  assert.equal(result.state.coins, 20);
  assert.deepEqual(result.state.unlocked_parts, [RARE_PART]);
  assert.deepEqual(result.reward, { part_id: RARE_PART, price: 80 });
});

test('executeBuy rejects already_owned', () => {
  const result = executeBuy({ coins: 200, unlocked_parts: [RARE_PART] }, RARE_PART);
  assert.equal(result.error, 'already_owned');
});

test('executeBuy rejects insufficient_coins', () => {
  const result = executeBuy({ coins: 10, unlocked_parts: [] }, RARE_PART);
  assert.equal(result.error, 'insufficient_coins');
});

test('executeBuy rejects common_parts_are_free', () => {
  const result = executeBuy({ coins: 200, unlocked_parts: [] }, COMMON_PART);
  assert.equal(result.error, 'common_parts_are_free');
});

test('executeBuy is pure (does not mutate input state)', () => {
  const state = { coins: 200, unlocked_parts: [] };
  const snapshot = JSON.stringify(state);
  executeBuy(state, RARE_PART);
  assert.equal(JSON.stringify(state), snapshot);
});

test('humanizePartId returns string for known formats', () => {
  const label = humanizePartId('png-default-detail-blue-horn-large');
  assert.match(label, /Sừng/);
  assert.match(label, /xanh/);
  assert.match(label, /lớn/);
});

test('listPartsByRarity returns rare and epic pools', () => {
  const rare = listPartsByRarity('rare');
  const epic = listPartsByRarity('epic');
  assert.ok(rare.includes(RARE_PART));
  assert.ok(epic.includes(EPIC_PART));
  assert.equal(listPartsByRarity('unknown').length, 0);
});

test('getPartRarity reads inferred rarity from manifest ids', () => {
  assert.equal(getPartRarity(RARE_PART), 'rare');
  assert.equal(getPartRarity(EPIC_PART), 'epic');
  assert.equal(getPartRarity(COMMON_PART), 'common');
});
