/** Local synthetic family persistence only. HTTP sessions, real identity and consent are separate. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { StoreError, syntheticDatabasePath } from './read2lead-self-learn-sqlite.mjs';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';

const schema = readFileSync(new URL('../../migrations/read2lead-self-learn/002-local-family.sql', import.meta.url), 'utf8');
const tables = ['child_profiles', 'family_accounts', 'family_audit', 'family_receipts'];
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const requireThat = (v, code) => { if (!v) throw new StoreError(code); };
const syntheticId = id => validId(id) && id.startsWith('synthetic-');
const label = v => typeof v === 'string' && v === v.trim() && v.length > 0 && [...v].length <= 80 && !/[\u0000-\u001f\u007f]/u.test(v);
const secret = (v, min = 6) => typeof v === 'string' && v.length >= min && v.length <= 64 && /^[\x21-\x7e]+$/.test(v);
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const sha = v => createHash('sha256').update(v).digest('hex');
const derive = (value, salt) => scryptSync(value, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
function hashSecret(value) { const salt = randomBytes(16).toString('hex'); return { salt, hash: derive(value, salt).toString('hex') }; }
function matches(value, salt, hash) {
  if (!secret(value) || typeof salt !== 'string' || !/^[a-f0-9]{32}$/.test(salt) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(derive(value, salt), Buffer.from(hash, 'hex'));
}
const publicProfile = row => ({ id: row.child_id, label_vi: row.display_name, level: row.level, revision: row.revision,
  archived: row.archived === 1, learning_enabled: row.learning_enabled === 1, recording_allowed: row.recording_allowed === 1 });

export class SyntheticFamilyStore {
  #db; #fault;
  constructor({ mode, root, fault = () => {} } = {}) {
    requireThat(mode === 'synthetic-local', 'unsafe_family_mode');
    const path = syntheticDatabasePath(root);
    requireThat(existsSync(path), 'core_store_required');
    this.#db = new DatabaseSync(path); this.#fault = fault;
    try {
      const version = this.#db.prepare("SELECT value FROM r2l_meta WHERE key='family_schema_version'").get()?.value;
      const present = this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('child_profiles','family_accounts','family_audit','family_receipts') ORDER BY name").all().map(r => r.name);
      requireThat(version === undefined || version === '1', 'unsupported_family_schema');
      requireThat(version === '1' ? canonical(present) === canonical(tables) : present.length === 0, 'unrecognized_family_schema');
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (version === undefined) {
        // Recheck under the writer lock so two initializers do not create a partial extension.
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          const current = this.#db.prepare("SELECT value FROM r2l_meta WHERE key='family_schema_version'").get()?.value;
          requireThat(current === undefined || current === '1', 'unsupported_family_schema');
          if (current === undefined) this.#db.exec(schema);
          this.#db.exec('COMMIT');
        } catch (e) { this.#db.exec('ROLLBACK'); throw e; }
      }
    } catch (e) { this.#db.close(); throw e; }
  }
  close() { this.#db.close(); }
  #transaction(fn) {
    let committed = false; this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#fault('family_before_commit'); this.#db.exec('COMMIT'); committed = true; this.#fault('family_after_commit'); return result; }
    catch (e) { if (!committed) this.#db.exec('ROLLBACK'); throw e; }
  }
  #staff(p) { requireThat(p?.active === true && p.role === 'staff' && syntheticId(p.id), 'unauthorized'); }
  #account(id) { return this.#db.prepare('SELECT * FROM family_accounts WHERE id=?').get(id); }
  #authorize(p, parent = false) {
    requireThat(p?.active === true && syntheticId(p.familyId) && ['child', 'parent'].includes(p.role) && Number.isSafeInteger(p.credentialVersion), 'unauthorized');
    const account = this.#account(p.familyId);
    requireThat(account && account.credential_version === p.credentialVersion, 'unauthorized');
    requireThat(!parent || p.role === 'parent', 'parent_required'); return account;
  }
  #profile(familyId, child) {
    requireThat(syntheticId(child), 'wrong_child');
    const row = this.#db.prepare('SELECT p.*,c.family_id,c.display_name FROM child_profiles p JOIN children c ON c.id=p.child_id WHERE p.child_id=?').get(child);
    requireThat(row?.family_id === familyId, 'wrong_child'); return row;
  }
  #audit(familyId, action, child, revision, now) {
    this.#db.prepare('INSERT INTO family_audit(family_id,action,child_id,revision,created_at) VALUES(?,?,?,?,?)').run(familyId, action, child, revision, now);
    this.#fault('family_audit_inserted');
  }
  #operation(familyId, requestId, payload, fn, authorize = () => {}) {
    requireThat(validId(requestId), 'invalid_request');
    // Receipts contain a fingerprint and allowlisted result, never submitted secrets.
    const digest = sha(canonical(payload));
    return this.#transaction(() => {
      authorize();
      const prior = this.#db.prepare('SELECT payload_sha256,response_json FROM family_receipts WHERE family_id=? AND request_id=?').get(familyId, requestId);
      if (prior) { requireThat(prior.payload_sha256 === digest, 'request_conflict'); return { ...JSON.parse(prior.response_json), replayed: true }; }
      const result = { ...fn(), replayed: false };
      this.#db.prepare('INSERT INTO family_receipts VALUES(?,?,?,?)').run(familyId, requestId, digest, JSON.stringify(result));
      this.#fault('family_receipt_inserted'); return result;
    });
  }
  seed(principal, data, now) {
    this.#staff(principal);
    requireThat(exact(data, ['family_id', 'label_vi', 'access_code', 'parent_secret', 'recovery_code', 'children']) && syntheticId(data.family_id) && label(data.label_vi) &&
      secret(data.access_code) && secret(data.parent_secret, 12) && secret(data.recovery_code, 20) && new Set([data.access_code, data.parent_secret, data.recovery_code]).size === 3 && timestamp(now) && Array.isArray(data.children) && data.children.length > 0 && data.children.length <= 10 &&
      data.children.every(c => exact(c, ['child_id', 'display_name', 'level']) && syntheticId(c.child_id) && label(c.display_name) && /^L[0-5]$/.test(c.level)) && new Set(data.children.map(c => c.child_id)).size === data.children.length, 'invalid_request');
    return this.#transaction(() => {
      if (this.#account(data.family_id)) return { ok: true, seeded: false }; // Preserve recovered credentials and edited profiles on restart.
      requireThat(this.#db.prepare('SELECT count(*) AS n FROM family_accounts').get().n < 20, 'family_limit');
      requireThat(!this.#db.prepare('SELECT access_salt,access_hash FROM family_accounts').all().some(r => matches(data.access_code, r.access_salt, r.access_hash)), 'access_conflict');
      const a = hashSecret(data.access_code), p = hashSecret(data.parent_secret), r = hashSecret(data.recovery_code);
      this.#db.prepare('INSERT INTO family_accounts VALUES(?,?,?,?,?,?,?,?,1)').run(data.family_id, data.label_vi, a.salt, a.hash, p.salt, p.hash, r.salt, r.hash);
      for (const child of data.children) {
        const existing = this.#db.prepare('SELECT family_id FROM children WHERE id=?').get(child.child_id);
        if (existing) {
          requireThat(existing.family_id === data.family_id, 'wrong_child');
          requireThat(!!this.#db.prepare('SELECT child_id FROM wallets WHERE child_id=?').get(child.child_id), 'inconsistent_core_child');
        } else {
          this.#db.prepare('INSERT INTO children VALUES(?,?,?)').run(child.child_id, data.family_id, child.display_name);
          this.#db.prepare('INSERT INTO wallets VALUES(?,0)').run(child.child_id);
        }
        this.#db.prepare('INSERT INTO child_profiles(child_id,level,learning_enabled) VALUES(?,?,1)').run(child.child_id, child.level);
      }
      this.#audit(data.family_id, 'seeded', null, 1, now); return { ok: true, seeded: true };
    });
  }
  authenticateAccess(accessCode) {
    requireThat(secret(accessCode), 'invalid_access');
    const account = this.#db.prepare('SELECT id,access_salt,access_hash,credential_version FROM family_accounts ORDER BY id').all().find(r => matches(accessCode, r.access_salt, r.access_hash));
    requireThat(account, 'invalid_access');
    return { active: true, role: 'child', familyId: account.id, credentialVersion: account.credential_version };
  }
  elevateParent(principal, parentSecret) {
    const account = this.#authorize(principal);
    requireThat(matches(parentSecret, account.parent_salt, account.parent_hash), 'invalid_access');
    return { active: true, role: 'parent', familyId: account.id, credentialVersion: account.credential_version };
  }
  familyView(principal) {
    const account = this.#authorize(principal);
    const children = this.#db.prepare('SELECT p.*,c.display_name FROM child_profiles p JOIN children c ON c.id=p.child_id WHERE c.family_id=? ORDER BY c.rowid').all(account.id)
      .filter(r => principal.role === 'parent' || (!r.archived && r.learning_enabled)).map(publicProfile);
    return { family_id: account.id, label_vi: account.label_vi, consent_scope: 'synthetic_local_only', children };
  }
  childAccess(principal, childId) {
    const account = this.#authorize(principal), row = this.#profile(account.id, childId);
    requireThat(!row.archived && row.learning_enabled === 1, 'child_access_disabled');
    return publicProfile(row);
  }
  createChild(principal, data, now) {
    const account = this.#authorize(principal, true);
    requireThat(exact(data, ['request_id', 'display_name']) && label(data.display_name) && timestamp(now), 'invalid_request');
    return this.#operation(account.id, data.request_id, { operation: 'create_child', ...data }, () => {
      requireThat(this.#db.prepare('SELECT count(*) AS n FROM children WHERE family_id=?').get(account.id).n < 10, 'child_limit');
      const childId = 'synthetic-child-' + sha(canonical([account.id, data.request_id])).slice(0, 32);
      this.#db.prepare('INSERT INTO children VALUES(?,?,?)').run(childId, account.id, data.display_name); this.#fault('family_child_inserted');
      this.#db.prepare('INSERT INTO wallets VALUES(?,0)').run(childId); this.#fault('family_wallet_inserted');
      this.#db.prepare("INSERT INTO child_profiles(child_id,level) VALUES(?,'L0')").run(childId); this.#fault('family_profile_inserted');
      this.#audit(account.id, 'child_created', childId, 0, now);
      return { ok: true, profile: publicProfile(this.#profile(account.id, childId)) };
    }, () => this.#authorize(principal, true));
  }
  updateChild(principal, data, now) {
    const account = this.#authorize(principal, true);
    requireThat(data?.child_id && this.#profile(account.id, data.child_id), 'wrong_child');
    requireThat(exact(data, ['request_id', 'child_id', 'expected_revision', 'display_name', 'archived', 'learning_enabled', 'recording_allowed']) && label(data.display_name) && Number.isSafeInteger(data.expected_revision) && data.expected_revision >= 0 && ['archived', 'learning_enabled', 'recording_allowed'].every(k => typeof data[k] === 'boolean') && (!data.recording_allowed || data.learning_enabled) && timestamp(now), 'invalid_request');
    return this.#operation(account.id, data.request_id, { operation: 'update_child', ...data }, () => {
      const row = this.#profile(account.id, data.child_id);
      requireThat(row.revision === data.expected_revision, 'stale_revision');
      if (data.archived && !row.archived) requireThat(this.#db.prepare('SELECT count(*) AS n FROM child_profiles p JOIN children c ON c.id=p.child_id WHERE c.family_id=? AND p.archived=0').get(account.id).n > 1, 'last_active_child');
      const update = this.#db.prepare('UPDATE child_profiles SET revision=revision+1,archived=?,learning_enabled=?,recording_allowed=? WHERE child_id=? AND revision=?').run(Number(data.archived), Number(data.learning_enabled), Number(data.recording_allowed), data.child_id, data.expected_revision);
      requireThat(Number(update.changes) === 1, 'stale_revision');
      this.#db.prepare('UPDATE children SET display_name=? WHERE id=? AND family_id=?').run(data.display_name, data.child_id, account.id); this.#fault('family_profile_updated');
      this.#audit(account.id, 'profile_updated', data.child_id, row.revision + 1, now);
      return { ok: true, profile: publicProfile(this.#profile(account.id, data.child_id)) };
    }, () => this.#authorize(principal, true));
  }
  recover(data, now) {
    requireThat(exact(data, ['family_id', 'request_id', 'recovery_code', 'new_access_code', 'new_parent_secret', 'new_recovery_code']) && syntheticId(data.family_id) && secret(data.recovery_code, 20) && secret(data.new_access_code) && secret(data.new_parent_secret, 12) && secret(data.new_recovery_code, 20) && data.recovery_code !== data.new_recovery_code && new Set([data.new_access_code, data.new_parent_secret, data.new_recovery_code]).size === 3 && timestamp(now), 'invalid_request');
    requireThat(this.#account(data.family_id), 'invalid_access');
    return this.#operation(data.family_id, data.request_id, { operation: 'recover', ...data }, () => {
      const account = this.#account(data.family_id);
      requireThat(matches(data.recovery_code, account.recovery_salt, account.recovery_hash), 'invalid_access');
      requireThat(!matches(data.new_access_code, account.access_salt, account.access_hash) && !matches(data.new_parent_secret, account.parent_salt, account.parent_hash), 'credential_unchanged');
      requireThat(!this.#db.prepare('SELECT id,access_salt,access_hash FROM family_accounts WHERE id!=?').all(data.family_id).some(r => matches(data.new_access_code, r.access_salt, r.access_hash)), 'access_conflict');
      const a = hashSecret(data.new_access_code), p = hashSecret(data.new_parent_secret), r = hashSecret(data.new_recovery_code);
      this.#db.prepare('UPDATE family_accounts SET access_salt=?,access_hash=?,parent_salt=?,parent_hash=?,recovery_salt=?,recovery_hash=?,credential_version=credential_version+1 WHERE id=?').run(a.salt, a.hash, p.salt, p.hash, r.salt, r.hash, account.id);
      this.#fault('family_credentials_rotated');
      this.#audit(account.id, 'credentials_recovered', null, account.credential_version + 1, now);
      return { ok: true, credential_version: account.credential_version + 1 };
    });
  }
  audit(principal) {
    const account = this.#authorize(principal, true);
    return this.#db.prepare('SELECT id,action,child_id,revision,created_at FROM family_audit WHERE family_id=? ORDER BY id').all(account.id);
  }
}
