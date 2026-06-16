import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COSMETIC_PRICES,
  buildShopCatalog,
  executeBuy,
  getPartRarity,
  getPartSlot,
  humanizePartId,
} from '../functions/api/_read2lead-shop-v2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('COSMETIC_PRICES match spec tier table', () => {
  assert.deepEqual(COSMETIC_PRICES.hat, { common: 80, rare: 200, epic: 400 });
  assert.deepEqual(COSMETIC_PRICES.pet, { common: 120, rare: 280, epic: 500 });
  assert.deepEqual(COSMETIC_PRICES.wings, { common: 200, rare: 400, epic: 800 });
});

// V5 Track B disabled — art style conflict với Kenney monster cartoon.
// Tests below assert the disabled state (catalog excludes hat/pet/wings).

test('buildShopCatalog excludes V5 cosmetic parts (Track B disabled)', () => {
  const catalog = buildShopCatalog({ includeDecorations: true });
  const hats = catalog.filter((item) => item.slot === 'hat');
  const pets = catalog.filter((item) => item.slot === 'pet');
  const wings = catalog.filter((item) => item.slot === 'wings');
  assert.equal(hats.length, 0);
  assert.equal(pets.length, 0);
  assert.equal(wings.length, 0);
});

test('humanizePartId returns Vietnamese labels for cosmetics', () => {
  assert.match(humanizePartId('hat-crown-mint'), /^Mũ /);
  assert.match(humanizePartId('pet-rabbit-coral'), /^Thú cưng /);
  assert.equal(humanizePartId('wings-rainbow'), 'cánh cầu vồng');
});

test('executeBuy purchases hat common part', () => {
  const result = executeBuy({ coins: 200, unlocked_parts: [] }, 'hat-crown-mint');
  assert.equal(result.error, undefined);
  assert.equal(result.state.coins, 120);
  assert.deepEqual(result.reward, { part_id: 'hat-crown-mint', price: 80 });
});

test('getPartSlot resolves cosmetic ids', () => {
  assert.equal(getPartSlot('hat-crown-mint'), 'hat');
  assert.equal(getPartSlot('pet-owl-lemon'), 'pet');
  assert.equal(getPartSlot('wings-fairy-blue'), 'wings');
});

test('shop-ux exposes VN filter chips Mũ Thú cưng Cánh', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/shop-ux.ts'), 'utf8');
  assert.match(src, /label: 'Mũ'/);
  assert.match(src, /label: 'Thú cưng'/);
  assert.match(src, /label: 'Cánh'/);
});

test('shop thumbnails route to cosmetics assets', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/shop-ux.ts'), 'utf8');
  assert.match(src, /\/assets\/cosmetics\/hat\//);
  assert.match(src, /\/assets\/cosmetics\/pet\//);
  assert.match(src, /\/assets\/cosmetics\/wings\//);
});

test('W7 effects/frame remain hidden from default shop filters', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/shop-ux.ts'), 'utf8');
  assert.match(src, /slot !== 'effects' && item\.slot !== 'frame'/);
});

test('getPartRarity reads manifest rarity for cosmetics', () => {
  assert.equal(getPartRarity('hat-jester-hat-grape'), 'epic');
  assert.equal(getPartRarity('pet-butterfly-grape'), 'epic');
  assert.equal(getPartRarity('wings-bat-dark'), 'epic');
});
