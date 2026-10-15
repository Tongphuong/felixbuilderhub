import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
import {EXISTING_TEST_OBJECT,VERIFIED_ADMIN_HEADER} from '../functions/lib/read2lead/account-gateway.mjs';
const CODE='R2L-SYNTHETIC-GATEWAY',OTHER='R2L-SYNTHETIC-OTHER';
function fixture({configured=true,backendStatus=200,binding=true,recognized=true}={}){
  const calls=[],rawCalls=[];let oldCalls=0;
  const kv={get:async key=>{rawCalls.push(['get',key]);return 'old';},put:async key=>rawCalls.push(['put',key]),delete:async key=>rawCalls.push(['delete',key]),list:async()=>({keys:[{name:CODE}],list_complete:true,cursor:''})};
  const env={ADMIN_PASSWORD:'local-admin',READ2LEAD_CODES:kv,...(configured?{R2L_TEST_ACCOUNT_CODE:CODE}:{}),...(binding?{R2L_MAINTENANCE_STATE:{idFromName:name=>{assert.equal(name,EXISTING_TEST_OBJECT);return 'fixed';},get:id=>({fetch:async request=>{calls.push({id,request,body:['GET','HEAD'].includes(request.method)?null:await request.text()});return new Response('selected-account',{status:backendStatus,headers:recognized?{'X-R2L-Account-Host':EXISTING_TEST_OBJECT}:{}});}})}}:{})};
  const run=(path,{method='GET',body,headers={},origin='https://normal.test',next}={})=>onRequest({env,request:new Request(origin+path,{method,headers,...(body===undefined?{}:{body})}),next:async()=>{oldCalls++;return next?next(env):new Response('ordinary-site');}});
  return {env,run,calls,rawCalls,oldCalls:()=>oldCalls};
}
test('unset leaves ordinary storage and route untouched',async()=>{
  const f=fixture({configured:false});const raw=f.env.READ2LEAD_CODES;
  assert.equal(await(await f.run('/api/read2lead-progress?code='+CODE)).text(),'ordinary-site');assert.equal(f.env.READ2LEAD_CODES,raw);assert.equal(f.calls.length,0);
});
test('query/header/JSON/form/media cookie all use fixed selected-account object',async()=>{
  for(const [path,options] of [
    ['/ho-so?code='+CODE,{}],['/api/read2lead-story-session',{headers:{'X-Read2Lead-Code':CODE}}],
    ['/api/generate-read2lead-pack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_code:CODE,collection:'one-story-a-day'})}],
    ['/api/read2lead-speaking-check',{method:'POST',body:new URLSearchParams({code:CODE})}],
    ['/api/read2lead-speaking-check',{method:'POST',body:(()=>{const f=new FormData();f.set('access_code',CODE);f.set('audio',new Blob(['synthetic']),'a.wav');return f;})()}],
    ['/api/read2lead-story-media/test.mp3',{headers:{cookie:'__Host-r2l_student_test='+'a'.repeat(64)}}],
  ]){const f=fixture();assert.equal((await f.run(path,options)).status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].id,'fixed');assert.equal(f.oldCalls(),0);assert.equal(f.rawCalls.length,0);}
});
test('other accounts reach original handler with body intact and cannot touch protected keys',async()=>{
  const f=fixture();const body=JSON.stringify({access_code:OTHER});
  const response=await f.run('/api/read2lead-progress-update',{method:'POST',headers:{'Content-Type':'application/json'},body,next:async env=>new Response(await env.READ2LEAD_CODES.get(OTHER))});assert.equal(await response.text(),'old');assert.equal(f.calls.length,0);
  const guard=f.env.READ2LEAD_CODES;
  await f.run('/');assert.equal(f.env.READ2LEAD_CODES,guard,'do not stack wrappers on reused environment');
  for(const key of [CODE,'progress:'+CODE]){
    const denied=await f.run('/api/indirect-write',{next:async env=>{await env.READ2LEAD_CODES.put(key,'stale');return new Response('bad');}});assert.equal(denied.status,503);
  }
  assert.deepEqual(f.rawCalls,[['get',OTHER]]);
});
test('admin auth precedes routing; forged marker is stripped from public requests',async()=>{
  const f=fixture();const path='/api/admin/codes/'+CODE+'/set-level';
  for(const authorization of ['', 'Basic '+btoa('x:wrong')])assert.equal((await f.run(path,{method:'POST',headers:{Authorization:authorization,[VERIFIED_ADMIN_HEADER]:'1'}})).status,401);
  assert.equal(f.calls.length,0);
  await f.run('/api/read2lead-progress?code='+CODE,{headers:{[VERIFIED_ADMIN_HEADER]:'1'}});assert.equal(f.calls[0].request.headers.get(VERIFIED_ADMIN_HEADER),null);
  await f.run(path,{method:'POST',headers:{Authorization:'Basic '+btoa('x:local-admin')}});assert.equal(f.calls[1].request.headers.get(VERIFIED_ADMIN_HEADER),'1');
});
test('missing backend, error and API404 never fall through; public navigation404 can',async()=>{
  for(const options of [{binding:false},{backendStatus:503},{backendStatus:404}]){const f=fixture(options);const response=await f.run('/api/read2lead-progress?code='+CODE);assert.equal(response.status,options.backendStatus||503);assert.equal(f.oldCalls(),0);}
  const f=fixture({backendStatus:404});assert.equal(await(await f.run('/coaching',{headers:{cookie:'__Host-r2l_student_test=x'}})).text(),'ordinary-site');assert.equal(f.oldCalls(),1);
});
test('direct Pages origin cannot bypass selected routing and list readers cannot expose protected rows',async()=>{
  const f=fixture();await f.run('/api/read2lead-progress?code='+CODE,{origin:'https://direct.pages.dev'});assert.equal(f.calls[0].request.url,'https://direct.pages.dev/api/read2lead-progress?code='+CODE);
  const response=await f.run('/api/indirect-list',{next:async env=>Response.json(await env.READ2LEAD_CODES.list())});assert.equal(response.status,503);
});
test('changing student clears the test cookie and global admin actions never route by student cookie',async()=>{
  for(const options of [{},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_code:OTHER})}]){
    const f=fixture();const response=await f.run(options.body?'/api/read2lead-progress-update':'/ho-so?code='+OTHER,{...options,headers:{...options.headers,cookie:'__Host-r2l_student_test=x'}});
    assert.equal(await response.text(),'ordinary-site');assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(f.calls.length,0);
  }
  const f=fixture();const response=await f.run('/api/admin/codes/clear-open-lessons',{method:'POST',headers:{Authorization:'Basic '+btoa('x:local-admin'),cookie:'__Host-r2l_student_test=x'},next:async env=>Response.json(await env.READ2LEAD_CODES.list())});
  assert.equal(response.status,503);assert.equal(f.calls.length,0);
});
test('old adult backend or unexpected server is refused without redirecting or falling back',async()=>{
  for(const backendStatus of [200,303,404]){const f=fixture({backendStatus,recognized:false});const response=await f.run('/read2lead/?code='+CODE);assert.equal(response.status,503);assert.equal(response.headers.get('Location'),null);assert.equal(f.oldCalls(),0);}
});
test('student cookie does not capture the existing adult login',async()=>{
  const f=fixture();f.env.R2L_MAINTENANCE_STATE={idFromName:name=>{assert.equal(name,'private-adult-preview-v1');return name;},get:()=>({fetch:async()=>new Response('adult login')})};
  const response=await f.run('/private-rehearsal/login',{headers:{cookie:'__Host-r2l_student_test=x'}});assert.equal(await response.text(),'adult login');assert.equal(f.calls.length,0);
});

test('token-only login consults selected host without inventing a code credential',async()=>{
  const f=fixture();
  const response=await f.run('/api/r2l-link?token='+'a'.repeat(32));
  assert.equal(await response.text(),'selected-account');assert.equal(f.calls.length,1);assert.equal(f.oldCalls(),0);
  assert.equal(f.calls[0].request.headers.get('X-Read2Lead-Code'),null);
});

test('public magic-link landing remains public with a stale student cookie, including external navigation',async()=>{
  for(const path of ['/r2l/start','/r2l/start/'])for(const method of ['GET','HEAD']){
    const f=fixture({backendStatus:403});
    const response=await f.run(path+'?t='+'a'.repeat(32),{method,headers:{cookie:'__Host-r2l_student_test=stale','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}});
    assert.equal(response.status,200);assert.equal(await response.text(),'ordinary-site');assert.equal(f.calls.length,0);assert.equal(f.oldCalls(),1);
    assert.match(response.headers.get('Set-Cookie'),/__Host-r2l_student_test=;.*Max-Age=0/);
  }
});

test('only explicit unknown selected token falls back to legacy login; errors fail closed',async()=>{
  for(const [status,error,fallback] of [[404,'link_not_found',true],[404,'code_not_found',false],[410,'link_expired',false],[401,'unauthorized',false],[503,'unavailable',false]]){
    const f=fixture();f.env.R2L_MAINTENANCE_STATE.get=()=>({fetch:async()=>Response.json({ok:false,error},{status,headers:{'X-R2L-Account-Host':EXISTING_TEST_OBJECT}})});
    const response=await f.run('/api/r2l-link?token='+'b'.repeat(32),{headers:{cookie:'__Host-r2l_student_test=old'},next:()=>new Response('ordinary link resolved')});
    assert.equal(f.oldCalls(),fallback?1:0);assert.equal(response.status,fallback?200:status);
    if(fallback){assert.equal(await response.text(),'ordinary link resolved');assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);}
  }
});

function listFixture({recognized=true,status=200,selectedCode=CODE}={}){
 const reads=[],writes=[],lists=[],forwards=[];
 const record=(name,level)=>({issued_at:'2026-07-19',is_test:true,is_shared:false,student_profile:{student_name:name,age:8,level},uses_remaining:50});
 const values=new Map([[CODE,JSON.stringify(record('old selected','L0'))],[OTHER,JSON.stringify(record('other','L2'))]]);
 const kv={async get(key,options){reads.push(key);const value=values.get(key)||null;return options?.type==='json'&&value?JSON.parse(value):value;},async put(key,value){writes.push(key);values.set(key,value);},async delete(key){writes.push(key);values.delete(key);},async list(options){lists.push(options);return options.cursor==='second'?{keys:[{name:OTHER}],list_complete:true,cursor:''}:{keys:[{name:CODE},{name:'progress:'+CODE},{name:OTHER}],list_complete:false,cursor:'second'};}};
 const current={code:selectedCode,...record('current selected','L1'),progress:{current_level:'L1'}};
 const env={ADMIN_PASSWORD:'local-admin',R2L_TEST_ACCOUNT_CODE:CODE,READ2LEAD_CODES:kv,R2L_MAINTENANCE_STATE:{idFromName:name=>{assert.equal(name,EXISTING_TEST_OBJECT);return name;},get:()=>({fetch:async request=>{forwards.push(request);return Response.json({ok:true,items:[current],list_complete:true,cursor:null},{status,headers:recognized?{'X-R2L-Account-Host':EXISTING_TEST_OBJECT}:{}});}})}};
 const run=(suffix='',authorized=true)=>onRequest({env,request:new Request('https://normal.test/api/admin/codes'+suffix,{headers:authorized?{Authorization:'Basic '+btoa('x:local-admin')}:{}}),next:()=>{throw Error('must_use_bounded_list_handler');}});
 return {env,run,reads,writes,lists,forwards};
}
test('admin list combines original accounts and current selected row without stale reads or writes',async()=>{
 const f=listFixture(),response=await f.run();assert.equal(response.status,200);const body=await response.json();
 assert.deepEqual(body.items.map(x=>x.code).sort(),[CODE,OTHER].sort());assert.equal(body.items.find(x=>x.code===CODE).student_profile.student_name,'current selected');assert.equal(body.items.find(x=>x.code===CODE).student_profile.level,'L1');assert.equal(body.cursor,'second');assert.equal(body.list_complete,false);
 assert.ok(!f.reads.includes(CODE)&&!f.reads.includes('progress:'+CODE));assert.ok(!f.writes.includes(CODE)&&!f.writes.includes('progress:'+CODE));assert.equal(f.forwards.length,1);assert.equal(f.forwards[0].headers.get(VERIFIED_ADMIN_HEADER),'1');assert.equal(f.forwards[0].headers.get('X-Read2Lead-Code'),CODE);assert.equal(new URL(f.forwards[0].url).search,'');
 await assert.rejects(f.env.READ2LEAD_CODES.put(CODE,'stale'),/legacy_account_fenced/);await assert.rejects(f.env.READ2LEAD_CODES.get(CODE),/legacy_account_fenced/);
 const second=await(await f.run('?cursor=second')).json();assert.deepEqual(second.items.map(x=>x.code),[OTHER]);assert.equal(second.cursor,null);assert.equal(second.list_complete,true);assert.equal(f.forwards.length,1);assert.equal(f.lists[1].cursor,'second');
});
test('admin listing refuses unauthorized access and never substitutes stale selected row on backend errors',async()=>{
 const denied=listFixture();assert.equal((await denied.run('',false)).status,401);assert.deepEqual(denied.reads,[]);assert.deepEqual(denied.lists,[]);assert.deepEqual(denied.forwards,[]);
 for(const options of [{recognized:false},{status:503},{selectedCode:OTHER}]){const f=listFixture(options);assert.equal((await f.run()).status,503);assert.ok(!f.reads.includes(CODE));assert.ok(!f.writes.includes(CODE));}
});
