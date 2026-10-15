/** Fixed-fixture local rehearsal. This is deliberately not a production migrator. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { initializeSyntheticTarget } from './read2lead-local-qa.mjs';
import { syntheticQAReport } from './read2lead-self-learn-qa-report.mjs';
import { SyntheticStore, syntheticDatabasePath } from './lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from './lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from './lib/read2lead-self-learn-library.mjs';
import { SyntheticEditorStore } from './lib/read2lead-self-learn-editor.mjs';
import { SyntheticGameStore } from './lib/read2lead-self-learn-game.mjs';
import { SyntheticGiftStore } from './lib/read2lead-self-learn-gifts.mjs';
import { canonical } from '../src/lib/read2lead/self-learn/session-contract.mjs';
import { defaultFreeMonster } from '../functions/lib/read2lead/self-learn/game-policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(canonical(value));
const plain = value => JSON.parse(JSON.stringify(value));
const mode = 'synthetic-local';
const staff = { active: true, role: 'staff', id: 'synthetic-migration-rehearsal' };
const fixture = name => JSON.parse(readFileSync(new URL('../tests/fixtures/read2lead-self-learn/' + name + '.json', import.meta.url), 'utf8'));
const requireMode = value => { if (value !== mode) throw Error('unsafe_rehearsal_mode'); };
const write = (root, name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

/** Read-only logical snapshot includes every table, schema definition and integrity check. */
export function rehearsalInventory({ mode: requestedMode, dataRoot } = {}) {
  requireMode(requestedMode);
  const path = syntheticDatabasePath(dataRoot);
  if (!existsSync(path)) throw Error('rehearsal_database_missing');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    const schema = plain(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all());
    const tables = {};
    for (const row of schema.filter(row => row.type === 'table')) {
      const quoted = '"' + row.name.replaceAll('"', '""') + '"';
      // Canonical row sorting also supports tables without rowid, retaining duplicate rows.
      tables[row.name] = plain(db.prepare('SELECT * FROM ' + quoted).all()).sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
    }
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const foreignKeys = plain(db.prepare('PRAGMA foreign_key_check').all());
    db.exec('COMMIT');
    if (integrity !== 'ok' || foreignKeys.length) throw Error('rehearsal_database_corrupt');
    return { format: 1, purpose: 'read2lead-local-synthetic-inventory', schema, tables, integrity, foreignKeys, sha256: digest({ schema, tables }) };
  } finally { db.close(); }
}

/** A current cutover inventory is required: an opening backup is never a safe rollback. */
export function requireMatchingRecovery(current, candidate) {
  for (const value of [current, candidate]) {
    if (value?.format !== 1 || value.purpose !== 'read2lead-local-synthetic-inventory' || value.integrity !== 'ok' || value.foreignKeys?.length !== 0 || !value.schema || !value.tables || value.sha256 !== digest({ schema: value.schema, tables: value.tables })) throw Error('invalid_recovery_inventory');
  }
  if (current.sha256 !== candidate.sha256) throw Error('stale_or_changed_recovery');
  return { ok: true, sha256: current.sha256, tables: Object.keys(current.tables).length };
}

function runtimeHashes() {
  const root = fileURLToPath(new URL('../', import.meta.url)), paths = [];
  function scan(relative) {
    for (const item of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative + '/' + item.name;
      if (item.isDirectory()) scan(path);
      else if (item.isFile() && /\.(mjs|sql|json)$/.test(item.name)) paths.push(path);
    }
  }
  for (const dir of ['scripts/lib', 'functions/lib/read2lead/self-learn', 'src/lib/read2lead/self-learn', 'migrations/read2lead-self-learn', 'tests/fixtures/read2lead-self-learn']) scan(dir);
  paths.push('scripts/read2lead-local-qa.mjs', 'scripts/read2lead-self-learn-qa-report.mjs', 'scripts/read2lead-self-learn-migration-rehearsal.mjs');
  return Object.fromEntries(paths.sort().map(path => [path, hash(readFileSync(join(root, path)))]));
}

async function openStores(root, fixtures, seed, now) {
  const stores = {}, opened = [];
  const add = (name, value) => { stores[name] = value; opened.push(value); return value; };
  stores.close = () => { for (const store of opened.splice(0).reverse()) store.close(); };
  try {
    add('core', new SyntheticStore({ root, editorContent: true }));
    add('family', new SyntheticFamilyStore({ mode, root }));
    if (seed) for (const account of fixtures.families.accounts) stores.family.seed(staff, account, now());
    add('library', await SyntheticLibraryStore.open({ mode, root, catalogue: fixtures.catalogue, interests: fixtures.interests, editorContent: true }));
    add('editor', new SyntheticEditorStore({ mode, root }));
    if (seed) for (const account of fixtures.editors.accounts) stores.editor.seed(staff, account, now());
    add('game', new SyntheticGameStore({ mode, root, themes: fixtures.themes.themes, interestIds: fixtures.interests.groups.map(group => group.id) }));
    add('gifts', new SyntheticGiftStore({ mode, root }));
    if (seed) stores.gifts.initializeCatalogue(staff, fixtures.gifts);
    return stores;
  } catch (error) { stores.close(); throw error; }
}

function consistentCopy(source, target) {
  initializeSyntheticTarget(target);
  const db = new DatabaseSync(syntheticDatabasePath(source));
  try { db.prepare('VACUUM INTO ?').run(syntheticDatabasePath(target)); } finally { db.close(); }
  return requireMatchingRecovery(rehearsalInventory({ mode, dataRoot: source }), rehearsalInventory({ mode, dataRoot: target }));
}

function readingSteps(lesson, apiVersion, finish) {
  const speech = { text: '', capture_status: 'not_attempted', support_used: [] };
  const steps = [['prediction', { text: '' }], ['input_complete', { order: ['read'] }], ...lesson.questions.map(q => ['answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(s => s.sentence_id), support_used: [], capture_status: 'not_attempted' }]), ['save_understand', {}]];
  if (finish) steps.push(['begin_use', {}], ['shadow_complete', speech], ...lesson.minny.turns.map(turn => ['minny_turn', { ...speech, turn_id: turn.id }]), ['retell', speech], ...(apiVersion === '1.2' ? [['skip_followup', {}]] : []), ['complete', {}]);
  return steps;
}

export async function runSyntheticMigrationRehearsal({ mode: requestedMode, outputRoot } = {}) {
  requireMode(requestedMode);
  const fixtures = { families: fixture('family-access'), editors: fixture('editor-access'), catalogue: fixture('level-lessons'), interests: fixture('library-interests'), themes: fixture('game-seasons'), legacy: fixture('game-legacy'), gifts: fixture('gift-catalogue') };
  assert.equal(fixtures.families.purpose, 'read2lead-local-synthetic-family');
  assert.equal(fixtures.editors.purpose, 'read2lead-local-synthetic-editor');
  assert.equal(fixtures.legacy.purpose, 'read2lead-local-synthetic-legacy-game');
  const sources = runtimeHashes();
  initializeSyntheticTarget(outputRoot); // Refuse existing, relative, noncanonical or symlink-parent paths.
  const liveRoot = join(outputRoot, 'cutover'), backupRoot = join(outputRoot, 'current-backup'), recoveryRoot = join(outputRoot, 'recovered'), openingRoot = join(outputRoot, 'opening-backup');
  initializeSyntheticTarget(liveRoot);
  let tick = 0, stores;
  const now = () => new Date(Date.parse('2026-09-19T00:00:00.000Z') + 1000 * tick++).toISOString();
  const requests = [], replayProof = [];
  const snap = (name, root = liveRoot) => { const value = rehearsalInventory({ mode, dataRoot: root }); write(outputRoot, name + '.json', value); return value; };
  const children = fixtures.families.accounts.flatMap(account => account.children.map(child => ({ ...child, family_id: account.family_id, access_code: account.access_code, apiVersion: child.child_id === 'synthetic-chi' ? '1.2' : '1.1', lesson: fixtures.catalogue.lessons.find(lesson => lesson.level === child.level) })));
  const actor = child => ({ ...stores.family.authenticateAccess(child.access_code), childId: child.child_id });
  const remember = (kind, child, data, result) => { requests.push({ kind, child_id: child?.child_id, data: structuredClone(data), result: plain(result) }); return result; };
  const submit = (child, session, event, payload) => {
    const data = { api_version: session.schema_version === '1.2.0' ? '1.2' : '1.1', request_id: session.session_id + '-r' + (session.revision + 1), child_id: child.child_id, session_id: session.session_id, expected_revision: session.revision, event, payload };
    return remember('submit', child, data, stores.core.submit(actor(child), data, now())).session;
  };
  async function practice(child, id, version, finish = true) {
    let session = (await stores.core.start(actor(child), { sessionId: id, childId: child.child_id, lesson: child.lesson, now: now(), apiVersion: version })).session;
    for (const [event, payload] of readingSteps(child.lesson, version, finish)) session = submit(child, session, event, payload);
    return session;
  }
  const balances = expected => {
    for (const child of children) assert.equal(stores.core.wallet(actor(child), child.child_id).balance, expected, child.child_id);
    assert.equal(stores.core.audit(staff).ok, true);
  };
  try {
    stores = await openStores(liveRoot, fixtures, true, now);
    snap('01-initial');
    const editor = fixtures.editors.accounts[0], principal = stores.editor.authenticate(editor.editor_id, editor.access_secret);
    const draft = { request_id: 'synthetic-opening-draft', expected_revision: 0, lesson: fixtures.catalogue.lessons[0] };
    remember('draft', null, draft, await stores.editor.saveDraft(principal, draft, now()));
    for (const child of children) {
      await practice(child, child.child_id + '-opening', '1.1');
      const favorite = { request_id: 'synthetic-favorite', expected_revision: 0, lesson_id: child.lesson.id, favorite: true };
      remember('favorite', child, favorite, stores.library.setFavorite(actor(child), favorite, now()));
      const reading = { request_id: 'synthetic-free-reading', lesson_id: child.lesson.id };
      const opened = remember('reading', child, reading, stores.library.openReading(actor(child), reading, now()));
      const progress = { request_id: 'synthetic-free-progress', reading_id: opened.reading.reading_id, expected_revision: 0, sentence_id: child.lesson.story.sentences.at(-1).id, marked_finished: true };
      remember('progress', child, progress, stores.library.updateReading(actor(child), progress, now()));
      const selection = { request_id: 'synthetic-monster', expected_revision: 0, monster: { ...defaultFreeMonster(), color: 'grape' } };
      remember('monster', child, selection, stores.game.selectMonster(actor(child), selection, now()));
      const goal = { request_id: 'synthetic-gift-goal', expected_revision: 0, goal: { gift_id: fixtures.gifts.items[0].gift_id, quoted_version: fixtures.gifts.items[0].version } };
      remember('goal', child, goal, stores.gifts.setGoal(actor(child), goal, now()));
      child.active = (await stores.core.start(actor(child), { sessionId: child.child_id + '-active', childId: child.child_id, lesson: child.lesson, now: now(), apiVersion: child.apiVersion })).session;
      child.active = submit(child, child.active, 'prediction', { text: '' });
    }
    balances(10);
    const opening = snap('02-opening');
    assert.equal(Object.keys(opening.tables).length, 33);
    stores.close(); stores = undefined;
    consistentCopy(liveRoot, openingRoot);
    stores = await openStores(liveRoot, fixtures, false, now);
    requireMatchingRecovery(opening, rehearsalInventory({ mode, dataRoot: liveRoot }));
    const inputs = children.map(child => {
      const snapshot = structuredClone(fixtures.legacy.snapshot);
      snapshot.current_level = child.level;
      snapshot.unknown_future_record.child_canary = child.child_id;
      return { child_id: child.child_id, request_id: 'synthetic-migration-' + child.child_id, expected_sha256: digest(snapshot), snapshot };
    });
    const plan = { purpose: 'read2lead-local-synthetic-migration-plan', current_sha256: opening.sha256, inputs: inputs.map(input => ({ child_id: input.child_id, sha256: input.expected_sha256 })), wallet_policy: 'Keep the current ledger. Archive historical diamonds/coins without conversion; production mapping is unresolved O09.' };
    write(outputRoot, '03-source-archive.json', inputs);
    write(outputRoot, '04-dry-run.json', plan);
    for (const input of inputs) {
      const stale = structuredClone(input); stale.snapshot.unknown_future_record.changed_after_plan = true;
      assert.throws(() => stores.game.importLegacy(staff, stale, now()), error => error.code === 'stale_legacy_input');
    }
    requireMatchingRecovery(opening, rehearsalInventory({ mode, dataRoot: liveRoot }));
    for (const input of inputs) remember('import', children.find(child => child.child_id === input.child_id), input, stores.game.importLegacy(staff, input, now()));
    const imported = snap('05-imported');
    for (const [name, rows] of Object.entries(opening.tables)) if (!name.startsWith('game_')) assert.deepEqual(imported.tables[name], rows, 'Import changed ' + name);
    for (const input of inputs) assert.deepEqual(stores.game.legacySource(staff, input.child_id), input.snapshot);
    for (const input of inputs) assert.equal(stores.game.importLegacy(staff, input, now()).replayed, true);
    const secondPass = snap('06-second-import');
    requireMatchingRecovery(imported, secondPass);
    for (const input of inputs) assert.equal(stores.game.importLegacy(staff, { ...input, request_id: input.request_id + '-new' }, now()).imported.already_present, true);
    const sameSource = snap('07-same-source-new-request');
    for (const [name, rows] of Object.entries(imported.tables)) if (name !== 'game_receipts') assert.deepEqual(sameSource.tables[name], rows, name);
    assert.equal(sameSource.tables.game_receipts.length, imported.tables.game_receipts.length + children.length);
    balances(10);
    for (const child of children) {
      const changed = structuredClone(child.lesson); changed.title += ' changed';
      await assert.rejects(stores.core.start(actor(child), { sessionId: child.active.session_id, childId: child.child_id, lesson: changed, now: now(), apiVersion: child.apiVersion }), error => error.code === 'session_conflict');
      assert.deepEqual(stores.core.read(actor(child), child.child_id, child.active.session_id), child.active);
      for (const [event, payload] of readingSteps(child.lesson, child.apiVersion, true).slice(1)) child.active = submit(child, child.active, event, payload);
      assert.equal(child.active.status, 'complete');
      assert.equal(stores.core.wallet(actor(child), child.child_id).balance, 20);
      for (const suffix of ['refund', 'keep']) {
        const data = { request_id: 'synthetic-buy-' + suffix, gift_id: fixtures.gifts.items[0].gift_id, quoted_version: fixtures.gifts.items[0].version };
        const result = remember('purchase', child, data, stores.gifts.redeem(actor(child), data, now()));
        if (suffix === 'refund') child.refundId = result.redemption.redemption_id;
      }
      const refund = { request_id: 'synthetic-refund-' + child.child_id, redemption_id: child.refundId, reason: 'Synthetic rollback rehearsal' };
      remember('refund', child, refund, stores.gifts.refund(staff, refund, now()));
    }
    balances(15);
    const cutover = snap('08-cutover');
    for (const row of opening.tables.ledger) assert.ok(cutover.tables.ledger.some(current => canonical(current) === canonical(row)), 'Opening ledger entry lost');
    for (const row of opening.tables.receipts) assert.ok(cutover.tables.receipts.some(current => canonical(current) === canonical(row)), 'Opening receipt lost');
    stores.close(); stores = undefined; // Stop all six writers before selecting the current recovery source.
    const backup = consistentCopy(liveRoot, backupRoot);
    const staleInventory = rehearsalInventory({ mode, dataRoot: openingRoot });
    assert.throws(() => requireMatchingRecovery(cutover, staleInventory), /stale_or_changed_recovery/);
    consistentCopy(backupRoot, recoveryRoot);
    requireMatchingRecovery(cutover, rehearsalInventory({ mode, dataRoot: recoveryRoot }));
    stores = await openStores(recoveryRoot, fixtures, false, now);
    const reopened = snap('09-reopened', recoveryRoot);
    const recovery = requireMatchingRecovery(cutover, reopened);
    balances(15);
    for (const request of requests) {
      const child = children.find(child => child.child_id === request.child_id), p = child && actor(child), data = request.data;
      let result;
      switch (request.kind) {
        case 'submit': result = stores.core.submit(p, data, now()); break;
        case 'draft': result = await stores.editor.saveDraft(stores.editor.authenticate(editor.editor_id, editor.access_secret), data, now()); break;
        case 'favorite': result = stores.library.setFavorite(p, data, now()); break;
        case 'reading': result = stores.library.openReading(p, data, now()); break;
        case 'progress': result = stores.library.updateReading(p, data, now()); break;
        case 'monster': result = stores.game.selectMonster(p, data, now()); break;
        case 'goal': result = stores.gifts.setGoal(p, data, now()); break;
        case 'import': result = stores.game.importLegacy(staff, data, now()); break;
        case 'purchase': result = stores.gifts.redeem(p, data, now()); break;
        case 'refund': result = stores.gifts.refund(staff, data, now()); break;
        default: throw Error('unknown_rehearsal_operation');
      }
      assert.deepEqual(result, { ...request.result, replayed: true }, request.kind);
      replayProof.push({ kind: request.kind, original_response_sha256: digest(request.result), replay_matches: true, ...(request.kind === 'purchase' ? { original_receipt_balance: result.balance, current_wallet_balance: stores.core.wallet(p, child.child_id).balance } : {}) });
    }
    requireMatchingRecovery(reopened, snap('10-after-replay', recoveryRoot));
    for (const child of children) {
      assert.equal(stores.core.read(actor(child), child.child_id, child.active.session_id).content_sha256, child.active.content_sha256);
      assert.deepEqual(stores.game.legacySource(staff, child.child_id), inputs.find(input => input.child_id === child.child_id).snapshot);
      await practice(child, child.child_id + '-after-recovery', '1.2', false);
    }
    balances(20);
    const final = snap('11-final', recoveryRoot);
    for (const row of cutover.tables.ledger) assert.ok(final.tables.ledger.some(current => canonical(current) === canonical(row)), 'Cutover ledger lost');
    for (const row of cutover.tables.redemptions) assert.ok(final.tables.redemptions.some(current => canonical(current) === canonical(row)), 'Cutover debit/refund lost');
    stores.close(); stores = undefined;
    const report = syntheticQAReport({ mode, dataRoot: recoveryRoot });
    assert.equal(report.value_safety.wallet_drift, 0);
    assert.deepEqual(runtimeHashes(), sources, 'Runtime changed during rehearsal');
    const result = { format: 1, purpose: 'read2lead-local-synthetic-migration-rehearsal', ok: true, mode, children: children.map(child => ({ child_id: child.child_id, level: child.level, active_contract: child.apiVersion, balances: { opening: 10, imported: 10, cutover: 15, recovered: 15, final: 20 }, active_pin: child.active.content_sha256 })), tables: Object.keys(final.tables).length, source_digests: plan.inputs, import_second_pass_sha256: secondPass.sha256, first_import_sha256: imported.sha256, stale_source_refused: true, stale_opening_backup_refused: true, backup, recovery, replayed_requests: replayProof.length, new_requests_after_recovery: requests.length - replayProof.length, post_recovery_new_credit: 5, runtime: { node: process.version, source_sha256: sources }, limitations: ['Synthetic fixtures only; no live child data or production migration.', 'Compatible recovery uses the identical verified store implementation supporting 1.1 and 1.2, not an arbitrary older binary.', 'Historical diamonds and coins are archived only; production balance mapping O09 remains undecided.', 'Human pilot, independent review and production rollout are unperformed.'], operational_report: report };
    write(outputRoot, '12-replay-proof.json', replayProof);
    write(outputRoot, '13-request-archive.json', requests);
    write(outputRoot, 'RESULT.json', result);
    writeFileSync(join(outputRoot, 'ROLLBACK.md'), '# Local synthetic recovery rehearsal\n\nPASS. This directory contains synthetic data and fixture credentials only. Keep it private.\n\n1. Stop every writer before selecting a recovery source. Preserve the source database and all evidence.\n2. Capture the CURRENT all-table inventory, integrity check and consistent backup. The opening backup is evidence only: it has 10 diamonds per child and lacks later requests. Restoring it would lose credits, debits and refunds.\n3. Use a new explicitly marked synthetic target. This rehearsal copied current-backup to recovered and required exact schema/all-row hashes before opening a writer. All 33 tables matched. No existing target was overwritten.\n4. Reopen the same source-hash-bound compatible stores recorded in RESULT.json. Verify old 1.1/1.2 sessions and all original receipts; a replay returns its original receipt balance, while the current wallet stays 15.\n5. The new 1.2 reading credit after recovery increases the current wallet to 20. One purchase per child remains debited; the other is refunded. Compare 08-cutover, 09-reopened, 10-after-replay and 11-final, plus 12-replay-proof.\n6. If any schema, row, source digest, receipt or balance differs, stop that rehearsal. Retain its directory for diagnosis; never overwrite with a stale backup. Rerun the fixed-fixture CLI with a DIFFERENT new absolute output path after repair.\n\nNo production rollback is authorized or demonstrated. Do not copy these fixture credentials or databases to production. Historical raw diamonds/coins remain archived without conversion. A different older binary requires separate compatibility proof. Human pilot, final QA and production rollout remain pending.\n', { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    write(outputRoot, 'FAILED.json', { ok: false, message: error.message, evidence_retained: true });
    throw error;
  } finally { stores?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--synthetic-local' || args[1] !== '--output-root') {
    console.error('Usage: node scripts/read2lead-self-learn-migration-rehearsal.mjs --synthetic-local --output-root /absolute/new/private-folder');
    process.exitCode = 2;
  } else {
    try { const result = await runSyntheticMigrationRehearsal({ mode, outputRoot: args[2] }); console.log(JSON.stringify({ ok: result.ok, children: result.children.length, tables: result.tables, replayed_requests: result.replayed_requests, output: args[2] })); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
