/** Trusted-host initialization, not an HTTP endpoint or a live KV exporter.
 * Requires the current account schema and synchronous atomic transaction.
 * A digest proves the supplied inventory only, NOT source consistency,
 * completeness, ownership, authorization, writer fencing or safe cutover.
 * Values/metadata are raw strings; expires is absolute Unix milliseconds.
 */
import {accountJsonDigest} from './account-json-stream.mjs';

const FORMAT = 'read2lead-account-snapshot-v1';
const encoder = new TextEncoder();
const fail = code => { throw Error(code); };
const validText = value => typeof value === 'string' && value.isWellFormed();
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const order = (a, b) => {
  const x = encoder.encode(a), y = encoder.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
function inventory(input) {
  if (!exactKeys(input, ['sourceId', 'progressInCodes', 'records']) || !validText(input.sourceId)
      || !input.sourceId || input.sourceId.length > 512 || typeof input.progressInCodes !== 'boolean'
      || !Array.isArray(input.records) || !input.records.length) fail('invalid_account_snapshot');
  const seen = new Set();
  const records = input.records.map(row => {
    if (!exactKeys(row, ['namespace', 'key', 'value', 'expires', 'metadata'])
        || !['codes', 'progress'].includes(row.namespace)
        || (input.progressInCodes && row.namespace === 'progress')
        || !validText(row.key) || !row.key || encoder.encode(row.key).length > 512
        || !validText(row.value) || !(row.metadata === null || validText(row.metadata))
        || !(row.expires === null || (Number.isSafeInteger(row.expires) && row.expires > 0))) fail('invalid_account_snapshot_row');
    if (row.metadata !== null) {
      try { JSON.parse(row.metadata); } catch { fail('invalid_account_snapshot_metadata'); }
    }
    const id = JSON.stringify([row.namespace, row.key]);
    if (seen.has(id)) fail('duplicate_account_snapshot_key');
    seen.add(id);
    return { namespace: row.namespace, key: row.key, value: row.value, expires: row.expires, metadata: row.metadata };
  }).sort((a, b) => order(a.namespace, b.namespace) || order(a.key, b.key));
  return { format: FORMAT, sourceId: input.sourceId, progressInCodes: input.progressInCodes, records };
}
async function digest(body) {
  return accountJsonDigest(body);
}
export async function prepareAccountSnapshot(input) {
  // Copy before the asynchronous hash so the caller cannot change hashed rows.
  const body = inventory(input);
  return { ...body, sha256: await digest(body) };
}
export async function importAccountSnapshot({ db, transaction, snapshot, expectedSha256, progressInCodes }) {
  if (!db?.prepare || !db?.exec || typeof transaction !== 'function') fail('account_storage_required');
  if (!exactKeys(snapshot, ['format', 'sourceId', 'progressInCodes', 'records', 'sha256'])
      || snapshot.format !== FORMAT || typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)
      || snapshot.sha256 !== expectedSha256 || typeof progressInCodes !== 'boolean'
      || progressInCodes !== snapshot.progressInCodes) fail('account_snapshot_pin_or_mode_mismatch');
  const body = inventory({ sourceId: snapshot.sourceId, progressInCodes: snapshot.progressInCodes, records: snapshot.records });
  if (await digest(body) !== expectedSha256) fail('account_snapshot_digest_mismatch');
  return transaction(() => {
    // Existing schema must already be initialized by the account service.
    const revision = db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get()?.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) fail('account_revision_invalid');
    const receiptTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='read2lead_account_import'").get();
    if (receiptTable) {
      const receipt = db.prepare('SELECT * FROM read2lead_account_import WHERE id=1').get();
      if (receipt) {
        if (receipt.sha256 !== expectedSha256 || receipt.source_id !== body.sourceId
            || receipt.progress_in_codes !== Number(progressInCodes) || receipt.record_count !== body.records.length)
          fail('account_snapshot_already_initialized');
        if (revision < 1) fail('account_import_receipt_invalid');
        return { status: 'already_imported', sha256: expectedSha256, recordCount: receipt.record_count };
      }
    }
    if (revision !== 0 || db.prepare('SELECT COUNT(*) AS count FROM read2lead_account_kv').get().count !== 0)
      fail('account_snapshot_target_not_pristine');
    db.exec(`CREATE TABLE IF NOT EXISTS read2lead_account_import (
      id INTEGER PRIMARY KEY CHECK(id=1), sha256 TEXT NOT NULL, source_id TEXT NOT NULL,
      progress_in_codes INTEGER NOT NULL, record_count INTEGER NOT NULL)`);
    const insert = db.prepare('INSERT INTO read2lead_account_kv(namespace,key,value,expires,metadata) VALUES(?,?,?,?,?)');
    for (const row of body.records) insert.run(row.namespace, row.key, row.value, row.expires, row.metadata);
    db.prepare('INSERT INTO read2lead_account_import VALUES(1,?,?,?,?)')
      .run(expectedSha256, body.sourceId, Number(progressInCodes), body.records.length);
    // In-flight staged operations must see that their starting state is obsolete.
    db.prepare('UPDATE read2lead_account_revision SET revision=1 WHERE id=1').run();
    return { status: 'imported', sha256: expectedSha256, recordCount: body.records.length };
  });
}

const ROLLOUT_FORMAT = 'read2lead-account-rollout-v1';
const TARGET_SOURCE = 'read2lead-authoritative-sql-v1';
const pin = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const rowId = row => JSON.stringify([row.namespace, row.key]);
async function checkedSnapshot(snapshot) {
  if (!exactKeys(snapshot, ['format', 'sourceId', 'progressInCodes', 'records', 'sha256'])
      || snapshot.format !== FORMAT || !pin(snapshot.sha256)) fail('account_rollout_snapshot_invalid');
  const body = inventory({ sourceId: snapshot.sourceId, progressInCodes: snapshot.progressInCodes, records: snapshot.records });
  const sha256 = await digest(body);
  if (sha256 !== snapshot.sha256) fail('account_rollout_snapshot_digest_mismatch');
  return { ...body, sha256 };
}
function rolloutBody(value) {
  if (!pin(value.sourceSha256) || !pin(value.targetSha256) || typeof value.progressInCodes !== 'boolean'
      || !Array.isArray(value.omittedSourceKeys)) fail('invalid_account_rollout_plan');
  const seen = new Set();
  const omittedSourceKeys = value.omittedSourceKeys.map(row => {
    if (!exactKeys(row, ['namespace', 'key', 'reason']) || !['codes', 'progress'].includes(row.namespace)
        || (value.progressInCodes && row.namespace === 'progress') || !validText(row.key) || !row.key
        || encoder.encode(row.key).length > 512 || !validText(row.reason) || !row.reason.trim() || row.reason.length > 500)
      fail('invalid_account_rollout_omission');
    if (seen.has(rowId(row))) fail('duplicate_account_rollout_omission');
    seen.add(rowId(row));
    return { namespace: row.namespace, key: row.key, reason: row.reason };
  }).sort((a, b) => order(a.namespace, b.namespace) || order(a.key, b.key));
  return { format: ROLLOUT_FORMAT, sourceSha256: value.sourceSha256, targetSha256: value.targetSha256,
    progressInCodes: value.progressInCodes, omittedSourceKeys };
}
export function readAccountSnapshotRows(db) {
  const text=value=>{
    const bytes=value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;
    if(!bytes)fail('account_snapshot_text_invalid');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  };
  // Some SQLite drivers truncate TEXT results at NUL. Read raw UTF-8 bytes
  // before decoding so opaque historical values/keys remain byte-exact.
  return db.prepare('SELECT CAST(namespace AS BLOB) AS namespace,CAST(key AS BLOB) AS key,CAST(value AS BLOB) AS value,expires,CAST(metadata AS BLOB) AS metadata FROM read2lead_account_kv ORDER BY namespace,key').all()
    .map(row => ({ namespace: text(row.namespace), key: text(row.key), value: text(row.value), expires: row.expires, metadata: row.metadata===null?null:text(row.metadata) }));
}

/** Trusted-host read only; not an HTTP endpoint or proof of a source freeze. */
export async function snapshotAccountStore({ db, progressInCodes }) {
  return prepareAccountSnapshot({ sourceId: TARGET_SOURCE, progressInCodes, records: readAccountSnapshotRows(db) });
}

/** An omission needs its own reason and is bound into the independently pinned
 * rollout plan. All omitted source bytes must remain in the protected backup.
 */
export async function prepareAccountRollout({ sourceSnapshot, targetSnapshot, omittedSourceKeys = [] }) {
  const source = await checkedSnapshot(sourceSnapshot), target = await checkedSnapshot(targetSnapshot);
  if (target.sourceId !== TARGET_SOURCE || source.progressInCodes !== target.progressInCodes) fail('account_rollout_mode_mismatch');
  const body = rolloutBody({ sourceSha256: source.sha256, targetSha256: target.sha256,
    progressInCodes: source.progressInCodes, omittedSourceKeys });
  const available = new Set(source.records.map(rowId));
  if (body.omittedSourceKeys.some(row => !available.has(rowId(row)))) fail('account_rollout_omitted_key_missing');
  return { ...body, sha256: await digest(body) };
}

/** Add missing legacy rows to an existing authoritative account database.
 * Never overwrites target rows or touches story/session/voice tables. The host
 * must freeze and fence ALL old writers and back up BOTH stores before use.
 * A valid checksum alone proves neither that freeze nor migration approval.
 */
export async function mergeAccountSnapshot({ db, transaction, snapshot, plan, expectedPlanSha256, progressInCodes }) {
  if (!db?.prepare || !db?.exec || typeof transaction !== 'function') fail('account_storage_required');
  if (!exactKeys(plan, ['format', 'sourceSha256', 'targetSha256', 'progressInCodes', 'omittedSourceKeys', 'sha256'])
      || plan.format !== ROLLOUT_FORMAT || !pin(expectedPlanSha256) || plan.sha256 !== expectedPlanSha256
      || typeof progressInCodes !== 'boolean' || plan.progressInCodes !== progressInCodes) fail('account_rollout_pin_or_mode_mismatch');
  const body = rolloutBody(plan);
  if (await digest(body) !== expectedPlanSha256) fail('account_rollout_plan_digest_mismatch');
  const source = await checkedSnapshot(snapshot);
  if (source.sha256 !== body.sourceSha256 || source.progressInCodes !== progressInCodes) fail('account_rollout_source_mismatch');
  const omitted = new Set(body.omittedSourceKeys.map(rowId));
  const available = new Set(source.records.map(rowId));
  if ([...omitted].some(key => !available.has(key))) fail('account_rollout_omitted_key_missing');
  function receipt() {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='read2lead_account_rollout'").get()) return null;
    const row = db.prepare('SELECT * FROM read2lead_account_rollout WHERE id=1').get();
    if (!row) fail('account_rollout_receipt_invalid');
    if (row.plan_sha256 !== expectedPlanSha256 || row.source_sha256 !== body.sourceSha256 || row.target_sha256 !== body.targetSha256)
      fail('account_rollout_already_initialized');
    const currentRevision = db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get()?.revision;
    if (row.progress_in_codes !== Number(progressInCodes) || ![row.added_count, row.identical_count, row.omitted_count].every(value => Number.isSafeInteger(value) && value >= 0)
        || !Number.isSafeInteger(row.revision) || row.revision < 2 || !Number.isSafeInteger(currentRevision) || currentRevision < row.revision
        || row.omitted_count !== omitted.size || row.added_count + row.identical_count + row.omitted_count !== source.records.length)
      fail('account_rollout_receipt_invalid');
    return { status: 'already_merged', sha256: expectedPlanSha256, added: row.added_count, identical: row.identical_count, omitted: row.omitted_count };
  }
  // Replay after later learning must acknowledge the receipt, not restore the
  // opening snapshot or demand that subsequent legitimate progress disappear.
  const prior = transaction(receipt);
  if (prior) return prior;
  const revision = db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get()?.revision;
  if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(revision + 1)) fail('account_rollout_target_not_initialized');
  const target = await snapshotAccountStore({ db, progressInCodes });
  return transaction(() => {
    const replay = receipt();
    if (replay) return replay;
    if (target.sha256 !== body.targetSha256 || db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get()?.revision !== revision
        || JSON.stringify(readAccountSnapshotRows(db)) !== JSON.stringify(target.records)) fail('account_rollout_target_changed');
    const existing = new Map(target.records.map(row => [rowId(row), row]));
    const additions = []; let identical = 0;
    for (const row of source.records) {
      const id = rowId(row); if (omitted.has(id)) continue;
      if (!existing.has(id)) additions.push(row);
      else if (JSON.stringify(existing.get(id)) === JSON.stringify(row)) identical++;
      else fail('account_rollout_conflicting_key');
    }
    db.exec(`CREATE TABLE read2lead_account_rollout (
      id INTEGER PRIMARY KEY CHECK(id=1), plan_sha256 TEXT NOT NULL, source_sha256 TEXT NOT NULL,
      target_sha256 TEXT NOT NULL, added_count INTEGER NOT NULL, identical_count INTEGER NOT NULL,
      omitted_count INTEGER NOT NULL, revision INTEGER NOT NULL, progress_in_codes INTEGER NOT NULL CHECK(progress_in_codes IN (0,1)))`);
    const insert = db.prepare('INSERT INTO read2lead_account_kv(namespace,key,value,expires,metadata) VALUES(?,?,?,?,?)');
    for (const row of additions) insert.run(row.namespace, row.key, row.value, row.expires, row.metadata);
    db.prepare('INSERT INTO read2lead_account_rollout VALUES(1,?,?,?,?,?,?,?,?)')
      .run(expectedPlanSha256, body.sourceSha256, body.targetSha256, additions.length, identical, omitted.size, revision + 1, Number(progressInCodes));
    db.prepare('UPDATE read2lead_account_revision SET revision=? WHERE id=1').run(revision + 1);
    return { status: 'merged', sha256: expectedPlanSha256, added: additions.length, identical, omitted: omitted.size };
  });
}
