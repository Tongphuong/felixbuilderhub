/** Synthetic local gifts. The existing core remains the only wallet writer. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SyntheticStore, StoreError, syntheticDatabasePath } from './read2lead-self-learn-sqlite.mjs';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import { validateSyntheticGiftCatalogue, validateGiftGoal, publicGift, giftGoalView, publicGiftOrder, publicGiftAudit } from '../../functions/lib/read2lead/self-learn/gift-policy.mjs';
const schema = readFileSync(new URL('../../migrations/read2lead-self-learn/006-local-gifts.sql', import.meta.url), 'utf8');
const schemaSql = x => x.replace(/\s+/g, ' ').trim();
const definitions = [...schema.matchAll(/^CREATE (TABLE) (gift_[a-z_]+) \([\s\S]*?^\);/gm), ...schema.matchAll(/^CREATE (TRIGGER) (gift_[a-z_]+) .+;$/gm)].map(m => ({type:m[1].toLowerCase(),name:m[2],sql:schemaSql(m[0].slice(0,-1))})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
const exact = (x,keys) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k=>Object.hasOwn(x,k));
const requireThat = (ok,code) => {if(!ok)throw new StoreError(code);};
const syntheticId = x => validId(x) && x.startsWith('synthetic-');
const timestamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const hash = x => createHash('sha256').update(x).digest('hex');
function authorizeFamily(db,p) {
 requireThat(p?.active===true && ['child','parent'].includes(p.role) && syntheticId(p.familyId) && syntheticId(p.childId) && Number.isSafeInteger(p.credentialVersion),'unauthorized');
 requireThat(db.prepare('SELECT credential_version FROM family_accounts WHERE id=?').get(p.familyId)?.credential_version===p.credentialVersion,'unauthorized');
 const child=db.prepare('SELECT p.archived,p.learning_enabled,c.family_id FROM child_profiles p JOIN children c ON c.id=p.child_id WHERE p.child_id=?').get(p.childId);
 requireThat(child?.family_id===p.familyId,'wrong_child');requireThat(child.archived===0 && child.learning_enabled===1,'child_access_disabled');
}
const staff = p => requireThat(p?.active===true && p.role==='staff' && syntheticId(p.id),'unauthorized');
export class SyntheticGiftStore {
 #db; #core; #fault;
 constructor({mode,root,fault=()=>{}}={}) {
  requireThat(mode==='synthetic-local','unsafe_gift_mode');this.#fault=fault;
  const path=syntheticDatabasePath(root);requireThat(existsSync(path),'core_store_required');this.#db=new DatabaseSync(path);
  try {
   this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
   requireThat(this.#db.prepare("SELECT value FROM r2l_meta WHERE key='family_schema_version'").get()?.value==='1','family_store_required');
   const check=()=>{
    const version=this.#db.prepare("SELECT value FROM r2l_meta WHERE key='gift_goal_schema_version'").get()?.value;
    requireThat(version===undefined || version==='1','unsupported_gift_schema');
    const rows=this.#db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name GLOB 'gift_goal*' ORDER BY name").all().map(r=>({...r,sql:schemaSql(r.sql)}));
    requireThat(version==='1'?canonical(rows)===canonical(definitions):rows.length===0,'unrecognized_gift_schema');return version;
   };
   check();this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
   try {if(check()===undefined){this.#db.exec(schema);check();}this.#db.exec('COMMIT');}catch(e){this.#db.exec('ROLLBACK');throw e;}
   this.#core=new SyntheticStore({root,fault});
  } catch(e){this.#db.close();throw e;}
 }
 close(){this.#core.close();this.#db.close();}
 #read(fn){this.#db.exec('BEGIN');try{const result=fn();this.#db.exec('COMMIT');return result;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #transaction(fn){this.#fault('gift_before_write_lock');this.#db.exec('BEGIN IMMEDIATE');let committed=false;try{const result=fn();this.#fault('gift_goal_before_commit');this.#db.exec('COMMIT');committed=true;this.#fault('gift_goal_after_commit');return result;}catch(e){if(!committed)this.#db.exec('ROLLBACK');throw e;}}
 #goal(childId){const row=this.#db.prepare('SELECT revision,gift_id,quoted_version FROM gift_goals WHERE child_id=?').get(childId);return {revision:row?.revision??0,goal:row?.gift_id?{gift_id:row.gift_id,quoted_version:row.quoted_version}:null};}
 #catalogue(){return this.#db.prepare('SELECT g.* FROM gifts g JOIN catalog c ON c.gift_id=g.id AND c.version=g.version ORDER BY g.id').all();}
 #order(id){return this.#db.prepare('SELECT r.*,g.title FROM redemptions r JOIN gifts g ON g.id=r.gift_id AND g.version=r.gift_version WHERE r.id=?').get(id);}
 #view(childId){
  const catalogue=this.#catalogue(),goal=this.#goal(childId),balance=this.#db.prepare('SELECT balance FROM wallets WHERE child_id=?').get(childId).balance;
  const orders=this.#db.prepare('SELECT r.*,g.title FROM redemptions r JOIN gifts g ON g.id=r.gift_id AND g.version=r.gift_version WHERE r.child_id=? ORDER BY r.rowid DESC LIMIT 100').all(childId).map(publicGiftOrder);
  const audit=publicGiftAudit(this.#db.prepare('SELECT a.* FROM redemption_audit a JOIN redemptions r ON r.id=a.redemption_id WHERE r.child_id=? ORDER BY a.id DESC LIMIT 100').all(childId));
  return {child_id:childId,synthetic:true,real_rewards:false,funding_status:'not_funded',wallet:{balance,currency:'diamonds'},catalogue:catalogue.map(publicGift),goal:{...goal,...giftGoalView(goal.goal,catalogue,balance)},orders,audit};
 }
 view(principal,authorize=()=>{}){return this.#read(()=>{authorizeFamily(this.#db,principal);authorize();return this.#view(principal.childId);});}
 goalAudit(principal){return this.#read(()=>{authorizeFamily(this.#db,principal);return this.#db.prepare('SELECT revision,goal_json,created_at FROM gift_goal_audit WHERE child_id=? ORDER BY id DESC LIMIT 100').all(principal.childId).map(r=>({revision:r.revision,goal:validateGiftGoal(JSON.parse(r.goal_json)),created_at:r.created_at}));});}
 setGoal(principal,data,now,authorize=()=>{}){
  authorizeFamily(this.#db,principal);
  requireThat(exact(data,['request_id','expected_revision','goal']) && validId(data.request_id) && Number.isSafeInteger(data.expected_revision) && data.expected_revision>=0 && data.expected_revision<Number.MAX_SAFE_INTEGER && timestamp(now),'invalid_request');
  const goal=validateGiftGoal(data.goal),digest=hash(canonical({operation:'set_goal',expected_revision:data.expected_revision,goal}));
  return this.#transaction(()=>{
   authorizeFamily(this.#db,principal);authorize();
   const old=this.#db.prepare('SELECT payload_sha256,response_json FROM gift_goal_receipts WHERE child_id=? AND request_id=?').get(principal.childId,data.request_id);
   if(old){requireThat(old.payload_sha256===digest,'request_conflict');return {...JSON.parse(old.response_json),replayed:true};}
   const current=this.#goal(principal.childId);requireThat(current.revision===data.expected_revision,'stale_revision');requireThat(current.revision<Number.MAX_SAFE_INTEGER-1,'revision_limit');
   if(goal){const gift=this.#db.prepare('SELECT version FROM catalog WHERE gift_id=?').get(goal.gift_id);requireThat(!!gift,'gift_unavailable');requireThat(gift.version===goal.quoted_version,'gift_changed');}
   this.#db.prepare('INSERT INTO gift_goals VALUES(?,?,?,?,?) ON CONFLICT(child_id) DO UPDATE SET revision=excluded.revision,gift_id=excluded.gift_id,quoted_version=excluded.quoted_version,updated_at=excluded.updated_at').run(principal.childId,current.revision+1,goal?.gift_id??null,goal?.quoted_version??null,now);this.#fault('gift_goal_updated');
   this.#db.prepare('INSERT INTO gift_goal_audit(child_id,revision,goal_json,created_by,created_at) VALUES(?,?,?,?,?)').run(principal.childId,current.revision+1,JSON.stringify(goal),principal.familyId,now);this.#fault('gift_goal_audit_inserted');
   const result={ok:true,goal:this.#goal(principal.childId),replayed:false};
   this.#db.prepare('INSERT INTO gift_goal_receipts VALUES(?,?,?,?)').run(principal.childId,data.request_id,digest,JSON.stringify(result));this.#fault('gift_goal_receipt_inserted');return result;
  });
 }
 /** Trusted local configuration only. Versioned gift rows cannot be overwritten. */
 seedCatalogue(principal,config,authorize=()=>{}){staff(principal);const value=validateSyntheticGiftCatalogue(config);for(const p of value.items)this.#core.setGift(principal,{gift_id:p.gift_id,version:p.version,title:p.title_vi,price:p.price_diamonds,available:p.available},db=>{staff(principal);authorize();requireThat(db.prepare("SELECT value FROM r2l_meta WHERE key='environment'").get()?.value==='synthetic','unsafe_target');});return {ok:true,count:value.items.length};}
 /** Startup may fill missing sample items but never republish an older current version. */
 initializeCatalogue(principal,config){
  staff(principal);const value=validateSyntheticGiftCatalogue(config);let initialized=0;
  for(const p of value.items){try{this.#core.setGift(principal,{gift_id:p.gift_id,version:p.version,title:p.title_vi,price:p.price_diamonds,available:p.available},db=>{staff(principal);if(db.prepare('SELECT version FROM catalog WHERE gift_id=?').get(p.gift_id))throw new StoreError('catalogue_already_present');});initialized++;}catch(e){if(e.code!=='catalogue_already_present')throw e;}}
  return {ok:true,initialized};
 }
 #receipt(result){const title=this.#db.prepare('SELECT title FROM gifts WHERE id=? AND version=?').get(result.redemption.gift_id,result.redemption.gift_version)?.title;return {ok:true,redemption:publicGiftOrder({...result.redemption,title}),...(result.balance===undefined?{}:{balance:result.balance}),replayed:result.replayed};}
 redeem(principal,data,now,authorize=()=>{}){
  authorizeFamily(this.#db,principal);requireThat(exact(data,['request_id','gift_id','quoted_version']) && validId(data.request_id) && validId(data.gift_id) && validId(data.quoted_version) && timestamp(now),'invalid_request');
  return this.#receipt(this.#core.redeem(principal,{...data,child_id:principal.childId},now,db=>{authorizeFamily(db,principal);authorize();}));
 }
 fulfil(principal,data,now,authorize=()=>{}){staff(principal);requireThat(timestamp(now),'invalid_request');return this.#receipt(this.#core.fulfil(principal,data,now,()=>{staff(principal);authorize();}));}
 refund(principal,data,now,authorize=()=>{}){staff(principal);requireThat(timestamp(now),'invalid_request');return this.#receipt(this.#core.refund(principal,data,now,()=>{staff(principal);authorize();}));}
 /** Trusted staff view; bounded and excludes credentials,addresses and private notes. */
 staffOrders(principal,authorize=()=>{}){return this.#read(()=>{staff(principal);authorize();return this.#db.prepare('SELECT r.*,g.title FROM redemptions r JOIN gifts g ON g.id=r.gift_id AND g.version=r.gift_version ORDER BY r.rowid DESC LIMIT 100').all().map(r=>({child_id:r.child_id,...publicGiftOrder(r)}));});}
 staffOrder(principal,id,authorize=()=>{}){return this.#read(()=>{staff(principal);authorize();requireThat(typeof id==='string' && id.length>0 && id.length<=300,'invalid_request');const order=this.#order(id);requireThat(!!order,'order_missing');return {child_id:order.child_id,order:publicGiftOrder(order),wallet:{balance:this.#db.prepare('SELECT balance FROM wallets WHERE child_id=?').get(order.child_id).balance,currency:'diamonds'},audit:publicGiftAudit(this.#db.prepare('SELECT * FROM redemption_audit WHERE redemption_id=? ORDER BY id DESC LIMIT 100').all(id))};});}
}
