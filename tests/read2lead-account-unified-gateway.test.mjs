import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { UNIFIED_MODE, FREEZE_MODE, ACCOUNT_MODE_HEADER, ACCOUNT_PLAN_HEADER, isUnifiedAccountPath } from '../functions/lib/read2lead/account-unified-gateway.mjs';
import { EXISTING_TEST_OBJECT, VERIFIED_ADMIN_HEADER } from '../functions/lib/read2lead/account-gateway.mjs';
import { ACCOUNT_ROUTES } from '../functions/lib/read2lead/account-routes.mjs';

const pin='a'.repeat(64);
function fixture({mode=UNIFIED_MODE,status=200,backend=true,headers={},body='account-host'}={}) {
  const calls=[],reads=[];let nextCalls=0;
  const kv={get:async key=>{reads.push(key);return 'legacy';},put:async key=>reads.push(key),delete:async key=>reads.push(key),list:async()=>{reads.push('list');return {keys:[]};}};
  const env={ADMIN_PASSWORD:'local-admin',R2L_ACCOUNT_MODE:mode,R2L_ACCOUNT_ROLLOUT_SHA256:pin,READ2LEAD_CODES:kv,READ2LEAD_PROGRESS:kv,
    ...(backend?{R2L_MAINTENANCE_STATE:{idFromName:name=>{assert.equal(name,EXISTING_TEST_OBJECT);return name;},get:id=>({fetch:async request=>{calls.push({id,request,body:request.body?await request.clone().text():null});return new Response(body,{status,headers:{'X-R2L-Account-Host':EXISTING_TEST_OBJECT,[ACCOUNT_MODE_HEADER]:UNIFIED_MODE,[ACCOUNT_PLAN_HEADER]:pin,...headers}});}})}}:{})};
  const run=(path,{method='GET',body,headers={},next}={})=>onRequest({env,request:new Request('https://normal.test'+path,{method,headers,...(body===undefined?{}:{body})}),next:async()=>{nextCalls++;return next?next(env):new Response('public-site');}});
  return {env,calls,reads,run,nextCalls:()=>nextCalls};
}
test('unset mode leaves ordinary Pages behavior and raw bindings unchanged',async()=>{
  const f=fixture({mode:null});const raw=f.env.READ2LEAD_CODES;
  assert.equal(await(await f.run('/api/read2lead-progress?code=SYNTHETIC')).text(),'public-site');assert.equal(f.env.READ2LEAD_CODES,raw);assert.equal(f.calls.length,0);
});
test('all registered account routes and future read2lead API paths are captured',()=>{
  for(const route of ACCOUNT_ROUTES)assert.equal(isUnifiedAccountPath(route.pattern.replace(/\[[^\]]+\]/g,'synthetic')),true,route.pattern);
  for(const path of ['/api/read2lead-new-writer','/api/read2lead-story-media/asset','/read2lead/','/read2lead/lesson','/ho-so'])assert.equal(isUnifiedAccountPath(path),true,path);
  for(const path of ['/','/r2l/start','/about','/_astro/page.js','/api/unrelated'])assert.equal(isUnifiedAccountPath(path),false,path);
});
test('ordinary query, body, token, shared APIs and media all reach the same existing SQL host',async()=>{
  const f=fixture();
  for(const [path,options] of [
    ['/read2lead/?code=SYNTHETIC',{}],['/api/r2l-link?token='+'b'.repeat(32),{}],['/api/read2lead-leaderboard',{}],
    ['/api/generate-read2lead-pack',{method:'POST',body:'{"access_code":"SYNTHETIC"}',headers:{'Content-Type':'application/json'}}],
    ['/api/read2lead-story-media/asset',{headers:{cookie:'__Host-r2l_account=synthetic'}}],
  ]){const response=await f.run(path,options);assert.equal(response.status,200);assert.equal(await response.text(),'account-host');}
  assert.equal(f.calls.length,5);assert.equal(f.calls[3].body,'{"access_code":"SYNTHETIC"}');
  for(const {request} of f.calls){assert.equal(request.headers.get(ACCOUNT_MODE_HEADER),UNIFIED_MODE);assert.equal(request.headers.get(ACCOUNT_PLAN_HEADER),pin);}
  assert.equal(f.nextCalls(),0);assert.deepEqual(f.reads,[]);
});
test('backend failures, 404s, missing binding and wrong receipts never fall back',async()=>{
  for(const options of [{status:404},{status:503},{backend:false},{headers:{[ACCOUNT_MODE_HEADER]:'old-test'}},{headers:{[ACCOUNT_PLAN_HEADER]:'b'.repeat(64)}},{headers:{'X-R2L-Account-Host':'private-adult-preview-v1'}},{status:302,headers:{Location:'/legacy'}}]){
    const f=fixture(options);const response=await f.run('/api/r2l-link?token='+'b'.repeat(32));assert.equal(response.status,options.status===404?404:503);assert.equal(response.headers.get('Location'),null);assert.equal(f.nextCalls(),0);assert.deepEqual(f.reads,[]);
  }
});
test('freeze blocks account pages/APIs and fences unknown old readers/writers',async()=>{
  for(const mode of [FREEZE_MODE,UNIFIED_MODE]){
    const f=fixture({mode});
    if(mode===FREEZE_MODE){const response=await f.run('/api/read2lead-progress?code=SYNTHETIC');assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'60');assert.equal(f.calls.length,0);}
    for(const key of ['READ2LEAD_CODES','READ2LEAD_PROGRESS'])for(const method of ['get','getWithMetadata','list','put','delete']){
      const response=await f.run('/api/unknown-writer',{next:async env=>{await env[key][method]('arbitrary','value');return new Response('must not happen');}});assert.equal(response.status,503,mode+'/'+method);
    }
    assert.deepEqual(f.reads,[]);
  }
});
test('admin authentication precedes dispatch and untrusted authority headers are replaced',async()=>{
  const f=fixture();const path='/api/admin/codes';
  assert.equal((await f.run(path,{headers:{[VERIFIED_ADMIN_HEADER]:'1'}})).status,401);assert.equal(f.calls.length,0);
  await f.run('/api/read2lead-progress?code=SYNTHETIC',{headers:{[VERIFIED_ADMIN_HEADER]:'1',[ACCOUNT_MODE_HEADER]:'forged',[ACCOUNT_PLAN_HEADER]:'forged'}});
  assert.equal(f.calls[0].request.headers.get(VERIFIED_ADMIN_HEADER),null);assert.equal(f.calls[0].request.headers.get(ACCOUNT_PLAN_HEADER),pin);
  await f.run(path,{headers:{Authorization:'Basic '+btoa('x:local-admin')}});assert.equal(f.calls[1].request.headers.get(VERIFIED_ADMIN_HEADER),'1');
});
test('personal-link shell stays public and clears both old account media cookies',async()=>{
  const f=fixture();const response=await f.run('/r2l/start?token='+'b'.repeat(32),{headers:{cookie:'__Host-r2l_student_test=old; __Host-r2l_account=other'}});
  assert.equal(await response.text(),'public-site');assert.equal(f.calls.length,0);
  const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);assert.ok(cookies.every(value=>value.includes('Max-Age=0')));
});
test('invalid mode and missing rollout pin fail closed',async()=>{
  const f=fixture({mode:'typo'});assert.equal((await f.run('/api/read2lead-progress')).status,503);assert.equal(f.calls.length,0);
  const g=fixture();delete g.env.R2L_ACCOUNT_ROLLOUT_SHA256;assert.equal((await g.run('/api/read2lead-progress')).status,503);assert.equal(g.calls.length,0);
});

test('student hashed scripts and styles use the same pinned account host as their HTML',async()=>{
  const f=fixture(),headers={cookie:'other=value; __Host-r2l_account=synthetic',[VERIFIED_ADMIN_HEADER]:'forged'};
  for(const method of ['GET','HEAD'])for(const path of ['/_astro/lesson.SyntheticHash.js','/_astro/classes.SyntheticHash.css?v=abcdef','/story-retell/sky/storyboard-v1.png']){
    const response=await f.run(path,{method,headers});assert.equal(response.status,200);assert.equal(f.nextCalls(),0);
    assert.equal(f.calls.at(-1).request.method,method);assert.equal(f.calls.at(-1).request.headers.get(VERIFIED_ADMIN_HEADER),null);
  }
  assert.equal(f.calls.length,6);assert.deepEqual(f.reads,[]);
});

test('asset routing never extends cookie authority to public pages, private files or mutations',async()=>{
  for(const [path,headers,method] of [
    ['/_astro/page.js',{},'GET'],['/_astro/page.js',{cookie:'not__Host-r2l_account=synthetic'},'GET'],
    ['/_astro/page.js',{cookie:'__Host-r2l_account=synthetic'},'POST'],
    ['/',{cookie:'__Host-r2l_account=synthetic'},'GET'],['/__private/package.json',{cookie:'__Host-r2l_account=synthetic'},'GET'],
    ['/_astro/config.json',{cookie:'__Host-r2l_account=synthetic'},'GET'],
    ['/story-retell/sky/private.json',{cookie:'__Host-r2l_account=synthetic'},'GET'],
    ['/story-retell/sky/storyboard.png',{cookie:'__Host-r2l_account=synthetic'},'POST'],
    ['/story-retell/sky/storyboard.png',{},'GET'],
  ]){const f=fixture();assert.equal(await(await f.run(path,{headers,method})).text(),'public-site');assert.equal(f.calls.length,0);}
  for(const status of [401,404]){
    const f=fixture({status}),response=await f.run('/_astro/new-public.js',{headers:{cookie:'__Host-r2l_account=stale'}});
    assert.equal(await response.text(),'public-site');assert.equal(f.calls.length,1);assert.equal(f.nextCalls(),1);assert.deepEqual(f.reads,[]);
    await f.run('/api/read2lead-progress',{headers:{cookie:'__Host-r2l_account=stale'}});assert.equal(f.nextCalls(),1);
  }
  for(const options of [{status:503},{headers:{[ACCOUNT_PLAN_HEADER]:'f'.repeat(64)}},{status:302,headers:{Location:'/legacy'}}]){
    const f=fixture(options);assert.equal((await f.run('/_astro/page.js',{headers:{cookie:'__Host-r2l_account=synthetic'}})).status,503);assert.equal(f.nextCalls(),0);
  }
});


test('frozen ordinary pages show a readable pause without account details or live access',async()=>{
  for(const path of ['/read2lead/?code=PRIVATE-DIAGNOSTIC','/read2lead/lesson?token=PRIVATE-DIAGNOSTIC','/ho-so']){
    const f=fixture({mode:FREEZE_MODE}),response=await f.run(path,{headers:{accept:'text/html'}}),body=await response.text();
    assert.equal(response.status,503);assert.match(response.headers.get('Content-Type'),/^text\/html/);
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Retry-After'),'60');
    assert.match(body,/data-read2lead-state="account_temporarily_paused"/);assert.match(body,/<html lang="vi"/);
    assert.match(body,/name="viewport"/);assert.match(body,/Thử lại/);assert.equal((body.match(/<a /g)||[]).length,1);
    assert.doesNotMatch(body,/PRIVATE-DIAGNOSTIC|<script|https?:\/\//);assert.equal(f.calls.length,0);assert.equal(f.nextCalls(),0);assert.deepEqual(f.reads,[]);
    assert.throws(()=>f.env.READ2LEAD_CODES.put('key','value'),/legacy_account_fenced/);
  }
});
test('frozen page HEAD has the same status and headers without a body',async()=>{
  const f=fixture({mode:FREEZE_MODE}),response=await f.run('/read2lead/',{method:'HEAD',headers:{accept:'text/html'}});
  assert.equal(response.status,503);assert.match(response.headers.get('Content-Type'),/^text\/html/);assert.equal(await response.text(),'');assert.equal(f.calls.length,0);assert.equal(f.nextCalls(),0);
});
test('frozen APIs and page mutations retain JSON errors and never dispatch',async()=>{
  for(const [path,method] of [['/api/read2lead-progress','GET'],['/api/generate-read2lead-pack','POST'],['/read2lead/','POST'],['/read2lead/','DELETE']]){
    const f=fixture({mode:FREEZE_MODE}),response=await f.run(path,{method,headers:{accept:'text/html'}});
    assert.equal(response.status,503);assert.match(response.headers.get('Content-Type'),/^application\/json/);assert.deepEqual(await response.json(),{code:'account_temporarily_paused'});
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(f.calls.length,0);assert.equal(f.nextCalls(),0);assert.deepEqual(f.reads,[]);
  }
});
