import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createExistingTestAccountApp, TEST_ACCOUNT_COOKIE } from '../cloudflare/read2lead-private-preview/account-app.mjs';
import { prepareAccountSnapshot } from '../functions/lib/read2lead/account-snapshot.mjs';
import { onRequest as pagesMiddleware } from '../functions/_middleware.js';
import { onRequestGet as resolveLegacyLink } from '../functions/api/r2l-link.js';
import { EXISTING_TEST_OBJECT } from '../functions/lib/read2lead/account-gateway.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};

const CODE='R2L-EXISTING-SYNTHETIC-TEST',origin='https://student.test';
const digest=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t,{shared=true,accountOverrides={},snapshotPin,manifestOverride,manifestPin}={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const transaction=work=>{db.exec('BEGIN');try{const value=work();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
  let clock=Date.now(),rawCalls=0;const now=()=>clock;
  const account={is_test:true,is_shared:false,uses_remaining:50,student_profile:{student_name:'Existing synthetic test',level:pkg.lesson.level,age:8,child_gender:'boy'},progress:{current_level:pkg.lesson.level,review_history:[],current_pack:null},unknown:{preserve:true},...accountOverrides};
  const snapshot=await prepareAccountSnapshot({sourceId:'synthetic-host-input',progressInCodes:shared,records:[
    {namespace:'codes',key:CODE,value:JSON.stringify(account),expires:null,metadata:null},
    {namespace:shared?'codes':'progress',key:'progress:'+CODE,value:JSON.stringify({schema_version:2,level_reset_version:20260606,current_level:pkg.lesson.level,initial_level:pkg.lesson.level,diamonds:20,total_xp:0,completed_packs:0,unlocked_parts:[]}),expires:null,metadata:null},
  ]});
  const manifest=JSON.stringify({format:'read2lead-private-cloud-preview-v1',existingSite:true,package:pkg,publicAssets:['/scripts/reader.js'],scriptHashes:[],pages:{'/read2lead/':'/__private/site/read2lead.html','/read2lead/lesson/':'/__private/site/lesson.html'},...manifestOverride});
  const assets={async fetch(request){const path=new URL(request.url).pathname;if(path==='/__private/package.json')return new Response(manifest);if(path.startsWith('/__private/site/'))return new Response('<!doctype html><title>Existing reader fixture</title>',{headers:{'Content-Type':'text/html'}});if(path==='/scripts/reader.js')return new Response('/* existing script */');return new Response('not found',{status:404});}};
  const forbidden={get(){rawCalls++;throw Error('legacy KV used');},put(){rawCalls++;throw Error('legacy KV used');}};
  const options={db,transaction,assets,snapshot,expectedSnapshotSha256:snapshotPin??snapshot.sha256,packageSha256:manifestPin??digest(manifest),code:CODE,origin,now,infrastructure:{ADMIN_PASSWORD:'synthetic-admin',READ2LEAD_CODES:forbidden,AI:{run(){throw Error('paid provider used');}}}};
  let app;const restart=()=>{app=createExistingTestAccountApp(options);};
  const request=(path,body,headers={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const call=(path,body,headers={})=>app(request(path,body,headers));
  const api=async(path,body,headers={})=>{const response=await call(path,body,{'X-Read2Lead-Code':CODE,...headers});return {status:response.status,body:await response.json()};};
  const value=key=>JSON.parse(db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(key.startsWith('progress:')&&!shared?'progress':'codes',key).value);
  return {db,options,restart,call,api,value,handle:request=>app(request),rawCalls:()=>rawCalls,setTime:n=>{clock=n;},now};
}

for(const shared of [true,false])test(`existing test account opens story and resumes without replacement wallet (shared=${shared})`,async t=>{
  const f=await fixture(t,{shared});f.restart();
  const entry=await f.call('/read2lead/?code='+CODE);assert.equal(entry.status,200);assert.match(await entry.text(),/Existing reader fixture/);
  const cookie=entry.headers.get('Set-Cookie');assert.match(cookie,new RegExp('^'+TEST_ACCOUNT_COOKIE+'='));assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  const assigned=await f.api('/api/generate-read2lead-pack',{access_code:CODE,collection:'one-story-a-day'});assert.equal(assigned.status,200,JSON.stringify(assigned));
  const duplicates=await Promise.all(Array.from({length:4},()=>f.api('/api/generate-read2lead-pack',{access_code:CODE,collection:'one-story-a-day'})));
  assert.ok(duplicates.every(v=>v.status===200&&v.body.pack_id===assigned.body.pack_id));
  const lesson=await f.api('/api/read2lead-lesson?code='+CODE+'&pack_id='+assigned.body.pack_id);assert.equal(lesson.status,200);assert.equal(lesson.body.lesson.title,pkg.lesson.title_en);
  let view=await f.api('/api/read2lead-story-session',{action:'open_assigned',packId:assigned.body.pack_id});assert.equal(view.status,200);assert.equal(view.body.session.stage,'read');
  view=await f.api('/api/read2lead-story-session',{action:'event',sessionId:view.body.session.id,revision:view.body.session.revision,requestId:'read-done',event:{type:'read_complete'}});assert.equal(view.status,200);assert.equal(view.body.session.stage,'understand');
  assert.equal(f.value('progress:'+CODE).diamonds,20);assert.deepEqual(f.value(CODE).unknown,{preserve:true});assert.equal(f.value(CODE).uses_remaining,50);
  f.restart();const resumed=await f.api('/api/read2lead-story-session?sessionId='+view.body.session.id);assert.deepEqual(resumed.body.session,view.body.session);assert.equal(f.value('progress:'+CODE).diamonds,20);
  const script=await f.call('/scripts/reader.js',undefined,{cookie:cookie.split(';')[0]});assert.equal(script.status,200);
  const reloaded=await f.call('/read2lead/?code='+CODE,undefined,{cookie:cookie.split(';')[0]});assert.equal(reloaded.status,200);assert.equal(reloaded.headers.get('Set-Cookie'),null);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='private_site_kv'").get().n,0);
  assert.equal(f.rawCalls(),0);
});

test('external code link opens only as a top-level reader navigation and preserves account state',async t=>{
  const f=await fixture(t);f.restart();
  const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  const entry=await f.call('/read2lead/?code='+CODE,undefined,headers);
  assert.equal(entry.status,200);assert.match(await entry.text(),/Existing reader fixture/);
  const cookie=entry.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(f.value('progress:'+CODE).diamonds,20);assert.equal(f.value(CODE).uses_remaining,50);
  const before=JSON.stringify(f.db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all());
  const rejected=[
    ['/read2lead/',undefined,headers],
    ['/read2lead/?code=OTHER',undefined,headers],
    ['/read2lead/?code='+CODE+'&access_code=OTHER',undefined,headers],
    ['/read2lead/?code='+CODE,undefined,{...headers,'X-Read2Lead-Code':'OTHER'}],
    ['/read2lead/?code='+CODE,undefined,{...headers,'sec-fetch-mode':'cors'}],
    ['/read2lead/?code='+CODE,undefined,{...headers,'sec-fetch-dest':'iframe'}],
    ['/read2lead/?code='+CODE,undefined,{'sec-fetch-site':'cross-site'}],
    ['/read2lead/',undefined,{...headers,cookie:cookie.split(';')[0]}],
    ['/read2lead/?code='+CODE,{level:'L1'},headers],
    ['/api/read2lead-progress?code='+CODE,undefined,headers],
    ['/api/read2lead-story-turn?code='+CODE,{sessionId:'unused'},headers],
    ['/api/admin/codes/'+CODE+'/set-level',{level:'L2'},headers],
    ['/scripts/reader.js?code='+CODE,undefined,headers],
    ['/read2lead/lesson/?code='+CODE,undefined,headers],
  ];
  for(const [path,body,h] of rejected){const response=await f.call(path,body,h);assert.equal(response.status,403,path);assert.equal(response.headers.get('Set-Cookie'),null);}
  const foreign=await createExistingTestAccountApp(f.options)(new Request('https://other.test/read2lead/?code='+CODE,{headers}));assert.equal(foreign.status,403);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all()),before);
  const revoked={...f.value(CODE),is_test:false};
  f.db.prepare("UPDATE read2lead_account_kv SET value=? WHERE namespace='codes' AND key=?").run(JSON.stringify(revoked),CODE);
  assert.equal((await f.call('/read2lead/?code='+CODE,undefined,headers)).status,401);
  assert.equal(f.rawCalls(),0);
});

test('unknown/ambiguous codes, missing/expired cookie, wrong origin and adult login do not enter student host',async t=>{
  const f=await fixture(t);f.restart();const entry=await f.call('/read2lead/?code='+CODE),cookie=entry.headers.get('Set-Cookie').split(';')[0];
  for(const path of ['/read2lead/','/read2lead/?code=OTHER','/read2lead/?code='+CODE+'&code=OTHER','/scripts/reader.js'])assert.equal((await f.call(path)).status,401);
  assert.equal((await f.call('/read2lead/?code=OTHER',undefined,{cookie})).status,401);
  assert.equal((await f.call('/read2lead/?code='+CODE,undefined,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await f.call('/api/generate-read2lead-pack',{access_code:CODE,collection:'one-story-a-day'},{Origin:'https://other.test','X-Read2Lead-Code':CODE})).status,401);
  assert.equal((await f.call('/private-rehearsal/login')).status,404);
  assert.equal((await f.call('/__private/package.json',undefined,{cookie})).status,404);
  f.setTime(f.now()+900001);assert.equal((await f.call('/scripts/reader.js',undefined,{cookie})).status,401);
});

test('non-test/shared accounts and incomplete inventory cannot be imported',async t=>{
  for(const accountOverrides of [{is_test:false},{is_shared:true},{is_shared:undefined}]){const f=await fixture(t,{accountOverrides});assert.throws(f.restart,/test_account_required/);}
  const f=await fixture(t);f.options.snapshot.records.pop();assert.throws(f.restart,/test_account_inventory_required/);
});

test('changed snapshot/content pins or invalid package fail before importing account rows',async t=>{
  for(const options of [{snapshotPin:'0'.repeat(64)},{manifestPin:'0'.repeat(64)},{manifestOverride:{package:{lesson:{}}}}]){
    const f=await fixture(t,options);f.restart();assert.equal((await f.call('/read2lead/?code='+CODE)).status,503);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM read2lead_account_kv').get().n,0);
  }
});

test('revoking test account immediately invalidates previously issued media access',async t=>{
  const f=await fixture(t);f.restart();const entry=await f.call('/read2lead/?code='+CODE),cookie=entry.headers.get('Set-Cookie').split(';')[0];
  const value={...f.value(CODE),is_test:false};f.db.prepare("UPDATE read2lead_account_kv SET value=? WHERE namespace='codes' AND key=?").run(JSON.stringify(value),CODE);
  assert.equal((await f.call('/scripts/reader.js',undefined,{cookie})).status,401);
  assert.equal((await f.call('/read2lead/?code='+CODE)).status,401);
});
test('temporary asset failure refuses access and recovers without a partial import',async t=>{
  const f=await fixture(t);const original=f.options.assets.fetch;let first=true;
  f.options.assets.fetch=async request=>{if(first){first=false;return new Response('temporary failure',{status:503});}return original(request);};
  f.restart();assert.equal((await f.call('/read2lead/?code='+CODE)).status,503);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM read2lead_account_kv').get().n,0);
  assert.equal((await f.call('/read2lead/?code='+CODE)).status,200);assert.equal(f.value('progress:'+CODE).diamonds,20);
});

test('SQL-minted student link resolves without code or cookie, retaining expiry and revocation',async t=>{
  const f=await fixture(t);f.restart();
  const minted=await f.api('/api/admin/codes/'+CODE+'/links',{}, {Authorization:'Basic '+btoa('x:synthetic-admin')});
  assert.equal(minted.status,200);const token=minted.body.token;
  const accountBefore=JSON.stringify([f.value(CODE),f.value('progress:'+CODE)]);
  let response=await f.call('/api/r2l-link?token='+token);
  assert.equal(response.status,200);let result=await response.json();
  assert.equal(result.access_code,CODE);assert.equal(result.student_name,'Existing synthetic test');
  assert.equal(response.headers.get('Set-Cookie'),null,'token resolution does not broaden browser access');
  const link=f.value('r2l_link:'+token);assert.equal(link.uses_remaining,5000);
  response=await f.call('/api/r2l-link?token='+token);assert.equal(response.status,200);
  assert.equal(f.value('r2l_link:'+token).uses_remaining,5000);
  f.db.prepare("UPDATE read2lead_account_kv SET value=? WHERE namespace='codes' AND key=?").run(JSON.stringify({...link,expires_at:'2020-01-01'}),'r2l_link:'+token);
  response=await f.call('/api/r2l-link?token='+token);assert.equal(response.status,410);assert.equal((await response.json()).error,'link_expired');
  f.db.prepare("DELETE FROM read2lead_account_kv WHERE namespace='codes' AND key=?").run('r2l_link:'+token);
  response=await f.call('/api/r2l-link?token='+token);assert.equal(response.status,404);assert.equal((await response.json()).error,'link_not_found');
  assert.equal(JSON.stringify([f.value(CODE),f.value('progress:'+CODE)]),accountBefore);assert.equal(f.rawCalls(),0);
});

test('student link never bypasses origin, conflicting identity or current-account protection',async t=>{
  const f=await fixture(t);f.restart();
  const minted=await f.api('/api/admin/codes/'+CODE+'/links',{}, {Authorization:'Basic '+btoa('x:synthetic-admin')});
  const path='/api/r2l-link?token='+minted.body.token;
  assert.equal((await f.call(path,undefined,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await f.call(path+'&code=OTHER')).status,401);
  assert.equal((await f.call(path,undefined,{'X-Read2Lead-Code':'OTHER'})).status,401);
  const account={...f.value(CODE),is_test:false};
  f.db.prepare("UPDATE read2lead_account_kv SET value=? WHERE namespace='codes' AND key=?").run(JSON.stringify(account),CODE);
  assert.equal((await f.call(path)).status,401);
  const missing=await f.call('/api/r2l-link?token='+'0'.repeat(32));
  assert.equal(missing.status,404,'unknown tokens remain distinguishable for legacy resolver fallback even if selected account is disabled');
});

test('normal Pages-to-account login resolves SQL and legacy tokens without stale selected reads',async t=>{
  const f=await fixture(t);f.restart();
  const other='R2L-LEGACY-OTHER',legacyToken='c'.repeat(32),reads=[],methods=[];
  const values=new Map([
    [CODE,JSON.stringify({student_profile:{student_name:'STALE SELECTED'}})],
    [other,JSON.stringify({student_profile:{student_name:'Legacy child',level:'L2'}})],
    ['r2l_link:'+legacyToken,JSON.stringify({access_code:other,expires_at:'2030-01-01',uses_remaining:8})],
  ]);
  const kv={async get(key,options){reads.push(key);const value=values.get(key)||null;return options?.type==='json'&&value?JSON.parse(value):value;},async put(key,value){values.set(key,value);},async delete(key){values.delete(key);},async list(){return {keys:[],list_complete:true,cursor:''};}};
  const env={ADMIN_PASSWORD:'synthetic-admin',R2L_TEST_ACCOUNT_CODE:CODE,READ2LEAD_CODES:kv,R2L_MAINTENANCE_STATE:{idFromName:name=>{assert.equal(name,EXISTING_TEST_OBJECT);return name;},get:()=>({fetch:async request=>{methods.push(request.method);const response=await f.handle(request);const headers=new Headers(response.headers);headers.set('X-R2L-Account-Host',EXISTING_TEST_OBJECT);return new Response(response.body,{status:response.status,headers});}})}};
  const run=(path,options={})=>{
    const request=new Request(origin+path,{...options,headers:{Origin:origin,...options.headers}});
    return pagesMiddleware({request,env,data:{},next:async()=>{const response=await resolveLegacyLink({request,env});return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;}});
  };
  const created=await run('/api/admin/codes/'+CODE+'/links',{method:'POST',headers:{Origin:origin,Authorization:'Basic '+btoa('x:synthetic-admin'),'Content-Type':'application/json'},body:'{}'});
  assert.equal(created.status,200);const token=(await created.json()).token;
  const before=JSON.stringify([f.value(CODE),f.value('progress:'+CODE)]);
  const selected=await run('/api/r2l-link?token='+token);assert.equal(selected.status,200);assert.equal((await selected.json()).student_name,'Existing synthetic test');
  const head=await run('/api/r2l-link?token='+token,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(methods.at(-1),'GET');
  const legacy=await run('/api/r2l-link?token='+legacyToken,{headers:{cookie:TEST_ACCOUNT_COOKIE+'=old'}});assert.equal(legacy.status,200);assert.equal((await legacy.json()).access_code,other);assert.match(legacy.headers.get('Set-Cookie'),/Max-Age=0/);
  const legacyHead=await run('/api/r2l-link?token='+legacyToken,{method:'HEAD'});assert.equal(legacyHead.status,200);assert.equal(await legacyHead.text(),'');
  const missing=await run('/api/r2l-link?token='+'d'.repeat(32));assert.equal(missing.status,404);assert.equal((await missing.json()).error,'link_not_found');
  assert.equal((await run('/api/r2l-link?token=invalid')).status,400);
  const revoked=await run('/api/admin/codes/'+CODE+'/links?token='+token,{method:'DELETE',headers:{Origin:origin,Authorization:'Basic '+btoa('x:synthetic-admin')}});assert.equal(revoked.status,200);
  assert.equal((await run('/api/r2l-link?token='+token)).status,404);
  assert.equal(JSON.stringify([f.value(CODE),f.value('progress:'+CODE)]),before);
  assert.ok(!reads.includes(CODE));assert.ok(!reads.includes('progress:'+CODE));assert.equal(f.rawCalls(),0);
});
