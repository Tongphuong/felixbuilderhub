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
import {openPublisherStore,planPublisherImport,applyPublisherImport,publisherStoreDigest,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import {publisherReviewBundle,planPublisherReview,applyPublisherReview} from '../scripts/lib/read2lead-publisher-review.mjs';
const now='2026-09-20T12:00:00.000Z',options={now};
const kinds=['text','activities','visual','audio_decode','audio_match','audio_listening','audio_timing','rights','human_teaching','human_art'];
const target={source_id:fixture.lesson.source.source_id,version:fixture.lesson.version};
async function setup(t,p=structuredClone(fixture)){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-review-')),filename=path.join(root,'private.sqlite');let db=openPublisherStore(filename,{create:true});
 t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const plan=await planPublisherImport(db,[p],{...options,assetRoot:root});await applyPublisherImport(db,[p],{...plan,...options,assetRoot:root});
 return{root,filename,get db(){return db;},reopen(){db.close();db=openPublisherStore(filename);},config:{...options,assetRoot:root}};
}
const review=(content_sha256,kind='text',status='verified',more={})=>({kind,package_sha256:content_sha256,status,reviewer:'Synthetic reviewer only',method:kind.startsWith('human_')?'human':'codex_editorial',evidence_ref:'synthetic-test-evidence',reviewed_at:now,...more});
async function makePlan(s,reviews){const b=await publisherReviewBundle(s.db,target,s.config);return planPublisherReview(s.db,{...target,expected_package_sha256:b.package_sha256,reviews:typeof reviews==='function'?reviews(b.content_sha256):reviews},s.config);}
test('private bundle exposes review material together, reads without writes, and does not imply publication',async t=>{
 const s=await setup(t),before=publisherStoreDigest(s.db),b=await publisherReviewBundle(s.db,target,s.config);
 assert.equal(b.state,'draft');assert.equal(b.visibility,'private_operator_only');assert.equal(b.package.lesson.questions[0].correct_index,fixture.lesson.questions[0].correct_index);
 assert.ok(b.readiness.blockers.includes('review_text'));assert.ok(b.readiness.blockers.includes('audio_not_reviewed'));assert.equal(b.publication,'not_performed');assert.equal(b.production_release_authorized,false);assert.equal(before,publisherStoreDigest(s.db));
});
test('saved review plan persists on reopen, exact retries do not duplicate events, and history retains replaced evidence',async t=>{
 const s=await setup(t),before=publisherStoreDigest(s.db),plan=await makePlan(s,h=>[review(h)]);assert.equal(before,publisherStoreDigest(s.db));assert.equal(plan.writes,0);
 const first=await applyPublisherReview(s.db,plan,s.config);assert.equal(first.result.review_updated,1);assert.equal(first.learner_writes,0);s.reopen();
 const next=await makePlan(s,h=>[review(h,'text','needs_correction',{evidence_ref:'synthetic-correction'})]);await applyPublisherReview(s.db,next,s.config);
 const replay=await applyPublisherReview(s.db,plan,s.config);assert.equal(replay.replayed,true);assert.equal(replay.current.state,'needs_correction');
 assert.equal(replay.current.package.reviews[0].evidence_ref,'synthetic-correction');assert.equal(replay.current.audit.length,3);
 const last=replay.current.audit.at(-1);assert.equal(last.reviews_before[0].evidence_ref,'synthetic-test-evidence');assert.equal(last.reviews_after[0].evidence_ref,'synthetic-correction');
 assert.equal(s.db.prepare('SELECT count(*) n FROM publisher_packages').get().n,1);
});
test('stale content, package and concurrent review plans are refused without overwriting evidence',async t=>{
 const s=await setup(t),bundle=await publisherReviewBundle(s.db,target,s.config);
 await assert.rejects(planPublisherReview(s.db,{...target,expected_package_sha256:'b'.repeat(64),reviews:[review(bundle.content_sha256)]},s.config),/stale_review_package/);
 await assert.rejects(makePlan(s,[review('b'.repeat(64))]),/stale_review_content/);
 const a=await makePlan(s,h=>[review(h)]),b=await makePlan(s,h=>[review(h,'activities')]);await applyPublisherReview(s.db,a,s.config);
 const before=publisherStoreDigest(s.db);await assert.rejects(applyPublisherReview(s.db,b,s.config),/stale_store_plan/);assert.equal(publisherStoreDigest(s.db),before);
});
test('review method, evidence, duplicate kinds, future dates and accessors fail closed',async t=>{
 const s=await setup(t);
 for(const [change,error] of [
  [h=>[review(h,'human_teaching','approved',{method:'codex_editorial'})],/human_review_required/],
  [h=>[review(h,'audio_listening','verified',{method:'automated'})],/editorial_review_required/],
  [h=>[review(h,'text','verified',{evidence_ref:' '})],/review_evidence_required/],
  [h=>[review(h),review(h)],/duplicate_review/],
  [h=>[review(h,'text','verified',{reviewed_at:'2030-01-01'})],/invalid_review_time/],
  [h=>[review(h,'invented_review')],/invalid_publisher_schema/]])await assert.rejects(makePlan(s,change),error);
 let calls=0;const bad=review('a'.repeat(64));Object.defineProperty(bad,'reviewer',{enumerable:true,get(){calls++;return'bad';}});
 await assert.rejects(makePlan(s,[bad]),/invalid_review_record/);assert.equal(calls,0);
});
test('audit insertion failure rolls back package, review history and receipt; the same plan remains retryable',async t=>{
 const s=await setup(t),plan=await makePlan(s,h=>[review(h)]),before=publisherStoreDigest(s.db);
 s.db.exec("CREATE TRIGGER test_interruption BEFORE INSERT ON publisher_events WHEN NEW.kind='review_updated' BEGIN SELECT RAISE(ABORT,'synthetic_interruption'); END");
 await assert.rejects(applyPublisherReview(s.db,plan,s.config),/synthetic_interruption/);assert.equal(publisherStoreDigest(s.db),before);
 assert.equal(s.db.prepare('SELECT count(*) n FROM publisher_receipts').get().n,1);s.db.exec('DROP TRIGGER test_interruption');assert.equal((await applyPublisherReview(s.db,plan,s.config)).result.review_updated,1);
});
test('withdrawal survives old receipt retry and cannot be bypassed with a new review',async t=>{
 const s=await setup(t),plan=await makePlan(s,h=>[review(h)]);await applyPublisherReview(s.db,plan,s.config);
 withdrawPublisherVersion(s.db,{...target,reason:'Synthetic withdrawal',now});s.reopen();
 const replay=await applyPublisherReview(s.db,plan,s.config);assert.equal(replay.current.state,'withdrawn');assert.equal(replay.replayed,true);assert.equal(replay.current.readiness.publication_ready,false);assert.ok(replay.current.readiness.blockers.includes('withdrawn_version'));
 await assert.rejects(makePlan(s,h=>[review(h)]),/withdrawn_version/);
});
test('incremental correction does not resubmit an unrelated stale review',async t=>{
 const p=structuredClone(fixture);p.reviews=[review('b'.repeat(64),'activities')];const s=await setup(t,p),plan=await makePlan(s,h=>[review(h)]);
 const result=await applyPublisherReview(s.db,plan,s.config);assert.deepEqual(result.current.stale_reviews,['activities']);assert.equal(result.current.state,'needs_correction');
});
test('database package tampering and changed saved plans are detected',async t=>{
 const s=await setup(t),plan=await makePlan(s,h=>[review(h)]);plan.plan.package.lesson.title_en='changed';
 await assert.rejects(applyPublisherReview(s.db,plan,s.config),/invalid_review_plan/);
 const p=structuredClone(fixture);p.lesson.title_en='Tampered in DB';s.db.prepare('UPDATE publisher_packages SET package_json=?').run(JSON.stringify(p));
 await assert.rejects(publisherReviewBundle(s.db,target,s.config),/publisher_store_integrity/);
});
test('operator CLI inspects, plans and applies private reports; refuses public paths and report overwrite',async t=>{
 const s=await setup(t),cli=fileURLToPath(new URL('../scripts/read2lead-publisher-review.mjs',import.meta.url));
 const run=(args)=>spawnSync(process.execPath,[cli,'--db',s.filename,...args],{encoding:'utf8'});
 const bundlePath=path.join(s.root,'bundle.json');let result=run(['--source',target.source_id,'--version',target.version,'--output',bundlePath]);assert.equal(result.status,0,result.stderr);
 const bundle=JSON.parse(fs.readFileSync(bundlePath));assert.equal(fs.statSync(bundlePath).mode&0o777,0o600);assert.equal(bundle.visibility,'private_operator_only');
 const requestPath=path.join(s.root,'request.json'),planPath=path.join(s.root,'plan.json'),resultPath=path.join(s.root,'result.json');
 fs.writeFileSync(requestPath,JSON.stringify({...target,expected_package_sha256:bundle.package_sha256,reviews:[review(bundle.content_sha256,'text','verified',{reviewed_at:'2026-01-01T00:00:00.000Z'})]}));
 result=run(['--request',requestPath,'--output',planPath]);assert.equal(result.status,0,result.stderr);
 result=run(['--apply-plan',planPath,'--output',resultPath]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(fs.readFileSync(resultPath)).result.review_updated,1);
 result=run(['--source',target.source_id,'--version',target.version,'--output',bundlePath]);assert.equal(result.status,1);assert.match(result.stderr,/output_exists/);
 fs.mkdirSync(path.join(s.root,'public'));result=run(['--source',target.source_id,'--version',target.version,'--output',path.join(s.root,'public','private.json')]);assert.equal(result.status,1);assert.match(result.stderr,/private_output_required/);
});
test('verified and approved remain distinct; expiry and corrupt assets invalidate current readiness',async t=>{
 const s=await setup(t),p=structuredClone(fixture);
 const png=path.join(s.root,'temporary.png');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=navy:s=16x16','-frames:v','1','-threads','1',png]);
 const wav=Buffer.alloc(128044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 p.assets=[['image',fs.readFileSync(png),'png'],['audio',wav,'wav']].map(([kind,bytes,ext])=>{const sha=createHash('sha256').update(bytes).digest('hex'),key=sha+'.'+ext;fs.writeFileSync(path.join(s.root,key),bytes);return{id:'synthetic-'+kind,kind,sha256:sha,bytes:bytes.length,mime:kind+'/'+ext,object_key:key,width:kind==='image'?16:0,height:kind==='image'?16:0,duration_seconds:kind==='audio'?8:0,provenance:'synthetic_fixture',reference_hashes:[],character_ids:[],alt_en:'Synthetic test media only'};});
 p.lesson.version='1.2.2';p.lesson.audio.content_version='1.2.2';p.lesson.questions.forEach(q=>q.version='1.2.2');p.lesson.independent_followup.version='1.2.2';
 p.lesson.illustrations=[{id:'synthetic-scene',kind:'raster',asset_id:'synthetic-image',alt_en:'Synthetic pattern',sentence_ids:['s1']}];
 p.lesson.audio.asset_id='synthetic-audio';p.lesson.audio.status='reviewed';p.lesson.audio.segments=p.lesson.shadowing.sentence_ids.map((id,i)=>({id:'segment-'+i,sentence_ids:[id],start_seconds:i,end_seconds:i+1}));p.lesson.review.author_check='complete';
 p.rights=[{id:'synthetic-grant',source_id:target.source_id,document_sha256:'a'.repeat(64),actions:['digital_text','activities','illustrations','stream_recording','translation'],valid_from:'2026-01-01T00:00:00.000Z',valid_until:'2027-01-01T00:00:00.000Z',status:'granted',territory:'Synthetic only',platform:'Read2Lead',reviewer:'Synthetic test'}];
 const contentHash=await publisherDigest(p);p.reviews=kinds.map(k=>review(contentHash,k));let imported=await planPublisherImport(s.db,[p],s.config);await applyPublisherImport(s.db,[p],{...imported,...s.config});
 const next={...target,version:p.lesson.version};let bundle=await publisherReviewBundle(s.db,next,s.config);assert.equal(bundle.state,'verified');assert.equal(bundle.readiness.publication_ready,true);assert.equal(bundle.readiness.counts_toward_source_collection,false);
 const plan=await planPublisherReview(s.db,{...next,expected_package_sha256:bundle.package_sha256,reviews:kinds.map(k=>review(contentHash,k,'approved'))},s.config);
 bundle=(await applyPublisherReview(s.db,plan,s.config)).current;assert.equal(bundle.state,'approved');assert.equal(bundle.publication,'not_performed');
 const expired=await publisherReviewBundle(s.db,next,{...s.config,now:'2027-01-02T00:00:00.000Z'});assert.notEqual(expired.state,'approved');assert.ok(expired.readiness.blockers.includes('rights_digital_text'));
 fs.writeFileSync(path.join(s.root,p.assets[1].object_key),Buffer.alloc(wav.length));bundle=await publisherReviewBundle(s.db,next,s.config);assert.equal(bundle.state,'needs_correction');assert.equal(bundle.asset_checks[1].error,'asset_hash_mismatch');assert.equal(bundle.readiness.publication_ready,false);
});

 test('concurrent withdrawal cannot escape a pending review snapshot',async t=>{
 const s=await setup(t);const pending=publisherReviewBundle(s.db,target,s.config);
 withdrawPublisherVersion(s.db,{...target,reason:'Concurrent synthetic withdrawal',now});
 await assert.rejects(pending,/stale_review_snapshot/);
 });
