import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runSyntheticMigrationRehearsal, rehearsalInventory, requireMatchingRecovery } from '../scripts/read2lead-self-learn-migration-rehearsal.mjs';
import { initializeSyntheticTarget } from '../scripts/read2lead-local-qa.mjs';
import { canonical } from '../src/lib/read2lead/self-learn/session-contract.mjs';

const mode = 'synthetic-local', roots = resolve('.r2l-migration-proofs');
mkdirSync(roots, { recursive: true });
const parent = () => mkdtempSync(join(roots, 'case-'));
const read = (root, name) => JSON.parse(readFileSync(join(root, name + '.json'), 'utf8'));
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
let proofPromise;
function proof() {
  return proofPromise ??= (async () => {
    const root = join(parent(), 'rehearsal'), result = await runSyntheticMigrationRehearsal({ mode, outputRoot: root });
    return { root, result, opening: read(root, '02-opening'), imported: read(root, '05-imported'), cutover: read(root, '08-cutover'), recovered: read(root, '09-reopened'), final: read(root, '11-final') };
  })();
}

test('migration requires explicit synthetic mode before creating anything', async () => {
  for (const value of [undefined, 'production', 'local', 'synthetic']) {
    const path = join(parent(), 'refused');
    await assert.rejects(runSyntheticMigrationRehearsal({ mode: value, outputRoot: path }), /unsafe_rehearsal_mode/);
    assert.equal(existsSync(path), false);
  }
});

test('existing empty, unmarked, production-marked and valid synthetic targets are never adopted', async () => {
  for (const kind of ['empty', 'unmarked', 'production', 'synthetic']) {
    const root = join(parent(), 'existing');
    if (kind === 'synthetic') initializeSyntheticTarget(root);
    else { mkdirSync(root); if (kind !== 'empty') writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ purpose: kind })); }
    const before = readdirSync(root).map(name => [name, readFileSync(join(root, name), 'utf8')]);
    await assert.rejects(runSyntheticMigrationRehearsal({ mode, outputRoot: root }), /unsafe_new_target/);
    assert.deepEqual(readdirSync(root).map(name => [name, readFileSync(join(root, name), 'utf8')]), before);
  }
});

test('relative, noncanonical and symlink targets cannot create rehearsal data', async () => {
  const root = parent(), link = join(root, 'linked'); symlinkSync(root, link);
  for (const path of ['relative-migration-proof', root + '/unused/../new', join(link, 'new')]) await assert.rejects(runSyntheticMigrationRehearsal({ mode, outputRoot: path }), /unsafe_new_target/);
  assert.equal(existsSync(join(root, 'new')), false);
});

test('CLI refuses missing mode, extra input options and malformed syntax before writing', () => {
  const path = join(parent(), 'cli-refused');
  for (const args of [['--output-root', path], ['--synthetic-local', '--output-root', path, '--input', 'real-export.json'], ['--production', '--output-root', path]]) {
    const result = spawnSync(process.execPath, ['scripts/read2lead-self-learn-migration-rehearsal.mjs', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /Usage:/); assert.equal(existsSync(path), false);
  }
});

test('fixed-fixture rehearsal preserves all three children and legitimately earned opening balances', async () => {
  const { result, opening, final } = await proof();
  assert.equal(result.ok, true); assert.equal(result.tables, 33);
  assert.deepEqual(result.children.map(child => [child.child_id, child.level, child.active_contract]), [['synthetic-an', 'L2', '1.1'], ['synthetic-binh', 'L0', '1.1'], ['synthetic-chi', 'L5', '1.2']]);
  for (const child of result.children) {
    assert.deepEqual(child.balances, { opening: 10, imported: 10, cutover: 15, recovered: 15, final: 20 });
    assert.equal(opening.tables.wallets.find(row => row.child_id === child.child_id).balance, 10);
    assert.equal(final.tables.wallets.find(row => row.child_id === child.child_id).balance, 20);
    const entries = opening.tables.ledger.filter(row => row.child_id === child.child_id);
    assert.equal(entries.length, 2); assert.ok(entries.every(row => row.kind === 'credit' && row.delta === 5));
  }
});

test('hash-bound source archive preserves unknown fields, historical savings, XP, rank and medals without conversion', async () => {
  const { root, result, imported } = await proof(), inputs = read(root, '03-source-archive'), plan = read(root, '04-dry-run');
  assert.equal(inputs.length, 3); assert.equal(result.stale_source_refused, true);
  for (const input of inputs) {
    assert.equal(input.expected_sha256, digest(input.snapshot));
    assert.equal(plan.inputs.find(row => row.child_id === input.child_id).sha256, input.expected_sha256);
    assert.deepEqual(JSON.parse(imported.tables.game_imports.find(row => row.child_id === input.child_id).snapshot_json), input.snapshot);
    assert.equal(input.snapshot.unknown_future_record.child_canary, input.child_id);
    assert.equal(input.snapshot.unknown_future_record.preserve, 'synthetic-opaque-value');
    assert.equal(input.snapshot.total_xp, 920); assert.equal(input.snapshot.rank_points, 123);
    assert.equal(input.snapshot.diamonds, 35); assert.equal(input.snapshot.coins, 19);
    assert.equal(input.snapshot.pack_history.length, 2);
    assert.equal(imported.tables.wallets.find(row => row.child_id === input.child_id).balance, 10);
  }
  assert.match(plan.wallet_policy, /without conversion/);
});

test('imports preserve every non-game table and exact replay writes no rows', async () => {
  const { root, opening, imported } = await proof(), second = read(root, '06-second-import'), alternate = read(root, '07-same-source-new-request');
  for (const [name, rows] of Object.entries(opening.tables)) if (!name.startsWith('game_')) assert.deepEqual(imported.tables[name], rows, name);
  assert.equal(requireMatchingRecovery(imported, second).ok, true);
  for (const [name, rows] of Object.entries(imported.tables)) if (name !== 'game_receipts') assert.deepEqual(alternate.tables[name], rows, name);
  assert.equal(alternate.tables.game_receipts.length, imported.tables.game_receipts.length + 3);
  assert.equal(imported.tables.game_imports.length, 3);
});

test('active 1.1 and 1.2 content pins and completed history survive migration and recovery', async () => {
  const { opening, cutover, final } = await proof();
  for (const row of opening.tables.sessions) {
    const original = JSON.parse(row.record_json), migrated = JSON.parse(cutover.tables.sessions.find(next => next.id === row.id).record_json), recovered = JSON.parse(final.tables.sessions.find(next => next.id === row.id).record_json);
    assert.deepEqual(migrated.lesson, original.lesson); assert.deepEqual(recovered.lesson, original.lesson);
    assert.equal(migrated.session.content_sha256, original.session.content_sha256); assert.equal(recovered.session.content_sha256, original.session.content_sha256);
    assert.equal(recovered.session.status, 'complete');
    assert.equal(recovered.session.schema_version, original.session.schema_version);
    if (row.id.endsWith('-opening')) assert.deepEqual(recovered, original);
  }
  assert.deepEqual(final.tables.library_readings, opening.tables.library_readings);
  assert.deepEqual(final.tables.library_favorites, opening.tables.library_favorites);
  assert.deepEqual(final.tables.editor_revisions, opening.tables.editor_revisions);
  assert.deepEqual(final.tables.child_profiles, opening.tables.child_profiles);
});

test('current consistent backup and compatible reopen retain every table and schema', async () => {
  const { root, result, cutover, recovered } = await proof();
  assert.equal(requireMatchingRecovery(cutover, recovered).ok, true);
  assert.equal(requireMatchingRecovery(cutover, rehearsalInventory({ mode, dataRoot: join(root, 'current-backup') })).ok, true);
  assert.equal(result.backup.tables, 33); assert.equal(result.recovery.tables, 33);
  assert.match(result.limitations.join(' '), /identical verified store implementation/);
  assert.ok(Object.keys(result.runtime.source_sha256).length > 50);
  for (const hash of Object.values(result.runtime.source_sha256)) assert.match(hash, /^[a-f0-9]{64}$/);
});

test('stale opening backup is refused even though its database and balances are internally valid', async () => {
  const { root, result, opening, cutover } = await proof(), stale = rehearsalInventory({ mode, dataRoot: join(root, 'opening-backup') });
  assert.equal(requireMatchingRecovery(opening, stale).ok, true);
  assert.equal(result.stale_opening_backup_refused, true);
  assert.throws(() => requireMatchingRecovery(cutover, stale), /stale_or_changed_recovery/);
});

test('recovery refuses tampered rows, changed schema and forged inventory hashes', async () => {
  const { cutover } = await proof();
  for (const mutate of [x => x.tables.wallets[0].balance++, x => x.tables.receipts.pop(), x => x.schema.pop()]) {
    const bad = structuredClone(cutover); mutate(bad);
    assert.throws(() => requireMatchingRecovery(cutover, bad), /invalid_recovery_inventory/);
    bad.sha256 = digest({ schema: bad.schema, tables: bad.tables });
    assert.throws(() => requireMatchingRecovery(cutover, bad), /stale_or_changed_recovery/);
  }
  for (const bad of [null, {}, { ...cutover, integrity: 'corrupt' }, { ...cutover, foreignKeys: [{}] }]) assert.throws(() => requireMatchingRecovery(cutover, bad), /invalid_recovery_inventory/);
});

test('all original requests replay exactly while current wallets retain newer credits, debits and refunds', async () => {
  const { root, result, cutover, recovered, final } = await proof(), replay = read(root, '12-replay-proof'), requests = read(root, '13-request-archive');
  assert.ok(replay.length > 90); assert.equal(replay.length, result.replayed_requests); assert.equal(result.new_requests_after_recovery, 18); assert.equal(requests.length, replay.length + result.new_requests_after_recovery);
  replay.forEach((row, index) => assert.equal(row.original_response_sha256, digest(requests[index].result)));
  assert.ok(replay.every(row => row.replay_matches));
  assert.deepEqual([...new Set(replay.map(row => row.kind))].sort(), ['draft', 'favorite', 'goal', 'import', 'monster', 'progress', 'purchase', 'reading', 'refund', 'submit']);
  const purchases = replay.filter(row => row.kind === 'purchase');
  assert.equal(purchases.length, 6); assert.equal(purchases.filter(row => row.original_receipt_balance === 10 && row.current_wallet_balance === 15).length, 3);
  requireMatchingRecovery(recovered, read(root, '10-after-replay'));
  assert.deepEqual(final.tables.redemptions, cutover.tables.redemptions);
  for (const table of ['ledger', 'receipts']) for (const row of cutover.tables[table]) assert.ok(final.tables[table].some(next => canonical(next) === canonical(row)), table);
  for (const child of result.children) {
    const ledger = final.tables.ledger.filter(row => row.child_id === child.child_id);
    assert.equal(ledger.reduce((sum, row) => sum + row.delta, 0), 20);
    assert.equal(ledger.filter(row => row.kind === 'debit').length, 2);
    assert.equal(ledger.filter(row => row.kind === 'refund').length, 1);
  }
});

test('final operational report is private-data-free and recovery instructions state scope honestly', async () => {
  const { root, result } = await proof(), report = result.operational_report;
  assert.equal(report.value_safety.wallet_drift, 0); assert.equal(report.observations.sessions, 9); assert.equal(report.value_safety.synthetic_diamonds, 60);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-an|synthetic-binh|synthetic-chi|DEMO-|synthetic-secret|child_canary|correct_index|access_code/);
  const text = readFileSync(join(root, 'ROLLBACK.md'), 'utf8');
  assert.match(text, /opening backup is evidence only/); assert.match(text, /No production rollback/); assert.match(text, /Human pilot/);
  assert.equal(existsSync(join(root, 'FAILED.json')), false);
});

test('inventory cannot create a database or read an unmarked target', () => {
  const unmarked = parent(), root = join(parent(), 'empty'); initializeSyntheticTarget(root);
  assert.throws(() => rehearsalInventory({ mode: 'production', dataRoot: root }), /unsafe_rehearsal_mode/);
  assert.throws(() => rehearsalInventory({ mode, dataRoot: unmarked }), /unsafe_target/);
  assert.throws(() => rehearsalInventory({ mode, dataRoot: root }), /rehearsal_database_missing/);
  assert.equal(existsSync(join(root, 'read2lead-synthetic.sqlite')), false);
});

test('inventory reads all schema and row contents without writing the closed source database', async () => {
  const { root } = await proof(), dataRoot = join(root, 'current-backup'), path = join(dataRoot, 'read2lead-synthetic.sqlite'), before = readFileSync(path);
  const snapshot = rehearsalInventory({ mode, dataRoot }), db = new DatabaseSync(path, { readOnly: true });
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    assert.deepEqual(Object.keys(snapshot.tables).sort(), names);
    for (const name of names) assert.equal(snapshot.tables[name].length, db.prepare('SELECT count(*) AS n FROM "' + name.replaceAll('"', '""') + '"').get().n);
  } finally { db.close(); }
  assert.deepEqual(readFileSync(path), before);
});
