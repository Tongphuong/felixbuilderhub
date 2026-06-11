import type { MonsterSlot } from './monster-manifest';

/** Kenney Default single-monster coordinate space (body_blueA = 165×165). */
export const KENNEY_CANVAS = { w: 165, h: 165 } as const;

export const CANVAS_CENTER = { x: 82, y: 82 } as const;

export type RegionAnchor = 'center' | 'topleft' | 'topcenter';

export type SlotRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** fill = scale body to region; fit = scale down only when part exceeds region */
  mode: 'fill' | 'fit';
  anchor?: RegionAnchor;
};

export type PartAnchor = {
  anchorX: number;
  anchorY: number;
  maxScale?: number;
  /** Shrink to fit canvas (arms C/D, tall bodies). */
  canvasFit?: boolean;
  /** Cap rendered width in canvas px (body-box-relative sizing). */
  maxWidthPx?: number;
};

/**
 * Natural dims of the 6 Kenney Default body shapes (A–F). Colors share dims.
 * Source of truth for body-box math — verified against PNG files 2026-06-11.
 */
export const BODY_SHAPE_DIMS: Record<string, { w: number; h: number }> = {
  a: { w: 165, h: 165 },
  b: { w: 192, h: 192 },
  c: { w: 141, h: 194 },
  d: { w: 174, h: 182 },
  e: { w: 132, h: 250 },
  f: { w: 170, h: 236 },
};

export type BodyBox = { x: number; y: number; w: number; h: number };

export function bodyShapeFromFile(bodyFile: string): string {
  const m = (bodyFile.split('/').pop() || '').toLowerCase().match(/body_[a-z]+([a-f])\.png$/);
  return m ? m[1] : 'a';
}

/** Rendered box of a body sprite after fill-fit + centering into the canvas. */
export function bodyBoxFromFile(bodyFile: string, canvas = KENNEY_CANVAS): BodyBox {
  const dims = BODY_SHAPE_DIMS[bodyShapeFromFile(bodyFile)] || BODY_SHAPE_DIMS.a;
  const scale = Math.min(canvas.w / dims.w, canvas.h / dims.h);
  const w = dims.w * scale;
  const h = dims.h * scale;
  return { x: (canvas.w - w) / 2, y: (canvas.h - h) / 2, w, h };
}

const FULL_CANVAS_BOX: BodyBox = { x: 0, y: 0, w: KENNEY_CANVAS.w, h: KENNEY_CANVAS.h };

export type PartPlacement = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

/** Body uses fill; face/detail use centroid anchors (PIL-tuned on body_blueA). */
export const MONSTER_SLOT_REGIONS: Record<MonsterSlot, SlotRegion> = {
  body: { x: 0, y: 0, w: 165, h: 165, mode: 'fill' },
  arms: { x: 0, y: 0, w: 165, h: 165, mode: 'fit', anchor: 'topleft' },
  detail: { x: 0, y: 0, w: 165, h: 165, mode: 'fit', anchor: 'topcenter' },
  eyes: { x: 46, y: 28, w: 74, h: 52, mode: 'fit' },
  mouth: { x: 42, y: 80, w: 82, h: 40, mode: 'fit' },
};

/** Single-side arm A/B/E: mirror for right limb. */
export const ARM_SINGLE_ANCHORS = {
  left: { anchorX: 28, anchorY: 88, maxScale: 0.94 } satisfies PartAnchor,
  right: { anchorX: 137, anchorY: 88, maxScale: 0.94 } satisfies PartAnchor,
};

/** Wide C/D sprites already contain both arms. */
export const ARM_DUAL_ANCHOR: PartAnchor = {
  anchorX: CANVAS_CENTER.x,
  anchorY: 90,
  canvasFit: true,
};

function partBasename(partFile: string): string {
  return partFile.split('/').pop()?.toLowerCase() || '';
}

/** Kenney C/D arm PNGs include both limbs; A/B/E are one side only. */
export function isDualArmSprite(partFile: string): boolean {
  return /arm_.+[cd]\.png$/i.test(partBasename(partFile));
}

/** @deprecated Region helper kept for body fill + legacy tests. */
export function armRegionFromFile(partFile: string): SlotRegion {
  if (isDualArmSprite(partFile)) {
    return { x: 0, y: 0, w: 165, h: 165, mode: 'fit', anchor: 'topcenter' };
  }
  return { x: 0, y: 0, w: 165, h: 165, mode: 'fit', anchor: 'topleft' };
}

/** @deprecated Use resolvePartAnchor for detail. */
export function detailRegionFromFile(partFile: string): SlotRegion {
  const base = partBasename(partFile);
  if (base.includes('ear')) {
    return { x: 0, y: 22, w: 52, h: 58, mode: 'fit', anchor: 'topleft' };
  }
  if (base.includes('horn') || base.includes('antenna')) {
    return { x: 44, y: 0, w: 78, h: 26, mode: 'fit', anchor: 'topcenter' };
  }
  if (base.startsWith('eyebrow')) {
    return { x: 38, y: 20, w: 90, h: 30, mode: 'fit', anchor: 'topcenter' };
  }
  if (base.startsWith('nose') || base.startsWith('snot')) {
    return { x: 44, y: 64, w: 78, h: 44, mode: 'fit', anchor: 'center' };
  }
  return MONSTER_SLOT_REGIONS.detail;
}

/** @deprecated Use resolvePartAnchor. */
export function resolvePartRegion(slot: MonsterSlot, partFile: string): SlotRegion {
  if (slot === 'arms') return armRegionFromFile(partFile);
  if (slot === 'detail') return detailRegionFromFile(partFile);
  return MONSTER_SLOT_REGIONS[slot];
}

/**
 * Anchor fractions are body-box-relative (exact conversions of the values
 * PIL-tuned on body_blueA, where the box equals the full 165 canvas — so
 * shape-A output is unchanged, while B–F now track their own body box).
 */
export function resolvePartAnchor(
  slot: MonsterSlot,
  partFile: string,
  bodyBox: BodyBox = FULL_CANVAS_BOX,
): PartAnchor {
  const box = bodyBox;
  const cx = box.x + box.w / 2;
  const at = (fx: number, fy: number, maxScale: number, widthFrac: number): PartAnchor => ({
    anchorX: box.x + fx * box.w,
    anchorY: box.y + fy * box.h,
    maxScale,
    maxWidthPx: widthFrac * box.w,
  });

  if (slot === 'eyes') return { anchorX: cx, anchorY: box.y + (52 / 165) * box.h, maxScale: 0.82, maxWidthPx: 0.8 * box.w };
  if (slot === 'mouth') return { anchorX: cx, anchorY: box.y + (96 / 165) * box.h, maxScale: 0.82, maxWidthPx: 0.84 * box.w };
  if (slot === 'arms') {
    return isDualArmSprite(partFile) ? armDualAnchor(box) : armSingleAnchors(box).left;
  }

  const base = partBasename(partFile);
  if (base.includes('ear')) return at(20 / 165, 56 / 165, 1, 0.42);
  if (base.includes('horn')) return at(0.5, 10 / 165, 0.85, 0.9);
  if (base.includes('antenna')) return at(0.5, 10 / 165, 1, 0.9);
  if (base.startsWith('eyebrow')) return at(0.5, 38 / 165, 0.9, 0.86);
  if (base.startsWith('nose') || base.startsWith('snot')) return at(0.5, 72 / 165, 0.9, 0.6);
  if (base.includes('detail_') && base.includes('_eye')) return at(0.5, 48 / 165, 0.85, 0.7);
  return at(0.5, 14 / 165, 1, 0.95);
}

/** Single-side arm anchors at the body's edges (mirror right). */
export function armSingleAnchors(bodyBox: BodyBox = FULL_CANVAS_BOX): { left: PartAnchor; right: PartAnchor } {
  const y = bodyBox.y + (88 / 165) * bodyBox.h;
  const maxWidthPx = 0.55 * bodyBox.w;
  return {
    left: { anchorX: bodyBox.x + (28 / 165) * bodyBox.w, anchorY: y, maxScale: 0.94, maxWidthPx },
    right: { anchorX: bodyBox.x + (137 / 165) * bodyBox.w, anchorY: y, maxScale: 0.94, maxWidthPx },
  };
}

/** C/D dual-arm sprite centered on the body, slightly wider than it. */
export function armDualAnchor(bodyBox: BodyBox = FULL_CANVAS_BOX): PartAnchor {
  return {
    anchorX: bodyBox.x + bodyBox.w / 2,
    anchorY: bodyBox.y + (90 / 165) * bodyBox.h,
    canvasFit: true,
    maxWidthPx: 1.15 * bodyBox.w,
  };
}

export function computeAnchoredPlacement(
  naturalW: number,
  naturalH: number,
  anchor: PartAnchor,
  canvas = KENNEY_CANVAS,
): PartPlacement {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  let scale = anchor.maxScale ?? 1;
  if (anchor.canvasFit) {
    scale = Math.min(scale, canvas.w / nw, canvas.h / nh);
  }
  if (anchor.maxWidthPx != null) {
    scale = Math.min(scale, anchor.maxWidthPx / nw);
  }
  const cx = nw / 2;
  const cy = nh / 2;
  const pw = nw * scale;
  const ph = nh * scale;
  const px = anchor.anchorX - cx * scale;
  const py = anchor.anchorY - cy * scale;

  return {
    leftPct: (px / canvas.w) * 100,
    topPct: (py / canvas.h) * 100,
    widthPct: (pw / canvas.w) * 100,
    heightPct: (ph / canvas.h) * 100,
  };
}

export function computePartPlacement(
  naturalW: number,
  naturalH: number,
  region: SlotRegion,
  canvas = KENNEY_CANVAS,
): PartPlacement {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const scale = region.mode === 'fill'
    ? Math.min(region.w / nw, region.h / nh)
    : Math.min(region.w / nw, region.h / nh, 1);
  const pw = nw * scale;
  const ph = nh * scale;
  const anchor = region.anchor ?? 'center';

  let px: number;
  let py: number;
  if (anchor === 'topleft') {
    px = region.x;
    py = region.y;
  } else if (anchor === 'topcenter') {
    px = region.x + (region.w - pw) / 2;
    py = region.y;
  } else {
    px = region.x + (region.w - pw) / 2;
    py = region.y + (region.h - ph) / 2;
  }

  return {
    leftPct: (px / canvas.w) * 100,
    topPct: (py / canvas.h) * 100,
    widthPct: (pw / canvas.w) * 100,
    heightPct: (ph / canvas.h) * 100,
  };
}
