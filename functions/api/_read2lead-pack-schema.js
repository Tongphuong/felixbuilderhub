/** Accept V2 lesson packs: integer 2, string "2", "2.0", and V2.1 web flow "2.1". */
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

/** Lesson API payload: preserve 2.1 for V2.1 activity labels; otherwise numeric 2. */
export function lessonSchemaVersionFromPack(v2Pack) {
  const raw = v2Pack?.schema_version;
  if (String(raw) === '2.1') return '2.1';
  return 2;
}
