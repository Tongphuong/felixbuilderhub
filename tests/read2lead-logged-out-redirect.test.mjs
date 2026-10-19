// R2L-FINAL: a logged-out visitor opening a student PAGE (a shared link) is sent to the public
// page with sign-up (303 /read2lead/) instead of a bare English 401. APIs, non-GET/HEAD methods
// and admin paths keep their 401. The public page itself must never redirect (no loop).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPreviewApp} from '../cloudflare/read2lead-private-preview/app.mjs';

function makeApp(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const store={db,transaction:fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const accountRuntime={authenticate:async()=>null,apiFor:async()=>async()=>new Response('api',{status:200})};
  return createPreviewApp({store,assets:{fetch:async()=>new Response('{}')},packageSha256:'a'.repeat(64),accountRuntime});
}
const get=(path,method='GET')=>new Request('https://r2l.test'+path,{method});

test('BITE: logged-out GET of a student page -> 303 /read2lead/ (old code: 401 Student access required)', async t => {
  const app=makeApp(t);
  for (const path of ['/read2lead/library','/read2lead/library/','/read2lead/gifts/','/read2lead/shop/','/read2lead/leaderboard/','/read2lead/lesson/?code=X']) {
    const r=await app(get(path));
    assert.equal(r.status,303,path);
    assert.equal(r.headers.get('location'),'/read2lead/',path);
  }
  const head=await app(get('/read2lead/library/','HEAD'));
  assert.equal(head.status,303);
  assert.equal(head.headers.get('location'),'/read2lead/');
});

test('logged-out API requests keep their 401', async t => {
  const app=makeApp(t);
  for (const path of ['/api/read2lead-progress','/api/read2lead-library','/api/signup']) {
    const r=await app(get(path));
    assert.equal(r.status,401,path);
    assert.equal(r.headers.get('location'),null);
  }
});

test('logged-out POST (even to a page path) keeps its 401', async t => {
  const app=makeApp(t);
  const r=await app(get('/read2lead/library/','POST'));
  assert.equal(r.status,401);
  assert.equal(r.headers.get('location'),null);
});

test('admin and private paths are never redirected', async t => {
  const app=makeApp(t);
  for (const path of ['/admin','/admin/codes','/api/admin/codes','/__private/package.json']) {
    const r=await app(get(path));
    assert.equal(r.status,401,path);
    assert.equal(r.headers.get('location'),null,path);
  }
});

test('the public page itself never redirects to itself (no loop)', async t => {
  const app=makeApp(t);
  for (const path of ['/read2lead/','/read2lead']) {
    const r=await app(get(path));
    assert.notEqual(r.headers.get('location'),'/read2lead/',path);
    assert.notEqual(r.status,303,path);
  }
});
