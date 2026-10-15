import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
const access = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/family-access.json', import.meta.url))).accounts;
const lesson = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/level-lessons.json', import.meta.url))).lessons[2];
const roots = resolve('.r2l-family-proofs'); mkdirSync(roots, { recursive: true });
const staff = { active: true, role: 'staff', id: 'synthetic-qa' }, time = '2026-09-18T15:00:00Z';
function root() { const r = mkdtempSync(join(roots, 'case-')); writeFileSync(join(r, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' })); return r; }
function fixture(t, fault = () => {}) {
  const path = root(), core = new SyntheticStore({ root: path }); let family = new SyntheticFamilyStore({ mode: 'synthetic-local', root: path, fault });
  for (const a of access) family.seed(staff, a, time);
  t.after(() => { family.close(); core.close(); });
  return { root: path, core, get family() { return family; }, reopen() { family.close(); family = new SyntheticFamilyStore({ mode: 'synthetic-local', root: path, fault }); },
    db() { return new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); },
    child(i = 0) { return family.authenticateAccess(access[i].access_code); },
    parent(i = 0) { return family.elevateParent(this.child(i), access[i].parent_secret); } };
}
function update(child = 'synthetic-binh', revision = 0, request = 'profile-update', more = {}) {
  return { request_id: request, child_id: child, expected_revision: revision, display_name: 'Bình mẫu', archived: false, learning_enabled: true, recording_allowed: false, ...more };
}
const recovery = (more = {}) => ({ family_id: access[0].family_id, request_id: 'recover-once', recovery_code: access[0].recovery_code,
  new_access_code: 'NEXT-FAMILY-A-ACCESS', new_parent_secret: 'NEXT-PARENT-A-SECRET', new_recovery_code: 'NEXT-RECOVERY-FAMILY-A-2026', ...more });
function worker(f, operation, boundary = '', id = 'worker-request') {
  return new Promise((done, fail) => {
    const p = spawn(process.execPath, ['tests/fixtures/read2lead-self-learn/family-worker.mjs', f.root, operation, boundary, id], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', error = ''; p.stdout.on('data', x => out += x); p.stderr.on('data', x => error += x); p.on('error', fail);
    p.on('exit', (code, signal) => done({ code, signal, out, error }));
  });
}
test('family extension requires synthetic mode, an existing marked core and known schema before use', t => {
  const fresh = root(); assert.throws(() => new SyntheticFamilyStore({ mode: 'production', root: fresh }), /unsafe_family_mode/);
  assert.throws(() => new SyntheticFamilyStore({ mode: 'synthetic-local', root: fresh }), /core_store_required/);
  assert.equal(existsSync(join(fresh, 'read2lead-synthetic.sqlite')), false);
  const core = new SyntheticStore({ root: fresh }); t.after(() => core.close());
  const db = new DatabaseSync(join(fresh, 'read2lead-synthetic.sqlite')); db.exec("INSERT INTO r2l_meta VALUES('family_schema_version','99')"); db.close();
  assert.throws(() => new SyntheticFamilyStore({ mode: 'synthetic-local', root: fresh }), /unsupported_family_schema/);
});
test('unmarked partial family tables are refused without adopting or repairing them', t => {
  const path = root(), core = new SyntheticStore({ root: path }); t.after(() => core.close());
  const db = new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); db.exec('CREATE TABLE family_accounts (unknown TEXT)'); db.close();
  assert.throws(() => new SyntheticFamilyStore({ mode: 'synthetic-local', root: path }), /unrecognized_family_schema/);
  const check = new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); assert.equal(check.prepare("SELECT count(*) AS n FROM pragma_table_info('family_accounts')").get().n, 1); check.close();
});
test('seed validates complete synthetic shape and refuses real IDs, duplicate access and foreign child ownership', t => {
  const f = fixture(t), bad = structuredClone(access[0]); bad.family_id = 'real-family';
  assert.throws(() => f.family.seed(staff, bad, time), /invalid_request/);
  assert.throws(() => f.family.seed(staff, { ...access[0], children: [null] }, time), e => e.code === 'invalid_request');
  assert.throws(() => f.family.seed({ ...staff, active: false }, access[0], time), /unauthorized/);
  assert.throws(() => f.family.seed(staff, { ...access[0], family_id: 'synthetic-third' }, time), /access_conflict/);
  assert.throws(() => f.family.seed(staff, { ...access[0], family_id: 'synthetic-third', access_code: 'THIRD-FAMILY' }, time), /wrong_child/);
  assert.equal(f.core.audit(staff).ok, true);
});
test('parent elevation, family isolation and credential omission precede private operations', t => {
  const f = fixture(t), child = f.child(), parent = f.parent();
  assert.throws(() => f.family.authenticateAccess('UNKNOWN-CODE'), /invalid_access/);
  assert.throws(() => f.family.elevateParent(child, 'INCORRECT-PARENT'), /invalid_access/);
  assert.throws(() => f.family.createChild(child, {}, time), /parent_required/);
  assert.throws(() => f.family.updateChild({ ...parent, active: false }, null, time), /unauthorized/);
  assert.throws(() => f.family.updateChild(parent, { child_id: 'synthetic-chi' }, time), /wrong_child/);
  assert.throws(() => f.family.childAccess(child, 'synthetic-chi'), /wrong_child/);
  assert.throws(() => f.family.audit(child), /parent_required/);
  const view = f.family.familyView(child); assert.deepEqual(view.children.map(c => c.level), ['L2', 'L0']);
  const text = JSON.stringify([view, f.family.familyView(parent), f.family.audit(parent)]);
  for (const a of access) for (const k of ['access_code', 'parent_secret', 'recovery_code']) assert.ok(!text.includes(a[k]));
  assert.doesNotMatch(text, /access_hash|parent_hash|recovery_hash|_salt/);
});
test('new child creation is atomic, replay-safe, L0 and disabled until parent enables it', t => {
  const f = fixture(t), parent = f.parent(), data = { request_id: 'new-child', display_name: 'New sample' };
  const first = f.family.createChild(parent, data, time), again = f.family.createChild(parent, data, time);
  assert.equal(again.replayed, true); assert.deepEqual(again.profile, first.profile);
  assert.equal(first.profile.level, 'L0'); assert.equal(first.profile.learning_enabled, false); assert.equal(first.profile.recording_allowed, false);
  assert.equal(f.family.familyView(f.child()).children.length, 2);
  assert.throws(() => f.family.childAccess(parent, first.profile.id), /child_access_disabled/);
  assert.throws(() => f.family.createChild(parent, { ...data, display_name: 'Changed' }, time), /request_conflict/);
  const enabled = f.family.updateChild(parent, update(first.profile.id, 0, 'enable-child', { display_name: 'New sample', recording_allowed: true }), time);
  assert.equal(enabled.profile.revision, 1); assert.equal(f.family.childAccess(f.child(), first.profile.id).recording_allowed, true);
  assert.equal(f.core.wallet({ active: true, childId: first.profile.id }, first.profile.id).balance, 0);
  f.reopen(); assert.equal(f.family.familyView(f.parent()).children.length, 3);
});
test('profile changes reject stale revisions and extra promotion or wallet fields', t => {
  const f = fixture(t), parent = f.parent();
  for (const data of [update('synthetic-binh', 0, 'bad', { level: 'L5' }), update('synthetic-binh', 0, 'bad', { balance: 100 }), update('synthetic-binh', 0, 'bad', { learning_enabled: false, recording_allowed: true })]) assert.throws(() => f.family.updateChild(parent, data, time), /invalid_request/);
  const first = f.family.updateChild(parent, update(), time); assert.equal(first.profile.revision, 1);
  assert.equal(f.family.updateChild(parent, update(), time).replayed, true);
  assert.throws(() => f.family.updateChild(parent, update('synthetic-binh', 0, 'stale'), time), /stale_revision/);
  assert.equal(f.family.childAccess(f.child(), 'synthetic-binh').level, 'L0');
});
test('archiving and restoring retains learning records, balances, old pins and levels', async t => {
  const f = fixture(t), principal = { active: true, childId: 'synthetic-an' }, parent = f.parent();
  let start = await f.core.start(principal, { sessionId: 'synthetic-saved-before-profile', childId: principal.childId, lesson, now: time, apiVersion: '1.2' });
  const send = (event, payload = {}) => { const s = start.session; start = f.core.submit(principal, { api_version: '1.2', request_id: 'preserve-' + s.revision, session_id: s.session_id, child_id: s.child_id, expected_revision: s.revision, event, payload }, time); };
  send('prediction', { text: '' }); send('input_complete', { order: ['read'] });
  for (const q of lesson.questions) send('answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id), support_used: [], capture_status: 'not_attempted' });
  send('save_understand'); const before = f.core.record(principal, principal.childId, start.session.session_id), wallet = f.core.wallet(principal, principal.childId);
  f.family.updateChild(parent, update('synthetic-an', 0, 'archive', { display_name: 'An renamed sample', archived: true }), time);
  assert.throws(() => f.family.childAccess(f.child(), principal.childId), /child_access_disabled/);
  assert.equal(f.family.familyView(f.child()).children.length, 1);
  f.family.updateChild(parent, update('synthetic-an', 1, 'restore', { display_name: 'An renamed sample' }), time);
  assert.equal(f.family.childAccess(f.child(), principal.childId).level, 'L2');
  assert.deepEqual(f.core.record(principal, principal.childId, start.session.session_id), before); assert.deepEqual(f.core.wallet(principal, principal.childId), wallet);
  assert.equal(wallet.balance, 5); assert.equal(f.core.audit(staff).ok, true);
});
test('last unarchived profile and ten-profile local bounds are explicit and reversible', t => {
  const f = fixture(t);
  assert.throws(() => f.family.updateChild(f.parent(1), update('synthetic-chi', 0, 'last', { display_name: 'Chi mẫu', archived: true }), time), /last_active_child/);
  const parent = f.parent();
  for (let i = 0; i < 8; i++) f.family.createChild(parent, { request_id: 'bounded-child-' + i, display_name: 'Sample ' + i }, time);
  assert.equal(f.family.familyView(parent).children.length, 10);
  assert.throws(() => f.family.createChild(parent, { request_id: 'one-too-many', display_name: 'Extra sample' }, time), /child_limit/);
  f.family.updateChild(parent, update('synthetic-binh', 0, 'archive-bounded', { archived: true }), time);
  assert.equal(f.family.familyView(parent).children.length, 10);
  assert.equal(f.family.updateChild(parent, update('synthetic-binh', 1, 'restore-bounded'), time).profile.archived, false);
});
test('credential recovery rotates all secrets once, invalidates old principals and survives reseed/reopen', t => {
  const f = fixture(t), old = f.parent(), data = recovery(); const first = f.family.recover(data, time);
  assert.equal(first.credential_version, 2); assert.equal(f.family.recover(data, time).replayed, true);
  assert.throws(() => f.family.familyView(old), /unauthorized/); assert.throws(() => f.family.authenticateAccess(access[0].access_code), /invalid_access/);
  assert.throws(() => f.family.recover({ ...data, request_id: 'reuse-old-recovery' }, time), /invalid_access/);
  assert.throws(() => f.family.recover({ ...data, new_access_code: 'DIFFERENT' }, time), /request_conflict/);
  f.reopen(); assert.equal(f.family.seed(staff, access[0], time).seeded, false);
  const current = f.family.elevateParent(f.family.authenticateAccess(data.new_access_code), data.new_parent_secret);
  assert.equal(current.credentialVersion, 2); assert.equal(f.family.audit(current).filter(a => a.action === 'credentials_recovered').length, 1);
  assert.throws(() => f.family.elevateParent(f.family.authenticateAccess(data.new_access_code), access[0].parent_secret), /invalid_access/);
  const db = f.db(), stored = JSON.stringify(db.prepare('SELECT * FROM family_receipts').all()) + JSON.stringify(db.prepare('SELECT * FROM family_audit').all());
  for (const v of [data.recovery_code, data.new_access_code, data.new_parent_secret, data.new_recovery_code]) assert.ok(!stored.includes(v));
  db.close(); assert.equal(f.core.audit(staff).ok, true);
});
test('recovery refuses unchanged secrets, credential reuse across roles and another family access code', t => {
  const f = fixture(t);
  assert.throws(() => f.family.recover(recovery({ new_access_code: access[0].access_code }), time), /credential_unchanged/);
  assert.throws(() => f.family.recover(recovery({ new_parent_secret: access[0].parent_secret }), time), /credential_unchanged/);
  assert.throws(() => f.family.recover(recovery({ new_access_code: access[1].access_code }), time), /access_conflict/);
  assert.throws(() => f.family.recover(recovery({ new_parent_secret: 'NEXT-FAMILY-A-ACCESS' }), time), /invalid_request/);
  assert.equal(f.child().credentialVersion, 1);
});
test('salts differ and family receipt/audit records refuse direct updates and deletes', t => {
  const f = fixture(t); f.family.createChild(f.parent(), { request_id: 'immutable', display_name: 'Immutable sample' }, time);
  const db = f.db(), account = db.prepare('SELECT access_salt,parent_salt,recovery_salt,access_hash,parent_hash,recovery_hash FROM family_accounts LIMIT 1').get();
  assert.equal(new Set([account.access_salt, account.parent_salt, account.recovery_salt]).size, 3);
  assert.ok([account.access_hash, account.parent_hash, account.recovery_hash].every(v => /^[a-f0-9]{64}$/.test(v)));
  for (const table of ['family_receipts', 'family_audit']) {
    assert.throws(() => db.exec('DELETE FROM ' + table), /immutable_family/);
    assert.throws(() => db.exec('UPDATE ' + table + ' SET family_id=family_id'), /immutable_family/);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); db.close();
});
for (const boundary of ['family_child_inserted', 'family_wallet_inserted', 'family_profile_inserted', 'family_audit_inserted', 'family_receipt_inserted', 'family_before_commit', 'family_after_commit']) test('hard process exit at ' + boundary + ' leaves child creation all-or-nothing', async t => {
  const f = fixture(t), result = await worker(f, 'create', boundary); assert.equal(result.signal, 'SIGKILL', result.error);
  f.reopen(); const parent = f.parent(), prior = f.family.familyView(parent).children.length;
  assert.equal(prior, boundary === 'family_after_commit' ? 3 : 2);
  const retry = await worker(f, 'create'); assert.equal(retry.code, 0, retry.error);
  assert.equal(JSON.parse(retry.out).replayed, boundary === 'family_after_commit');
  assert.equal(f.family.familyView(parent).children.length, 3); assert.equal(f.core.audit(staff).ok, true);
});
for (const boundary of ['family_credentials_rotated', 'family_audit_inserted', 'family_receipt_inserted', 'family_before_commit', 'family_after_commit']) test('hard process exit at ' + boundary + ' keeps credential recovery atomic', async t => {
  const f = fixture(t), result = await worker(f, 'recover', boundary); assert.equal(result.signal, 'SIGKILL', result.error); f.reopen();
  if (boundary === 'family_after_commit') assert.throws(() => f.child(), /invalid_access/); else assert.equal(f.child().credentialVersion, 1);
  const retry = await worker(f, 'recover'); assert.equal(retry.code, 0, retry.error); assert.equal(JSON.parse(retry.out).replayed, boundary === 'family_after_commit');
  assert.equal(f.family.authenticateAccess('WORKER-ACCESS-NEXT').credentialVersion, 2); assert.equal(f.core.audit(staff).ok, true);
});
test('two actual processes creating the same child request return one profile and one receipt', async t => {
  const f = fixture(t), results = await Promise.all([worker(f, 'create'), worker(f, 'create')]);
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results)); const values = results.map(r => JSON.parse(r.out));
  assert.equal(values[0].profile.id, values[1].profile.id); assert.deepEqual(values.map(v => v.replayed).sort(), [false, true]);
  assert.equal(f.family.familyView(f.parent()).children.length, 3); assert.equal(f.core.audit(staff).ok, true);
});
test('two actual processes recovering with the same request rotate only once', async t => {
  const f = fixture(t), results = await Promise.all([worker(f, 'recover'), worker(f, 'recover')]);
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results)); assert.deepEqual(results.map(r => JSON.parse(r.out).replayed).sort(), [false, true]);
  assert.equal(f.family.authenticateAccess('WORKER-ACCESS-NEXT').credentialVersion, 2);
});
test('two actual processes competing for the final profile slot cannot exceed the limit', async t => {
  const f = fixture(t), parent = f.parent();
  for (let i = 0; i < 7; i++) f.family.createChild(parent, { request_id: 'fill-' + i, display_name: 'Bounded sample ' + i }, time);
  const results = await Promise.all([worker(f, 'create', '', 'slot-a'), worker(f, 'create', '', 'slot-b')]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2]);
  assert.equal(JSON.parse(results.find(r => r.code === 2).out).error, 'child_limit');
  assert.equal(f.family.familyView(parent).children.length, 10); assert.equal(f.core.audit(staff).ok, true);
});
test('different simultaneous recovery requests cannot both consume the old recovery token', async t => {
  const f = fixture(t), results = await Promise.all([worker(f, 'recover', '', 'recover-a'), worker(f, 'recover', '', 'recover-b')]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2]);
  assert.equal(JSON.parse(results.find(r => r.code === 2).out).error, 'invalid_access');
  const parent = f.family.elevateParent(f.family.authenticateAccess('WORKER-ACCESS-NEXT'), 'WORKER-PARENT-NEXT');
  assert.equal(parent.credentialVersion, 2); assert.equal(f.family.audit(parent).filter(r => r.action === 'credentials_recovered').length, 1);
});
