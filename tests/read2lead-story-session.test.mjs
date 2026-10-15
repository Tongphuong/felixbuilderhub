import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrivateStoryStore } from '../scripts/lib/read2lead-story-store.mjs';
import { createStorySessionHandler, onRequest } from '../functions/api/read2lead-story-session.js';
import { initializeSyntheticTarget } from '../scripts/read2lead-local-qa.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json', import.meta.url)));
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-mission-')),data=path.join(root,'data');initializeSyntheticTarget(data);
  let store=new PrivateStoryStore(data), available=true, owner='adult-test';
  const pkg=structuredClone(fixture);
  const runtime={catalogue:()=>available?[pkg.lesson]:[],packageFor:()=>structuredClone(pkg)};
  let handler;
  const rebuild=()=>handler=createStorySessionHandler({store,runtime,origin:'http://127.0.0.1:9999',authenticate:()=>owner});rebuild();
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const call=async(input,options={})=>{const r=await handler(new Request('http://127.0.0.1:9999/api/read2lead-story-session'+(options.query||''),{
    method:input?'POST':'GET',headers:{...(input?{'Content-Type':'application/json',Origin:'http://127.0.0.1:9999'}:{}),...options.headers},...(input?{body:JSON.stringify(input)}:{})}));return{status:r.status,value:await r.json()};};
  const open=()=>call({action:'open',storyId:pkg.lesson.id,contentVersion:pkg.lesson.version});
  return{pkg,call,open,withdraw:()=>available=false,owner:v=>owner=v,restart:()=>{store.close();store=new PrivateStoryStore(data);rebuild();},data};
}
const event=(view,type,extra={},id='request-'+view.session.revision)=>({action:'event',sessionId:view.session.id,requestId:id,revision:view.session.revision,event:{type,...extra}});
const durable=({replayed,...view})=>view;
test('auth, origin, exact fields and unconfigured deployment deny writes',async t=>{
  const s=setup(t);s.owner(null);assert.equal((await s.open()).status,401);s.owner('adult-test');
  const input={action:'open',storyId:s.pkg.lesson.id,contentVersion:s.pkg.lesson.version};
  assert.equal((await s.call(input,{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await s.call({...input,verified:true})).status,400);
  assert.equal((await s.call(input,{headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal(onRequest().status,503);
});
test('payload never exposes answer keys, rubrics, provider facts or unpublished asset paths',async t=>{
  const s=setup(t);const r=await s.open();assert.equal(r.status,200);
  const next=await s.call(event(r.value,'read_complete'));assert.equal(next.status,200);
  const text=JSON.stringify(next.value);
  for(const secret of ['correct_index','accepted_meanings','essential_facts','expected_meaning','evidence_spans','package_json'])assert.equal(text.includes(secret),false,secret);
  assert.equal(next.value.lesson.question.options.length,3);
  assert.equal(next.value.session.complete,false);
});
test('state and exact version survive restart; another owner and withdrawn content are refused',async t=>{
  const s=setup(t);const first=(await s.open()).value;
  const read=(await s.call(event(first,'read_complete'))).value;
  s.restart();assert.deepEqual((await s.open()).value,durable(read));
  s.owner('different-adult');assert.equal((await s.call(null,{query:'?sessionId='+read.session.id})).status,404);
  s.owner('adult-test');s.withdraw();assert.equal((await s.call(null,{query:'?sessionId='+read.session.id})).status,409);
});
test('stale tabs, forged reward events and request ID conflicts cannot alter saved state',async t=>{
  const s=setup(t);const first=(await s.open()).value,request=event(first,'read_complete');
  const [a,b]=await Promise.all([s.call(request),s.call(request)]);assert.equal(a.status,200);assert.equal(b.value.replayed,true);
  assert.equal((await s.call(event(first,'retell_unassessed',{},'other'))).status,409);
  assert.equal((await s.call({...request,event:{type:'retell_unassessed'}})).status,409);
  const current=(await s.open()).value;
  assert.equal((await s.call(event(current,'reward',{diamonds:1000}))).status,400);
  assert.deepEqual((await s.open()).value,current);
});
test('server grades taps, bounds retries, marks assistance, and never completes a skipped retell',async t=>{
  const s=setup(t);let v=(await s.open()).value;v=(await s.call(event(v,'read_complete'))).value;
  const q=s.pkg.lesson.questions[0];
  v=(await s.call(event(v,'answer',{taskId:q.id,optionIndex:(q.correct_index+1)%q.options_en.length}))).value;
  assert.equal(v.lesson.question.retry,true);assert.equal(v.session.feedback.result,'needs_practice');
  v=(await s.call(event(v,'answer',{taskId:q.id,optionIndex:q.correct_index}))).value;
  assert.equal(v.session.feedback.assisted,true);assert.equal(v.session.feedback.result,'demonstrated');
  while(v.session.stage==='understand')v=(await s.call(event(v,'skip_question',{taskId:v.lesson.question.id}))).value;
  assert.equal(v.session.stage,'retell');
  v=(await s.call(event(v,'retell_unassessed'))).value;
  assert.equal(v.session.stage,'reward');assert.equal(v.session.complete,false);assert.equal(v.session.retelling,'unassessed');
  assert.deepEqual(v.session.awarded,{diamonds:0,xp:0});
  assert.deepEqual((await s.open()).value,durable(v));
});
test('invalid answer transaction rolls back and delayed duplicate returns current state',async t=>{
  const s=setup(t);let v=(await s.open()).value;const first=event(v,'read_complete');v=(await s.call(first)).value;
  const before=structuredClone(v);
  assert.equal((await s.call(event(v,'answer',{taskId:v.lesson.question.id,optionIndex:99}))).status,400);
  assert.deepEqual((await s.open()).value,durable(before));
  v=(await s.call(event(v,'skip_question',{taskId:v.lesson.question.id}))).value;
  const replay=await s.call(first);assert.equal(replay.value.session.revision,v.session.revision);
});
test('store cannot adopt an ordinary directory or symlinked database',async t=>{
  const s=setup(t);const other=path.join(s.data,'ordinary');fs.mkdirSync(other);
  assert.throws(()=>new PrivateStoryStore(other));
  const linked=path.join(s.data,'linked');initializeSyntheticTarget(linked);
  fs.symlinkSync(path.join(s.data,'read2lead-story-sessions.sqlite'),path.join(linked,'read2lead-story-sessions.sqlite'));
  assert.throws(()=>new PrivateStoryStore(linked),/unsafe_story_database/);
  fs.unlinkSync(path.join(linked,'read2lead-story-sessions.sqlite'));
  fs.linkSync(path.join(s.data,'read2lead-story-sessions.sqlite'),path.join(linked,'read2lead-story-sessions.sqlite'));
  assert.throws(()=>new PrivateStoryStore(linked),/unsafe_story_database/);
});
test('authorization is checked again after reading the body, before creating progress',async t=>{
  const s=setup(t);let calls=0;
  const handler=createStorySessionHandler({store:{open(){assert.fail('must not write');}},runtime:{catalogue:()=>[s.pkg.lesson],packageFor:()=>s.pkg},origin:'http://127.0.0.1:9999',authenticate:()=>++calls===1?'adult-test':null});
  const response=await handler(new Request('http://127.0.0.1:9999/api/read2lead-story-session',{method:'POST',headers:{Origin:'http://127.0.0.1:9999','Content-Type':'application/json'},body:JSON.stringify({action:'open',storyId:s.pkg.lesson.id,contentVersion:s.pkg.lesson.version})}));
  assert.equal(response.status,401);assert.equal(calls,2);
});
test('explicit retry archives an unfinished attempt and repeated reset cannot rewind new progress',async t=>{
 const s=setup(t);let v=(await s.open()).value;
 assert.equal((await s.call(event(v,'retry_mission'))).status,409);
 v=(await s.call(event(v,'read_complete'))).value;
 while(v.session.stage==='understand')v=(await s.call(event(v,'skip_question',{taskId:v.lesson.question.id}))).value;
 v=(await s.call(event(v,'retell_unassessed'))).value;
 const id=v.session.id,request=event(v,'retry_mission');v=(await s.call(request)).value;
 assert.equal(v.session.id,id);assert.equal(v.session.stage,'read');assert.equal(v.session.answered,0);assert.equal(v.session.complete,false);
 v=(await s.call(event(v,'read_complete'))).value;s.restart();
 assert.equal((await s.call(request)).value.session.stage,'understand');
 const db=new PrivateStoryStore(s.data);try{
  const old=db.db.prepare('SELECT state FROM story_attempt_history WHERE session=?').get(id);
  assert.equal(JSON.parse(old.state).stage,'reward');assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
 }finally{db.close();}
});

async function reachRetell(s){let v=(await s.open()).value;v=(await s.call(event(v,'read_complete'))).value;for(const q of s.pkg.lesson.questions)v=(await s.call(event(v,'answer',{taskId:q.id,optionIndex:q.correct_index}))).value;return v;}
test('retell starts with picture and prompt; explicit text help is saved before returning text and audio',async t=>{
 const s=setup(t);s.pkg.lesson.audio.asset_id='fixture-audio';s.pkg.lesson.illustrations=[{asset_id:'fixture-picture',alt_en:'Synthetic picture'}];s.pkg.assets=[{id:'fixture-audio',object_key:'fixture.mp3'},{id:'fixture-picture',object_key:'fixture.png'}];let v=await reachRetell(s);assert.equal(v.session.retellSupport,'none');assert.deepEqual(v.lesson.sentences,[]);assert.equal(v.lesson.audio.url,null);assert.ok(v.lesson.illustrations.length);assert.ok(v.lesson.retellPrompt);
 const reveal=event(v,'reveal_retell_text');let shown=await s.call(reveal);assert.equal(shown.status,200);v=shown.value;assert.equal(v.session.retellSupport,'text');assert.equal(v.lesson.sentences.length,s.pkg.lesson.story.sentences.length);assert.ok(v.lesson.audio.url);
 s.restart();assert.deepEqual(durable((await s.call(null,{query:'?sessionId='+v.session.id})).value),durable(v));
 assert.deepEqual(durable((await s.call(reveal)).value),durable(v));
 v=(await s.call(event(v,'retell_unassessed'))).value;v=(await s.call(event(v,'retry_mission'))).value;assert.equal(v.session.retellSupport,'text');
 v=(await s.call(event(v,'read_complete'))).value;for(const q of s.pkg.lesson.questions)v=(await s.call(event(v,'answer',{taskId:q.id,optionIndex:q.correct_index}))).value;assert.equal(v.session.retellSupport,'text');assert.ok(v.lesson.sentences.length);
});
test('failed text-help save leaves the text hidden and a replayable reveal request',async t=>{
 const s=setup(t),v=await reachRetell(s),request=event(v,'reveal_retell_text',{},'reveal-failure');
 const db=new PrivateStoryStore(s.data);t.after(()=>db.close());db.db.exec("CREATE TRIGGER refuse_reveal BEFORE INSERT ON story_events WHEN NEW.request_id='reveal-failure' BEGIN SELECT RAISE(ABORT,'forced_failure'); END");
 const failed=await s.call(request);assert.equal(failed.status,409);assert.equal(failed.value.code,'content_unavailable');
 let current=(await s.call(null,{query:'?sessionId='+v.session.id})).value;assert.equal(current.session.revision,v.session.revision);assert.deepEqual(current.lesson.sentences,[]);assert.equal(current.session.retellSupport,'none');
 db.db.exec('DROP TRIGGER refuse_reveal');assert.equal((await s.call(request)).status,200);
});
test('legacy retell remains text-supported; older unfinished comprehension enters the new picture-first retell',async t=>{
 const s=setup(t);let v=await reachRetell(s);const db=new PrivateStoryStore(s.data);t.after(()=>db.close());
 let state=db.get('adult-test',v.session.id);delete state.retellSupport;db.db.prepare('UPDATE story_sessions SET state=? WHERE id=?').run(JSON.stringify(state),v.session.id);
 v=(await s.call(null,{query:'?sessionId='+v.session.id})).value;assert.equal(v.session.retellSupport,'text');assert.ok(v.lesson.sentences.length);
 state.stage='understand';state.questionIndex=s.pkg.lesson.questions.length-1;db.db.prepare('UPDATE story_sessions SET state=? WHERE id=?').run(JSON.stringify(state),v.session.id);
 v=(await s.call(null,{query:'?sessionId='+v.session.id})).value;const q=s.pkg.lesson.questions.at(-1);v=(await s.call(event(v,'answer',{taskId:q.id,optionIndex:q.correct_index}))).value;
 assert.equal(v.session.retellSupport,'none');assert.deepEqual(v.lesson.sentences,[]);
});
test('retell text-help command refuses a wrong stage or caller-selected support',async t=>{
 const s=setup(t);let v=(await s.open()).value;assert.equal((await s.call(event(v,'reveal_retell_text'))).status,409);
 v=await reachRetell(s);assert.equal((await s.call(event(v,'reveal_retell_text',{support:'none'}))).status,400);
});
