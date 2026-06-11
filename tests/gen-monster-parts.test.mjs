import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMonsterManifestFromRaw,
  classifyMonsterSlot,
  makeMonsterPartId,
  shouldIncludeMonsterAsset,
  shouldSkipMonsterPng,
} from '../scripts/gen-monster-parts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'public', 'assets', 'monsters', 'raw');

test('classifyMonsterSlot maps Kenney filename prefixes', () => {
  assert.equal(classifyMonsterSlot('body_blueA.png'), 'body');
  assert.equal(classifyMonsterSlot('eye_blue.png'), 'eyes');
  assert.equal(classifyMonsterSlot('mouth_closed_happy.png'), 'mouth');
  assert.equal(classifyMonsterSlot('mouthA.png'), 'mouth');
  assert.equal(classifyMonsterSlot('arm_redC.png'), 'arms');
  assert.equal(classifyMonsterSlot('detail_blue_ear.png'), 'detail');
  assert.equal(classifyMonsterSlot('eyebrowA.png'), 'detail');
});

test('shouldIncludeMonsterAsset only keeps PNG/Default compositing set', () => {
  assert.equal(shouldIncludeMonsterAsset('PNG/Default/body_blueA.png', 'body_blueA.png'), true);
  assert.equal(shouldIncludeMonsterAsset('PNG/Double/body_blueA.png', 'body_blueA.png'), false);
  assert.equal(shouldIncludeMonsterAsset('PNG/Default/leg_blueA.png', 'leg_blueA.png'), false);
  assert.equal(shouldIncludeMonsterAsset('Spritesheet/spritesheet_default.png', 'spritesheet_default.png'), false);
});

test('shouldSkipMonsterPng ignores spritesheets and preview assets', () => {
  assert.equal(shouldSkipMonsterPng('spritesheet_default.png'), true);
  assert.equal(shouldSkipMonsterPng('Preview.png'), true);
  assert.equal(shouldSkipMonsterPng('body_blueA.png'), false);
});

test('makeMonsterPartId slugifies relative raw paths', () => {
  assert.equal(makeMonsterPartId('PNG/Default/body_blueA.png'), 'png-default-body-bluea');
});

test('buildMonsterManifestFromRaw scans raw PNG tree when present', () => {
  if (!fs.existsSync(RAW_DIR)) {
    const empty = buildMonsterManifestFromRaw(RAW_DIR);
    assert.equal(empty.total, 0);
    return;
  }
  const { manifest, counts, total } = buildMonsterManifestFromRaw(RAW_DIR);
  assert.ok(total >= 0);
  for (const slot of ['body', 'eyes', 'mouth', 'arms', 'detail']) {
    assert.equal(counts[slot], manifest[slot].length);
    for (const entry of manifest[slot]) {
      assert.ok(entry.id);
      assert.ok(entry.file.endsWith('.png'));
      assert.ok(entry.file.startsWith('PNG/Default/'), entry.file);
      assert.ok(!entry.file.includes('/Double/'), entry.file);
      assert.ok(fs.existsSync(path.join(RAW_DIR, entry.file)));
    }
  }
});
