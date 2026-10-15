import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAccountSnapshot, importAccountSnapshot } from '../functions/lib/read2lead/account-snapshot.mjs';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';

const CODE = 'R2L-SYNTHETIC-IMPORT-A', TOKEN = 'd'.repeat(32), PART = 'png-default-detail-blue-horn-small';
const NOW = Date.UTC(2026, 9, 1);
const row = (namespace, key, value, expires = null, metadata = null) => ({ namespace, key, value, expires, metadata });
function source(progressInCodes = false) {
  return { sourceId: 'synthetic-frozen-source-only', progressInCodes, records: [
    row('codes', CODE, JSON.stringify({ uses_remaining: 5, student_profile: { student_name: 'Synthetic Import', age: 8, level: 'L1' },
      progress: { current_level: 'L1', current_pack: null, review_history: [], packs_created: 0 },
      future_field: { keep: ['unknown', '🌏'], exact: true } })),
    row(progressInCodes ? 'codes' : 'progress', 'progress:' + CODE, JSON.stringify({ schema_version: 2,
      level_reset_version: 20260606, current_level: 'L1', initial_level: 'L1', rank_points: 0,
      diamonds: 2000, total_xp: 0, redemptions: [], unlocked_parts: [], history_extra: { keep: true } })),
    row('codes', 'r2l_link:' + TOKEN, JSON.stringify({ access_code: CODE, expires_at: '2099-01-01', revoked: false, uses: 0, max_uses: 10 })),
    row('codes', 'raw:🌏', '  { "unknown" : [1, null, "é"] }\n', NOW + 60000, ' { "audit": "unchanged" } '),
    row('codes', 'expired', 'expired value preserved but not readable', NOW - 1, 'null'),
  ] };
}
function host({ path = ':memory:', progressInCodes = false } = {}) {
  const db = new DatabaseSync(path);
  const transaction = work => { db.exec('BEGIN IMMEDIATE'); try { const value = work(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const run = createAccountTransactionRunner({ db, transaction, now: () => NOW, progressInCodes });
  const forbidden = new Proxy({}, { get() { throw Error('legacy binding or paid provider reached'); } });
  const service = createRead2LeadAccountService({ db, transaction, now: () => NOW, progressInCodes,
    infrastructure: { READ2LEAD_CODES: forbidden, READ2LEAD_PROGRESS: forbidden, AI: forbidden } });
  const load = (snapshot, expectedSha256 = snapshot.sha256) => importAccountSnapshot({ db, transaction, snapshot, expectedSha256, progressInCodes });
  const rows = () => db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(x => ({ ...x }));
  const revision = () => db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get().revision;
  return { db, transaction, run, service, load, rows, revision };
}
const request = (path, body) => new Request('https://synthetic.test' + path, body === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

for (const progressInCodes of [false, true]) test(`lossless import, ordinary account use and restart (shared progress=${progressInCodes})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2l-snapshot-')), path = join(root, 'account.sqlite');
  let h = host({ path, progressInCodes });
  try {
    const input = source(progressInCodes), snapshot = await prepareAccountSnapshot(input);
    assert.equal((await h.load(snapshot)).status, 'imported'); assert.equal(h.revision(), 1);
    assert.deepEqual(h.rows(), snapshot.records);
    await h.run(async env => {
      const result = await env.READ2LEAD_CODES.getWithMetadata('raw:🌏');
      assert.equal(result.value, input.records[3].value); assert.deepEqual(result.metadata, { audit: 'unchanged' });
      assert.equal(await env.READ2LEAD_CODES.get('expired'), null);
      return new Response('ok');
    });
    const login = await h.service(request('/api/r2l-link?token=' + TOKEN));
    assert.equal(login.status, 200); assert.equal((await login.json()).access_code, CODE);
    const progress = await h.service(request('/api/read2lead-progress?code=' + CODE));
    assert.equal(progress.status, 200); assert.match(JSON.stringify(await progress.json()), /Synthetic Import/);
    const purchase = await h.service(request('/api/read2lead-shop-buy', { code: CODE, part_id: PART }));
    assert.equal(purchase.status, 200);
    const after = h.rows(), saved = JSON.parse(after.find(r => r.key === 'progress:' + CODE).value);
    assert.equal(saved.diamonds, 2000); (assert.ok(saved.avatar.monster.detail === PART));
    assert.deepEqual(JSON.parse(after.find(r => r.key === CODE).value).future_field, { keep: ['unknown', '🌏'], exact: true });
    h.db.close(); h = host({ path, progressInCodes }); assert.deepEqual(h.rows(), after);
    const revision = h.revision(); assert.equal((await h.load(snapshot)).status, 'already_imported');
    assert.deepEqual(h.rows(), after); assert.equal(h.revision(), revision);
    assert.equal((await h.service(request('/api/read2lead-progress?code=' + CODE))).status, 200);
  } finally { h.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('content, metadata and expiry tampering fail against the independently supplied pin', async () => {
  const original = await prepareAccountSnapshot(source()), h = host();
  try {
    for (const field of ['value', 'metadata', 'expires']) {
      const changed = structuredClone(original);
      changed.records[0][field] = field === 'expires' ? NOW : field === 'metadata' ? '{"changed":true}' : 'changed';
      await assert.rejects(h.load(changed), /account_snapshot_digest_mismatch/);
      assert.deepEqual(h.rows(), []); assert.equal(h.revision(), 0);
    }
    const changedInput = source(); changedInput.records[0].value = 'changed';
    const recomputed = await prepareAccountSnapshot(changedInput);
    await assert.rejects(h.load(recomputed, original.sha256), /account_snapshot_pin_or_mode_mismatch/);
    await assert.rejects(h.load({ ...original, extra: true }), /account_snapshot_pin_or_mode_mismatch/);
  } finally { h.db.close(); }
});

test('duplicates, ambiguous binding mode, malformed rows and metadata are refused', async () => {
  const mutations = [
    s => s.records.push(s.records[0]),
    s => { s.progressInCodes = true; },
    s => { s.records[0].namespace = 'unknown'; },
    s => { s.records[0].expires = 1.5; },
    s => { s.records[0].metadata = '{'; },
    s => { s.records[0].key = '🌏'.repeat(129); },
    s => { s.records[0].value = '\ud800'; },
    s => { s.records[0].unrecognized = 'refuse row fields, preserve value fields'; },
  ];
  for (const mutate of mutations) { const input = source(); mutate(input); await assert.rejects(prepareAccountSnapshot(input), /account_snapshot/); }
  const h = host(); try { await assert.rejects(h.load(await prepareAccountSnapshot(source(true))), /pin_or_mode_mismatch/); }
  finally { h.db.close(); }
});

test('existing records or a used revision prevent import without altering destination', async () => {
  const snapshot = await prepareAccountSnapshot(source());
  for (const usedRevision of [false, true]) {
    const h = host(); try {
      if (usedRevision) h.db.exec('UPDATE read2lead_account_revision SET revision=3');
      else h.db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run('codes', 'existing', 'preserve me');
      const before = h.rows(), revision = h.revision();
      await assert.rejects(h.load(snapshot), /target_not_pristine/);
      assert.deepEqual(h.rows(), before); assert.equal(h.revision(), revision);
    } finally { h.db.close(); }
  }
});

test('mid-import storage failure rolls back all rows, receipt and revision', async () => {
  const snapshot = await prepareAccountSnapshot(source()), h = host();
  try {
    h.db.exec("CREATE TRIGGER refuse_second BEFORE INSERT ON read2lead_account_kv WHEN NEW.key='expired' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END");
    await assert.rejects(h.load(snapshot), /injected storage failure/);
    assert.deepEqual(h.rows(), []); assert.equal(h.revision(), 0);
    assert.equal(h.db.prepare("SELECT name FROM sqlite_master WHERE name='read2lead_account_import'").get(), undefined);
    h.db.exec('DROP TRIGGER refuse_second'); assert.equal((await h.load(snapshot)).status, 'imported');
  } finally { h.db.close(); }
});

test('different snapshot cannot replace an existing import', async () => {
  const h = host(); try {
    await h.load(await prepareAccountSnapshot(source())); const before = h.rows();
    const input = source(); input.records[0].value = 'replacement';
    await assert.rejects(h.load(await prepareAccountSnapshot(input)), /already_initialized/);
    assert.deepEqual(h.rows(), before);
  } finally { h.db.close(); }
});

test('import invalidates a previously staged account write instead of losing imported state', async () => {
  const h = host(); let entered, release;
  const started = new Promise(r => { entered = r; }), wait = new Promise(r => { release = r; });
  try {
    const old = h.run(async env => { await env.READ2LEAD_CODES.put(CODE, 'stale'); entered(); await wait; return new Response('ok'); });
    await started; const snapshot = await prepareAccountSnapshot(source()); await h.load(snapshot);
    release(); const response = await old; assert.equal(response.status, 409);
    assert.deepEqual(h.rows(), snapshot.records); assert.equal(h.revision(), 1);
  } finally { release?.(); h.db.close(); }
});

test('input mutation during hashing cannot change the copied import, and order is deterministic', async () => {
  const input = source(), expected = await prepareAccountSnapshot(source());
  const pending = prepareAccountSnapshot(input); input.records[0].value = 'mutated';
  assert.deepEqual(await pending, expected);
  const reversed = source(); reversed.records.reverse(); assert.deepEqual(await prepareAccountSnapshot(reversed), expected);
  const h = host(); try {
    const snapshot = structuredClone(expected), pendingImport = h.load(snapshot);
    snapshot.records[0].value = 'mutated after import started';
    await pendingImport; assert.deepEqual(h.rows(), expected.records);
  } finally { h.db.close(); }
});
