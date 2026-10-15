import { snapshotAccountStore, mergeAccountSnapshot, readAccountSnapshotRows as accountRows } from './account-snapshot.mjs';
import {accountJsonDigest} from './account-json-stream.mjs';

const FORMAT='read2lead-frozen-account-export-v1';
const OBJECT='existing-student-test-v1';
const encoder=new TextEncoder();
const fail=code=>{throw Error(code);};
const pin=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=async value=>accountJsonDigest(value);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const compare=(a,b)=>a<b?-1:a>b?1:0;
// Bookmark creation may add _cf_METADATA. Like platform KV, it refuses
// SQL reads and is covered by native PITR. Keep this an exact allowlist:
// unknown application tables, including other _cf_* names, must survive.
const platformOwned=name=>['_cf_kv','__cf_kv','_cf_metadata'].includes(name.toLowerCase());
const bytesOf=value=>value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;

function cell(type,value) {
  if(type==='null'&&value===null)return [type,null];
  if(type==='integer'&&typeof value==='string'&&/^-?\d+$/.test(value))return [type,value];
  if(type==='text'&&bytesOf(value))return [type,new TextDecoder('utf-8',{fatal:true}).decode(bytesOf(value))];
  if(type==='real'&&typeof value==='number')return [type,Object.is(value,-0)?'-0':String(value)];
  if(type==='blob'&&(value instanceof ArrayBuffer||ArrayBuffer.isView(value))) {
    const bytes=bytesOf(value);
    return [type,Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')];
  }
  fail('account_export_unrepresentable_cell');
}

/** Read-only logical evidence, not a SQL restore program. Native PITR also
 * covers platform-owned KV/system data that SQL clients cannot inspect.
 * Integer values are cast by SQLite before JS to preserve all 64 bits.
 */
export function captureAccountSqlEvidence(db,{maxBytes=32*1024*1024,rowDigests=false}={}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)fail('account_export_limit_invalid');
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()
    .filter(row=>!platformOwned(row.name)&&!platformOwned(row.tbl_name)).map(row=>({type:row.type,name:row.name,table:row.tbl_name,sql:row.sql}));
  let bytes=encoder.encode(JSON.stringify(schema)).length;
  if(bytes>maxBytes)fail('account_export_limit');
  const tables=[];
  for(const item of schema.filter(row=>row.type==='table')) {
    const columns=db.prepare('PRAGMA table_xinfo('+quote(item.name)+')').all().map(column=>column.name);
    if(!columns.length)fail('account_export_columns_missing');
    const select=columns.map((name,i)=>`typeof(${quote(name)}) AS t${i}, CASE WHEN typeof(${quote(name)})='integer' THEN CAST(${quote(name)} AS TEXT) WHEN typeof(${quote(name)})='text' THEN CAST(${quote(name)} AS BLOB) ELSE ${quote(name)} END AS v${i}`).join(',');
    const rows=db.prepare(`SELECT ${select} FROM ${quote(item.name)}`).all().map(row=>{
      const values=columns.map((_,i)=>cell(row['t'+i],row['v'+i]));
      const text=JSON.stringify(values);bytes+=encoder.encode(text).length;
      if(bytes>maxBytes)fail('account_export_limit');return rowDigests?accountJsonDigest(values):text;
    }).sort(compare).map(text=>rowDigests?text:JSON.parse(text));
    tables.push({name:item.name,columns,rows});
  }
  return {scope:'user_sql_including_sqlite_metadata',platformTablesExcluded:'_cf_KV/__cf_kv/_cf_METADATA and their schema objects; covered by native PITR',schema,tables};
}

/** Comparison-only fingerprints: schema, types, duplicate rows and counts stay
 * bound. Backups still contain every full cell value. This avoids retaining a
 * second full account table while checking a large frozen export or merge.
 */
export function accountSqlEvidenceDigests(sql) {
  return {...sql,tables:sql.tables.map(table=>({...table,rows:table.rows.map(accountJsonDigest).sort(compare)}))};
}

function guard({db,transaction,exclusive,isFrozen,objectName,objectId,progressInCodes}) {
  if(!db?.prepare||typeof transaction!=='function'||typeof exclusive!=='function'||typeof isFrozen!=='function')fail('account_operator_capabilities_required');
  if(isFrozen()!==true||objectName!==OBJECT||typeof objectId!=='string'||!objectId||objectId.length>512||typeof progressInCodes!=='boolean')fail('account_operator_forbidden');
  const imported=db.prepare('SELECT progress_in_codes FROM read2lead_account_import WHERE id=1').get();
  if(imported?.progress_in_codes!==Number(progressInCodes))fail('account_operator_storage_mode_mismatch');
}

/** Trusted internal capability only. `exclusive` must block other object
 * events (Cloudflare blockConcurrencyWhile); it is not a caller boolean.
 * A bookmark is 30-day platform recovery, not an indefinite off-platform copy.
 * There is deliberately no restore endpoint or automatic rollback here.
 */
export async function captureFrozenAccountState(options) {
  guard(options);
  const {db,transaction,exclusive,isFrozen,getCurrentBookmark,objectName,objectId,progressInCodes,now=()=>Date.now()}=options;
  if(typeof getCurrentBookmark!=='function')fail('native_recovery_required');
  return exclusive(async()=>{
    guard(options);
    const sql=transaction(()=>captureAccountSqlEvidence(db));
    const accounts=await snapshotAccountStore({db,progressInCodes});
    const bookmark=await getCurrentBookmark();
    if(typeof bookmark!=='string'||!bookmark||bookmark.length>512||!/^[a-zA-Z0-9-]+$/.test(bookmark))fail('native_recovery_invalid');
    if(isFrozen()!==true||JSON.stringify(transaction(()=>captureAccountSqlEvidence(db,{rowDigests:true})))!==JSON.stringify(accountSqlEvidenceDigests(sql)))fail('account_changed_during_export');
    const capturedAt=now();if(!Number.isSafeInteger(capturedAt)||capturedAt<1)fail('account_export_time_invalid');
    const body={format:FORMAT,objectName,objectId,progressInCodes,capturedAt,
      recovery:{kind:'cloudflare-durable-object-pitr',scope:'entire_sqlite_database_including_storage_kv',retentionDays:30,bookmark},accounts,sql};
    return {...body,sha256:await hash(body)};
  });
}

async function verifyBackup(backup,expectedSha256,options) {
  if(!backup||backup.format!==FORMAT||!pin(expectedSha256)||backup.sha256!==expectedSha256||
    backup.objectName!==options.objectName||backup.objectId!==options.objectId||backup.progressInCodes!==options.progressInCodes)fail('account_backup_pin_or_identity_mismatch');
  const {sha256,...body}=backup;
  if(await hash(body)!==sha256)fail('account_backup_digest_mismatch');
  const now=(options.now??(()=>Date.now()))();
  if(!Number.isSafeInteger(backup.capturedAt)||backup.capturedAt>now||now-backup.capturedAt>=30*86400000||
    backup.recovery?.kind!=='cloudflare-durable-object-pitr'||backup.recovery.scope!=='entire_sqlite_database_including_storage_kv'||
    backup.recovery.retentionDays!==30||!backup.recovery.bookmark)fail('account_backup_recovery_invalid');
  return backup;
}

const rolloutObject=name=>name==='read2lead_account_rollout'||name==='sqlite_autoindex_read2lead_account_rollout_1';
function retainedSql(sql) {
  return {...sql,schema:sql.schema.filter(row=>!rolloutObject(row.name)),
    tables:sql.tables.filter(table=>!['read2lead_account_kv','read2lead_account_revision','read2lead_account_rollout'].includes(table.name))};
}
const rowKey=row=>JSON.stringify([row.namespace,row.key]);

/** Local/trusted-operator integration, NOT an HTTP importer. Source snapshot,
 * plan and backup need independently supplied pins. Production approval and
 * external-writer freeze/drain are operator prerequisites, not inferred here.
 * Preserved-table assertions run INSIDE merge's commit, including triggers.
 */
export async function applyFrozenAccountRollout(options) {
  guard(options);
  const {db,transaction,exclusive,isFrozen,backup,expectedBackupSha256,snapshot,plan,expectedPlanSha256,progressInCodes}=options;
  const checked=await verifyBackup(backup,expectedBackupSha256,options);
  if(checked.accounts.sha256!==plan?.targetSha256)fail('account_backup_plan_target_mismatch');
  return exclusive(async()=>{
    guard(options);
    const hasReceipt=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='read2lead_account_rollout'").get();
    const initial=transaction(()=>captureAccountSqlEvidence(db,{rowDigests:true}));
    // A retry acknowledges the original receipt without restoring the opening
    // backup or discarding subsequent learning. merge validates every pin.
    if(!hasReceipt&&JSON.stringify(initial)!==JSON.stringify(accountSqlEvidenceDigests(checked.sql)))fail('account_target_changed_since_backup');
    const beforeRetained=JSON.stringify(retainedSql(initial));
    const expectedRows=new Map(accountRows(db).map(row=>[rowKey(row),row]));
    if(!hasReceipt){
      const omitted=new Set((plan?.omittedSourceKeys||[]).map(rowKey));
      for(const row of snapshot?.records||[])if(!omitted.has(rowKey(row))&&!expectedRows.has(rowKey(row)))expectedRows.set(rowKey(row),row);
    }
    const guardedTransaction=fn=>transaction(()=>{
      if(isFrozen()!==true)fail('account_operator_forbidden');
      const result=fn();
      if(JSON.stringify(retainedSql(captureAccountSqlEvidence(db,{rowDigests:true})))!==beforeRetained)fail('account_retained_state_changed');
      if(result?.status==='merged'||result?.status==='already_merged'){
        const rows=accountRows(db);
        if(rows.length!==expectedRows.size||rows.some(row=>JSON.stringify(row)!==JSON.stringify(expectedRows.get(rowKey(row)))))fail('account_preserved_rows_changed');
      }
      return result;
    });
    const result=await mergeAccountSnapshot({db,transaction:guardedTransaction,snapshot,plan,expectedPlanSha256,progressInCodes});
    return {...result,backupSha256:expectedBackupSha256,preservedSqlTables:initial.tables.filter(table=>!['read2lead_account_kv','read2lead_account_revision','read2lead_account_rollout'].includes(table.name)).length};
  });
}
