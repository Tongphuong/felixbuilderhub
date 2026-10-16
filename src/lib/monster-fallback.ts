/**
 * Pure decision: must the whole monster fall back to the generic blob?
 *
 * Only when it cannot be drawn at all: body/eyes/mouth/arms missing, 'default'
 * or unknown to the manifest. `detail` (and effects/frame/hat/pet/wings) are
 * OPTIONAL: '' means "none" (a legitimate companion choice) and an unknown id
 * only skips that one layer. Kept import-free so tests can run it directly.
 */
export const REQUIRED_MONSTER_SLOTS = ['body', 'eyes', 'mouth', 'arms'] as const;

export function needsFallbackMonster(
  config: Record<string, string | undefined>,
  hasPart: (slot: string, partId: string) => boolean,
  manifestAvailable = true,
): boolean {
  if (!manifestAvailable) return true;
  return REQUIRED_MONSTER_SLOTS.some((slot) => {
    const id = config[slot];
    return !id || id === 'default' || !hasPart(slot, id);
  });
}
