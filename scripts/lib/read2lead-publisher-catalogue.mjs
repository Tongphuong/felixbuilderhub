/** Durable private-local catalogue. No deployment, learner migration or network writes. */
import {createHash} from 'node:crypto';
import {canonical} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import {validatePublisherPackage,publisherReadiness} from '../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {comparePublisherSource,validatePublisherSeries} from '../../functions/lib/read2lead/self-learn/publisher-library-policy.mjs';
import {publisherStoreDigest,verifyPublisherAsset,createPublisherAssetVerifier,createPublisherAsyncAssetVerifier} from './read2lead-publisher-import.mjs';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const requireThat=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const FORMAT='r2l-private-publisher-catalogue/1';
const key=t=>JSON.stringify([t.source_id,t.version]);
const time=now=>requireThat(typeof now==='string'&&Number.isFinite(Date.parse(now)),'catalogue_time_required');
function initialized(db){requireThat(db.prepare("SELECT value FROM publisher_meta WHERE key='catalogue_format'").get()?.value===FORMAT,'publisher_catalogue_not_initialized');}
export function initializePublisherCatalogue(db){
 requireThat(db.prepare("SELECT value FROM publisher_meta WHERE key='format'").get()?.value==='r2l-private-publisher-store/1','wrong_publisher_store');
 if(db.prepare("SELECT value FROM publisher_meta WHERE key='catalogue_format'").get()){initialized(db);return{initialized:true,created:false,learner_writes:0};}
 db.exec('BEGIN IMMEDIATE');try{
  db.exec(`CREATE TABLE publisher_catalogues(id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE publisher_catalogue_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),catalogue_id TEXT REFERENCES publisher_catalogues(id));
   INSERT INTO publisher_catalogue_head VALUES(1,NULL);
   CREATE TABLE publisher_catalogue_receipts(plan_sha256 TEXT PRIMARY KEY,result_json TEXT NOT NULL);`);
  db.prepare('INSERT INTO publisher_meta VALUES(?,?)').run('catalogue_format',FORMAT);
  db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('catalogue_initialized',JSON.stringify({format:FORMAT}));
  db.exec('COMMIT');return{initialized:true,created:true,learner_writes:0};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function publisherCatalogueHead(db){initialized(db);const row=db.prepare('SELECT catalogue_id FROM publisher_catalogue_head WHERE singleton=1').get();requireThat(row&&(row.catalogue_id===null||/^[a-f0-9]{64}$/.test(row.catalogue_id)),'publisher_catalogue_integrity');return row.catalogue_id;}
// Runtime invalidation only; plans and snapshots still use full content checksums.
const stampQueries=new WeakMap();
export function publisherCatalogueStamp(db){
 let queries=stampQueries.get(db);if(!queries){initialized(db);queries={version:db.prepare('PRAGMA data_version'),changes:db.prepare('SELECT total_changes() AS changes')};stampQueries.set(db,queries);}
 for(let i=0;i<3;i++){const first=queries.version.get().data_version,changes=queries.changes.get().changes,last=queries.version.get().data_version;if(first===last)return first+':'+changes;}
 throw Error('stale_catalogue_snapshot');
}

export function publisherCatalogueState(db){initialized(db);return digest({store:publisherStoreDigest(db),head:publisherCatalogueHead(db),catalogues:db.prepare('SELECT id,manifest_json,created_at FROM publisher_catalogues ORDER BY id').all()});}
function savedCatalogue(db,id){
 const row=db.prepare('SELECT manifest_json FROM publisher_catalogues WHERE id=?').get(id);requireThat(row,'unknown_publisher_catalogue');
 const manifest=JSON.parse(row.manifest_json);requireThat(manifest.format===FORMAT&&digest(manifest)===id&&Array.isArray(manifest.entries),'publisher_catalogue_integrity');return manifest;
}
export function publisherCatalogueMembership(db,target){
 if(!db.prepare("SELECT value FROM publisher_meta WHERE key='catalogue_format'").get())return{ever_published:false,discovery_active:false,catalogue_ids:[]};
 const head=publisherCatalogueHead(db),ids=[];
 for(const row of db.prepare('SELECT id FROM publisher_catalogues ORDER BY created_at,id').all())if(savedCatalogue(db,row.id).entries.some(e=>key(e)===key(target)&&e.content_sha256===target.content_sha256))ids.push(row.id);
 return{ever_published:ids.length>0,discovery_active:ids.includes(head),catalogue_ids:ids};
}
async function inspect(db,target,{assetRoot,now},proofCache,verifyAsset=asset=>verifyPublisherAsset(asset,assetRoot)){
 const row=db.prepare('SELECT * FROM publisher_packages WHERE source_id=? AND version=?').get(target.source_id,target.version);requireThat(row,'unknown_publisher_version');
 const {package:pkg,package_sha256}=await validatePublisherPackage(JSON.parse(row.package_json));
 requireThat(pkg.lesson.source.source_id===row.source_id&&pkg.lesson.id===row.lesson_id&&pkg.lesson.version===row.version&&package_sha256===row.content_sha256&&digest(pkg)===row.package_sha256,'publisher_store_integrity');
 requireThat(row.state!=='withdrawn','withdrawn_version');
 const outcomes=await Promise.allSettled(pkg.assets.map(asset=>{
  const id=digest(asset);if(!proofCache.has(id))proofCache.set(id,Promise.resolve().then(()=>verifyAsset(asset)));return proofCache.get(id);
 }));
 const failed=outcomes.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 const proofs=outcomes.map(result=>result.value);
 const readiness=await publisherReadiness(pkg,{now,assetProofs:proofs});
 requireThat(readiness.publication_ready&&pkg.reviews.every(r=>r.status==='approved'),'publisher_not_approved');
 return{package:pkg,proofs,entry:{source_id:row.source_id,version:row.version,content_sha256:row.content_sha256,approval_sha256:row.package_sha256}};
}
async function prepare(db,targets,options){
 requireThat(Array.isArray(targets)&&targets.length<=2000,'invalid_catalogue_size');
 requireThat(new Set(targets.map(t=>t.source_id)).size===targets.length,'duplicate_catalogue_source');
 const cache=new Map(),entries=[];for(const t of targets)entries.push(await inspect(db,t,options,cache));
 entries.sort((a,b)=>comparePublisherSource(a.package.lesson,b.package.lesson));
 const sources=validatePublisherSeries(entries.map(e=>e.package.lesson));
 requireThat(entries.every(e=>e.package.lesson.source.predecessor_source_id===null||sources.has(e.package.lesson.source.predecessor_source_id)),'catalogue_predecessor_missing');
 return entries;
}
export async function planPublisherCatalogue(db,{targets,rollback_to=null,operator,reason},{assetRoot,now}={}){
 initialized(db);time(now);requireThat(typeof operator==='string'&&operator.trim()&&operator.length<=200&&typeof reason==='string'&&reason.trim()&&reason.length<=1000,'catalogue_audit_required');
 requireThat(rollback_to===null||targets===undefined,'ambiguous_catalogue_request');
 const before=publisherCatalogueState(db),previous=publisherCatalogueHead(db),saved=rollback_to===null?null:savedCatalogue(db,rollback_to);
 const inspected=await prepare(db,saved?saved.entries:targets,{assetRoot,now});
 if(saved)requireThat(inspected.every(e=>saved.entries.some(old=>key(old)===key(e.entry)&&old.content_sha256===e.entry.content_sha256)),'publisher_catalogue_integrity');
 const manifest=saved??{format:FORMAT,entries:inspected.map(e=>e.entry)};
 requireThat(publisherCatalogueState(db)===before,'stale_catalogue_snapshot');
 const plan={format:'r2l-publisher-catalogue-plan/1',action:saved?'rollback':'publish',store_sha256:before,previous_catalogue_id:previous,catalogue_id:digest(manifest),manifest,approval_checks:inspected.map(e=>e.entry),operator,reason,created_at:now};
 return{plan,plan_sha256:digest(plan),writes:0,scope:'private_local_catalogue',production_release_authorized:false};
}
export async function applyPublisherCatalogue(db,{plan,plan_sha256},{assetRoot,now,commit=work=>work()}={}){
 initialized(db);time(now);requireThat(plan?.format==='r2l-publisher-catalogue-plan/1'&&digest(plan)===plan_sha256&&['publish','rollback'].includes(plan.action)&&digest(plan.manifest)===plan.catalogue_id,'invalid_catalogue_plan');
 const receipt=()=>db.prepare('SELECT result_json FROM publisher_catalogue_receipts WHERE plan_sha256=?').get(plan_sha256);
 const replay=receipt();if(replay)return commit(()=>({...JSON.parse(replay.result_json),replayed:true,current_catalogue_id:publisherCatalogueHead(db)}));
 requireThat(publisherCatalogueState(db)===plan.store_sha256,'stale_catalogue_plan');
 const fresh=await planPublisherCatalogue(db,{...(plan.action==='rollback'?{rollback_to:plan.catalogue_id}:{targets:plan.manifest.entries}),operator:plan.operator,reason:plan.reason},{assetRoot,now});
 requireThat(fresh.plan.catalogue_id===plan.catalogue_id&&digest(fresh.plan.approval_checks)===digest(plan.approval_checks),'stale_catalogue_approval');
 return commit(()=>{
 db.exec('BEGIN IMMEDIATE');try{
  requireThat(publisherCatalogueState(db)===plan.store_sha256&&publisherCatalogueHead(db)===plan.previous_catalogue_id,'stale_catalogue_plan');
  db.prepare('INSERT OR IGNORE INTO publisher_catalogues VALUES(?,?,?)').run(plan.catalogue_id,JSON.stringify(plan.manifest),now);
  // Even an existing snapshot must match its content address.
  savedCatalogue(db,plan.catalogue_id);
  db.prepare('UPDATE publisher_catalogue_head SET catalogue_id=? WHERE singleton=1').run(plan.catalogue_id);
  db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('catalogue_'+plan.action,JSON.stringify({catalogue_id:plan.catalogue_id,previous_catalogue_id:plan.previous_catalogue_id,operator:plan.operator,reason:plan.reason,approval_checks:plan.approval_checks,at:now}));
  const result={catalogue_id:plan.catalogue_id,previous_catalogue_id:plan.previous_catalogue_id,action:plan.action,scope:'private_local_catalogue',learner_writes:0,production_release_authorized:false};
  db.prepare('INSERT INTO publisher_catalogue_receipts VALUES(?,?)').run(plan_sha256,JSON.stringify(result));db.exec('COMMIT');return{...result,replayed:false,current_catalogue_id:plan.catalogue_id};
 }catch(error){db.exec('ROLLBACK');throw error;}
 });
}
/** All ever-published versions remain pinned for sessions; only head entries enter discovery. */
export function loadPublisherCatalogue(db,{assetRoot,now}={}){return loadCatalogue(db,{assetRoot,now},asset=>verifyPublisherAsset(asset,assetRoot));}
/** A private loader owns its decode cache; callers cannot insert proof records. */
export function createPublisherCatalogueLoader({assetRoot,asyncAssets=false}){
 requireThat(typeof asyncAssets==='boolean','invalid_asset_verification');
 const verifyAsset=asyncAssets?createPublisherAsyncAssetVerifier(assetRoot):createPublisherAssetVerifier(assetRoot);let closed=false;
 const checkOpen=()=>requireThat(!closed,'asset_verifier_closed');
 const load=(db,{now}={})=>{checkOpen();return loadCatalogue(db,{assetRoot,now},verifyAsset,checkOpen);};
 load.close=async()=>{closed=true;await verifyAsset.close?.();};return load;
}
async function loadCatalogue(db,{assetRoot,now},verifyAsset,checkOpen=()=>{}){
 initialized(db);time(now);const stamp=publisherCatalogueStamp(db),before=publisherCatalogueState(db),head=publisherCatalogueHead(db),current=head?savedCatalogue(db,head).entries:[],history=new Map();
 for(const row of db.prepare('SELECT id FROM publisher_catalogues ORDER BY created_at,id').all())for(const entry of savedCatalogue(db,row.id).entries){const old=history.get(key(entry));requireThat(!old||old.content_sha256===entry.content_sha256,'publisher_catalogue_integrity');history.set(key(entry),entry);}
 const packages=[],packageByKey=new Map(),proofs=new Map(),blocked=[],available=new Set(),cache=new Map();let ready_until=Infinity;
 for(const entry of history.values()){
  checkOpen();
  try{
   const value=await inspect(db,entry,{assetRoot,now},cache,verifyAsset);requireThat(value.entry.content_sha256===entry.content_sha256,'publisher_catalogue_integrity');
   packages.push(value.package);packageByKey.set(key(entry),value.package);available.add(key(entry));for(const proof of value.proofs)proofs.set(digest(proof),proof);
   for(const grant of value.package.rights)if(grant.status==='granted'&&Date.parse(grant.valid_until)>Date.parse(now))ready_until=Math.min(ready_until,Date.parse(grant.valid_until));
  }catch(error){
   if(['publisher_store_integrity','publisher_catalogue_integrity','unknown_publisher_version'].includes(error.message))throw error;
   blocked.push({source_id:entry.source_id,version:entry.version,reason:['withdrawn_version','publisher_not_approved'].includes(error.message)?error.message:'asset_unavailable'});
  }
 }
 checkOpen();requireThat(publisherCatalogueState(db)===before&&publisherCatalogueStamp(db)===stamp,'stale_catalogue_snapshot');
 return{catalogue_id:head,store_sha256:before,store_stamp:stamp,packages,assetProofs:[...proofs.values()],catalogueVersions:current.filter(e=>available.has(key(e))).map(e=>{const p=packageByKey.get(key(e));return{id:p.lesson.id,version:e.version};}),
  published_lesson_ids:[...new Set([...history.values()].map(e=>db.prepare('SELECT lesson_id FROM publisher_packages WHERE source_id=? AND version=?').get(e.source_id,e.version).lesson_id))],blocked,ready_until,scope:'private_local_catalogue',production_release_authorized:false};
}
