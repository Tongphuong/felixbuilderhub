import test from 'node:test';
import assert from 'node:assert/strict';
import {PublisherEditorClient,publisherQuery} from '../src/lib/read2lead/self-learn/publisher-editor-client.mjs';
import {EditorApi,EditorError} from '../src/lib/read2lead/self-learn/editor-client.mjs';
import {renderPublisherEditor} from '../src/lib/read2lead/self-learn/publisher-editor-views.mjs';
import {renderEditor} from '../src/lib/read2lead/self-learn/editor-views.mjs';
import {preparePublisherForm,stopPublisherMedia} from '../src/lib/read2lead/self-learn/publisher-editor-workspace.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
const access={role:'editor',editor_id:'synthetic-editor-qa',csrf:'a'.repeat(64),publisher_editor:true};
const plan={operation:'review',actor:'editor:'+access.editor_id,report:{plan:{source_id:pkg.lesson.source.source_id,version:pkg.lesson.version},plan_sha256:'b'.repeat(64)}};
const bundle=()=>({source_id:pkg.lesson.source.source_id,version:pkg.lesson.version,package_sha256:'c'.repeat(64),content_sha256:'d'.repeat(64),state:'draft',package:structuredClone(pkg),catalogue:{discovery_active:false},readiness:{blockers:['review_audio_listening']},asset_checks:[],audit:[]});
function fixture(){
 const map=new Map(),calls=[];let action=async route=>route==='me'?access:route.endsWith('-plan')?{ok:true,prepared:structuredClone(plan)}:route==='publisher-catalogue'?{ok:true,snapshots:[],catalogue_id:null}:route==='publisher-documents'?{ok:true,documents:[],next_cursor:null}:route.startsWith('publisher-document?')?{ok:true,current_view:bundle()}:{ok:true,result:{replayed:true}};
 const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},api={csrf:access.csrf,async request(route,data){calls.push({route,data:structuredClone(data)});return action(route,data);}},make=()=>new PublisherEditorClient({api,storage,access});
 return{map,calls,storage,api,make,client:make(),set:fn=>action=fn};
}
const refusal=code=>e=>e.code===code;
test('publisher transport admits only exact editor routes and keeps larger limit scoped to publisher operations',async()=>{
 const calls=[],api=new EditorApi({fetcher:async(...args)=>{calls.push(args);return new Response('{"ok":true}',{headers:{'content-type':'application/json'}});}});
 await api.request('publisher-document?'+publisherQuery(bundle()));await api.request('publisher-documents?cursor=50');await api.request('publisher-import-plan',{text:'x'.repeat(300000)});
 for(const route of ['publisher-document?source_id=x&version=1.2.1&extra=true','publisher-document?source_id=x&source_id=y','publisher-document?source_id=x%2Fy&version=1.2.1','publisher-documents?cursor=-1','publisher-media?x=y'])await assert.rejects(api.request(route),refusal('invalid_route'));
 await assert.rejects(api.request('draft',{text:'x'.repeat(300000)}),refusal('editor_input_limit'));assert.equal(calls.length,3);
});
test('prepare saves a dry-run plan; lost apply acknowledgement reloads and sends the exact plan once per deliberate retry',async()=>{
 const f=fixture();f.client.saveDraft('{ unfinished correction');await f.client.prepare('review',{});assert.equal(f.client.pending.attempted,false);assert.ok(f.calls.every(x=>x.route!=='publisher-apply'));
 let sent;f.set(async(route,data)=>{if(route==='me')return access;sent=structuredClone(data);throw new EditorError('connection_lost');});await assert.rejects(f.client.apply(),refusal('connection_lost'));assert.equal(f.client.pending.attempted,true);
 const restored=f.make();assert.deepEqual(restored.pending.data,sent);assert.equal(restored.draft,'{ unfinished correction');f.set(async(route,data)=>{if(route==='me')return access;assert.deepEqual(data,sent);return{ok:true,result:{replayed:true}};});assert.equal((await restored.apply()).replayed,true);assert.equal(restored.pending,null);assert.equal(restored.draft,'{ unfinished correction');
});
test('storage failure prevents apply and does not replace the saved plan',async()=>{
 const f=fixture();await f.client.prepare('review',{});const before=f.client.pending;f.calls.length=0;f.storage.setItem=()=>{throw Error('quota');};await assert.rejects(f.client.apply(),refusal('storage_unavailable'));assert.deepEqual(f.client.pending,before);assert.equal(f.calls.length,0);
});
test('deactivation rejects late private response and leaves uncertain write available for authenticated recovery',async()=>{
 const f=fixture();await f.client.prepare('review',{});let resolve,ready;const started=new Promise(r=>ready=r);f.set(async route=>route==='me'?access:new Promise(r=>{resolve=r;ready();}));const result=f.client.apply();await started;const before=f.client.recoveryText;f.client.deactivate();resolve({ok:true,result:{replayed:false}});await assert.rejects(result,refusal('editor_scope_expired'));assert.equal(f.client.pending,null);assert.equal(f.client.draft,null);assert.equal(f.make().recoveryText,before);
});
test('changed identity or token cannot apply another editor session plan',async()=>{
 for(const token of [false,true]){const f=fixture();await f.client.prepare('review',{});f.calls.length=0;if(token)f.api.csrf='other';else f.set(async()=>({...access,editor_id:'synthetic-other'}));await assert.rejects(f.client.apply(),refusal(token?'csrf_failed':'editor_required'));assert.ok(f.calls.every(x=>x.route==='me'));assert.ok(f.client.pending);}
});
test('attempted plans require reconciliation before cancellation; current source evidence is fetched again at discard',async()=>{
 const f=fixture();await f.client.prepare('review',{});f.set(async route=>{if(route==='me')return access;throw new EditorError('connection_lost');});await assert.rejects(f.client.apply());await assert.rejects(f.client.discard(),refusal('editor_reconcile_required'));
 f.set(async route=>route==='me'?access:route==='publisher-catalogue'?{ok:true,catalogue_id:null,snapshots:[]}:route==='publisher-documents'?{ok:true,documents:[],next_cursor:null}:{ok:true,current_view:bundle()});await f.client.reconcile();const before=f.calls.length;await f.client.discard();assert.equal(f.client.pending,null);assert.ok(f.calls.slice(before).some(x=>x.route.startsWith('publisher-document?')));
});
test('malformed recovery data is retained for export and must be reconciled before explicit removal',async()=>{
 const f=fixture();f.map.set(f.client.key,'{ invalid local data');const c=f.make();assert.equal(c.storageInvalid,true);assert.equal(c.recoveryText,'{ invalid local data');await assert.rejects(c.discard(),refusal('editor_reconcile_required'));await c.reconcile();await c.discard();assert.equal(c.storageInvalid,false);assert.equal(f.map.has(c.key),false);
});
test('storage interference and busy state cannot silently replace a pending request',async()=>{
 const f=fixture();await f.client.prepare('review',{});assert.throws(()=>f.client.saveDraft('new'),refusal('editor_pending'));f.map.set(f.client.key,'changed elsewhere');await assert.rejects(f.client.apply(),refusal('editor_storage_changed'));assert.equal(f.map.get(f.client.key),'changed elsewhere');
});
test('publication replaces only the selected source and reviews use the inspected content checksum',async()=>{
 const calls=[],s={view:bundle(),client:{async read(){return{snapshots:[{active:true,entries:[{source_id:'other-source',version:'1.2.2'},{source_id:pkg.lesson.source.source_id,version:'1.2.9'}]}]};},async prepare(...args){calls.push(args);}}};
 await preparePublisherForm(s,'publisher-publish-form',{reason:'Synthetic check'});assert.deepEqual(calls[0][1].targets,[{source_id:'other-source',version:'1.2.2'},{source_id:pkg.lesson.source.source_id,version:pkg.lesson.version}]);
 await preparePublisherForm(s,'publisher-review-form',{kind:'text',status:'verified',method:'codex_editorial',evidence_ref:'Actually inspected synthetic text'});assert.equal(calls[1][1].expected_package_sha256,s.view.package_sha256);assert.equal(calls[1][1].reviews[0].package_sha256,s.view.content_sha256);assert.equal(calls[1][1].reviews[0].reviewer,undefined);
});
test('private review rendering escapes source and evidence, shows all learning sections and is absent without editor access',()=>{
 const f=fixture(),view=bundle();view.package.assets.push({id:'synthetic-audio-ui',duration_seconds:8});view.package.lesson.audio.asset_id='synthetic-audio-ui';view.package.lesson.title_en='<script>private()</script>';view.package.lesson.story.sentences[0].text_en='<img src=x onerror=evil()>';view.audit=[{evidence:'</pre><script>evil()</script>'}];const s={client:f.client,documents:[],nextCursor:null,view,catalogue:{snapshots:[]},reconciliation:null};
 const html=renderPublisherEditor(s);assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;script&gt;/);for(const text of ['review_audio_listening','Văn bản, hình ảnh','Hoạt động và dẫn chứng','Nghe và nhắc lại','Hội thoại theo câu chuyện','Kể lại','Tình huống mới','Nguồn và quyền','Ghi nhận kiểm tra','publisher-import-form','publisher-review-form','publisher-audio'])assert.ok(html.includes(text),text);
 const publicHtml=renderEditor({access:null,loading:false,publisher:s,workspace:'publisher'});assert.doesNotMatch(publicHtml,/private\(\)|publisher-review-form|review_audio_listening/);
});
test('switching or clearing publisher workspace pauses and detaches private media',()=>{
 const calls=[],media={pause:()=>calls.push('pause'),removeAttribute:key=>calls.push('remove:'+key),load:()=>calls.push('load')};stopPublisherMedia({querySelectorAll:()=>[media]});assert.deepEqual(calls,['pause','remove:src','load']);
});

test('unsaved text after storage failure stays visible and cannot submit the older saved draft',async()=>{
 const f=fixture();f.client.saveDraft('{"old":true}');const s={client:f.client,draftText:'{ new unsaved text',draftStorageFailed:true,documents:[],nextCursor:null,view:null,catalogue:{snapshots:[]}};assert.match(renderPublisherEditor(s),/new unsaved text/);await assert.rejects(preparePublisherForm(s,'publisher-import-form',{}),refusal('storage_unavailable'));assert.equal(f.calls.length,0);assert.equal(f.client.draft,'{"old":true}');
});

test('withdrawn catalogue membership is not presented as learner availability',()=>{
 const f=fixture(),view=bundle();view.state='withdrawn';view.catalogue.discovery_active=true;view.readiness.blockers=['withdrawn_version'];const html=renderPublisherEditor({client:f.client,documents:[],nextCursor:null,view,catalogue:{snapshots:[]}});assert.doesNotMatch(html,/Có trong thư viện QA hiện tại/);assert.match(html,/Không có trong thư viện QA hiện tại/);
});
test('hiding the editor pauses audio but preserves its source for resumed playback',()=>{
 const calls=[],media={pause:()=>calls.push('pause'),removeAttribute:()=>calls.push('remove'),load:()=>calls.push('load')};stopPublisherMedia({querySelectorAll:()=>[media]},{detach:false});assert.deepEqual(calls,['pause']);
});
