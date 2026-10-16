import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentSummary, safeStoryAssessment } from '../functions/lib/read2lead/parent-summary.mjs';
import { onRequestGet } from '../functions/api/read2lead-progress.js';

const pack = extra => ({pack_id:'sky-pack',schema_version:'story-mission-v1',story_title:'The Sky Is Blue!',story_reference:{id:'sky',source_id:'sky-source',version:'1.2.8'},created_at:'2026-10-12T03:00:00Z',picture_retell_required:true,...extra});
const summary = p => buildParentSummary({progress:{current_pack:p}}, {diamonds:270,completed_packs:1});
test('opened, partial questions, questions complete and retelling complete remain distinct',()=>{
  assert.equal(summary(pack({})).entries[0].stage,'opened');
  const partial=summary(pack({story_session:{question_count:3,question_total:12}}));
  assert.equal(partial.entries[0].stage,'questions_in_progress');assert.equal(partial.entries[0].question_count,3);assert.equal(partial.entries[0].question_score,null);assert.equal(partial.next_step.kind,'questions');
  const questions=summary(pack({story_complete:true,story_session:{question_count:12,question_total:12}}));
  assert.equal(questions.entries[0].stage,'questions_completed');assert.equal(questions.entries[0].retell,'pending');assert.equal(questions.next_step.kind,'retell');
  const finished=summary(pack({story_complete:true,story_session:{complete:true,question_count:12,question_total:12,picture_retell_complete:true}}));
  assert.equal(finished.entries[0].stage,'retelling_completed');assert.equal(finished.next_step.kind,'next_story');
});
test('Sky saved in archive and receipt history appears once, alongside original work',()=>{
  const sky=pack({story_complete:true,story_session:{complete:true,picture_retell_complete:true}});
  const original={pack_id:'book-pack',title:'A Small Bird',status:'reviewed_pass_web_v2',reviewed_at:'2026-10-13T03:00:00Z',score_percent:80};
  const account={progress:{current_pack:original,review_history:[{pack_id:sky.pack_id,story_source_id:'sky-source',story_complete:true,story_title:sky.story_title},original]},story_pack_history:{[sky.pack_id]:sky}};
  const state={completed_packs:2,pack_history:[{pack_id:'story:sky-source',completed_at:'2026-10-12T03:00:00Z'}]};const before=JSON.stringify({account,state});
  const result=buildParentSummary(account,state);assert.equal(result.entries.length,2);assert.equal(result.entries[1].title,'The Sky Is Blue!');assert.equal(result.entries[1].stage,'retelling_completed');assert.equal(result.entries[0].stage,'lesson_completed');assert.equal(result.entries[0].question_score,80);assert.equal(result.entries[0].retell,'not_applicable');assert.equal(JSON.stringify({account,state}),before);
});
test('no score inferred from transcript, recording, missing values or invalid pronunciation',()=>{
  const projection=safeStoryAssessment({transcript:'perfect words',pictureRetellResult:{status:'unassessed',meanings:[{label:'A point',met:true}],pronunciation:{scorer:'azure_pronunciation',accuracy_percent:99}}});
  assert.equal(projection.pronunciation,null);assert.deepEqual(projection.content_points,[]);
  for(const pron of [null,{accuracy_percent:99},{scorer:'transcript',accuracy_percent:100},{scorer:'azure_pronunciation',accuracy_percent:null},{scorer:'azure_pronunciation',accuracy_percent:101}]) {
    const result=safeStoryAssessment({pictureRetellResult:{status:'complete',pronunciation:pron}});assert.equal(result.pronunciation,null);
  }
  const entry=summary(pack({story_session:{recorded:true,transcript:'secret',assessment_summary:{question_score:100}}})).entries[0];assert.equal(entry.question_score,null);assert.equal(entry.pronunciation,null);assert.equal(JSON.stringify(entry).includes('secret'),false);
});
test('saved content feedback and validated pronunciation provide a factual next step',()=>{
  const assessment=safeStoryAssessment({pictureRetellResult:{status:'needs_practice',meanings:[{label:'The sky changed.',met:true},{label:'Why the uncle was happy.',met:false}],pronunciation:{scorer:'azure_pronunciation_unscripted',accuracy_percent:82,words:['private']},transcript:'private'}});
  const result=summary(pack({story_complete:true,story_session:{complete:true,assessment_summary:assessment}}));
  assert.equal(result.next_step.kind,'retry_content');assert.match(result.next_step.text,/Why the uncle/);assert.deepEqual(result.entries[0].pronunciation,{accuracy_percent:82});assert.equal(JSON.stringify(result).includes('private'),false);
});
test('actual saved Azure retelling reaches parent summary without exposing provider payloads',()=>{
  const saved={status:'complete',speech:'azure',meanings:[{label:'A saved idea',met:true}],pronunciation:{accuracy:93,fluency:86,seconds:26.15},transcript:'private recording text'};
  const projection=safeStoryAssessment({pictureRetellResult:saved});
  assert.deepEqual(projection.pronunciation,{scorer:'azure_pronunciation_unscripted',accuracy_percent:93});
  const result=summary(pack({story_session:{complete:true,picture_retell_complete:true,assessment_summary:projection}}));
  assert.deepEqual(result.entries[0].pronunciation,{accuracy_percent:93});
  assert.equal(JSON.stringify(result).includes('private recording text'),false);
  for(const change of [{status:'unassessed'},{speech:'understood'},{speech:'transcript'},{speech:null},{pronunciation:{accuracy:93}},{pronunciation:{accuracy:101,fluency:86,seconds:26.15}},{pronunciation:{accuracy:93,fluency:null,seconds:26.15}},{pronunciation:{accuracy:93,fluency:86,seconds:0}}]) {
    assert.equal(safeStoryAssessment({pictureRetellResult:{...saved,...change}}).pronunciation,null);
  }
});
test('missing history and unknown old retelling remain honest, and ordering keeps current work first',()=>{
  assert.deepEqual(buildParentSummary({},{}).entries,[]);assert.equal(buildParentSummary({},{}).next_step.kind,'start');
  const old=summary(pack({picture_retell_required:undefined,story_complete:true}));assert.equal(old.entries[0].retell,'unknown');assert.equal(old.entries[0].question_total,null);assert.equal(old.next_step.kind,'check_retell');
});
test('existing progress endpoint returns only the requested account summary',async()=>{
  const own={student_profile:{student_name:'An',level:'L0'},progress:{current_pack:{pack_id:'own-original',story_title:'My saved story',status:'awaiting_review',created_at:'2026-10-12T03:00:00Z'}}};
  const values=new Map([['R2L-OWN',JSON.stringify(own)],['R2L-OTHER',JSON.stringify({progress:{current_pack:{pack_id:'other',story_title:'PRIVATE OTHER'}}})]]);
  const env={READ2LEAD_CODES:{async get(key,opts){const value=values.get(key);return value?(opts?.type==='json'?JSON.parse(value):value):null;},async put(){throw Error('unexpected account write');}}};
  const response=await onRequestGet({env,request:new Request('https://test.example/api/read2lead-progress?code=R2L-OWN')});assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.parent_summary.entries[0].title,'My saved story');assert.equal(JSON.stringify(data.parent_summary).includes('PRIVATE OTHER'),false);
});
