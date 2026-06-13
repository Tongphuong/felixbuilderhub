import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import {
  bodyBoxFromFile,
  computeAnchoredPlacement,
  HORN_CONTACT_INSET_PX,
  HORN_PIVOTS,
  KENNEY_CANVAS,
  resolvePartAnchor,
} from '../src/lib/monster-slot-layout.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'public', 'assets', 'monsters', 'raw', 'PNG', 'Default');
const COLORS = ['blue', 'dark', 'green', 'red', 'white'];
const SHAPES = ['A', 'B', 'C', 'D', 'E', 'F'];
const VARIANTS = ['none', 'large', 'small'];

function readPng(filename) {
  return PNG.sync.read(fs.readFileSync(path.join(ASSET_DIR, filename)));
}

function bodyTopAtCanvasX(png, bodyBox, canvasX) {
  const scale = bodyBox.w / png.width;
  const sourceX = Math.max(0, Math.min(png.width - 1, Math.round((canvasX - bodyBox.x) / scale)));
  for (let y = 0; y < png.height; y += 1) {
    if (png.data[(y * png.width + sourceX) * 4 + 3] > 0) {
      return bodyBox.y + y * scale;
    }
  }
  throw new Error(`body has no alpha at source x=${sourceX}`);
}

function transformedPivot(anchor, placement, naturalWidth) {
  const left = placement.leftPct / 100 * KENNEY_CANVAS.w;
  const top = placement.topPct / 100 * KENNEY_CANVAS.h;
  const scale = (placement.widthPct / 100 * KENNEY_CANVAS.w) / naturalWidth;
  return {
    x: left + anchor.sourcePivotX * scale,
    y: top + anchor.sourcePivotY * scale,
  };
}

test('resolvePartAnchor uses the measured horn-base pivot', () => {
  const filename = 'detail_blue_horn_large.png';
  const pivot = HORN_PIVOTS[filename];
  const anchor = resolvePartAnchor('detail', `PNG/Default/${filename}`);

  assert.equal(anchor.anchorX, KENNEY_CANVAS.w / 2);
  assert.equal(anchor.anchorY, HORN_CONTACT_INSET_PX);
  assert.equal(anchor.sourcePivotX, pivot.pivot_x_frac * KENNEY_CANVAS.w);
  assert.equal(anchor.sourcePivotY, pivot.pivot_y_frac * KENNEY_CANVAS.h);
  assert.equal(anchor.maxWidthPx, pivot.width_frac * 1.05 * KENNEY_CANVAS.w);
});

test('unknown horn files preserve the legacy fallback anchor', () => {
  const anchor = resolvePartAnchor('detail', 'PNG/Default/detail_unknown_horn_large.png');

  assert.equal(anchor.anchorX, KENNEY_CANVAS.w / 2);
  assert.equal(anchor.anchorY, 10);
  assert.equal(anchor.maxScale, 0.85);
  assert.equal(anchor.maxWidthPx, 0.9 * KENNEY_CANVAS.w);
  assert.equal(anchor.sourcePivotX, undefined);
  assert.equal(anchor.sourcePivotY, undefined);
});

test('measured horn anchor follows a shifted body box', () => {
  const bodyBox = { x: 12, y: 23, w: 96, h: 120 };
  const anchor = resolvePartAnchor(
    'detail',
    'PNG/Default/detail_green_horn_small.png',
    bodyBox,
  );

  assert.equal(anchor.anchorX, bodyBox.x + bodyBox.w / 2);
  assert.equal(anchor.anchorY, bodyBox.y + HORN_CONTACT_INSET_PX);
  assert.equal(
    anchor.maxWidthPx,
    HORN_PIVOTS['detail_green_horn_small.png'].width_frac * 1.05 * bodyBox.w,
  );
});

test('all 90 body, color, and horn variants stay within 5px contact tolerance', () => {
  let combinations = 0;

  for (const shape of SHAPES) {
    for (const color of COLORS) {
      const bodyFile = `body_${color}${shape}.png`;
      const body = readPng(bodyFile);
      const bodyBox = bodyBoxFromFile(`PNG/Default/${bodyFile}`);

      for (const variant of VARIANTS) {
        combinations += 1;
        if (variant === 'none') continue;

        const hornFile = `detail_${color}_horn_${variant}.png`;
        const horn = readPng(hornFile);
        const anchor = resolvePartAnchor('detail', `PNG/Default/${hornFile}`, bodyBox);
        const placed = computeAnchoredPlacement(horn.width, horn.height, anchor);
        const hornPivot = transformedPivot(anchor, placed, horn.width);
        const bodyTop = bodyTopAtCanvasX(body, bodyBox, hornPivot.x);
        const delta = Math.abs(hornPivot.y - bodyTop);

        assert.ok(
          delta < 5,
          `${shape} + ${color} ${variant}: horn/body delta ${delta.toFixed(2)}px`,
        );
      }
    }
  }

  assert.equal(combinations, 90);
});
