import { isV2PackSchemaVersion } from './_read2lead-pack-schema.js';

export function extractV2Pack(pack) {
  const candidates = [
    pack?.review_context,
    pack?.pack,
    pack?.pack_json,
    pack?.result?.pack,
    pack,
  ];

  return candidates.find(
    (candidate) =>
      candidate &&
      isV2PackSchemaVersion(candidate.schema_version) &&
      candidate.story &&
      Array.isArray(candidate.activities),
  );
}
