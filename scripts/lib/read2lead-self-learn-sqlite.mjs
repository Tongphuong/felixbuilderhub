/** Node-only, synthetic local proof. No network client or production adapter. */
import { requireAvailableContent, requireCurrentPublication } from './read2lead-self-learn-content.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, join } from 'node:path';
import { createSession, applyEvent, publicSession, STAGES } from '../../functions/lib/read2lead/self-learn/session.mjs';
import { createJourney, applyJourneyEvent } from '../../functions/lib/read2lead/self-learn/journey.mjs';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import { validStoreEvent as validEvent } from '../../src/lib/read2lead/self-learn/publisher-session-contract.mjs';
import { createPublisherJourney, applyPublisherEvent } from '../../functions/lib/read2lead/self-learn/publisher-journey.mjs';
import { isPublisherRuntime, isApprovedPublisherRuntime, isPrivateRehearsalRuntime } from './read2lead-publisher-runtime.mjs';
const APPLICATION_ID = 0x52324c31;
const schema = readFileSync(new URL('../../migrations/read2lead-self-learn/001-local-proof.sql', import.meta.url), 'utf8');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const shortText = (v, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export class StoreError extends Error { constructor(code) { super(code); this.code = code; } }
const requireThat = (condition, code) => { if (!condition) throw new StoreError(code); };
export function syntheticDatabasePath(root) {
  try {
    requireThat(typeof root === 'string' && isAbsolute(root) && realpathSync(root) === resolve(root), 'unsafe_target');
    const marker = join(root, 'synthetic-target.json');
    requireThat(!lstatSync(marker).isSymbolicLink(), 'unsafe_target');
    const data = JSON.parse(readFileSync(marker, 'utf8'));
    requireThat(exact(data, ['format', 'purpose', 'database']) && data.format === 1 && data.purpose === 'read2lead-local-synthetic' && data.database === 'read2lead-synthetic.sqlite', 'unsafe_target');
    const path = join(root, data.database);
    requireThat(!existsSync(path) || (lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()), 'unsafe_target');
    if (existsSync(path)) {
      const check = new DatabaseSync(path, { readOnly: true });
      try {
        // Match the store's bounded lock wait before checking identity; never skip the checks.
        check.exec('PRAGMA busy_timeout=5000');
        requireThat(check.prepare('PRAGMA application_id').get().application_id === APPLICATION_ID, 'unsafe_target');
        requireThat(check.prepare("SELECT value FROM r2l_meta WHERE key='environment'").get()?.value === 'synthetic', 'unsafe_target');
        requireThat(check.prepare("SELECT value FROM r2l_meta WHERE key='schema_version'").get()?.value === '1', 'unsupported_schema');
      } finally { check.close(); }
    }
    return path;
  } catch (error) { if (error instanceof StoreError) throw error; throw new StoreError('unsafe_target'); }
}
export class SyntheticStore {
  #db; #fault; #editorContent; #publisher;
  constructor({ root, fault = () => {}, editorContent = false, publisherRuntime = null }) {
    requireThat(typeof editorContent === 'boolean', 'invalid_content_mode'); this.#editorContent = editorContent;
    requireThat(publisherRuntime === null || isPublisherRuntime(publisherRuntime), 'invalid_publisher_runtime'); this.#publisher = publisherRuntime;
    const path = syntheticDatabasePath(root); // Check before opening for write or running SQL.
    this.#fault = fault; this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.#db.exec(schema);
  }
  close() { this.#db.close(); }
  #boundary(name) { this.#fault(name); }
  #transaction(fn) {
    let committed = false;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(); this.#boundary('before_commit'); this.#db.exec('COMMIT'); committed = true;
      this.#boundary('after_commit'); return result;
    } catch (error) {
      if (!committed) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  #staff(principal) { requireThat(principal?.active === true && principal.role === 'staff' && validId(principal.id) && principal.id.startsWith('synthetic-'), 'unauthorized'); }
  #child(principal, child) {
    requireThat(principal?.active === true && validId(principal.childId), 'unauthorized');
    requireThat(principal.childId === child, 'wrong_child');
    requireThat(!!this.#db.prepare('SELECT id FROM children WHERE id=?').get(child), 'wrong_child');
  }
  #wallet(child) { return this.#db.prepare('SELECT balance FROM wallets WHERE child_id=?').get(child)?.balance; }
  #operation(scope, requestId, payload, fn, authorize = () => {}) {
    requireThat(validId(requestId), 'invalid_request'); const body = canonical(payload);
    return this.#transaction(() => {
      authorize();
      const previous = this.#db.prepare('SELECT payload,response FROM receipts WHERE actor_scope=? AND request_id=?').get(scope, requestId);
      if (previous) { requireThat(previous.payload === body, 'request_conflict'); return { ...JSON.parse(previous.response), replayed: true }; }
      const result = JSON.parse(JSON.stringify({ ...fn(), replayed: false }));
      this.#db.prepare('INSERT INTO receipts(actor_scope,request_id,payload,response) VALUES(?,?,?,?)').run(scope, requestId, body, JSON.stringify(result));
      this.#boundary('receipt_inserted'); return result;
    });
  }
  registerChild(principal, data) {
    this.#staff(principal);
    requireThat(exact(data, ['child_id', 'family_id', 'display_name']) && validId(data.child_id) && data.child_id.startsWith('synthetic-') && validId(data.family_id) && data.family_id.startsWith('synthetic-') && shortText(data.display_name, 80), 'invalid_request');
    return this.#transaction(() => {
      const old = this.#db.prepare('SELECT * FROM children WHERE id=?').get(data.child_id);
      if (old) { requireThat(old.family_id === data.family_id && old.display_name === data.display_name, 'child_conflict'); return old; }
      this.#db.prepare('INSERT INTO children VALUES(?,?,?)').run(data.child_id, data.family_id, data.display_name);
      this.#db.prepare('INSERT INTO wallets(child_id,balance) VALUES(?,0)').run(data.child_id);
      return data;
    });
  }
  async start(principal, { sessionId, childId, lesson, publisherPackage, now, apiVersion = '1.1' }, authorize = () => {}) {
    this.#child(principal, childId);
    requireThat(['1.1', '1.2', '1.3'].includes(apiVersion), 'invalid_request');
    // Publisher runtime publication must use its own content gate; never route it through the original-only editor.
    requireThat(apiVersion !== '1.3' || ((!this.#editorContent || this.#publisher) && publisherPackage?.lesson?.source?.kind === ((isApprovedPublisherRuntime(this.#publisher)||isPrivateRehearsalRuntime(this.#publisher))?'user_supplied_publisher':'synthetic_fixture')), 'publisher_runtime_not_enabled');
    const record = await (apiVersion === '1.3' ? createPublisherJourney({ sessionId, childId, package: publisherPackage, now }) :
      (apiVersion === '1.2' ? createJourney : createSession)({ sessionId, childId, lesson, now })); // No transaction held across async work.
    if (this.#editorContent) this.#boundary('content_before_write_lock');
    return this.#transaction(() => {
      authorize(); // Optional boundary recheck after hashing, before any session write.
      const old = this.#db.prepare('SELECT child_id,record_json FROM sessions WHERE id=?').get(sessionId);
      if (old) {
        requireThat(old.child_id === childId, 'wrong_child'); const stored = JSON.parse(old.record_json);
        requireThat(stored.session.content_sha256 === record.session.content_sha256, 'session_conflict');
        if (apiVersion === '1.3') requireThat(stored.session.schema_version === '1.3.0' && stored.publisher_package_sha256 === record.publisher_package_sha256, 'session_conflict');
        this.#available(stored);
        return { ok: true, session: publicSession(stored), replayed: true };
      }
      if (record.session.schema_version === '1.3.0' && this.#publisher) this.#publisher.assertRecord(record);
      else if (this.#editorContent) requireCurrentPublication(this.#db, record.lesson.id, record.session.content_sha256);
      this.#db.prepare('INSERT INTO sessions(id,child_id,revision,record_json) VALUES(?,?,0,?)').run(sessionId, childId, JSON.stringify(record));
      return { ok: true, session: publicSession(record), replayed: false };
    });
  }
  read(principal, child, session) {
    if (this.#editorContent || this.#publisher) return publicSession(this.availableRecord(principal, child, session));
    this.#child(principal, child); const row = this.#db.prepare('SELECT child_id,record_json FROM sessions WHERE id=?').get(session);
    requireThat(row?.child_id === child, 'wrong_child'); return publicSession(JSON.parse(row.record_json));
  }
  /** Private domain read. Handlers must project a public view, never serialize this record. */
  record(principal, child, session) {
    this.#child(principal, child);
    const row = this.#db.prepare('SELECT child_id,record_json FROM sessions WHERE id=?').get(session);
    requireThat(!!row, 'session_missing'); requireThat(row.child_id === child, 'wrong_child');
    return JSON.parse(row.record_json);
  }
  /** Learner-facing private record. Historical parent summaries use record() without regrading or exposing editorial notes. */
  availableRecord(principal, child, session) {
    this.#db.exec('BEGIN');
    try {
      const record = this.record(principal, child, session);
      this.#available(record);
      this.#db.exec('COMMIT'); return record;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  /** Bounded, read-only history. Titles belong to the saved lesson, not today's catalogue. */
  historyPage(principal, child, before = null) {
    this.#child(principal, child); requireThat(before === null || validId(before), 'invalid_request');
    if (before !== null) requireThat(this.#db.prepare('SELECT 1 FROM sessions WHERE id=? AND child_id=?').get(before, child), 'invalid_request');
    const rows = this.#db.prepare('SELECT record_json FROM sessions WHERE child_id=?' +
      (before === null ? '' : ' AND rowid < (SELECT rowid FROM sessions WHERE id=? AND child_id=?)') + ' ORDER BY rowid DESC LIMIT 21')
      .all(...(before === null ? [child] : [child, before, child]));
    const entries = rows.slice(0, 20).map(row => { const record = JSON.parse(row.record_json);
      return { ...publicSession(record), title_en: record.lesson.title_en, level: record.lesson.level }; });
    return { entries, next_before: rows.length > 20 ? entries.at(-1).session_id : null };
  }
  history(principal, child) {
    this.#child(principal, child);
    return this.#db.prepare('SELECT record_json FROM sessions WHERE child_id=? ORDER BY rowid DESC LIMIT 100').all(child)
      .map(row => publicSession(JSON.parse(row.record_json)));
  }
  submit(principal, event, now, authorize = () => {}) {
    this.#child(principal, event?.child_id); requireThat(validEvent(event), 'invalid_request');
    if (this.#editorContent) this.#boundary('content_before_write_lock');
    return this.#operation('child:' + event.child_id, event.request_id, { operation: 'submit', event }, () => {
      const row = this.#db.prepare('SELECT child_id,record_json,revision FROM sessions WHERE id=?').get(event.session_id);
      requireThat(row?.child_id === event.child_id, 'wrong_child');
      const record = JSON.parse(row.record_json);
      requireThat(['1.1.0', '1.2.0', '1.3.0'].includes(record.session.schema_version), 'unsupported_session');
      const result = (record.session.schema_version === '1.3.0' ? applyPublisherEvent : record.session.schema_version === '1.2.0' ? applyJourneyEvent : applyEvent)(record, event, principal, now);
      requireThat(result.response.ok, result.response.code);
      if (!result.response.replayed) {
        const update = this.#db.prepare('UPDATE sessions SET revision=?,record_json=? WHERE id=? AND revision=?').run(result.record.session.revision, JSON.stringify(result.record), event.session_id, event.expected_revision);
        requireThat(Number(update.changes) === 1, 'stale_revision'); this.#boundary('session_saved');
        this.#award(result.record, now); this.#boundary('milestone_posted');
      }
      return result.response;
    }, () => {
      authorize();
      if (this.#editorContent || this.#publisher) {
        const record = this.record(principal, event.child_id, event.session_id);
        this.#available(record);
      }
    });
  }
  #available(record) {
    if (record.session.schema_version === '1.3.0') {
      if (this.#publisher) this.#publisher.assertRecord(record);
      else requireThat(!this.#editorContent, 'content_unavailable');
    } else if (this.#editorContent) requireAvailableContent(this.#db, record.lesson.id, record.session.content_sha256);
  }
  #award(record, now) {
    const s = record.session;
    const milestones = [];
    if (s.question_cursor === 3 && STAGES.indexOf(s.stage) >= STAGES.indexOf('understand_saved')) milestones.push('understand');
    if (s.stage === 'complete' && s.status === 'complete') milestones.push('complete');
    for (const milestone of milestones) {
      const reference = s.session_id + ':' + milestone;
      // Provisional participation units in this synthetic store only. Never mastery/real value.
      this.#db.prepare("INSERT INTO ledger(id,child_id,delta,kind,reference,created_at) VALUES(?,?,5,'credit',?,?) ON CONFLICT(child_id,kind,reference) DO NOTHING").run('credit:' + s.child_id + ':' + reference, s.child_id, reference, now);
    }
  }
  setGift(principal, data, authorize = () => {}) {
    this.#staff(principal);
    requireThat(exact(data, ['gift_id', 'version', 'title', 'price', 'available']) && validId(data.gift_id) && validId(data.version) && shortText(data.title) && Number.isSafeInteger(data.price) && data.price > 0 && data.price <= 1000000 && typeof data.available === 'boolean', 'invalid_request');
    this.#boundary('gift_before_write_lock');
    return this.#transaction(() => {
      this.#staff(principal); authorize(this.#db);
      const old = this.#db.prepare('SELECT * FROM gifts WHERE id=? AND version=?').get(data.gift_id, data.version);
      if (old) requireThat(old.title === data.title && old.price === data.price && old.available === Number(data.available), 'immutable_version');
      else this.#db.prepare('INSERT INTO gifts VALUES(?,?,?,?,?)').run(data.gift_id, data.version, data.title, data.price, Number(data.available));
      this.#db.prepare('INSERT INTO catalog VALUES(?,?) ON CONFLICT(gift_id) DO UPDATE SET version=excluded.version').run(data.gift_id, data.version);
      return data;
    });
  }
  catalog(principal, child) {
    this.#child(principal, child);
    return this.#db.prepare('SELECT g.id,g.version,g.title,g.price,g.available FROM gifts g JOIN catalog c ON c.gift_id=g.id AND c.version=g.version ORDER BY g.id').all();
  }
  redeem(principal, data, now, authorize = () => {}) {
    this.#child(principal, data?.child_id);
    requireThat(exact(data, ['request_id', 'child_id', 'gift_id', 'quoted_version']) && validId(data.gift_id) && validId(data.quoted_version), 'invalid_request');
    this.#boundary('gift_before_write_lock');
    return this.#operation('child:' + data.child_id, data.request_id, { operation: 'redeem', ...data }, () => {
      const gift = this.#db.prepare('SELECT g.* FROM catalog c JOIN gifts g ON g.id=c.gift_id AND g.version=c.version WHERE c.gift_id=?').get(data.gift_id);
      requireThat(!!gift, 'gift_unavailable'); requireThat(gift.version === data.quoted_version, 'gift_changed'); requireThat(gift.available === 1, 'gift_unavailable');
      const orderId = data.child_id + ':' + data.request_id, debitId = 'debit:' + orderId;
      this.#db.prepare("INSERT INTO redemptions(id,child_id,gift_id,gift_version,price,status,debit_id,created_at,updated_at) VALUES(?,?,?,?,?,'requested',?,?,?)").run(orderId, data.child_id, gift.id, gift.version, gift.price, debitId, now, now);
      this.#boundary('order_inserted');
      const debit = this.#db.prepare("INSERT INTO ledger(id,child_id,delta,kind,reference,created_at) SELECT ?,?,-?,'debit',?,? FROM wallets WHERE child_id=? AND balance>=?").run(debitId, data.child_id, gift.price, orderId, now, data.child_id, gift.price);
      requireThat(Number(debit.changes) === 1, 'insufficient_funds'); this.#boundary('debit_inserted');
      this.#audit(orderId, null, 'requested', principal.childId, 'synthetic_catalogue', now);
      return { ok: true, redemption: this.#order(orderId), balance: this.#wallet(data.child_id) };
    }, () => { this.#child(principal, data.child_id); authorize(this.#db); });
  }
  #order(id) { return this.#db.prepare('SELECT id,child_id,gift_id,gift_version,price,status,debit_id,refund_id,created_at,updated_at FROM redemptions WHERE id=?').get(id); }
  #audit(id, from, to, actor, reason, now) { this.#db.prepare('INSERT INTO redemption_audit(redemption_id,from_status,to_status,actor,reason,created_at) VALUES(?,?,?,?,?,?)').run(id, from, to, actor, reason, now); }
  fulfil(principal, data, now, authorize = () => {}) {
    this.#staff(principal);
    requireThat(exact(data, ['request_id', 'redemption_id', 'status']) && shortText(data.redemption_id, 300) && ['preparing', 'delivered'].includes(data.status), 'invalid_request');
    this.#boundary('gift_before_write_lock');
    return this.#operation('staff:' + principal.id, data.request_id, { operation: 'fulfil', ...data }, () => {
      const order = this.#order(data.redemption_id); requireThat(!!order, 'order_missing');
      requireThat((order.status === 'requested' && data.status === 'preparing') || (order.status === 'preparing' && data.status === 'delivered'), 'invalid_transition');
      this.#db.prepare('UPDATE redemptions SET status=?,updated_at=? WHERE id=?').run(data.status, now, order.id);
      this.#audit(order.id, order.status, data.status, principal.id, 'synthetic_fulfilment', now);
      return { ok: true, redemption: this.#order(order.id) };
    }, () => { this.#staff(principal); authorize(this.#db); });
  }
  refund(principal, data, now, authorize = () => {}) {
    this.#staff(principal);
    requireThat(exact(data, ['request_id', 'redemption_id', 'reason']) && shortText(data.redemption_id, 300) && shortText(data.reason, 500), 'invalid_request');
    this.#boundary('gift_before_write_lock');
    return this.#operation('staff:' + principal.id, data.request_id, { operation: 'refund', ...data }, () => {
      const order = this.#order(data.redemption_id); requireThat(!!order, 'order_missing');
      if (order.status === 'refunded') return { ok: true, redemption: order, balance: this.#wallet(order.child_id) };
      requireThat(['requested', 'preparing'].includes(order.status), 'invalid_transition');
      const refundId = 'refund:' + order.debit_id;
      this.#db.prepare("UPDATE redemptions SET status='rejected',refund_id=?,updated_at=? WHERE id=?").run(refundId, now, order.id);
      this.#audit(order.id, order.status, 'rejected', principal.id, data.reason, now); this.#boundary('refund_rejected');
      this.#db.prepare("INSERT INTO ledger VALUES(?,?,?,'refund',?,?)").run(refundId, order.child_id, order.price, order.debit_id, now); this.#boundary('refund_credited');
      this.#db.prepare("UPDATE redemptions SET status='refunded',updated_at=? WHERE id=?").run(now, order.id);
      this.#audit(order.id, 'rejected', 'refunded', principal.id, data.reason, now);
      return { ok: true, redemption: this.#order(order.id), balance: this.#wallet(order.child_id) };
    }, () => { this.#staff(principal); authorize(this.#db); });
  }
  wallet(principal, child) {
    this.#child(principal, child);
    return { balance: this.#wallet(child), ledger: this.#db.prepare('SELECT id,delta,kind,reference,created_at FROM ledger WHERE child_id=? ORDER BY rowid').all(child), redemptions: this.#db.prepare('SELECT id,gift_id,gift_version,price,status,created_at,updated_at FROM redemptions WHERE child_id=? ORDER BY rowid').all(child) };
  }
  audit(principal) {
    this.#staff(principal);
    const balances = this.#db.prepare('SELECT w.child_id,w.balance,coalesce(sum(l.delta),0) AS ledger_sum FROM wallets w LEFT JOIN ledger l ON l.child_id=w.child_id GROUP BY w.child_id HAVING w.balance!=coalesce(sum(l.delta),0) OR w.balance<0').all();
    const orders = this.#db.prepare("SELECT r.id FROM redemptions r LEFT JOIN ledger d ON d.id=r.debit_id LEFT JOIN ledger f ON f.id=r.refund_id WHERE d.id IS NULL OR d.kind!='debit' OR d.delta!=-r.price OR d.child_id!=r.child_id OR (r.status='refunded' AND (f.id IS NULL OR f.kind!='refund' OR f.delta!=r.price OR f.reference!=r.debit_id))").all();
    const foreignKeys = this.#db.prepare('PRAGMA foreign_key_check').all();
    return { ok: !balances.length && !orders.length && !foreignKeys.length, balances, orders, foreignKeys, entries: this.#db.prepare('SELECT count(*) AS n FROM ledger').get().n, redemptions: this.#db.prepare('SELECT count(*) AS n FROM redemptions').get().n, receipts: this.#db.prepare('SELECT count(*) AS n FROM receipts').get().n, integrity: this.#db.prepare('PRAGMA integrity_check').get().integrity_check };
  }
}
