/** Publisher API 1.3: no written responses, optional taps, no client speech-assessment claim. */
import {validAnyEvent,validJourneyEvent} from './journey-contract.mjs';
export const ORAL_RESPONSES=Object.freeze(['prediction','answer','shadow_complete','minny_turn','retell','repair_answer','followup_answer']);
export function legacyPublisherEvent(event) {
  const p={...event.payload}; delete p.response_kind;
  if(['answer','repair_answer','followup_answer'].includes(event.event) && p.choice_index===null) p.choice_index=0;
  return {...event,api_version:'1.2',payload:p};
}
export function validPublisherEvent(event) {
  if(!event || event.api_version!=='1.3' || !event.payload || typeof event.payload!=='object') return false;
  if(event.event==='audio_started') return !Array.isArray(event.payload) && Object.keys(event.payload).length===0 && validJourneyEvent({...event,api_version:'1.2',event:'pause',payload:{}});
  const p=event.payload, response=ORAL_RESPONSES.includes(event.event);
  if(response) {
    if(p.text!=='' || !['spoken','tap','skipped'].includes(p.response_kind)) return false;
    // A browser cannot attest that spoken content was captured or assessed by a provider.
    if(event.event!=='prediction' && !['not_attempted','missing','provider_failed','low_confidence'].includes(p.capture_status)) return false;
    if(['answer','repair_answer','followup_answer'].includes(event.event)) {
      if(p.response_kind==='tap' ? !Number.isInteger(p.choice_index) : p.choice_index!==null) return false;
    } else if(p.response_kind==='tap') return false;
  } else if(Object.hasOwn(p,'response_kind')) return false;
  return validJourneyEvent(legacyPublisherEvent(event));
}

export function validStoreEvent(event) { return validAnyEvent(event) || validPublisherEvent(event); }
