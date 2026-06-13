import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync('src/lib/monster-avatar.ts', 'utf8');

test('renderMonster does not include emoji hat overlay when state.equipped has hat', () => {
  assert.match(src, /const COSMETIC_OVERLAYS_ENABLED = false;/);
  assert.match(src, /if \(withCosmetics && COSMETIC_OVERLAYS_ENABLED\) \{/);
  assert.match(src, /r2l-monster__hat/);
  const gatedBlock = src.slice(src.indexOf('if (withCosmetics && COSMETIC_OVERLAYS_ENABLED)'));
  assert.ok(gatedBlock.includes('r2l-monster__hat'));
  assert.ok(!src.includes('if (withCosmetics) {') || src.includes('if (withCosmetics && COSMETIC_OVERLAYS_ENABLED)'));
});

test('renderMonster does not include pet overlay', () => {
  const gatedStart = src.indexOf('if (withCosmetics && COSMETIC_OVERLAYS_ENABLED)');
  const gatedEnd = src.indexOf('export function nameColorClassFromEquipped');
  const gatedBlock = src.slice(gatedStart, gatedEnd);
  assert.match(gatedBlock, /r2l-monster__pet/);
  assert.match(gatedBlock, /container\.appendChild\(pet\)/);
  assert.doesNotMatch(src.slice(0, gatedStart), /container\.appendChild\(pet\)/);
});

test('renderMonster does not add CSS frame class', () => {
  assert.match(src, /const frameItem = withCosmetics && COSMETIC_OVERLAYS_ENABLED/);
  assert.doesNotMatch(
    src,
    /const frameItem = withCosmetics\s*\n\s*\? getEquippedItem\('frame'/,
  );
});
