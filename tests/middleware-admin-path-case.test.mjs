// Pages matches paths case-insensitively, so the admin Basic Auth gate must too (live finding 2026-10-19:
// GET /Api/admin/classes skipped auth). Every variant of /admin and /api/admin must demand credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';

const PASSWORD='local-admin';
const run=(path,{auth}={})=>{
  let nextCalls=0;
  return onRequest({env:{ADMIN_PASSWORD:PASSWORD},request:new Request('https://normal.test'+path,{headers:auth?{Authorization:'Basic '+btoa('x:'+PASSWORD)}:{}}),
    next:async()=>{nextCalls++;return new Response('reached-handler');}}).then(response=>({response,nextCalls}));
};

test('BITE: every case/encoding/slash variant of an admin path is 401 without credentials and never reaches the handler',async()=>{
  for(const path of ['/Api/admin/classes','/API/admin/codes','/api/ADMIN/codes','/ADMIN','/Admin/','/admin','/api/%61dmin/codes','/%41dmin/codes','//api/admin/codes','/api//admin/codes','/api/admin/codes','/Admin/index.html']) {
    const {response,nextCalls}=await run(path);
    assert.equal(response.status,401,path);assert.match(response.headers.get('WWW-Authenticate')||'',/Basic/,path);assert.equal(nextCalls,0,path);
  }
});
test('with correct credentials the admin paths (any case) still work',async()=>{
  for(const path of ['/api/admin/codes','/Api/Admin/codes','/admin']) {
    const {response,nextCalls}=await run(path,{auth:true});
    assert.equal(response.status,200,path);assert.equal(await response.text(),'reached-handler');assert.equal(nextCalls,1);
  }
  const wrong=await onRequest({env:{ADMIN_PASSWORD:PASSWORD},request:new Request('https://normal.test/Api/admin/codes',{headers:{Authorization:'Basic '+btoa('x:wrong')}}),next:async()=>new Response('no')});
  assert.equal(wrong.status,401);
});
test('non-admin paths are unaffected, including look-alikes and malformed escapes',async()=>{
  for(const path of ['/','/read2lead-info','/about','/api/signup-info','/%zz','/%E0%A4%A']) {
    const {response,nextCalls}=await run(path);
    assert.notEqual(response.status,401,path);assert.equal(nextCalls,1,path);
  }
});
