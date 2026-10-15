import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
const lesson = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/reference-lessons.json', import.meta.url))).lessons[2];
const staff={active:true,role:'staff',id:'synthetic-staff'}, child={active:true,childId:'synthetic-a'}, now='2026-09-18T12:00:00.000Z';
const marker={format:1,purpose:'read2lead-local-synthetic',database:'read2lead-synthetic.sqlite'};
const roots=resolve('.r2l-data-proofs');mkdirSync(roots,{recursive:true});
const storeRoots=new WeakMap();
function openStore(options){const store=new SyntheticStore(options);storeRoots.set(store,options.root);return store;}
function root(){const p=mkdtempSync(join(roots,'case-'));writeFileSync(join(p,'synthetic-target.json'),JSON.stringify(marker));return p;}
function refuses(fn,code){assert.throws(fn,e=>e.code===code,code);}
function event(session,name,payload={},request_id='event-'+(session.revision+1)){return {api_version:'1.1',request_id,child_id:session.child_id,session_id:session.session_id,expected_revision:session.revision,event:name,payload};}
function steps(){const speech={text:'',capture_status:'missing',support_used:[]};return [['prediction',{text:''}],['input_complete',{order:['read']}],...lesson.questions.map(q=>['answer',{item_id:q.id,choice_index:0,text:'',evidence_sentence_ids:['s1'],support_used:[],capture_status:'valid'}]),['save_understand',{}],['begin_use',{}],['shadow_complete',speech],...lesson.minny.turns.map(t=>['minny_turn',{...speech,turn_id:t.id}]),['retell',speech],['complete',{}]];}
async function fixture(through='complete',price=10){
 const directory=root(),store=openStore({root:directory});store.registerChild(staff,{child_id:'synthetic-a',family_id:'synthetic-family',display_name:'An sample'});store.setGift(staff,{gift_id:'ball',version:'v1',title:'Sample ball',price,available:true});
 let session=(await store.start(child,{sessionId:'sample-session',childId:child.childId,lesson,now})).session;
 for(const [name,p] of steps()){if(through==='before-complete'&&name==='complete')break;session=store.submit(child,event(session,name,p),now).session;if(name===through)break;}
 return {root:directory,store,session};
}
const purchase=(id='buy-1')=>({request_id:id,child_id:'synthetic-a',gift_id:'ball',quoted_version:'v1'});
async function workers(configs){
 const children=configs.map(config=>{
  const process=fork(new URL('./fixtures/read2lead-self-learn/data-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});let result,stderr='';
  process.stderr.on('data',chunk=>stderr+=chunk);
  const ready=new Promise((resolve,reject)=>{process.on('message',m=>{if(m.type==='ready')resolve();if(m.type==='setup-error')reject(Error(m.code));if(m.type==='result')result=m;});process.once('error',reject);});
  const finished=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.kill();reject(Error('synthetic_worker_timeout'));},15000);process.on('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,result,stderr});});process.once('error',reject);});
  process.send({type:'prepare',now,...config});return {process,ready,finished};
 });
 await Promise.all(children.map(x=>x.ready));children.forEach(x=>x.process.send({type:'run'}));const results=await Promise.all(children.map(x=>x.finished));configs.forEach((config,i)=>appendFileSync(join(roots,'process-evidence.jsonl'),JSON.stringify({root:config.root,method:config.method,crashAt:config.crashAt??null,request_id:config.data.request_id,exit_code:results[i].code,result:results[i].result??null})+'\n'));return results;
}
function invariant(store){const report=store.audit(staff);appendFileSync(join(roots,'reconciliations.jsonl'),JSON.stringify({root:storeRoots.get(store),...report})+'\n');assert.equal(report.ok,true,JSON.stringify(report));assert.equal(report.integrity,'ok');return report;}
test('synthetic target guard refuses missing/live/traversal/symlink/foreign DB before mutation',()=>{
 const missing=mkdtempSync(join(roots,'no-marker-'));refuses(()=>openStore({root:missing}),'unsafe_target');assert.equal(existsSync(join(missing,marker.database)),false);
 for(const change of [{purpose:'production'},{database:'../production.sqlite'},{binding:'live-resource'}]){const r=root();writeFileSync(join(r,'synthetic-target.json'),JSON.stringify({...marker,...change}));refuses(()=>openStore({root:r}),'unsafe_target');assert.equal(existsSync(join(r,marker.database)),false);}
 const r=root(),link=join(roots,'linked-'+Date.now());symlinkSync(r,link);refuses(()=>openStore({root:link}),'unsafe_target');
 const foreign=root(),path=join(foreign,marker.database),db=new DatabaseSync(path);db.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES(\'synthetic sentinel\');');db.close();const bytes=readFileSync(path);refuses(()=>openStore({root:foreign}),'unsafe_target');assert.deepEqual(readFileSync(path),bytes);
});
test('actual persisted complete journey credits two synthetic milestones, reopen/replay preserves state',async()=>{
 const f=await fixture();assert.equal(f.store.wallet(child,child.childId).balance,10);assert.equal(invariant(f.store).entries,2);f.store.close();
 const store=openStore({root:f.root});assert.equal(store.read(child,child.childId,'sample-session').stage,'complete');const initial=await store.start(child,{sessionId:'sample-session',childId:child.childId,lesson,now});assert.equal(initial.replayed,true);assert.equal(store.wallet(child,child.childId).balance,10);invariant(store);store.close();
});
test('ownership and auth take precedence; clients cannot supply credit, price or completion authority',async()=>{
 const f=await fixture('prediction');refuses(()=>f.store.submit(null,null,now),'unauthorized');refuses(()=>f.store.submit(child,{child_id:'synthetic-b',diamonds:999},now),'wrong_child');
 refuses(()=>f.store.submit(child,{...event(f.session,'complete'),diamonds:999},now),'invalid_request');refuses(()=>f.store.submit(child,event(f.session,'complete'),now),'invalid_transition');
 refuses(()=>f.store.redeem(child,{...purchase(),price:0},now),'invalid_request');refuses(()=>f.store.wallet({active:true,childId:'synthetic-b'},child.childId),'wrong_child');refuses(()=>f.store.refund(child,{request_id:'r',redemption_id:'x',reason:'x'},now),'unauthorized');
 assert.equal(f.store.wallet(child,child.childId).balance,0);assert.equal(invariant(f.store).entries,0);f.store.close();
});
test('conditional debit affecting zero rows rolls back order and receipt',async()=>{
 const f=await fixture('save_understand');refuses(()=>f.store.redeem(child,purchase(),now),'insufficient_funds');const wallet=f.store.wallet(child,child.childId);assert.equal(wallet.balance,5);assert.equal(wallet.redemptions.length,0);assert.equal(invariant(f.store).entries,1);f.store.close();
});
test('server prices, immutable versions, unavailable gifts and original replay price',async()=>{
 const f=await fixture();const first=f.store.redeem(child,purchase(),now);assert.equal(first.redemption.price,10);assert.equal(first.balance,0);
 refuses(()=>f.store.setGift(staff,{gift_id:'ball',version:'v1',title:'Sample ball',price:1,available:true}),'immutable_version');
 f.store.setGift(staff,{gift_id:'ball',version:'v2',title:'Sample ball',price:20,available:true});refuses(()=>f.store.redeem(child,purchase('old-quote'),now),'gift_changed');
 const replay=f.store.redeem(child,purchase(),now);assert.deepEqual(replay,{...first,replayed:true});refuses(()=>f.store.redeem(child,{...purchase(),quoted_version:'v2'},now),'request_conflict');
 f.store.setGift(staff,{gift_id:'ball',version:'v3',title:'Sample ball',price:20,available:false});refuses(()=>f.store.redeem(child,{...purchase('unavailable'),quoted_version:'v3'},now),'gift_unavailable');invariant(f.store);f.store.close();
});
test('competing processes can afford only one purchase; no overspend or dangling order',async()=>{
 const f=await fixture();f.store.close();const results=await workers(['a','b'].map(id=>({root:f.root,method:'redeem',principal:child,data:purchase('race-'+id)})));
 assert.equal(results.filter(x=>x.result?.ok).length,1);assert.equal(results.filter(x=>x.result?.code==='insufficient_funds').length,1);
 const store=openStore({root:f.root}),wallet=store.wallet(child,child.childId);assert.equal(wallet.balance,0);assert.equal(wallet.redemptions.length,1);assert.equal(invariant(store).entries,3);store.close();
});
test('simultaneous identical purchase returns saved receipt without duplicate debit',async()=>{
 const f=await fixture();f.store.close();const results=await workers([1,2].map(()=>({root:f.root,method:'redeem',principal:child,data:purchase('same')})));assert.ok(results.every(x=>x.result?.ok));assert.equal(results.filter(x=>x.result.result.replayed).length,1);
 const store=openStore({root:f.root});assert.equal(invariant(store).entries,3);assert.equal(store.wallet(child,child.childId).balance,0);store.close();
});
for(const identical of [true,false])test(`simultaneous milestone submissions, identical=${identical}, credit once`,async()=>{
 const f=await fixture('before-complete');f.store.close();const requests=[event(f.session,'complete',{},'completion-a'),event(f.session,'complete',{},identical?'completion-a':'completion-b')];
 const results=await workers(requests.map(data=>({root:f.root,method:'submit',principal:child,data})));assert.equal(results.filter(x=>x.result?.ok).length,identical?2:1);if(!identical)assert.equal(results.filter(x=>x.result?.code==='stale_revision').length,1);
 const store=openStore({root:f.root});assert.equal(store.wallet(child,child.childId).balance,10);assert.equal(invariant(store).entries,2);assert.equal(store.read(child,child.childId,'sample-session').stage,'complete');store.close();
});
test('refund exactly once across same/different request IDs and competing processes',async()=>{
 const f=await fixture(),order=f.store.redeem(child,purchase(),now).redemption;f.store.close();const args=id=>({request_id:id,redemption_id:order.id,reason:'Synthetic unavailable item'});
 const results=await workers(['refund-a','refund-b'].map(id=>({root:f.root,method:'refund',principal:staff,data:args(id)})));assert.ok(results.every(x=>x.result?.ok));
 const store=openStore({root:f.root});store.refund(staff,args('refund-a'),now);store.refund(staff,args('refund-c'),now);assert.equal(store.wallet(child,child.childId).balance,10);assert.equal(store.wallet(child,child.childId).redemptions[0].status,'refunded');assert.equal(invariant(store).entries,4);store.close();
});
test('fulfilment transitions are explicit; delivered refund awaits business policy',async()=>{
 const f=await fixture(),order=f.store.redeem(child,purchase(),now).redemption;
 refuses(()=>f.store.fulfil(staff,{request_id:'jump',redemption_id:order.id,status:'delivered'},now),'invalid_transition');f.store.fulfil(staff,{request_id:'prepare',redemption_id:order.id,status:'preparing'},now);f.store.fulfil(staff,{request_id:'deliver',redemption_id:order.id,status:'delivered'},now);
 refuses(()=>f.store.refund(staff,{request_id:'late-refund',redemption_id:order.id,reason:'Sample'},now),'invalid_transition');invariant(f.store);f.store.close();
});
for(const boundary of ['session_saved','milestone_posted','receipt_inserted','before_commit','after_commit'])test(`abrupt session process exit at ${boundary} restores and replays safely`,async()=>{
 const f=await fixture('before-complete'),data=event(f.session,'complete',{},'crash-completion');f.store.close();const [crash]=await workers([{root:f.root,method:'submit',principal:child,data,crashAt:boundary}]);assert.equal(crash.code,86);
 const store=openStore({root:f.root});assert.equal(store.wallet(child,child.childId).balance,boundary==='after_commit'?10:5);assert.equal(store.read(child,child.childId,'sample-session').stage,boundary==='after_commit'?'complete':'retell');invariant(store);store.submit(child,data,now);assert.equal(store.wallet(child,child.childId).balance,10);assert.equal(invariant(store).entries,2);store.close();
});
for(const boundary of ['order_inserted','debit_inserted','receipt_inserted','before_commit','after_commit'])test(`abrupt purchase process exit at ${boundary} leaves no partial paid order`,async()=>{
 const f=await fixture();f.store.close();const data=purchase('crash-buy'),[crash]=await workers([{root:f.root,method:'redeem',principal:child,data,crashAt:boundary}]);assert.equal(crash.code,86);
 const store=openStore({root:f.root}),wallet=store.wallet(child,child.childId);assert.equal(wallet.balance,boundary==='after_commit'?0:10);assert.equal(wallet.redemptions.length,boundary==='after_commit'?1:0);invariant(store);store.redeem(child,data,now);assert.equal(store.wallet(child,child.childId).balance,0);assert.equal(invariant(store).entries,3);store.close();
});
for(const boundary of ['refund_rejected','refund_credited','receipt_inserted','before_commit','after_commit'])test(`abrupt refund process exit at ${boundary} restores debit/refund audit consistently`,async()=>{
 const f=await fixture(),order=f.store.redeem(child,purchase(),now).redemption;f.store.close();const data={request_id:'crash-refund',redemption_id:order.id,reason:'Synthetic cancellation'},[crash]=await workers([{root:f.root,method:'refund',principal:staff,data,crashAt:boundary}]);assert.equal(crash.code,86);
 const store=openStore({root:f.root}),wallet=store.wallet(child,child.childId);assert.equal(wallet.balance,boundary==='after_commit'?10:0);assert.equal(wallet.redemptions[0].status,boundary==='after_commit'?'refunded':'requested');invariant(store);store.refund(staff,data,now);assert.equal(store.wallet(child,child.childId).balance,10);assert.equal(invariant(store).entries,4);store.close();
});
test('database constraints reject ledger edit/delete and orphan paid-looking order',async()=>{
 const f=await fixture();f.store.close();const db=new DatabaseSync(join(f.root,marker.database));db.exec('PRAGMA foreign_keys=ON');assert.throws(()=>db.exec('UPDATE ledger SET delta=100'),/immutable_ledger/);assert.throws(()=>db.exec('DELETE FROM ledger'),/immutable_ledger/);
 db.exec('BEGIN IMMEDIATE');db.prepare("INSERT INTO redemptions(id,child_id,gift_id,gift_version,price,status,debit_id,created_at,updated_at) VALUES('orphan','synthetic-a','ball','v1',10,'requested','missing',?,?)").run(now,now);assert.throws(()=>db.exec('COMMIT'),/FOREIGN KEY/);db.exec('ROLLBACK');db.close();const store=openStore({root:f.root});assert.equal(invariant(store).entries,2);store.close();
});
