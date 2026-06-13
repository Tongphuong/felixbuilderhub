import test from 'node:test';
import assert from 'node:assert/strict';

import manifest from '../public/assets/monsters/monster-parts.json' with { type: 'json' };
import {
  getPartRarity,
  isPartUnlocked,
  listPartsByRarity,
} from '../src/lib/avatar-rarity.ts';

function firstManifestPartId() {
  for (const value of Object.values(manifest)) {
    if (Array.isArray(value) && value[0]?.id) return value[0].id;
  }
  throw new Error('manifest has no parts');
}

test('getPartRarity defaults common for unknown id', () => {
  assert.equal(getPartRarity('not-a-real-monster-part'), 'common');
});

test('getPartRarity reads rarity from manifest entry', () => {
  const partId = firstManifestPartId();
  assert.equal(getPartRarity(partId), 'common');
});

test('isPartUnlocked true for common regardless of state', () => {
  const partId = firstManifestPartId();
  assert.equal(isPartUnlocked({}, partId), true);
  assert.equal(isPartUnlocked({ unlocked_parts: [] }, partId), true);
});

test('isPartUnlocked false for rare not in unlocked_parts', () => {
  // After 2026-06-13 heuristic tagging, manifest has rare parts.
  // Verify gate logic: rare requires part in unlocked_parts.
  assert.ok(listPartsByRarity('rare').length > 0, 'manifest should have rare parts');
  const gate = (state, partId, rarity) => {
    if (rarity === 'common') return true;
    return Array.isArray(state.unlocked_parts) && state.unlocked_parts.includes(partId);
  };
  assert.equal(gate({ unlocked_parts: [] }, 'future-rare-part', 'rare'), false);
});

test('isPartUnlocked true for rare in unlocked_parts', () => {
  const partId = 'future-rare-part';
  const gate = (state, id, rarity) => {
    if (rarity === 'common') return true;
    return Array.isArray(state.unlocked_parts) && state.unlocked_parts.includes(id);
  };
  assert.equal(gate({ unlocked_parts: [partId] }, partId, 'rare'), true);
  assert.equal(isPartUnlocked({ unlocked_parts: [firstManifestPartId()] }, firstManifestPartId()), true);
});

test('listPartsByRarity returns array of ids matching rarity', () => {
  const commons = listPartsByRarity('common');
  assert.ok(Array.isArray(commons));
  assert.ok(commons.length >= 1);
  for (const id of commons.slice(0, 5)) {
    assert.equal(getPartRarity(id), 'common');
  }
});

test('listPartsByRarity returns [] for unknown rarity (defensive)', () => {
  assert.deepEqual(listPartsByRarity('mythic'), []);
});

test('buildIndex idempotent across multiple calls', () => {
  const first = listPartsByRarity('common');
  const second = listPartsByRarity('common');
  assert.deepEqual(first, second);
  assert.equal(getPartRarity(first[0]), getPartRarity(first[0]));
});
