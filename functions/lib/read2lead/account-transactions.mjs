/** Transaction boundary for existing account handlers, not a public route.
 * The host supplies SQLite + a synchronous atomic transaction (DO transactionSync).
 * All participating readers/writers must use the same authoritative store/host.
 * This module does not migrate KV, authenticate requests, or enable real accounts.
 * External side effects/background jobs cannot be rolled back by this boundary.
 */
export function createAccountTransactionRunner({ db, transaction, now = () => Date.now(), progressInCodes = false }) {
  if (!db?.prepare || !db?.exec || typeof transaction !== 'function') throw Error('account_storage_required');
  db.exec(`CREATE TABLE IF NOT EXISTS read2lead_account_kv (
    namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    expires INTEGER, metadata TEXT, PRIMARY KEY(namespace,key));
    CREATE TABLE IF NOT EXISTS read2lead_account_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO read2lead_account_revision VALUES(1,0);`);
  const revision = () => db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get().revision;
  let tail = Promise.resolve();
  const unavailable = () => Response.json({ ok: false, error: 'account_transaction_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

  async function execute(work, { allowErrorResponse } = {}) {
    let active = true, storageFailed = false;
    const pending = new Map();
    const started = now(), originalRevision = revision();
    const access = fn => {
      if (!active) throw Error('account_transaction_closed');
      try { return fn(); } catch (error) { storageFailed = true; throw error; }
    };
    const keyOf = key => {
      if (typeof key !== 'string' || !key || new TextEncoder().encode(key).length > 512) throw Error('invalid_account_key');
      return key;
    };
    const identity = (namespace, key) => JSON.stringify([namespace, key]);
    const present = row => row && (row.expires === null || row.expires > started);
    function namespaceStore(namespace) {
      function read(key) {
        keyOf(key);
        const id = identity(namespace, key);
        const row = pending.has(id) ? pending.get(id).row : db.prepare('SELECT value,expires,metadata FROM read2lead_account_kv WHERE namespace=? AND key=?').get(namespace, key);
        return present(row) ? row : null;
      }
      function decode(row, options) {
        if (!row) return null;
        const type = typeof options === 'string' ? options : options?.type || 'text';
        if (type === 'json') return JSON.parse(row.value);
        if (type === 'text') return row.value;
        if (type === 'arrayBuffer') return new TextEncoder().encode(row.value).buffer;
        if (type === 'stream') return new Blob([row.value]).stream();
        throw Error('unsupported_account_value_type');
      }
      return {
        async get(key, options) { return access(() => decode(read(key), options)); },
        async getWithMetadata(key, options) { return access(() => {
          const row = read(key);
          return { value: decode(row, options), metadata: row?.metadata ? JSON.parse(row.metadata) : null };
        }); },
        async put(key, value, options = {}) { return access(() => {
          keyOf(key);
          // These existing account/config handlers persist strings. Reject other
          // forms explicitly rather than silently corrupting bytes or streams.
          if (typeof value !== 'string') throw Error('account_string_value_required');
          let expires = null;
          if (options.expiration !== undefined && options.expirationTtl !== undefined) throw Error('invalid_account_expiration');
          if (options.expirationTtl !== undefined) {
            if (!Number.isSafeInteger(options.expirationTtl) || options.expirationTtl <= 0) throw Error('invalid_account_expiration');
            expires = started + options.expirationTtl * 1000;
          } else if (options.expiration !== undefined) {
            if (!Number.isSafeInteger(options.expiration) || options.expiration * 1000 <= started) throw Error('invalid_account_expiration');
            expires = options.expiration * 1000;
          }
          if (expires !== null && !Number.isSafeInteger(expires)) throw Error('invalid_account_expiration');
          const metadata = options.metadata === undefined ? null : JSON.stringify(options.metadata);
          if (metadata === undefined) throw Error('invalid_account_metadata');
          pending.set(identity(namespace, key), { namespace, key, row: { value, expires, metadata } });
        }); },
        async delete(key) { return access(() => {
          keyOf(key); pending.set(identity(namespace, key), { namespace, key, row: null });
        }); },
        async list({ prefix = '', limit = 1000, cursor = '' } = {}) { return access(() => {
          if (typeof prefix !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error('invalid_account_list');
          let after = '';
          if (cursor) {
            const parts = JSON.parse(decodeURIComponent(cursor));
            if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== namespace || parts[1] !== prefix || typeof parts[2] !== 'string') throw Error('invalid_account_cursor');
            after = parts[2];
          }
          const rows = db.prepare('SELECT key,value,expires,metadata FROM read2lead_account_kv WHERE namespace=? AND substr(key,1,length(?))=? AND key>? AND (expires IS NULL OR expires>?) ORDER BY key LIMIT ?').all(namespace, prefix, prefix, after, started, limit + pending.size + 1);
          const visible = new Map(rows.map(row => [row.key, row]));
          for (const change of pending.values()) {
            if (change.namespace !== namespace || !change.key.startsWith(prefix) || compareKeys(change.key, after) <= 0) continue;
            if (present(change.row)) visible.set(change.key, { key: change.key, ...change.row });
            else visible.delete(change.key);
          }
          const ordered = [...visible.values()].sort((a, b) => compareKeys(a.key, b.key)), more = ordered.length > limit;
          const keys = ordered.slice(0, limit).map(row => ({ name: row.key,
            ...(row.expires === null ? {} : { expiration: Math.floor(row.expires / 1000) }),
            ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) }),
          }));
          return { keys, list_complete: !more, cursor: more ? encodeURIComponent(JSON.stringify([namespace, prefix, keys.at(-1).name])) : '' };
        }); },
      };
    }
    const codes = namespaceStore('codes');
    const env = { READ2LEAD_CODES: codes, READ2LEAD_PROGRESS: progressInCodes ? codes : namespaceStore('progress') };
    try {
      const response = await work(env);
      active = false;
      if (!(response instanceof Response) || storageFailed) return unavailable();
      // Existing 4xx anti-abuse writes remain intentional. A caught storage or
      // business failure returning 5xx must not commit an earlier partial write.
      // A host may explicitly identify an intentional error response after a
      // successful cleanup (e.g. clearing a failed generation lock). Storage
      // errors above and thrown/failed commits below still always roll back.
      if (response.status >= 500 && !(typeof allowErrorResponse === 'function' && allowErrorResponse(response) === true)) return response;
      const committed = transaction(() => {
        if (revision() !== originalRevision) return false;
        for (const { namespace, key, row } of pending.values()) {
          if (row === null) db.prepare('DELETE FROM read2lead_account_kv WHERE namespace=? AND key=?').run(namespace, key);
          else db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,expires=excluded.expires,metadata=excluded.metadata').run(namespace, key, row.value, row.expires, row.metadata);
        }
        if (pending.size) {
          if (!Number.isSafeInteger(originalRevision + 1)) throw Error('account_revision_limit');
          db.prepare('UPDATE read2lead_account_revision SET revision=? WHERE id=1').run(originalRevision + 1);
        }
        return true;
      });
      if (!committed) return Response.json({ ok: false, error: 'account_changed_retry' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      return response;
    } catch { return unavailable(); }
    finally { active = false; }
  }
  return (work, options) => {
    const result = tail.then(() => execute(work, options));
    tail = result.catch(() => {});
    return result;
  };
}

// Match SQLite's UTF-8 BINARY order, including supplementary Unicode keys.
function compareKeys(a, b) {
  const enc = new TextEncoder(), left = enc.encode(a), right = enc.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
