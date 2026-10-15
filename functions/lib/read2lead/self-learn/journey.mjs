/** Additive1.2 wrapper; never upgrades or silently regrades a stored1.1 session. */
import { createSession, applyEvent, publicSession, canonical } from './session.mjs';
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
import { validJourneyEvent, JOURNEY_EVENTS } from '../../../../src/lib/read2lead/self-learn/journey-contract.mjs';
import { practiceSummary } from './assessment.mjs';
export async function createJourney(args) {
  const record = await createSession(args);
  if (record.lesson.misconception_repair?.maximum_probes !== 1 || !record.lesson.independent_followup?.not_in_minny_script) throw Error('invalid_journey_seed');
  Object.assign(record.session, { schema_version: '1.2.0', engine_version: 'self-learn-2', repair_state: 'not_needed', followup_state: 'locked' });
  return record;
}
export function applyJourneyEvent(record, event, principal, now) {
  const fail = code => ({ record, response: { ok: false, code, current_revision: ['unauthorized', 'wrong_child', 'invalid_request'].includes(code) ? null : record.session.revision } });
  if (!principal?.active || !validId(principal.childId)) return fail('unauthorized');
  if (principal.childId !== record.session.child_id) return fail('wrong_child');
  if (record.session.schema_version !== '1.2.0' || !validJourneyEvent(event) || typeof now !== 'string' || !Number.isFinite(Date.parse(now))) return fail('invalid_request');
  if (event.child_id !== principal.childId || event.session_id !== record.session.session_id) return fail('wrong_child');
  const encoded = canonical(event), prior = record.receipts.find(r => r.request_id === event.request_id);
  if (prior) return prior.canonical === encoded ? { record, response: { ...structuredClone(prior.response), replayed: true } } : fail('request_conflict');
  if (event.expected_revision !== record.session.revision) return fail('stale_revision');
  if (record.receipts.length >= 128) return fail('session_limit');
  const s = record.session, name = event.event, p = event.payload, repair = record.lesson.misconception_repair, follow = record.lesson.independent_followup;
  const repairReady = s.stage === 'comprehension' && s.question_cursor === 3;
  const followReady = s.stage === 'retell' && record.retell_received && s.followup_state === 'ready';
  const followSupport = name === 'support' && followReady && p.item_id === follow.id;
  let next;
  if (JOURNEY_EVENTS.includes(name) || followSupport) {
    if (s.status !== 'active') return fail('invalid_transition');
    const allowed = name === 'begin_repair' ? repairReady && s.repair_state === 'available' :
      name === 'skip_repair' ? repairReady && ['available', 'shown'].includes(s.repair_state) :
      name === 'repair_answer' ? repairReady && s.repair_state === 'shown' && p.item_id === repair.id && p.choice_index < repair.options_en.length :
      name === 'followup_answer' ? followReady && p.item_id === follow.id && p.choice_index < follow.options_en.length :
      name === 'skip_followup' ? followReady : followSupport;
    if (!allowed) return fail('invalid_transition');
    next = structuredClone(record); next.session.revision++; next.session.updated_at = now;
    next.session.acknowledged_request_ids.push(event.request_id);
    if (name === 'begin_repair') {
      next.session.repair_state = 'shown'; next.support.push({ item_id: repair.id, kind: 'revealing_hint' });
    } else if (followSupport) {
      if (!next.support.some(x => x.item_id === follow.id && x.kind === p.kind)) next.support.push({ item_id: follow.id, kind: p.kind });
    } else {
      const isRepair = ['repair_answer', 'skip_repair'].includes(name), skipped = name.startsWith('skip_'), item = isRepair ? repair.id : follow.id;
      next.session[isRepair ? 'repair_state' : 'followup_state'] = skipped ? 'skipped' : 'answered';
      const support = [...new Set([...(p.support_used || []), ...next.support.filter(x => x.item_id === item).map(x => x.kind)])].sort();
      next.attempts.push({ request_id: event.request_id, event: name, stage: s.stage, item_id: item,
        payload: skipped ? { item_id: item, choice_index: null, text: '', capture_status: 'not_attempted', support_used: support } : { ...structuredClone(p), support_used: support },
        assessment_state: skipped ? 'unassessable' : 'pending', score: null });
    }
  } else {
    if (name === 'save_understand' && ['available', 'shown'].includes(s.repair_state)) return fail('invalid_transition');
    if (name === 'complete' && !['answered', 'skipped'].includes(s.followup_state)) return fail('invalid_transition');
    const applied = applyEvent(record, { ...event, api_version: '1.1' }, principal, now);
    if (!applied.response.ok) return applied;
    next = applied.record;
    // The wrapper replaces only this new receipt with the actual1.2 request/response.
    next.receipts.pop();
    if (name === 'answer' && next.session.question_cursor === 3 && practiceSummary(next).reading.some(x => x.status === 'needs_support')) next.session.repair_state = 'available';
    if (name === 'retell') next.session.followup_state = 'ready';
  }
  next.session.evidence_ids = next.attempts.map(a => a.request_id);
  const response = { ok: true, request_id: event.request_id, session: publicSession(next), replayed: false };
  next.receipts.push({ request_id: event.request_id, canonical: encoded, response: structuredClone(response) });
  return { record: next, response };
}
