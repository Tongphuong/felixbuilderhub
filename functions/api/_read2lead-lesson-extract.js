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
      candidate.schema_version === 2 &&
      candidate.story &&
      Array.isArray(candidate.activities),
  );
}
