import type { MonsterSlot } from './monster-manifest';

/** Kenney Default single-monster coordinate space (body_blueA = 165×165). */
export const KENNEY_CANVAS = { w: 165, h: 165 } as const;

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

/** Placement boxes for face slots (eyes/mouth). */
export const MONSTER_SLOT_REGIONS: Record<MonsterSlot, SlotRegion> = {
  body: { x: 0, y: 0, w: 165, h: 165, mode: 'fill' },
  arms: { x: 2, y: 16, w: 50, h: 148, mode: 'fit', anchor: 'topleft' },
  detail: { x: 0, y: 0, w: 165, h: 50, mode: 'fit', anchor: 'topcenter' },
  eyes: { x: 46, y: 28, w: 74, h: 52, mode: 'fit' },
  mouth: { x: 42, y: 80, w: 82, h: 40, mode: 'fit' },
};

export type PartPlacement = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

function partBasename(partFile: string): string {
  return partFile.split('/').pop()?.toLowerCase() || '';
}

/**
 * Kenney arm PNGs include transparent padding for a 165×165 canvas — place on full
 * canvas at native scale (fit, no upscale), not in a narrow side box.
 */
export function armRegionFromFile(partFile: string): SlotRegion {
  const base = partBasename(partFile);
  const canvasArm: SlotRegion = { x: 0, y: 0, w: 165, h: 165, mode: 'fit', anchor: 'topleft' };
  if (/arm_.+[cd]\.png$/i.test(base)) {
    return { ...canvasArm, anchor: 'topcenter' };
  }
  return canvasArm;
}

/** Detail slot mixes horns, ears, brows, noses — anchor per family. */
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
  if (base.includes('detail_') && base.includes('_eye')) {
    return { x: 50, y: 14, w: 65, h: 40, mode: 'fit', anchor: 'center' };
  }
  return MONSTER_SLOT_REGIONS.detail;
}

export function resolvePartRegion(slot: MonsterSlot, partFile: string): SlotRegion {
  if (slot === 'arms') return armRegionFromFile(partFile);
  if (slot === 'detail') return detailRegionFromFile(partFile);
  return MONSTER_SLOT_REGIONS[slot];
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
