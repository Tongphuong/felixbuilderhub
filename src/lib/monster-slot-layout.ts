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
};

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

const FACE_ANCHORS = {
  eyes: { anchorX: 82, anchorY: 52, maxScale: 0.82 } satisfies PartAnchor,
  mouth: { anchorX: 82, anchorY: 96, maxScale: 0.82 } satisfies PartAnchor,
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

export function resolvePartAnchor(slot: MonsterSlot, partFile: string): PartAnchor {
  if (slot === 'eyes') return FACE_ANCHORS.eyes;
  if (slot === 'mouth') return FACE_ANCHORS.mouth;
  if (slot === 'arms') {
    return isDualArmSprite(partFile) ? ARM_DUAL_ANCHOR : ARM_SINGLE_ANCHORS.left;
  }

  const base = partBasename(partFile);
  if (base.includes('ear')) {
    return { anchorX: 20, anchorY: 56, maxScale: 1 };
  }
  if (base.includes('horn')) {
    return { anchorX: 82, anchorY: 10, maxScale: 0.85 };
  }
  if (base.includes('antenna')) {
    return { anchorX: 82, anchorY: 10, maxScale: 1 };
  }
  if (base.startsWith('eyebrow')) {
    return { anchorX: 82, anchorY: 38, maxScale: 0.9 };
  }
  if (base.startsWith('nose') || base.startsWith('snot')) {
    return { anchorX: 82, anchorY: 72, maxScale: 0.9 };
  }
  if (base.includes('detail_') && base.includes('_eye')) {
    return { anchorX: 82, anchorY: 48, maxScale: 0.85 };
  }
  return { anchorX: 82, anchorY: 14, maxScale: 1 };
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
