import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARM_DUAL_ANCHOR,
  ARM_SINGLE_ANCHORS,
  armRegionFromFile,
  computeAnchoredPlacement,
  computePartPlacement,
  detailRegionFromFile,
  isDualArmSprite,
  KENNEY_CANVAS,
  MONSTER_SLOT_REGIONS,
  resolvePartAnchor,
} from '../src/lib/monster-slot-layout.ts';

test('computePartPlacement fills body to canvas', () => {
  const p = computePartPlacement(165, 165, MONSTER_SLOT_REGIONS.body);
  assert.equal(p.leftPct, 0);
  assert.equal(p.topPct, 0);
  assert.equal(p.widthPct, 100);
  assert.equal(p.heightPct, 100);
});

test('computePartPlacement fits tall/wide body variants into canvas', () => {
  const wide = computePartPlacement(192, 192, MONSTER_SLOT_REGIONS.body);
  const tall = computePartPlacement(132, 250, MONSTER_SLOT_REGIONS.body);
  assert.equal(wide.widthPct, 100);
  assert.equal(wide.heightPct, 100);
  assert.ok(tall.heightPct <= 100);
  assert.ok(tall.widthPct < 100);
  assert.ok(tall.leftPct > 0);
});

test('computeAnchoredPlacement keeps face features smaller than full canvas', () => {
  const eye = computeAnchoredPlacement(64, 58, resolvePartAnchor('eyes', 'PNG/Default/eye_angry_blue.png'));
  const mouth = computeAnchoredPlacement(70, 34, resolvePartAnchor('mouth', 'PNG/Default/mouthA.png'));
  assert.ok(eye.widthPct < 32, `eye width ${eye.widthPct}%`);
  assert.ok(mouth.widthPct < 38, `mouth width ${mouth.widthPct}%`);
  assert.ok(eye.topPct < mouth.topPct);
});

test('KENNEY_CANVAS matches Default body reference', () => {
  assert.equal(KENNEY_CANVAS.w, 165);
  assert.equal(KENNEY_CANVAS.h, 165);
});

test('isDualArmSprite detects Kenney wide C/D limbs', () => {
  assert.equal(isDualArmSprite('PNG/Default/arm_redC.png'), true);
  assert.equal(isDualArmSprite('PNG/Default/arm_redD.png'), true);
  assert.equal(isDualArmSprite('PNG/Default/arm_redA.png'), false);
});

test('armRegionFromFile uses topcenter for wide C/D sprites', () => {
  const wide = armRegionFromFile('PNG/Default/arm_redC.png');
  const single = armRegionFromFile('PNG/Default/arm_redA.png');
  assert.equal(wide.anchor, 'topcenter');
  assert.equal(single.anchor, 'topleft');
});

test('detailRegionFromFile picks anchors per accessory family', () => {
  assert.equal(detailRegionFromFile('PNG/Default/detail_blue_horn_large.png').anchor, 'topcenter');
  assert.equal(detailRegionFromFile('PNG/Default/detail_blue_ear.png').anchor, 'topleft');
  assert.equal(detailRegionFromFile('PNG/Default/eyebrowA.png').anchor, 'topcenter');
  assert.equal(detailRegionFromFile('PNG/Default/nose_brown.png').anchor, 'center');
});

test('single-side arms anchor left and mirrored right on canvas', () => {
  const p = computeAnchoredPlacement(82, 176, ARM_SINGLE_ANCHORS.left);
  const pr = computeAnchoredPlacement(82, 176, ARM_SINGLE_ANCHORS.right);
  assert.ok(p.leftPct < pr.leftPct);
  assert.ok(p.topPct < 15, 'arm centroid sits low on canvas');
  assert.ok(p.heightPct > 90, 'arm spans most of canvas height');
});

test('dual arm sprite centers on canvas', () => {
  const p = computeAnchoredPlacement(98, 181, ARM_DUAL_ANCHOR);
  assert.ok(p.leftPct > 10 && p.leftPct < 40);
  assert.ok(p.heightPct > 95);
});

test('horn detail sits above eye anchor', () => {
  const horn = computeAnchoredPlacement(40, 42, resolvePartAnchor('detail', 'PNG/Default/detail_blue_horn_large.png'));
  const eye = computeAnchoredPlacement(64, 58, resolvePartAnchor('eyes', 'PNG/Default/eye_angry_blue.png'));
  assert.ok(horn.topPct + horn.heightPct <= eye.topPct + 2);
});
