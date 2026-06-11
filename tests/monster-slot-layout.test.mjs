import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARM_DUAL_ANCHOR,
  ARM_SINGLE_ANCHORS,
  armDualAnchor,
  armRegionFromFile,
  armSingleAnchors,
  bodyBoxFromFile,
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

test('shape-A body box equals full canvas so legacy tuning is unchanged', () => {
  const box = bodyBoxFromFile('PNG/Default/body_blueA.png');
  assert.deepEqual(box, { x: 0, y: 0, w: 165, h: 165 });
  const ear = resolvePartAnchor('detail', 'PNG/Default/detail_blue_ear.png', box);
  assert.equal(Math.round(ear.anchorX), 20);
  assert.equal(Math.round(ear.anchorY), 56);
  const arms = armSingleAnchors(box);
  assert.equal(Math.round(arms.left.anchorX), 28);
  assert.equal(Math.round(arms.right.anchorX), 137);
});

test('narrow body E keeps ear and arms attached to its box', () => {
  const box = bodyBoxFromFile('PNG/Default/body_greenE.png'); // 132x250 -> ~87px wide, centered
  assert.ok(box.x > 30 && box.x < 45, `box.x=${box.x}`);
  const ear = resolvePartAnchor('detail', 'PNG/Default/detail_green_ear.png', box);
  assert.ok(ear.anchorX > box.x && ear.anchorX < box.x + box.w / 2, 'ear anchored on body left half');
  const arms = armSingleAnchors(box);
  assert.ok(arms.left.anchorX > box.x - 5, 'left arm near body edge, not canvas edge');
  assert.ok(arms.right.anchorX < box.x + box.w + 5, 'right arm near body edge');
  const eyes = resolvePartAnchor('eyes', 'PNG/Default/eye_red.png', box);
  const eyesPlaced = computeAnchoredPlacement(64, 58, eyes);
  const eyesWidthPx = (eyesPlaced.widthPct / 100) * KENNEY_CANVAS.w;
  assert.ok(eyesWidthPx <= 0.8 * box.w + 0.5, 'eyes capped to body width');
});

test('dual arm sprite tracks narrow body width', () => {
  const boxC = bodyBoxFromFile('PNG/Default/body_redC.png'); // 141x194
  const dual = armDualAnchor(boxC);
  const placed = computeAnchoredPlacement(180, 90, dual);
  const widthPx = (placed.widthPct / 100) * KENNEY_CANVAS.w;
  assert.ok(widthPx <= 1.15 * boxC.w + 0.5, `dual arms ${widthPx}px vs body ${boxC.w}px`);
  assert.ok(Math.abs((placed.leftPct + placed.widthPct / 2) / 100 * KENNEY_CANVAS.w - (boxC.x + boxC.w / 2)) < 1, 'centered on body');
});

test('unknown body filename falls back to shape A box', () => {
  const box = bodyBoxFromFile('');
  assert.deepEqual(box, { x: 0, y: 0, w: 165, h: 165 });
});

test('horn detail sits above eye anchor', () => {
  const horn = computeAnchoredPlacement(40, 42, resolvePartAnchor('detail', 'PNG/Default/detail_blue_horn_large.png'));
  const eye = computeAnchoredPlacement(64, 58, resolvePartAnchor('eyes', 'PNG/Default/eye_angry_blue.png'));
  assert.ok(horn.topPct + horn.heightPct <= eye.topPct + 2);
});
