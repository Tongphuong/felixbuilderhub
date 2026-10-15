/** Additive local proof. Pure state; caller owns atomic persistence and authentication. */
import { validId as id, canonical, validEvent } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
export { STAGES, CAPTURE, SUPPORT, canonical, validEvent } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
const unique = values => Array.isArray(values) && new Set(values).size === values.length;
function iso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export async function createSession({ sessionId, childId, lesson, now }) {
  if (!id(sessionId) || !id(childId) || !iso(now) || !lesson || !id(lesson.id) || !lesson.version || lesson.rubric_version !== 'practice-rubric-1' || !Array.isArray(lesson.questions) || lesson.questions.length !== 3 || !unique(lesson.questions.map(q => q.id)) || !Array.isArray(lesson.minny?.turns) || lesson.minny.turns.length < 1 || lesson.minny.turns.length > 6 || lesson.minny.turns.length !== lesson.minny.max_turns || !unique(lesson.minny.turns.map(t => t.id))) throw new Error('invalid_session_seed');
  const pinned = structuredClone(lesson);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(pinned)));
  const hash = Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
  return {
    session: { schema_version: '1.1.0', session_id: sessionId, child_id: childId, lesson_id: pinned.id, content_version: pinned.version, content_sha256: hash, rubric_version: pinned.rubric_version, engine_version: 'self-learn-1', revision: 0, stage: 'pre_read', input_mode: null, input_order: [], status: 'active', created_at: now, updated_at: now, acknowledged_request_ids: [], evidence_ids: [], question_cursor: 0, dialogue_cursor: 0 },
    lesson: pinned, attempts: [], support: [], receipts: [], retell_received: false,
  };
}
export function publicSession(record) { return structuredClone(record.session); }
function activeItem(record) {
  const s = record.session;
  if (s.stage === 'comprehension') return record.lesson.questions[s.question_cursor]?.id;
  if (s.stage === 'mini_story') return record.lesson.minny.turns[s.dialogue_cursor]?.id;
  if (s.stage === 'shadowing') return 'shadow';
  if (s.stage === 'retell' && !record.retell_received) return 'retell';
  return undefined;
}
/** Caller must supply a server-authenticated principal and atomically persist record + receipt. */
export function applyEvent(record, event, principal, now) {
  const fail = code => ({ record, response: { ok: false, code, current_revision: ['unauthorized', 'wrong_child', 'invalid_request'].includes(code) ? null : record.session.revision } });
  // Identity first, even when a malformed request is combined with invalid auth.
  if (!principal?.active || !id(principal.childId)) return fail('unauthorized');
  if (principal.childId !== record.session.child_id) return fail('wrong_child');
  if (!validEvent(event) || !iso(now)) return fail('invalid_request');
  if (event.child_id !== principal.childId || event.session_id !== record.session.session_id) return fail('wrong_child');
  const encoded = canonical(event);
  const prior = record.receipts.find(r => r.request_id === event.request_id);
  if (prior) return prior.canonical === encoded
    ? { record, response: { ...structuredClone(prior.response), replayed: true } }
    : fail('request_conflict');
  if (event.expected_revision !== record.session.revision) return fail('stale_revision');
  if (record.receipts.length >= 128) return fail('session_limit');
  const s = record.session, p = event.payload, name = event.event;
  if (s.status === 'complete') return fail('invalid_transition');
  if (s.status === 'saved' && name !== 'resume') return fail('invalid_transition');
  let nextStage = s.stage;
  if (name === 'pause') { if (s.status !== 'active') return fail('invalid_transition'); }
  else if (name === 'resume') { if (s.status !== 'saved') return fail('invalid_transition'); }
  else if (name === 'support') {
    if (p.item_id !== activeItem(record)) return fail('invalid_transition');
  } else if (name === 'prediction' && s.stage === 'pre_read') nextStage = 'input';
  else if (name === 'input_complete' && s.stage === 'input') {
    if (p.order.includes('listen') && record.lesson.audio.asset_status !== 'ready') return fail('content_unavailable');
    nextStage = 'comprehension';
  } else if (name === 'answer' && s.stage === 'comprehension') {
    const q = record.lesson.questions[s.question_cursor];
    if (!q || q.id !== p.item_id || p.choice_index >= q.options_en.length) return fail('invalid_transition');
    if (p.evidence_sentence_ids.some(id => !record.lesson.story.sentences.some(s => s.id === id))) return fail('invalid_request');
  } else if (name === 'save_understand' && s.stage === 'comprehension' && s.question_cursor === record.lesson.questions.length) nextStage = 'understand_saved';
  else if (name === 'begin_use' && s.stage === 'understand_saved') nextStage = 'shadowing';
  else if (name === 'shadow_complete' && s.stage === 'shadowing') nextStage = 'mini_story';
  else if (name === 'minny_turn' && s.stage === 'mini_story') {
    if (record.lesson.minny.turns[s.dialogue_cursor]?.id !== p.turn_id) return fail('invalid_transition');
    if (s.dialogue_cursor + 1 === record.lesson.minny.turns.length) nextStage = 'retell';
  } else if (name === 'retell' && s.stage === 'retell' && !record.retell_received) nextStage = 'retell';
  else if (name === 'complete' && s.stage === 'retell' && record.retell_received) nextStage = 'complete';
  else return fail('invalid_transition');
  const next = structuredClone(record), ns = next.session;
  ns.stage = nextStage; ns.revision++; ns.updated_at = now;
  ns.status = nextStage === 'complete' ? 'complete' : name === 'pause' ? 'saved' : 'active';
  ns.acknowledged_request_ids.push(event.request_id);
  if (name === 'input_complete') {
    ns.input_order = [...p.order];
    ns.input_mode = p.order.length === 2 ? 'audio_assisted_reading' : p.order[0] === 'listen' ? 'listening_only' : 'independent_reading';
  }
  if (name === 'support') {
    if (!next.support.some(x => x.item_id === p.item_id && x.kind === p.kind)) next.support.push({ item_id: p.item_id, kind: p.kind });
  }
  if (['answer', 'shadow_complete', 'minny_turn', 'retell'].includes(name)) {
    const item = p.item_id ?? p.turn_id ?? (name === 'retell' ? 'retell' : 'shadow');
    const assistance = [...new Set([...p.support_used, ...next.support.filter(x => x.item_id === item).map(x => x.kind)])].sort();
    next.attempts.push({ request_id: event.request_id, event: name, stage: s.stage, item_id: item, payload: { ...structuredClone(p), support_used: assistance }, assessment_state: p.capture_status === 'valid' ? 'pending' : 'unassessable', score: null });
  }
  if (name === 'answer') ns.question_cursor++;
  if (name === 'minny_turn') ns.dialogue_cursor++;
  if (name === 'retell') next.retell_received = true;
  const response = { ok: true, request_id: event.request_id, session: publicSession(next), replayed: false };
  next.receipts.push({ request_id: event.request_id, canonical: encoded, response: structuredClone(response) });
  return { record: next, response };
}
