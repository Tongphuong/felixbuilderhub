/** Existing R2 handlers still select/validate their own keys and permissions.
 * Uploads happen outside SQL; deletions wait until its commit has succeeded.
 * A crash/cleanup failure can leave an unreferenced object, never justify
 * deleting a previous object before the account record is durable.
 */
export function accountMediaEffects({ db, bucket }) {
  const uploaded = new Set(), deleted = new Set();
  let closed = false;
  const key = value => {
    if (closed || typeof value !== 'string' || !value || !value.isWellFormed()) throw Error('invalid_account_media_operation');
    return value;
  };
  const referenced = value => {
    const needle = JSON.stringify(value).slice(1, -1);
    for (const row of db.prepare('SELECT value FROM read2lead_account_kv').all()) {
      let text = row.value;
      try { text = JSON.stringify(JSON.parse(text)); } catch { /* Preserve raw legacy values too. */ }
      if (text.includes(needle) || text.includes(value)) return true;
    }
    return false;
  };
  const media = Object.freeze({
    get(value, ...options) { return bucket.get(key(value), ...options); },
    async put(value, ...options) {
      value = key(value);
      // All admitted upload handlers generate a fresh object key. Refuse an
      // unexpected overwrite; compensation must never remove saved media.
      if (referenced(value)) throw Error('account_media_key_already_referenced');
      const result = await bucket.put(value, ...options);
      uploaded.add(value);
      return result;
    },
    async delete(values) {
      for (const value of Array.isArray(values) ? values : [values]) deleted.add(key(value));
    },
  });
  return { media, async finish(committed) {
    if (closed) throw Error('account_media_effects_already_finished');
    closed = true;
    const failures = [];
    for (const value of committed ? deleted : uploaded) {
      // Keep a file if another retained account/history record still uses it.
      // A false positive only retains bytes; it cannot lose somebody's file.
      if (referenced(value)) continue;
      try { await bucket.delete(value); } catch { failures.push(value); }
    }
    return { cleanupFailed: failures.length > 0 };
  } };
}
