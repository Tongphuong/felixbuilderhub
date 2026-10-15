import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LibraryClient } from '../src/lib/read2lead/self-learn/library-client.mjs';
import { ApiClient, ApiError } from '../src/lib/read2lead/self-learn/api-client.mjs';
import { renderPlayer } from '../src/lib/read2lead/self-learn/player-views.mjs';
const childId = 'synthetic-an', route = 'library/favorite';
const lesson = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/level-lessons.json', import.meta.url))).lessons[2];
const favorite = { expected_revision: 0, lesson_id: lesson.id, favorite: true };
const storage = () => { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,value), removeItem: key => map.delete(key) }; };
const library = (revision = 1) => ({ child_id: childId, level: 'L2', preferences: { revision, interest_ids: ['together'] }, groups: [], favorites: [], suggestions: [], reading_history: [] });
const view = (revision = 0) => ({ reading: { reading_id: 'reading-one', child_id: childId, lesson_id: lesson.id, content_sha256: 'a'.repeat(64), revision, sentence_id: 's1' }, lesson });
function fake(perform) {
  const seen = [], api = { csrf: 'csrf', child: childId, async request(route,data) {
    if (route === 'me') return { csrf: this.csrf, active_child_id: this.child };
    seen.push({ route, data: structuredClone(data) });
    return perform ? perform(route,data) : { ok: true, replayed: false, library: library() };
  } }; return { api, seen };
}
test('uncertain library request survives reload and retries exact IDs and body once', async () => {
  const s = storage(), seen = []; let fail = true;
  const f = fake(async(r,d) => { seen.push({r,d}); if(fail)throw new ApiError('connection_lost'); return {ok:true,replayed:true,library:library()}; });
  const c = new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-original'}), data = {...favorite};
  await assert.rejects(c.submit(route,data),/connection_lost/); data.favorite=false;
  assert.equal(c.pending.data.favorite,true); assert.equal(s.map.size,1);
  await assert.rejects(c.submit(route,favorite),/library_pending/); c.deactivate();
  const restored = new LibraryClient({api:f.api,storage:s,childId,id:()=> 'must-not-use'}); fail=false;
  assert.equal((await restored.retry()).replayed,true); assert.deepEqual(seen[1],seen[0]); assert.equal(s.map.size,0); assert.equal(restored.pending,null);
});
test('library storage permits only bounded route-specific fields, with no names, credentials or freeform text', async () => {
  const s=storage(),f=fake(),c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-valid'});
  for(const extra of [{parent_secret:'SECRET'},{display_name:'NAME'},{text:'PRIVATE_TEXT'},{request_id:'caller'},{child_id:'synthetic-binh'},{favorite:'yes'},{expected_revision:-1}]) await assert.rejects(c.submit(route,{...favorite,...extra}),/invalid_request/);
  await assert.rejects(c.submit('https://elsewhere.invalid',favorite),/invalid_request/);
  await assert.rejects(c.submit('library/interests',{expected_revision:0,interest_ids:['a','b','c','d']}),/invalid_request/);
  assert.equal(s.map.size,0); assert.equal(f.seen.length,0);
});
test('valid reformatted pending JSON can be retried or explicitly discarded using its original stored bytes', async () => {
  const data={request_id:'library-reformatted',child_id:childId,...favorite};
  const raw=JSON.stringify({data,route,format:1},null,2)+'\n';
  for(const action of ['retry','discard']) {
    const s=storage(),f=fake();s.setItem('r2l-library-pending:'+childId,raw);
    const c=new LibraryClient({api:f.api,storage:s,childId,id:()=>{throw Error('must preserve original ID');}});
    assert.equal(c.storageInvalid,false);assert.deepEqual(c.pending.data,data);
    if(action==='retry') { await c.retry();assert.deepEqual(f.seen,[{route,data}]); }
    else { await assert.rejects(c.discard(),/library_reconcile_required/);await c.refresh();await c.discard();assert.equal(f.seen.filter(r=>r.route===route).length,0); }
    assert.equal(s.getItem(c.key),null);assert.equal(c.pending,null);
  }
});
test('unavailable storage refuses writes and malformed storage is preserved without exposing its payload', async () => {
  const f=fake(),denied={getItem(){return null;},setItem(){throw Error('quota');},removeItem(){}};
  const c=new LibraryClient({api:f.api,storage:denied,childId,id:()=> 'library-quota'});
  await assert.rejects(c.submit(route,favorite),/storage_unavailable/); assert.equal(f.seen.length,0);
  assert.throws(()=>new LibraryClient({api:f.api,childId}),/storage_unavailable/);
  for(const raw of ['{',JSON.stringify({format:1,route,data:{...favorite,request_id:'id',child_id:'synthetic-binh'}}),JSON.stringify({format:1,route,data:{...favorite,request_id:'id',child_id:childId,parent_secret:'SECRET'}})]) {
    const s=storage();s.setItem('r2l-library-pending:'+childId,raw);const broken=new LibraryClient({api:f.api,storage:s,childId});assert.equal(broken.storageInvalid,true);assert.equal(broken.pending,null);assert.equal(broken.reconciled,false);
    await assert.rejects(broken.submit(route,favorite),/library_storage_invalid/);await assert.rejects(broken.retry(),/library_storage_invalid/);assert.equal(s.map.size,1);assert.equal(s.getItem(broken.key),raw);
  }
});
test('malformed storage can only be explicitly cleared after live reconciliation with the original record unchanged', async () => {
  const s=storage(),f=fake(),raw='{BROKEN_PRIVATE_RECORD';s.setItem('r2l-library-pending:'+childId,raw);
  const c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-after-recovery'});
  await assert.rejects(c.discard(),/library_reconcile_required/);await c.refresh();assert.equal(c.reconciled,true);assert.equal(c.library.child_id,childId);
  s.setItem(c.key,'NEWER_PENDING_RECORD');await assert.rejects(c.discard(),/library_pending_changed/);assert.equal(s.getItem(c.key),'NEWER_PENDING_RECORD');assert.equal(c.storageInvalid,true);
  s.setItem(c.key,raw);f.api.child=null;await assert.rejects(c.discard(),/child_access_disabled/);assert.equal(s.getItem(c.key),raw);
  f.api.child=childId;await c.discard();assert.equal(c.storageInvalid,false);assert.equal(c.reconciled,false);assert.equal(s.getItem(c.key),null);
  await c.submit(route,favorite);assert.equal(c.pending,null);assert.equal(f.seen.filter(r=>r.route===route).length,1);
});
test('a new library request cannot overwrite a pending record inserted after the client opened', async () => {
  const s=storage(),f=fake(),c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-collision'});
  s.setItem(c.key,'NEWER_PENDING_RECORD');await assert.rejects(c.submit(route,favorite),/library_pending_changed/);
  assert.equal(s.getItem(c.key),'NEWER_PENDING_RECORD');assert.equal(c.pending,null);assert.equal(f.seen.length,0);
});
test('same-child access is checked before a pending write and again after its response', async () => {
  const s=storage(),f=fake();f.api.child='synthetic-binh';const c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-child'});
  await assert.rejects(c.submit(route,favorite),/wrong_child/);assert.equal(f.seen.length,0);assert.equal(s.map.size,1);
  f.api.child=childId;f.api.request=async(r,d)=>{if(r==='me')return {csrf:'csrf',active_child_id:f.api.child};f.api.child='synthetic-binh';return {ok:true,replayed:true,library:library()};};
  await assert.rejects(c.retry(),/wrong_child/);assert.equal(s.map.size,1);assert.equal(c.library,null);
});
test('navigation rejects late acknowledgements without clearing the next screen pending request', async () => {
  let finish,started;const wait=new Promise(r=>{finish=r;}),begun=new Promise(r=>{started=r;}),s=storage();
  const f=fake(async()=>{started();await wait;return {ok:true,replayed:false,library:library()};});
  const c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-late'}),request=c.submit(route,favorite);await begun;c.deactivate();finish();
  await assert.rejects(request,/library_scope_expired/);assert.equal(c.library,null);assert.equal(s.map.size,1);
});
test('revoked access before or after a response refuses private state and keeps the uncertain request', async () => {
  for (const afterResponse of [false, true]) {
    const s=storage(),f=fake(async()=>{f.api.child=null;return {ok:true,replayed:false,library:library()};});
    if(!afterResponse)f.api.child=null;
    const c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-revoked'});
    await assert.rejects(c.submit(route,favorite),e=>e.code==='child_access_disabled');
    assert.equal(f.seen.length,afterResponse?1:0);assert.equal(c.library,null);assert.equal(c.view,null);assert.ok(c.pending);assert.equal(s.map.size,1);
    await assert.rejects(c.refresh(),e=>e.code==='child_access_disabled');assert.equal(c.reconciled,false);
  }
});
test('double-click, retry and discard cannot overlap a pending send', async () => {
  let finish,started;const wait=new Promise(r=>{finish=r;}),begun=new Promise(r=>{started=r;}),s=storage();
  const f=fake(async()=>{started();await wait;return {ok:true,replayed:false,library:library()};}),c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-double'});
  const request=c.submit(route,favorite);await begun;await assert.rejects(c.submit(route,favorite),/library_pending/);await assert.rejects(c.retry(),/operation_busy/);await assert.rejects(c.discard(),/operation_busy/);finish();await request;assert.equal(f.seen.length,1);
});
test('stale and uncertain requests require a live server check before explicit discard', async () => {
  const s=storage(),f=fake(async(r)=>{if(r==='library')return {ok:true,library:library(3),lessons:[],sessions:[]};throw new ApiError('stale_revision',409);});
  const c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-stale'});
  await assert.rejects(c.submit(route,favorite),/stale_revision/);await assert.rejects(c.discard(),/library_reconcile_required/);
  await c.refresh();assert.equal(c.reconciled,true);await c.discard();assert.equal(c.pending,null);assert.equal(c.library.preferences.revision,3);assert.equal(s.map.size,0);
});
test('validation refusal releases a rejected request; authorization and temporary failure preserve it', async () => {
  for(const [code,status,keep] of [['invalid_request',400,false],['content_unavailable',409,true],['unauthorized',401,true],['child_access_disabled',403,true],['rate_limited',429,true],['temporarily_unavailable',503,true]]){
    const s=storage(),f=fake(async()=>{throw new ApiError(code,status);}),c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-error'});
    await assert.rejects(c.submit(route,favorite),e=>e.code===code);assert.equal(!!c.pending,keep,code);assert.equal(s.map.size,keep?1:0);
  }
});
test('current view rather than original receipt drives a retried reading; older reads never rewind it', async () => {
  const s=storage(),f=fake(async(r)=>r.startsWith('library/reading?')?{ok:true,view:view(1)}:{ok:true,replayed:true,reading:view(0).reading,current_view:view(2),library:library(2)});
  const c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-open'});
  const r=await c.submit('library/open',{lesson_id:lesson.id});assert.equal(r.reading.revision,0);assert.equal(c.view.reading.revision,2);
  await c.openSaved('reading-one');assert.equal(c.view.reading.revision,2);
  f.api.request=async r=>r==='me'?{csrf:'csrf',active_child_id:childId}:{ok:true,library:library(1),lessons:[],sessions:[]};await c.refresh();assert.equal(c.library.preferences.revision,2);
});
test('malformed response and cross-child metadata cannot acknowledge or clear a pending request', async () => {
  for(const bad of [{ok:true,replayed:false},{ok:true,replayed:false,library:{...library(),child_id:'synthetic-binh'}},{ok:true,replayed:false,library:library(),reading:{...view().reading,child_id:'synthetic-binh'},current_view:view()}]){
    const s=storage(),f=fake(async()=>bad),c=new LibraryClient({api:f.api,storage:s,childId,id:()=> 'library-response'});
    await assert.rejects(c.submit('library/open',{lesson_id:lesson.id}),/invalid_response/);assert.equal(s.map.size,1);assert.ok(c.pending);
  }
});
test('late library history cannot rewind a reading when preference revision is unchanged', async () => {
  let historyRevision=2;const s=storage(),f=fake(async()=>({ok:true,library:{...library(),reading_history:[{...view(historyRevision).reading,updated_at:'2026-09-18T12:00:00Z'}]},lessons:[],sessions:[]}));
  const c=new LibraryClient({api:f.api,storage:s,childId});await c.refresh();historyRevision=1;await c.refresh();assert.equal(c.library.reading_history[0].revision,2);
});
test('explicit logout clears only each named child library pending request', async () => {
  const s=storage();s.setItem('r2l-library-pending:'+childId,'request');s.setItem('unrelated','preserve');LibraryClient.clearOnLogout(s,childId);assert.deepEqual([...s.map],[['unrelated','preserve']]);
});
test('library transport allows exact routes and filters but refuses arbitrary or ambiguous queries', async () => {
  const seen=[],api=new ApiClient({fetcher:async(url)=>{seen.push(url);return Response.json({ok:true});}});
  for(const r of ['library','library?level=L2','library?level=L2&interest=together&favorites=1','library?interest=nature&level=L0','library/reading?reading_id=reading-123','library/interests','library/favorite','library/open','library/position'])await api.request(r);
  assert.equal(seen.length,9);
  for(const r of ['library?level=L6','library?level=L2&level=L0','library?interest=unknown','library?favorites=0','library?child_id=synthetic-an','library/open?force=true','library/reading?reading_id=a&child_id=b','library/reading?reading_id=','library%2fopen','//elsewhere.invalid',null])await assert.rejects(api.request(r),/invalid_route/);
});
function renderState(){return {screen:'library',access:{active_child_id:childId,role:'child',children:[{id:childId,label_vi:'An mẫu',level:'L2'}]},libraryClient:{library:library(),view:null,pending:null,reconciled:false},libraryCatalogue:[lesson],libraryLessons:[lesson],librarySessions:[],libraryFilters:{level:'L2',interest:'',favorites:false},lessons:[],sessions:[]};}
test('library renderer escapes story and interest text and states optional self-reported reading honestly',()=>{
  const state=renderState();state.libraryLessons=[{...lesson,title_en:'<img src=x onerror=alert(1)>'}];state.libraryClient.library.groups=[{id:'together',label_vi:'<script>unsafe</script>'}];
  const html=renderPlayer(state);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img src=x|<script>unsafe|correct_index/);assert.match(html,/Đọc tự do/);assert.match(html,/Chọn tối đa 3/);assert.match(html,/Đây chưa phải bằng chứng đã hiểu/);
});
test('free-reader renderer has no questions or microphone, and escapes pinned story text',()=>{
  const state=renderState();state.screen='free-reading';const v=structuredClone(view());v.reading.content_version='1.1.0';v.lesson.story.sentences[0].text_en='<script>unsafe story</script>';state.libraryClient.view=v;
  let html=renderPlayer(state);assert.match(html,/free-position-form/);assert.match(html,/không cộng kim cương/);assert.match(html,/&lt;script&gt;unsafe story/);assert.doesNotMatch(html,/<script>unsafe|data-event="answer"|id="microphone"|correct_index/);
  v.reading.marked_finished=true;html=renderPlayer(state);assert.doesNotMatch(html,/free-position-form/);assert.match(html,/chưa dùng để đánh giá hay lên cấp/);assert.match(html,/Đọc lại từ đầu/);
});
test('signed-out and switched-child renders cannot expose cached library or free-reader state',()=>{
  const state=renderState();state.libraryLessons=[{...lesson,title_en:'PRIVATE_OLD_CHILD'}];state.access=null;assert.doesNotMatch(renderPlayer(state),/PRIVATE_OLD_CHILD/);
  state.access={active_child_id:'synthetic-binh',children:[{id:'synthetic-binh',label_vi:'Bình mẫu',level:'L0'}]};assert.doesNotMatch(renderPlayer(state),/PRIVATE_OLD_CHILD/);
  state.screen='free-reading';state.libraryClient.library.child_id='synthetic-binh';state.libraryClient.view={...view(),lesson:{...lesson,title_en:'PRIVATE_READER'}};assert.doesNotMatch(renderPlayer(state),/PRIVATE_READER/);
});
test('library pending and empty states offer reconciliation and a useful filter reset',()=>{
  const state=renderState();state.libraryLessons=[];state.libraryClient.pending={format:1,route:'library/favorite',data:{request_id:'PRIVATE_REQUEST_ID',child_id:childId,...favorite}};
  let html=renderPlayer(state);assert.match(html,/library-pending/);assert.match(html,/library-check/);assert.match(html,/library-reset-filters/);assert.doesNotMatch(html,/library-discard|PRIVATE_REQUEST_ID/);
  state.libraryClient.reconciled=true;html=renderPlayer(state);assert.match(html,/library-discard/);assert.match(html,/thay đổi đã lưu vẫn còn/);
});
test('malformed-storage UI shows safe reconciliation without a resend action or raw stored content',()=>{
  const state=renderState();state.libraryClient.storageInvalid=true;
  let html=renderPlayer(state);assert.match(html,/library-check/);assert.doesNotMatch(html,/library-retry|library-discard/);assert.match(html,/Lượt đang giữ trên máy chưa đọc được/);
  state.libraryClient.reconciled=true;html=renderPlayer(state);assert.match(html,/library-discard/);assert.doesNotMatch(html,/library-retry/);
});
