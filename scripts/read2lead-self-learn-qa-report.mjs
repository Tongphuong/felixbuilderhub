/** Read-only synthetic aggregate report. No deployment adapter or raw child export. */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syntheticDatabasePath } from './lib/read2lead-self-learn-sqlite.mjs';
import { STAGES, CAPTURE, SUPPORT, canonical } from '../src/lib/read2lead/self-learn/session-contract.mjs';

const requireThat = (ok, code) => { if (!ok) throw Error(code); };
const time = value => {
  requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'invalid_report_timestamp');
  return Date.parse(value);
};
const increment = (map, key) => { map[key] = (map[key] || 0) + 1; };
function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const at = q => sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null;
  return { samples: sorted.length, total: sorted.reduce((a, b) => a + b, 0), median: at(0.5), p95: at(0.95) };
}

export function syntheticQAReport({ mode, dataRoot } = {}) {
  requireThat(mode === 'synthetic-local', 'unsafe_report_mode');
  const path = syntheticDatabasePath(dataRoot);
  requireThat(existsSync(path), 'report_database_missing');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    requireThat(db.prepare('PRAGMA integrity_check').all().every(row => row.integrity_check === 'ok'), 'report_integrity_failed');
    requireThat(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'report_foreign_key_failed');
    const size = db.prepare('SELECT count(*) AS n,coalesce(sum(length(CAST(record_json AS BLOB))),0) AS bytes FROM sessions').get();
    requireThat(size.n <= 5000 && size.bytes <= 64 * 1024 * 1024, 'report_scope_limit');
    const drift = db.prepare('SELECT count(*) AS n FROM wallets w WHERE balance != coalesce((SELECT sum(delta) FROM ledger l WHERE l.child_id=w.child_id),0)').get().n;
    requireThat(drift === 0, 'report_wallet_drift');
    const levels = new Map(), childDays = new Map();
    for (const row of db.prepare('SELECT id,child_id,revision,record_json FROM sessions ORDER BY id').all()) {
      let r;
      try { r = JSON.parse(row.record_json); } catch { throw Error('invalid_report_record'); }
      const s = r?.session, level = r?.lesson?.level;
      requireThat(s && ['1.1.0', '1.2.0'].includes(s.schema_version) && /^L[0-5]$/.test(level) && s.session_id === row.id && s.child_id === row.child_id && row.child_id.startsWith('synthetic-') && s.revision === row.revision && Array.isArray(r.receipts) && r.receipts.length === s.revision && Array.isArray(r.attempts) && Array.isArray(r.support), 'invalid_report_record');
      requireThat(Number.isSafeInteger(s.revision) && s.revision >= 0 && s.revision <= 128 && STAGES.includes(s.stage) && ['active', 'saved', 'complete'].includes(s.status), 'invalid_report_record');
      requireThat((s.stage === 'complete') === (s.status === 'complete'), 'invalid_report_record');
      requireThat(createHash('sha256').update(canonical(r.lesson)).digest('hex') === s.content_sha256, 'report_pin_hash_mismatch');
      const created = time(s.created_at), updated = time(s.updated_at);
      requireThat(updated >= created, 'invalid_report_timestamp');
      if (!childDays.has(row.child_id)) childDays.set(row.child_id, new Set());
      const days = childDays.get(row.child_id); days.add(s.created_at.slice(0, 10));
      if (!levels.has(level)) levels.set(level, { level, sessions: 0, completed: 0, paused: 0, incomplete_by_stage: {}, assisted_sessions: 0, attempts: 0, assisted_attempts: 0, capture_states: {}, support_kinds: {}, stages: new Map(), elapsed: [], pausedElapsed: [] });
      const group = levels.get(level); group.sessions++; group.completed += s.status === 'complete' ? 1 : 0; group.paused += s.status === 'saved' ? 1 : 0;
      if (s.status !== 'complete') increment(group.incomplete_by_stage, s.stage);
      let previous = created, stage = 'pre_read', status = 'active', revision = 0, pausedElapsed = 0;
      const stageTimes = new Map(), ids = new Set();
      for (const receipt of r.receipts) {
        const next = receipt?.response?.session;
        requireThat(next && receipt.response.ok === true && typeof receipt.request_id === 'string' && !ids.has(receipt.request_id) && next.session_id === row.id && next.child_id === row.child_id && next.content_sha256 === s.content_sha256 && next.revision === ++revision && STAGES.includes(next.stage) && ['active', 'saved', 'complete'].includes(next.status), 'invalid_report_receipt');
        ids.add(receipt.request_id);
        const at = time(next.updated_at); requireThat(at >= previous && at <= updated, 'invalid_report_timestamp');
        if (status === 'saved') pausedElapsed += at - previous;
        else stageTimes.set(stage, (stageTimes.get(stage) || 0) + at - previous);
        previous = at; stage = next.stage; status = next.status; days.add(next.updated_at.slice(0, 10));
      }
      requireThat(previous === updated && stage === s.stage && status === s.status, 'invalid_report_receipt');
      for (const [name, elapsed] of stageTimes) {
        if (!group.stages.has(name)) group.stages.set(name, []);
        group.stages.get(name).push(elapsed);
      }
      group.elapsed.push(updated - created); group.pausedElapsed.push(pausedElapsed);
      let assisted = r.support.length > 0;
      for (const item of r.support) requireThat(SUPPORT.includes(item?.kind), 'invalid_report_support');
      for (const attempt of r.attempts) {
        const p = attempt?.payload;
        requireThat(p && CAPTURE.includes(p.capture_status) && Array.isArray(p.support_used) && p.support_used.every(x => SUPPORT.includes(x)), 'invalid_report_attempt');
        group.attempts++; increment(group.capture_states, p.capture_status);
        if (p.support_used.length) { group.assisted_attempts++; assisted = true; }
        for (const kind of new Set(p.support_used)) increment(group.support_kinds, kind);
      }
      if (assisted) group.assisted_sessions++;
    }
    const balances = db.prepare('SELECT count(*) AS children,coalesce(sum(balance),0) AS synthetic_diamonds FROM wallets').get();
    const result = {
      format: 1, scope: 'synthetic-local-aggregate', independent_review: false,
      observations: { sessions: size.n, participating_children: childDays.size, children_with_activity_on_multiple_utc_days: [...childDays.values()].filter(days => days.size > 1).length },
      levels: [...levels.values()].sort((a, b) => a.level.localeCompare(b.level)).map(({ stages, elapsed, pausedElapsed, ...group }) => ({ ...group,
        elapsed_between_acknowledgements_ms: distribution(elapsed), explicitly_paused_elapsed_ms: distribution(pausedElapsed),
        stages: [...stages.entries()].map(([stage, values]) => ({ stage, elapsed_between_acknowledgements_ms: distribution(values) })) })),
      value_safety: { integrity: 'ok', foreign_key_errors: 0, wallet_drift: 0, ...balances },
      unmeasured: ['human_dropout', 'adult_navigation_assistance', 'human_learning_gain', 'independent_assessment_accuracy', 'real_device_capture', 'production_cost_and_capacity'],
      limitations: ['Synthetic QA only; no consented family pilot.', 'Elapsed acknowledgement intervals include unobserved idle time and breaks; they are not active study duration.', 'Incomplete or paused sessions are not classified as dropout.', 'Multiple UTC activity days can include one session crossing midnight; this is not a retention claim.', 'Assistance records in-product supports, not unrecorded adult help.', 'No mastery validation or automatic promotion is inferred.', 'Per-session provider usage and monetary cost require separate measured request evidence; this database cannot establish them.'],
    };
    db.exec('COMMIT'); return result;
  } finally { db.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    requireThat(args.length === 3 && args[0] === '--synthetic-local' && args[1] === '--data-root', 'usage: --synthetic-local --data-root ABS_PATH');
    console.log(JSON.stringify(syntheticQAReport({ mode: 'synthetic-local', dataRoot: args[2] }), null, 2));
  } catch (error) { console.error('Synthetic report refused:', error.message); process.exitCode = 1; }
}
