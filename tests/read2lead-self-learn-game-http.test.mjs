import test from 'node:test';
import {createHash} from 'node:crypto';
import {SyntheticStore} from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import {SyntheticFamilyStore} from '../scripts/lib/read2lead-self-learn-family.mjs';
import {SyntheticGameStore} from '../scripts/lib/read2lead-self-learn-game.mjs';
import {canonical} from '../src/lib/read2lead/self-learn/session-contract.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {initializeSyntheticTarget,startLocalQA} from '../scripts/read2lead-local-qa.mjs';
import {defaultFreeMonster} from '../functions/lib/read2lead/self-learn/game-policy.mjs';
const roots=resolve('.r2l-game-http-proofs');mkdirSync(roots,{recursive:true});
function fixture(){const root=mkdtempSync(join(roots,'case-')),dataRoot=join(root,'data'),distRoot=join(root,'dist');mkdirSync(join(distRoot,'read2lead/self-learn'),{recursive:true});writeFileSync(join(distRoot,'read2lead/self-learn/index.html'),'<!doctype html><title>Synthetic game HTTP fixture</title>');initializeSyntheticTarget(dataRoot);return {root,dataRoot,distRoot};}
function client(qa){let cookie,csrf;return {get cookie(){return cookie;},async call(route,data,headers={}){const response=await fetch(qa.origin+'/api/read2lead/self-learn/'+route,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{origin:qa.origin,'content-type':'application/json',...(csrf?{'x-r2l-csrf':csrf}:{})}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});const value=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrf)csrf=value.csrf;return {response,value};}};}
function snapshot(root){const db=new DatabaseSync(join(root,'read2lead-synthetic.sqlite'),{readOnly:true}),rows={};try{for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())rows[name]=db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all();return rows;}finally{db.close();}}
const select=(extra={})=>({child_id:'synthetic-an',request_id:'http-game',expected_revision:0,monster:{...defaultFreeMonster(),color:'sky'},...extra});
test('actual game HTTP isolates roles and denies paid legacy paths without debit',async t=>{
 const f=fixture(),qa=await startLocalQA({...f,mode:'synthetic-local',port:0});t.after(()=>qa.close());const c=client(qa);assert.equal((await c.call('game')).response.status,401);assert.equal((await c.call('login',{access_code:'DEMO-FAMILY-A'})).response.status,200);
 const g=await c.call('game');assert.equal(g.response.status,200,JSON.stringify(g.value));assert.equal(g.value.game.legacy_progress.lifetime_xp,920);assert.equal(g.value.game.wallet.balance,0);assert.ok(!JSON.stringify(g.value).includes('synthetic-secret'));assert.equal(g.response.headers.get('cache-control'),'no-store');assert.equal(g.response.headers.get('x-content-type-options'),'nosniff');assert.match(g.response.headers.get('content-security-policy'),/connect-src 'self'/);
 const before=snapshot(f.dataRoot);for(const route of ['game/buy-monster','game/buy-cosmetic','game/shop-buy']){const r=await c.call(route,select());assert.equal(r.response.status,409);assert.equal(r.value.code,'monster_purchase_retired');}
 const old=await fetch(qa.origin+'/api/read2lead-shop-buy',{method:'POST',headers:{origin:qa.origin,cookie:c.cookie,'content-type':'application/json'},body:JSON.stringify({item_id:'synthetic-retired-paid-item'})});assert.equal(old.status,405);await old.text();assert.deepEqual(snapshot(f.dataRoot),before);
 assert.equal((await c.call('game/monster',select(),{'x-r2l-csrf':'forged'})).response.status,403);assert.equal((await c.call('game/monster',select(),{origin:'https://evil.example'})).response.status,403);assert.equal((await c.call('game/legacy-source')).response.status,404);assert.equal((await c.call('game/import',{snapshot:{}})).response.status,404);assert.equal((await fetch(qa.origin+'/tests/fixtures/read2lead-self-learn/game-legacy.json')).status,404);
 assert.equal((await c.call('child',{child_id:'synthetic-binh'})).response.status,200);const cat=await c.call('game/catalogue');assert.equal(Object.values(cat.value.catalogue.parts).flat().filter(p=>p.id).length,387);const changed=await c.call('game/monster',select({child_id:'synthetic-binh'}));assert.equal(changed.response.status,200);assert.equal(changed.value.current_game.declared_level,'L0');assert.equal(changed.value.current_game.wallet.balance,0);
});
test('actual lost game acknowledgement, restart and consistent backup preserve exact receipts/current choice',async t=>{
 const f=fixture();let dropped=0,qa=await startLocalQA({...f,mode:'synthetic-local',port:0,afterHandle({request,response}){if(new URL(request.url).pathname.endsWith('/game/monster')&&response.ok&&dropped===0){dropped++;return 'drop';}}});t.after(()=>qa.close());let c=client(qa);await c.call('login',{access_code:'DEMO-FAMILY-A'});const before=snapshot(f.dataRoot);
 await assert.rejects(c.call('game/monster',select()));const retry=await c.call('game/monster',select());assert.equal(retry.response.status,200);assert.equal(retry.value.replayed,true);assert.equal(retry.value.preferences.revision,1);assert.equal(dropped,1);
 const next=select({request_id:'http-game-next',expected_revision:1,monster:{...defaultFreeMonster(),color:'grape'}});assert.equal((await c.call('game/monster',next)).response.status,200);const cookie=c.cookie;await qa.close();qa=await startLocalQA({...f,mode:'synthetic-local',port:0});c=client(qa);assert.equal((await c.call('game',undefined,{cookie})).response.status,401);await c.call('login',{access_code:'DEMO-FAMILY-A'});const replay=await c.call('game/monster',select());assert.equal(replay.value.replayed,true);assert.equal(replay.value.preferences.revision,1);assert.equal(replay.value.preferences.monster.color,'sky');assert.equal(replay.value.current_game.preferences.revision,2);assert.equal(replay.value.current_game.preferences.monster.color,'grape');
 const after=snapshot(f.dataRoot);for(const table of Object.keys(before).filter(n=>!n.startsWith('game_')))assert.deepEqual(after[table],before[table],table);assert.equal(after.game_preferences.length,1);assert.equal(after.game_imports.length,1);assert.equal(after.game_receipts.length,3);assert.equal(after.game_audit.length,3);
 const restoredRoot=join(f.root,'restored');initializeSyntheticTarget(restoredRoot);const db=new DatabaseSync(join(f.dataRoot,'read2lead-synthetic.sqlite'));try{await backup(db,join(restoredRoot,'read2lead-synthetic.sqlite'));}finally{db.close();}assert.deepEqual(snapshot(restoredRoot),after);
 const restored=await startLocalQA({...f,dataRoot:restoredRoot,mode:'synthetic-local',port:0});t.after(()=>restored.close());const r=client(restored);await r.call('login',{access_code:'DEMO-FAMILY-A'});assert.deepEqual((await r.call('game')).value.game,replay.value.current_game);assert.equal((await r.call('game/monster',select())).value.replayed,true);assert.equal((await r.call('game/audit')).value.events.length,3);assert.deepEqual(snapshot(restoredRoot),after);
 const check=new DatabaseSync(join(restoredRoot,'read2lead-synthetic.sqlite'),{readOnly:true});try{assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);}finally{check.close();}
 writeFileSync(join(f.root,'recovery-evidence.json'),JSON.stringify({status:'PASS',source:f.dataRoot,backup:restoredRoot,lost_acknowledgements:1,original_receipt_revision:1,current_revision:2,raw_import_preserved:true,wallet_tables_unchanged:true,all_rows_restored:true,independent_review:false},null,2)+'\n');
});


test('host startup preserves a restored nondefault legacy import and creates no extra receipts',async t=>{
 const f=fixture(),read=n=>JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/'+n+'.json',import.meta.url),'utf8'));
 const staff={active:true,role:'staff',id:'synthetic-recovery'},at='2026-09-20T12:00:00.000Z',core=new SyntheticStore({root:f.dataRoot}),family=new SyntheticFamilyStore({mode:'synthetic-local',root:f.dataRoot});
 let game;
 try{
  for(const account of read('family-access').accounts)family.seed(staff,account,at);
  game=new SyntheticGameStore({mode:'synthetic-local',root:f.dataRoot,themes:read('game-seasons').themes,interestIds:read('library-interests').groups.map(g=>g.id)});
  const raw={...read('game-legacy').snapshot,total_xp:1234};
  game.importLegacy(staff,{child_id:'synthetic-an',request_id:'restored-import-original',snapshot:raw,expected_sha256:createHash('sha256').update(canonical(raw)).digest('hex')},at);
 }finally{game?.close();family.close();core.close();}
 const before=snapshot(f.dataRoot);let qa;
 t.after(()=>qa?.close());
 qa=await startLocalQA({...f,mode:'synthetic-local',port:0,now:()=>Date.parse(at)});
 const seeded=snapshot(f.dataRoot);for(const name of ['game_imports','game_audit','game_receipts'])assert.deepEqual(seeded[name],before[name],name);
 let c=client(qa);assert.equal((await c.call('login',{access_code:'DEMO-FAMILY-A'})).response.status,200);assert.equal((await c.call('game')).value.game.legacy_progress.lifetime_xp,1234);
 await qa.close();qa=undefined;const after=snapshot(f.dataRoot);
 qa=await startLocalQA({...f,mode:'synthetic-local',port:0,now:()=>Date.parse(at)});c=client(qa);await c.call('login',{access_code:'DEMO-FAMILY-A'});assert.equal((await c.call('game')).value.game.legacy_progress.lifetime_xp,1234);assert.deepEqual(snapshot(f.dataRoot),after);
});
