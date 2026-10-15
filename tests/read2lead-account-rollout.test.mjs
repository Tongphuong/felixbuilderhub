import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {prepareAccountSnapshot,importAccountSnapshot,snapshotAccountStore,prepareAccountRollout,mergeAccountSnapshot} from '../functions/lib/read2lead/account-snapshot.mjs';
import {createAccountTransactionRunner} from '../functions/lib/read2lead/account-transactions.mjs';
const row=(namespace,key,value,expires=null,metadata=null)=>({namespace,key,value,expires,metadata});
async function fixture(t,progressInCodes=false){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const run=createAccountTransactionRunner({db,transaction,progressInCodes});const ns=progressInCodes?'codes':'progress';
 const original=await prepareAccountSnapshot({sourceId:'existing-test-import',progressInCodes,records:[row('codes','R2L-QA','{"is_test":true,"history":["saved-sky"]}'),row(ns,'progress:R2L-QA','{"diamonds":520}'),row('codes','same-config',' { "unchanged": true } ')]});
 await importAccountSnapshot({db,transaction,snapshot:original,expectedSha256:original.sha256,progressInCodes});
 db.exec('CREATE TABLE story_sessions (id TEXT PRIMARY KEY,state TEXT); CREATE TABLE voice_receipts (id TEXT PRIMARY KEY,amount INTEGER)');
 db.prepare('INSERT INTO story_sessions VALUES(?,?)').run('saved-session','{"questionIndex":12,"pictureRetell":"complete","unknown_future_field":true}');db.prepare('INSERT INTO voice_receipts VALUES(?,?)').run('saved-reward',200);
 const source=await prepareAccountSnapshot({sourceId:'frozen-legacy-backup',progressInCodes,records:[row('codes','R2L-QA','{"is_test":true,"history":[]}'),row(ns,'progress:R2L-QA','{"diamonds":70}'),row('codes','r2l_link:stale-qa','{"access_code":"R2L-QA"}'),row('codes','R2L-ORDINARY',' { "is_test":false,"unknown":{"keep":"🌏"} }\n',null,' { "audit":true } '),row(ns,'progress:R2L-ORDINARY','{"diamonds":270,"saved_answers":[1,2]}'),row('codes','r2l_link:ordinary','{"access_code":"R2L-ORDINARY"}',2000000000000),row('codes','same-config',' { "unchanged": true } ')]});
 const target=await snapshotAccountStore({db,progressInCodes});const omittedSourceKeys=[{namespace:'codes',key:'R2L-QA',reason:'Current authoritative QA record is retained'},{namespace:ns,key:'progress:R2L-QA',reason:'Current authoritative QA wallet is retained'},{namespace:'codes',key:'r2l_link:stale-qa',reason:'Do not resurrect a legacy QA token absent from the authoritative store'}];
 const plan=await prepareAccountRollout({sourceSnapshot:source,targetSnapshot:target,omittedSourceKeys});
 const rows=()=>db.prepare('SELECT namespace,key,value,expires,metadata FROM read2lead_account_kv ORDER BY namespace,key').all().map(r=>({...r}));
 const retained=()=>({sessions:db.prepare('SELECT * FROM story_sessions').all(),receipts:db.prepare('SELECT * FROM voice_receipts').all(),import:db.prepare('SELECT * FROM read2lead_account_import').all()});
 const merge=(overrides={})=>mergeAccountSnapshot({db,transaction,snapshot:source,plan,expectedPlanSha256:plan.sha256,progressInCodes,...overrides});
 return{db,transaction,run,original,source,target,plan,merge,rows,retained,ns,progressInCodes,omittedSourceKeys};
}
for(const shared of [false,true])test(`merge adds ordinary records without overwriting current founder history, wallet or sessions (shared=${shared})`,async t=>{
 const f=await fixture(t,shared),before=f.rows(),retained=f.retained(),source=structuredClone(f.source);
 const result=await f.merge();assert.equal(result.status,'merged');assert.equal(result.added,3);assert.equal(result.identical,1);assert.equal(result.omitted,3);
 for(const prior of before)assert.deepEqual(f.rows().find(r=>r.namespace===prior.namespace&&r.key===prior.key),prior);
 for(const incoming of f.source.records.filter(r=>r.key.includes('ORDINARY')||r.key==='r2l_link:ordinary'))assert.deepEqual(f.rows().find(r=>r.namespace===incoming.namespace&&r.key===incoming.key),incoming);
 assert.equal(f.rows().some(r=>r.key==='r2l_link:stale-qa'),false);assert.deepEqual(f.retained(),retained);assert.deepEqual(f.source,source);
 assert.equal((await importAccountSnapshot({db:f.db,transaction:f.transaction,snapshot:f.original,expectedSha256:f.original.sha256,progressInCodes:shared})).status,'already_imported');assert.deepEqual(f.retained(),retained);
});

test('rollout replay after later learning does not restore old progress or increment revision',async t=>{
 const f=await fixture(t);await f.merge();await f.run(async env=>{await env.READ2LEAD_PROGRESS.put('progress:R2L-ORDINARY','{"diamonds":520,"saved_answers":[1,2,3],"retell":"complete"}');return new Response('ok');});
 const before=f.rows(),revision=f.db.prepare('SELECT revision FROM read2lead_account_revision').get().revision;
 assert.equal((await f.merge()).status,'already_merged');assert.deepEqual(f.rows(),before);assert.equal(f.db.prepare('SELECT revision FROM read2lead_account_revision').get().revision,revision);
 const newPlan=await prepareAccountRollout({sourceSnapshot:f.source,targetSnapshot:await snapshotAccountStore({db:f.db,progressInCodes:false}),omittedSourceKeys:f.omittedSourceKeys});
 await assert.rejects(f.merge({plan:newPlan,expectedPlanSha256:newPlan.sha256}),/already_initialized/);assert.deepEqual(f.rows(),before);
});

test('changed source, changed plan, wrong mode and independent pin mismatches refuse all writes',async t=>{
 const f=await fixture(t),before=f.rows();
 const changed=structuredClone(f.source);changed.records.find(r=>r.key==='progress:R2L-ORDINARY').value='{"diamonds":9999}';
 await assert.rejects(f.merge({snapshot:changed}),/snapshot_digest_mismatch/);
 const repinned=await prepareAccountSnapshot({sourceId:changed.sourceId,progressInCodes:false,records:changed.records});await assert.rejects(f.merge({snapshot:repinned}),/source_mismatch/);
 const changedPlan=structuredClone(f.plan);changedPlan.omittedSourceKeys[0].reason='changed';await assert.rejects(f.merge({plan:changedPlan}),/plan_digest_mismatch/);
 await assert.rejects(f.merge({expectedPlanSha256:'a'.repeat(64)}),/pin_or_mode_mismatch/);await assert.rejects(f.merge({progressInCodes:true}),/pin_or_mode_mismatch/);
 assert.deepEqual(f.rows(),before);assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='read2lead_account_rollout'").get(),undefined);
});

test('omission list rejects duplicate, missing and unexplained keys before a plan is pinned',async t=>{
 const f=await fixture(t);const make=omittedSourceKeys=>prepareAccountRollout({sourceSnapshot:f.source,targetSnapshot:f.target,omittedSourceKeys});
 await assert.rejects(make([...f.omittedSourceKeys,f.omittedSourceKeys[0]]),/duplicate/);
 await assert.rejects(make([{namespace:'codes',key:'missing',reason:'not present'}]),/omitted_key_missing/);
 await assert.rejects(make([{namespace:'codes',key:'R2L-QA',reason:' '}]),/invalid_account_rollout_omission/);
});

test('unapproved overlapping values reject the entire merge rather than silently selecting a winner',async t=>{
 const f=await fixture(t),before=f.rows(),retained=f.retained();
 const plan=await prepareAccountRollout({sourceSnapshot:f.source,targetSnapshot:f.target,omittedSourceKeys:[]});
 await assert.rejects(f.merge({plan,expectedPlanSha256:plan.sha256}),/conflicting_key/);assert.deepEqual(f.rows(),before);assert.deepEqual(f.retained(),retained);
});

for(const field of ['value','expires','metadata'])test(`changed target ${field} refuses a stale rollout plan`,async t=>{
 const f=await fixture(t);const value=field==='expires'?2000000000000:field==='metadata'?'"new metadata"':'{"diamonds":521}';
 f.db.prepare(`UPDATE read2lead_account_kv SET ${field}=? WHERE namespace=? AND key=?`).run(value,f.ns,'progress:R2L-QA');const before=f.rows();
 await assert.rejects(f.merge(),/target_changed/);assert.deepEqual(f.rows(),before);
});

test('a target change between hashing and commit is caught even without a revision bump',async t=>{
 const f=await fixture(t);let calls=0;
 const transaction=fn=>{if(++calls===2)f.db.prepare("UPDATE read2lead_account_kv SET value='changed-during-hash' WHERE key='same-config'").run();return f.transaction(fn);};
 await assert.rejects(f.merge({transaction}),/target_changed/);assert.equal(f.rows().find(r=>r.key==='same-config').value,'changed-during-hash');assert.equal(f.rows().some(r=>r.key==='R2L-ORDINARY'),false);
});

test('failed final commit rolls back new rows, rollout receipt and revision while retaining session tables',async t=>{
 const f=await fixture(t),before=f.rows(),retained=f.retained();
 f.db.exec("CREATE TRIGGER fail_rollout BEFORE UPDATE ON read2lead_account_revision BEGIN SELECT RAISE(ABORT,'synthetic commit failure'); END");
 await assert.rejects(f.merge(),/synthetic commit failure/);assert.deepEqual(f.rows(),before);assert.deepEqual(f.retained(),retained);assert.equal(f.db.prepare('SELECT revision FROM read2lead_account_revision').get().revision,1);
 assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='read2lead_account_rollout'").get(),undefined);
 f.db.exec('DROP TRIGGER fail_rollout');assert.equal((await f.merge()).status,'merged');
});

test('merge invalidates an already-staged old write instead of losing imported ordinary progress',async t=>{
 const f=await fixture(t);let entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const old=f.run(async env=>{await env.READ2LEAD_PROGRESS.put('progress:R2L-ORDINARY','{"diamonds":0}');entered();await wait;return new Response('ok');});
 await started;await f.merge();release();assert.equal((await old).status,409);
 assert.equal(f.rows().find(r=>r.key==='progress:R2L-ORDINARY').value,'{"diamonds":270,"saved_answers":[1,2]}');
});

test('a damaged rollout receipt or missing revision cannot report a successful replay',async t=>{
 const f=await fixture(t);await f.merge();const before=f.rows();
 f.db.exec('DELETE FROM read2lead_account_revision');await assert.rejects(f.merge(),/receipt_invalid/);assert.deepEqual(f.rows(),before);
});
