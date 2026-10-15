import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { request as httpRequest } from 'node:http';
import { initializeSyntheticTarget,startLocalQA } from '../scripts/read2lead-local-qa.mjs';
import { syntheticQAReport } from '../scripts/read2lead-self-learn-qa-report.mjs';
const roots=resolve('.r2l-integrated-proofs');mkdirSync(roots,{recursive:true});
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/'+name+'.json',import.meta.url),'utf8'));
const editorLogin={editor_id:'synthetic-editor-qa',access_secret:'DEMO-EDITOR-LOCAL-ONLY'};
const roles={child:{prefix:'/api/read2lead/self-learn/',csrf:'x-r2l-csrf',read:'gifts',write:'event',login:{access_code:'DEMO-FAMILY-A'},readLimit:180},editor:{prefix:'/api/read2lead/editor/',csrf:'x-r2l-editor-csrf',read:'documents',write:'draft',login:editorLogin,readLimit:240},staff:{prefix:'/api/read2lead/gifts-staff/',csrf:'x-r2l-gift-csrf',read:'orders',write:'refund',login:editorLogin,readLimit:180}};
async function setup(t){
 const root=mkdtempSync(join(roots,'case-')),dataRoot=join(root,'data'),distRoot=join(root,'dist');
 for(const page of ['self-learn','editor','gifts-staff']){mkdirSync(join(distRoot,'read2lead',page),{recursive:true});writeFileSync(join(distRoot,'read2lead',page,'index.html'),'<!doctype html><title>Synthetic integrated HTTP fixture</title>');}
 initializeSyntheticTarget(dataRoot);let clock=Date.parse('2026-09-19T00:00:00.000Z');
 const qa=await startLocalQA({mode:'synthetic-local',dataRoot,distRoot,port:0,now:()=>clock});t.after(()=>qa.close());return {root,dataRoot,qa,advance(ms){clock+=ms;}};
}
function client(f,kind='child'){
 const role=roles[kind],samples=[];let cookie='',csrf='';
 return {role,samples,get cookie(){return cookie;},get csrf(){return csrf;},async call(route,data,override={}){
  const method=override.method||(data===undefined?'GET':'POST'),started=performance.now();
  const response=await fetch(f.qa.origin+role.prefix+route,{method,headers:{...(cookie?{cookie}:{}),...(method==='POST'?{origin:f.qa.origin,'content-type':'application/json',[role.csrf]:csrf}:{}),...override.headers},...(!['GET','HEAD'].includes(method)?{body:override.raw??JSON.stringify(data)}:{})});
  const text=await response.text(),value=response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text;samples.push({ms:performance.now()-started,status:response.status,bytes:Buffer.byteLength(text)});
  if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value?.csrf)csrf=value.csrf;
  return {response,value};
 }};
}
function snapshot(root){const db=new DatabaseSync(join(root,'read2lead-synthetic.sqlite'),{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));}finally{db.close();}}
async function logged(f,kind='child'){const c=client(f,kind),r=await c.call('login',c.role.login);assert.equal(r.response.status,200,JSON.stringify(r.value));assert.match(r.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/api\/read2lead\//);return c;}
const safe=value=>assert.doesNotMatch(JSON.stringify(value),/PRIVATE_INTEGRATED|synthetic-secret-|synthetic-opaque-value|correct_index|accepted_meanings|evidence_spans|access_secret|parent_secret|recovery_secret|recording_url|private_scores/);
// Raw HTTP is necessary for forged Host: Node fetch normalizes Host to its URL.
function rawStatus(url,headers){return new Promise((resolve,reject)=>{const req=httpRequest(url,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('synthetic_request_timeout')));req.end();});}

test('integrated HTTP denies cross-role cookies and malformed unauthenticated requests before parsing',async t=>{
 const f=await setup(t),clients={};for(const kind of Object.keys(roles))clients[kind]=await logged(f,kind);const before=snapshot(f.dataRoot);
 for(const [kind,c] of Object.entries(clients)){
  for(const [other,foreign] of Object.entries(clients))if(other!==kind){const r=await c.call(c.role.read,undefined,{headers:{cookie:foreign.cookie}});assert.equal(r.response.status,401);assert.deepEqual(r.value,{ok:false,code:'unauthorized'});}
  let r=await c.call(c.role.write,{}, {raw:'{',headers:{cookie:''}});assert.equal(r.response.status,401);assert.equal(r.value.code,'unauthorized');
  r=await c.call(c.role.write,{}, {raw:'{',headers:{[c.role.csrf]:'forged'}});assert.equal(r.response.status,403);assert.equal(r.value.code,'csrf_failed');
  r=await c.call(c.role.read,undefined,{headers:{cookie:c.cookie+'; '+c.cookie}});assert.equal(r.response.status,401);
  r=await c.call(c.role.read,undefined,{headers:{cookie:'x'.repeat(9000)}});assert.equal(r.response.status,401);
 }
 assert.deepEqual(snapshot(f.dataRoot),before);
});

test('integrated HTTP rejects cross-origin, methods, oversized and malformed bodies without durable effects',async t=>{
 const f=await setup(t),clients=[];for(const kind of Object.keys(roles))clients.push(await logged(f,kind));const before=snapshot(f.dataRoot);
 for(const c of clients){
  for(const headers of [{origin:'https://foreign.invalid'},{'sec-fetch-site':'cross-site'},{host:'foreign.invalid'}])assert.equal(await rawStatus(f.qa.origin+c.role.prefix+c.role.read,{cookie:c.cookie,...headers}),403,JSON.stringify(headers));
  assert.equal((await c.call(c.role.write,{}, {method:'PUT'})).response.status,405);
  const large=await c.call(c.role.write,{}, {raw:JSON.stringify({untrusted:'x'.repeat(300000)})});assert.equal(large.response.status,413);assert.equal(large.value.code,'body_too_large');assert.equal(large.response.headers.get('connection'),'close');
  const malformed=await c.call(c.role.write,{}, {raw:'{'});assert.equal(malformed.response.status,400);assert.equal(malformed.value.code,'invalid_json');
  const media=await c.call(c.role.write,{}, {headers:{'content-type':'text/plain'}});assert.equal(media.response.status,415);assert.equal(media.value.code,'unsupported_media_type');
  assert.equal((await c.call(c.role.read)).response.status,200);
 }
 assert.deepEqual(snapshot(f.dataRoot),before);
});

test('security headers cover every local role and static surface; private files and traversal remain unavailable',async t=>{
 const f=await setup(t);
 for(const path of ['/read2lead/self-learn/','/read2lead/editor/','/read2lead/gifts-staff/']){
  const r=await fetch(f.qa.origin+path);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
 for(const path of ['/tests/fixtures/read2lead-self-learn/family-access.json','/scripts/read2lead-local-qa.mjs','/.git/config','/data/read2lead-synthetic.sqlite','/%2e%2e%2fprivate','/read2lead/%5cprivate']){const r=await fetch(f.qa.origin+path);assert.ok([400,404].includes(r.status));safe(await r.text());}
 for(const kind of Object.keys(roles)){const c=await logged(f,kind),r=await c.call(c.role.read);assert.equal(r.response.status,200);assert.equal(r.response.headers.get('cache-control'),'no-store');safe(r.value);}
});

test('family and parent boundaries do not leak legacy secrets, private input or another child state',async t=>{
 const f=await setup(t),a=await logged(f),b=client(f);await b.call('login',{access_code:'DEMO-FAMILY-B'});const lesson=fixture('level-lessons').lessons[2];
 const start=await a.call('start',{request_id:'integrated-start',child_id:'synthetic-an',lesson_id:lesson.id});assert.equal(start.response.status,200);const s=start.value.view.session;
 assert.equal((await a.call('event',{api_version:'1.2',request_id:'integrated-prediction',child_id:'synthetic-an',session_id:s.session_id,expected_revision:s.revision,event:'prediction',payload:{text:'PRIVATE_INTEGRATED_CHILD_INPUT'}})).response.status,200);
 const before=snapshot(f.dataRoot);
 assert.equal((await b.call('session?session_id='+s.session_id)).response.status,403);assert.equal((await b.call('child',{child_id:'synthetic-an'})).response.status,403);assert.equal((await a.call('parent/family')).response.status,403);
 assert.equal((await a.call('gifts/goal',{request_id:'wrong-child',child_id:'synthetic-binh',expected_revision:0,goal:null})).response.status,403);
 assert.deepEqual(snapshot(f.dataRoot),before);
 assert.equal((await a.call('parent/enter',{parent_secret:'DEMO-PARENT-A-ONLY'})).response.status,200);
 for(const route of ['parent/family','game','game/audit','gifts','library']){const r=await a.call(route);assert.equal(r.response.status,200,JSON.stringify(r.value));safe(r.value);}
 f.advance(900001);assert.equal((await a.call('parent/family')).response.status,403);assert.equal((await a.call('gifts')).response.status,200);
});

function distribution(samples){const ms=samples.map(x=>x.ms).sort((a,b)=>a-b),at=q=>Number(ms[Math.max(0,Math.ceil(ms.length*q)-1)].toFixed(3));return {requests:samples.length,statuses:Object.fromEntries([...new Set(samples.map(x=>x.status))].map(status=>[status,samples.filter(x=>x.status===status).length])),response_bytes:samples.reduce((sum,x)=>sum+x.bytes,0),p50_ms:at(.5),p95_ms:at(.95),max_ms:at(1)};}
test('bounded eight-request concurrency reaches exact role read limits then recovers without database drift',async t=>{
 const f=await setup(t),clients=[];for(const kind of Object.keys(roles))clients.push(await logged(f,kind));const before=snapshot(f.dataRoot),results=[];
 for(const c of clients){const start=c.samples.length,total=c.role.readLimit+5,began=performance.now();for(let n=0;n<total;n+=8)await Promise.all(Array.from({length:Math.min(8,total-n)},()=>c.call(c.role.read)));const samples=c.samples.slice(start),summary=distribution(samples);assert.equal(summary.statuses[200],c.role.readLimit);assert.equal(summary.statuses[429],5);assert.equal(Object.keys(summary.statuses).length,2);results.push({role_prefix:c.role.prefix,concurrency:8,wall_ms:Number((performance.now()-began).toFixed(3)),...summary});}
 assert.deepEqual(snapshot(f.dataRoot),before);assert.equal(f.qa.diagnostics().provider_enabled,false);f.advance(60001);for(const c of clients)assert.equal((await c.call(c.role.read)).response.status,200);assert.deepEqual(snapshot(f.dataRoot),before);
 writeFileSync(join(f.root,'load-report.json'),JSON.stringify({scope:'synthetic-loopback-read-load',profiles:results,requests:results.reduce((n,r)=>n+r.requests,0),provider_enabled:false,provider_calls:0,metered_provider_cost_usd:0,all_durable_rows_unchanged:true,limits:'Per-role counters are process-local synthetic safeguards, not a distributed production limit or capacity promise.',independent_review:false},null,2)+'\n');
});

test('login abuse cap is shared per role, bounded and recovers after its time window',async t=>{
 const f=await setup(t),before=snapshot(f.dataRoot);
 for(const kind of Object.keys(roles)){
  const c=client(f,kind),bad=kind==='child'?{access_code:'SYNTHETIC-WRONG'}:{editor_id:editorLogin.editor_id,access_secret:'SYNTHETIC-WRONG'};
  for(let i=0;i<20;i++)assert.equal((await c.call('login',bad)).response.status,401);
  assert.equal((await c.call('login',c.role.login)).response.status,429);
 }
 assert.deepEqual(snapshot(f.dataRoot),before);f.advance(60001);for(const kind of Object.keys(roles))await logged(f,kind);assert.deepEqual(snapshot(f.dataRoot),before);
});

test('complete HTTP journey interleaves parent view, gift debit/refund and later reward while preserving legacy progress',async t=>{
 const f=await setup(t),c=await logged(f),staff=await logged(f,'staff'),lesson=fixture('level-lessons').lessons[2],legacy=(await c.call('game')).value.game.legacy_progress;let request=0;
 const started=await c.call('start',{request_id:'combined-start',child_id:'synthetic-an',lesson_id:lesson.id});assert.equal(started.response.status,200);let session=started.value.view.session;
 async function event(name,payload={}){f.advance(1000);const r=await c.call('event',{api_version:'1.2',request_id:'combined-'+(++request),child_id:'synthetic-an',session_id:session.session_id,expected_revision:session.revision,event:name,payload});assert.equal(r.response.status,200,JSON.stringify(r.value));session=(r.value.current_view||r.value.view).session;return r;}
 await event('prediction',{text:'PRIVATE_INTEGRATED_COMBINED'});await event('input_complete',{order:['read']});for(const q of lesson.questions)await event('answer',{item_id:q.id,choice_index:q.correct_index,text:'',evidence_sentence_ids:q.evidence_spans.map(x=>x.sentence_id),support_used:[],capture_status:'not_attempted'});await event('save_understand');await event('pause');
 assert.equal((await c.call('parent/enter',{parent_secret:'DEMO-PARENT-A-ONLY'})).response.status,200);const family=await c.call('parent/family');safe(family.value);assert.equal(family.value.children.find(x=>x.id==='synthetic-an').wallet.balance,5);await c.call('parent/exit',{});
 const bought=await c.call('gifts/redeem',{request_id:'combined-buy',child_id:'synthetic-an',gift_id:'synthetic-encouragement-card',quoted_version:'sample-v1'});assert.equal(bought.response.status,200,JSON.stringify(bought.value));const order=bought.value.receipt.redemption.redemption_id;assert.equal(bought.value.current_gifts.wallet.balance,0);
 assert.equal((await staff.call('fulfil',{request_id:'combined-prepare',redemption_id:order,status:'preparing'})).response.status,200);assert.equal((await staff.call('refund',{request_id:'combined-refund',redemption_id:order,reason:'PRIVATE_INTEGRATED_REFUND'})).response.status,200);
 await event('resume');await event('begin_use');const speech={text:'',capture_status:'not_attempted',support_used:[]};await event('shadow_complete',speech);
 for(const turn of lesson.minny.turns){const dialogue=await c.call('dialogue?session_id='+session.session_id);assert.equal(dialogue.response.status,200);await event('minny_turn',{...speech,turn_id:turn.id});}
 await event('retell',speech);await event('skip_followup');await event('complete');const gifts=await c.call('gifts');assert.equal(gifts.value.gifts.wallet.balance,10);assert.equal(gifts.value.gifts.orders[0].status,'refunded');safe(gifts.value);assert.deepEqual((await c.call('game')).value.game.legacy_progress,legacy);assert.equal(f.qa.diagnostics().provider_enabled,false);
 const report=syntheticQAReport({mode:'synthetic-local',dataRoot:f.dataRoot});assert.equal(report.levels[0].completed,1);assert.equal(report.value_safety.synthetic_diamonds,10);writeFileSync(join(f.root,'operational-report.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(join(f.root,'journey-cost-report.json'),JSON.stringify({scope:'synthetic-complete-http-journey-with-parent-and-gift-operations',learner_requests:c.samples.length,staff_requests:staff.samples.length,learner_timing:distribution(c.samples),staff_timing:distribution(staff.samples),provider_enabled:false,provider_calls:0,metered_provider_cost_usd:0,production_cost:'unmeasured',independent_review:false},null,2)+'\n');
});
