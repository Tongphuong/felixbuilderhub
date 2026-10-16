import { validateStoryBudget, STORY_POOL_DEBIT_MICRO_USD } from '../../functions/lib/read2lead/story-budget.mjs';

/** Uses the private store's transaction, never ordinary KV read/modify/write. */
export class PrivateStoryBudgetStore {
  constructor(store, config, now = () => new Date()) {
    this.store = store; this.config = validateStoryBudget(config); this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS story_voice_reservations (
      session TEXT PRIMARY KEY, month TEXT NOT NULL, config TEXT NOT NULL, reserved INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS story_voice_turns (session TEXT NOT NULL, request TEXT NOT NULL,
      state TEXT NOT NULL, PRIMARY KEY(session,request));
      CREATE TABLE IF NOT EXISTS story_voice_pool_debits (session TEXT NOT NULL, request TEXT NOT NULL,
      month TEXT NOT NULL, config TEXT NOT NULL, micro INTEGER NOT NULL, PRIMARY KEY(session,request));`);
  }
  // Monthly pool (SPEC_R2L_MINNY_VOICE_COST Packet B). Old reservation rows are
  // never touched: pool state lives in its own table and namespaced turn keys.
  get pool() { return this.config.scope === 'pool'; }
  poolMonth() { return this.now().toISOString().slice(0, 7); }
  poolKey(session) { return JSON.stringify(['pool:' + this.config.poolId, session]); }
  poolProvisional() { return STORY_POOL_DEBIT_MICRO_USD.aiReplyTurn + STORY_POOL_DEBIT_MICRO_USD.freshSynthesis; }
  poolUsed(month = this.poolMonth()) {
    return this.store.db.prepare('SELECT COALESCE(SUM(micro),0) AS n FROM story_voice_pool_debits WHERE month=?').get(month).n;
  }
  poolStatus() {
    const used = this.poolUsed(), cap = this.config.approvedVoiceMicroUsd;
    return { month: this.poolMonth(), usedMicroUsd: used, capMicroUsd: cap, exhausted: used >= cap };
  }
  claimPool(session, request) {
    return this.store.transaction(() => {
      const db = this.store.db, c = this.config, month = this.poolMonth(), encoded = JSON.stringify(c);
      if (!db.prepare('SELECT id FROM story_sessions WHERE id=?').get(session)) throw Error('unknown_voice_session');
      const grant = db.prepare('SELECT config FROM story_voice_pool_debits WHERE month=? LIMIT 1').get(month);
      if (grant && grant.config !== encoded) throw Error('voice_pool_config_conflict');
      const key = this.poolKey(session);
      const repeated = db.prepare('SELECT session FROM story_voice_turns WHERE request=?').all(request).some(row => {
        if (row.session === session) return true;
        try { const value = JSON.parse(row.session); return Array.isArray(value) && value.length === 2 && value[1] === session; }
        catch { return false; }
      });
      if (repeated) throw Error('voice_request_already_claimed');
      // Runaway guard per mission only (>= 32). It never limits how many missions a child starts.
      if (db.prepare('SELECT COUNT(*) AS n FROM story_voice_turns WHERE session=?').get(key).n >= c.maxTurns) throw Error('voice_turn_limit');
      if (this.poolUsed(month) >= c.approvedVoiceMicroUsd) throw Error('voice_pool_exhausted');
      db.prepare('INSERT INTO story_voice_turns VALUES(?,?,?)').run(key, request, 'reserved');
      // Provisional worst-case debit; the runner replaces it with the actual amount on success.
      db.prepare('INSERT INTO story_voice_pool_debits VALUES(?,?,?,?,?)').run(session, request, month, encoded, this.poolProvisional());
    });
  }
  reservationKey(session) {
    if (this.pool) return this.poolKey(session);
    if (this.config.scope !== 'batch') return session;
    const old = this.store.db.prepare('SELECT month FROM story_voice_reservations WHERE session=?').get(session);
    const scope = 'batch:' + this.config.batchId;
    // Old rows keep their original keys. A different, explicitly configured
    // batch may fund the same lesson without rewriting any historical row.
    return !old || old.month === scope ? session : JSON.stringify([scope,session]);
  }
  reservedSessionsForOwner(owner) {
    if (this.pool) return [];
    const encoded = JSON.stringify(this.config);
    return this.store.db.prepare('SELECT id FROM story_sessions WHERE owner=?').all(owner)
      .filter(({id})=>this.store.db.prepare('SELECT config FROM story_voice_reservations WHERE session=?').get(this.reservationKey(id))?.config === encoded)
      .map(({id})=>({session:id}));
  }
  reserve(session) {
    if (this.pool) {
      if (!this.store.db.prepare('SELECT id FROM story_sessions WHERE id=?').get(session)) throw Error('unknown_voice_session');
      return;
    }
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
    if (this.pool) return this.claimPool(session, request);
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
  finish(session, request, outcome, debitMicroUsd) {
    if (!['succeeded','failed_or_unknown'].includes(outcome)) throw Error('invalid_voice_outcome');
    if (this.pool) {
      return this.store.transaction(() => {
        const r = this.store.db.prepare("UPDATE story_voice_turns SET state=? WHERE session=? AND request=? AND state='reserved'").run(outcome, this.poolKey(session), request);
        if (r.changes !== 1) throw Error('voice_claim_missing');
        // Only a success may lower the provisional debit; a failure or unknown
        // outcome keeps the conservative provisional amount (no speculative refunds).
        if (outcome === 'succeeded' && Number.isSafeInteger(debitMicroUsd) && debitMicroUsd >= 0 && debitMicroUsd <= this.poolProvisional())
          this.store.db.prepare('UPDATE story_voice_pool_debits SET micro=? WHERE session=? AND request=?').run(debitMicroUsd, session, request);
      });
    }
    const result=this.store.db.prepare("UPDATE story_voice_turns SET state=? WHERE session=? AND request=? AND state='reserved'").run(outcome,this.reservationKey(session),request);
    if (result.changes !== 1) throw Error('voice_claim_missing');
    // No speculative refunds. Each claim keeps its entire worst-case reservation
    // until actual provider billing can be reconciled by a separate audited tool.
  }
}
