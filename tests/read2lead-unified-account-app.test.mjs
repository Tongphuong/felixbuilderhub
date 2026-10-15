import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {createPreviewApp,createPreviewContentLoader} from '../cloudflare/read2lead-private-preview/app.mjs';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import { build } from 'esbuild';
import { createUnifiedAccountApp, ACCOUNT_COOKIE } from '../cloudflare/read2lead-private-preview/unified-account-app.mjs';
import { prepareAccountSnapshot, importAccountSnapshot, snapshotAccountStore, prepareAccountRollout, mergeAccountSnapshot } from '../functions/lib/read2lead/account-snapshot.mjs';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { fixturePackage } from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
import { makeStoredBookPack } from './helpers/book-pack-fixture.mjs';
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {verifiedLessonCatalogue} from '../functions/lib/read2lead/private-voice.mjs';
import {studentStoryConfiguration} from '../functions/lib/read2lead/student-story.mjs';

const origin='https://unified.test', QA='R2L-SYNTHETIC-QA', A='R2L-SYNTHETIC-A', B='R2L-SYNTHETIC-B', OTHER_TEST='R2L-SYNTHETIC-OTHER-TEST';
const digest=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{shared=true,policy=true,merged=true}={}) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const transaction=fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  let time=Date.parse('2026-10-14T08:00:00Z');const now=()=>time;
  createAccountTransactionRunner({db,transaction,progressInCodes:shared,now});
  const account=code=>({is_test:[QA,OTHER_TEST].includes(code),is_shared:false,uses_remaining:50,
    student_profile:{student_name:'Synthetic Reader',level:'L1',age:10,child_gender:'boy'},progress:{current_level:'L1',review_history:[],current_pack:null},unknown:{preserved:true}});
  const records=codes=>codes.flatMap(code=>[
    {namespace:'codes',key:code,value:JSON.stringify(account(code)),expires:null,metadata:null},
    {namespace:shared?'codes':'progress',key:'progress:'+code,value:JSON.stringify({schema_version:2,level_reset_version:20260606,current_level:'L1',initial_level:'L1',diamonds:code===QA?520:270,total_xp:0,completed_packs:0,unlocked_parts:[]}),expires:null,metadata:null},
  ]);
  const initial=await prepareAccountSnapshot({sourceId:'synthetic-founder',progressInCodes:shared,records:records([QA])});
  await importAccountSnapshot({db,transaction,snapshot:initial,expectedSha256:initial.sha256,progressInCodes:shared});
  const snapshot=await prepareAccountSnapshot({sourceId:'synthetic-ordinary',progressInCodes:shared,records:records([A,B,OTHER_TEST])});
  const plan=await prepareAccountRollout({sourceSnapshot:snapshot,targetSnapshot:await snapshotAccountStore({db,progressInCodes:shared})});
  if(merged)await mergeAccountSnapshot({db,transaction,snapshot,plan,expectedPlanSha256:plan.sha256,progressInCodes:shared});
  const packages=await Promise.all([0,1].map(async index=>{
    const assets=['image','audio'].map((kind,i)=>({id:'synthetic-'+kind,kind,sha256:String(index*2+i+1).repeat(64),bytes:100,mime:kind==='image'?'image/png':'audio/wav',object_key:String(index*2+i+1).repeat(64)+(i?'.wav':'.png'),width:i?0:16,height:i?0:16,duration_seconds:i?8:0,provenance:'synthetic_fixture',reference_hashes:[],character_ids:[],alt_en:'Synthetic fixture'}));
    return fixturePackage(assets,{index});
  }));
  let accepted=true,allowed=true,legacyCalls=0,providerCalls=0,hook=null,mediaReads=0;
  const catalogue={async get(key){if(hook)await hook(key);if(key==='index:L1')return packages.map(p=>({id:p.lesson.id,version:p.lesson.version}));const p=packages.find(p=>key===`package:${p.lesson.id}@${p.lesson.version}`);return p?{status:accepted?'accepted':'private-draft',package:structuredClone(p),assetProofs:p.assets.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes,mime:a.mime,decoded:true}))}:null;}};
  const voiceConfig={activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true},provider:{transcribe(){providerCalls++;throw Error('not used');}},budget:{claim(){throw Error('not used');},finish(){}}};
  const manifest=JSON.stringify({format:'read2lead-private-cloud-preview-v1',existingSite:true,existingTestAccount:{code:QA,origin,snapshot:initial,snapshotSha256:initial.sha256},package:packages[0],packages,publicAssets:['/scripts/reader.js'],scriptHashes:[],pages:{'/read2lead/':'/__private/site/home.html','/read2lead/lesson/':'/__private/site/lesson.html'}});
  const assets={async fetch(request){const path=new URL(request.url).pathname;if(path==='/__private/package.json')return new Response(manifest);if(path.startsWith('/__private/site/'))return new Response('<!doctype html><title>Synthetic reader</title>');if(path==='/scripts/reader.js')return new Response('/* reader */');if(path.startsWith('/__private/media/')){mediaReads++;return new Response(new Uint8Array(100));}return new Response('missing',{status:404});}};
  const forbidden={get(){legacyCalls++;throw Error('legacy read');},put(){legacyCalls++;throw Error('legacy write');}};
  const options={db,transaction,assets,packageSha256:digest(manifest),expectedRolloutSha256:plan.sha256,progressInCodes:shared,origin,founderCode:QA,now,
    ordinaryStory:policy?{catalogue,voiceConfig,canAssign:async()=>allowed}:null,
    infrastructure:{ADMIN_PASSWORD:'synthetic-admin',READ2LEAD_CODES:forbidden,R2L_PRIVATE_QA:'adult-isolated'}};
  let app=createUnifiedAccountApp(options);
  const request=(path,body,headers={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const call=(path,body,headers={})=>app(request(path,body,headers));
  const value=key=>JSON.parse(db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(key.startsWith('progress:')&&!shared?'progress':'codes',key).value);
  const put=(key,value)=>db.prepare("UPDATE read2lead_account_kv SET value=? WHERE namespace='codes' AND key=?").run(JSON.stringify(value),key);
  const assign=async(code=A)=>{const response=await call('/api/generate-read2lead-pack',{access_code:code,collection:'one-story-a-day'});return {status:response.status,body:await response.json()};};
  const cookie=async(code=A,prior)=>{const response=await call('/read2lead/?code='+code,undefined,prior?{cookie:prior}:{});assert.equal(response.status,200);return response.headers.get('set-cookie')?.split(';')[0];};
  return{db,options,call,request,assign,cookie,value,put,packages,plan,snapshot,handle:request=>app(request),restart:(extra={})=>app=createUnifiedAccountApp({...options,...extra}),
    accepted:value=>accepted=value,allowed:value=>allowed=value,hook:value=>hook=value,clock:value=>time=value,now,
    counts:()=>({legacyCalls,providerCalls,mediaReads})};
}

for(const shared of [true,false])test(`ordinary account opens and resumes accepted story in existing SQL; wallets retained (shared=${shared})`,async t=>{
  const f=await fixture(t,{shared}),cookie=await f.cookie();assert.match(cookie,new RegExp('^'+ACCOUNT_COOKIE+'='));
  const assigned=await f.assign();assert.equal(assigned.status,200,JSON.stringify(assigned));
  const repeated=await f.assign();assert.equal(repeated.body.pack_id,assigned.body.pack_id);
  const response=await f.call('/api/read2lead-story-session',{action:'open_assigned',packId:assigned.body.pack_id},{'X-Read2Lead-Code':A});assert.equal(response.status,200);const view=await response.json();
  f.restart();const resumed=await f.call('/api/read2lead-story-session?sessionId='+view.session.id,undefined,{'X-Read2Lead-Code':A});assert.equal(resumed.status,200);assert.deepEqual((await resumed.json()).session,view.session);
  assert.equal(f.value('progress:'+A).diamonds,270);assert.equal(f.value('progress:'+QA).diamonds,520);assert.deepEqual(f.value(A).unknown,{preserved:true});
  assert.equal((await f.call('/scripts/reader.js',undefined,{cookie})).status,200);assert.equal(f.counts().legacyCalls,0);assert.equal(f.counts().providerCalls,0);
});

test('missing, mismatched or wrong-storage-mode rollout refuses before importing or serving',async t=>{
  const f=await fixture(t,{merged:false});const before=f.db.prepare('SELECT * FROM read2lead_account_kv').all();
  assert.equal((await f.call('/read2lead/?code='+QA)).status,503);assert.deepEqual(f.db.prepare('SELECT * FROM read2lead_account_kv').all(),before);
  const g=await fixture(t);for(const extra of [{expectedRolloutSha256:'f'.repeat(64)},{progressInCodes:false}]){g.restart(extra);assert.equal((await g.call('/read2lead/?code='+A)).status,503);}
});

test('conflicting query/header/JSON/form identities refuse and a stale cookie never supplies API code',async t=>{
  const f=await fixture(t),cookie=await f.cookie();
  for(const [path,body,headers] of [
    ['/read2lead/?code='+A+'&access_code='+B,undefined,{}],
    ['/api/read2lead-progress?code='+A,undefined,{'X-Read2Lead-Code':B}],
    ['/api/generate-read2lead-pack',{access_code:B},{'X-Read2Lead-Code':A}],
    ['/api/generate-read2lead-pack',{code:A,access_code:B},{}],
  ])assert.equal((await f.call(path,body,{cookie,...headers})).status,400,path);
  const form=new FormData();form.set('access_code',B);
  assert.equal((await f.handle(new Request(origin+'/api/read2lead-speaking-check',{method:'POST',headers:{Origin:origin,'X-Read2Lead-Code':A},body:form}))).status,400);
  assert.equal((await f.call('/api/read2lead-progress',undefined,{cookie})).status,400);
  const next=await f.cookie(B,cookie);assert.notEqual(next,cookie);
  assert.equal((await f.call('/read2lead/?code=NO-SUCH-CODE',undefined,{cookie})).status,401);
});

test('private founder assignments never extend to other test accounts; absent ordinary policy refuses new OSAD',async t=>{
  const f=await fixture(t,{policy:false});assert.equal((await f.assign(QA)).status,200);
  for(const code of [A,OTHER_TEST])assert.notEqual((await f.assign(code)).status,200);
  assert.equal(f.value(A).progress.current_pack,null);assert.equal(f.value(OTHER_TEST).progress.current_pack,null);
  const g=await fixture(t);g.accepted(false);assert.notEqual((await g.assign()).status,200);g.accepted(true);g.allowed(false);assert.notEqual((await g.assign()).status,200);
  assert.throws(()=>createUnifiedAccountApp({...g.options,founderVoiceConfig:{...g.options.ordinaryStory.voiceConfig}}),/ordinary_story_policy_required/,'a shallow config copy must not share the founder budget');
});

test('one-click auto falls back to a retained original and resumes it without a new grant or wallet change',async t=>{
  const f=await fixture(t,{policy:false});
  for(const [key,value] of [['config:book_levels',['L0','L1','L2','L3','L4']],['book_index:L1',['book_1']],['book:book_1',makeStoredBookPack('book_1')]])
    f.db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run('codes',key,JSON.stringify(value));
  const response=await f.call('/api/generate-read2lead-pack',{access_code:A,collection:'auto'});assert.equal(response.status,200,await response.clone().text());
  const assigned=await response.json();assert.match(JSON.stringify(f.value(A).progress.current_pack),/"book_slug":"book_1"/);
  const again=await f.call('/api/generate-read2lead-pack',{access_code:A,collection:'auto'});assert.equal(again.status,409);assert.equal(f.value(A).progress.current_pack.pack_id,assigned.pack_id);
  assert.equal((await f.call('/api/read2lead-lesson?code='+A+'&pack_id='+assigned.pack_id)).status,200);
  assert.equal(f.value('progress:'+A).diamonds,270);assert.equal(f.value('progress:'+QA).diamonds,520);assert.equal(f.counts().providerCalls,0);assert.equal(f.counts().legacyCalls,0);
});

test('media requires current or archived owned accepted assignment, including ranges and HEAD',async t=>{
  const f=await fixture(t),a=await f.cookie(),b=await f.cookie(B),key=f.packages[0].assets[0].object_key,other=f.packages[1].assets[0].object_key;
  const media='/api/read2lead-story-media/'+key;
  assert.equal((await f.call(media,undefined,{cookie:a})).status,404);assert.equal(f.counts().mediaReads,0);
  assert.equal((await f.assign()).status,200);
  assert.equal((await f.call(media,undefined,{cookie:a})).status,200);
  assert.equal((await f.call(media,undefined,{cookie:b})).status,404);
  assert.equal((await f.call('/api/read2lead-story-media/'+other,undefined,{cookie:a})).status,404);
  assert.equal((await f.call(media,undefined,{cookie:a,range:'bytes=0-9'})).status,206);
  assert.equal((await f.handle(new Request(origin+media,{method:'HEAD',headers:{cookie:b}}))).status,404);
  const current=f.value(A),pack=current.progress.current_pack;current.story_pack_history={[pack.pack_id]:pack};current.progress.current_pack=null;f.put(A,current);
  assert.equal((await f.call(media,undefined,{cookie:a})).status,200);
  f.accepted(false);assert.equal((await f.call(media,undefined,{cookie:a})).status,404);
  f.accepted(true);f.hook(key=>{if(key.startsWith('package:'))f.put(A,{...f.value(A),story_pack_history:{}});});
  assert.equal((await f.call(media,undefined,{cookie:a})).status,404);
});

test('ordinary token resolution preserves original expiry and rejects mismatched code and stale cookie',async t=>{
  const f=await fixture(t),cookie=await f.cookie(B),token='a'.repeat(32);
  f.db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run('codes','r2l_link:'+token,JSON.stringify({access_code:A,expires_at:'2026-12-01',uses_remaining:5000}));
  const resolved=await f.call('/api/r2l-link?token='+token,undefined,{cookie});assert.equal(resolved.status,200);assert.equal((await resolved.json()).access_code,A);
  assert.equal((await f.call('/api/r2l-link?token='+token+'&code='+B)).status,400);
  assert.equal((await f.call('/api/r2l-link?token='+token+'&token='+token)).status,400);
  f.put('r2l_link:'+token,{access_code:A,expires_at:'2020-01-01',uses_remaining:5000});assert.equal((await f.call('/api/r2l-link?token='+token)).status,410);
});

test('admin checks remain independent of student cookies and forged internal markers',async t=>{
  const f=await fixture(t),cookie=await f.cookie();
  assert.equal((await f.call('/api/admin/codes',undefined,{cookie,'X-R2L-Account-Admin-Verified':'1'})).status,401);
  const response=await f.call('/api/admin/codes',undefined,{cookie,Authorization:'Basic '+btoa('x:synthetic-admin')});assert.equal(response.status,200);
  assert.deepEqual(new Set((await response.json()).items.map(row=>row.code)),new Set([QA,A,B,OTHER_TEST]));
});

test('cross-site exception is limited to code-bearing top-level home navigation; cookies expire',async t=>{
  const f=await fixture(t),headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  assert.equal((await f.call('/read2lead/?code='+A,undefined,headers)).status,200);
  for(const path of ['/read2lead/','/api/read2lead-progress?code='+A,'/scripts/reader.js?code='+A])assert.equal((await f.call(path,undefined,headers)).status,403);
  assert.equal((await f.call('/read2lead/?code='+A,undefined,{...headers,'sec-fetch-dest':'iframe'})).status,403);
  const cookie=await f.cookie();f.clock(f.now()+900001);assert.equal((await f.call('/scripts/reader.js',undefined,{cookie})).status,401);
});

test('saved media pins, founder-only drafts and revocation remain enforced',async t=>{
  const f=await fixture(t),a=await f.cookie(),qa=await f.cookie(QA),other=await f.cookie(OTHER_TEST);
  assert.equal((await f.assign()).status,200);assert.equal((await f.assign(QA)).status,200);
  const media='/api/read2lead-story-media/'+f.packages[0].assets[0].object_key,original=f.value(A);
  for(const change of [{sha256:undefined},{sha256:'f'.repeat(64)},{source_id:'wrong-source'}]){
    const changed=structuredClone(original);Object.assign(changed.progress.current_pack.story_reference,change);f.put(A,changed);
    assert.equal((await f.call(media,undefined,{cookie:a})).status,404);
  }
  f.put(A,original);f.put(OTHER_TEST,{...f.value(OTHER_TEST),progress:f.value(QA).progress});f.accepted(false);
  assert.equal((await f.call(media,undefined,{cookie:qa})).status,200);
  assert.equal((await f.call(media,undefined,{cookie:other})).status,404);
  f.db.prepare("DELETE FROM read2lead_account_kv WHERE namespace='codes' AND key=?").run(QA);
  assert.equal((await f.call(media,undefined,{cookie:qa})).status,401);
});

test('active same-learner API renews media access; an old tab cannot switch the current learner cookie',async t=>{
  const f=await fixture(t),a=await f.cookie(),b=await f.cookie(B);
  f.clock(f.now()+600001);
  const refreshed=await f.call('/api/read2lead-progress?code='+A,undefined,{cookie:a});assert.equal(refreshed.status,200);
  assert.equal(refreshed.headers.get('set-cookie')?.split(';')[0],a);
  f.clock(f.now()+300001);assert.equal((await f.call('/scripts/reader.js',undefined,{cookie:a})).status,200);
  const currentB=await f.cookie(B);
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM unified_account_browser_access').get().n;
  const apiOnly=await f.call('/api/read2lead-progress?code='+A);assert.equal(apiOnly.status,200);assert.equal(apiOnly.headers.get('set-cookie'),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM unified_account_browser_access').get().n,before);
  const stale=await f.call('/api/read2lead-progress?code='+A,undefined,{cookie:currentB});assert.equal(stale.status,200);assert.equal(stale.headers.get('set-cookie'),null);
  const missing=await f.call('/api/read2lead-progress?code=DOES-NOT-EXIST',undefined,{cookie:a});assert.notEqual(missing.status,200);assert.equal(missing.headers.get('set-cookie'),null);
  assert.equal((await f.call('/api/read2lead-progress?code='+B,undefined,{cookie:b})).status,200);
});

let workerModule;
async function worker() {
  return workerModule??=(async()=>{
    const result=await build({entryPoints:[new URL('../cloudflare/read2lead-private-preview/worker.mjs',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',
      plugins:[{name:'synthetic-cloudflare-runtime',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'synthetic'}));build.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export class DurableObject { constructor(ctx,env) {} } export class WorkerEntrypoint { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }',loader:'js'}));}}]});
    return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  })();
}
test('actual Worker keeps public traffic outside accounts, freezes old callers and requires matching gateway receipt',async t=>{
  const f=await fixture(t),module=await worker(),seen=[];
  const namespace={idFromName:name=>name,get:id=>({fetch:async()=>{seen.push(id);return new Response('public-adult');}})};
  assert.equal(await(await module.default.fetch(f.request('/api/read2lead-progress?code='+A,undefined,{'X-R2L-Account-Admin-Verified':'1'}),{R2L_PREVIEW_STATE:namespace})).text(),'public-adult');
  assert.deepEqual(seen,['private-adult-preview-v1']);
  const ctx={id:'existing-student-test-v1',waitUntil:promise=>promise.catch(()=>{}),blockConcurrencyWhile:fn=>fn(),storage:{getCurrentBookmark:async()=> 'synthetic-native-bookmark',transactionSync:f.options.transaction,sql:{exec(sql,...args){const statement=f.db.prepare(sql);const rows=statement.all(...args);return {toArray:()=>rows,one:()=>rows[0]};}}}};
  let assetReads=0;const env={R2L_PREVIEW_STATE:namespace,ASSETS:{fetch:request=>{assetReads++;return f.options.assets.fetch(request);}},R2L_PREVIEW_PACKAGE_SHA256:f.options.packageSha256,R2L_ACCOUNT_ROLLOUT_SHA256:f.plan.sha256};
  for(const mode of ['freeze-v1','invalid','unified-v1']){
    const instance=new module.Read2LeadPrivatePreview(ctx,{...env,R2L_ACCOUNT_MODE:mode});
    assert.equal((await instance.fetch(f.request('/api/read2lead-progress?code='+A))).status,503);
    if(mode==='freeze-v1'){
      const exported=await instance.exportFrozenAccounts();assert.equal(exported.format,'read2lead-frozen-account-export-v1');assert.equal(exported.objectId,ctx.id);assert.equal(exported.accounts.progressInCodes,true);
    }else await assert.rejects(instance.exportFrozenAccounts(),/operator_forbidden/);
  }
  assert.equal(assetReads,0,'refuse before loading content or opening account service');
  const instance=new module.Read2LeadPrivatePreview(ctx,{...env,R2L_ACCOUNT_MODE:'unified-v1'});
  const headers={'X-R2L-Account-Mode':'unified-v1','X-R2L-Account-Rollout':f.plan.sha256};
  const response=await instance.fetch(f.request('/api/read2lead-progress?code='+A,undefined,headers));assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('X-R2L-Account-Rollout'),f.plan.sha256);assert.equal(response.headers.get('X-R2L-Account-Mode'),'unified-v1');
  assert.equal(f.value('progress:'+A).diamonds,270);assert.equal(f.value('progress:'+QA).diamonds,520);
  assert.equal(assetReads,1,'actual unified Worker reuses its verified manifest');
  const adult=new module.Read2LeadPrivatePreview({...ctx,id:'private-adult-preview-v1'},env);await assert.rejects(adult.exportFrozenAccounts(),/operator_forbidden/);
});

async function studentWorkerFixture(t){
  const f=await fixture(t),module=await worker();
  const manifest=await(await f.options.assets.fetch(new Request(origin+'/__private/package.json'))).json();
  manifest.sourcePackageSha256='b'.repeat(64);
  const approvalSha256='a'.repeat(64),grant={approvalSha256,budget:{scope:'batch',
    batchId:'r2l-student-launch-'+approvalSha256.slice(0,32),expiresAt:new Date(Date.now()+86400000).toISOString(),
    approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:70000,maxTurns:32}};
  const lessons=await Promise.all(f.packages.map(async p=>({id:p.lesson.id,version:p.lesson.version,packageSha256:await publisherDigest(p)})));
  const voiceCatalogue=await verifiedLessonCatalogue({voiceVerificationLessons:lessons});
  manifest.studentRelease={format:'read2lead-student-release-v1',approvedGrant:grant,voiceVerificationLessons:lessons,
    records:await Promise.all(f.packages.map(async p=>({status:'accepted',id:p.lesson.id,version:p.lesson.version,sha256:await publisherDigest(p),
      assetProofs:p.assets.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes,mime:a.mime,decoded:true}))})))};
  const voice={format:'read2lead-student-voice-v1',audience:'enrolled-students',mode:'assessed',providerRoute:'cloudflare-only',
    assessorModel:'gpt-oss-120b',packageSha256:manifest.sourcePackageSha256,approvalSha256,processingApproved:true,spendingApproved:true,
    pricingEvidenceSha256:'c'.repeat(64),verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:voiceCatalogue.sha256},budget:grant.budget};
  let calls=0;
  const ctx={id:'existing-student-test-v1',waitUntil:p=>p.catch(()=>{}),storage:{transactionSync:f.options.transaction,sql:{exec(sql,...args){
    if(!args.length&&/^\s*CREATE\s/i.test(sql)){f.db.exec(sql);return {toArray:()=>[]};}
    const rows=f.db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};
  }}}};
  function start(value=manifest,raw=voice){
    const text=JSON.stringify(value),assets={fetch:request=>new URL(request.url).pathname==='/__private/package.json'?new Response(text):f.options.assets.fetch(request)};
    const env={ASSETS:assets,R2L_PREVIEW_STATE:{idFromName:name=>name},R2L_ACCOUNT_MODE:'unified-v1',
      R2L_PREVIEW_PACKAGE_SHA256:digest(text),R2L_ACCOUNT_ROLLOUT_SHA256:f.plan.sha256,
      ...(raw?{R2L_STUDENT_VOICE_CONFIG:JSON.stringify(raw)}:{}),AI:{run(){calls++;throw Error('no paid calls in tests');}}};
    const instance=new module.Read2LeadPrivatePreview(ctx,env);
    return (path,body,headers={})=>instance.fetch(f.request(path,body,{'X-R2L-Account-Mode':'unified-v1','X-R2L-Account-Rollout':f.plan.sha256,...headers}));
  }
  return {...f,manifest,voice,start,providerCalls:()=>calls};
}

test('actual Worker assigns accepted ordinary story and resumes saved work after voice funding is disabled',async t=>{
  const f=await studentWorkerFixture(t);let call=f.start();
  const assigned=await call('/api/generate-read2lead-pack',{access_code:A,collection:'one-story-a-day'});
  assert.equal(assigned.status,200,await assigned.clone().text());const pack=await assigned.json();
  const opened=await call('/api/read2lead-story-session',{action:'open_assigned',packId:pack.pack_id},{'X-Read2Lead-Code':A});
  assert.equal(opened.status,200,await opened.clone().text());const saved=(await opened.json()).session;
  call=f.start(f.manifest,null);
  const resumed=await call('/api/read2lead-story-session?sessionId='+saved.id,undefined,{'X-Read2Lead-Code':A});
  assert.equal(resumed.status,200,await resumed.clone().text());assert.deepEqual((await resumed.json()).session,saved);
  const repeat=await call('/api/generate-read2lead-pack',{access_code:A,collection:'one-story-a-day'});
  assert.equal((await repeat.json()).pack_id,pack.pack_id);
  assert.notEqual((await call('/api/generate-read2lead-pack',{access_code:B,collection:'one-story-a-day'})).status,200);
  assert.equal(f.value('progress:'+A).diamonds,270);assert.equal(f.value('progress:'+QA).diamonds,520);
  assert.equal(f.providerCalls(),0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM story_voice_reservations').get().n,0);
});

test('actual Worker refuses ordinary assignment without release, with drafts, missing reviews, changed hashes or grant',async t=>{
  const f=await studentWorkerFixture(t);
  for(const change of [m=>delete m.studentRelease,m=>m.studentRelease.records.forEach(r=>r.status='private-draft'),
    m=>m.packages.forEach(p=>p.reviews=[]),m=>m.studentRelease.records.forEach(r=>r.sha256='f'.repeat(64)),
    m=>m.studentRelease.records.forEach(r=>r.assetProofs=[]),m=>m.studentRelease.approvedGrant.approvalSha256='f'.repeat(64),
    m=>m.studentRelease.records.push(m.studentRelease.records[0])]){
    const manifest=structuredClone(f.manifest);change(manifest);manifest.package=manifest.packages[0];
    const call=f.start(manifest);
    assert.equal((await call('/api/read2lead-progress?code='+A)).status,200,'invalid optional release must preserve account access');
    assert.notEqual((await call('/api/generate-read2lead-pack',{access_code:A,collection:'one-story-a-day'})).status,200);
    assert.equal(f.value(A).progress.current_pack,null);
  }
  assert.equal(f.providerCalls(),0);assert.equal(f.value('progress:'+A).diamonds,270);
});

test('ordinary catalogue returns isolated copies and excludes expired rights without erasing saved data',async t=>{
  const f=await studentWorkerFixture(t),text=JSON.stringify(f.manifest);
  const manifest=await createPreviewContentLoader({assets:{fetch:async()=>new Response(text)},packageSha256:digest(text)}).load();
  const store=new StorySqlStore(f.db,{transaction:f.options.transaction});
  const options={manifest,store,env:{},now:()=>new Date('2026-10-15T00:00:00Z')};
  const policy=await studentStoryConfiguration(options),key='package:'+f.packages[0].lesson.id+'@'+f.packages[0].lesson.version;
  assert.equal(policy.voiceConfig,null);assert.equal(policy.canAssign(f.packages[0].lesson),false);
  const record=await policy.catalogue.get(key);assert.equal(record.status,'accepted');record.package.lesson.title_en='tampered';
  const index=await policy.catalogue.get('index:L1');index.length=0;
  assert.notEqual((await policy.catalogue.get(key)).package.lesson.title_en,'tampered');assert.equal((await policy.catalogue.get('index:L1')).length,2);
  const expired=await studentStoryConfiguration({...options,now:()=>new Date('2027-01-02T00:00:00Z')});
  assert.equal(await expired.catalogue.get(key),null);assert.deepEqual(await expired.catalogue.get('index:L1'),[]);
  assert.equal(f.value('progress:'+A).diamonds,270);
});

test('actual Worker requires voice verification for the exact accepted package before assignment',async t=>{
  const f=await studentWorkerFixture(t),manifest=structuredClone(f.manifest),voice=structuredClone(f.voice);
  manifest.studentRelease.voiceVerificationLessons.forEach(l=>l.packageSha256='f'.repeat(64));
  voice.verification.catalogueSha256=(await verifiedLessonCatalogue(manifest.studentRelease)).sha256;
  const call=f.start(manifest,voice);
  assert.notEqual((await call('/api/generate-read2lead-pack',{access_code:A,collection:'one-story-a-day'})).status,200);
  assert.equal(f.value(A).progress.current_pack,null);assert.equal(f.providerCalls(),0);
});

for(const shared of [true,false])test(`internal operator RPC requires configured pins and preserves retry-after-learning (shared=${shared})`,async t=>{
  const f=await fixture(t,{shared,merged:false}),module=await worker();
  const ctx={id:'existing-student-test-v1',blockConcurrencyWhile:fn=>fn(),storage:{getCurrentBookmark:async()=> 'synthetic-native-bookmark',transactionSync:f.options.transaction,sql:{exec(sql,...args){const rows=f.db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}}}};
  let instance;
  const env={R2L_ACCOUNT_MODE:'freeze-v1',R2L_PREVIEW_STATE:{idFromName:name=>name,get:id=>{assert.equal(id,ctx.id);return instance;}}};
  instance=new module.Read2LeadPrivatePreview(ctx,env);
  const operator=new module.Read2LeadAccountOperator({},env);
  const backup=await operator.exportFrozenAccounts(),input={backup,snapshot:f.snapshot,plan:f.plan};
  const before=await snapshotAccountStore({db:f.db,progressInCodes:shared});
  assert.equal((await operator.fetch(f.request('/applyFrozenAccounts',input))).status,404);
  for(const pins of [{},{R2L_ACCOUNT_BACKUP_SHA256:'bad',R2L_ACCOUNT_ROLLOUT_SHA256:f.plan.sha256},{R2L_ACCOUNT_BACKUP_SHA256:backup.sha256,R2L_ACCOUNT_ROLLOUT_SHA256:'bad'}]){
    delete env.R2L_ACCOUNT_BACKUP_SHA256;delete env.R2L_ACCOUNT_ROLLOUT_SHA256;Object.assign(env,pins);
    await assert.rejects(operator.applyFrozenAccounts(input),/operator_pins_required/);
  }
  env.R2L_ACCOUNT_BACKUP_SHA256='f'.repeat(64);env.R2L_ACCOUNT_ROLLOUT_SHA256=f.plan.sha256;
  await assert.rejects(operator.applyFrozenAccounts(input),/backup_pin_or_identity_mismatch/);
  env.R2L_ACCOUNT_BACKUP_SHA256=backup.sha256;env.R2L_ACCOUNT_ROLLOUT_SHA256='f'.repeat(64);
  await assert.rejects(operator.applyFrozenAccounts(input));
  env.R2L_ACCOUNT_ROLLOUT_SHA256=f.plan.sha256;
  await assert.rejects(operator.applyFrozenAccounts({...input,expectedPlanSha256:'f'.repeat(64)}),/operator_input_invalid/);
  const changed=structuredClone(input);changed.snapshot.records[0].value='tampered';
  await assert.rejects(operator.applyFrozenAccounts(changed));
  assert.deepEqual(await snapshotAccountStore({db:f.db,progressInCodes:shared}),before);
  for(const mode of [undefined,'unified-v1','invalid']){
    env.R2L_ACCOUNT_MODE=mode;
    await assert.rejects(operator.exportFrozenAccounts(),/operator_forbidden/);
    await assert.rejects(operator.applyFrozenAccounts(input),/operator_forbidden/);
    await assert.rejects(instance.applyFrozenAccounts(input),/operator_forbidden/);
  }
  env.R2L_ACCOUNT_MODE='freeze-v1';
  assert.equal((await operator.applyFrozenAccounts(input)).status,'merged');
  assert.equal(f.value('progress:'+QA).diamonds,520);assert.equal(f.value('progress:'+A).diamonds,270);
  f.db.prepare('UPDATE read2lead_account_kv SET value=? WHERE namespace=? AND key=?').run('{"diamonds":777,"later_learning":true}',shared?'codes':'progress','progress:'+A);
  assert.equal((await operator.applyFrozenAccounts(input)).status,'already_merged');
  assert.deepEqual(f.value('progress:'+A),{diamonds:777,later_learning:true});
  const adult=new module.Read2LeadPrivatePreview({...ctx,id:'private-adult-preview-v1'},env);
  await assert.rejects(adult.applyFrozenAccounts(input),/operator_forbidden/);
});

test('optional trusted diagnostics preserve fail-closed public responses even when the reporter throws',async t=>{
  const f=await fixture(t,{merged:false}),errors=[];
  f.restart({onError:error=>{errors.push(error.message);throw Error('diagnostic failure');}});
  const response=await f.call('/read2lead/?code='+A);
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'account_host_unavailable'});
  assert.equal(errors.length,1);
});

test('private gate and account browser share one verified immutable bundle without sharing access',async t=>{
  const f=await fixture(t);let reads=0;
  const assets={fetch:request=>{if(new URL(request.url).pathname==='/__private/package.json')reads++;return f.options.assets.fetch(request);}};
  const contentLoader=createPreviewContentLoader({assets,packageSha256:f.options.packageSha256});
  f.restart({assets,contentLoader});assert.equal((await f.call('/read2lead/?code='+A)).status,200);
  const gate=createPreviewApp({store:new StorySqlStore(f.db,{transaction:f.options.transaction,now:f.now}),assets,packageSha256:f.options.packageSha256,contentLoader,accessKey:'s'.repeat(32),now:f.now});
  assert.equal((await gate(new Request(origin+'/read2lead/?code='+A))).status,303,'student code does not bypass private login');
  const login=await gate(new Request(origin+'/private-rehearsal/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'access_secret='+'s'.repeat(32)}));
  assert.equal(login.status,303);assert.equal(reads,1);
  const one=await contentLoader.load(),two=await contentLoader.load();assert.equal(one,two);
  assert.throws(()=>{one.package.lesson.id='changed';},TypeError);
  const key='package:'+one.package.lesson.id+'@'+one.package.lesson.version;
  const copy=one.content.storyValue(key);copy.package.lesson.id='changed';assert.equal(one.content.storyValue(key).package.lesson.id,one.package.lesson.id);
  f.restart({assets,contentLoader});assert.equal((await f.call('/read2lead/?code='+A)).status,200);assert.equal(reads,1);
  assert.throws(()=>f.restart({contentLoader}),/preview_content_loader_mismatch/);
  assert.throws(()=>createPreviewContentLoader({assets,packageSha256:'f'.repeat(64),existing:contentLoader}),/preview_content_loader_mismatch/);
  assert.throws(()=>createPreviewContentLoader({assets,packageSha256:f.options.packageSha256,existing:{assets,packageSha256:f.options.packageSha256,load:()=>one}}),/preview_content_loader_mismatch/);
});

test('failed shared content verification retries the source without accepting changed bytes',async t=>{
  const f=await fixture(t);let reads=0;
  const assets={fetch:request=>++reads===1?new Response('changed bytes'):f.options.assets.fetch(request)};
  const loader=createPreviewContentLoader({assets,packageSha256:f.options.packageSha256});
  await assert.rejects(loader.load(),/preview_package_changed/);
  assert.equal((await loader.load()).package.lesson.id,f.packages[0].lesson.id);assert.equal(reads,2);
});
