import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorApi, EditorClient, EditorError } from '../src/lib/read2lead/self-learn/editor-client.mjs';
const access = { role: 'editor', editor_id: 'synthetic-editor-qa', csrf: 'a'.repeat(64) };
const key = 'r2l-editor-local:' + access.editor_id;
const lesson = { id: 'synthetic-story', title_en: 'Synthetic story' };
const draft = { text: '{ an unfinished edit', lesson_id: lesson.id, expected_revision: 1 };
const response = (value, status = 200, type = 'application/json') => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': type } });
function view(rev = 2) { return { document: { lesson_id: lesson.id, revision: rev }, lesson: structuredClone(lesson), revisions: [], reviews: [], blocks: [] }; }
function receipt(rev = 2, latest = rev) { return { ok: true, replayed: false, document: view(rev).document, current_view: view(latest) }; }
function fixture() {
  const map = new Map(), calls = []; let action = async route => route === 'me' ? structuredClone(access) : route === 'documents' ? { ok: true, documents: [view().document] } : route.startsWith('document?') ? { ok: true, current_view: view() } : receipt();
  const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  const api = { csrf: access.csrf, async request(route, data) { calls.push({ route, data: structuredClone(data) }); return action(route, data); } };
  let serial = 0; const make = () => new EditorClient({ api, storage, access, id: () => 'operation-' + (++serial) });
  return { map, calls, storage, api, make, set(fn) { action = fn; }, client: make() };
}
const refusal = code => error => error.code === code;
test('editor transport uses only its own same-origin prefix, cookie policy and CSRF header', async () => {
  let call; const api = new EditorApi({ fetcher: async (...args) => { call = args; return response({ ok: true }); } }); api.csrf = access.csrf;
  await api.request('draft', { value: 'sample' }); assert.equal(call[0], '/api/read2lead/editor/draft');
  for (const [key, value] of Object.entries({ method: 'POST', credentials: 'same-origin', mode: 'cors', redirect: 'error', cache: 'no-store' })) assert.equal(call[1][key], value);
  assert.equal(call[1].headers['X-R2L-Editor-CSRF'], access.csrf); assert.ok(!('X-R2L-CSRF' in call[1].headers)); assert.equal(call[1].body, '{"value":"sample"}');
  await api.request('templates'); assert.equal(call[1].method, 'GET'); assert.equal(call[1].body, undefined);
});
test('transport rejects route injection, wrong methods, non-JSON and excessive request size', async () => {
  let count = 0; const api = new EditorApi({ fetcher: async () => { count++; return response({ ok: true }, 200, 'text/html'); } });
  for (const [route,data] of [['https://elsewhere.test',undefined],['../login',{}],['document?lesson_id=x&role=editor',undefined],['templates',{}],['draft',undefined],['me',{}]]) await assert.rejects(api.request(route,data), refusal('invalid_route'));
  await assert.rejects(api.request('draft',{ text:'x'.repeat(270337) }), refusal('editor_input_limit')); assert.equal(count,0);
  await assert.rejects(api.request('me'), refusal('invalid_response'));
});
test('transport preserves bounded validation issues and never retries a failed request automatically', async () => {
  let count=0; const api=new EditorApi({fetcher:async()=>{count++;return response({ok:false,code:'invalid_editor_integrity',issues:Array.from({length:110},()=> 'bad_quote')},400);}});
  await assert.rejects(api.request('draft',{}),e=>e.status===400&&e.code==='invalid_editor_integrity'&&e.issues.length===100);assert.equal(count,1);
});
test('transport timeout cancels once and reports a recoverable timeout', async () => {
  let count=0;const api=new EditorApi({timeoutMs:10,fetcher:async(_url,options)=>{count++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
  await assert.rejects(api.request('me'),refusal('request_timeout'));assert.equal(count,1);
});
test('client requires editor identity and the current CSRF token before loading local drafts', () => {
  const f=fixture();for(const wrong of [{...access,role:'child'},{...access,editor_id:'bad/id'},{...access,csrf:'wrong'}])assert.throws(()=>new EditorClient({api:f.api,storage:f.storage,access:wrong}),refusal('editor_required'));
});
test('unfinished literal draft text survives reload and returned snapshots cannot mutate storage', () => {
  const f=fixture();f.client.saveDraftText(draft);const local=f.client.draft;local.text='Changed outside';assert.deepEqual(f.make().draft,draft);assert.equal(f.calls.length,0);
  assert.throws(()=>f.client.saveDraftText({...draft,text:'x'.repeat(262145)}),refusal('invalid_editor_draft'));assert.deepEqual(f.client.draft,draft);
});
test('storage failure prevents a mutation from reaching the server and retains the old draft', async () => {
  const f=fixture();f.client.saveDraftText(draft);f.storage.setItem=()=>{throw Error('quota');};
  await assert.rejects(f.client.submit('draft',{expected_revision:1,lesson}),refusal('storage_unavailable'));assert.equal(f.calls.length,0);assert.deepEqual(f.client.draft,draft);assert.equal(f.client.pending,null);
});
test('lost committed response reloads and retries the exact operation while returning the latest document separately', async () => {
  const f=fixture();f.client.saveDraftText(draft);let saved;
  f.set(async(route,data)=>{if(route==='me')return access;saved=structuredClone(data);throw new EditorError('connection_lost');});
  await assert.rejects(f.client.submit('draft',{expected_revision:1,lesson}),refusal('connection_lost'));const pending=f.client.pending;assert.equal(pending.data.request_id,'operation-1');assert.deepEqual(saved,pending.data,'The first wire request must match the durable pending operation exactly.');
  const restored=f.make();assert.deepEqual(restored.pending,pending);f.set(async(route,data)=>{if(route==='me')return access;assert.deepEqual(data,saved);return {...receipt(2,9),replayed:true};});
  const result=await restored.retry();assert.equal(result.document.revision,2);assert.equal(result.current_view.document.revision,9);assert.equal(restored.pending,null);assert.deepEqual(restored.draft,draft);assert.equal(f.make().pending,null);
});
for(const status of [401,403,409,429,500])test('uncertain or conflicting status '+status+' retains exact pending operation and draft',async()=>{
 const f=fixture();f.client.saveDraftText(draft);f.set(async route=>{if(route==='me')return access;throw new EditorError('synthetic_refusal',status);});
 await assert.rejects(f.client.submit('request-review',{lesson_id:lesson.id,expected_revision:1}),refusal('synthetic_refusal'));assert.ok(f.client.pending);assert.deepEqual(f.make().draft,draft);
});
test('definite validation refusal clears only pending operation so invalid draft remains editable', async()=>{
 const f=fixture();f.client.saveDraftText(draft);f.set(async route=>{if(route==='me')return access;throw new EditorError('invalid_editor_draft',400,['missing_story']);});
 await assert.rejects(f.client.submit('draft',{expected_revision:1,lesson}),e=>e.issues[0]==='missing_story');assert.equal(f.client.pending,null);assert.deepEqual(f.client.draft,draft);
 f.client.saveDraftText({...draft,text:'Corrected text'});assert.equal(f.client.draft.text,'Corrected text');
});
test('changed editor or token cannot send a pending write under a different session', async()=>{
 for(const tokenChanged of [false,true]){const f=fixture();f.set(async()=>({...access,...(tokenChanged?{}:{editor_id:'synthetic-other'})}));if(tokenChanged)f.api.csrf='b'.repeat(64);
 await assert.rejects(f.client.submit('publish-qa',{lesson_id:lesson.id,expected_revision:3}),refusal(tokenChanged?'csrf_failed':'editor_required'));assert.ok(f.client.pending);assert.ok(f.calls.every(c=>c.route==='me'));}
});
test('late successful write after deactivation never clears recovery storage or exposes draft', async()=>{
 const f=fixture();f.client.saveDraftText(draft);let finish,ready;const started=new Promise(r=>ready=r);
 f.set(async route=>route==='me'?access:new Promise(r=>{finish=r;ready();}));const pending=f.client.submit('draft',{expected_revision:1,lesson});await started;const before=f.map.get(key);f.client.deactivate();finish(receipt());
 await assert.rejects(pending,refusal('editor_scope_expired'));assert.equal(f.map.get(key),before);assert.equal(f.client.draft,null);assert.equal(f.client.pending,null);assert.ok(f.make().pending);
});
test('late private read after deactivation is refused', async()=>{
 const f=fixture();let finish,ready;const started=new Promise(r=>ready=r);f.set(async route=>route==='me'?access:new Promise(r=>{finish=r;ready();}));const pending=f.client.read('document?lesson_id='+lesson.id);await started;f.client.deactivate();finish({ok:true,current_view:view()});await assert.rejects(pending,refusal('editor_scope_expired'));
});
test('concurrent action and typing cannot change an in-flight pending operation', async()=>{
 const f=fixture();let finish,ready;const started=new Promise(r=>ready=r);f.set(async route=>route==='me'?access:new Promise(r=>{finish=r;ready();}));const first=f.client.submit('draft',{expected_revision:1,lesson});await started;
 await assert.rejects(f.client.retry(),refusal('operation_busy'));await assert.rejects(f.client.read('documents'),refusal('operation_busy'));assert.throws(()=>f.client.saveDraftText(draft),refusal('operation_busy'));finish(receipt());await first;assert.equal(f.calls.filter(c=>c.route==='draft').length,1);
});
test('changed storage is never overwritten before write or after a late acknowledgement', async()=>{
 const f=fixture();f.map.set(key,'newer storage');await assert.rejects(f.client.submit('draft',{expected_revision:1,lesson}),refusal('editor_storage_changed'));assert.equal(f.calls.length,0);
 const g=fixture();g.set(async route=>{if(route==='me')return access;g.map.set(key,'newer storage');return receipt();});await assert.rejects(g.client.submit('draft',{expected_revision:1,lesson}),refusal('editor_storage_changed'));assert.equal(g.map.get(key),'newer storage');
});
test('wrong-document acknowledgement retains pending operation', async()=>{
 const f=fixture();f.set(async route=>route==='me'?access:{...receipt(),document:{lesson_id:'another',revision:2}});await assert.rejects(f.client.submit('draft',{expected_revision:1,lesson}),refusal('invalid_response'));assert.ok(f.client.pending);
});
test('discard requires reconciliation and rechecks current server state while preserving draft', async()=>{
 const f=fixture();f.client.saveDraftText(draft);f.set(async route=>{if(route==='me')return access;throw new EditorError('stale_revision',409);});await assert.rejects(f.client.submit('draft',{expected_revision:1,lesson}));
 await assert.rejects(f.client.discardPending(),refusal('editor_reconcile_required'));
 let reads=0;f.set(async route=>route==='me'?access:route==='documents'?{ok:true,documents:[view(7).document]}:(reads++,{ok:true,current_view:view(7)}));
 const result=await f.client.reconcile();assert.equal(result.current_view.document.revision,7);await f.client.discardPending();assert.equal(reads,2);assert.equal(f.client.pending,null);assert.deepEqual(f.client.draft,draft);
});
test('corrupt or wrong-editor storage is retained until explicit online recovery', async()=>{
 for(const raw of ['{',JSON.stringify({format:1,editor_id:'synthetic-other',draft,pending:null}),JSON.stringify({format:1,editor_id:access.editor_id,draft,pending:{route:'logout',data:{request_id:'x',expected_revision:0}}})]){
 const f=fixture();f.map.set(key,raw);const c=f.make();assert.equal(c.storageInvalid,true);assert.throws(()=>c.saveDraftText(draft),refusal('editor_storage_invalid'));assert.equal(f.map.get(key),raw);await c.reconcile();await c.discardPending();assert.equal(c.storageInvalid,false);assert.equal(f.map.has(key),false);
 }
});
test('current document never regresses when a lower revision response arrives later', async()=>{
 const f=fixture();let version=9;f.set(async route=>route==='me'?access:{ok:true,current_view:view(version)});assert.equal((await f.client.read('document?lesson_id='+lesson.id)).current_view.document.revision,9);version=2;assert.equal((await f.client.read('document?lesson_id='+lesson.id)).current_view.document.revision,9);
});
