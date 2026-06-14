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
      rank_points: 9,
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
  const defaultId = state.monster_basic_defaults[slot];
  const basicPart = parts.find((part) => part.id === defaultId) || { id: defaultId, file: '' };
  if (state.avatar_stage !== 'custom') return [basicPart];
  const unlocked = new Set(state.unlocked_parts || []);
  return [
    basicPart,
    ...parts.filter((part) =>
      part.id !== defaultId
      && getPartRarity(part.id) !== 'common'
      && unlocked.has(part.id)),
  ];
}

test('basic stage exposes one frozen default per slot', () => {
  const parts = getAvailablePartsForSlot('body', {
    avatar_stage: 'basic',
    monster_parts: manifest,
    monster_basic_defaults: BASIC_MONSTER_CONFIG,
    unlocked_parts: [],
  });
  assert.deepEqual(parts.map((part) => part.id), [BASIC_MONSTER_CONFIG.body]);
});

test('custom stage includes basic default plus an unlocked rare part', () => {
  const slot = slotForPart(rarePart);
  const parts = getAvailablePartsForSlot(slot, {
    avatar_stage: 'custom',
    monster_parts: manifest,
    monster_basic_defaults: BASIC_MONSTER_CONFIG,
    unlocked_parts: [rarePart],
  });
  assert.ok(parts.some((part) => part.id === rarePart));
  assert.ok(parts.some((part) => part.id === BASIC_MONSTER_CONFIG[slot]));
});

test('available slot parts include an unlocked epic part', () => {
  const slot = slotForPart(epicPart);
  const parts = getAvailablePartsForSlot(slot, {
    avatar_stage: 'custom',
    monster_parts: manifest,
    monster_basic_defaults: BASIC_MONSTER_CONFIG,
    unlocked_parts: [epicPart],
  });
  assert.ok(parts.some((part) => part.id === epicPart));
});

test('custom stage excludes free common alternatives', () => {
  const parts = getAvailablePartsForSlot('body', {
    avatar_stage: 'custom',
    monster_parts: manifest,
    monster_basic_defaults: BASIC_MONSTER_CONFIG,
    unlocked_parts: [],
  });
  assert.deepEqual(parts.map((part) => part.id), [BASIC_MONSTER_CONFIG.body]);
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

test('builder filters custom choices to non-common unlocked parts', () => {
  assert.match(builderSource, /state\.avatar_stage !== 'custom'\) return \[basicPart\]/);
  assert.match(builderSource, /getPartRarity\(part\.id\) !== 'common'/);
  assert.match(builderSource, /unlocked\.has\(part\.id\)/);
});

test('builder removes free color customization', () => {
  assert.doesNotMatch(builderSource, /data-monster-color/);
  assert.doesNotMatch(builderSource, /colorSwatches/);
});

test('equip ceremony only fires for unseen rare or epic parts', () => {
  assert.match(builderSource, /rarity !== 'common' && !equippedPartIds\.has\(nextId\)/);
  assert.match(builderSource, /playKenney\?\.\('quest-complete'\)/);
});

test('equip ceremony auto-closes after 3 seconds', () => {
  assert.match(builderSource, /}, 3000\)/);
  assert.match(ceremonySource, /3s/);
});
