/** Synthetic editorial persistence; HTTP authority and learner availability integration are separate. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { StoreError, syntheticDatabasePath } from './read2lead-self-learn-sqlite.mjs';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import { validateEditorLesson, technicalReviewFor, matchesTechnicalReview } from '../../functions/lib/read2lead/self-learn/editor-policy.mjs';
const schema = readFileSync(new URL('../../migrations/read2lead-self-learn/004-local-editor.sql', import.meta.url), 'utf8');
const tables = ['editor_accounts', 'editor_audit', 'editor_blocks', 'editor_documents', 'editor_receipts', 'editor_reviews', 'editor_revisions'];
const schemaObjects = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name LIKE 'editor_%' ORDER BY type,name").all();
const reference = new DatabaseSync(':memory:');
let expectedSchema;
try { reference.exec('CREATE TABLE r2l_meta(key TEXT PRIMARY KEY,value TEXT);'); reference.exec(schema); expectedSchema = canonical(schemaObjects(reference)); }
finally { reference.close(); }
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const requireThat = (ok, code) => { if (!ok) throw new StoreError(code); };
const syntheticId = v => validId(v) && v.startsWith('synthetic-');
const revision = v => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER;
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const text = (v, max) => typeof v === 'string' && v === v.trim() && v.length > 0 && [...v].length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const secret = v => typeof v === 'string' && v.length >= 12 && v.length <= 64 && /^[\x21-\x7e]+$/.test(v);
const sha = v => createHash('sha256').update(v).digest('hex');
const derive = (value, salt) => scryptSync(value, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const digest = v => sha(canonical(v));
export class SyntheticEditorStore {
  #db; #fault;
  constructor({ mode, root, fault = () => {} } = {}) {
    requireThat(mode === 'synthetic-local', 'unsafe_editor_mode');
    const path = syntheticDatabasePath(root); requireThat(existsSync(path), 'core_store_required');
    this.#db = new DatabaseSync(path); this.#fault = fault;
    try {
      requireThat(this.#db.prepare("SELECT value FROM r2l_meta WHERE key='library_schema_version'").get()?.value === '1', 'library_store_required');
      const check = () => {
        const version = this.#db.prepare("SELECT value FROM r2l_meta WHERE key='editor_schema_version'").get()?.value;
        const present = this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'editor_%' ORDER BY name").all().map(r => r.name);
        requireThat(version === undefined || version === '1', 'unsupported_editor_schema');
        requireThat(version === '1' ? canonical(present) === canonical(tables) : present.length === 0, 'unrecognized_editor_schema');
        if (version === '1') requireThat(canonical(schemaObjects(this.#db)) === expectedSchema, 'unrecognized_editor_schema'); return version;
      };
      check(); this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.#db.exec('BEGIN IMMEDIATE');
      try { if (check() === undefined) this.#db.exec(schema); this.#db.exec('COMMIT'); }
      catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.#db.close(); throw error; }
  }
  close() { this.#db.close(); }
  #staff(p) { requireThat(p?.active === true && p.role === 'staff' && syntheticId(p.id), 'unauthorized'); }
  #authorize(p) {
    requireThat(p?.active === true && p.role === 'editor' && syntheticId(p.editorId) && Number.isSafeInteger(p.credentialVersion), 'editor_required');
    const account = this.#db.prepare('SELECT * FROM editor_accounts WHERE id=?').get(p.editorId);
    requireThat(account?.enabled === 1 && account.credential_version === p.credentialVersion, 'editor_access_revoked'); return account;
  }
  #principal(p) {
    const snapshot = Object.freeze({ active: p?.active, role: p?.role, editorId: p?.editorId, credentialVersion: p?.credentialVersion });
    this.#authorize(snapshot); return snapshot;
  }
  #transaction(fn) {
    this.#fault('editor_before_write_lock'); let committed = false; this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#fault('editor_before_commit'); this.#db.exec('COMMIT'); committed = true; this.#fault('editor_after_commit'); return result; }
    catch (error) { if (!committed) this.#db.exec('ROLLBACK'); throw error; }
  }
  #read(principal, fn) {
    principal = this.#principal(principal);
    this.#db.exec('BEGIN');
    try { this.#authorize(principal); const value = fn(); this.#db.exec('COMMIT'); return value; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #operation(editorId, requestId, payload, authorize, fn) {
    requireThat(validId(requestId), 'invalid_request'); const hash = digest(payload);
    return this.#transaction(() => {
      authorize();
      const previous = this.#db.prepare('SELECT payload_sha256,response_json FROM editor_receipts WHERE editor_id=? AND request_id=?').get(editorId, requestId);
      if (previous) { requireThat(previous.payload_sha256 === hash, 'request_conflict'); return { ...JSON.parse(previous.response_json), replayed: true }; }
      const result = { ...fn(), replayed: false };
      this.#db.prepare('INSERT INTO editor_receipts VALUES(?,?,?,?)').run(editorId, requestId, hash, JSON.stringify(result));
      this.#fault('editor_receipt_inserted'); return result;
    });
  }
  #op(principal, requestId, payload, fn, sessionGuard = () => {}) { return this.#operation(principal.editorId, requestId, payload, () => { sessionGuard(); this.#authorize(principal); }, fn); }
  #audit(actorId, action, doc, contentRevision, reason, now) {
    this.#db.prepare('INSERT INTO editor_audit(actor_id,action,lesson_id,content_revision,document_revision,reason,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(actorId, action, doc?.lesson_id ?? null, contentRevision ?? null, doc?.revision ?? null, reason, now);
    this.#fault('editor_audit_inserted');
  }
  #document(id, expected) {
    requireThat(validId(id), 'invalid_request'); const doc = this.#db.prepare('SELECT * FROM editor_documents WHERE lesson_id=?').get(id);
    requireThat(doc, 'editor_document_not_found');
    if (expected !== undefined) requireThat(doc.revision === expected, 'stale_revision'); return doc;
  }
  #content(id, version) {
    const row = this.#db.prepare('SELECT * FROM editor_revisions WHERE lesson_id=? AND revision=?').get(id, version);
    requireThat(row, 'editor_revision_not_found'); return row;
  }
  #metadata(doc) {
    const head = this.#content(doc.lesson_id, doc.head_revision), lesson = JSON.parse(head.lesson_json);
    const published = doc.published_revision === null ? null : this.#content(doc.lesson_id, doc.published_revision);
    return { lesson_id: doc.lesson_id, title_en: lesson.title_en, level: lesson.level, revision: doc.revision, head_revision: doc.head_revision,
      head_sha256: head.content_sha256, workflow: doc.workflow, published_revision: doc.published_revision,
      published_sha256: published?.content_sha256 ?? null, head_blocked: this.#blocked(doc.lesson_id, head.content_sha256),
      published_available: !!published && !this.#blocked(doc.lesson_id, published.content_sha256), publication_scope: 'synthetic_qa_only', human_review: false };
  }
  #change(doc, workflow, now, published = doc.published_revision) {
    requireThat(revision(doc.revision + 1), 'revision_limit');
    const changed = this.#db.prepare('UPDATE editor_documents SET revision=revision+1,workflow=?,published_revision=?,updated_at=? WHERE lesson_id=? AND revision=?')
      .run(workflow, published, now, doc.lesson_id, doc.revision); requireThat(Number(changed.changes) === 1, 'stale_revision');
    this.#fault('editor_document_updated'); return this.#document(doc.lesson_id);
  }
  #blocked(id, hash) { return this.#db.prepare('SELECT blocked FROM editor_blocks WHERE lesson_id=? AND content_sha256=?').get(id, hash)?.blocked === 1; }
  seed(staff, data, now) {
    staff = Object.freeze({ ...staff }); this.#staff(staff);
    data = structuredClone(data);
    requireThat(exact(data, ['editor_id', 'display_name', 'access_secret']) && syntheticId(data.editor_id) && text(data.display_name, 80) && secret(data.access_secret) && timestamp(now), 'invalid_request');
    return this.#transaction(() => {
      if (this.#db.prepare('SELECT id FROM editor_accounts WHERE id=?').get(data.editor_id)) return { ok: true, seeded: false };
      requireThat(this.#db.prepare('SELECT count(*) AS n FROM editor_accounts').get().n < 10, 'editor_account_limit');
      const salt = randomBytes(16).toString('hex'), hash = derive(data.access_secret, salt).toString('hex');
      this.#db.prepare('INSERT INTO editor_accounts VALUES(?,?,?,?,1,1)').run(data.editor_id, data.display_name, salt, hash);
      this.#audit(staff.id, 'account_seeded', null, null, data.editor_id, now); return { ok: true, seeded: true };
    });
  }
  authenticate(editorId, accessSecret) {
    requireThat(syntheticId(editorId) && secret(accessSecret), 'invalid_editor_access');
    const row = this.#db.prepare('SELECT * FROM editor_accounts WHERE id=?').get(editorId);
    requireThat(row?.enabled === 1 && /^[a-f0-9]{32}$/.test(row.access_salt) && /^[a-f0-9]{64}$/.test(row.access_hash) && timingSafeEqual(derive(accessSecret, row.access_salt), Buffer.from(row.access_hash, 'hex')), 'invalid_editor_access');
    return { active: true, role: 'editor', editorId: row.id, credentialVersion: row.credential_version };
  }
  setAccessEnabled(staff, data, now) {
    staff = Object.freeze({ ...staff }); this.#staff(staff);
    data = structuredClone(data);
    requireThat(exact(data, ['request_id', 'editor_id', 'expected_credential_version', 'enabled']) && syntheticId(data.editor_id) && revision(data.expected_credential_version) && typeof data.enabled === 'boolean' && timestamp(now), 'invalid_request');
    return this.#operation(data.editor_id, data.request_id, { operation: 'access_changed', actor_id: staff.id, ...data }, () => this.#staff(staff), () => {
      const row = this.#db.prepare('SELECT * FROM editor_accounts WHERE id=?').get(data.editor_id);
      requireThat(row && row.credential_version === data.expected_credential_version, 'stale_revision'); requireThat(revision(row.credential_version + 1), 'revision_limit');
      this.#db.prepare('UPDATE editor_accounts SET enabled=?,credential_version=credential_version+1 WHERE id=?').run(Number(data.enabled), data.editor_id);
      this.#audit(staff.id, 'access_changed', null, null, data.editor_id, now);
      return { ok: true, editor_id: data.editor_id, credential_version: row.credential_version + 1, enabled: data.enabled };
    });
  }
  /** Lock editor authorization around a synchronous transaction in the separate publisher DB. */
  withPublisherCommit(principal, work, sessionGuard = () => {}) {
    const snapshot = this.#principal(principal); requireThat(typeof work === 'function', 'invalid_request');
    return this.#transaction(() => {
      sessionGuard(); this.#authorize(snapshot); const result = work();
      requireThat(!result || typeof result.then !== 'function', 'invalid_request');
      sessionGuard(); this.#authorize(snapshot); return result;
    });
  }
  access(principal) {
    principal = this.#principal(principal);
    return this.#read(principal, () => { const row = this.#db.prepare('SELECT id,display_name FROM editor_accounts WHERE id=?').get(principal.editorId); return { editor_id: row.id, display_name: row.display_name, role: 'editor' }; });
  }
  list(principal) { return this.#read(principal, () => this.#db.prepare('SELECT * FROM editor_documents ORDER BY updated_at DESC,lesson_id').all().map(d => this.#metadata(d))); }
  document(principal, id) {
    return this.#read(principal, () => {
      const doc = this.#document(id); return { document: this.#metadata(doc), lesson: JSON.parse(this.#content(id, doc.head_revision).lesson_json),
        revisions: this.#db.prepare('SELECT revision,content_sha256,created_by,created_at FROM editor_revisions WHERE lesson_id=? ORDER BY revision DESC').all(id),
        reviews: this.#db.prepare('SELECT id,content_revision,content_sha256,decision,review_json,note,created_by,created_at FROM editor_reviews WHERE lesson_id=? ORDER BY rowid DESC').all(id).map(r => ({ ...r, review_json: JSON.parse(r.review_json) })),
        blocks: this.#db.prepare('SELECT content_sha256,blocked,revision,reason,updated_by,updated_at FROM editor_blocks WHERE lesson_id=? ORDER BY content_sha256').all(id) };
    });
  }
  audit(principal, id) { return this.#read(principal, () => { if (id !== undefined) this.#document(id); return id === undefined ? this.#db.prepare('SELECT * FROM editor_audit ORDER BY id').all() : this.#db.prepare('SELECT * FROM editor_audit WHERE lesson_id=? ORDER BY id').all(id); }); }
  async saveDraft(principal, data, now, sessionGuard = () => {}) {
    principal = this.#principal(principal);
    requireThat(exact(data, ['request_id', 'expected_revision', 'lesson']) && validId(data.request_id) && revision(data.expected_revision) && timestamp(now), 'invalid_request');
    const { request_id, expected_revision } = data;
    const snapshot = await validateEditorLesson({ mode: 'synthetic-local', lesson: data.lesson });
    return this.#op(principal, request_id, { operation: 'draft_saved', request_id, expected_revision, lesson: snapshot.lesson }, () => {
      const id = snapshot.lesson.id, old = this.#db.prepare('SELECT * FROM editor_documents WHERE lesson_id=?').get(id);
      requireThat((old?.revision ?? 0) === expected_revision, 'stale_revision'); const contentRevision = (old?.head_revision ?? 0) + 1;
      requireThat(revision(contentRevision) && revision(expected_revision + 1), 'revision_limit');
      if (!old) this.#db.prepare("INSERT INTO editor_documents VALUES(?,1,1,NULL,'draft',?,?)").run(id, now, now);
      this.#db.prepare('INSERT INTO editor_revisions VALUES(?,?,?,?,?,?)').run(id, contentRevision, snapshot.content_sha256, JSON.stringify(snapshot.lesson), principal.editorId, now);
      this.#fault('editor_revision_inserted');
      if (old) this.#db.prepare("UPDATE editor_documents SET revision=revision+1,head_revision=?,workflow='draft',updated_at=? WHERE lesson_id=? AND revision=?").run(contentRevision, now, id, expected_revision);
      this.#fault('editor_document_updated'); const doc = this.#document(id); this.#audit(principal.editorId, 'draft_saved', doc, contentRevision, '', now);
      return { ok: true, document: this.#metadata(doc) };
    }, sessionGuard);
  }
  requestReview(principal, data, now, sessionGuard = () => {}) {
    data = structuredClone(data);
    principal = this.#principal(principal); requireThat(exact(data, ['request_id', 'lesson_id', 'expected_revision']) && validId(data.lesson_id) && revision(data.expected_revision) && timestamp(now), 'invalid_request');
    return this.#op(principal, data.request_id, { operation: 'review_requested', ...data }, () => {
      let doc = this.#document(data.lesson_id, data.expected_revision); requireThat(['draft', 'changes_requested'].includes(doc.workflow), 'invalid_editor_transition');
      doc = this.#change(doc, 'in_review', now); this.#audit(principal.editorId, 'review_requested', doc, doc.head_revision, '', now); return { ok: true, document: this.#metadata(doc) };
    }, sessionGuard);
  }
  async review(principal, data, now, sessionGuard = () => {}) {
    principal = this.#principal(principal); requireThat(exact(data, ['request_id', 'lesson_id', 'expected_revision', 'decision', 'note']) && validId(data.request_id) && validId(data.lesson_id) && revision(data.expected_revision) && ['qa_ready', 'changes_requested'].includes(data.decision) && text(data.note, 1000) && timestamp(now), 'invalid_request');
    const input = structuredClone(data);
    // Read the immutable revision before hashing; recheck authority and workflow under the write lock.
    const saved = this.#read(principal, () => { const doc = this.#document(input.lesson_id); return { doc, content: this.#content(doc.lesson_id, doc.head_revision) }; });
    const verified = await validateEditorLesson({ mode: 'synthetic-local', lesson: JSON.parse(saved.content.lesson_json) });
    requireThat(verified.content_sha256 === saved.content.content_sha256, 'editor_content_corrupt');
    const review = await technicalReviewFor(verified, { revision: saved.doc.head_revision, reviewer_id: principal.editorId, reviewed_at: now });
    return this.#op(principal, input.request_id, { operation: 'reviewed', ...input }, () => {
      let doc = this.#document(input.lesson_id, input.expected_revision); requireThat(doc.workflow === 'in_review' && doc.head_revision === saved.doc.head_revision, 'invalid_editor_transition');
      const id = 'review-' + digest([principal.editorId, input.request_id]);
      this.#db.prepare('INSERT INTO editor_reviews VALUES(?,?,?,?,?,?,?,?,?)').run(id, doc.lesson_id, doc.head_revision, verified.content_sha256, input.decision, JSON.stringify(review), input.note, principal.editorId, now);
      this.#fault('editor_review_inserted'); doc = this.#change(doc, input.decision, now); this.#audit(principal.editorId, 'reviewed', doc, doc.head_revision, input.note, now);
      return { ok: true, document: this.#metadata(doc), review_id: id };
    }, sessionGuard);
  }
  #matchingReview(id, contentRevision, hash) {
    const row = this.#db.prepare("SELECT review_json FROM editor_reviews WHERE lesson_id=? AND content_revision=? AND content_sha256=? AND decision='qa_ready' ORDER BY rowid DESC LIMIT 1").get(id, contentRevision, hash);
    requireThat(row && matchesTechnicalReview(JSON.parse(row.review_json), { lesson_id: id, revision: contentRevision, content_sha256: hash }), 'technical_review_required');
  }
  publishQA(principal, data, now, sessionGuard = () => {}) {
    data = structuredClone(data);
    principal = this.#principal(principal); requireThat(exact(data, ['request_id', 'lesson_id', 'expected_revision']) && validId(data.lesson_id) && revision(data.expected_revision) && timestamp(now), 'invalid_request');
    return this.#op(principal, data.request_id, { operation: 'qa_published', ...data }, () => {
      let doc = this.#document(data.lesson_id, data.expected_revision); requireThat(doc.workflow === 'qa_ready', 'invalid_editor_transition');
      const content = this.#content(doc.lesson_id, doc.head_revision); this.#matchingReview(doc.lesson_id, doc.head_revision, content.content_sha256);
      requireThat(!this.#blocked(doc.lesson_id, content.content_sha256), 'content_quarantined');
      doc = this.#change(doc, 'qa_published', now, doc.head_revision); this.#audit(principal.editorId, 'qa_published', doc, doc.head_revision, 'synthetic_qa_only', now);
      return { ok: true, document: this.#metadata(doc) };
    }, sessionGuard);
  }
  async setQuarantine(principal, data, now, sessionGuard = () => {}) {
    principal = this.#principal(principal); requireThat(exact(data, ['request_id', 'lesson_id', 'content_revision', 'expected_revision', 'blocked', 'reason']) && validId(data.request_id) && validId(data.lesson_id) && revision(data.content_revision) && data.content_revision > 0 && revision(data.expected_revision) && typeof data.blocked === 'boolean' && text(data.reason, 1000) && timestamp(now), 'invalid_request');
    const input = structuredClone(data);
    const saved = this.#read(principal, () => { this.#document(input.lesson_id); return this.#content(input.lesson_id, input.content_revision); });
    let review;
    if (!input.blocked) {
      const snapshot = await validateEditorLesson({ mode: 'synthetic-local', lesson: JSON.parse(saved.lesson_json) });
      requireThat(snapshot.content_sha256 === saved.content_sha256, 'editor_content_corrupt');
      review = await technicalReviewFor(snapshot, { revision: input.content_revision, reviewer_id: principal.editorId, reviewed_at: now });
    }
    return this.#op(principal, input.request_id, { operation: 'quarantine_changed', ...input }, () => {
      let doc = this.#document(input.lesson_id, input.expected_revision); const content = this.#content(doc.lesson_id, input.content_revision);
      requireThat(content.content_sha256 === saved.content_sha256, 'editor_content_corrupt');
      const old = this.#db.prepare('SELECT * FROM editor_blocks WHERE lesson_id=? AND content_sha256=?').get(doc.lesson_id, content.content_sha256);
      if (!input.blocked) {
        requireThat(old?.blocked === 1 && matchesTechnicalReview(review, { lesson_id: doc.lesson_id, revision: input.content_revision, content_sha256: content.content_sha256 }), 'technical_review_required');
        const id = 'review-' + digest([principal.editorId, input.request_id]);
        this.#db.prepare('INSERT INTO editor_reviews VALUES(?,?,?,?,?,?,?,?,?)').run(id, doc.lesson_id, input.content_revision, content.content_sha256, 'qa_ready', JSON.stringify(review), input.reason, principal.editorId, now);
        this.#fault('editor_review_inserted');
      }
      requireThat(revision((old?.revision ?? 0) + 1), 'revision_limit');
      this.#db.prepare('INSERT INTO editor_blocks VALUES(?,?,?,1,?,?,?) ON CONFLICT(lesson_id,content_sha256) DO UPDATE SET blocked=excluded.blocked,revision=editor_blocks.revision+1,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
        .run(doc.lesson_id, content.content_sha256, Number(input.blocked), input.reason, principal.editorId, now);
      this.#fault('editor_block_updated'); doc = this.#change(doc, doc.workflow, now);
      this.#audit(principal.editorId, input.blocked ? 'quarantined' : 'quarantine_released', doc, input.content_revision, input.reason, now);
      return { ok: true, document: this.#metadata(doc), content_sha256: content.content_sha256, blocked: input.blocked };
    }, sessionGuard);
  }
  /** Internal quarantine lookup; unknown pins have no editor block. Callers must also validate content and current learner/editor authority. */
  availability(lessonId, hash) {
    requireThat(validId(lessonId) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'invalid_request');
    const blocked = this.#blocked(lessonId, hash);
    return { available: !blocked, reason: blocked ? 'content_quarantined' : null };
  }
  qaCatalogue(principal) {
    return this.#read(principal, () => ({ contract_version: '1.1.0', lessons: this.#db.prepare('SELECT * FROM editor_documents WHERE published_revision IS NOT NULL ORDER BY lesson_id').all().flatMap(doc => {
      const row = this.#content(doc.lesson_id, doc.published_revision); return this.#blocked(doc.lesson_id, row.content_sha256) ? [] : [JSON.parse(row.lesson_json)];
    }), publication_scope: 'synthetic_qa_only', human_review: false }));
  }
}
