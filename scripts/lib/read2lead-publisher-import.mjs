/** Offline editorial registry. Separate private database; never a learner writer. */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {validatePublisherPackage,publisherReadiness} from '../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {canonical} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(canonical(value));
function safePath(input){const absolute=path.resolve(input);requireThat(!absolute.split(path.sep).some(p=>['public','dist','.git'].includes(p)),'private_store_required');requireThat(fs.realpathSync(path.dirname(absolute))===path.dirname(absolute),'symlink_path_refused');if(fs.existsSync(absolute)||fs.lstatSync(path.dirname(absolute)).isSymbolicLink())requireThat(!fs.lstatSync(absolute).isSymbolicLink(),'symlink_path_refused');return absolute;}
export function openPublisherStore(filename,{create=false}={}){
 const target=safePath(filename),exists=fs.existsSync(target);
 requireThat(exists||create,'publisher_store_missing');requireThat(!(exists&&create),'publisher_store_exists');
 if(!exists){const fd=fs.openSync(target,'wx',0o600);fs.closeSync(fd);}
 const db=new DatabaseSync(target);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 try{
  if(!exists){db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE publisher_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   INSERT INTO publisher_meta VALUES('format','r2l-private-publisher-store/1');
   CREATE TABLE publisher_packages(source_id TEXT NOT NULL,version TEXT NOT NULL,lesson_id TEXT NOT NULL,content_sha256 TEXT NOT NULL,package_sha256 TEXT NOT NULL,package_json TEXT NOT NULL,readiness_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('draft','withdrawn')),PRIMARY KEY(source_id,version),UNIQUE(lesson_id,version));
   CREATE TABLE publisher_receipts(plan_sha256 TEXT PRIMARY KEY,result_json TEXT NOT NULL);
   CREATE TABLE publisher_events(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,source_id TEXT,version TEXT,payload_json TEXT NOT NULL);
   COMMIT;`);}
  requireThat(db.prepare("SELECT value FROM publisher_meta WHERE key='format'").get()?.value==='r2l-private-publisher-store/1','wrong_publisher_store');
  return db;
 }catch(e){db.close();throw Error('wrong_publisher_store',{cause:e});}
}
export function publisherStoreDigest(db){return digest({packages:db.prepare('SELECT source_id,version,lesson_id,content_sha256,package_sha256,state FROM publisher_packages ORDER BY source_id,version').all(),events:db.prepare('SELECT * FROM publisher_events ORDER BY id').all()});}
export function verifyPublisherAsset(asset,assetRoot){return verifyAsset(asset,assetRoot,null);}
/** Runtime-local decode reuse. Every call still validates the current path, bytes and metadata. */
export function createPublisherAssetVerifier(assetRoot){
 const root=path.resolve(assetRoot),decoded=new Set();
 return asset=>verifyAsset(asset,root,decoded);
}
function inspectAssetBytes(asset,assetRoot){
 const root=fs.realpathSync(assetRoot);requireThat(root===path.resolve(assetRoot),'symlink_path_refused');
 const filename=path.join(root,asset.object_key);requireThat(path.dirname(filename)===root,'asset_path_refused');
 const stat=fs.lstatSync(filename);requireThat(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===asset.bytes&&stat.size<=104857600,'asset_size_or_type');
 const bytes=fs.readFileSync(filename);requireThat(hash(bytes)===asset.sha256,'asset_hash_mismatch');
 const signature=asset.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):asset.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:asset.mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':asset.mime==='audio/wav'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':asset.mime==='audio/ogg'?bytes.toString('ascii',0,4)==='OggS':bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224);
 requireThat(signature,'asset_mime_mismatch');
 return filename;
}
const probeArgs=filename=>['-v','error','-show_entries','stream=codec_name,codec_type,width,height:format=duration','-of','json',filename];
const decodeArgs=(asset,filename)=>['-nostdin','-v','error','-xerror','-i',filename,'-map',asset.kind==='audio'?'0:a:0':'0:v:0','-f','null','-'];
function checkProbe(asset,probe){
 const stream=probe.streams?.find(s=>s.codec_type===(asset.kind==='audio'?'audio':'video'));
 requireThat(stream,'asset_stream_missing');
 const codecs={'image/png':['png'],'image/jpeg':['mjpeg'],'image/webp':['webp'],'audio/mpeg':['mp3'],'audio/wav':['pcm_s16le','pcm_s24le','pcm_s32le','pcm_f32le'],'audio/ogg':['vorbis','opus']};
 requireThat(codecs[asset.mime].includes(stream.codec_name),'asset_codec_mismatch');
 if(asset.kind==='image')requireThat(stream.width===asset.width&&stream.height===asset.height,'asset_dimensions_mismatch');
 else requireThat(Math.abs(Number(probe.format?.duration)-asset.duration_seconds)<0.1,'asset_duration_mismatch');
}
function unchangedAfterDecode(asset,root){
 try{inspectAssetBytes(asset,root);}catch{throw Error('asset_changed_during_decode');}
}
const assetProof=asset=>({id:asset.id,sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime,decoded:true});
function verifyAsset(asset,assetRoot,decoded){
 const filename=inspectAssetBytes(asset,assetRoot),cacheKey=digest(asset);
 if(!decoded?.has(cacheKey)){
  let probe;
  try{
   probe=JSON.parse(execFileSync('ffprobe',probeArgs(filename),{encoding:'utf8',timeout:30000,maxBuffer:1048576}));
   execFileSync('ffmpeg',decodeArgs(asset,filename),{timeout:60000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});
  }catch{throw Error('asset_decode_failed');}
  checkProbe(asset,probe);unchangedAfterDecode(asset,assetRoot);decoded?.add(cacheKey);
 }
 return assetProof(asset);
}
/** Bounded, process-local decoder reuse for the read-only runtime worker. */
export function createPublisherAsyncAssetVerifier(assetRoot,{concurrency=4}={}){
 requireThat(Number.isSafeInteger(concurrency)&&concurrency>=1&&concurrency<=4,'invalid_asset_concurrency');
 const root=path.resolve(assetRoot),decoded=new Set(),queue=[],children=new Set();let active=0,closed=false,closing=null;
 const checkOpen=()=>requireThat(!closed,'asset_verifier_closed');
 const pump=()=>{while(!closed&&active<concurrency&&queue.length){const job=queue.shift();active++;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{active--;pump();});}};
 const schedule=work=>new Promise((resolve,reject)=>{if(closed){reject(Error('asset_verifier_closed'));return;}queue.push({work,resolve,reject});pump();});
 const run=(command,args,timeout)=>new Promise((resolve,reject)=>{
  checkOpen();
  const child=execFile(command,args,{encoding:'utf8',timeout,maxBuffer:1048576,killSignal:'SIGKILL'},(error,stdout)=>error?reject(error):resolve(stdout));
  children.add(child);child.once('close',()=>children.delete(child));
 });
 const verify=async input=>{
  const asset=structuredClone(input);
  return schedule(async()=>{
   checkOpen();const filename=inspectAssetBytes(asset,root),cacheKey=digest(asset);
   if(!decoded.has(cacheKey)){
    let probe;
    try{probe=JSON.parse(await run('ffprobe',probeArgs(filename),30000));await run('ffmpeg',decodeArgs(asset,filename),60000);}
    catch{checkOpen();throw Error('asset_decode_failed');}
    checkOpen();checkProbe(asset,probe);unchangedAfterDecode(asset,root);decoded.add(cacheKey);
   }
   checkOpen();return assetProof(asset);
  });
 };
 verify.close=()=>{
  if(closing)return closing;closed=true;decoded.clear();for(const job of queue.splice(0))job.reject(Error('asset_verifier_closed'));
  closing=Promise.all([...children].map(child=>new Promise(resolve=>{child.once('close',resolve);child.kill('SIGKILL');}))).then(()=>{});return closing;
 };
 return verify;
}

async function prepare(packages,{assetRoot,now}){
 requireThat(Array.isArray(packages)&&packages.length>0&&packages.length<=90,'invalid_batch_size');
 const snapshots=[];
 for(const input of packages){
  const {package:pkg,package_sha256:content_sha256}=await validatePublisherPackage(input);
  const proofs=pkg.assets.map(a=>verifyPublisherAsset(a,assetRoot));
  const readiness=await publisherReadiness(pkg,{now,assetProofs:proofs});
  snapshots.push({pkg,content_sha256,package_sha256:digest(pkg),readiness});
 }
 requireThat(new Set(snapshots.map(s=>s.pkg.lesson.source.source_id+'@'+s.pkg.lesson.version)).size===snapshots.length,'duplicate_batch_version');
 requireThat(new Set(snapshots.map(s=>s.pkg.lesson.id+'@'+s.pkg.lesson.version)).size===snapshots.length,'duplicate_batch_lesson');
 return snapshots;
}
function conflicts(db,s){
 const l=s.pkg.lesson,existing=db.prepare('SELECT * FROM publisher_packages WHERE source_id=? AND version=?').get(l.source.source_id,l.version);
 if(existing){requireThat(existing.lesson_id===l.id&&existing.content_sha256===s.content_sha256,'immutable_version_conflict');requireThat(existing.state!=='withdrawn','withdrawn_version');}
 const identities=db.prepare('SELECT source_id,lesson_id,package_json FROM publisher_packages WHERE source_id=? OR lesson_id=?').all(l.source.source_id,l.id);
 requireThat(identities.every(r=>r.source_id===l.source.source_id&&r.lesson_id===l.id),'source_identity_conflict');
 const identity=source=>Object.fromEntries(['kind','collection_id','collection_level','edition_id','book_id','month','story_number'].map(k=>[k,source[k]]));
 requireThat(identities.every(r=>digest(identity(JSON.parse(r.package_json).lesson.source))===digest(identity(l.source))),'source_identity_conflict');
 return existing;
}
export async function planPublisherImport(db,packages,options){
 const snapshots=await prepare(packages,options);
 for(const s of snapshots)conflicts(db,s);
 const plan={format:'r2l-publisher-import-plan/1',store_sha256:publisherStoreDigest(db),packages:snapshots.map(s=>({source_id:s.pkg.lesson.source.source_id,version:s.pkg.lesson.version,package_sha256:s.package_sha256})),readiness_at:options.now};
 return {plan,plan_sha256:digest(plan),readiness:snapshots.map(s=>({source_id:s.pkg.lesson.source.source_id,...s.readiness})),writes:0};
}
export async function applyPublisherImport(db,packages,{plan,plan_sha256,assetRoot,now,commit=work=>work()}={}){
 requireThat(plan?.format==='r2l-publisher-import-plan/1'&&digest(plan)===plan_sha256,'invalid_import_plan');
 const snapshots=await prepare(packages,{assetRoot,now});
 requireThat(digest(plan.packages)===digest(snapshots.map(s=>({source_id:s.pkg.lesson.source.source_id,version:s.pkg.lesson.version,package_sha256:s.package_sha256}))),'stale_package_plan');
 return commit(()=>{
 db.exec('BEGIN IMMEDIATE');
 try{
  const receipt=db.prepare('SELECT result_json FROM publisher_receipts WHERE plan_sha256=?').get(plan_sha256);
  if(receipt){db.exec('COMMIT');return JSON.parse(receipt.result_json);}
  requireThat(publisherStoreDigest(db)===plan.store_sha256,'stale_store_plan');
  let inserted=0,reviewUpdated=0,unchanged=0;
  for(const s of snapshots){
   const existing=conflicts(db,s),l=s.pkg.lesson;
   if(existing?.package_sha256===s.package_sha256){unchanged++;continue;}
   if(existing){db.prepare('UPDATE publisher_packages SET package_sha256=?,package_json=?,readiness_json=? WHERE source_id=? AND version=?').run(s.package_sha256,JSON.stringify(s.pkg),JSON.stringify(s.readiness),l.source.source_id,l.version);reviewUpdated++;}
   else{db.prepare('INSERT INTO publisher_packages VALUES(?,?,?,?,?,?,?,?)').run(l.source.source_id,l.version,l.id,s.content_sha256,s.package_sha256,JSON.stringify(s.pkg),JSON.stringify(s.readiness),'draft');inserted++;}
   db.prepare('INSERT INTO publisher_events(kind,source_id,version,payload_json) VALUES(?,?,?,?)').run(existing?'review_updated':'imported',l.source.source_id,l.version,JSON.stringify({package_sha256:s.package_sha256,at:now,reviews_before:existing?JSON.parse(existing.package_json).reviews:[],reviews_after:s.pkg.reviews}));
  }
  const result={format:'r2l-publisher-import-result/1',inserted,review_updated:reviewUpdated,unchanged,publication:'private_only',learner_writes:0,plan_sha256};
  db.prepare('INSERT INTO publisher_receipts VALUES(?,?)').run(plan_sha256,JSON.stringify(result));db.exec('COMMIT');return result;
 }catch(e){db.exec('ROLLBACK');throw e;}
 });
}
export function withdrawPublisherVersion(db,{source_id,version,reason,now,operator}){
 requireThat(typeof reason==='string'&&reason.trim().length>0&&reason.length<=1000&&Number.isFinite(Date.parse(now)),'invalid_withdrawal');
 db.exec('BEGIN IMMEDIATE');try{
  const row=db.prepare('SELECT state FROM publisher_packages WHERE source_id=? AND version=?').get(source_id,version);requireThat(row,'unknown_publisher_version');
  if(row.state!=='withdrawn'){db.prepare("UPDATE publisher_packages SET state='withdrawn' WHERE source_id=? AND version=?").run(source_id,version);db.prepare('INSERT INTO publisher_events(kind,source_id,version,payload_json) VALUES(?,?,?,?)').run('withdrawn',source_id,version,JSON.stringify({reason,at:now,...(operator?{operator}:{})}));}
  db.exec('COMMIT');return{state:'withdrawn',learner_writes:0};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
