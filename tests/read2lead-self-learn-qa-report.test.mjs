import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,symlinkSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { syntheticQAReport } from '../scripts/read2lead-self-learn-qa-report.mjs';
import { initializeSyntheticTarget } from '../scripts/read2lead-local-qa.mjs';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
const roots=resolve('.r2l-report-proofs');mkdirSync(roots,{recursive:true});
const lessons=JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/level-lessons.json',import.meta.url))).lessons;
const staff={active:true,role:'staff',id:'synthetic-report-staff'},actor={active:true,childId:'synthetic-report-child'},epoch=Date.parse('2026-09-19T00:00:00.000Z');
const iso=ms=>new Date(epoch+ms).toISOString();
function setup(){const folder=mkdtempSync(join(roots,'case-')),root=join(folder,'data');initializeSyntheticTarget(root);const store=new SyntheticStore({root});store.registerChild(staff,{child_id:actor.childId,family_id:'synthetic-report-family',display_name:'PRIVATE_NAME_CANARY'});return {root,store};}
const report=root=>syntheticQAReport({mode:'synthetic-local',dataRoot:root});
function mutate(root,fn){const db=new DatabaseSync(join(root,'read2lead-synthetic.sqlite'));try{const row=db.prepare('SELECT * FROM sessions').get(),record=JSON.parse(row.record_json);fn(record);db.prepare('UPDATE sessions SET record_json=? WHERE id=?').run(JSON.stringify(record),row.id);}finally{db.close();}}
async function partial(apiVersion='1.1'){
 const f=setup(),lesson=structuredClone(lessons[2]);lesson.private_canary='PRIVATE_ANSWER_KEY_CANARY';
 let s=(await f.store.start(actor,{sessionId:'PRIVATE_SESSION_CANARY',childId:actor.childId,lesson,now:iso(0),apiVersion})).session;
 const send=(name,payload,ms)=>{const data={api_version:apiVersion,request_id:'PRIVATE_REQUEST_'+(s.revision+1),child_id:actor.childId,session_id:s.session_id,expected_revision:s.revision,event:name,payload};s=f.store.submit(actor,data,iso(ms)).session;return data;};
 const prediction=send('prediction',{text:'PRIVATE_SPEECH_CANARY'},1000);send('input_complete',{order:['read']},3000);
 return {...f,lesson,send,prediction,get session(){return s;}};
}

test('empty marked synthetic store returns truthful empty aggregates without writing',()=>{
 const f=setup();f.store.close();const path=join(f.root,'read2lead-synthetic.sqlite'),bytes=readFileSync(path),r=report(f.root);
 assert.deepEqual(r.observations,{sessions:0,participating_children:0,children_with_activity_on_multiple_utc_days:0});assert.deepEqual(r.levels,[]);assert.equal(r.value_safety.wallet_drift,0);assert.deepEqual(readFileSync(path),bytes);
});
for(const version of ['1.1','1.2'])test(`real ${version} receipts report intervals, saved pause, supports and incomplete state without secrets`,async()=>{
 const f=await partial(version);f.send('pause',{},5000);f.send('resume',{},9000);const q=f.lesson.questions[0];f.send('support',{item_id:q.id,kind:'revealing_hint'},10000);f.send('answer',{item_id:q.id,choice_index:q.correct_index,text:'PRIVATE_TEXT_CANARY',evidence_sentence_ids:[],support_used:['frame'],capture_status:'not_attempted'},12000);f.store.close();
 const path=join(f.root,'read2lead-synthetic.sqlite'),bytes=readFileSync(path),r=report(f.root),g=r.levels[0];assert.equal(g.sessions,1);assert.equal(g.completed,0);assert.equal(g.assisted_sessions,1);assert.equal(g.assisted_attempts,1);assert.equal(g.attempts,1);assert.deepEqual(g.incomplete_by_stage,{comprehension:1});assert.deepEqual(g.support_kinds,{revealing_hint:1,frame:1});assert.equal(g.elapsed_between_acknowledgements_ms.median,12000);assert.equal(g.explicitly_paused_elapsed_ms.total,4000);assert.equal(g.stages.find(x=>x.stage==='pre_read').elapsed_between_acknowledgements_ms.total,1000);assert.equal(g.stages.find(x=>x.stage==='input').elapsed_between_acknowledgements_ms.total,2000);assert.equal(g.stages.find(x=>x.stage==='comprehension').elapsed_between_acknowledgements_ms.total,5000);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|synthetic-report-child|synthetic-report-family|correct_index|access_secret|request_id|session_id|child_id/);assert.ok(r.unmeasured.includes('human_dropout'));assert.match(r.limitations.join(' '),/not active study duration/);assert.deepEqual(readFileSync(path),bytes);
});
test('replayed request changes neither aggregates nor the acknowledged interval',async()=>{
 const f=await partial();const before=report(f.root);assert.equal(f.store.submit(actor,f.prediction,iso(999999)).replayed,true);assert.deepEqual(report(f.root),before);f.store.close();
});
test('saved session is counted as explicitly paused, never as dropout',async()=>{
 const f=await partial();f.send('pause',{},5000);f.store.close();const r=report(f.root);assert.equal(r.levels[0].paused,1);assert.deepEqual(r.levels[0].incomplete_by_stage,{comprehension:1});assert.ok(!Object.hasOwn(r.levels[0],'dropouts'));
});
for(const version of ['1.1','1.2'])test(`complete ${version} journey reconciles ten synthetic diamonds and preserves evidence limitations`,async()=>{
 const f=await partial(version);let clock=4000;const send=(n,p={})=>f.send(n,p,clock+=1000);
 for(const q of f.lesson.questions)send('answer',{item_id:q.id,choice_index:q.correct_index,text:'',evidence_sentence_ids:q.evidence_spans.map(x=>x.sentence_id),support_used:[],capture_status:'not_attempted'});
 send('save_understand');send('begin_use');const speech={text:'',capture_status:'not_attempted',support_used:[]};send('shadow_complete',speech);for(const turn of f.lesson.minny.turns)send('minny_turn',{...speech,turn_id:turn.id});send('retell',speech);if(version==='1.2')send('skip_followup');send('complete');f.store.close();const r=report(f.root);assert.equal(r.levels[0].completed,1);assert.deepEqual(r.levels[0].incomplete_by_stage,{});assert.equal(r.value_safety.synthetic_diamonds,10);assert.ok(r.unmeasured.includes('independent_assessment_accuracy'));
});
test('multiple UTC days are counted once per child and explicitly are not retention',async()=>{
 const f=await partial();f.send('pause',{},4000);f.send('resume',{},86401000);f.send('pause',{},86402000);f.send('resume',{},172801000);f.store.close();const r=report(f.root);assert.equal(r.observations.children_with_activity_on_multiple_utc_days,1);assert.match(r.limitations.join(' '),/not a retention claim/);
});
for(const [name,fn,message] of [
 ['out-of-order revision',r=>{r.receipts[1].response.session.revision=7;},'invalid_report_receipt'],
 ['foreign receipt',r=>{r.receipts[0].response.session.child_id='synthetic-foreign';},'invalid_report_receipt'],
 ['duplicate receipt',r=>{r.receipts[1].request_id=r.receipts[0].request_id;},'invalid_report_receipt'],
 ['missing receipt',r=>r.receipts.pop(),'invalid_report_record'],
 ['unknown schema',r=>{r.session.schema_version='9.0';},'invalid_report_record'],
 ['backward timestamp',r=>{r.receipts[0].response.session.updated_at=iso(-1);},'invalid_report_timestamp'],
 ['changed pin',r=>{r.lesson.level='L5';},'report_pin_hash_mismatch'],
 ['wrong terminal state',r=>{r.session.status='complete';},'invalid_report_record'],
 ['unknown support',r=>r.support.push({kind:'PRIVATE_UNTRUSTED_KIND'}),'invalid_report_support'],
])test('corrupt synthetic input refused: '+name,async()=>{const f=await partial();f.store.close();mutate(f.root,fn);const path=join(f.root,'read2lead-synthetic.sqlite'),bytes=readFileSync(path);assert.throws(()=>report(f.root),e=>e.message===message);assert.deepEqual(readFileSync(path),bytes);});
test('wallet drift is a failure, not an apparently healthy report',()=>{
 const f=setup();f.store.close();const db=new DatabaseSync(join(f.root,'read2lead-synthetic.sqlite'));db.exec('UPDATE wallets SET balance=5');db.close();assert.throws(()=>report(f.root),/report_wallet_drift/);
});
test('unmarked, production-marked, missing database and symlink targets are refused without creating a database',()=>{
 const root=mkdtempSync(join(roots,'unmarked-'));assert.throws(()=>report(root),/unsafe_target/);assert.equal(existsSync(join(root,'read2lead-synthetic.sqlite')),false);
 const f=setup();f.store.close();writeFileSync(join(f.root,'synthetic-target.json'),JSON.stringify({format:1,purpose:'production',database:'read2lead-synthetic.sqlite'}));const bytes=readFileSync(join(f.root,'read2lead-synthetic.sqlite'));assert.throws(()=>report(f.root),/unsafe_target/);assert.deepEqual(readFileSync(join(f.root,'read2lead-synthetic.sqlite')),bytes);
 const empty=join(mkdtempSync(join(roots,'empty-')),'data');initializeSyntheticTarget(empty);assert.throws(()=>report(empty),/report_database_missing/);assert.equal(existsSync(join(empty,'read2lead-synthetic.sqlite')),false);
 const linked=join(root,'link');symlinkSync(empty,linked);assert.throws(()=>report(linked),/unsafe_target/);assert.throws(()=>syntheticQAReport({mode:'production',dataRoot:empty}),/unsafe_report_mode/);
});
