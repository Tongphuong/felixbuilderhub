import { StorySqlStore } from './story-store.mjs';
import { connectStoryProfileRewards } from './story-profile.mjs';

/** Shared SQL host building block, not an HTTP route or migration.
 * Initialize the account service on this SAME db/transaction first. The host
 * remains responsible for authentication, reviewed publisher packages and
 * calibrated server assessment. No browser-supplied reward is accepted here.
 */
export function createAccountStoryStore({ db, transaction, now = () => Date.now(), uuid, progressInCodes = false }) {
  if (!db?.prepare || typeof transaction !== 'function') throw Error('account_storage_required');
  const revision = () => db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get()?.revision;
  if (!Number.isSafeInteger(revision())) throw Error('account_storage_not_initialized');
  // Fail before creating story tables if the account schema is unavailable.
  db.prepare('SELECT namespace,key,value,expires,metadata FROM read2lead_account_kv LIMIT 0').all();
  let active = false, changed = false;
  const store = new StorySqlStore(db, { now, uuid, transaction: work => {
    if (active) throw Error('account_story_nested_transaction');
    try {
      return transaction(() => {
        active = true; changed = false;
        const result = work();
        if (result?.then) throw Error('account_story_sync_transaction_required');
        if (changed) {
          const next = revision() + 1;
          if (!Number.isSafeInteger(next)) throw Error('account_revision_limit');
          db.prepare('UPDATE read2lead_account_revision SET revision=? WHERE id=1').run(next);
        }
        return result;
      });
    } finally { active = false; changed = false; }
  } });
  const namespace = key => key.startsWith('progress:') && !progressInCodes ? 'progress' : 'codes';
  connectStoryProfileRewards(store, {
    get(key) {
      if (!active) throw Error('account_story_transaction_required');
      const row = db.prepare('SELECT value,expires FROM read2lead_account_kv WHERE namespace=? AND key=?').get(namespace(key), key);
      return row && (row.expires === null || row.expires > now()) ? JSON.parse(row.value) : null;
    },
    put(key, value) {
      if (!active) throw Error('account_story_transaction_required');
      // Preserve existing expiry/metadata; story progress does not renew access.
      db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value')
        .run(namespace(key), key, JSON.stringify(value));
      changed = true;
    },
    assertAccount(account) {
      if (!account?.student_profile || typeof account.student_profile !== 'object') throw Error('story_account_required');
    },
    assertPack(pack, account) {
      if (pack.schema_version !== 'story-mission-v1' || (pack.private_draft !== false && account.is_test !== true)) throw Error('story_account_assignment_unavailable');
    },
  });
  return store;
}
