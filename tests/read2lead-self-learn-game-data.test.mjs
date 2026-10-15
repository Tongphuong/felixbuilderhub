import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SyntheticStore} from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import {SyntheticFamilyStore} from '../scripts/lib/read2lead-self-learn-family.mjs';
import {SyntheticGameStore} from '../scripts/lib/read2lead-self-learn-game.mjs';
import {defaultFreeMonster,freeMonsterCatalogue} from '../functions/lib/read2lead/self-learn/game-policy.mjs';
import {canonical} from '../src/lib/read2lead/self-learn/session-contract.mjs';
const read=n=>JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/'+n+'.json',import.meta.url),'utf8'));
const accounts=read('family-access').accounts,themes=read('game-seasons').themes,interestIds=read('library-interests').groups.map(g=>g.id),legacy=read('game-legacy').snapshot;
const staff={active:true,role:'staff',id:'synthetic-qa'},now='2026-09-19T00:00:00.000Z';
const roots=resolve('.r2l-game-data-proofs');mkdirSync(roots,{recursive:true});
const marker=JSON.stringify({format:1,purpose:'read2lead-local-synthetic',database:'read2lead-synthetic.sqlite'});
function target(){const root=mkdtempSync(join(roots,'case-'));writeFileSync(join(root,'synthetic-target.json'),marker);return root;}
const config=root=>({mode:'synthetic-local',root,themes,interestIds});
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const select=(more={})=>({request_id:'select-monster',expected_revision:0,monster:{...defaultFreeMonster(),color:'grape'},...more});
const input=(more={})=>({child_id:'synthetic-an',request_id:'import-legacy',snapshot:structuredClone(legacy),expected_sha256:digest(legacy),...more});
const fails=(f,code)=>assert.throws(f,e=>e.code===code);
function fixture(t,fault=()=>{}){
 const root=target(),core=new SyntheticStore({root}),family=new SyntheticFamilyStore({mode:'synthetic-local',root});for(const a of accounts)family.seed(staff,a,now);let game=new SyntheticGameStore({...config(root),fault});
 t.after(()=>{game?.close();family.close();core.close();});
 return {root,core,family,get game(){return game;},db(){return new DatabaseSync(join(root,'read2lead-synthetic.sqlite'));},closeGame(){game?.close();game=null;},reopen(){game?.close();game=null;game=new SyntheticGameStore({...config(root),fault});},principal(childId='synthetic-an',i=0){return {...family.authenticateAccess(accounts[i].access_code),childId};},parent(){return family.elevateParent(family.authenticateAccess(accounts[0].access_code),accounts[0].parent_secret);}};
}
function tables(db,all=false){const result={};for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())if(all||!name.startsWith('game_'))result[name]=JSON.parse(JSON.stringify(db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));return result;}
function snapshot(f,all=false){const db=f.db();try{return tables(db,all);}finally{db.close();}}
function counts(f){const db=f.db();try{return Object.fromEntries(['game_preferences','game_imports','game_receipts','game_audit'].map(n=>[n,db.prepare('SELECT count(*) AS n FROM '+n).get().n]));}finally{db.close();}}
const profile=more=>({request_id:'profile-change',child_id:'synthetic-an',expected_revision:0,display_name:'An mẫu',archived:false,learning_enabled:true,recording_allowed:false,...more});
const recovery=()=>({family_id:accounts[0].family_id,request_id:'recover-game',recovery_code:accounts[0].recovery_code,new_access_code:'GAME-FAMILY-NEXT',new_parent_secret:'GAME-PARENT-NEXT',new_recovery_code:'GAME-RECOVERY-NEXT-2026'});
function worker(f,operation,boundary='',request='game-worker'){return new Promise((done,fail)=>{const p=spawn(process.execPath,['tests/fixtures/read2lead-self-learn/game-worker.mjs',f.root,operation,boundary,request],{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',fail);p.on('exit',(code,signal)=>done({code,signal,out,err}));});}

test('game extension requires explicit synthetic mode and existing family schema',t=>{
 const root=target();fails(()=>new SyntheticGameStore({...config(root),mode:'production'}),'unsafe_game_mode');fails(()=>new SyntheticGameStore(config(root)),'core_store_required');assert.equal(existsSync(join(root,'read2lead-synthetic.sqlite')),false);
 const core=new SyntheticStore({root});t.after(()=>core.close());fails(()=>new SyntheticGameStore(config(root)),'family_store_required');const db=new DatabaseSync(join(root,'read2lead-synthetic.sqlite'));assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name GLOB 'game_*'").get().n,0);db.close();
});
test('unmarked and invalid-theme targets refused before extension writes',t=>{
 const unmarked=mkdtempSync(join(roots,'unmarked-'));fails(()=>new SyntheticGameStore(config(unmarked)),'unsafe_target');assert.equal(existsSync(join(unmarked,'read2lead-synthetic.sqlite')),false);const root=target();fails(()=>new SyntheticGameStore({...config(root),themes:[{...themes[0],interest_ids:['unknown']}]}),'unknown_theme_interest');assert.equal(existsSync(join(root,'read2lead-synthetic.sqlite')),false);
});
test('unknown,partial and missing-trigger game schemas refused without adoption',t=>{
 const f=fixture(t),db=f.db();f.closeGame();db.exec("UPDATE r2l_meta SET value='99' WHERE key='game_schema_version'");fails(()=>new SyntheticGameStore(config(f.root)),'unsupported_game_schema');db.exec("UPDATE r2l_meta SET value='1' WHERE key='game_schema_version'; DROP TRIGGER game_imports_no_update");fails(()=>new SyntheticGameStore(config(f.root)),'unrecognized_game_schema');db.exec("DELETE FROM r2l_meta WHERE key='game_schema_version'");fails(()=>new SyntheticGameStore(config(f.root)),'unrecognized_game_schema');db.close();
});
test('default reads and catalogue are private,defensive and create no preference rows',t=>{
 const f=fixture(t),p=f.principal('synthetic-binh'),before=snapshot(f,true),v=f.game.view(p,now);assert.equal(v.declared_level,'L0');assert.equal(v.wallet.balance,0);assert.equal(v.preferences.revision,0);assert.equal(v.legacy_progress.lifetime_xp,0);assert.equal(v.theme.id,'synthetic-adventure');v.preferences.monster.color='invalid';assert.equal(f.game.view(p,now).preferences.monster.color,'mint');const cat=f.game.catalogue(p);assert.deepEqual(cat,freeMonsterCatalogue());cat.parts.body.length=0;assert.ok(f.game.catalogue(p).parts.body.length>0);assert.deepEqual(snapshot(f,true),before);
});
test('free selection at L0/zero balance preserves all non-game tables',t=>{
 const f=fixture(t),p=f.principal('synthetic-binh'),before=snapshot(f),monster=defaultFreeMonster(),catalogue=f.game.catalogue(p);for(const slot of catalogue.slots)monster[slot]=catalogue.parts[slot].at(-1).id;const r=f.game.selectMonster(p,select({monster}),now);assert.equal(r.preferences.revision,1);assert.deepEqual(r.preferences.monster,monster);assert.equal(r.replayed,false);assert.equal(f.game.view(p,now).wallet.balance,0);assert.deepEqual(snapshot(f),before);assert.deepEqual(counts(f),{game_preferences:1,game_imports:0,game_receipts:1,game_audit:1});
});
test('exact replay returns original receipt while current preference stays newer',t=>{
 const f=fixture(t),p=f.principal(),first=f.game.selectMonster(p,select(),now);const second=select({request_id:'second',expected_revision:1,monster:{...defaultFreeMonster(),color:'sky'}});f.game.selectMonster(p,second,now);const replay=f.game.selectMonster(p,select(),now);assert.equal(replay.replayed,true);assert.deepEqual(replay.preferences,first.preferences);assert.equal(f.game.view(p,now).preferences.revision,2);assert.equal(f.game.view(p,now).preferences.monster.color,'sky');assert.equal(f.game.audit(p).length,2);
});
test('same ID different choice and stale revision cannot change any rows',t=>{
 const f=fixture(t),p=f.principal();f.game.selectMonster(p,select(),now);const before=snapshot(f,true);fails(()=>f.game.selectMonster(p,select({monster:defaultFreeMonster()}),now),'request_conflict');fails(()=>f.game.selectMonster(p,select({request_id:'stale'}),now),'stale_revision');assert.deepEqual(snapshot(f,true),before);
});
test('payload price/reward/XP injections and invalid selection fail without receipt',t=>{
 const f=fixture(t),p=f.principal(),before=snapshot(f,true);for(const bad of [null,select({diamonds:99}),select({price:1}),select({expected_revision:-1}),select({request_id:'../bad'})])fails(()=>f.game.selectMonster(p,bad,now),'invalid_request');fails(()=>f.game.selectMonster(p,select({monster:{...defaultFreeMonster(),body:'invalid'}}),now),'invalid_monster_part');assert.deepEqual(snapshot(f,true),before);
});
test('paid monster requests are refused without debit even after a free selection',t=>{
 const f=fixture(t),p=f.principal();f.game.selectMonster(p,select(),now);const before=snapshot(f,true);for(let i=0;i<3;i++)fails(()=>f.game.refusePaidMonster(p),'monster_purchase_retired');assert.deepEqual(snapshot(f,true),before);
});
test('authority precedes malformed input and isolates families/children',t=>{
 const f=fixture(t),p=f.principal();for(const bad of [{...p,active:false},{...p,role:'staff'},{...p,childId:'real-child'},{...p,credentialVersion:99}]){fails(()=>f.game.view(bad,now),'unauthorized');fails(()=>f.game.selectMonster(bad,null,now),'unauthorized');fails(()=>f.game.refusePaidMonster(bad),'unauthorized');}
 fails(()=>f.game.view({...p,childId:'synthetic-chi'},now),'wrong_child');f.game.selectMonster(p,select(),now);assert.equal(f.game.view(f.principal('synthetic-binh'),now).preferences.revision,0);assert.deepEqual(f.game.audit(f.principal('synthetic-binh')),[]);assert.equal(f.game.view(f.principal('synthetic-chi',1),now).preferences.revision,0);
});
for(const settings of [{archived:true},{learning_enabled:false}])test('disabled profile blocks reads,selection and original replay '+JSON.stringify(settings),t=>{
 const f=fixture(t),p=f.principal();f.game.selectMonster(p,select(),now);f.family.updateChild(f.parent(),profile(settings),now);const before=snapshot(f,true);fails(()=>f.game.view(p,now),'child_access_disabled');fails(()=>f.game.selectMonster(p,select(),now),'child_access_disabled');assert.deepEqual(snapshot(f,true),before);
});
test('credential recovery revokes reads and exact replay',t=>{
 const f=fixture(t),p=f.principal();f.game.selectMonster(p,select(),now);f.family.recover(recovery(),now);const before=snapshot(f,true);fails(()=>f.game.view(p,now),'unauthorized');fails(()=>f.game.selectMonster(p,select(),now),'unauthorized');assert.deepEqual(snapshot(f,true),before);
});
for(const kind of ['new','replay'])test('authority revoked just before write lock prevents '+kind,t=>{
 let armed=false;let f;f=fixture(t,name=>{if(armed&&name==='game_before_write_lock'){armed=false;const db=f.db();db.exec('UPDATE family_accounts SET credential_version=credential_version+1');db.close();}});const p=f.principal();if(kind==='replay')f.game.selectMonster(p,select(),now);const before=counts(f);armed=true;fails(()=>f.game.selectMonster(p,select(),now),'unauthorized');assert.deepEqual(counts(f),before);
});
test('legacy import is staff-only,hash-bound and stores every unknown field without wallet credit',t=>{
 const f=fixture(t),p=f.principal(),before=snapshot(f);fails(()=>f.game.importLegacy(p,null,now),'unauthorized');fails(()=>f.game.importLegacy(staff,input({expected_sha256:'0'.repeat(64)}),now),'stale_legacy_input');assert.equal(counts(f).game_imports,0);const result=f.game.importLegacy(staff,input(),now);assert.equal(result.imported.source_sha256,digest(legacy));assert.deepEqual(f.game.legacySource(staff,'synthetic-an'),legacy);assert.deepEqual(snapshot(f),before);const view=f.game.view(p,now);assert.equal(view.legacy_progress.lifetime_xp,920);assert.equal(view.legacy_progress.legacy_season.id,'2026-S1');assert.equal(view.legacy_progress.medals[0].honors_rank,3);assert.equal(view.wallet.balance,0);assert.ok(!JSON.stringify(view).includes('synthetic-secret'));assert.ok(!JSON.stringify(f.game.audit(p)).includes('synthetic-secret'));fails(()=>f.game.legacySource(p,'synthetic-an'),'unauthorized');
});
test('legacy import repeated with same/different request creates no second import or audit',t=>{
 const f=fixture(t);const first=f.game.importLegacy(staff,input(),now);assert.equal(first.imported.already_present,false);assert.equal(f.game.importLegacy(staff,input(),now).replayed,true);assert.equal(f.game.importLegacy(staff,input({request_id:'same-source'}),now).imported.already_present,true);assert.equal(counts(f).game_imports,1);assert.equal(counts(f).game_audit,1);const changed={...legacy,total_xp:921},before=snapshot(f,true);fails(()=>f.game.importLegacy(staff,input({snapshot:changed,expected_sha256:digest(changed)}),now),'request_conflict');fails(()=>f.game.importLegacy(staff,input({request_id:'changed-source',snapshot:changed,expected_sha256:digest(changed)}),now),'legacy_import_conflict');assert.deepEqual(snapshot(f,true),before);
});
test('supported legacy avatar preserved until explicitly replaced; unsupported value requires review',t=>{
 const f=fixture(t),p=f.principal(),raw={...legacy,avatar:{monster:{body:freeMonsterCatalogue().parts.body.at(-1).id,color:'sky'}}};f.game.importLegacy(staff,input({snapshot:raw,expected_sha256:digest(raw)}),now);assert.equal(f.game.view(p,now).preferences.source,'legacy_snapshot');assert.equal(f.game.view(p,now).preferences.monster.body,raw.avatar.monster.body);assert.equal(f.game.view(p,now).preferences.monster.color,'sky');f.game.selectMonster(p,select(),now);assert.equal(f.game.view(p,now).preferences.source,'selected');assert.deepEqual(f.game.legacySource(staff,'synthetic-an'),raw);
 const bad={...legacy,avatar:{monster:{body:'unsupported'}}};fails(()=>f.game.importLegacy(staff,input({child_id:'synthetic-binh',snapshot:bad,expected_sha256:digest(bad)}),now),'legacy_monster_review_required');assert.equal(f.game.legacySource(staff,'synthetic-binh'),null);
});
test('invalid/non-JSON/oversized legacy snapshots are refused before any import',t=>{
 const f=fixture(t);for(const raw of [{...legacy,unknown:undefined},{...legacy,unknown:NaN},{...legacy,unknown:new Date()},null])fails(()=>f.game.importLegacy(staff,input({snapshot:raw,expected_sha256:'0'.repeat(64)}),now),'invalid_legacy_snapshot');const huge={...legacy,extra:'x'.repeat(262144)};fails(()=>f.game.importLegacy(staff,input({snapshot:huge,expected_sha256:digest(huge)}),now),'legacy_snapshot_too_large');assert.equal(counts(f).game_imports,0);
});
test('theme boundaries and free edits preserve legacy season,savings,history and honours',t=>{
 const f=fixture(t),p=f.principal();f.game.importLegacy(staff,input(),now);const before=snapshot(f);assert.equal(f.game.view(p,'2026-10-31T23:59:59.999Z').theme.id,'synthetic-adventure');assert.equal(f.game.view(p,'2026-11-01T00:00:00.000Z').theme.id,'synthetic-warm-stories');assert.equal(f.game.view(p,'2027-01-01T00:00:00.000Z').theme,null);f.game.selectMonster(p,select(),now);assert.deepEqual(f.game.legacySource(staff,'synthetic-an'),legacy);assert.deepEqual(snapshot(f),before);
});
test('immutable imports,receipts,audit and retained preferences reject SQL rewrite/deletion',t=>{
 const f=fixture(t),p=f.principal();f.game.importLegacy(staff,input(),now);f.game.selectMonster(p,select(),now);const db=f.db();try{for(const [table,code] of [['game_imports','immutable_game_import'],['game_receipts','immutable_game_receipt'],['game_audit','immutable_game_audit']]){assert.throws(()=>db.exec('DELETE FROM '+table),new RegExp(code));const key=table==='game_imports'?'snapshot_json':table==='game_receipts'?'response_json':'created_at';assert.throws(()=>db.exec('UPDATE '+table+' SET '+key+'='+key),new RegExp(code));}assert.throws(()=>db.exec('DELETE FROM game_preferences'),/preserve_game_preferences/);}finally{db.close();}
});
test('reopen and consistent database copy preserve all rows and replay receipts',t=>{
 const f=fixture(t),p=f.principal();f.game.importLegacy(staff,input(),now);f.game.selectMonster(p,select(),now);const original=f.game.view(p,now),before=snapshot(f,true);f.reopen();assert.deepEqual(f.game.view(p,now),original);const destination=target(),db=f.db();db.prepare('VACUUM INTO ?').run(join(destination,'read2lead-synthetic.sqlite'));db.close();const copy=new SyntheticGameStore(config(destination));try{assert.deepEqual(copy.view(p,now),original);assert.equal(copy.selectMonster(p,select(),now).replayed,true);assert.deepEqual(copy.legacySource(staff,'synthetic-an'),legacy);const check=new DatabaseSync(join(destination,'read2lead-synthetic.sqlite'));assert.deepEqual(tables(check,true),before);assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);check.close();}finally{copy.close();}
});
for(const operation of ['select','import'])for(const boundary of ['game_before_write_lock',operation==='select'?'game_preferences_updated':'game_import_inserted','game_audit_inserted','game_receipt_inserted','game_before_commit','game_after_commit'])test('process death '+operation+' at '+boundary+' has atomic retry',async t=>{
 const f=fixture(t),before=snapshot(f),result=await worker(f,operation,boundary);assert.equal(result.signal,'SIGKILL',JSON.stringify(result));f.reopen();const committed=boundary==='game_after_commit';assert.equal(counts(f).game_receipts,committed?1:0);assert.equal(counts(f).game_audit,committed?1:0);const retried=await worker(f,operation);assert.equal(retried.code,0,retried.err);assert.equal(JSON.parse(retried.out).replayed,committed);assert.equal(counts(f).game_receipts,1);assert.equal(counts(f).game_audit,1);assert.deepEqual(snapshot(f),before);
});
for(const operation of ['select','import'])test('two processes replay identical '+operation+' once',async t=>{
 const f=fixture(t),before=snapshot(f);const r=await Promise.all([worker(f,operation),worker(f,operation)]);assert.ok(r.every(x=>x.code===0),JSON.stringify(r));assert.deepEqual(r.map(x=>JSON.parse(x.out).replayed).sort(),[false,true]);assert.equal(counts(f).game_receipts,1);assert.equal(counts(f).game_audit,1);assert.deepEqual(snapshot(f),before);
});
test('two competing selection IDs cannot overwrite the same revision',async t=>{
 const f=fixture(t),before=snapshot(f);const r=await Promise.all([worker(f,'select','','first'),worker(f,'select','','second')]);assert.deepEqual(r.map(x=>x.code).sort(),[0,2]);assert.equal(JSON.parse(r.find(x=>x.code===2).out).error,'stale_revision');assert.equal(f.game.view(f.principal(),now).preferences.revision,1);assert.equal(counts(f).game_receipts,1);assert.deepEqual(snapshot(f),before);
});
for(const mutation of ['ALTER TABLE game_preferences ADD COLUMN unexpected TEXT',"DROP TRIGGER game_imports_no_update; CREATE TRIGGER game_imports_no_update BEFORE UPDATE ON game_imports BEGIN SELECT 1; END;"])test('altered schema definitions refused even when object names/version match '+mutation.split(' ')[0],t=>{
 const f=fixture(t),p=f.principal();f.game.importLegacy(staff,input(),now);f.game.selectMonster(p,select(),now);f.closeGame();const db=f.db();db.exec(mutation);const before=tables(db,true);fails(()=>new SyntheticGameStore(config(f.root)),'unrecognized_game_schema');assert.deepEqual(tables(db,true),before);db.close();
});
for(const replay of [false,true])test('session authority callback runs inside write lock before '+(replay?'replay':'new selection'),t=>{
 let locked=false;const f=fixture(t,name=>{if(name==='game_before_write_lock')locked=true;}),p=f.principal();if(replay)f.game.selectMonster(p,select(),now);locked=false;const before=snapshot(f,true);const error=Object.assign(new Error('access_expired'),{code:'access_expired'});fails(()=>f.game.selectMonster(p,select(),now,()=>{assert.equal(locked,true);throw error;}),'access_expired');assert.deepEqual(snapshot(f,true),before);
});
test('recent100 audit view retains the complete immutable database history',t=>{
 const f=fixture(t),p=f.principal();for(let i=0;i<101;i++)f.game.selectMonster(p,select({request_id:'audit-'+i,expected_revision:i}),now);const events=f.game.audit(p);assert.equal(events.length,100);assert.equal(events[0].revision,101);assert.equal(events.at(-1).revision,2);assert.equal(counts(f).game_audit,101);assert.equal(counts(f).game_receipts,101);
});
