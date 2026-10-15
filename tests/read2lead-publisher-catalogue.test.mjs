import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fixture from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {openPublisherStore,planPublisherImport,applyPublisherImport,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue,publisherCatalogueHead,publisherCatalogueState,planPublisherCatalogue,applyPublisherCatalogue,loadPublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {publisherReviewBundle} from '../scripts/lib/read2lead-publisher-review.mjs';
import {createPublishedSyntheticRuntime} from '../scripts/lib/read2lead-publisher-runtime.mjs';
import {initializeSyntheticTarget,startLocalQA} from '../scripts/read2lead-local-qa.mjs';
const now='2026-09-20T12:00:00.000Z';
const audit={operator:'Synthetic operator',reason:'Synthetic catalogue test'};
const target=p=>({source_id:p.lesson.source.source_id,version:p.lesson.version});
async function approvals(p){const hash=await publisherDigest(p);p.reviews=['text','activities','visual','audio_decode','audio_match','audio_listening','audio_timing','rights','human_teaching','human_art'].map(kind=>({kind,package_sha256:hash,status:'approved',reviewer:'Synthetic reviewer; no real review',method:kind.startsWith('human_')?'human':'codex_editorial',evidence_ref:'synthetic-test-only',reviewed_at:'2026-01-01T00:00:00.000Z'}));return p;}
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-catalogue-')),filename=path.join(root,'publisher.sqlite');let db=openPublisherStore(filename,{create:true});
 t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const p=structuredClone(fixture);p.lesson.id='published-cup';
 const png=path.join(root,'temporary.png');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=navy:s=16x16','-frames:v','1','-threads','1',png]);
 const wav=Buffer.alloc(128044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 p.assets=[['image',fs.readFileSync(png),'png'],['audio',wav,'wav']].map(([kind,bytes,ext])=>{const sha=createHash('sha256').update(bytes).digest('hex'),object_key=sha+'.'+ext;fs.writeFileSync(path.join(root,object_key),bytes);return{id:'synthetic-'+kind,kind,sha256:sha,bytes:bytes.length,mime:kind+'/'+ext,object_key,width:kind==='image'?16:0,height:kind==='image'?16:0,duration_seconds:kind==='audio'?8:0,provenance:'synthetic_fixture',reference_hashes:[],character_ids:[],alt_en:'Synthetic test media'};});
 p.lesson.illustrations=[{id:'synthetic-scene',kind:'raster',asset_id:'synthetic-image',alt_en:'Synthetic pattern',sentence_ids:['s1']}];p.lesson.audio.asset_id='synthetic-audio';p.lesson.audio.status='reviewed';p.lesson.audio.segments=p.lesson.shadowing.sentence_ids.map((id,i)=>({id:'segment-'+i,sentence_ids:[id],start_seconds:i,end_seconds:i+1}));p.lesson.review.author_check='complete';
 p.rights=[{id:'synthetic-grant',source_id:p.lesson.source.source_id,document_sha256:'a'.repeat(64),actions:['digital_text','activities','illustrations','stream_recording','translation'],valid_from:'2026-01-01T00:00:00.000Z',valid_until:'2027-01-01T00:00:00.000Z',status:'granted',territory:'Synthetic only',platform:'Read2Lead',reviewer:'Synthetic test'}];await approvals(p);
 const config={assetRoot:root,now};
 const s={root,filename,p,config,get db(){return db;},reopen(){db.close();db=openPublisherStore(filename);},async import(packages){const plan=await planPublisherImport(db,packages,config);return applyPublisherImport(db,packages,{...plan,...config});}};
 await s.import([p]);return s;
}
async function publish(s,packages){const plan=await planPublisherCatalogue(s.db,{targets:packages.map(target),...audit},s.config);return applyPublisherCatalogue(s.db,plan,s.config);}
async function revision(p){const next=structuredClone(p);next.lesson.version='1.2.2';next.lesson.title_en+=' revised';next.lesson.audio.content_version=next.lesson.version;next.lesson.questions.forEach(q=>q.version=next.lesson.version);next.lesson.independent_followup.version=next.lesson.version;return approvals(next);}
test('explicit private initialization is repeat-safe; publication is dry-run, atomic and durable',async t=>{
 const s=await setup(t);await assert.rejects(planPublisherCatalogue(s.db,{targets:[target(s.p)],...audit},s.config),/not_initialized/);
 assert.equal(initializePublisherCatalogue(s.db).created,true);assert.equal(initializePublisherCatalogue(s.db).created,false);
 const before=publisherCatalogueState(s.db),plan=await planPublisherCatalogue(s.db,{targets:[target(s.p)],...audit},s.config);assert.equal(plan.writes,0);assert.equal(publisherCatalogueState(s.db),before);assert.equal(publisherCatalogueHead(s.db),null);
 s.db.exec("CREATE TRIGGER catalogue_fault BEFORE INSERT ON publisher_catalogue_receipts BEGIN SELECT RAISE(ABORT,'synthetic_interrupt'); END");
 await assert.rejects(applyPublisherCatalogue(s.db,plan,s.config),/synthetic_interrupt/);assert.equal(publisherCatalogueState(s.db),before);assert.equal(s.db.prepare('SELECT count(*) n FROM publisher_catalogues').get().n,0);
 s.db.exec('DROP TRIGGER catalogue_fault');const first=await applyPublisherCatalogue(s.db,plan,s.config);assert.equal(first.learner_writes,0);assert.equal(first.production_release_authorized,false);s.reopen();assert.equal(publisherCatalogueHead(s.db),first.catalogue_id);const bundle=await publisherReviewBundle(s.db,target(s.p),s.config);assert.equal(bundle.state,'published');assert.equal(bundle.catalogue.discovery_active,true);assert.equal(bundle.publication,'private_local_catalogue');
 assert.equal((await applyPublisherCatalogue(s.db,plan,s.config)).replayed,true);assert.equal(s.db.prepare("SELECT count(*) n FROM publisher_events WHERE kind='catalogue_publish'").get().n,1);
});
test('drafts, merely verified reviews, expired rights, missing media and missing predecessors cannot publish',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);
 const p=await revision(s.p);p.reviews[0].status='verified';await s.import([p]);await assert.rejects(publish(s,[p]),/publisher_not_approved/);
 await assert.rejects(planPublisherCatalogue(s.db,{targets:[target(s.p)],...audit},{...s.config,now:'2027-01-02T00:00:00.000Z'}),/publisher_not_approved/);
 const previous=fs.readFileSync(path.join(s.root,s.p.assets[0].object_key));fs.writeFileSync(path.join(s.root,s.p.assets[0].object_key),Buffer.alloc(previous.length));await assert.rejects(publish(s,[s.p]),/asset_hash_mismatch/);fs.writeFileSync(path.join(s.root,s.p.assets[0].object_key),previous);
 const missing=structuredClone(s.p);missing.lesson.id='sequel';missing.lesson.source.source_id='sequel-source';missing.lesson.source.story_number=2;missing.lesson.source.predecessor_source_id='missing-source';missing.rights[0].source_id='sequel-source';await approvals(missing);await s.import([missing]);await assert.rejects(publish(s,[missing]),/catalogue_predecessor_missing/);
 assert.equal(publisherCatalogueHead(s.db),null);
});
test('stale plans and approval changes refuse, while historical retry cannot undo a newer publication',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);const firstPlan=await planPublisherCatalogue(s.db,{targets:[target(s.p)],...audit},s.config),old=await applyPublisherCatalogue(s.db,firstPlan,s.config);
 const next=await revision(s.p);await s.import([next]);const stale=await planPublisherCatalogue(s.db,{targets:[target(next)],...audit},s.config);
 const changed=structuredClone(next);changed.reviews[0].status='needs_correction';await s.import([changed]);await assert.rejects(applyPublisherCatalogue(s.db,stale,s.config),/stale_catalogue_plan/);
 await s.import([next]);const fresh=await publish(s,[next]);assert.notEqual(old.catalogue_id,fresh.catalogue_id);
 const replay=await applyPublisherCatalogue(s.db,firstPlan,s.config);assert.equal(replay.catalogue_id,old.catalogue_id);assert.equal(replay.current_catalogue_id,fresh.catalogue_id);assert.equal(publisherCatalogueHead(s.db),fresh.catalogue_id);
});
test('rollback changes discovery only, retains published versions, and refuses a withdrawn target',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);const old=await publish(s,[s.p]),next=await revision(s.p);await s.import([next]);await publish(s,[next]);
 const rollback=await planPublisherCatalogue(s.db,{rollback_to:old.catalogue_id,...audit},s.config);await applyPublisherCatalogue(s.db,rollback,s.config);s.reopen();
 let loaded=await loadPublisherCatalogue(s.db,s.config);assert.equal(loaded.catalogueVersions[0].version,s.p.lesson.version);assert.equal(loaded.packages.length,2);
 withdrawPublisherVersion(s.db,{...target(s.p),reason:'Synthetic rights issue',now});await assert.rejects(planPublisherCatalogue(s.db,{rollback_to:old.catalogue_id,...audit},s.config),/withdrawn_version/);
 loaded=await loadPublisherCatalogue(s.db,s.config);assert.deepEqual(loaded.catalogueVersions,[]);assert.equal(loaded.packages.length,1);assert.equal(loaded.blocked[0].reason,'withdrawn_version');
});
test('runtime refresh serves only published versions, stops expired/withdrawn media and permits an empty catalogue',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);let clock=now;
 const runtime=await createPublishedSyntheticRuntime({mode:'synthetic-local',db:s.db,assetRoot:s.root,now:()=>clock});assert.deepEqual(runtime.catalogue(),[]);
 await publish(s,[s.p]);assert.throws(()=>runtime.catalogue(),/content_unavailable/);await runtime.refresh();assert.equal(runtime.catalogue()[0].id,s.p.lesson.id);
 assert.equal((await runtime.media(s.p.assets[1].object_key,{range:'bytes=0-43'})).status,206);
 clock='2027-01-02T00:00:00.000Z';assert.throws(()=>runtime.packageFor(s.p.lesson),/content_unavailable/);await runtime.refresh();assert.deepEqual(runtime.catalogue(),[]);assert.equal(runtime.owns(s.p.lesson.id),true);assert.throws(()=>runtime.media(s.p.assets[1].object_key),/content_unavailable/);
 clock=now;const empty=await planPublisherCatalogue(s.db,{targets:[],...audit},s.config);await applyPublisherCatalogue(s.db,empty,s.config);await runtime.refresh();assert.deepEqual(runtime.catalogue(),[]);assert.equal(runtime.packageFor(s.p.lesson).lesson.version,s.p.lesson.version);
});
test('snapshot tampering fails closed and an uncommitted concurrent change is not accepted',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);const pending=planPublisherCatalogue(s.db,{targets:[target(s.p)],...audit},s.config);withdrawPublisherVersion(s.db,{...target(s.p),reason:'Synthetic race',now});await assert.rejects(pending,/stale_catalogue_snapshot|withdrawn_version/);
 const empty=await publish(s,[]);s.db.prepare('UPDATE publisher_catalogues SET manifest_json=? WHERE id=?').run(JSON.stringify({format:'r2l-private-publisher-catalogue/1',entries:[target(s.p)]}),empty.catalogue_id);await assert.rejects(loadPublisherCatalogue(s.db,s.config),/publisher_catalogue_integrity/);
});
test('actual HTTP adopts new catalogue, preserves old pinned session and blocks it only after withdrawal',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);const initial=await publish(s,[s.p]);const dataRoot=path.join(s.root,'learner-data'),distRoot=path.join(s.root,'dist');initializeSyntheticTarget(dataRoot);fs.mkdirSync(path.join(distRoot,'read2lead/self-learn'),{recursive:true});fs.writeFileSync(path.join(distRoot,'read2lead/self-learn/index.html'),'<html>Synthetic catalogue test</html>');
 const qa=await startLocalQA({mode:'synthetic-local',port:0,dataRoot,distRoot,publisherStore:s.db,publisherAssetRoot:s.root,now:()=>Date.parse(now)});
 try{
  let cookie='',csrf='';const call=async(route,data)=>{const response=await fetch(qa.origin+'/api/read2lead/self-learn/'+route,{method:data?'POST':'GET',headers:{Cookie:cookie,...(data?{Origin:qa.origin,'Content-Type':'application/json','X-R2L-CSRF':csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(value.csrf)csrf=value.csrf;return{status:response.status,value};};
  assert.equal((await call('login',{access_code:'DEMO-FAMILY-A'})).status,200);const list=(await call('lessons')).value.lessons;assert.equal(list.length,1);assert.equal(list[0].version,'1.2.1');
  const session=await call('start',{request_id:'published-session',child_id:'synthetic-an',lesson_id:s.p.lesson.id});assert.equal(session.status,200);const id=session.value.session.session_id;
  const next=await revision(s.p);await s.import([next]);await publish(s,[next]);assert.equal((await call('lessons')).value.lessons[0].version,'1.2.2');
  const resumed=await call('session?session_id='+id);assert.equal(resumed.status,200);assert.deepEqual(resumed.value.view,session.value.view);
  const newer=await call('start',{request_id:'published-newer-session',child_id:'synthetic-an',lesson_id:s.p.lesson.id});assert.equal(newer.status,200);
  const rollback=await planPublisherCatalogue(s.db,{rollback_to:initial.catalogue_id,...audit},s.config);await applyPublisherCatalogue(s.db,rollback,s.config);assert.equal((await call('lessons')).value.lessons[0].version,'1.2.1');assert.deepEqual((await call('session?session_id='+newer.value.session.session_id)).value.view,newer.value.view);
  await publish(s,[next]);const head=publisherCatalogueHead(s.db),manifest=s.db.prepare('SELECT manifest_json FROM publisher_catalogues WHERE id=?').get(head).manifest_json;
  try{s.db.prepare('UPDATE publisher_catalogues SET manifest_json=? WHERE id=?').run('{}',head);const unavailable=await call('lessons');assert.equal(unavailable.status,409);assert.deepEqual(unavailable.value,{ok:false,code:'content_unavailable'});}
  finally{s.db.prepare('UPDATE publisher_catalogues SET manifest_json=? WHERE id=?').run(manifest,head);}
  assert.equal((await call('lessons')).value.lessons[0].version,'1.2.2');
  withdrawPublisherVersion(s.db,{...target(s.p),reason:'Synthetic withdrawal',now});assert.equal((await call('session?session_id='+id)).status,409);assert.equal((await call('lessons')).value.lessons[0].version,'1.2.2');
 }finally{await qa.close();}
});
test('operator CLI initializes and inspects private catalogue without accepting public report paths',async t=>{
 const s=await setup(t),cli=fileURLToPath(new URL('../scripts/read2lead-publisher-catalogue.mjs',import.meta.url));const run=args=>spawnSync(process.execPath,[cli,'--db',s.filename,...args],{encoding:'utf8'});
 const output=path.join(s.root,'initialized.json');let result=run(['--initialize','--output',output]);assert.equal(result.status,0,result.stderr);assert.equal(fs.statSync(output).mode&0o777,0o600);
 result=run(['--output',path.join(s.root,'inspection.json')]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(s.root,'inspection.json'))).catalogue_id,null);
 const request=path.join(s.root,'request.json'),plan=path.join(s.root,'plan.json'),applied=path.join(s.root,'applied.json');
 fs.writeFileSync(request,JSON.stringify({targets:[target(s.p)],...audit}));result=run(['--assets',s.root,'--request',request,'--output',plan]);assert.equal(result.status,0,result.stderr);
 result=run(['--assets',s.root,'--apply-plan',plan,'--output',applied]);assert.equal(result.status,0,result.stderr);const saved=JSON.parse(fs.readFileSync(applied));assert.equal(saved.scope,'private_local_catalogue');assert.equal(publisherCatalogueHead(s.db),saved.catalogue_id);
 const rollbackRequest=path.join(s.root,'rollback-request.json'),rollbackPlan=path.join(s.root,'rollback-plan.json');fs.writeFileSync(rollbackRequest,JSON.stringify({rollback_to:saved.catalogue_id,...audit}));result=run(['--assets',s.root,'--request',rollbackRequest,'--output',rollbackPlan]);assert.equal(result.status,0,result.stderr);
 result=run(['--assets',s.root,'--apply-plan',rollbackPlan,'--output',path.join(s.root,'rollback-result.json')]);assert.equal(result.status,0,result.stderr);
 fs.mkdirSync(path.join(s.root,'public'));result=run(['--output',path.join(s.root,'public','private.json')]);assert.equal(result.status,1);assert.match(result.stderr,/private_output_required/);
});

test('in-flight media from an older runtime cannot survive withdrawal plus refresh',async t=>{
 const s=await setup(t);initializePublisherCatalogue(s.db);await publish(s,[s.p]);let release;
 const runtime=await createPublishedSyntheticRuntime({mode:'synthetic-local',db:s.db,assetRoot:s.root,now:()=>now,readAsset:()=>new Promise(resolve=>{release=resolve;})});
 const pending=runtime.media(s.p.assets[1].object_key);assert.equal(typeof release,'function');
 withdrawPublisherVersion(s.db,{...target(s.p),reason:'Synthetic in-flight withdrawal',now});await runtime.refresh();
 release(fs.readFileSync(path.join(s.root,s.p.assets[1].object_key)));await assert.rejects(pending,/content_unavailable/);
});
