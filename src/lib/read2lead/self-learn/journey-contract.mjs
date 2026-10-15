/** Version1.2 adds bounded teaching and fresh probes; frozen1.1 validator stays unchanged. */
import { validEvent, validId, CAPTURE, SUPPORT } from './session-contract.mjs';
export const JOURNEY_EVENTS = Object.freeze(['begin_repair', 'repair_answer', 'skip_repair', 'followup_answer', 'skip_followup']);
export const MAX_JOURNEY_TEXT = 1500; // Unicode code points; fits frozen1.1's 3000 UTF-16-unit ceiling.
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function validJourneyEvent(e) {
  if (!exact(e, ['api_version', 'request_id', 'child_id', 'session_id', 'expected_revision', 'event', 'payload']) || e.api_version !== '1.2') return false;
  if (typeof e.payload?.text === 'string' && [...e.payload.text].length > MAX_JOURNEY_TEXT) return false;
  if (!JOURNEY_EVENTS.includes(e.event)) return validEvent({ ...e, api_version: '1.1' });
  if (![e.request_id, e.child_id, e.session_id].every(validId) || !Number.isSafeInteger(e.expected_revision) || e.expected_revision < 0) return false;
  if (['begin_repair', 'skip_repair', 'skip_followup'].includes(e.event)) return !!exact(e.payload, []);
  const p = e.payload;
  return !!(exact(p, ['item_id', 'choice_index', 'text', 'capture_status', 'support_used']) && validId(p.item_id) &&
    Number.isInteger(p.choice_index) && p.choice_index >= 0 && p.choice_index <= 2 &&
    typeof p.text === 'string' && [...p.text].length <= MAX_JOURNEY_TEXT && CAPTURE.includes(p.capture_status) &&
    Array.isArray(p.support_used) && new Set(p.support_used).size === p.support_used.length && p.support_used.every(x => SUPPORT.includes(x)));
}
export function validAnyEvent(e) { return validEvent(e) || validJourneyEvent(e); }
