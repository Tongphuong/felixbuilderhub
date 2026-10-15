import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceGateway} from '../functions/lib/read2lead/maintenance-gateway.mjs';
import {onRequest} from '../functions/_middleware.js';

const cookie='__Host-r2l_preview='+'a'.repeat(64);
const request=(path,headers={},method='GET')=>new Request('https://felixbuilderhub.com'+path,{method,headers});
function backend(status=200) {
  const calls=[];
  const env={R2L_MAINTENANCE_STATE:{idFromName:name=>{assert.equal(name,'private-adult-preview-v1');return 'id';},
    get:id=>({fetch:async r=>{assert.equal(id,'id');calls.push(r);return new Response('test runtime',{status});}})}};
  return {env,calls};
}
test('ordinary visitors including a supplied adult code never enter the test runtime',async()=>{
  const b=backend();
  for(const path of ['/','/read2lead/?code=R2L-ADULT-PRIVATE-QA','/api/read2lead-progress','/_astro/app.js'])
    assert.equal(await maintenanceGateway(request(path),b.env),null);
  assert.equal(b.calls.length,0);
});
test('login and cookie requests preserve original origin, headers, method and body',async()=>{
  const b=backend();
  const r=new Request('https://felixbuilderhub.com/private-rehearsal/login',{method:'POST',headers:{Origin:'https://felixbuilderhub.com'},body:'test'});
  assert.equal((await maintenanceGateway(r,b.env)).status,200);
  assert.equal(b.calls[0],r);assert.equal(await b.calls[0].text(),'test');
  const api=request('/api/read2lead-story-session',{Cookie:cookie});
  assert.equal((await maintenanceGateway(api,b.env)).status,200);assert.equal(b.calls[1],api);
});
test('admin routes cannot be forwarded, even with a valid-looking test cookie',async()=>{
  const b=backend();
  for(const path of ['/admin','/admin/students','/api/admin/students']) {
    assert.equal(await maintenanceGateway(request(path,{Cookie:cookie}),b.env),null);
    const res=await onRequest({request:request(path,{Cookie:cookie}),env:{...b.env,ADMIN_PASSWORD:'test'},next:()=>{throw Error('auth bypass');}});
    assert.equal(res.status,401);
  }
  assert.equal(b.calls.length,0);
});
test('missing or unavailable binding fails closed for test requests only',async()=>{
  assert.equal(await maintenanceGateway(request('/'),{}),null);
  assert.equal((await maintenanceGateway(request('/private-rehearsal/login'),{})).status,503);
  const b=backend();b.env.R2L_MAINTENANCE_STATE.get=()=>{throw Error('offline');};
  assert.equal((await maintenanceGateway(request('/read2lead/',{Cookie:cookie}),b.env)).status,503);
});
test('expired and malformed tokens stay in the authenticated backend, never fall through to real data',async()=>{
  const b=backend(401);
  for(const value of [cookie,'__Host-r2l_preview=forged']) {
    const res=await maintenanceGateway(request('/api/read2lead-progress',{Cookie:value}),b.env);
    assert.equal(res.status,401);
  }
});
test('only missing public GET/HEAD assets may fall through; API/private/mutation failures never do',async()=>{
  const b=backend(404);
  for(const path of ['/','/_astro/older.js'])assert.equal(await maintenanceGateway(request(path,{Cookie:cookie}),b.env),null);
  for(const path of ['/api/read2lead-progress','/__private/package.json','/private-rehearsal/login'])
    assert.equal((await maintenanceGateway(request(path,{Cookie:cookie}),b.env)).status,404);
  assert.equal((await maintenanceGateway(request('/unknown',{Cookie:cookie},'POST'),b.env)).status,404);
});
