#!/usr/bin/env node
/**
 * Scan public/assets/monsters/raw/ and regenerate the browser manifest plus
 * alpha-derived body sockets, arm pivots, and contact QA data.
 * Run: node scripts/gen-monster-parts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'public', 'assets', 'monsters', 'raw');
const OUT_JSON = path.join(ROOT, 'public', 'assets', 'monsters', 'monster-parts.json');
const OUT_QA_JSON = path.join(ROOT, 'public', 'assets', 'monsters', 'monster-geom-qa.json');

const SLOTS = ['body', 'eyes', 'mouth', 'arms', 'detail'];
const CANVAS = { w: 165, h: 165 };
const ARM_HEIGHT_FRACTION = 0.62;
const ARM_INSET_FRACTION = 0.06;
const SHOULDER_Y_FRACTION = 0.58;

export function classifyMonsterSlot(filename) {
  const base = path.basename(filename).toLowerCase();
  if (base.startsWith('body_')) return 'body';
  if (base.startsWith('eye_') || base.startsWith('eyes_')) return 'eyes';
  if (base.startsWith('mouth_') || /^mouth[a-z0-9]/i.test(base)) return 'mouth';
  if (base.startsWith('arm_') || base.startsWith('arms_')) return 'arms';
  if (base.startsWith('detail_')) return 'detail';
  return 'detail';
}

export function shouldSkipMonsterPng(filename) {
  const base = path.basename(filename).toLowerCase();
  if (base.includes('spritesheet')) return true;
  if (base === 'preview.png' || base === 'sample.png') return true;
  return false;
}

/** Kenney Default = 165x165 single monster; Double = 330x330 two-up. */
export function shouldIncludeMonsterAsset(relativePath, filename) {
  const norm = String(relativePath || '').replace(/\\/g, '/');
  if (!norm.startsWith('PNG/Default/')) return false;
  if (shouldSkipMonsterPng(filename)) return false;
  const base = path.basename(filename).toLowerCase();
  if (base.startsWith('leg_')) return false;
  return true;
}

export function makeMonsterPartId(relativePath) {
  return relativePath
    .replace(/\.png$/i, '')
    .replace(/[\\/]/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function readPng(filename) {
  return PNG.sync.read(fs.readFileSync(filename));
}

function isOpaque(png, x, y) {
  return png.data[(y * png.width + x) * 4 + 3] > 0;
}

function opaqueBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (!isOpaque(png, x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

export function measureBodyGeometry(png) {
  const bounds = opaqueBounds(png);
  const opaqueHeight = bounds.maxY - bounds.minY + 1;
  const y = bounds.minY + Math.round((opaqueHeight - 1) * SHOULDER_Y_FRACTION);
  const row = [];
  for (let x = 0; x < png.width; x += 1) {
    if (isOpaque(png, x, y)) row.push(x);
  }
  if (row.length === 0) {
    throw new Error(`Body has no opaque pixels at shoulder row y=${y}`);
  }
  return {
    geom: { w: png.width, h: png.height },
    sockets: {
      armLeft: { x: row[0], y },
      armRight: { x: row[row.length - 1], y },
    },
  };
}

function edgeRun(png, x) {
  let minY = png.height;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < png.height; y += 1) {
    if (!isOpaque(png, x, y)) continue;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    count += 1;
  }
  return { minY, maxY, count, span: maxY >= minY ? maxY - minY + 1 : 0 };
}

export function measureArmGeometry(png) {
  const bounds = opaqueBounds(png);
  const leftRun = edgeRun(png, bounds.minX);
  const rightRun = edgeRun(png, bounds.maxX);
  const attach = leftRun.span > rightRun.span ? 'left' : 'right';
  const x = attach === 'left' ? bounds.minX : bounds.maxX;
  const run = attach === 'left' ? leftRun : rightRun;
  return {
    w: png.width,
    h: png.height,
    pivotX: x,
    pivotY: (run.minY + run.maxY) / 2,
    attach,
  };
}

export function computeArmPairPlacements(body, arm, canvas = CANVAS) {
  const bodyScale = Math.min(canvas.w / body.geom.w, canvas.h / body.geom.h);
  const bodyBox = {
    x: (canvas.w - body.geom.w * bodyScale) / 2,
    y: (canvas.h - body.geom.h * bodyScale) / 2,
    w: body.geom.w * bodyScale,
    h: body.geom.h * bodyScale,
  };
  const armScale = ARM_HEIGHT_FRACTION * bodyBox.h / arm.h;
  const inset = ARM_INSET_FRACTION * bodyBox.w;
  const socket = (side) => {
    const point = body.sockets[side === 'left' ? 'armLeft' : 'armRight'];
    return {
      x: bodyBox.x + point.x * bodyScale + (side === 'left' ? inset : -inset),
      y: bodyBox.y + point.y * bodyScale,
    };
  };
  const leftFlip = arm.attach === 'left';
  const leftPivotX = leftFlip ? arm.w - arm.pivotX : arm.pivotX;
  const rightFlip = !leftFlip;
  const rightPivotX = arm.w - leftPivotX;
  const make = (side, flip, pivotX) => {
    const target = socket(side);
    return {
      x: target.x - pivotX * armScale,
      y: target.y - arm.pivotY * armScale,
      w: arm.w * armScale,
      h: arm.h * armScale,
      scale: armScale,
      flip,
      target,
    };
  };
  return {
    bodyBox,
    left: make('left', leftFlip, leftPivotX),
    right: make('right', rightFlip, rightPivotX),
  };
}

function addGeometry(entry, fullPath, slot) {
  const png = readPng(fullPath);
  if (slot === 'body') {
    Object.assign(entry, measureBodyGeometry(png));
  } else if (slot === 'arms') {
    entry.geom = measureArmGeometry(png);
  }
  return png;
}

export function buildMonsterManifestFromRaw(rawDir = RAW_DIR) {
  const manifest = Object.fromEntries(SLOTS.map((slot) => [slot, []]));
  const seenIds = new Set();

  if (!fs.existsSync(rawDir)) {
    return { manifest, counts: Object.fromEntries(SLOTS.map((s) => [s, 0])), total: 0 };
  }

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;

      const relative = path.relative(rawDir, full).split(path.sep).join('/');
      if (!shouldIncludeMonsterAsset(relative, entry.name)) continue;
      const slot = classifyMonsterSlot(entry.name);
      let id = makeMonsterPartId(relative);
      if (seenIds.has(id)) id = `${id}-${manifest[slot].length}`;
      seenIds.add(id);
      const part = { id, file: relative };
      addGeometry(part, full, slot);
      manifest[slot].push(part);
    }
  };

  walk(rawDir);
  for (const slot of SLOTS) manifest[slot].sort((a, b) => a.id.localeCompare(b.id));

  const counts = Object.fromEntries(SLOTS.map((slot) => [slot, manifest[slot].length]));
  const total = SLOTS.reduce((sum, slot) => sum + counts[slot], 0);
  return { manifest, counts, total };
}

function renderedOpaquePixels(png, placement, flip = false) {
  const pixels = new Set();
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (!isOpaque(png, x, y)) continue;
      const sourceX = flip ? png.width - 1 - x : x;
      const px = Math.round(placement.x + sourceX * placement.scale);
      const py = Math.round(placement.y + y * placement.scale);
      pixels.add(`${px},${py}`);
    }
  }
  return pixels;
}

function bodyOpaquePixels(png, bodyBox) {
  return renderedOpaquePixels(png, {
    x: bodyBox.x,
    y: bodyBox.y,
    scale: bodyBox.w / png.width,
  });
}

function contactMetrics(bodyPixels, armPixels) {
  const overlap = [];
  for (const pixel of armPixels) {
    if (!bodyPixels.has(pixel)) continue;
    overlap.push(pixel.split(',').map(Number));
  }
  if (overlap.length === 0) return { contact: false, overlapW: 0, overlapH: 0, overlapPixels: 0 };
  const xs = overlap.map(([x]) => x);
  const ys = overlap.map(([, y]) => y);
  const overlapW = Math.max(...xs) - Math.min(...xs) + 1;
  const overlapH = Math.max(...ys) - Math.min(...ys) + 1;
  return {
    contact: overlapW >= 4 && overlapH >= 4,
    overlapW,
    overlapH,
    overlapPixels: overlap.length,
  };
}

export function buildGeometryQa(manifest, rawDir = RAW_DIR) {
  const rows = [];
  const byVariant = (parts, pattern) => {
    const variants = new Map();
    for (const part of parts) {
      const match = path.basename(part.file).match(pattern);
      if (match && !variants.has(match[1].toLowerCase())) variants.set(match[1].toLowerCase(), part);
    }
    return [...variants.values()];
  };
  const bodies = byVariant(manifest.body, /body_[a-z]+([a-f])\.png$/i);
  const arms = byVariant(manifest.arms, /arm_[a-z]+([a-e])\.png$/i);

  for (const body of bodies) {
    const bodyPng = readPng(path.join(rawDir, body.file));
    for (const arm of arms) {
      const armPng = readPng(path.join(rawDir, arm.file));
      const placements = computeArmPairPlacements(body, arm.geom);
      const bodyPixels = bodyOpaquePixels(bodyPng, placements.bodyBox);
      const left = contactMetrics(bodyPixels, renderedOpaquePixels(armPng, placements.left, placements.left.flip));
      const right = contactMetrics(bodyPixels, renderedOpaquePixels(armPng, placements.right, placements.right.flip));
      rows.push({
        bodyId: body.id,
        armId: arm.id,
        left: { ...placements.left, ...left },
        right: { ...placements.right, ...right },
        leftGap: left.overlapW,
        rightGap: right.overlapW,
        symmetric: Math.abs(left.overlapW - right.overlapW) <= 3,
      });
    }
  }
  return {
    constants: { canvas: CANVAS, armHeightFraction: ARM_HEIGHT_FRACTION, insetFraction: ARM_INSET_FRACTION },
    comboCount: rows.length,
    rows,
  };
}

function writeOutputs({ manifest, counts, total }) {
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const qa = buildGeometryQa(manifest);
  fs.writeFileSync(OUT_QA_JSON, `${JSON.stringify(qa, null, 2)}\n`, 'utf8');

  console.log('Monster manifest generated:');
  for (const slot of SLOTS) console.log(`  ${slot}: ${counts[slot]}`);
  console.log(`  total: ${total}`);
  console.log(`  arm contact combos: ${qa.comboCount}`);
  if (total === 0) console.log('  (empty - CSS fallback active until PNGs are in raw/)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeOutputs(buildMonsterManifestFromRaw());
}
