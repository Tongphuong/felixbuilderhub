import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openPublisherStore,publisherStoreDigest} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {createPublisherEditor} from '../scripts/lib/read2lead-publisher-editor.mjs';
import {createEditorHandlers} from '../functions/lib/read2lead/self-learn/editor-handlers.mjs';
import {createPrivateEditorAccess,initializePrivateEditorAccess} from '../scripts/lib/read2lead-private-editor-access.mjs';
import {startPrivatePublisherEditor,runPrivatePublisherEditor} from '../scripts/read2lead-publisher-editor.mjs';
import {PublisherEditorClient} from '../src/lib/read2lead/self-learn/publisher-editor-client.mjs';
import {renderEditor} from '../src/lib/read2lead/self-learn/editor-views.mjs';
import {renderPublisherEditor} from '../src/lib/read2lead/self-learn/publisher-editor-views.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
const query=p=>new URLSearchParams({source_id:p.lesson.source.source_id,version:p.lesson.version}).toString();
async function fabricated(assets,opts={}){const p=await fixturePackage(assets,opts);p.lesson.source.kind='user_supplied_publisher';p.lesson.title_en='Fabricated private-editor QA '+p.lesson.title_en;p.lesson.source.title_as_printed=p.lesson.title_en;p.lesson.source.attribution='Fabricated publisher-kind test only, no real source or licence';p.assets.forEach(a=>{a.provenance=a.kind==='audio'?'supplied_recording':'new_illustration';});const hash=await publisherDigest(p);p.reviews.forEach(r=>r.package_sha256=hash);return p;}
function client(origin,handle=fetch){let cookie='',csrf='';return{get cookie(){return cookie;},get csrf(){return csrf;},async call(route,data,headers={}){const response=await handle(new Request(origin+'/api/read2lead/editor/'+route,{method:data===undefined?'GET':'POST',headers:{cookie,...(data===undefined?{}:{origin,'content-type':'application/json','x-r2l-editor-csrf':csrf}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}));if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(value.csrf)csrf=value.csrf;return{status:response.status,value,response};}};}
async function setup(t,{seed=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-private-editor-'));fs.chmodSync(root,0o700);const filename=path.join(root,'publisher.sqlite'),accessFile=path.join(root,'access.json'),distRoot=path.join(root,'dist');initializePrivateEditorAccess(accessFile);const credentials=JSON.parse(fs.readFileSync(accessFile,'utf8'));const account={editor_id:credentials.editor_id,access_secret:credentials.access_secret};
 const db=openPublisherStore(filename,{create:true});initializePublisherCatalogue(db);const assets=fixtureAssets(root),pkg=await fabricated(assets);if(seed)await seedFixturePackages(db,[pkg]);
 fs.mkdirSync(path.join(distRoot,'read2lead/editor'),{recursive:true});fs.mkdirSync(path.join(distRoot,'_astro'));fs.writeFileSync(path.join(distRoot,'read2lead/editor/index.html'),'<div class="qa-banner">BẢN QA CỤC BỘ · Nội dung mẫu · Chưa duyệt phát hành</div><div id="editor-root"></div>');fs.writeFileSync(path.join(distRoot,'_astro/editor.js'),'/* safe static fixture */');
 let clock=Date.parse(fixtureNow);const server=await startPrivatePublisherEditor({mode:'private-local',publisherDb:filename,assetRoot:root,accessFile,distRoot,port:0,now:()=>clock});t.after(async()=>{await server.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 const editor=client(server.origin);return{root,filename,accessFile,distRoot,db,assets,pkg,server,editor,account,advance(){clock+=900001;},get clock(){return clock;},rotate(){const value={...credentials,access_secret:'b'.repeat(64)};fs.writeFileSync(accessFile,JSON.stringify(value));return{editor_id:value.editor_id,access_secret:value.access_secret};}};
}
test('private editor host has separate access, no learner routes or raw files, and authenticated CSRF-protected media',async t=>{
 const f=await setup(t),url=f.server.origin,page=await fetch(url+'/read2lead/editor/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/data-editor-environment="private-local"/);assert.doesNotMatch(html,/DEMO-EDITOR|BẢN QA CỤC BỘ/);assert.ok(!html.includes(f.account.access_secret));
 assert.equal((await fetch(url+'/_astro/editor.js')).status,200);
 for(const pathname of ['/access.json','/publisher.sqlite','/read2lead/self-learn/','/api/read2lead/self-learn/lessons','/api/read2lead/gifts-staff/me'])assert.equal((await fetch(url+pathname)).status,404);
 assert.equal((await f.editor.call('login',{editor_id:'synthetic-editor-qa',access_secret:'DEMO-EDITOR-LOCAL-ONLY'})).status,401);
 for(const route of ['publisher-documents','publisher-document?'+query(f.pkg),'publisher-media?'+query(f.pkg)+'&asset_id=synthetic-audio'])assert.equal((await f.editor.call(route)).status,401);
 const access=await f.editor.call('login',f.account);assert.equal(access.status,200);assert.equal(access.value.environment,'private-local');assert.equal(access.value.publisher_only,true);assert.equal(access.value.publication_scope,'private_catalogue_only');assert.match(f.editor.cookie,/^r2l_private_publisher_editor=/);assert.ok(!JSON.stringify(access.value).includes(f.account.access_secret));
 for(const route of ['templates','documents','catalogue'])assert.equal((await f.editor.call(route)).status,404);
 assert.equal((await f.editor.call('publisher-apply',{}, {'x-r2l-editor-csrf':'wrong'})).status,403);
 assert.equal((await f.editor.call('publisher-documents',undefined,{origin:'http://untrusted.example'})).status,403);
 const media=url+'/api/read2lead/editor/publisher-media?'+query(f.pkg)+'&asset_id=synthetic-audio';let response=await fetch(media,{headers:{cookie:f.editor.cookie,range:'bytes=0-43'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,44);assert.equal(response.headers.get('cache-control'),'no-store');
 await f.editor.call('logout',{});assert.equal((await fetch(media,{headers:{cookie:access.response.headers.get('set-cookie').split(';')[0]}})).status,401);
});
test('private imports clear approvals; explicit reviews gate publication, correction preserves versions and withdrawal is repeatable',async t=>{
 const f=await setup(t,{seed:false});assert.equal((await f.editor.call('login',f.account)).status,200);const before=publisherStoreDigest(f.db);
 const prepared=await f.editor.call('publisher-import-plan',{package:f.pkg});assert.equal(prepared.status,200,JSON.stringify(prepared.value));assert.deepEqual(prepared.value.prepared.report.packages[0].reviews,[]);assert.equal(publisherStoreDigest(f.db),before);
 let applied=await f.editor.call('publisher-apply',prepared.value.prepared);assert.equal(applied.status,200,JSON.stringify(applied.value));assert.equal(applied.value.result.inserted,1);assert.equal((await f.editor.call('publisher-apply',prepared.value.prepared)).status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM publisher_packages').get().n,1);
 let bundle=(await f.editor.call('publisher-document?'+query(f.pkg))).value.current_view;assert.equal(bundle.state,'draft');assert.ok(bundle.readiness.blockers.includes('review_human_teaching'));
 const targets=[{source_id:bundle.source_id,version:bundle.version}];assert.equal((await f.editor.call('publisher-catalogue-plan',{targets,reason:'Fabricated readiness refusal'})).status,409);
 const reviews=f.pkg.reviews.map(r=>({kind:r.kind,package_sha256:bundle.content_sha256,status:'approved',method:r.method,evidence_ref:'Fabricated private-editor test; not a real review'}));
 const review=await f.editor.call('publisher-review-plan',{...targets[0],expected_package_sha256:bundle.package_sha256,reviews});assert.equal(review.status,200,JSON.stringify(review.value));assert.equal((await f.editor.call('publisher-apply',review.value.prepared)).status,200);
 const plan=await f.editor.call('publisher-catalogue-plan',{targets,reason:'Fabricated local catalogue check'});assert.equal(plan.status,200,JSON.stringify(plan.value));assert.equal((await f.editor.call('publisher-apply',plan.value.prepared)).status,200);assert.equal((await f.editor.call('publisher-apply',plan.value.prepared)).value.result.replayed,true);
 const correction=await fabricated(f.assets,{revision:2}),next=await f.editor.call('publisher-import-plan',{package:correction});assert.equal(next.status,200);assert.equal((await f.editor.call('publisher-apply',next.value.prepared)).status,200);bundle=(await f.editor.call('publisher-document?'+query(correction))).value.current_view;assert.equal(bundle.state,'draft');assert.equal((await f.editor.call('publisher-document?'+query(f.pkg))).value.current_view.state,'published');
 const withdrawal={...targets[0],reason:'Fabricated rights revocation'};assert.equal((await f.editor.call('publisher-withdraw',withdrawal)).status,200);assert.equal((await f.editor.call('publisher-withdraw',withdrawal)).status,200);assert.equal((await f.editor.call('publisher-document?'+query(f.pkg))).value.current_view.state,'withdrawn');assert.equal(f.db.prepare("SELECT count(*) n FROM publisher_events WHERE kind='withdrawn'").get().n,1);
 const synthetic=await fixturePackage(f.assets,{revision:3});assert.equal((await f.editor.call('publisher-import-plan',{package:synthetic})).status,403);
});
test('private file rotation and expiry invalidate sessions; insecure or symbolic access files are refused',async t=>{
 const f=await setup(t);assert.equal(fs.statSync(f.accessFile).mode&0o777,0o600);assert.throws(()=>initializePrivateEditorAccess(f.accessFile),/EEXIST/);assert.equal((await f.editor.call('login',f.account)).status,200);const rotated=f.rotate();assert.equal((await f.editor.call('publisher-documents')).status,401);assert.equal((await f.editor.call('login',f.account)).status,401);assert.equal((await f.editor.call('login',rotated)).status,200);f.advance();assert.equal((await f.editor.call('publisher-documents')).status,401);
 fs.chmodSync(f.accessFile,0o644);assert.throws(()=>createPrivateEditorAccess({filename:f.accessFile}),/unsafe_editor_access_file/);fs.chmodSync(f.accessFile,0o600);const link=path.join(f.root,'linked.json');fs.symlinkSync(f.accessFile,link);assert.throws(()=>createPrivateEditorAccess({filename:link}));
 assert.throws(()=>createPublisherEditor({mode:'synthetic-local',db:f.db,assetRoot:f.root}),/publisher_editor_synthetic_only/);
 assert.throws(()=>createEditorHandlers({mode:'private-local',origin:f.server.origin,store:{access(){}},publisher:{}}),/unsafe_editor_api_config/);
 await assert.rejects(runPrivatePublisherEditor(['--publisher-db','relative']),/absolute_paths_required/);
});
test('access revocation at the write boundary prevents mutation and after awaited review prevents private disclosure',async t=>{
 const f=await setup(t),access=createPrivateEditorAccess({filename:f.accessFile}),publisher=createPublisherEditor({mode:'private-local',db:f.db,assetRoot:f.root});let armed=false;
 const store={...access,withPublisherCommit(...args){if(armed)f.rotate();return access.withPublisherCommit(...args);}};
 const api=createEditorHandlers({mode:'private-local',origin:f.server.origin,store,publisher,now:()=>f.clock}),c=client(f.server.origin,r=>api.handle(r));assert.equal((await c.call('login',f.account)).status,200);
 const bundle=(await c.call('publisher-document?'+query(f.pkg))).value.current_view,review={source_id:bundle.source_id,version:bundle.version,expected_package_sha256:bundle.package_sha256,reviews:[{kind:'text',package_sha256:bundle.content_sha256,status:'needs_correction',method:'codex_editorial',evidence_ref:'Fabricated revocation test'}]},plan=(await c.call('publisher-review-plan',review)).value.prepared,before=publisherStoreDigest(f.db);armed=true;assert.equal((await c.call('publisher-apply',plan)).status,401);assert.equal(publisherStoreDigest(f.db),before);
 const latest=JSON.parse(fs.readFileSync(f.accessFile));const late=createEditorHandlers({mode:'private-local',origin:f.server.origin,store:access,publisher:{...publisher,async document(...args){const result=await publisher.document(...args);fs.unlinkSync(f.accessFile);return result;}},now:()=>f.clock});const d=client(f.server.origin,r=>late.handle(r));assert.equal((await d.call('login',{editor_id:latest.editor_id,access_secret:latest.access_secret})).status,200);const result=await d.call('publisher-document?'+query(f.pkg));assert.equal(result.status,401);assert.equal(result.value.current_view,undefined);assert.doesNotMatch(JSON.stringify(result.value),/correct_index|evidence_ref/);
});
test('private UI and browser draft scope never present demo access or synthetic publication wording',()=>{
 const login=renderEditor({environment:'private-local',loading:false,busy:false,access:null});assert.doesNotMatch(login,/DEMO-EDITOR|synthetic-editor-qa|value="[a-f0-9]{64}"/);assert.match(login,/Mã truy cập riêng/);
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},access={publisher_editor:true,role:'editor',editor_id:'local-owner',csrf:'x'},api={csrf:'x'};
 const synthetic=new PublisherEditorClient({api,storage,access});synthetic.saveDraft('synthetic-only');const privateClient=new PublisherEditorClient({api,storage,access:{...access,environment:'private-local'}});assert.equal(privateClient.draft,null);privateClient.saveDraft('private-only');assert.equal(synthetic.draft,'synthetic-only');assert.notEqual(synthetic.key,privateClient.key);
 const workspace={environment:'private-local',client:privateClient,documents:[],nextCursor:null,view:null,catalogue:{snapshots:[]}},html=renderPublisherEditor(workspace);assert.match(html,/Danh mục riêng tư có phiên bản/);assert.doesNotMatch(html,/Chỉ dữ liệu mẫu|bản QA cục bộ|Thư viện QA|Tệp mẫu/);
 const screen=renderEditor({environment:'private-local',loading:false,busy:false,access:{...access,publisher_only:true},publisher:workspace,workspace:'publisher'});assert.doesNotMatch(screen,/workspace-legacy|Nội dung gốc/);
});

test('private editor CLI starts from explicit paths, never prints access keys and closes cleanly',async t=>{
 const f=await setup(t);const child=spawn(process.execPath,['scripts/read2lead-publisher-editor.mjs','--publisher-db',f.filename,'--asset-root',f.root,'--access-file',f.accessFile,'--dist-root',f.distRoot,'--port','0'],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});let output='',errors='';child.stderr.on('data',part=>errors+=part);const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLI readiness timeout')),10000);child.once('error',reject);child.stdout.on('data',part=>{output+=part;if(output.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(output.split('\n')[0]));}catch(e){reject(e);}}});child.once('exit',()=>{clearTimeout(timer);reject(Error('CLI exited before readiness: '+errors));});});
 assert.equal(ready.status,'ready');assert.equal(ready.environment,'private-local');assert.equal(ready.production_release_authorized,false);assert.ok(!output.includes(f.account.access_secret));assert.equal((await fetch(ready.url)).status,200);child.kill('SIGTERM');assert.deepEqual(await exit,{code:0,signal:null});
});
