import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MONSTER_SLOTS,
  MONSTER_MANIFEST,
} from '../functions/api/_monster-manifest.js';
import { BASIC_MONSTER_CONFIG, normalizeAvatarMonster } from '../functions/api/_read2lead-v2-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/data/monster-parts.json'), 'utf8'),
);

test('manifest includes hat pet wings slots', () => {
  assert.ok(MONSTER_SLOTS.includes('hat'));
  assert.ok(MONSTER_SLOTS.includes('pet'));
  assert.ok(MONSTER_SLOTS.includes('wings'));
});

test('manifest counts: 100 hat + 60 pet + 8 wings', () => {
  assert.equal(manifest.hat.length, 100);
  assert.equal(manifest.pet.length, 60);
  assert.equal(manifest.wings.length, 8);
});

test('BASIC_MONSTER_CONFIG defaults hat pet wings empty', () => {
  assert.equal(BASIC_MONSTER_CONFIG.hat, '');
  assert.equal(BASIC_MONSTER_CONFIG.pet, '');
  assert.equal(BASIC_MONSTER_CONFIG.wings, '');
});

test('normalizeAvatarMonster migrates missing cosmetic keys to empty', () => {
  const normalized = normalizeAvatarMonster({
    body: 'png-default-body-whitea',
    arms: 'png-default-arm-whitea',
    eyes: 'png-default-eye-blue',
    mouth: 'png-default-moutha',
    detail: '',
    color: 'mint',
  }, 'TEST01');
  assert.equal(normalized.hat, '');
  assert.equal(normalized.pet, '');
  assert.equal(normalized.wings, '');
});

test('hat entries carry tint color and anchor offset', () => {
  const sample = manifest.hat.find((p) => p.id === 'hat-crown-mint');
  assert.ok(sample);
  assert.equal(sample.color, 'mint');
  assert.equal(typeof sample.anchor_offset_y, 'number');
  assert.match(sample.file, /^\/assets\/cosmetics\/hat\/.+\.svg$/);
});

test('pet entries use game-icons SVG files', () => {
  const sample = manifest.pet.find((p) => p.id === 'pet-rabbit-coral');
  assert.ok(sample);
  assert.match(sample.file, /^\/assets\/cosmetics\/pet\/rabbit\.svg$/);
});

test('wings rainbow has price_override 1000', () => {
  const rainbow = manifest.wings.find((p) => p.id === 'wings-rainbow');
  assert.ok(rainbow);
  assert.equal(rainbow.price_override, 1000);
});

test('cosmetic asset files exist on disk', () => {
  const hatFile = path.join(ROOT, 'public/assets/cosmetics/hat/crown.svg');
  const petFile = path.join(ROOT, 'public/assets/cosmetics/pet/rabbit.svg');
  const wingFile = path.join(ROOT, 'public/assets/cosmetics/wings/wings-rainbow.svg');
  assert.ok(fs.existsSync(hatFile));
  assert.ok(fs.existsSync(petFile));
  assert.ok(fs.existsSync(wingFile));
});

test('total cosmetic asset budget under 600KB', () => {
  let bytes = 0;
  for (const sub of ['hat', 'pet', 'wings']) {
    const dir = path.join(ROOT, 'public/assets/cosmetics', sub);
    for (const file of fs.readdirSync(dir)) {
      bytes += fs.statSync(path.join(dir, file)).size;
    }
  }
  assert.ok(bytes < 600 * 1024, `assets ${bytes} bytes exceed 600KB`);
});

test('monster-avatar source declares z-order wings before hat', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/monster-avatar.ts'), 'utf8');
  const wingsIdx = src.indexOf('renderWingsLayer');
  const stackIdx = src.indexOf('container.appendChild(stack)');
  const hatIdx = src.indexOf("renderTintedCosmetic(container, 'hat'");
  assert.ok(wingsIdx > 0 && stackIdx > wingsIdx && hatIdx > stackIdx);
});

test('MONSTER_MANIFEST hat pet wings synced in functions runtime', () => {
  assert.equal(MONSTER_MANIFEST.hat.length, 100);
  assert.equal(MONSTER_MANIFEST.pet.length, 60);
  assert.equal(MONSTER_MANIFEST.wings.length, 8);
});

test('prefers-reduced-motion honored for pet and wings animations', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/monster-avatar.ts'), 'utf8');
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /r2l-monster__pet.*animation: none/s);
  assert.match(src, /r2l-monster__wings-img.*animation: none/s);
});
