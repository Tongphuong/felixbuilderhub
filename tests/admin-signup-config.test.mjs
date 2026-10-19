// R2L-FINAL: founder on/off switch for public sign-up. Exercised through the REAL account service
// (SQL-backed store, the same path the Worker uses), so admin auth, route registration and the
// flag/cap that signup.js reads are all proven end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRead2LeadAccountService} from '../functions/lib/read2lead/account-service.mjs';
import {createAccountTransactionRunner} from '../functions/lib/read2lead/account-transactions.mjs';
import {ACCOUNT_ROUTES} from '../functions/lib/read2lead/account-routes.mjs';
import {isUnifiedAccountPath} from '../functions/lib/read2lead/account-unified-gateway.mjs';
import * as signupConfig from '../functions/api/admin/signup-config.js';

const ADMIN='synthetic-admin';
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const transaction=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const forbidden=new Proxy({},{get:()=>()=>{throw Error('legacy store forbidden');}});
  const infrastructure={ADMIN_PASSWORD:ADMIN,READ2LEAD_BACKEND_SECRET:'b',DEBUG_SPEAKING_KEY:'d',TURNSTILE_SECRET_KEY:'synthetic-turnstile',READ2LEAD_CODES:forbidden,READ2LEAD_PROGRESS:forbidden};
  const options={db,transaction,infrastructure};
  const service=createRead2LeadAccountService(options);createAccountTransactionRunner(options);
  const row=key=>db.prepare("SELECT value FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(key);
  const get=key=>{const r=row(key);return r?JSON.parse(r.value):null;};
  const put=(key,value)=>db.prepare("INSERT INTO read2lead_account_kv VALUES('codes',?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(key,JSON.stringify(value));
  const call=(path,{body,method,admin=true,auth,ip='192.0.2.9'}={})=>service(new Request('https://ordinary.test'+path,{method:method||(body===undefined?'GET':'POST'),
    headers:{'CF-Connecting-IP':ip,...(auth?{Authorization:auth}:admin?{Authorization:'Basic '+btoa('founder:'+ADMIN)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}));
  return {db,get,put,call,snapshot:()=>db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(r=>({...r}))};
}
const URL_='/api/admin/signup-config';
const today=()=>new Date().toISOString().slice(0,10);
const signupBody=(name='Minh')=>({student_name:name,student_age:9,child_gender:'boy',turnstile_token:'tok'});
function mockTurnstile(t){t.mock.method(globalThis,'fetch',async()=>Response.json({success:true}));}

test('the route is registered like /api/admin/codes (transactional, GET+POST) and captured by the gateway',()=>{
  const route=ACCOUNT_ROUTES.find(r=>r.pattern===URL_);const codes=ACCOUNT_ROUTES.find(r=>r.pattern==='/api/admin/codes');
  assert.ok(route,'route registered');assert.equal(route.state,'transactional');assert.deepEqual([...route.methods],['GET','POST']);
  assert.equal(route.state,codes.state);assert.equal(route.handlers.onRequestGet,signupConfig.onRequestGet);
  assert.equal(isUnifiedAccountPath(URL_),true);
});
test('BITE: unreachable without admin auth (no/wrong credentials -> 401, nothing read or written)',async t=>{
  const f=fixture(t);const before=f.snapshot();
  for(const opts of [{admin:false},{auth:'Basic '+btoa('founder:wrong')},{admin:false,body:{enabled:true}},{auth:'Basic '+btoa('founder:wrong'),body:{enabled:true}},{auth:'Bearer x'}]) {
    const r=await f.call(URL_,opts);assert.equal(r.status,401,JSON.stringify(opts));
  }
  assert.deepEqual(f.snapshot(),before);assert.equal(f.get('config:signup_enabled'),null);
});
test('GET shape: {ok, enabled, daily_cap, today_count} with off/50/0 defaults',async t=>{
  const f=fixture(t);const r=await f.call(URL_);assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,enabled:false,daily_cap:50,today_count:0});
  f.put('config:signup_enabled',true);f.put('config:signup_daily_cap',20);f.put('signup-global:'+today(),7);
  assert.deepEqual(await (await f.call(URL_)).json(),{ok:true,enabled:true,daily_cap:20,today_count:7});
});
test('POST enabled:true switches sign-up on: a signup then passes the flag check; enabled:false -> signup_disabled',async t=>{
  const f=fixture(t);mockTurnstile(t);
  const off=await f.call('/api/signup',{body:signupBody(),admin:false});assert.equal(off.status,503);assert.equal((await off.json()).error,'signup_disabled');
  const on=await f.call(URL_,{body:{enabled:true}});assert.equal(on.status,200);assert.equal((await on.json()).enabled,true);
  assert.equal(f.get('config:signup_enabled'),true,'stored as JSON true, exactly what signup.js reads');
  const ok=await f.call('/api/signup',{body:signupBody(),admin:false});assert.equal(ok.status,200);assert.ok((await ok.json()).code);
  assert.equal((await (await f.call(URL_)).json()).today_count,1);
  const stop=await f.call(URL_,{body:{enabled:false}});assert.equal(stop.status,200);assert.equal((await stop.json()).enabled,false);
  const blocked=await f.call('/api/signup',{body:signupBody('Lan'),admin:false});assert.equal(blocked.status,503);assert.equal((await blocked.json()).error,'signup_disabled');
});
test('the daily cap is validated and a cap change takes effect (including 0 = closed)',async t=>{
  const f=fixture(t);mockTurnstile(t);await f.call(URL_,{body:{enabled:true}});
  for(const bad of [-1,501,1.5,'10',null,NaN,true]) {
    const r=await f.call(URL_,{body:{daily_cap:bad}});const j=await r.json();
    assert.equal(r.status,400,String(bad));assert.equal(j.error,'daily_cap_invalid');assert.match(j.message,/[^\x00-\x7F]/);
  }
  assert.equal(f.get('config:signup_daily_cap'),null,'a rejected cap writes nothing');
  assert.equal((await (await f.call(URL_,{body:{daily_cap:1}})).json()).daily_cap,1);
  assert.equal(f.get('config:signup_daily_cap'),1);
  assert.equal((await f.call('/api/signup',{body:signupBody('Minh'),admin:false,ip:'10.0.0.1'})).status,200);
  const second=await f.call('/api/signup',{body:signupBody('Lan'),admin:false,ip:'10.0.0.2'});assert.equal(second.status,429);assert.equal((await second.json()).error,'global_cap');
  await f.call(URL_,{body:{daily_cap:500}});
  assert.equal((await f.call('/api/signup',{body:signupBody('Hoa'),admin:false,ip:'10.0.0.3'})).status,200);
  await f.call(URL_,{body:{daily_cap:0}});
  const zero=await f.call('/api/signup',{body:signupBody('Nam'),admin:false,ip:'10.0.0.4'});assert.equal(zero.status,429);assert.equal((await zero.json()).error,'global_cap');
});
test('POST validation: Vietnamese 400s, nothing written; both fields at once; GET after POST agrees',async t=>{
  const f=fixture(t);const before=f.snapshot();
  for(const [body,error] of [[{},'nothing_to_change'],[{enabled:'yes'},'enabled_invalid'],[{enabled:1},'enabled_invalid'],['{nope','invalid_json'],['[]','invalid_json'],['null','invalid_json']]) {
    const r=await f.call(URL_,{body});const j=await r.json();assert.equal(r.status,400,JSON.stringify(body));assert.equal(j.error,error);assert.match(j.message,/[^\x00-\x7F]/);
  }
  assert.deepEqual(f.snapshot(),before);
  const both=await f.call(URL_,{body:{enabled:true,daily_cap:30}});assert.deepEqual(await both.json(),{ok:true,enabled:true,daily_cap:30,today_count:0});
  assert.deepEqual(await (await f.call(URL_)).json(),{ok:true,enabled:true,daily_cap:30,today_count:0});
  const onlyCap=await f.call(URL_,{body:{daily_cap:10}});assert.equal((await onlyCap.json()).enabled,true,'a cap-only change leaves the switch alone');
});
