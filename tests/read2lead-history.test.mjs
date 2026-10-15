import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SyntheticStore} from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import {SyntheticFamilyStore} from '../scripts/lib/read2lead-self-learn-family.mjs';
import {SyntheticLibraryStore} from '../scripts/lib/read2lead-self-learn-library.mjs';
import {createLocalHandlers} from '../functions/lib/read2lead/self-learn/handlers.mjs';
import {publicPracticeHistory,publicReading} from '../functions/lib/read2lead/self-learn/library-views.mjs';
import {HistoryClient} from '../src/lib/read2lead/self-learn/history-client.mjs';
import {ApiClient,ApiError} from '../src/lib/read2lead/self-learn/api-client.mjs';
import {renderLibrary} from '../src/lib/read2lead/self-learn/library-views.mjs';
const read=n=>JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/'+n+'.json',import.meta.url),'utf8'));
const at='2026-09-20T12:00:00.000Z',child='synthetic-an',origin='http://127.0.0.1:18801',prefix='/api/read2lead/self-learn/';
const catalogue=read('level-lessons'),interests=read('library-interests'),lesson=catalogue.lessons[0],staff={active:true,role:'staff',id:'synthetic-history'};
async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'r2l-history-'));writeFileSync(join(root,'synthetic-target.json'),JSON.stringify({format:1,purpose:'read2lead-local-synthetic',database:'read2lead-synthetic.sqlite'}));
 const store=new SyntheticStore({root}),family=new SyntheticFamilyStore({mode:'synthetic-local',root});for(const account of read('family-access').accounts)family.seed(staff,account,at);
 const library=await SyntheticLibraryStore.open({mode:'synthetic-local',root,catalogue,interests});
 const p={...family.authenticateAccess('DEMO-FAMILY-A'),childId:child},other={...p,childId:'synthetic-binh'};
 const config={mode:'synthetic-local',origin,access:read('access'),lessons:catalogue.lessons,store,familyStore:family,libraryStore:library,libraryInterests:interests,now:()=>Date.parse(at)};
 t.after(()=>{library.close();family.close();store.close();rmSync(root,{recursive:true,force:true});});
 const f={root,store,family,library,p,other,api:createLocalHandlers(config)};
 f.start=(id,principal=p)=>store.start(principal,{sessionId:id,childId:principal.childId,lesson,now:at});
 f.open=(id,principal=p)=>library.openReading(principal,{request_id:id,lesson_id:lesson.id},at).reading;
 return f;
}
function databaseDigest(f){const db=new DatabaseSync(join(f.root,'read2lead-synthetic.sqlite'),{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all())).digest('hex')]));}finally{db.close();}}
async function apiClient(f,code='DEMO-FAMILY-A'){
 let cookie='',csrf='';const call=async(route,data)=>{const response=await f.api.handle(new Request(origin+prefix+route,{method:data===undefined?'GET':'POST',headers:{origin,cookie,...(data===undefined?{}:{'content-type':'application/json','x-r2l-csrf':csrf})},...(data===undefined?{}:{body:JSON.stringify(data)})}));if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(value.csrf)csrf=value.csrf;return{status:response.status,value,response};};assert.equal((await call('login',{access_code:code})).status,200);return{call};
}
test('both histories reach all 1095 saved visits without writes, gaps or duplicates beyond the old 100-row limit',async t=>{
 const f=await fixture(t),readingIds=[];
 for(let i=0;i<1095;i++){await f.start('history-'+i);readingIds.push(f.open('history-reading-'+i).reading_id);}
 const before=databaseDigest(f),client=await apiClient(f);
 for(const kind of ['practice','reading']){
  let cursor=null,entries=[],pages=0;
  do{const result=await client.call('library/history?kind='+kind+(cursor?'&before='+cursor:''));assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.order,'created_desc');assert.ok(result.value.entries.length<=20);entries.push(...result.value.entries);cursor=result.value.next_before;pages++;assert.ok(pages<=55);}while(cursor);
  assert.equal(pages,55);assert.equal(entries.length,1095);const key=kind==='practice'?'session_id':'reading_id';assert.equal(new Set(entries.map(e=>e[key])).size,1095);assert.deepEqual(entries.map(e=>e[key]),kind==='practice'?Array.from({length:1095},(_,i)=>'history-'+(1094-i)):readingIds.toReversed());
  assert.ok(entries.every(e=>e.child_id===child&&e.title_en===lesson.title_en&&e.content_version===lesson.version));
  for(const entry of entries){const projection=kind==='practice'?publicPracticeHistory:publicReading;assert.deepEqual(entry,projection(entry));assert.ok(!('lesson' in entry)&&!('answers' in entry)&&!('acknowledged_request_ids' in entry));}
 }
 assert.deepEqual(databaseDigest(f),before);assert.equal(f.store.wallet(f.p,child).balance,0);
});
test('new inserts and bookmark updates cannot move saved visits across a cursor or overwrite pinned titles',async t=>{
 const f=await fixture(t),reads=[];for(let i=0;i<25;i++){await f.start('stable-'+i);reads.push(f.open('stable-read-'+i));}
 const first=f.store.historyPage(f.p,child),readFirst=f.library.historyPage(f.p);await f.start('new-during-pagination');f.open('new-read-during-pagination');
 f.library.updateReading(f.p,{request_id:'old-bookmark-update',reading_id:reads[0].reading_id,expected_revision:0,sentence_id:lesson.story.sentences[1].id,marked_finished:true},'2026-09-20T12:01:00.000Z');
 const remaining=f.store.historyPage(f.p,child,first.next_before),readRemaining=f.library.historyPage(f.p,readFirst.next_before);
 assert.deepEqual(remaining.entries.map(x=>x.session_id),['stable-4','stable-3','stable-2','stable-1','stable-0']);assert.deepEqual(readRemaining.entries.map(x=>x.reading_id),reads.slice(0,5).toReversed().map(x=>x.reading_id));assert.equal(readRemaining.entries.at(-1).marked_finished,true);assert.equal(readRemaining.entries.at(-1).revision,1);
 assert.equal(remaining.entries.at(-1).title_en,lesson.title_en);assert.equal(remaining.next_before,null);assert.equal(readRemaining.next_before,null);
 const restored=new SyntheticStore({root:f.root});try{assert.deepEqual(restored.historyPage(f.p,child,first.next_before),remaining);}finally{restored.close();}
});
test('history HTTP rejects foreign or absent cursors, extra parameters, unauthenticated access and wrong active child',async t=>{
 const f=await fixture(t);await f.start('an-session');await f.start('binh-session',f.other);const a=f.open('an-read'),b=f.open('binh-read',f.other),client=await apiClient(f),before=databaseDigest(f);
 const unauth=await f.api.handle(new Request(origin+prefix+'library/history?kind=practice'));assert.equal(unauth.status,401);
 for(const route of ['library/history','library/history?kind=all','library/history?kind=practice&kind=reading','library/history?kind=practice&child_id=synthetic-binh','library/history?kind=practice&limit=9999','library/history?kind=practice&before=binh-session','library/history?kind=practice&before=missing-session','library/history?kind=reading&before='+b.reading_id,'library/history?kind=practice&before='])assert.equal((await client.call(route)).status,400,route);
 assert.equal((await client.call('library/history?kind=reading&before='+a.reading_id)).status,200);
 assert.throws(()=>f.store.historyPage(f.p,'synthetic-binh'),/wrong_child/);
 assert.equal((await client.call('child',{child_id:'synthetic-binh'})).status,200);const result=await client.call('library/history?kind=practice');assert.deepEqual(result.value.entries.map(x=>x.session_id),['binh-session']);assert.equal((await client.call('library/history?kind=practice&before=an-session')).status,400);assert.deepEqual(databaseDigest(f),before);
});
const entry=(id,more={})=>({session_id:id,child_id:child,lesson_id:'synthetic-lesson',title_en:'Saved <title>',level:'L0',content_version:'1.1.0',content_sha256:'a'.repeat(64),revision:0,stage:'pre_read',status:'active',created_at:at,updated_at:at,...more});
const result=(entries,more={})=>({ok:true,child_id:child,kind:'practice',entries,next_before:null,page_size:20,order:'created_desc',...more});
function fake(handler){return{csrf:'csrf',request:async(route)=>route==='me'?{csrf:'csrf',active_child_id:child}:handler(route)};}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
test('history client keeps exact next cursor on lost responses and retries without duplicate rows',async()=>{
 const first=Array.from({length:20},(_,i)=>entry('page-'+(40-i)));let calls=0,fail=true;const urls=[];
 const api=fake(async route=>{urls.push(route);calls++;if(calls===1)return result(first,{next_before:'page-21'});if(fail)throw new ApiError('connection_lost');return result([entry('last-saved')]);}),client=new HistoryClient({api,childId:child});
 assert.equal((await client.refresh('practice')).loading,false);await assert.rejects(client.more('practice'),e=>e.code==='history_load_failed');assert.equal(client.page('practice').entries.length,20);assert.equal(client.page('practice').next_before,'page-21');assert.equal(client.page('practice').failed,true);fail=false;await client.more('practice');assert.equal(urls[1],urls[2]);assert.equal(client.page('practice').entries.length,21);assert.equal(client.page('practice').next_before,null);await client.more('practice');assert.equal(calls,3);
});
test('a newer history refresh supersedes a delayed response; lower revisions never rewind saved progress',async()=>{
 const old=deferred(),entered=deferred();let call=0;
 const client=new HistoryClient({childId:child,api:fake(async()=>{if(++call===1){entered.resolve();return old.promise;}return result([entry('same',{revision:4,status:'complete',stage:'complete'})]);})});
 const pending=client.refresh('practice');await entered.promise;await client.refresh('practice');old.resolve(result([entry('stale')]));await assert.rejects(pending,e=>e.code==='history_scope_expired');assert.deepEqual(client.page('practice').entries.map(e=>e.session_id),['same']);
 client.api=fake(async()=>result([entry('same',{revision:1})]));await client.refresh('practice');assert.equal(client.page('practice').entries[0].revision,4);assert.equal(client.page('practice').entries[0].status,'complete');
 client.api=fake(async()=>{throw Error('connection_lost');});await assert.rejects(client.refresh('practice'));assert.equal(client.page('practice').retry_from_start,true);assert.equal(client.page('practice').entries[0].revision,4);
});
test('navigation or changed child/authentication suppresses late history responses',async()=>{
 for(const change of ['navigate','child','csrf']){
  const pending=deferred(),entered=deferred();let checks=0;const api={csrf:'csrf',request:async route=>{if(route==='me'){checks++;return{csrf:change==='csrf'&&checks>1?'rotated':'csrf',active_child_id:change==='child'&&checks>1?'synthetic-binh':child};}entered.resolve();return pending.promise;}};
  const client=new HistoryClient({api,childId:child}),loading=client.refresh('practice');await entered.promise;if(change==='navigate')client.deactivate();pending.resolve(result([entry('late')]));await assert.rejects(loading,e=>['history_scope_expired','wrong_child','csrf_failed'].includes(e.code));assert.deepEqual(client.page('practice').entries,[]);
 }
});
test('malformed, cross-child, changed-pin and duplicate history responses are rejected before display',async()=>{
 for(const bad of [result([entry('bad',{child_id:'synthetic-binh'})]),result([entry('bad',{answers:['private']})]),result([entry('repeat'),entry('repeat')]),result([entry('bad')],{next_before:'unrelated'}),result(Array.from({length:21},(_,i)=>entry('too-many-'+i)))]){
  const client=new HistoryClient({api:fake(async()=>bad),childId:child});await assert.rejects(client.refresh('practice'),e=>e.code==='invalid_response');assert.deepEqual(client.page('practice').entries,[]);
 }
 const client=new HistoryClient({api:fake(async()=>result([entry('pin')])),childId:child});await client.refresh('practice');client.api=fake(async()=>result([entry('pin',{title_en:'Catalogue replacement'})]));await assert.rejects(client.refresh('practice'),e=>e.code==='invalid_response');assert.equal(client.page('practice').entries[0].title_en,'Saved <title>');
});
function uiState(historyClient){return{screen:'library',access:{active_child_id:child},historyClient,libraryClient:{library:{child_id:child,level:'L0',preferences:{revision:0,interest_ids:[]},groups:[],favorites:[],suggestions:[],reading_history:[]}},libraryCatalogue:[{id:'synthetic-lesson',title_en:'Current replacement title'}],libraryLessons:[],librarySessions:[],libraryFilters:{},libraryHistoryCount:10};}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('library renders saved titles and all loaded practice rows with accessible more/retry controls',async()=>{
 const client=new HistoryClient({api:fake(async()=>result(Array.from({length:20},(_,i)=>entry('saved-'+i,{status:i?'active':'complete'})),{next_before:'saved-19'})),childId:child});await client.refresh('practice');
 const state=uiState(client),html=renderLibrary(state,escape);assert.equal((html.match(/data-history-kind="practice"/g)||[]).length,20);assert.match(html,/Saved &lt;title&gt;/);assert.ok(!html.includes('Current replacement title'));assert.match(html,/data-action="history-more"[^>]*data-kind="practice"/);assert.match(html,/data-session="saved-0"/);assert.match(html,/id="history-practice-saved-0" tabindex="-1"/);assert.match(html,/id="history-page-practice"/);assert.match(html,/Xem kết quả/);assert.match(html,/aria-labelledby="library-practice-heading"/);
 client.api=fake(async()=>{throw Error('connection_lost');});await assert.rejects(client.more('practice'));const failed=renderLibrary(state,escape);assert.match(failed,/Lịch sử chưa tải xong/);assert.match(failed,/Thử tải lại lịch sử/);assert.equal((failed.match(/data-history-kind="practice"/g)||[]).length,20);
});


test('real browser transport reaches history and rejects malformed history routes before fetching',async t=>{
 const f=await fixture(t);await f.start('transport-saved');f.open('transport-reading');let cookie='',requests=0;
 const api=new ApiClient({fetcher:async(url,options)=>{requests++;const response=await f.api.handle(new Request(origin+url,{...options,headers:{...options.headers,origin,cookie}}));if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}});
 const access=await api.request('login',{access_code:'DEMO-FAMILY-A'});api.csrf=access.csrf;const client=new HistoryClient({api,childId:child});
 await client.refresh('practice');await client.refresh('reading');assert.equal(client.page('practice').entries[0].session_id,'transport-saved');assert.equal(client.page('reading').entries[0].title_en,lesson.title_en);const before=requests;
 for(const route of ['library/history','library/history?kind=practice&kind=reading','library/history?kind=practice&child_id=synthetic-binh','library/history?kind=practice&before=','library/history?kind=practice&before=../bad','library/history?kind=practice#fragment','library/history?kind=unknown','library/history?before=only-cursor'])await assert.rejects(api.request(route),e=>e.code==='invalid_route');
 await assert.rejects(api.request('library/history?kind=practice',{}),e=>e.code==='invalid_route');assert.equal(requests,before);
});

test('real API timeout keeps history untouched and a retry loads the same read-only page',async()=>{
 let delay=true;const routes=[];const api=new ApiClient({timeoutMs:15,fetcher:async(url,options)=>{
  if(url.endsWith('/me'))return Response.json({ok:true,csrf:'csrf',active_child_id:child});
  routes.push(url);if(delay)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  return Response.json(result([entry('after-timeout')]));
 }});api.csrf='csrf';const client=new HistoryClient({api,childId:child});
 await assert.rejects(client.refresh('practice'),e=>e.code==='history_load_failed');assert.deepEqual(client.page('practice').entries,[]);assert.equal(client.page('practice').loaded,false);assert.equal(client.page('practice').retry_from_start,true);
 delay=false;await client.refresh('practice');assert.equal(routes[0],routes[1]);assert.equal(client.page('practice').entries[0].session_id,'after-timeout');assert.equal(client.page('practice').failed,false);
});
