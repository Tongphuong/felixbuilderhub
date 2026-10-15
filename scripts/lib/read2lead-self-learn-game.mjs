/** Synthetic local game persistence. Legacy source is archived, never converted into wallet credit. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StoreError, syntheticDatabasePath } from './read2lead-self-learn-sqlite.mjs';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import { freeMonsterCatalogue, defaultFreeMonster, validateFreeMonster, applyGameOperation, legacyGameView, activeGameTheme } from '../../functions/lib/read2lead/self-learn/game-policy.mjs';
const schema = readFileSync(new URL('../../migrations/read2lead-self-learn/005-local-game.sql', import.meta.url), 'utf8');
const tables = ['game_audit', 'game_imports', 'game_preferences', 'game_receipts'];
const triggerNames = ['game_audit_no_delete', 'game_audit_no_update', 'game_imports_no_delete', 'game_imports_no_update', 'game_preferences_no_delete', 'game_receipts_no_delete', 'game_receipts_no_update'];
const schemaSql = x => x.replace(/\s+/g, ' ').trim();
const definitions = new Map([...schema.matchAll(/^CREATE TABLE (game_[a-z_]+) \([\s\S]*?^\);/gm), ...schema.matchAll(/^CREATE TRIGGER (game_[a-z_]+) .+;$/gm)].map(m => [m[1], schemaSql(m[0].slice(0, -1))]));
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const requireThat = (ok, code) => { if (!ok) throw new StoreError(code); };
const syntheticId = x => validId(x) && x.startsWith('synthetic-');
const revision = x => Number.isSafeInteger(x) && x >= 0 && x < Number.MAX_SAFE_INTEGER;
const timestamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const hash = x => createHash('sha256').update(x).digest('hex');
function snapshotText(value) {
  let nodes = 0;
  function check(v, depth) {
    requireThat(++nodes <= 20000 && depth <= 64, 'invalid_legacy_snapshot');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number') { requireThat(Number.isFinite(v), 'invalid_legacy_snapshot'); return; }
    requireThat(Array.isArray(v) || object(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)), 'invalid_legacy_snapshot');
    for (const child of Array.isArray(v) ? Array.from(v) : Object.values(v)) check(child, depth + 1);
  }
  requireThat(object(value), 'invalid_legacy_snapshot'); check(value, 0);
  const text = JSON.stringify(value); requireThat(Buffer.byteLength(text) <= 262144, 'legacy_snapshot_too_large'); return text;
}
function importedMonster(raw) {
  const choice = defaultFreeMonster();
  if (raw?.avatar?.monster === undefined) return choice;
  requireThat(object(raw.avatar.monster), 'legacy_monster_review_required');
  for (const key of Object.keys(choice)) if (Object.hasOwn(raw.avatar.monster, key)) choice[key] = raw.avatar.monster[key];
  try { return validateFreeMonster(choice); } catch { throw new StoreError('legacy_monster_review_required'); }
}
export class SyntheticGameStore {
  #db; #fault; #themes; #interestIds;
  constructor({ mode, root, themes, interestIds, fault = () => {} } = {}) {
    requireThat(mode === 'synthetic-local', 'unsafe_game_mode');
    // Validate configuration before creating any extension. A constructor never infers a season.
    activeGameTheme(themes, '2026-01-01T00:00:00.000Z', interestIds);
    this.#themes = structuredClone(themes); this.#interestIds = structuredClone(interestIds); this.#fault = fault;
    const path = syntheticDatabasePath(root); requireThat(existsSync(path), 'core_store_required'); this.#db = new DatabaseSync(path);
    try {
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      requireThat(this.#db.prepare("SELECT value FROM r2l_meta WHERE key='family_schema_version'").get()?.value === '1', 'family_store_required');
      const check = () => {
        const version = this.#db.prepare("SELECT value FROM r2l_meta WHERE key='game_schema_version'").get()?.value;
        const rows = this.#db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name GLOB 'game_*' ORDER BY name").all().map(r => ({ ...r, sql: schemaSql(r.sql) }));
        requireThat(version === undefined || version === '1', 'unsupported_game_schema');
        const expected = [...tables.map(name => ({ type: 'table', name })), ...triggerNames.map(name => ({ type: 'trigger', name }))].map(r => ({ ...r, sql: definitions.get(r.name) })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        requireThat(version === '1' ? canonical(rows) === canonical(expected) : rows.length === 0, 'unrecognized_game_schema'); return version;
      };
      check(); this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); this.#db.exec('BEGIN IMMEDIATE');
      try { if (check() === undefined) { this.#db.exec(schema); check(); } this.#db.exec('COMMIT'); }
      catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.#db.close(); throw error; }
  }
  close() { this.#db.close(); }
  #staff(p) { requireThat(p?.active === true && p.role === 'staff' && syntheticId(p.id), 'unauthorized'); }
  #authorize(p) {
    requireThat(p?.active === true && ['child', 'parent'].includes(p.role) && syntheticId(p.familyId) && syntheticId(p.childId) && Number.isSafeInteger(p.credentialVersion), 'unauthorized');
    const family = this.#db.prepare('SELECT credential_version FROM family_accounts WHERE id=?').get(p.familyId);
    requireThat(family?.credential_version === p.credentialVersion, 'unauthorized');
    const child = this.#db.prepare('SELECT p.*,c.family_id FROM child_profiles p JOIN children c ON c.id=p.child_id WHERE p.child_id=?').get(p.childId);
    requireThat(child?.family_id === p.familyId, 'wrong_child'); requireThat(child.archived === 0 && child.learning_enabled === 1, 'child_access_disabled'); return child;
  }
  #read(fn) { this.#db.exec('BEGIN'); try { const result = fn(); this.#db.exec('COMMIT'); return result; } catch (error) { this.#db.exec('ROLLBACK'); throw error; } }
  #transaction(fn) {
    this.#fault('game_before_write_lock'); this.#db.exec('BEGIN IMMEDIATE'); let committed = false;
    try { const result = fn(); this.#fault('game_before_commit'); this.#db.exec('COMMIT'); committed = true; this.#fault('game_after_commit'); return result; }
    catch (error) { if (!committed) this.#db.exec('ROLLBACK'); throw error; }
  }
  #operation(childId, requestId, payload, authorize, fn) {
    const digest = hash(canonical(payload));
    return this.#transaction(() => {
      authorize();
      const previous = this.#db.prepare('SELECT payload_sha256,response_json FROM game_receipts WHERE child_id=? AND request_id=?').get(childId, requestId);
      if (previous) { requireThat(previous.payload_sha256 === digest, 'request_conflict'); return { ...JSON.parse(previous.response_json), replayed: true }; }
      const result = { ...fn(), replayed: false };
      this.#db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?)').run(childId, requestId, digest, JSON.stringify(result)); this.#fault('game_receipt_inserted'); return result;
    });
  }
  #legacy(childId) {
    const row = this.#db.prepare('SELECT source_sha256,snapshot_json FROM game_imports WHERE child_id=?').get(childId);
    if (!row) return null;
    const raw = JSON.parse(row.snapshot_json); requireThat(hash(canonical(raw)) === row.source_sha256, 'legacy_hash_mismatch'); return raw;
  }
  #preferences(childId, raw = this.#legacy(childId)) {
    const row = this.#db.prepare('SELECT revision,monster_json FROM game_preferences WHERE child_id=?').get(childId);
    return { revision: row?.revision ?? 0, monster: row ? validateFreeMonster(JSON.parse(row.monster_json)) : importedMonster(raw), source: row ? 'selected' : raw?.avatar?.monster ? 'legacy_snapshot' : 'default' };
  }
  #view(child, now) {
    requireThat(timestamp(now), 'invalid_request'); const raw = this.#legacy(child.child_id);
    return { child_id: child.child_id, declared_level: child.level, preferences: this.#preferences(child.child_id, raw), legacy_progress: legacyGameView(raw, { declaredLevel: child.level }),
      wallet: { balance: this.#db.prepare('SELECT balance FROM wallets WHERE child_id=?').get(child.child_id).balance, currency: 'diamonds' }, theme: activeGameTheme(this.#themes, now, this.#interestIds), monster_policy: 'all-supported-free-v1' };
  }
  view(principal, now) { return this.#read(() => this.#view(this.#authorize(principal), now)); }
  catalogue(principal) { return this.#read(() => { this.#authorize(principal); return freeMonsterCatalogue(); }); }
  audit(principal) { return this.#read(() => { this.#authorize(principal); return this.#db.prepare('SELECT action,revision,source_sha256,created_at FROM game_audit WHERE child_id=? ORDER BY id DESC LIMIT 100').all(principal.childId); }); }
  #audit(childId, action, rev, sourceHash, actor, now) {
    this.#db.prepare('INSERT INTO game_audit(child_id,action,revision,source_sha256,created_by,created_at) VALUES(?,?,?,?,?,?)').run(childId, action, rev, sourceHash, actor, now); this.#fault('game_audit_inserted');
  }
  selectMonster(principal, data, now, authorize = () => {}) {
    this.#authorize(principal);
    requireThat(exact(data, ['request_id', 'expected_revision', 'monster']) && validId(data.request_id) && revision(data.expected_revision) && timestamp(now), 'invalid_request');
    const monster = validateFreeMonster(data.monster);
    return this.#operation(principal.childId, data.request_id, { operation: 'select_monster', expected_revision: data.expected_revision, monster }, () => { this.#authorize(principal); authorize(); }, () => {
      const current = this.#preferences(principal.childId); requireThat(current.revision === data.expected_revision, 'stale_revision'); requireThat(current.revision < Number.MAX_SAFE_INTEGER - 1, 'revision_limit');
      const next = applyGameOperation(current, { type: 'select_monster', monster });
      if (current.revision === 0) this.#db.prepare('INSERT INTO game_preferences VALUES(?,1,?,?)').run(principal.childId, JSON.stringify(next.monster), now);
      else { const updated = this.#db.prepare('UPDATE game_preferences SET revision=revision+1,monster_json=?,updated_at=? WHERE child_id=? AND revision=?').run(JSON.stringify(next.monster), now, principal.childId, current.revision); requireThat(Number(updated.changes) === 1, 'stale_revision'); }
      this.#fault('game_preferences_updated'); const preferences = this.#preferences(principal.childId); this.#audit(principal.childId, 'monster_selected', preferences.revision, null, principal.familyId, now);
      return { ok: true, preferences };
    });
  }
  refusePaidMonster(principal) { return this.#read(() => { this.#authorize(principal); throw new StoreError('monster_purchase_retired'); }); }
  importLegacy(principal, data, now) {
    this.#staff(principal);
    requireThat(exact(data, ['child_id', 'request_id', 'expected_sha256', 'snapshot']) && syntheticId(data.child_id) && validId(data.request_id) && typeof data.expected_sha256 === 'string' && /^[a-f0-9]{64}$/.test(data.expected_sha256) && timestamp(now), 'invalid_request');
    const text = snapshotText(data.snapshot), raw = JSON.parse(text), digest = hash(canonical(raw)); requireThat(digest === data.expected_sha256, 'stale_legacy_input');
    legacyGameView(raw); importedMonster(raw);
    return this.#operation(data.child_id, data.request_id, { operation: 'import_legacy', source_sha256: digest }, () => { this.#staff(principal); requireThat(!!this.#db.prepare('SELECT id FROM children WHERE id=?').get(data.child_id), 'wrong_child'); }, () => {
      const existing = this.#db.prepare('SELECT source_sha256 FROM game_imports WHERE child_id=?').get(data.child_id);
      requireThat(!existing || existing.source_sha256 === digest, 'legacy_import_conflict');
      if (!existing) { this.#db.prepare('INSERT INTO game_imports VALUES(?,?,?,?,?)').run(data.child_id, digest, text, principal.id, now); this.#fault('game_import_inserted'); this.#audit(data.child_id, 'legacy_imported', this.#preferences(data.child_id).revision, digest, principal.id, now); }
      return { ok: true, imported: { child_id: data.child_id, source_sha256: digest, already_present: !!existing } };
    });
  }
  /** Staff-only local recovery/migration read; never serialize via child/public API. */
  legacySource(principal, childId) { return this.#read(() => { this.#staff(principal); requireThat(syntheticId(childId), 'invalid_request'); return structuredClone(this.#legacy(childId)); }); }
}
