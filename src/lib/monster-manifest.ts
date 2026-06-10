import manifest from '../data/monster-parts.json';

export const MONSTER_MANIFEST = manifest as Record<
  'body' | 'eyes' | 'mouth' | 'arms' | 'detail',
  Array<{ id: string; file: string }>
>;

export const MONSTER_SLOTS = ['body', 'eyes', 'mouth', 'arms', 'detail'] as const;

export const MONSTER_COLORS = ['mint', 'coral', 'sky', 'lemon', 'grape'] as const;

export type MonsterSlot = (typeof MONSTER_SLOTS)[number];
export type MonsterColor = (typeof MONSTER_COLORS)[number];
