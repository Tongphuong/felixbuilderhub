import { validateStoryBudget } from '../../functions/lib/read2lead/story-budget.mjs';

/** Uses the private store's transaction, never ordinary KV read/modify/write. */
export class PrivateStoryBudgetStore {
  constructor(store, config, now = () => new Date()) {
    this.store = store; this.config = validateStoryBudget(config); this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS story_voice_reservations (
      session TEXT PRIMARY KEY, month TEXT NOT NULL, config TEXT NOT NULL, reserved INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS story_voice_turns (session TEXT NOT NULL, request TEXT NOT NULL,
      state TEXT NOT NULL, PRIMARY KEY(session,request));`);
  }
  reservationKey(session) {
    if (this.config.scope !== 'batch') return session;
    const old = this.store.db.prepare('SELECT month FROM story_voice_reservations WHERE session=?').get(session);
    const scope = 'batch:' + this.config.batchId;
    // Old rows keep their original keys. A different, explicitly configured
    // batch may fund the same lesson without rewriting any historical row.
    return !old || old.month === scope ? session : JSON.stringify([scope,session]);
  }
  reservedSessionsForOwner(owner) {
    const encoded = JSON.stringify(this.config);
    return this.store.db.prepare('SELECT id FROM story_sessions WHERE owner=?').all(owner)
      .filter(({id})=>this.store.db.prepare('SELECT config FROM story_voice_reservations WHERE session=?').get(this.reservationKey(id))?.config === encoded)
      .map(({id})=>({session:id}));
  }
  reserve(session) {
    return this.store.transaction(() => {
      const c = this.config;
      const batch = c.scope === 'batch';
      if (batch ? this.now().getTime() >= Date.parse(c.expiresAt) : this.now().toISOString().slice(0,7) !== c.month)
        throw Error(batch ? 'voice_budget_batch_expired' : 'voice_budget_month_expired');
      // Preserve the existing schema/history; the month column now also holds
      // namespaced batch identities, whose grants do not reset each month.
      const scope = batch ? 'batch:' + c.batchId : c.month;
      if (!this.store.db.prepare('SELECT id FROM story_sessions WHERE id=?').get(session)) throw Error('unknown_voice_session');
      const key = this.reservationKey(session);
      const previous = this.store.db.prepare('SELECT config FROM story_voice_reservations WHERE session=?').get(key);
      const encoded = JSON.stringify(c);
      if (batch) {
        const grant = this.store.db.prepare('SELECT config FROM story_voice_reservations WHERE month=? LIMIT 1').get(scope);
        if (grant && grant.config !== encoded) throw Error('voice_batch_config_conflict');
      }
      if (previous) { if (previous.config !== encoded) throw Error('voice_reservation_config_conflict'); return; }
      const total = this.store.db.prepare('SELECT COALESCE(SUM(reserved),0) AS total FROM story_voice_reservations WHERE month=?').get(scope).total;
      if (total + c.missionReserveMicroUsd > c.approvedVoiceMicroUsd) throw Error('voice_budget_exhausted');
      this.store.db.prepare('INSERT INTO story_voice_reservations VALUES(?,?,?,?)').run(key,scope,encoded,c.missionReserveMicroUsd);
    });
  }
  claim(session, request) {
    this.reserve(session);
    return this.store.transaction(() => {
      const db = this.store.db;
      const key = this.reservationKey(session);
      const repeated = db.prepare('SELECT session FROM story_voice_turns WHERE request=?').all(request).some(row=>{
        if (row.session === session) return true;
        try {const value=JSON.parse(row.session);return Array.isArray(value)&&value.length===2&&value[1]===session;}
        catch {return false;}
      });
      if (repeated) throw Error('voice_request_already_claimed');
      const count = db.prepare('SELECT COUNT(*) AS n FROM story_voice_turns WHERE session=?').get(key).n;
      if (count >= this.config.maxTurns) throw Error('voice_turn_limit');
      db.prepare('INSERT INTO story_voice_turns VALUES(?,?,?)').run(key,request,'reserved');
    });
  }
  finish(session, request, outcome) {
    if (!['succeeded','failed_or_unknown'].includes(outcome)) throw Error('invalid_voice_outcome');
    const result=this.store.db.prepare("UPDATE story_voice_turns SET state=? WHERE session=? AND request=? AND state='reserved'").run(outcome,this.reservationKey(session),request);
    if (result.changes !== 1) throw Error('voice_claim_missing');
    // No speculative refunds. Each claim keeps its entire worst-case reservation
    // until actual provider billing can be reconciled by a separate audited tool.
  }
}
