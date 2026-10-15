/** Additive oral journey. Existing 1.1/1.2 records, speech providers and rewards stay unchanged. */
import {createJourney,applyJourneyEvent} from './journey.mjs';
import {validatePublisherPackage} from './publisher-contract.mjs';
import {practiceSummary} from './assessment.mjs';
import {canonical,validId} from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
import {validPublisherEvent,legacyPublisherEvent,ORAL_RESPONSES} from '../../../../src/lib/read2lead/self-learn/publisher-session-contract.mjs';

export async function createPublisherJourney({package:input,...args}) {
  const {package:pkg,package_sha256}=await validatePublisherPackage(input);
  const record=await createJourney({...args,lesson:pkg.lesson});
  record.publisher_package_sha256=package_sha256;
  record.session.input_audio_used=false;
  record.session.schema_version='1.3.0'; record.session.engine_version='self-learn-oral-1';
  return record;
}
export function applyPublisherEvent(record,event,principal,now) {
  const fail=code=>({record,response:{ok:false,code,current_revision:['unauthorized','wrong_child','invalid_request'].includes(code)?null:record.session.revision}});
  if(!principal?.active || !validId(principal.childId)) return fail('unauthorized');
  if(principal.childId!==record.session.child_id) return fail('wrong_child');
  if(record.session.schema_version!=='1.3.0' || !validPublisherEvent(event) || typeof now!=='string' || !Number.isFinite(Date.parse(now))) return fail('invalid_request');
  if(event.child_id!==principal.childId || event.session_id!==record.session.session_id) return fail('wrong_child');
  const encoded=canonical(event),prior=record.receipts.find(r=>r.request_id===event.request_id);
  if(prior) return prior.canonical===encoded?{record,response:{...structuredClone(prior.response),replayed:true}}:fail('request_conflict');
  if(event.expected_revision!==record.session.revision) return fail('stale_revision');
  if(record.receipts.length>=128) return fail('session_limit');
  const p=event.payload,s=record.session,name=event.event;
  let next;
  if(name==='audio_started') {
    if(s.status!=='active'||s.stage!=='input') return fail('invalid_transition');
    if(!record.lesson.audio.asset_id||!['playable','matched','timing_verified','reviewed'].includes(record.lesson.audio.status)) return fail('content_unavailable');
    next=structuredClone(record);next.session.revision++;next.session.updated_at=now;next.session.input_audio_used=true;next.session.acknowledged_request_ids.push(event.request_id);
  } else if(name==='answer' && p.choice_index===null) {
    const q=record.lesson.questions[s.question_cursor];
    if(s.status!=='active' || s.stage!=='comprehension' || !q || q.id!==p.item_id) return fail('invalid_transition');
    if(p.evidence_sentence_ids.some(id=>!record.lesson.story.sentences.some(s=>s.id===id))) return fail('invalid_request');
    next=structuredClone(record); next.session.revision++; next.session.updated_at=now;
    next.session.question_cursor++; next.session.acknowledged_request_ids.push(event.request_id);
    const assistance=[...new Set([...p.support_used,...next.support.filter(x=>x.item_id===q.id).map(x=>x.kind)])].sort();
    next.attempts.push({request_id:event.request_id,event:'oral_answer',stage:s.stage,item_id:q.id,payload:{...structuredClone(p),support_used:assistance},assessment_state:'unassessable',score:null});
    if(next.session.question_cursor===3 && practiceSummary(next).reading.some(x=>x.status==='needs_support')) next.session.repair_state='available';
  } else {
    // Delegate the established transitions on a temporary compatible snapshot. Never persist that snapshot's version or audio alias.
    const compatible=structuredClone(record); compatible.session.schema_version='1.2.0';
    compatible.lesson.audio.asset_status=['playable','matched','timing_verified','reviewed'].includes(record.lesson.audio.status)?'ready':'not_ready';
    let translated=legacyPublisherEvent(event);
    if(name==='input_complete') {
      if(p.order.includes('listen')&&!s.input_audio_used&&compatible.lesson.audio.asset_status==='ready') return fail('invalid_request');
      if(s.input_audio_used&&!p.order.includes('listen')) translated.payload.order=['listen',...p.order];
    }
    if(['repair_answer','followup_answer'].includes(name) && p.choice_index===null) {
      const item=name==='repair_answer'?record.lesson.misconception_repair:record.lesson.independent_followup;
      if(p.item_id!==item.id || (name==='repair_answer' && s.repair_state!=='shown')) return fail('invalid_transition');
      translated={...translated,event:name==='repair_answer'?'skip_repair':'skip_followup',payload:{}};
    }
    const applied=applyJourneyEvent(compatible,translated,principal,now);
    if(!applied.response.ok) return fail(applied.response.code);
    next=applied.record; next.lesson=structuredClone(record.lesson); next.session.schema_version='1.3.0';
    next.receipts.pop();
    if(ORAL_RESPONSES.includes(name)) {
      const attempt=next.attempts.find(a=>a.request_id===event.request_id);
      if(attempt) {attempt.payload.response_kind=p.response_kind;if(['repair_answer','followup_answer'].includes(name))attempt.event=name;}
    }
  }
  next.session.evidence_ids=next.attempts.map(a=>a.request_id);
  const response={ok:true,request_id:event.request_id,session:structuredClone(next.session),replayed:false};
  next.receipts.push({request_id:event.request_id,canonical:encoded,response:structuredClone(response)});
  return{record:next,response};
}
export function publisherPracticeSummary(record) {
  const summary=practiceSummary(record);
  const oral=record.attempts.filter(a=>a.event==='oral_answer').map(a=>({attempt_id:a.request_id,item_id:a.item_id,dimension:record.lesson.questions.find(q=>q.id===a.item_id).dimension,
    choice_result:'not_attempted',evidence_result:'not_assessed',explanation_result:'not_assessed',status:'unassessable',response_kind:a.payload.response_kind,support_used:[...a.payload.support_used],independent_mastery:false,score:null,
    feedback_en:a.payload.response_kind==='skipped'?'You can try this question again later.':'Your speaking practice is saved. It has not been assessed.'}));
  summary.reading=[...summary.reading,...oral].sort((a,b)=>record.lesson.questions.findIndex(q=>q.id===a.item_id)-record.lesson.questions.findIndex(q=>q.id===b.item_id));
  return summary;
}
