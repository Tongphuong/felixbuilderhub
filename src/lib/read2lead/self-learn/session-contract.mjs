/** Public event shapes only: no content keys, scoring, providers or account authority. */
export const STAGES = Object.freeze(['pre_read', 'input', 'comprehension', 'understand_saved', 'shadowing', 'mini_story', 'retell', 'complete']);
export const CAPTURE = Object.freeze(['valid', 'missing', 'low_confidence', 'provider_failed', 'not_attempted']);
export const SUPPORT = Object.freeze(['question_audio', 'revealing_hint', 'frame', 'repeated_item', 'reference_script']);
const EVENTS = ['prediction', 'input_complete', 'answer', 'save_understand', 'begin_use', 'shadow_complete', 'minny_turn', 'retell', 'complete', 'pause', 'resume', 'support'];
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const text = value => typeof value === 'string' && value.length <= 3000;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const unique = values => Array.isArray(values) && new Set(values).size === values.length;
const support = value => unique(value) && value.every(x => SUPPORT.includes(x));
const speech = value => exact(value, ['text', 'capture_status', 'support_used']) && text(value.text) && CAPTURE.includes(value.capture_status) && support(value.support_used) && (value.capture_status !== 'valid' || value.text.trim().length > 0);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function payloadValid(event, p) {
  if (['pause', 'resume', 'save_understand', 'begin_use', 'complete'].includes(event)) return exact(p, []);
  if (event === 'prediction') return exact(p, ['text']) && text(p.text);
  if (event === 'input_complete') return exact(p, ['order']) && unique(p.order) && p.order.length >= 1 && p.order.length <= 2 && p.order.every(x => ['read', 'listen'].includes(x));
  if (event === 'support') return exact(p, ['item_id', 'kind']) && validId(p.item_id) && SUPPORT.includes(p.kind);
  if (event === 'answer') return exact(p, ['item_id', 'choice_index', 'text', 'evidence_sentence_ids', 'support_used', 'capture_status']) && validId(p.item_id) && Number.isInteger(p.choice_index) && p.choice_index >= 0 && p.choice_index <= 2 && text(p.text) && unique(p.evidence_sentence_ids) && p.evidence_sentence_ids.length <= 12 && p.evidence_sentence_ids.every(validId) && support(p.support_used) && CAPTURE.includes(p.capture_status);
  if (event === 'minny_turn') return exact(p, ['turn_id', 'text', 'capture_status', 'support_used']) && validId(p.turn_id) && speech({ text: p.text, capture_status: p.capture_status, support_used: p.support_used });
  return ['shadow_complete', 'retell'].includes(event) && speech(p);
}
export function validEvent(e) {
  return exact(e, ['api_version', 'request_id', 'child_id', 'session_id', 'expected_revision', 'event', 'payload']) && e.api_version === '1.1' && validId(e.request_id) && validId(e.child_id) && validId(e.session_id) && Number.isSafeInteger(e.expected_revision) && e.expected_revision >= 0 && EVENTS.includes(e.event) && payloadValid(e.event, e.payload);
}
