import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computePartPlacement,
  KENNEY_CANVAS,
  MONSTER_SLOT_REGIONS,
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

test('computePartPlacement does not upscale small mouth sprite to full canvas', () => {
  const p = computePartPlacement(52, 20, MONSTER_SLOT_REGIONS.mouth);
  assert.ok(p.widthPct < 60, `mouth width ${p.widthPct}% should stay in face band`);
  assert.ok(p.heightPct < 30, `mouth height ${p.heightPct}% should stay small`);
  assert.ok(p.topPct > 45, 'mouth sits in lower face');
});

test('computePartPlacement keeps eyes in upper face band', () => {
  const p = computePartPlacement(64, 69, MONSTER_SLOT_REGIONS.eyes);
  assert.ok(p.topPct > 10 && p.topPct < 45);
  assert.ok(p.widthPct < 55);
});

test('KENNEY_CANVAS matches Default body reference', () => {
  assert.equal(KENNEY_CANVAS.w, 165);
  assert.equal(KENNEY_CANVAS.h, 165);
});
