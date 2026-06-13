import manifest from '../../public/assets/monsters/monster-parts.json' with { type: 'json' };

export type PartRarity = 'common' | 'rare' | 'epic';

let partIndex: Map<string, PartRarity> | null = null;

function manifestSlotArrays(source: Record<string, unknown>): unknown[][] {
  const root = source?.parts && typeof source.parts === 'object'
    ? (source.parts as Record<string, unknown>)
    : source;
  const out: unknown[][] = [];
  for (const value of Object.values(root || {})) {
    if (Array.isArray(value)) out.push(value);
  }
  return out;
}

function buildIndex(): Map<string, PartRarity> {
  if (partIndex) return partIndex;
  partIndex = new Map();
  for (const slotEntries of manifestSlotArrays(manifest as Record<string, unknown>)) {
    for (const entry of slotEntries) {
      const part = entry as { id?: string; rarity?: PartRarity };
      if (part?.id) partIndex.set(part.id, part.rarity || 'common');
    }
  }
  return partIndex;
}

export function getPartRarity(partId: string): PartRarity {
  return buildIndex().get(partId) || 'common';
}

export function isPartUnlocked(state: { unlocked_parts?: string[] }, partId: string): boolean {
  if (getPartRarity(partId) === 'common') return true;
  return Array.isArray(state.unlocked_parts) && state.unlocked_parts.includes(partId);
}

export function listPartsByRarity(rarity: PartRarity): string[] {
  const out: string[] = [];
  for (const [id, r] of buildIndex().entries()) {
    if (r === rarity) out.push(id);
  }
  return out;
}
