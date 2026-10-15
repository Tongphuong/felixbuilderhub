import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SyntheticStore} from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import {SyntheticFamilyStore} from '../scripts/lib/read2lead-self-learn-family.mjs';
import {SyntheticGiftStore} from '../scripts/lib/read2lead-self-learn-gifts.mjs';
const read=n=>JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/'+n+'.json',import.meta.url),'utf8'));
const accounts=read('family-access').accounts,catalogue=read('gift-catalogue'),lesson=read('reference-lessons').lessons[2];
const staff={active:true,role:'staff',id:'synthetic-qa'},now='2026-09-19T00:00:00.000Z';
const roots=resolve('.r2l-gift-data-proofs');mkdirSync(roots,{recursive:true});
const marker=JSON.stringify({format:1,purpose:'read2lead-local-synthetic',database:'read2lead-synthetic.sqlite'});
function target(){const root=mkdtempSync(join(roots,'case-'));writeFileSync(join(root,'synthetic-target.json'),marker);return root;}
const config=root=>({mode:'synthetic-local',root});
const chosen={gift_id:catalogue.items[0].gift_id,quoted_version:'sample-v1'};
const goal=(more={})=>({request_id:'goal-1',expected_revision:0,goal:{...chosen},...more});
const purchase=(more={})=>({request_id:'buy-1',...chosen,...more});
const fails=(f,code)=>assert.throws(f,e=>e.code===code);
function fixture(t,fault=()=>{}){
 const root=target(),core=new SyntheticStore({root}),family=new SyntheticFamilyStore(config(root));for(const a of accounts)family.seed(staff,a,now);let gifts=new SyntheticGiftStore({...config(root),fault});gifts.seedCatalogue(staff,catalogue);
 t.after(()=>{gifts?.close();family.close();core.close();});
 return {root,core,family,get gifts(){return gifts;},db(){return new DatabaseSync(join(root,'read2lead-synthetic.sqlite'));},closeGifts(){gifts?.close();gifts=null;},reopen(){gifts?.close();gifts=null;gifts=new SyntheticGiftStore({...config(root),fault});},principal(childId='synthetic-an',i=0){return {...family.authenticateAccess(accounts[i].access_code),childId};},parent(){return family.elevateParent(family.authenticateAccess(accounts[0].access_code),accounts[0].parent_secret);}};
}
function tables(db,all=false){const result={};for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())if(all||!name.startsWith('gift_goal'))result[name]=JSON.parse(JSON.stringify(db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));return result;}
function snapshot(f,all=false){const db=f.db();try{return tables(db,all);}finally{db.close();}}
function count(f,table){const db=f.db();try{return db.prepare('SELECT count(*) AS n FROM '+table).get().n;}finally{db.close();}}
function invariant(f){const report=f.core.audit(staff);appendFileSync(join(roots,'reconciliations.jsonl'),JSON.stringify({root:f.root,...report})+'\n');assert.equal(report.ok,true,JSON.stringify(report));assert.equal(report.integrity,'ok');}
async function earn(f,childId='synthetic-an',sessionId='gift-practice'){
 const p=f.principal(childId);let session=(await f.core.start(p,{sessionId,childId,lesson,now})).session;
 const steps=[['prediction',{text:''}],['input_complete',{order:['read']}],...lesson.questions.map(q=>['answer',{item_id:q.id,choice_index:0,text:'',evidence_sentence_ids:['s1'],support_used:[],capture_status:'valid'}]),['save_understand',{}]];
 for(const [event,payload] of steps)session=f.core.submit(p,{api_version:'1.1',request_id:sessionId+'-'+(session.revision+1),child_id:childId,session_id:sessionId,expected_revision:session.revision,event,payload},now).session;
 assert.equal(f.gifts.view(p).wallet.balance,5);return session;
}
const profile=more=>({request_id:'profile-change',child_id:'synthetic-an',expected_revision:0,display_name:'An mẫu',archived:false,learning_enabled:true,recording_allowed:false,...more});
const recovery=()=>({family_id:accounts[0].family_id,request_id:'recover-gifts',recovery_code:accounts[0].recovery_code,new_access_code:'GIFT-FAMILY-NEXT',new_parent_secret:'GIFT-PARENT-NEXT',new_recovery_code:'GIFT-RECOVERY-NEXT-2026'});
function worker(f,operation,boundary='',request='gift-worker'){return new Promise((done,fail)=>{const p=spawn(process.execPath,['tests/fixtures/read2lead-self-learn/gift-worker.mjs',f.root,operation,boundary,request],{stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{p.kill('SIGKILL');fail(Error('gift_worker_timeout'));},20000);p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',fail);p.on('exit',(code,signal)=>{clearTimeout(timer);const result={code,signal,out,err};appendFileSync(join(roots,'process-evidence.jsonl'),JSON.stringify({root:f.root,operation,boundary,request,...result})+'\n');done(result);});});}

test('gift extension requires explicit synthetic mode,marked existing core and family schema',t=>{
 const root=target();fails(()=>new SyntheticGiftStore({...config(root),mode:'production'}),'unsafe_gift_mode');fails(()=>new SyntheticGiftStore(config(root)),'core_store_required');assert.equal(existsSync(join(root,'read2lead-synthetic.sqlite')),false);
 const core=new SyntheticStore({root});t.after(()=>core.close());fails(()=>new SyntheticGiftStore(config(root)),'family_store_required');const db=new DatabaseSync(join(root,'read2lead-synthetic.sqlite'));assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name GLOB 'gift_goal*'").get().n,0);db.close();
 const missing=mkdtempSync(join(roots,'unmarked-'));fails(()=>new SyntheticGiftStore(config(missing)),'unsafe_target');assert.equal(existsSync(join(missing,'read2lead-synthetic.sqlite')),false);
});
for(const mutation of ["UPDATE r2l_meta SET value='99' WHERE key='gift_goal_schema_version'","DROP TRIGGER gift_goal_receipts_no_update","ALTER TABLE gift_goals ADD COLUMN unexpected TEXT","DROP TRIGGER gift_goal_audit_no_update; CREATE TRIGGER gift_goal_audit_no_update BEFORE UPDATE ON gift_goal_audit BEGIN SELECT 1; END;","DELETE FROM r2l_meta WHERE key='gift_goal_schema_version'"])test('unknown or altered gift schema refused: '+mutation,t=>{
 const f=fixture(t);f.gifts.setGoal(f.principal(),goal(),now);f.closeGifts();const db=f.db();db.exec(mutation);const before=tables(db,true);fails(()=>new SyntheticGiftStore(config(f.root)),mutation.startsWith('UPDATE')?'unsupported_gift_schema':'unrecognized_gift_schema');assert.deepEqual(tables(db,true),before);db.close();
});
test('default and goal reads are defensive,bounded and have no writes',t=>{
 const f=fixture(t),p=f.principal('synthetic-binh'),before=snapshot(f,true),view=f.gifts.view(p);assert.equal(view.wallet.balance,0);assert.equal(view.goal.revision,0);assert.equal(view.goal.state,'none');assert.equal(view.catalogue.length,3);assert.deepEqual(view.orders,[]);view.catalogue[0].price_diamonds=0;assert.ok(f.gifts.view(p).catalogue.every(g=>g.price_diamonds>0));assert.deepEqual(snapshot(f,true),before);
});
test('setting,clearing and replaying goals cannot mutate wallet,learning or any other table',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal(),before=snapshot(f),first=f.gifts.setGoal(p,goal(),now);assert.equal(first.goal.revision,1);assert.equal(f.gifts.view(p).goal.ready,true);
 const clear=f.gifts.setGoal(p,goal({request_id:'clear',expected_revision:1,goal:null}),now);assert.equal(clear.goal.revision,2);const replay=f.gifts.setGoal(p,goal(),now);assert.deepEqual(replay,{...first,replayed:true});assert.equal(f.gifts.view(p).goal.state,'none');assert.equal(f.gifts.view(p).goal.revision,2);assert.equal(f.gifts.goalAudit(p).length,2);assert.deepEqual(snapshot(f),before);invariant(f);
});
test('goal validates current quote and revision; unavailable goals remain optional without spending',t=>{
 const f=fixture(t),p=f.principal();fails(()=>f.gifts.setGoal(p,goal({goal:{...chosen,quoted_version:'old'}}),now),'gift_changed');fails(()=>f.gifts.setGoal(p,goal({goal:{...chosen,gift_id:'synthetic-missing'}}),now),'gift_unavailable');fails(()=>f.gifts.setGoal(p,goal({expected_revision:1}),now),'stale_revision');
 f.gifts.setGoal(p,goal({goal:{gift_id:catalogue.items[2].gift_id,quoted_version:'sample-v1'}}),now);const v=f.gifts.view(p);assert.equal(v.goal.state,'unavailable');assert.equal(v.goal.ready,false);assert.equal(v.goal.remaining_diamonds,30);assert.equal(v.wallet.balance,0);fails(()=>f.gifts.setGoal(p,goal(),now),'request_conflict');assert.equal(count(f,'gift_goal_receipts'),1);
});
test('catalogue versions are immutable and price changes do not silently reapprove a goal or order',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal();f.gifts.setGoal(p,goal(),now);const invalid=structuredClone(catalogue);invalid.items[0].price_diamonds=4;fails(()=>f.gifts.seedCatalogue(staff,invalid),'immutable_version');const next=structuredClone(catalogue);Object.assign(next.items[0],{version:'sample-v2',price_diamonds:7});f.gifts.seedCatalogue(staff,next);const v=f.gifts.view(p);assert.equal(v.goal.state,'changed');assert.equal(v.goal.ready,false);assert.equal(v.goal.remaining_diamonds,2);fails(()=>f.gifts.redeem(p,purchase(),now),'gift_changed');fails(()=>f.gifts.redeem(p,purchase({quoted_version:'sample-v2'}),now),'insufficient_funds');assert.equal(count(f,'redemptions'),0);invariant(f);
});
test('insufficient funds and unavailable gift create no order,debit,audit or receipt',t=>{
 const f=fixture(t),p=f.principal(),before=snapshot(f,true);fails(()=>f.gifts.redeem(p,purchase(),now),'insufficient_funds');fails(()=>f.gifts.redeem(p,purchase({gift_id:catalogue.items[2].gift_id}),now),'gift_unavailable');assert.deepEqual(snapshot(f,true),before);invariant(f);
});
test('purchase exact replay keeps original receipt while current order and balance advance',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal(),first=f.gifts.redeem(p,purchase(),now);assert.equal(first.balance,0);assert.equal(first.redemption.status,'requested');const id=first.redemption.redemption_id;
 f.gifts.fulfil(staff,{request_id:'prepare',redemption_id:id,status:'preparing'},now);f.gifts.refund(staff,{request_id:'refund',redemption_id:id,reason:'synthetic-private-note'},now);
 assert.deepEqual(f.gifts.redeem(p,purchase(),now),{...first,replayed:true});const v=f.gifts.view(p);assert.equal(v.wallet.balance,5);assert.equal(v.orders[0].status,'refunded');assert.deepEqual(v.audit.map(a=>a.to_status),['refunded','rejected','preparing','requested']);const raw=JSON.stringify(v);for(const forbidden of ['synthetic-private-note','debit:','refund:','created_by','family_id','DEMO-','reason'])assert.equal(raw.includes(forbidden),false,forbidden);invariant(f);
});
test('staff delivery obeys transitions and never spends again; delivery refund stays refused',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal(),id=f.gifts.redeem(p,purchase(),now).redemption.redemption_id,body={request_id:'prepare',redemption_id:id,status:'preparing'};
 fails(()=>f.gifts.fulfil(staff,{...body,status:'delivered'},now),'invalid_transition');f.gifts.fulfil(staff,body,now);f.gifts.fulfil(staff,{...body,request_id:'deliver',status:'delivered'},now);assert.equal(f.gifts.fulfil(staff,body,now).redemption.status,'preparing');assert.equal(f.gifts.staffOrder(staff,id).order.status,'delivered');fails(()=>f.gifts.refund(staff,{request_id:'bad-refund',redemption_id:id,reason:'sample'},now),'invalid_transition');assert.equal(f.gifts.staffOrders(staff)[0].child_id,p.childId);assert.equal(f.gifts.view(p).wallet.balance,0);assert.equal(count(f,'ledger'),2);invariant(f);
});
test('distinct refunds for one debit credit once and preserve rejection audit',async t=>{
 const f=fixture(t);await earn(f);const id=f.gifts.redeem(f.principal(),purchase(),now).redemption.redemption_id;
 for(const request_id of ['refund-a','refund-b','refund-a'])f.gifts.refund(staff,{request_id,redemption_id:id,reason:'sample'},now);
 assert.equal(f.gifts.view(f.principal()).wallet.balance,5);assert.equal(count(f,'ledger'),3);assert.equal(count(f,'redemption_audit'),3);invariant(f);
});
test('family identity,child ownership and archived/disabled access checked before malformed requests',t=>{
 const f=fixture(t),p=f.principal();for(const bad of [null,{...p,active:false},{...p,role:'staff'},{...p,credentialVersion:99}]){fails(()=>f.gifts.view(bad),'unauthorized');fails(()=>f.gifts.setGoal(bad,null,now),'unauthorized');fails(()=>f.gifts.redeem(bad,null,now),'unauthorized');}
 for(const id of ['synthetic-chi','synthetic-missing'])fails(()=>f.gifts.view({...p,childId:id}),'wrong_child');f.family.updateChild(f.parent(),profile({learning_enabled:false}),now);for(const method of [()=>f.gifts.view(p),()=>f.gifts.setGoal(p,null,now),()=>f.gifts.redeem(p,null,now)])fails(method,'child_access_disabled');
});
test('family recovery invalidates reads,new writes and exact goal/purchase replay',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal();f.gifts.setGoal(p,goal(),now);f.gifts.redeem(p,purchase(),now);f.family.recover(recovery(),now);const before=snapshot(f,true);for(const action of [()=>f.gifts.view(p),()=>f.gifts.setGoal(p,goal(),now),()=>f.gifts.redeem(p,purchase(),now)])fails(action,'unauthorized');assert.deepEqual(snapshot(f,true),before);
});
for(const operation of ['goal','redeem'])for(const replay of [false,true])test('family revoked while waiting for '+operation+' write lock: replay='+replay,async t=>{
 let revoke=false;const f=fixture(t,name=>{if(name==='gift_before_write_lock'&&revoke){revoke=false;f.family.recover(recovery(),now);}});await earn(f);const p=f.principal(),act=()=>operation==='goal'?f.gifts.setGoal(p,goal(),now):f.gifts.redeem(p,purchase(),now);if(replay)act();const before=snapshot(f,true);revoke=true;fails(act,'unauthorized');const after=snapshot(f,true);for(const key of ['gift_goals','gift_goal_receipts','gift_goal_audit','redemptions','ledger','receipts','redemption_audit'])assert.deepEqual(after[key],before[key]);invariant(f);
});
for(const operation of ['goal','redeem','fulfil','refund','seed'])for(const replay of [false,true])test('current session callback before '+operation+' write/replay: '+replay,async t=>{
 let locked=false;const f=fixture(t,name=>{if(name==='gift_before_write_lock')locked=true;});await earn(f);const p=f.principal();let id;if(['fulfil','refund'].includes(operation))id=f.gifts.redeem(p,purchase(),now).redemption.redemption_id;
 const action=cb=>operation==='goal'?f.gifts.setGoal(p,goal(),now,cb):operation==='redeem'?f.gifts.redeem(p,purchase(),now,cb):operation==='fulfil'?f.gifts.fulfil(staff,{request_id:'prepare',redemption_id:id,status:'preparing'},now,cb):operation==='refund'?f.gifts.refund(staff,{request_id:'refund',redemption_id:id,reason:'sample'},now,cb):f.gifts.seedCatalogue(staff,catalogue,cb);
 if(replay)action();const before=snapshot(f,true);locked=false;fails(()=>action(()=>{assert.equal(locked,true);throw Object.assign(Error('access_expired'),{code:'access_expired'});}),'access_expired');assert.deepEqual(snapshot(f,true),before);invariant(f);
});
test('safe staff/child read callbacks deny access before returning data',t=>{
 const f=fixture(t);const deny=()=>{throw Object.assign(Error('access_expired'),{code:'access_expired'});};fails(()=>f.gifts.view(f.principal(),deny),'access_expired');fails(()=>f.gifts.staffOrders(staff,deny),'access_expired');fails(()=>f.gifts.staffOrder(staff,'anything',deny),'access_expired');fails(()=>f.gifts.staffOrders(f.principal()),'unauthorized');fails(()=>f.gifts.seedCatalogue(f.principal(),null),'unauthorized');fails(()=>f.gifts.fulfil(f.principal(),null,now),'unauthorized');fails(()=>f.gifts.refund(f.principal(),null,now),'unauthorized');
});
test('siblings and other families have separate optional goals and gift history',async t=>{
 const f=fixture(t);await earn(f);f.gifts.setGoal(f.principal(),goal(),now);f.gifts.redeem(f.principal(),purchase(),now);for(const p of [f.principal('synthetic-binh'),f.principal('synthetic-chi',1)]){const v=f.gifts.view(p);assert.equal(v.goal.revision,0);assert.equal(v.orders.length,0);assert.equal(v.audit.length,0);assert.equal(v.wallet.balance,0);}invariant(f);
});
test('immutable goal receipts/audit and retained goals refuse direct alteration/removal',t=>{
 const f=fixture(t);f.gifts.setGoal(f.principal(),goal(),now);const db=f.db();try{for(const table of ['gift_goal_receipts','gift_goal_audit'])for(const sql of ['DELETE FROM '+table,'UPDATE '+table+' SET child_id=child_id'])assert.throws(()=>db.exec(sql),/immutable/);assert.throws(()=>db.exec('DELETE FROM gift_goals'),/preserve/);}finally{db.close();}
});
test('recent100 goal audit retains101 complete receipt and audit records',t=>{
 const f=fixture(t),p=f.principal(),before=snapshot(f);for(let i=0;i<101;i++)f.gifts.setGoal(p,goal({request_id:'goal-'+i,expected_revision:i,goal:i%2?null:chosen}),now);const rows=f.gifts.goalAudit(p);assert.equal(rows.length,100);assert.equal(rows[0].revision,101);assert.equal(rows.at(-1).revision,2);assert.equal(count(f,'gift_goal_receipts'),101);assert.equal(count(f,'gift_goal_audit'),101);assert.deepEqual(snapshot(f),before);
});
test('native consistent backup reopens with every row intact and original receipt/current state separate',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal();f.gifts.setGoal(p,goal(),now);const receipt=f.gifts.redeem(p,purchase(),now);f.gifts.refund(staff,{request_id:'refund',redemption_id:receipt.redemption.redemption_id,reason:'sample'},now);const before=snapshot(f,true),destination=target(),db=f.db();db.prepare('VACUUM INTO ?').run(join(destination,'read2lead-synthetic.sqlite'));db.close();const copy=new SyntheticGiftStore(config(destination));try{assert.deepEqual(copy.view(p),f.gifts.view(p));assert.deepEqual(copy.redeem(p,purchase(),now),{...receipt,replayed:true});const check=new DatabaseSync(join(destination,'read2lead-synthetic.sqlite'));assert.deepEqual(tables(check,true),before);assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);check.close();}finally{copy.close();}
});
for(const boundary of ['gift_before_write_lock','gift_goal_updated','gift_goal_audit_inserted','gift_goal_receipt_inserted','gift_goal_before_commit','gift_goal_after_commit'])test('goal process death at '+boundary+' has atomic retry',async t=>{
 const f=fixture(t),before=snapshot(f),r=await worker(f,'goal',boundary);assert.equal(r.signal,'SIGKILL',JSON.stringify(r));f.reopen();const committed=boundary==='gift_goal_after_commit';assert.equal(count(f,'gift_goal_receipts'),committed?1:0);const retry=await worker(f,'goal');assert.equal(retry.code,0,retry.err);assert.equal(JSON.parse(retry.out).replayed,committed);assert.equal(count(f,'gift_goal_receipts'),1);assert.equal(count(f,'gift_goal_audit'),1);assert.deepEqual(snapshot(f),before);
});
for(const boundary of ['gift_before_write_lock','order_inserted','debit_inserted','receipt_inserted','before_commit','after_commit'])test('gift purchase process death at '+boundary+' has atomic retry',async t=>{
 const f=fixture(t);await earn(f);const r=await worker(f,'redeem',boundary);assert.equal(r.signal,'SIGKILL',JSON.stringify(r));f.reopen();const committed=boundary==='after_commit';assert.equal(count(f,'redemptions'),committed?1:0);const retry=await worker(f,'redeem');assert.equal(retry.code,0,retry.err);assert.equal(JSON.parse(retry.out).replayed,committed);assert.equal(count(f,'redemptions'),1);assert.equal(f.gifts.view(f.principal()).wallet.balance,0);invariant(f);
});
for(const boundary of ['gift_before_write_lock','refund_rejected','refund_credited','receipt_inserted','before_commit','after_commit'])test('gift refund process death at '+boundary+' has atomic retry',async t=>{
 const f=fixture(t);await earn(f);f.gifts.redeem(f.principal(),purchase({request_id:'gift-worker'}),now);const r=await worker(f,'refund',boundary);assert.equal(r.signal,'SIGKILL',JSON.stringify(r));f.reopen();const committed=boundary==='after_commit';assert.equal(f.gifts.view(f.principal()).wallet.balance,committed?5:0);const retry=await worker(f,'refund');assert.equal(retry.code,0,retry.err);assert.equal(JSON.parse(retry.out).replayed,committed);assert.equal(f.gifts.view(f.principal()).wallet.balance,5);assert.equal(count(f,'ledger'),3);invariant(f);
});
for(const operation of ['goal','redeem','refund'])test('two processes replay identical '+operation+' once',async t=>{
 const f=fixture(t);if(operation!=='goal')await earn(f);if(operation==='refund')f.gifts.redeem(f.principal(),purchase({request_id:'gift-worker'}),now);const r=await Promise.all([worker(f,operation),worker(f,operation)]);assert.ok(r.every(x=>x.code===0),JSON.stringify(r));assert.deepEqual(r.map(x=>JSON.parse(x.out).replayed).sort(),[false,true]);invariant(f);
});
for(const operation of ['goal','redeem','refund'])test('two distinct '+operation+' requests preserve revision/balance/refund invariants',async t=>{
 const f=fixture(t);if(operation!=='goal')await earn(f);if(operation==='refund')f.gifts.redeem(f.principal(),purchase({request_id:'gift-worker'}),now);const r=await Promise.all([worker(f,operation,'','first'),worker(f,operation,'','second')]);assert.deepEqual(r.map(x=>x.code).sort(),operation==='refund'?[0,0]:[0,2]);if(operation!=='refund')assert.equal(JSON.parse(r.find(x=>x.code===2).out).error,operation==='goal'?'stale_revision':'insufficient_funds');assert.equal(f.gifts.view(f.principal()).wallet.balance,operation==='refund'?5:0);invariant(f);
});
test('malformed goals,purchases and timestamps cannot choose arbitrary child or client price',t=>{
 const f=fixture(t),p=f.principal(),before=snapshot(f,true);
 for(const body of [null,{...goal(),extra:true},{...goal(),request_id:''},{...goal(),expected_revision:-1},{...goal(),expected_revision:1.1},{...goal(),expected_revision:Number.MAX_SAFE_INTEGER}])fails(()=>f.gifts.setGoal(p,body,now),'invalid_request');
 for(const body of [null,{...purchase(),child_id:'synthetic-binh'},{...purchase(),price:0},{...purchase(),request_id:''},{...purchase(),gift_id:'../gift'}])fails(()=>f.gifts.redeem(p,body,now),'invalid_request');
 for(const time of ['today','2026-09-19',null]){fails(()=>f.gifts.setGoal(p,goal(),time),'invalid_request');fails(()=>f.gifts.redeem(p,purchase(),time),'invalid_request');fails(()=>f.gifts.fulfil(staff,null,time),'invalid_request');fails(()=>f.gifts.refund(staff,null,time),'invalid_request');}
 assert.deepEqual(snapshot(f,true),before);
});
test('archiving child also blocks exact goal and purchase replay',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal();f.gifts.setGoal(p,goal(),now);f.gifts.redeem(p,purchase(),now);f.family.updateChild(f.parent(),profile({archived:true}),now);const before=snapshot(f,true);fails(()=>f.gifts.setGoal(p,goal(),now),'child_access_disabled');fails(()=>f.gifts.redeem(p,purchase(),now),'child_access_disabled');fails(()=>f.gifts.goalAudit(p),'child_access_disabled');assert.deepEqual(snapshot(f,true),before);
});
test('catalogue change preserves original order title and price through fulfilment and refund',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal(),receipt=f.gifts.redeem(p,purchase(),now),next=structuredClone(catalogue);Object.assign(next.items[0],{version:'sample-v2',title_vi:'Quà mẫu mới',price_diamonds:15,available:false});f.gifts.seedCatalogue(staff,next);const view=f.gifts.view(p);assert.equal(view.orders[0].title_vi,receipt.redemption.title_vi);assert.equal(view.orders[0].price_diamonds,5);assert.equal(view.catalogue.find(x=>x.gift_id===chosen.gift_id).price_diamonds,15);f.gifts.refund(staff,{request_id:'refund',redemption_id:receipt.redemption.redemption_id,reason:'sample'},now);assert.equal(f.gifts.view(p).wallet.balance,5);invariant(f);
});
test('bounded order/audit views retain all ledger,order and audit rows',async t=>{
 const f=fixture(t);await earn(f);const p=f.principal();for(let i=0;i<101;i++){const r=f.gifts.redeem(p,purchase({request_id:'purchase-'+i}),now);f.gifts.refund(staff,{request_id:'refund-'+i,redemption_id:r.redemption.redemption_id,reason:'private sample'},now);}
 const v=f.gifts.view(p);assert.equal(v.orders.length,100);assert.equal(v.orders[0].redemption_id,'synthetic-an:purchase-100');assert.equal(v.orders.at(-1).redemption_id,'synthetic-an:purchase-1');assert.equal(v.audit.length,100);assert.equal(f.gifts.staffOrders(staff).length,100);assert.equal(count(f,'redemptions'),101);assert.equal(count(f,'redemption_audit'),303);assert.equal(count(f,'ledger'),203);assert.equal(v.wallet.balance,5);invariant(f);
});
test('startup initialization preserves newer price,availability and every existing row',t=>{
 const f=fixture(t),next=structuredClone(catalogue);Object.assign(next.items[0],{version:'sample-v2',price_diamonds:8,available:false});f.gifts.seedCatalogue(staff,next);const before=snapshot(f,true);assert.deepEqual(f.gifts.initializeCatalogue(staff,catalogue),{ok:true,initialized:0});assert.deepEqual(snapshot(f,true),before);assert.equal(f.gifts.view(f.principal()).catalogue.find(g=>g.gift_id===chosen.gift_id).version,'sample-v2');
});
test('startup initialization fills only missing sample items and refuses invalid catalogue or role',t=>{
 const root=target(),core=new SyntheticStore({root}),family=new SyntheticFamilyStore(config(root));for(const a of accounts)family.seed(staff,a,now);const gifts=new SyntheticGiftStore(config(root));t.after(()=>{gifts.close();family.close();core.close();});fails(()=>gifts.initializeCatalogue({active:true,role:'child'},catalogue),'unauthorized');fails(()=>gifts.initializeCatalogue(staff,{...catalogue,real_rewards:true}),'invalid_gift_catalogue');assert.deepEqual(gifts.initializeCatalogue(staff,catalogue),{ok:true,initialized:3});assert.deepEqual(gifts.initializeCatalogue(staff,catalogue),{ok:true,initialized:0});
});
