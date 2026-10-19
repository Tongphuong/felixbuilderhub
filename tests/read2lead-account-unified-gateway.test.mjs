import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { UNIFIED_MODE, FREEZE_MODE, ACCOUNT_MODE_HEADER, ACCOUNT_PLAN_HEADER, isUnifiedAccountPath } from '../functions/lib/read2lead/account-unified-gateway.mjs';
import { EXISTING_TEST_OBJECT, VERIFIED_ADMIN_HEADER } from '../functions/lib/read2lead/account-gateway.mjs';
import { ACCOUNT_ROUTES } from '../functions/lib/read2lead/account-routes.mjs';
import { verifyTurnstileMarker } from '../functions/api/signup.js';

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

const BARE=['/read2lead','/read2lead/','/read2lead/?from=speaking','/read2lead/?done=1','/ho-so','/ho-so/'];
test('E1: no reader session + bare entry address gets the public shell (200), never the account host or a 401',async()=>{
  for(const method of ['GET','HEAD'])for(const path of BARE) {
    const f=fixture({status:401});const r=await f.run(path,{method});
    assert.equal(r.status,200,path);if(method==='GET')assert.equal(await r.text(),'public-site');
    assert.equal(f.calls.length,0,path);assert.equal(f.nextCalls(),1);assert.equal(r.headers.getSetCookie().length,0);assert.deepEqual(f.reads,[]);
  }
});
test('E1: personal-link shell /r2l/start/ (no token) is public too and clears old cookies',async()=>{
  const f=fixture({status:401});const r=await f.run('/r2l/start/',{headers:{cookie:'__Host-r2l_account=OLD'}});
  assert.equal(r.status,200);assert.equal(f.calls.length,0);assert.equal(r.headers.getSetCookie().length,2);
});
test('E3: bare entry address WITH a reader cookie still goes to the account host and keeps the cookie',async()=>{
  for(const path of BARE) {
    const f=fixture();const r=await f.run(path,{headers:{cookie:'other=1; __Host-r2l_account='+'c'.repeat(64)}});
    assert.equal(r.status,200,path);assert.equal(await r.text(),'account-host');assert.equal(f.calls.length,1);assert.equal(f.nextCalls(),0);
    assert.equal(r.headers.getSetCookie().length,0,'a valid session is never cleared on entry');
  }
});
test('stale or unknown reader cookie on the bare address falls back to the public shell and drops the dead cookie',async()=>{
  for(const path of BARE) {
    const f=fixture({status:401});const r=await f.run(path,{headers:{cookie:'__Host-r2l_account=OLD'}});
    assert.equal(r.status,200,path);assert.equal(await r.text(),'public-site');assert.equal(f.calls.length,1);
    const cookies=r.headers.getSetCookie();assert.equal(cookies.length,2);assert.ok(cookies.every(value=>/Max-Age=0/.test(value)));
  }
  const f=fixture({status:500});const r=await f.run('/read2lead/',{headers:{cookie:'__Host-r2l_account=OLD'}});
  assert.equal(r.status,500,'only 401 falls back; a host failure is never hidden');assert.equal(f.nextCalls(),0);
});
test('E2: an explicit code or access_code always goes to the account host (no public fallback, no remembered student)',async()=>{
  for(const path of ['/read2lead?code=OTHER','/read2lead/?code=OTHER','/read2lead/?access_code=OTHER','/ho-so?code=OTHER','/ho-so/?access_code=OTHER'])for(const cookie of [undefined,'__Host-r2l_account=OLD']) {
    const f=fixture({status:401});const r=await f.run(path,{headers:cookie?{cookie}:{}});
    assert.equal(r.status,401,path);assert.equal(f.calls.length,1);assert.equal(f.nextCalls(),0);assert.equal(r.headers.getSetCookie().length,0);
  }
});
test('E5: only the exact bare entry GET/HEAD is public; every other page, API, media and method stays protected',async()=>{
  // Logged-out PAGE requests (R2L-FINAL): GET/HEAD -> 303 to the public page, never the account host's bare 401.
  for(const method of ['GET','HEAD'])for(const path of ['/read2lead/lesson','/read2lead/companion','/read2lead/leaderboard','/read2lead/gifts','/read2lead/library','/read2lead/shop','/read2lead/index.html','/read2lead//','/read2lead/extra','/ho-so/extra']) {
    const f=fixture({status:401});const r=await f.run(path,{method});
    assert.equal(r.status,303,method+path);assert.equal(r.headers.get('Location'),'/read2lead/',method+path);assert.equal(f.nextCalls(),0,path);assert.equal(f.calls.length,1,path);
  }
  const paths=['/api/read2lead-progress','/api/read2lead-progress?code=','/api/read2lead-leaderboard','/api/read2lead-story-media/private','/api/read2lead-story-session','/api/parent/anything','/api/r2l-link'];
  for(const path of paths) {
    const f=fixture({status:401});const r=await f.run(path);
    assert.equal(r.status,401,path);assert.equal(f.nextCalls(),0,path);assert.equal(f.calls.length,1,path);
  }
  for(const method of ['POST','PUT','DELETE'])for(const path of ['/read2lead/','/ho-so']) {
    const f=fixture({status:401});const r=await f.run(path,{method,headers:{origin:'https://normal.test'}});
    assert.equal(r.status,401,method+path);assert.equal(f.nextCalls(),0);assert.equal(f.calls.length,1);
  }
  const f=fixture({mode:FREEZE_MODE});const r=await f.run('/read2lead/');
  assert.equal(r.status,503,'freeze still pauses the bare address');assert.equal(f.calls.length,0);assert.equal(f.nextCalls(),0);
});
test('reset clears both cookies idempotently without any backend or storage operation',async()=>{
  for(const mode of [UNIFIED_MODE,FREEZE_MODE,null]) {
    const f=fixture({mode,backend:false});
    for(let i=0;i<2;i++) {
      const r=await f.run('/api/read2lead-session-reset',{method:'POST',headers:{origin:'https://normal.test',cookie:'__Host-r2l_account=OLD; other=keep'}});
      assert.equal(r.status,204);assert.equal(r.headers.get('cache-control'),'no-store');
      assert.equal(r.headers.getSetCookie().length,2);
      for(const cookie of r.headers.getSetCookie())assert.match(cookie,/HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=0/);
    }
    assert.equal(f.calls.length,0);assert.equal(f.nextCalls(),0);assert.deepEqual(f.reads,[]);
  }
});
test('reset rejects unsafe origins and methods without changing cookies',async()=>{
  const f=fixture();
  for(const options of [{method:'GET'},{method:'POST'},{method:'POST',headers:{origin:'https://other.test'}},{method:'POST',headers:{origin:'https://normal.test','sec-fetch-site':'cross-site'}}]) {
    const r=await f.run('/api/read2lead-session-reset',options);assert.ok([403,405].includes(r.status));assert.equal(r.headers.getSetCookie().length,0);
  }
  assert.equal(f.calls.length,0);assert.deepEqual(f.reads,[]);
});
test('E4: reset expires the reader cookies by the exact name/path the Worker sets them with (no Domain)',async()=>{
  const { ACCOUNT_COOKIE } = await import('../cloudflare/read2lead-private-preview/unified-account-app.mjs');
  const { TEST_ACCOUNT_COOKIE } = await import('../cloudflare/read2lead-private-preview/account-app.mjs');
  const f=fixture();const r=await f.run('/api/read2lead-session-reset',{method:'POST',headers:{origin:'https://normal.test',cookie:ACCOUNT_COOKIE+'=x'}});
  const cookies=r.headers.getSetCookie();
  assert.deepEqual(cookies.map(value=>value.split('=')[0]).sort(),[ACCOUNT_COOKIE,TEST_ACCOUNT_COOKIE].sort());
  for(const value of cookies){assert.match(value,/^__Host-[a-z0-9_]+=; HttpOnly; Secure; SameSite=Strict; /);assert.match(value,/Path=\//);assert.match(value,/Max-Age=0/);assert.doesNotMatch(value,/Domain=/i);}
});

// ---- R2L-FINAL: logged-out page requests redirect to the public page --------------------------
test('BITE: logged-out GET of /read2lead/library, /gifts, /shop, /leaderboard -> 303 /read2lead/ (unpatched gateway returned the bare 401)',async()=>{
  for(const path of ['/read2lead/library','/read2lead/library/','/read2lead/gifts/','/read2lead/shop/','/read2lead/leaderboard/']) {
    const f=fixture({status:401});const r=await f.run(path);
    assert.equal(r.status,303,path);assert.equal(r.headers.get('Location'),'/read2lead/',path);assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
});
test('logged-out redirect never fires for /read2lead/ itself (no loop), APIs, admin, private paths or non-GET methods',async()=>{
  for(const path of ['/read2lead','/read2lead/','/ho-so/']) {
    const f=fixture({status:401});const r=await f.run(path);assert.equal(r.status,200,path);assert.equal(r.headers.get('Location'),null,path);
  }
  for(const path of ['/api/read2lead-library','/api/read2lead-progress','/api/read2lead-library-media/x','/api/signup','/__private/package.json']) {
    const f=fixture({status:401});const r=await f.run(path);assert.notEqual(r.status,303,path);assert.equal(r.headers.get('Location'),null,path);
  }
  const g=fixture({status:401});assert.equal((await g.run('/api/admin/codes')).status,401);assert.equal(g.calls.length,0,'admin auth precedes dispatch');
  const h=fixture({status:401});const post=await h.run('/read2lead/library/',{method:'POST',headers:{origin:'https://normal.test'}});
  assert.equal(post.status,401);assert.equal(post.headers.get('Location'),null);
});
test('an explicit code keeps the account host 401 (not silently redirected)',async()=>{
  const f=fixture({status:401});const r=await f.run('/read2lead/library/?code=OTHER');assert.equal(r.status,401);assert.equal(r.headers.get('Location'),null);
});
test('RULE 30: a child with an EXPIRED/unknown session cookie on /read2lead/library gets 303, and following it does not loop',async()=>{
  const cookie='__Host-r2l_account='+'e'.repeat(64);
  const f=fixture({status:401});const first=await f.run('/read2lead/library/',{headers:{cookie}});
  assert.equal(first.status,303);assert.equal(first.headers.get('Location'),'/read2lead/');
  const second=await f.run('/read2lead/',{headers:{cookie}});
  assert.equal(second.status,200,'the public page loads for the dead cookie');assert.equal(await second.text(),'public-site');
  assert.ok(second.headers.getSetCookie().every(v=>/Max-Age=0/.test(v)),'dead cookie is dropped');
});
test('the personal-link entry /r2l/start still loads (200) for a logged-out visitor',async()=>{
  for(const path of ['/r2l/start/','/r2l/start?t='+'b'.repeat(32)]) {const f=fixture({status:401});const r=await f.run(path);assert.equal(r.status,200,path);assert.equal(f.calls.length,0);}
});

// ---- R2L-FINAL: Turnstile for /api/signup is verified in the gateway, OUTSIDE the account lane ----
const SIGNUP_HEADER='x-r2l-turnstile-verified';
async function signupCall(f,{body,token='good',headers={},fetchImpl,secret='sec',rawBody}={}) {
  f.env.TURNSTILE_SECRET_KEY=secret;
  const verifyCalls=[];
  const impl=fetchImpl||(async (url,init)=>{verifyCalls.push({url,form:init.body,signal:init.signal});return new Response(JSON.stringify({success:init.body.get('response')==='good'}));});
  const payload=rawBody!==undefined?rawBody:JSON.stringify(body??{student_name:'Minh',student_age:9,child_gender:'boy',turnstile_token:token});
  const response=await onRequest({env:f.env,fetchImpl:impl,request:new Request('https://normal.test/api/signup',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://normal.test','CF-Connecting-IP':'3.3.3.3',...headers},body:payload}),next:async()=>new Response('public-site')});
  return {response,verifyCalls,json:await response.clone().json().catch(()=>null)};
}
test('BITE: a junk Turnstile token is refused in the gateway and NEVER reaches the account object',async()=>{
  const f=fixture();const {response,json}=await signupCall(f,{token:'junk'});
  assert.equal(response.status,403);assert.equal(json.error,'turnstile_failed');assert.match(json.message,/[^\x00-\x7F]/);
  assert.equal(f.calls.length,0,'account dispatch must not be entered');
});
test('a forged x-r2l-turnstile-verified header from the client is stripped: a junk token is still refused',async()=>{
  const f=fixture();const {response,json}=await signupCall(f,{token:'junk',headers:{[SIGNUP_HEADER]:'1'}});
  assert.equal(response.status,403);assert.equal(json.error,'turnstile_failed');assert.equal(f.calls.length,0);
});
test('the forged header is stripped on EVERY request, including other account routes',async()=>{
  const f=fixture();await f.run('/api/read2lead-progress?code=SYNTHETIC',{headers:{[SIGNUP_HEADER]:'1'}});
  await f.run('/read2lead/library/',{headers:{[SIGNUP_HEADER]:'1'}});
  assert.equal(f.calls.length,2);for(const {request} of f.calls)assert.equal(request.headers.get(SIGNUP_HEADER),null);
});
test('a valid token is verified exactly once, with a timeout signal, then forwarded with the gateway marker',async()=>{
  const f=fixture();const {response,verifyCalls}=await signupCall(f,{token:'good'});
  assert.equal(response.status,200);assert.equal(verifyCalls.length,1);assert.ok(verifyCalls[0].signal,'siteverify must carry an abort/timeout signal');
  assert.equal(verifyCalls[0].form.get('remoteip'),'3.3.3.3');assert.equal(verifyCalls[0].form.get('secret'),'sec');
  assert.equal(f.calls.length,1);assert.equal(await verifyTurnstileMarker('sec',f.calls[0].request.headers.get(SIGNUP_HEADER)),true,'a signed, short-lived marker is forwarded');
  assert.equal(JSON.parse(f.calls[0].body).student_name,'Minh','the body still reaches the account object intact');
});
test('a timed-out or failing siteverify fails CLOSED without entering the account object',async()=>{
  for(const fetchImpl of [async()=>{throw new DOMException('timed out','TimeoutError');},async()=>new Response('nope',{status:500}),()=>new Promise((_,rej)=>setTimeout(()=>rej(new Error('aborted')),5))]) {
    const f=fixture();const {response,json}=await signupCall(f,{fetchImpl});
    assert.equal(response.status,403);assert.equal(json.error,'turnstile_failed');assert.equal(f.calls.length,0);
  }
});
test('missing secret, missing token, bad JSON and oversized token are refused in the gateway with the Vietnamese shapes',async()=>{
  const cases=[[{secret:''},503,'turnstile_not_configured'],[{body:{student_name:'Minh'}},400,'turnstile_required'],[{rawBody:'{nope'},400,'invalid_json'],[{token:'x'.repeat(2049)},403,'turnstile_failed']];
  for(const [opts,status,error] of cases) {
    const f=fixture();const {response,json,verifyCalls}=await signupCall(f,opts);
    assert.equal(response.status,status,error);assert.equal(json.error,error);assert.match(json.message,/[^\x00-\x7F]/);
    assert.equal(f.calls.length,0,error);assert.equal(verifyCalls.length,0,'no siteverify call for a malformed request: '+error);
  }
});
test('GET /api/signup and other API calls are not Turnstile-gated by the gateway',async()=>{
  const f=fixture();const r=await f.run('/api/read2lead-progress?code=SYNTHETIC');assert.equal(r.status,200);assert.equal(f.calls[0].request.headers.get(SIGNUP_HEADER),null);
});
