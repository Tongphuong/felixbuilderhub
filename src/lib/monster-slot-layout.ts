import type { MonsterSlot } from './monster-manifest';

/** Kenney Default single-monster coordinate space (body_blueA = 165×165). */
export const KENNEY_CANVAS = { w: 165, h: 165 } as const;

export type SlotRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** fill = scale body to region; fit = center part in region, never upscale past native */
  mode: 'fill' | 'fit';
};

/** Placement boxes tuned on body_blueA + Default parts (PIL compose QA). */
export const MONSTER_SLOT_REGIONS: Record<MonsterSlot, SlotRegion> = {
  body: { x: 0, y: 0, w: 165, h: 165, mode: 'fill' },
  arms: { x: 0, y: 8, w: 88, h: 157, mode: 'fit' },
  detail: { x: 30, y: 0, w: 105, h: 55, mode: 'fit' },
  eyes: { x: 46, y: 28, w: 74, h: 52, mode: 'fit' },
  mouth: { x: 42, y: 80, w: 82, h: 40, mode: 'fit' },
};

export type PartPlacement = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

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
  const px = region.x + (region.w - pw) / 2;
  const py = region.y + (region.h - ph) / 2;
  return {
    leftPct: (px / canvas.w) * 100,
    topPct: (py / canvas.h) * 100,
    widthPct: (pw / canvas.w) * 100,
    heightPct: (ph / canvas.h) * 100,
  };
}
