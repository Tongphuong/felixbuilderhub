import test from 'node:test';
import assert from 'node:assert/strict';
import { FamilyClient } from '../src/lib/read2lead/self-learn/family-client.mjs';
import { ApiClient, ApiError } from '../src/lib/read2lead/self-learn/api-client.mjs';
import { renderPlayer } from '../src/lib/read2lead/self-learn/player-views.mjs';
const scope = 'synthetic-family-a', route = 'parent/create-child';
function storage() { const map = new Map(); return { map, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) }; }
const recovery = { family_id: scope, recovery_code: 'SECRET_OLD_TOKEN', new_access_code: 'SECRET_ACCESS', new_parent_secret: 'SECRET_PARENT', new_recovery_code: 'SECRET_NEW_TOKEN' };
test('uncertain family change retries same ID and immutable body; only opaque ID persists', async () => {
  const seen = [], s = storage(); let fail = true;
  const c = new FamilyClient({ storage: s, id: () => 'family-test-1', api: { async request(r,d) { seen.push({ r,d }); if(fail) throw new ApiError('connection_lost'); return { ok:true, replayed:true }; } } });
  const data = { ...recovery }; await assert.rejects(c.submit('recover',scope,data),/connection_lost/); data.new_parent_secret = 'CHANGED';
  assert.deepEqual([...s.map.values()],['family-test-1']); assert.doesNotMatch(JSON.stringify([...s.map]), /SECRET_|CHANGED/);
  assert.deepEqual(c.pending,{route:'recover',scope}); assert.doesNotMatch(JSON.stringify(c), /SECRET_/);
  await assert.rejects(c.submit(route,scope,{display_name:'No duplicate'}),/family_pending/);
  fail=false; assert.equal((await c.retry()).replayed,true); assert.deepEqual(seen[1],seen[0]); assert.equal(s.map.size,0); assert.equal(c.pending,null);
});
test('reload retains an unfinished ID and exact reentry reuses it without persisting credentials', async () => {
  const s=storage(),seen=[];
  const a=new FamilyClient({storage:s,id:()=> 'family-before-reload',api:{async request(r,d){seen.push(d);throw new ApiError('request_timeout');}}});
  await assert.rejects(a.submit('recover',scope,recovery),/request_timeout/); a.forgetPayload(); assert.equal(a.pending,null);
  const b=new FamilyClient({storage:s,id:()=> 'must-not-be-used',api:{async request(r,d){seen.push(d);return {ok:true,replayed:true};}}});
  assert.equal(b.unfinished('recover',scope),true); await b.submit('recover',scope,recovery); assert.deepEqual(seen[0],seen[1]); assert.equal(b.unfinished('recover',scope),false);
});
test('request conflict preserves old ID until explicit reconciliation clear', async () => {
  const s=storage(); let reject=true;
  const c=new FamilyClient({storage:s,id:()=>reject?'family-old':'family-new',api:{async request(){if(reject)throw new ApiError('request_conflict',409);return {ok:true};}}});
  await assert.rejects(c.submit(route,scope,{display_name:'Changed'}),/request_conflict/); assert.equal(c.pending,null); assert.equal(c.unfinished(route,scope),true);
  c.clear(route,scope); reject=false; await c.submit(route,scope,{display_name:'New permitted operation'}); assert.equal(s.map.size,0);
});
test('validation and authorization refusals release rejected payload; temporary failures retain exact request', async () => {
  for(const [code,status,keep] of [['invalid_request',400,false],['unauthorized',401,false],['stale_revision',409,false],['rate_limited',429,true],['temporarily_unavailable',503,true],['invalid_response',200,true]]) {
    const s=storage(),c=new FamilyClient({storage:s,id:()=> 'family-errors',api:{async request(){throw new ApiError(code,status);}}});
    await assert.rejects(c.submit(route,scope,{display_name:'Synthetic'}),e=>e.code===code); assert.equal(!!c.pending,keep,code); assert.equal(s.map.size,keep?1:0,code);
  }
});
test('double click and clear while in flight cannot create another family mutation', async () => {
  let finish; const wait=new Promise(r=>{finish=r;}),seen=[];
  const c=new FamilyClient({storage:storage(),id:()=> 'family-inflight',api:{async request(r,d){seen.push(d);await wait;return {ok:true};}}});
  const p=c.submit(route,scope,{display_name:'One'}); await assert.rejects(c.retry(),/operation_busy/); assert.throws(()=>c.clear(route,scope),/operation_busy/);
  await assert.rejects(c.submit(route,scope,{display_name:'Two'}),/family_pending/); finish();await p;assert.equal(seen.length,1);
});
test('navigation forgets sensitive memory and a late response cannot replace a new pending operation', async () => {
  let finish,first=true;const wait=new Promise(r=>{finish=r;}),s=storage();
  const c=new FamilyClient({storage:s,id:()=> 'family-epoch',api:{async request(){if(first){first=false;await wait;return {ok:true};}throw new ApiError('connection_lost');}}});
  const old=c.submit('recover',scope,recovery);c.forgetPayload();
  await assert.rejects(c.submit(route,scope,{display_name:'New'}),/connection_lost/);finish();await assert.rejects(old,/family_scope_expired/);
  assert.deepEqual(c.pending,{route,scope});assert.equal(s.map.size,2);assert.doesNotMatch(JSON.stringify([...s.map]),/SECRET_/);
});
test('memory-only fallback replays safely when browser metadata storage is unavailable', async () => {
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}},seen=[];let fail=true;
  const c=new FamilyClient({storage:denied,id:()=> 'family-memory',api:{async request(r,d){seen.push(d);if(fail)throw new ApiError('connection_lost');return {ok:true};}}});
  assert.equal(c.unfinished(route,scope),false);await assert.rejects(c.submit(route,scope,{display_name:'Memory'}));fail=false;await c.retry();assert.deepEqual(seen[0],seen[1]);
});
test('family client refuses arbitrary routes, supplied request IDs and cross-operation clear', async () => {
  const c=new FamilyClient({storage:storage(),id:()=> 'family-route',api:{async request(){throw new ApiError('connection_lost');}}});
  await assert.rejects(c.submit('https://evil.invalid',scope,{}),/invalid_route/);await assert.rejects(c.submit(route,'<script>',{}),/invalid_route/);
  await assert.rejects(c.submit(route,scope,{request_id:'caller-chosen',display_name:'No'}),/invalid_request/);
  await assert.rejects(c.submit(route,scope,{display_name:'Pending'}),/connection_lost/);assert.throws(()=>c.clear('recover',scope),/family_pending/);
});
test('transport permits only exact family routes and never serializes credentials into a URL', async () => {
  const seen=[],api=new ApiClient({fetcher:async(u,o)=>{seen.push({u,o});return Response.json({ok:true});}});
  for(const route of ['recover','parent/enter','parent/exit','parent/family','parent/audit','parent/create-child','parent/update-child']) await api.request(route,route==='recover'?recovery:undefined);
  assert.doesNotMatch(seen.map(x=>x.u).join(' '),/SECRET_/);assert.match(seen[0].o.body,/SECRET_PARENT/);assert.equal(seen[0].o.credentials,'same-origin');
  for(const route of ['parent/family?child_id=synthetic-b','parent/../family','parent/admin','recover?token=secret','//evil.invalid'])await assert.rejects(api.request(route),/invalid_route/);
});
const access={role:'parent',csrf:'csrf',children:[{id:'synthetic-an',label_vi:'An mẫu',level:'L2',recording_allowed:false}],active_child_id:'synthetic-an',parent_expires_at:'2026-09-18T12:15:00.000Z'};
const child={id:'synthetic-an',label_vi:'An mẫu',level:'L2',revision:0,learning_enabled:true,recording_allowed:false,archived:false,wallet:{balance:5},history:[],history_limit:100};
const state=()=>({access:structuredClone(access),screen:'parent',family:{family_id:scope,label_vi:'Gia đình A',children:[structuredClone(child)]},familyAudit:[],lessons:[],sessions:[]});
test('parent renderer escapes profile names, audit fallback and history text without reading private fields', () => {
  const s=state(),c=s.family.children[0];c.label_vi='<img src=x onerror=alert(1)>';c.private_token='PRIVATE_TOKEN';s.family.private_secret='PRIVATE_SECRET';s.familyAudit=[{action:'<script>x</script>',created_at:'2026-09-18T12:00:00Z'}];
  const html=renderPlayer(s);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x|<script>x|PRIVATE_TOKEN|PRIVATE_SECRET/);
  assert.match(html,/5 kim cương mẫu/);assert.match(html,/data-family-update="synthetic-an"/);assert.match(html,/Chưa có bài đã lưu/);
});
test('locked parent screen never renders cached parent data and recovery never fills credentials', () => {
  const s=state();s.access.role='child';s.family.children[0].label_vi='PRIVATE_CACHED_PROFILE';const html=renderPlayer(s);assert.match(html,/parent-entry-form/);assert.doesNotMatch(html,/PRIVATE_CACHED_PROFILE|data-family-update/);
  s.screen='recovery';s.recovery_code='SECRET_TOKEN';s.familyPending={route:'recover',scope};const recovery=renderPlayer(s);
  assert.match(recovery,/family-pending/);assert.match(recovery,/fieldset disabled/);assert.doesNotMatch(recovery,/SECRET_TOKEN|value="DEMO-RECOVERY/);
  assert.match(recovery,/name="saved_codes" required/);
});
test('no enabled child has an explicit parent recovery path and disabled placeholder', () => {
  const s=state();s.screen='learning';s.access.active_child_id=null;s.access.children=[];s.family=null;
  const html=renderPlayer(s);assert.match(html,/Gia đình mẫu chưa có hồ sơ được mở học/);assert.match(html,/value="" selected disabled/);assert.match(html,/Mở khu vực phụ huynh/);assert.doesNotMatch(html,/Bắt đầu một lượt/);
});
test('archived profile, limits, saved practice and incomplete request states remain explainable', () => {
  const s=state(),c=s.family.children[0];c.archived=true;c.history=[{title_en:'A sample',level:'L2',stage:'understand_saved',updated_at:'2026-09-18T12:00:00Z',practice_status_counts:{provisional:2,assisted:1,pending:0},speech:{attempts:1,pending:0,unassessable:1},support_used:['revealing_hint']}];
  s.familyUnfinished=['synthetic-an'];s.createUnfinished=true;s.family.children=Array.from({length:10},(_,i)=>({...c,id:'synthetic-'+i}));
  const html=renderPlayer(s);assert.match(html,/Đang cất/);assert.match(html,/Còn mã lượt gửi từ trước/);assert.match(html,/Gia đình mẫu đã có 10 hồ sơ/);assert.match(html,/Bằng chứng bước đầu/);assert.match(html,/Gợi ý nội dung/);assert.match(html,/chưa phải kết luận thành thạo/);assert.doesNotMatch(html,/0 điểm|xu mẫu/);
});
