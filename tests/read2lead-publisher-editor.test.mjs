import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openPublisherStore,publisherStoreDigest} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {createPublisherEditor} from '../scripts/lib/read2lead-publisher-editor.mjs';
import {SyntheticEditorStore} from '../scripts/lib/read2lead-self-learn-editor.mjs';
import {createEditorHandlers} from '../functions/lib/read2lead/self-learn/editor-handlers.mjs';
import {initializeSyntheticTarget,startLocalQA} from '../scripts/read2lead-local-qa.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
const account={editor_id:'synthetic-editor-qa',access_secret:'DEMO-EDITOR-LOCAL-ONLY'};
const query=p=>new URLSearchParams({source_id:p.lesson.source.source_id,version:p.lesson.version}).toString();
const actor='editor:'+account.editor_id;
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-publisher-editor-')),filename=path.join(root,'publisher.sqlite'),db=openPublisherStore(filename,{create:true});const assets=fixtureAssets(root),pkg=await fixturePackage(assets);await seedFixturePackages(db,[pkg]);initializePublisherCatalogue(db);
 const dataRoot=path.join(root,'learners'),distRoot=path.join(root,'dist');initializeSyntheticTarget(dataRoot);fs.mkdirSync(path.join(distRoot,'read2lead/self-learn'),{recursive:true});fs.writeFileSync(path.join(distRoot,'read2lead/self-learn/index.html'),'<html>Synthetic editor boundary test</html>');
 let clock=Date.parse(fixtureNow);const qa=await startLocalQA({mode:'synthetic-local',dataRoot,distRoot,port:0,publisherStore:db,publisherAssetRoot:root,now:()=>clock});t.after(async()=>{await qa.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 function client(editor){const prefix=editor?'/api/read2lead/editor/':'/api/read2lead/self-learn/';let cookie='',csrf='';return{get cookie(){return cookie;},get csrf(){return csrf;},async call(route,data,headers={}){const response=await fetch(qa.origin+prefix+route,{method:data===undefined?'GET':'POST',headers:{cookie,...(data===undefined?{}:{origin:qa.origin,'content-type':'application/json',[editor?'x-r2l-editor-csrf':'x-r2l-csrf']:csrf}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(value.csrf)csrf=value.csrf;return{status:response.status,value,response};}};}
 const editor=client(true),family=client(false);const access=await editor.call('login',account);assert.equal(access.status,200);assert.equal(access.value.publisher_editor,true);assert.equal((await family.call('login',{access_code:'DEMO-FAMILY-A'})).status,200);
 return{root,filename,db,assets,pkg,dataRoot,qa,editor,family,get clock(){return clock;},advance:()=>{clock+=900001;}};
}
const reviewData=(bundle,status='approved')=>({source_id:bundle.source_id,version:bundle.version,expected_package_sha256:bundle.package_sha256,reviews:[{kind:'text',package_sha256:bundle.content_sha256,status,method:'codex_editorial',evidence_ref:'Synthetic editor test only'}]});
async function prepareReview(f,status){const opened=await f.editor.call('publisher-document?'+query(f.pkg));assert.equal(opened.status,200);const plan=await f.editor.call('publisher-review-plan',reviewData(opened.value.current_view,status));assert.equal(plan.status,200,JSON.stringify(plan.value));return plan.value.prepared;}
test('publisher HTTP requires editor purpose and CSRF before parsing or lookup; family cannot see private bundles or media',async t=>{
 const f=await setup(t);for(const route of ['publisher-documents','publisher-document?'+query(f.pkg),'publisher-catalogue','publisher-media?'+query(f.pkg)+'&asset_id=synthetic-audio']){
  for(const cookie of ['',f.family.cookie]){const response=await fetch(f.qa.origin+'/api/read2lead/editor/'+route,{headers:{cookie}});assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/correct_index|document_sha256|evidence_ref/);}
 }
 const response=await fetch(f.qa.origin+'/api/read2lead/editor/publisher-apply',{method:'POST',headers:{origin:f.qa.origin,cookie:f.editor.cookie,'content-type':'application/json','x-r2l-editor-csrf':'wrong'},body:'{'});assert.equal(response.status,403);assert.equal((await response.json()).code,'csrf_failed');
 const bad=await f.editor.call('publisher-document?'+query(f.pkg)+'&extra=true');assert.equal(bad.status,400);assert.equal((await f.editor.call('publisher-documents?cursor=-1')).status,400);
 const opened=await f.editor.call('publisher-document?'+query(f.pkg));assert.equal(opened.status,200);assert.equal(opened.response.headers.get('cache-control'),'no-store');assert.equal(opened.value.current_view.package.lesson.questions[0].correct_index,f.pkg.lesson.questions[0].correct_index);
});
test('editor review plan binds actor, writes only on apply, retries exactly, and exposes current readiness',async t=>{
 const f=await setup(t),before=publisherStoreDigest(f.db),prepared=await prepareReview(f,'needs_correction');assert.equal(publisherStoreDigest(f.db),before);assert.equal(prepared.actor,actor);assert.equal(prepared.report.plan.changes[0].reviewer,actor);
 const applied=await f.editor.call('publisher-apply',prepared);assert.equal(applied.status,200,JSON.stringify(applied.value));assert.equal(applied.value.result.current.state,'needs_correction');assert.equal(applied.value.result.learner_writes,0);
 const repeated=await f.editor.call('publisher-apply',prepared);assert.equal(repeated.status,200);assert.equal(repeated.value.result.replayed,true);assert.equal(f.db.prepare("SELECT count(*) n FROM publisher_events WHERE kind='review_updated'").get().n,1);
 const spoofed=structuredClone(prepared);spoofed.actor='editor:synthetic-other';assert.equal((await f.editor.call('publisher-apply',spoofed)).status,400);
 const bundle=(await f.editor.call('publisher-document?'+query(f.pkg))).value.current_view,data=reviewData(bundle);data.reviews[0].reviewer='forged human';assert.equal((await f.editor.call('publisher-review-plan',data)).status,400);
 assert.equal((await f.editor.call('publisher-catalogue-plan',{targets:[{source_id:bundle.source_id,version:bundle.version}],reason:'Synthetic blocked publication'})).status,409);
});
test('new correction import clears supplied approvals and stays out of learner discovery',async t=>{
 const f=await setup(t),next=await fixturePackage(f.assets,{revision:2});const plan=await f.editor.call('publisher-import-plan',{package:next});assert.equal(plan.status,200,JSON.stringify(plan.value));assert.deepEqual(plan.value.prepared.report.packages[0].reviews,[]);
 const applied=await f.editor.call('publisher-apply',plan.value.prepared);assert.equal(applied.status,200,JSON.stringify(applied.value));assert.equal(applied.value.result.inserted,1);assert.deepEqual((await f.family.call('lessons')).value.lessons,[]);
 const opened=await f.editor.call('publisher-document?'+query(next));assert.equal(opened.value.current_view.state,'draft');assert.ok(opened.value.current_view.readiness.blockers.includes('review_human_teaching'));
 const real=structuredClone(next);real.lesson.source.kind='user_supplied_publisher';assert.equal((await f.editor.call('publisher-import-plan',{package:real})).status,403);
});
test('publication and withdrawal use editor authority; learner payloads omit private reviews and answer keys',async t=>{
 const f=await setup(t),plan=await f.editor.call('publisher-catalogue-plan',{targets:[{source_id:f.pkg.lesson.source.source_id,version:f.pkg.lesson.version}],reason:'Synthetic local publication'});assert.equal(plan.status,200,JSON.stringify(plan.value));assert.equal(plan.value.prepared.report.plan.operator,actor);
 assert.equal((await f.editor.call('publisher-apply',plan.value.prepared)).status,200);const cards=await f.family.call('lessons');assert.equal(cards.value.lessons.length,1);assert.doesNotMatch(JSON.stringify(cards.value),/correct_index|document_sha256|evidence_ref|human_teaching/);
 const started=await f.family.call('start',{request_id:'editor-published-session',child_id:'synthetic-an',lesson_id:f.pkg.lesson.id});assert.equal(started.status,200);assert.doesNotMatch(JSON.stringify(started.value),/correct_index|document_sha256|evidence_ref|human_teaching/);
 const withdrawal={source_id:f.pkg.lesson.source.source_id,version:f.pkg.lesson.version,reason:'Synthetic editor withdrawal'};assert.equal((await f.editor.call('publisher-withdraw',withdrawal)).status,200);assert.equal((await f.editor.call('publisher-withdraw',withdrawal)).status,200);assert.deepEqual((await f.family.call('lessons')).value.lessons,[]);
 assert.equal((await f.family.call('session?session_id='+started.value.session.session_id)).status,409);const events=f.db.prepare("SELECT payload_json FROM publisher_events WHERE kind='withdrawn'").all();assert.equal(events.length,1);assert.equal(JSON.parse(events[0].payload_json).operator,actor);
});
test('private editor media supports range and HEAD, refuses corrupt bytes, and is unavailable after logout',async t=>{
 const f=await setup(t),url=f.qa.origin+'/api/read2lead/editor/publisher-media?'+query(f.pkg)+'&asset_id=synthetic-audio',headers={cookie:f.editor.cookie,range:'bytes=0-43'};
 let response=await fetch(url,{headers});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,44);response=await fetch(url,{headers,method:'HEAD'});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,0);
 fs.writeFileSync(path.join(f.root,f.assets[1].object_key),Buffer.alloc(f.assets[1].bytes));response=await fetch(url,{headers});assert.equal(response.status,409);assert.equal((await response.json()).code,'publisher_asset_unavailable');await f.editor.call('logout',{});assert.equal((await fetch(url,{headers})).status,401);
});
async function directBoundary(f,{fault=()=>{},wrap=p=>p}={}){
 const store=new SyntheticEditorStore({mode:'synthetic-local',root:f.dataRoot,fault}),publisher=wrap(createPublisherEditor({mode:'synthetic-local',db:f.db,assetRoot:f.root}));const api=createEditorHandlers({mode:'synthetic-local',origin:f.qa.origin,store,publisher,now:()=>f.clock});let cookie='',csrf='';
 const call=async(route,data)=>{const response=await api.handle(new Request(f.qa.origin+'/api/read2lead/editor/'+route,{method:data===undefined?'GET':'POST',headers:{cookie,...(data===undefined?{}:{origin:f.qa.origin,'content-type':'application/json','x-r2l-editor-csrf':csrf})},...(data===undefined?{}:{body:JSON.stringify(data)})}));if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(value.csrf)csrf=value.csrf;return{status:response.status,value};};
 assert.equal((await call('login',account)).status,200);return{store,call};
}
test('revocation at the commit boundary refuses the publisher write, including after asynchronous preparation',async t=>{
 const f=await setup(t),security=new DatabaseSync(path.join(f.dataRoot,'read2lead-synthetic.sqlite'));let armed=false,hits=0;
 const d=await directBoundary(f,{fault:name=>{if(armed&&name==='editor_before_write_lock'){hits++;security.prepare('UPDATE editor_accounts SET enabled=0,credential_version=credential_version+1 WHERE id=?').run(account.editor_id);}}});
 try{const bundle=(await d.call('publisher-document?'+query(f.pkg))).value.current_view,plan=(await d.call('publisher-review-plan',reviewData(bundle,'needs_correction'))).value.prepared,before=publisherStoreDigest(f.db);armed=true;const response=await d.call('publisher-apply',plan);assert.equal(hits,1);assert.equal(response.status,401);assert.equal(response.value.code,'editor_access_revoked');assert.equal(publisherStoreDigest(f.db),before);}finally{d.store.close();security.close();}
});
test('session expiry immediately before commit refuses the write and expired reads disclose no private bundle',async t=>{
 const f=await setup(t);let armed=false;const d=await directBoundary(f,{fault:name=>{if(armed&&name==='editor_before_write_lock')f.advance();}});
 try{const bundle=(await d.call('publisher-document?'+query(f.pkg))).value.current_view,plan=(await d.call('publisher-review-plan',reviewData(bundle,'needs_correction'))).value.prepared,before=publisherStoreDigest(f.db);armed=true;const response=await d.call('publisher-apply',plan);assert.equal(response.status,401);assert.equal(response.value.code,'access_expired');assert.equal(publisherStoreDigest(f.db),before);const read=await d.call('publisher-document?'+query(f.pkg));assert.equal(read.status,401);assert.equal(read.value.current_view,undefined);}finally{d.store.close();}
});
test('access recheck after an awaited private bundle prevents a late disclosure',async t=>{
 const f=await setup(t),security=new DatabaseSync(path.join(f.dataRoot,'read2lead-synthetic.sqlite'));const d=await directBoundary(f,{wrap:publisher=>({...publisher,async document(...args){const result=await publisher.document(...args);security.prepare('UPDATE editor_accounts SET enabled=0,credential_version=credential_version+1 WHERE id=?').run(account.editor_id);return result;}})});
 try{const result=await d.call('publisher-document?'+query(f.pkg));assert.equal(result.status,401);assert.equal(result.value.current_view,undefined);assert.doesNotMatch(JSON.stringify(result.value),/correct_index|document_sha256/);}finally{d.store.close();security.close();}
});
