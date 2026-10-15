/** Fabricated fixtures test the private draft route; they never count as real lessons. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixtureAssets,fixturePackage,seedFixturePackages,fixtureNow} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
import {openPublisherStore,publisherStoreDigest,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue,planPublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {publisherReadiness} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {publicPublisherLesson} from '../functions/lib/read2lead/self-learn/publisher-views.mjs';
import {createPrivateRehearsalRuntime,isPrivateRehearsalRuntime,isApprovedPublisherRuntime,createSyntheticPublisherRuntime} from '../scripts/lib/read2lead-publisher-runtime.mjs';
import {initializePrivateEditorAccess} from '../scripts/lib/read2lead-private-editor-access.mjs';
import {initializeSyntheticTarget,startPrivateDraftPreview,startLocalQA} from '../scripts/read2lead-local-qa.mjs';
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-rehearsal-')),filename=path.join(root,'publisher.sqlite'),db=openPublisherStore(filename,{create:true});initializePublisherCatalogue(db);
 const assets=fixtureAssets(root),p=await fixturePackage(assets);p.lesson.source.kind='user_supplied_publisher';p.lesson.source.attribution='Fabricated draft-route test, not real source material';p.lesson.theme='A real authored theme outside the legacy interest map';p.rights=[];p.reviews=[];p.lesson.audio.status='playable';p.lesson.audio.segments=[];p.assets.forEach(a=>a.provenance=a.kind==='audio'?'supplied_recording':'new_illustration');
 await seedFixturePackages(db,[p]);const ro=new DatabaseSync(filename,{readOnly:true});ro.exec('PRAGMA query_only=ON');
 const accessFile=path.join(root,'access.json');initializePrivateEditorAccess(accessFile);const creds=JSON.parse(fs.readFileSync(accessFile));
 const dataRoot=path.join(root,'learners'),distRoot=path.join(root,'dist');initializeSyntheticTarget(dataRoot);fs.mkdirSync(path.join(distRoot,'read2lead/self-learn'),{recursive:true});fs.writeFileSync(path.join(distRoot,'read2lead/self-learn/index.html'),'<html><div>BẢN QA CỤC BỘ · Chỉ dùng dữ liệu mẫu · Không có quà thật</div></html>');
 const targets=[{source_id:p.lesson.source.source_id,version:p.lesson.version}],options={mode:'private-rehearsal',publisherStore:ro,publisherAssetRoot:root,accessFile,targets,dataRoot,distRoot,port:0};
 t.after(()=>{ro.close();db.close();fs.rmSync(root,{recursive:true,force:true});});return{root,db,ro,p,assets,accessFile,creds,options};
}
async function client(host,s){
 const login=await fetch(host.origin+'/private-rehearsal/login',{method:'POST',redirect:'manual',headers:{Origin:host.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({editor_id:s.creds.editor_id,access_secret:s.creds.access_secret})});assert.equal(login.status,303);
 const privateCookie=login.headers.get('set-cookie').split(';')[0];let familyCookie='',csrf='';const headers=()=>({Cookie:privateCookie+(familyCookie?'; '+familyCookie:'')});
 const call=async(route,data)=>{const r=await fetch(host.origin+'/api/read2lead/self-learn/'+route,{method:data?'POST':'GET',headers:{...headers(),...(data?{Origin:host.origin,'Content-Type':'application/json','X-R2L-CSRF':csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});if(r.headers.get('set-cookie'))familyCookie=r.headers.get('set-cookie').split(';')[0];const raw=await r.text();let value;try{value=JSON.parse(raw);}catch{value=raw;}if(value?.csrf)csrf=value.csrf;return{status:r.status,value};};
 assert.equal((await call('login',{access_code:'DEMO-FAMILY-A'})).status,200);return{call,headers};
}
const speech={text:'',capture_status:'not_attempted',support_used:[],response_kind:'skipped'};
function next(view){const s=view.session,l=view.lesson;switch(s.stage){case'pre_read':return['prediction',{text:'',response_kind:'skipped'}];case'input':return['input_complete',{order:['read']}];case'comprehension':return s.question_cursor<3?['answer',{...speech,item_id:l.questions[s.question_cursor].id,choice_index:null,evidence_sentence_ids:[]}]:['save_understand',{}];case'understand_saved':return['begin_use',{}];case'shadowing':return['shadow_complete',speech];case'mini_story':return['minny_turn',{...speech,turn_id:l.minny.turns[s.dialogue_cursor].id}];case'retell':return !view.retell_received?['retell',speech]:s.followup_state==='ready'?['followup_answer',{...speech,item_id:view.learning_steps.followup.prompt.id,choice_index:null}]:['complete',{}];default:throw Error('unexpected stage');}}
test('selected draft is separately branded; synthetic/publication modes still reject it',async t=>{
 const s=await setup(t),before=publisherStoreDigest(s.db);const runtime=await createPrivateRehearsalRuntime({mode:'private-rehearsal',db:s.ro,assetRoot:s.root,targets:s.options.targets});assert.equal(isPrivateRehearsalRuntime(runtime),true);assert.equal(isApprovedPublisherRuntime(runtime),false);
 assert.equal((await publisherReadiness(s.p,{now:fixtureNow})).publication_ready,false);await assert.rejects(publicPublisherLesson(s.p,{mode:'approved-local',now:fixtureNow}),/publisher_not_ready/);await assert.rejects(createSyntheticPublisherRuntime({mode:'synthetic-local',packages:[s.p]}),/synthetic_publisher_only/);
 await assert.rejects(planPublisherCatalogue(s.db,{targets:s.options.targets,operator:'QA',reason:'Must fail for unapproved draft'},{assetRoot:s.root,now:fixtureNow}));
 await assert.rejects(createPrivateRehearsalRuntime({mode:'private-rehearsal',db:s.db,assetRoot:s.root,targets:s.options.targets}),/invalid_private_rehearsal/);assert.equal(publisherStoreDigest(s.db),before);
});
test('anonymous, wrong credentials, cross-origin and revoked access cannot read private drafts/media',async t=>{
 const s=await setup(t),host=await startPrivateDraftPreview(s.options);try{
 for(const method of ['GET','HEAD']){const form=await fetch(host.origin+'/private-rehearsal/login',{method});assert.equal(form.status,200);assert.equal(form.headers.get('referrer-policy'),'same-origin');}
 const nullOrigin=await fetch(host.origin+'/private-rehearsal/login',{method:'POST',headers:{Origin:'null','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({editor_id:s.creds.editor_id,access_secret:s.creds.access_secret})});assert.equal(nullOrigin.status,403);
 assert.equal((await fetch(host.origin+'/api/read2lead/self-learn/lessons')).status,401);assert.equal((await fetch(host.origin+'/api/read2lead/self-learn/media/'+s.assets[1].object_key)).status,401);
 const post={method:'POST',redirect:'manual',headers:{Origin:host.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({editor_id:s.creds.editor_id,access_secret:'a'.repeat(64)})};assert.equal((await fetch(host.origin+'/private-rehearsal/login',post)).status,401);assert.equal((await fetch(host.origin+'/private-rehearsal/login',{...post,headers:{...post.headers,Origin:'https://elsewhere.example'}})).status,403);
 const a=await client(host,s),page=await fetch(host.url,{headers:a.headers()});assert.match(await page.text(),/PRIVATE REHEARSAL/);assert.equal((await a.call('lessons')).value.lessons.length,1);assert.equal((await fetch(host.origin+'/read2lead/editor/',{headers:a.headers()})).status,404);
 const reading=await a.call('library/open',{request_id:'private-free-reading',child_id:'synthetic-an',lesson_id:s.p.lesson.id});assert.equal(reading.status,200);assert.equal(reading.value.current_view.lesson.policy.private_rehearsal,true);assert.equal(reading.value.current_view.lesson.policy.publication_ready,false);assert.equal(reading.value.current_view.lesson.policy.compulsory_tasks,false);
 fs.writeFileSync(s.accessFile,JSON.stringify({...s.creds,access_secret:'b'.repeat(64)}),{mode:0o600});assert.equal((await a.call('lessons')).status,401);
 }finally{await host.close();}
});
test('draft Understand→Use completes with test progress, survives restart, preserves source state and respects withdrawal',async t=>{
 const s=await setup(t),before=publisherStoreDigest(s.db);let host=await startPrivateDraftPreview(s.options);try{
 let a=await client(host,s),r=await a.call('start',{request_id:'draft-start',child_id:'synthetic-an',lesson_id:s.p.lesson.id});assert.equal(r.status,200,JSON.stringify(r));let view=r.value.view;assert.equal(view.lesson.policy.private_rehearsal,true);assert.equal(view.lesson.policy.human_accepted,false);assert.equal(view.lesson.questions[0].correct_index,undefined);assert.equal(view.lesson.audio.timing_verified,false);
 let steps=0,last;while(view.session.status!=='complete'){assert.ok(++steps<40);const[event,payload]=view.session.stage==='input'&&!view.session.input_audio_used?['audio_started',{}]:next(view);last={api_version:'1.3',request_id:'draft-step-'+steps,child_id:'synthetic-an',session_id:view.session.session_id,expected_revision:view.session.revision,event,payload};r=await a.call('event',last);assert.equal(r.status,200,JSON.stringify(r));view=r.value.current_view;if(event==='audio_started')assert.equal(view.session.input_audio_used,true);}
 assert.equal((await a.call('event',last)).value.replayed,true);assert.equal(publisherStoreDigest(s.db),before);await host.close();host=await startPrivateDraftPreview(s.options);a=await client(host,s);const resumed=await a.call('session?session_id='+view.session.session_id);assert.equal(resumed.status,200);assert.deepEqual(resumed.value.view,view);
 withdrawPublisherVersion(s.db,{source_id:s.p.lesson.source.source_id,version:s.p.lesson.version,reason:'QA withdrawal',now:fixtureNow});assert.equal((await a.call('session?session_id='+view.session.session_id)).status,409);
 }finally{await host.close();}
});
test('expiry and asset corruption deny access; raw publisher packages remain refused by ordinary QA',async t=>{
 const s=await setup(t);await assert.rejects(startLocalQA({...s.options,mode:'synthetic-local',publisherStore:null,publisherPackages:[s.p]}),/synthetic_publisher_only/);
 let now=Date.now();const host=await startPrivateDraftPreview({...s.options,now:()=>now,ttlMs:1000});try{const a=await client(host,s);now+=1001;assert.equal((await a.call('lessons')).status,401);}finally{await host.close();}
 const asset=s.assets[1],file=path.join(s.root,asset.object_key),bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);await assert.rejects(createPrivateRehearsalRuntime({mode:'private-rehearsal',db:s.ro,assetRoot:s.root,targets:s.options.targets}),/asset_hash_mismatch/);
});

test('original reader mission routes require adult auth, serve media ranges and keep draft progress isolated',async t=>{
 const s=await setup(t),before=publisherStoreDigest(s.db),host=await startPrivateDraftPreview(s.options);
 try {
  const route=host.origin+'/api/read2lead-story-session';
  assert.equal((await fetch(route)).status,401);
  assert.equal((await fetch(host.origin+'/api/read2lead-story-media/'+s.assets[1].object_key)).status,401);
  const a=await client(host,s);
  const open=await fetch(route,{method:'POST',headers:{...a.headers(),Origin:host.origin,'Content-Type':'application/json'},body:JSON.stringify({action:'open',storyId:s.p.lesson.id,contentVersion:s.p.lesson.version})});
  assert.equal(open.status,200);const v=await open.json();assert.equal(v.session.stage,'read');
  const audio=await fetch(host.origin+v.lesson.audio.url,{headers:{...a.headers(),Range:'bytes=0-15'}});
  assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,16);
  assert.equal(v.policy.testProgressOnly,true);assert.equal(v.policy.providerEnabled,false);
  assert.equal(publisherStoreDigest(s.db),before);
 } finally {await host.close();}
});
