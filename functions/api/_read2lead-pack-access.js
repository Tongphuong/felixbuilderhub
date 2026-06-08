export function packIdInReviewHistory(codeData, packId) {
  const id = String(packId || '').trim();
  if (!id) return false;
  const history = Array.isArray(codeData?.progress?.review_history)
    ? codeData.progress.review_history
    : [];
  return history.some((entry) => String(entry?.pack_id || '').trim() === id);
}

export function resolveAccessiblePack(codeData, packId) {
  const id = String(packId || '').trim();
  if (!id) return null;
  const current = codeData?.progress?.current_pack;
  if (current?.pack_id === id) return current;
  if (packIdInReviewHistory(codeData, id) && current?.pack_id === id) return current;
  return null;
}

export function canAccessPackForPractice(codeData, packId) {
  const id = String(packId || '').trim();
  if (!id) return false;
  if (id === 'general') return true;
  const current = codeData?.progress?.current_pack;
  if (current?.pack_id === id) return true;
  return packIdInReviewHistory(codeData, id);
}
