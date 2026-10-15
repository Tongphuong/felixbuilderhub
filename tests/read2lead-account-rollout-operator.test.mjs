import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountTransactionRunner} from '../functions/lib/read2lead/account-transactions.mjs';
import {prepareAccountSnapshot,importAccountSnapshot,prepareAccountRollout} from '../functions/lib/read2lead/account-snapshot.mjs';
import {captureAccountSqlEvidence,accountSqlEvidenceDigests,captureFrozenAccountState,applyFrozenAccountRollout} from '../functions/lib/read2lead/account-rollout-operator.mjs';

async function fixture(t,{shared=true}={}) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const now=()=>Date.parse('2026-10-14T08:00:00Z');let frozen=true,bookmarks=0,hook=null;
  createAccountTransactionRunner({db,transaction,progressInCodes:shared,now});
  const row=(namespace,key,value)=>({namespace,key,value,expires:null,metadata:null});
  const records=[row('codes','R2L-QA',' { "is_test":true,"history":["finished-sky"],"unknown":"keep" } '),row(shared?'codes':'progress','progress:R2L-QA','{"diamonds":520,"saved_answers":[1,2,3]}')];
  const initial=await prepareAccountSnapshot({sourceId:'synthetic-initial',progressInCodes:shared,records});
  await importAccountSnapshot({db,transaction,snapshot:initial,expectedSha256:initial.sha256,progressInCodes:shared});
  db.exec(`CREATE TABLE story_sessions(id TEXT PRIMARY KEY,state TEXT); CREATE TABLE story_picture_rewards(owner TEXT,source TEXT,receipt TEXT,PRIMARY KEY(owner,source));
    CREATE TABLE voice_budget(id TEXT PRIMARY KEY,amount REAL); CREATE TABLE "future table"(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT,bytes BLOB,big INTEGER,ratio REAL);
    CREATE INDEX future_note ON "future table"(note); CREATE VIEW future_view AS SELECT id,note FROM "future table";`);
  db.prepare('INSERT INTO story_sessions VALUES(?,?)').run('saved-sky','{"questions":12,"retell":"complete","future":{"keep":true}}');
  db.prepare('INSERT INTO story_picture_rewards VALUES(?,?,?)').run('R2L-QA','sky','{"diamonds":200,"paid_once":true}');
  db.prepare('INSERT INTO voice_budget VALUES(?,?)').run('founder-reserved',2.24);
  db.prepare('INSERT INTO "future table"(note,bytes,big,ratio) VALUES(?,?,?,?)').run('Vietnamese 🌏\u0000 preserved',new Uint8Array([0,1,254,255]),9223372036854775807n,0.12345678901234568);
  const options={db,transaction,objectName:'existing-student-test-v1',objectId:'synthetic-object-id',progressInCodes:shared,now,isFrozen:()=>frozen,exclusive:async fn=>fn(),getCurrentBookmark:async()=>{bookmarks++;if(hook)await hook();return 'synthetic-bookmark-not-platform-proof';}};
  const capture=extra=>captureFrozenAccountState({...options,...extra});
  const source=await prepareAccountSnapshot({sourceId:'synthetic-frozen-legacy',progressInCodes:shared,records:[...records.map(r=>({...r,value:r.key.startsWith('progress:')?' {"diamonds":70}':'{"is_test":true}'})),row('codes','R2L-ORDINARY',' { "student_profile":{"student_name":"An"},"unknown":"kept" } '),row(shared?'codes':'progress','progress:R2L-ORDINARY','{"diamonds":270}'),row('codes','book:historical','{"original":"untouched"}')]});
  const prepare=async()=>{
    const backup=await capture();
    const plan=await prepareAccountRollout({sourceSnapshot:source,targetSnapshot:backup.accounts,omittedSourceKeys:records.map(r=>({namespace:r.namespace,key:r.key,reason:'Preserve authoritative founder history and wallet'}))});
    return {backup,plan};
  };
  const apply=(prepared,extra={})=>applyFrozenAccountRollout({...options,...prepared,expectedBackupSha256:prepared.backup.sha256,snapshot:source,expectedPlanSha256:prepared.plan.sha256,...extra});
  return{db,transaction,options,source,capture,prepare,apply,sql:()=>captureAccountSqlEvidence(db),frozen:value=>frozen=value,hook:value=>hook=value,bookmarks:()=>bookmarks};
}

test('typed export preserves all user SQL, native-recovery metadata, binary, large integer and future schema',async t=>{
  const f=await fixture(t),before=f.sql(),result=await f.capture();assert.deepEqual(f.sql(),before);assert.equal(f.bookmarks(),1);
  assert.equal(result.recovery.scope,'entire_sqlite_database_including_storage_kv');assert.equal(result.recovery.retentionDays,30);assert.equal(result.accounts.records.length,2);
  const future=result.sql.tables.find(table=>table.name==='future table');assert.deepEqual(future.rows[0],[['integer','1'],['text','Vietnamese 🌏\u0000 preserved'],['blob','0001feff'],['integer','9223372036854775807'],['real','0.12345678901234568']]);
  assert.ok(result.sql.schema.some(row=>row.type==='view'&&row.name==='future_view'));assert.ok(result.sql.tables.some(table=>table.name==='sqlite_sequence'));
  assert.equal((await f.capture()).sha256,result.sha256,'stable export with fixed time/bookmark');
});

test('compact SQL comparison preserves typed rows, duplicate counts and schema changes',async t=>{
  const f=await fixture(t);f.db.exec('CREATE TABLE repeated(value); INSERT INTO repeated VALUES(1),(1),(\'1\'),(NULL)');
  const full=f.sql(),compact=captureAccountSqlEvidence(f.db,{rowDigests:true});
  assert.deepEqual(compact,accountSqlEvidenceDigests(full));
  const rows=compact.tables.find(table=>table.name==='repeated').rows;
  assert.equal(rows.length,4);assert.equal(new Set(rows).size,3);
  f.db.exec('DELETE FROM repeated WHERE rowid=1');assert.notDeepEqual(captureAccountSqlEvidence(f.db,{rowDigests:true}),compact);
  f.db.exec('CREATE INDEX repeated_index ON repeated(value)');assert.notDeepEqual(captureAccountSqlEvidence(f.db,{rowDigests:true}).schema,compact.schema);
});

test('missing freeze, wrong object, wrong mode and absent native recovery refuse without mutation',async t=>{
  const f=await fixture(t),before=f.sql();
  for(const extra of [{isFrozen:()=>false},{objectName:'private-adult-preview-v1'},{progressInCodes:false},{getCurrentBookmark:null},{getCurrentBookmark:async()=>''}])await assert.rejects(f.capture(extra));
  assert.deepEqual(f.sql(),before);
});

test('SQL change or unfreeze while capturing refuses instead of labelling a torn export valid',async t=>{
  const f=await fixture(t);f.hook(()=>f.db.prepare("UPDATE story_sessions SET state='changed'").run());await assert.rejects(f.capture(),/changed_during_export/);
  f.hook(()=>f.frozen(false));await assert.rejects(f.capture(),/changed_during_export/);
});

test('logical export bounds fail closed, and protected platform tables are explicitly excluded',async t=>{
  const f=await fixture(t);assert.throws(()=>captureAccountSqlEvidence(f.db,{maxBytes:20}),/export_limit/);
  f.db.exec('CREATE TABLE __cf_kv(k TEXT,v BLOB)');f.db.prepare('INSERT INTO __cf_kv VALUES(?,?)').run('platform',new Uint8Array([7]));
  f.db.exec('CREATE TABLE _cf_KV(k TEXT,v BLOB)');
  f.db.exec('CREATE TABLE _cf_user_history(value TEXT)');f.db.prepare('INSERT INTO _cf_user_history VALUES(?)').run('retain unknown user tables');
  assert.equal(f.sql().tables.some(table=>table.name==='__cf_kv'),false);assert.match(f.sql().platformTablesExcluded,/native PITR/);
  assert.equal(f.sql().tables.some(table=>table.name==='_cf_KV'),false);
  assert.equal(f.sql().tables.find(table=>table.name==='_cf_user_history').rows[0][0][1],'retain unknown user tables');
});

test('bookmark-created platform metadata is excluded without hiding unknown application tables',async t=>{
  const f=await fixture(t);
  f.db.exec("CREATE TABLE _cf_user_history(value TEXT); INSERT INTO _cf_user_history VALUES('preserve me')");
  f.hook(()=>f.db.exec('CREATE TABLE IF NOT EXISTS _cf_METADATA(k TEXT,v BLOB)'));
  const backup=await f.capture();
  assert.equal(backup.sql.tables.some(table=>table.name==='_cf_METADATA'),false);
  assert.equal(backup.sql.tables.find(table=>table.name==='_cf_user_history').rows[0][0][1],'preserve me');
  const protectedDb={prepare(sql){
    if(sql.includes('"_cf_METADATA"'))throw Error('not authorized: SQLITE_AUTH');
    return f.db.prepare(sql);
  }};
  assert.deepEqual(captureAccountSqlEvidence(protectedDb),backup.sql);
});

for(const shared of [true,false])test(`frozen merge preserves sessions, rewards, budgets, unknown tables and wallets (shared=${shared})`,async t=>{
  const f=await fixture(t,{shared}),prepared=await f.prepare(),before=f.sql();
  const result=await f.apply(prepared);assert.equal(result.status,'merged');assert.equal(result.added,3);assert.equal(result.omitted,2);
  for(const table of before.tables.filter(table=>!['read2lead_account_kv','read2lead_account_revision'].includes(table.name)))assert.deepEqual(f.sql().tables.find(after=>after.name===table.name),table);
  assert.equal(f.db.prepare("SELECT value FROM read2lead_account_kv WHERE key='progress:R2L-QA'").get().value,'{"diamonds":520,"saved_answers":[1,2,3]}');
  assert.equal(f.db.prepare("SELECT value FROM read2lead_account_kv WHERE key='progress:R2L-ORDINARY'").get().value,'{"diamonds":270}');
});

test('idempotent retry after further learning never restores the pre-migration backup',async t=>{
  const f=await fixture(t),prepared=await f.prepare();await f.apply(prepared);
  f.db.prepare("UPDATE read2lead_account_kv SET value=? WHERE key='progress:R2L-ORDINARY'").run('{"diamonds":520,"new_learning":true}');
  f.db.prepare("UPDATE story_sessions SET state='further learning'").run();const before=f.sql();
  assert.equal((await f.apply(prepared)).status,'already_merged');assert.deepEqual(f.sql(),before);
});

test('stale SQL evidence, wrong pins, expired recovery and wrong object identity refuse before changes',async t=>{
  const f=await fixture(t),prepared=await f.prepare(),before=f.sql();
  for(const extra of [{expectedBackupSha256:'f'.repeat(64)},{expectedPlanSha256:'f'.repeat(64)},{objectId:'different-object'},{now:()=>f.options.now()+30*86400000},{now:()=>f.options.now()-1}])await assert.rejects(f.apply(prepared,extra));
  const tampered=structuredClone(prepared.backup);tampered.sql.tables[0].rows=[];await assert.rejects(f.apply({...prepared,backup:tampered}),/digest_mismatch/);assert.deepEqual(f.sql(),before);
  f.db.prepare("UPDATE voice_budget SET amount=0").run();const changed=f.sql();await assert.rejects(f.apply(prepared),/changed_since_backup/);assert.deepEqual(f.sql(),changed);
});

for(const target of ['sessions','wallet','extra-row'])test(`trigger modifying ${target} is detected inside commit and entire merge rolls back`,async t=>{
  const f=await fixture(t);
  const mutation=target==='sessions'?"UPDATE story_sessions SET state='lost';":target==='wallet'?"UPDATE read2lead_account_kv SET value='lost' WHERE key='progress:R2L-QA';":"INSERT INTO read2lead_account_kv VALUES('codes','unapproved','extra',NULL,NULL);";
  f.db.exec(`CREATE TRIGGER bad_import AFTER INSERT ON read2lead_account_kv WHEN NEW.key='R2L-ORDINARY' BEGIN ${mutation} END`);
  const prepared=await f.prepare(),before=f.sql();await assert.rejects(f.apply(prepared),/account_(retained_state|preserved_rows)_changed/);assert.deepEqual(f.sql(),before);
});

test('opaque account values retain NUL suffixes and a trigger changing that suffix cannot evade preservation checks',async t=>{
  const f=await fixture(t);
  f.db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run('codes','opaque-history','prefix\u0000keep');
  f.db.exec("CREATE TRIGGER bad_suffix AFTER INSERT ON read2lead_account_kv WHEN NEW.key='R2L-ORDINARY' BEGIN UPDATE read2lead_account_kv SET value='prefix'||char(0)||'lost' WHERE key='opaque-history'; END");
  const prepared=await f.prepare();assert.equal(prepared.backup.accounts.records.find(row=>row.key==='opaque-history').value,'prefix\u0000keep');
  const before=f.sql();await assert.rejects(f.apply(prepared),/account_preserved_rows_changed/);assert.deepEqual(f.sql(),before);
});
