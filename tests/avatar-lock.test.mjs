import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import manifest from '../public/assets/monsters/monster-parts.json' with { type: 'json' };
import {
  BASIC_MONSTER_CONFIG,
  normalizeProgressState,
  publicProgressState,
  saveAvatarMonster,
} from '../functions/api/_read2lead-v2-state.js';
import {
  filterUnlockedParts,
  getPartRarity,
  isPartUnlocked,
  listPartsByRarity,
} from '../src/lib/avatar-rarity.ts';

const RESET_VERSION = 20260606;
const rarePart = listPartsByRarity('rare')[0];
const epicPart = listPartsByRarity('epic')[0];
const builderSource = readFileSync('src/lib/monster-builder.ts', 'utf8');
const ceremonySource = readFileSync(
  'src/components/read2lead/v4/EquipCeremony.astro',
  'utf8',
);

function stateAtL2(extra = {}) {
  return normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: RESET_VERSION,
      current_level: 'L2',
      initial_level: 'L1',
      ...extra,
    },
    { accessCode: 'LOCK-L2' },
  );
}

function slotForPart(partId) {
  return Object.keys(manifest).find((slot) => manifest[slot].some((part) => part.id === partId));
}

function getAvailablePartsForSlot(slot, state) {
  const parts = slot === 'detail'
    ? [{ id: '', file: '' }, ...manifest[slot]]
    : manifest[slot];
  return filterUnlockedParts(state, parts);
}

test('available slot parts contain only common parts when nothing is unlocked', () => {
  const parts = getAvailablePartsForSlot('body', {
    monster_parts: manifest,
    unlocked_parts: [],
  });
  assert.ok(parts.length > 0);
  assert.ok(parts.every((part) => getPartRarity(part.id) === 'common'));
});

test('available slot parts include an unlocked rare part', () => {
  const slot = slotForPart(rarePart);
  const parts = getAvailablePartsForSlot(slot, {
    monster_parts: manifest,
    unlocked_parts: [rarePart],
  });
  assert.ok(parts.some((part) => part.id === rarePart));
});

test('available slot parts include an unlocked epic part', () => {
  const slot = slotForPart(epicPart);
  const parts = getAvailablePartsForSlot(slot, {
    monster_parts: manifest,
    unlocked_parts: [epicPart],
  });
  assert.ok(parts.some((part) => part.id === epicPart));
});

test('common parts are unlocked without unlocked_parts state', () => {
  const commonPart = listPartsByRarity('common')[0];
  assert.equal(isPartUnlocked({}, commonPart), true);
});

test('rare parts stay locked when unlocked_parts is undefined', () => {
  assert.equal(isPartUnlocked({}, rarePart), false);
});

test('rare parts respect the unlocked_parts list', () => {
  assert.equal(isPartUnlocked({ unlocked_parts: [rarePart] }, rarePart), true);
});

test('normalization grandfathers a currently equipped rare part', () => {
  const slot = slotForPart(rarePart);
  const monster = { ...BASIC_MONSTER_CONFIG, [slot]: rarePart };
  const state = stateAtL2({ avatar: { monster }, unlocked_parts: [] });
  assert.ok(state.unlocked_parts.includes(rarePart));
});

test('grandfather migration is idempotent', () => {
  const slot = slotForPart(rarePart);
  const monster = { ...BASIC_MONSTER_CONFIG, [slot]: rarePart };
  const first = stateAtL2({ avatar: { monster }, unlocked_parts: [rarePart] });
  const second = normalizeProgressState(first, { accessCode: 'LOCK-L2' });
  assert.equal(second.unlocked_parts.filter((id) => id === rarePart).length, 1);
});

test('public progress exposes unlocked parts for the builder', () => {
  const state = stateAtL2({ unlocked_parts: [rarePart] });
  assert.deepEqual(publicProgressState(state).unlocked_parts, [rarePart]);
});

test('server save refuses a rare part that is not unlocked', () => {
  const state = stateAtL2();
  const slot = slotForPart(rarePart);
  const saved = saveAvatarMonster(
    state,
    { ...BASIC_MONSTER_CONFIG, [slot]: rarePart },
    'LOCK-L2',
  );
  assert.notEqual(saved.state.avatar.monster[slot], rarePart);
});

test('server save accepts a rare part after it is unlocked', () => {
  const state = stateAtL2({ unlocked_parts: [rarePart] });
  const slot = slotForPart(rarePart);
  const saved = saveAvatarMonster(
    state,
    { ...BASIC_MONSTER_CONFIG, [slot]: rarePart },
    'LOCK-L2',
  );
  assert.equal(saved.state.avatar.monster[slot], rarePart);
});

test('builder uses the shared unlocked-parts filter for every slot', () => {
  assert.match(builderSource, /return filterUnlockedParts\(state, partsForSlot\(state, slot\)\)/);
});

test('equip ceremony only fires for unseen rare or epic parts', () => {
  assert.match(builderSource, /rarity !== 'common' && !equippedPartIds\.has\(nextId\)/);
  assert.match(builderSource, /playKenney\?\.\('quest-complete'\)/);
});

test('equip ceremony auto-closes after 1.2 seconds', () => {
  assert.match(builderSource, /}, 1200\)/);
  assert.match(ceremonySource, /1\.2s/);
});
