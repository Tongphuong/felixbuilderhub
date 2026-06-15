// @ts-nocheck -- kept as plain JavaScript so Astro can inject this tested helper inline.
export function hasDictationProgress(slots) {
  return Array.isArray(slots) && slots.some((value) => Number.isInteger(value));
}

export function canUseDictationItem({ hasAudio, heard, hasProgress = false }) {
  return !hasAudio || Boolean(heard) || Boolean(hasProgress);
}

export function firstEmptyDictationSlot(slots) {
  if (!Array.isArray(slots)) return -1;
  return slots.findIndex((value) => value == null);
}

export function normalizeDictationHeard(value, itemCount) {
  if (!Array.isArray(value)) return [];
  const limit = Math.max(0, Number(itemCount) || 0);
  return Array.from(new Set(
    value
      .map((itemIndex) => Number(itemIndex))
      .filter((itemIndex) => Number.isInteger(itemIndex) && itemIndex >= 0 && itemIndex < limit),
  ));
}
