import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMonsterManifestFromRaw,
  classifyMonsterSlot,
  isArmOrientationOutward,
  makeMonsterPartId,
  measureArmGeometry,
  measureBodyGeometry,
  shouldIncludeMonsterAsset,
  shouldSkipMonsterPng,
} from '../scripts/gen-monster-parts.mjs';
import { PNG } from 'pngjs';

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
      if (slot === 'body') {
        assert.ok(entry.geom?.w > 0);
        assert.ok(entry.geom?.h > 0);
        assert.ok(entry.sockets?.armLeft);
        assert.ok(entry.sockets?.armRight);
      }
      if (slot === 'arms') {
        assert.ok(entry.geom?.w > 0);
        assert.ok(entry.geom?.h > 0);
        assert.ok(Number.isFinite(entry.geom?.pivotX));
        assert.ok(Number.isFinite(entry.geom?.pivotY));
        assert.match(entry.geom?.attach, /^(left|right)$/);
      }
    }
  }
});

test('alpha measurements find body sockets plus shoulder and hand centroids', () => {
  const body = new PNG({ width: 10, height: 10 });
  for (let y = 1; y <= 8; y += 1) {
    for (let x = 2; x <= 7; x += 1) body.data[(y * body.width + x) * 4 + 3] = 255;
  }
  const bodyGeometry = measureBodyGeometry(body);
  assert.deepEqual(bodyGeometry.sockets.armLeft, { x: 2, y: 5 });
  assert.deepEqual(bodyGeometry.sockets.armRight, { x: 7, y: 5 });

  const arm = new PNG({ width: 6, height: 8 });
  for (let y = 1; y <= 2; y += 1) arm.data[(y * arm.width) * 4 + 3] = 255;
  for (let y = 2; y <= 6; y += 1) arm.data[(y * arm.width + 5) * 4 + 3] = 255;
  // Shoulder = centroid of the TOP opaque band (the ball, top-left here);
  // hand = bottom band. The old edge-run heuristic picked the tall right edge
  // (the hand) and produced backwards arms on every real Kenney sprite.
  assert.deepEqual(measureArmGeometry(arm), {
    w: 6,
    h: 8,
    pivotX: 2.5,
    pivotY: 2,
    handX: 5,
    handY: 5,
    attach: 'left',
  });
});

test('arm orientation QA rejects a hand flipped inward', () => {
  const arm = {
    w: 6,
    h: 8,
    pivotX: 1,
    pivotY: 2,
    handX: 5,
    handY: 6,
    attach: 'left',
  };
  const placement = { x: 10, y: 0, scale: 1 };

  assert.equal(isArmOrientationOutward(arm, { ...placement, flip: true }, 'left'), true);
  assert.equal(isArmOrientationOutward(arm, { ...placement, flip: false }, 'left'), false);
  assert.equal(isArmOrientationOutward(arm, { ...placement, flip: false }, 'right'), true);
  assert.equal(isArmOrientationOutward(arm, { ...placement, flip: true }, 'right'), false);
});
