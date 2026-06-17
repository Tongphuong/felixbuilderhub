/** Accept V2 lesson packs. V2.1 packs from the rolled-back wave may still
 * exist in KV — recognize them as V2 so admin/progress code doesn't 404,
 * but the lesson dispatcher will treat them as V2.0 for rendering (V2.1 UI
 * is gone until the rework wave lands behind PUBLIC_R2L_V21). */
export function isV2PackSchemaVersion(version) {
  if (version === 2) return true;
  const normalized = String(version ?? '').trim();
  return normalized === '2' || normalized === '2.0' || normalized === '2.1';
}

export function packHasV2Schema(pack) {
  if (!pack || typeof pack !== 'object') return false;
  const versions = [
    pack.schema_version,
    pack.review_context?.schema_version,
    pack.pack?.schema_version,
    pack.pack_json?.schema_version,
    pack.result?.pack?.schema_version,
  ];
  return versions.some(isV2PackSchemaVersion);
}

/** Lesson API payload: preserves "2.1" when the pack carries it so the
 * hub-side maintenance gate (PUBLIC_R2L_V21 off → maintenance screen) can
 * actually trigger. V2.0 packs and unknown strings collapse to numeric 2. */
export function lessonSchemaVersionFromPack(v2Pack) {
  if (String(v2Pack?.schema_version ?? '') === '2.1') return '2.1';
  return 2;
}
