/** Local catalogue integration. Synthetic QA and approved publisher previews have distinct branded paths. */
import {comparePublisherSource,validatePublisherSeries} from '../../functions/lib/read2lead/self-learn/publisher-library-policy.mjs';
import {createHash} from 'node:crypto';
import {setImmediate as yieldToRequests} from 'node:timers/promises';
import {createPublisherWorkerLoader} from './read2lead-publisher-worker.mjs';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createPublisherCatalogueLoader,publisherCatalogueStamp,publisherCatalogueState} from './read2lead-publisher-catalogue.mjs';
import {validatePublisherPackage} from '../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {publisherSessionView,publicPublisherLesson} from '../../functions/lib/read2lead/self-learn/publisher-views.mjs';
import {publicReading} from '../../functions/lib/read2lead/self-learn/library-views.mjs';
import {canonical} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import {verifyPublisherAsset} from './read2lead-publisher-import.mjs';
const instances=new WeakSet(),approvedInstances=new WeakSet(),rehearsalInstances=new WeakSet();
export const isSyntheticPublisherRuntime=value=>instances.has(value);
export const isApprovedPublisherRuntime=value=>approvedInstances.has(value);
export const isPrivateRehearsalRuntime=value=>rehearsalInstances.has(value);
export const isPublisherRuntime=value=>instances.has(value)||approvedInstances.has(value)||rehearsalInstances.has(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashLesson=lesson=>digest(canonical(lesson));
const refuse=(code='content_unavailable')=>{throw Object.assign(Error(code),{code});};
export async function createSyntheticPublisherRuntime(options={}) {
  if(options.mode!=='synthetic-local')refuse('invalid_publisher_runtime');
  return createRuntime(options,{sourceKind:'synthetic_fixture',viewMode:'synthetic-local'});
}
/** Selected immutable drafts only. The host must enforce private adult access. */
export async function createPrivateRehearsalRuntime({mode,db,assetRoot,targets}={}){
  if(mode!=='private-rehearsal'||db?.prepare('PRAGMA query_only').get().query_only!==1||!Array.isArray(targets)||targets.length<1||targets.length>9||new Set(targets.map(t=>t.source_id+'@'+t.version)).size!==targets.length)refuse('invalid_private_rehearsal');
  const selected=structuredClone(targets),rows=selected.map(t=>db.prepare('SELECT * FROM publisher_packages WHERE source_id=? AND version=?').get(t.source_id,t.version));
  if(rows.some(r=>!r||r.state!=='draft'))refuse('private_draft_unavailable');
  const packages=rows.map(r=>JSON.parse(r.package_json));
  for(let i=0;i<rows.length;i++)if(digest(canonical(packages[i]))!==rows[i].package_sha256)refuse('private_draft_integrity');
  const proofs=packages.flatMap(p=>p.assets.map(a=>verifyPublisherAsset(a,assetRoot)));
  const check=()=>{for(const r of rows){const current=db.prepare('SELECT state,package_sha256 FROM publisher_packages WHERE source_id=? AND version=?').get(r.source_id,r.version);if(current?.state!=='draft'||current.package_sha256!==r.package_sha256)refuse();}};
  check();
  return createRuntime({packages,assetProofs:[...new Map(proofs.map(p=>[p.id+'@'+p.sha256,p])).values()],checkAvailable:check,readAsset:key=>{const root=resolve(assetRoot),file=join(root,key);if(realpathSync(root)!==root||realpathSync(file)!==file||!lstatSync(file).isFile())refuse();return readFileSync(file);}},{sourceKind:'user_supplied_publisher',viewMode:mode});
}
async function createRuntime({packages,assetProofs=[],readAsset=null,catalogueVersions=null,checkAvailable=()=>{}},{sourceKind,viewMode,now}) {
  if(!Array.isArray(packages)||!packages.length) refuse('invalid_publisher_runtime');
  const snapshot=structuredClone({packages,assetProofs}),entries=[],keys=new Set(),sourceIds=new Map(),lessonIds=new Map(),byVersion=new Map(),byHash=new Map(),byMedia=new Map();
  for(const [index,input] of snapshot.packages.entries()){
    if(index%32===0)await yieldToRequests();
    const{package:pkg,package_sha256}=await validatePublisherPackage(input),l=pkg.lesson;
    if(l.source.kind!==sourceKind) refuse(sourceKind==='synthetic_fixture'?'synthetic_publisher_only':'approved_publisher_only');
    const key=JSON.stringify([l.id,l.version]),identity=canonical([l.id,l.source.kind,l.source.collection_id,l.source.collection_level,l.source.edition_id,l.source.book_id,l.source.month,l.source.story_number]);
    if(keys.has(key)||sourceIds.has(l.source.source_id)&&sourceIds.get(l.source.source_id)!==identity||lessonIds.has(l.id)&&lessonIds.get(l.id)!==l.source.source_id) refuse('publisher_identity_conflict');
    keys.add(key);sourceIds.set(l.source.source_id,identity);lessonIds.set(l.id,l.source.source_id);
    for(const a of pkg.assets) if(!snapshot.assetProofs.some(p=>p.id===a.id&&p.sha256===a.sha256&&p.bytes===a.bytes&&p.mime===a.mime&&p.decoded===true)) refuse('publisher_asset_unverified');
    const entry={pkg,package_sha256,hash:hashLesson(l),withdrawn:false};entries.push(entry);byVersion.set(key,entry);byHash.set(JSON.stringify([l.id,entry.hash]),entry);
    for(const asset of pkg.assets){const values=byMedia.get(asset.object_key)||[];values.push(entry);byMedia.set(asset.object_key,values);}
  }
  if(entries.some(e=>e.pkg.assets.length)&&typeof readAsset!=='function') refuse('publisher_asset_reader_required');
  const options=pkg=>({mode:viewMode,...(now?{now:now()}:{}),assetProofs:pkg.assets.map(a=>snapshot.assetProofs.find(p=>p.id===a.id&&p.sha256===a.sha256&&p.bytes===a.bytes&&p.mime===a.mime&&p.decoded===true))});
  const find=(id,version)=>byVersion.get(JSON.stringify([id,version]));
  const available=(id,hash)=>{const entry=byHash.get(JSON.stringify([id,hash]));if(!entry||entry.withdrawn)refuse();checkAvailable();return entry;};
  const latest=()=>{
    const selected=new Map();
    // A withdrawn latest version does not silently republish an older version.
    for(const e of entries){const id=e.pkg.lesson.source.source_id,old=selected.get(id);if(!old||e.pkg.lesson.version.localeCompare(old.pkg.lesson.version,'en',{numeric:true})>0)selected.set(id,e);}
    return [...selected.values()];
  };
  const selected=()=>catalogueVersions===null?latest():catalogueVersions.map(v=>find(v.id,v.version)).filter(Boolean);
  validatePublisherSeries(selected().map(e=>e.pkg.lesson));
  const current=()=>{checkAvailable();return selected().filter(e=>!e.withdrawn).map(e=>e.pkg.lesson).sort(comparePublisherSource);};
  const mediaEntry=key=>{checkAvailable();return byMedia.get(key)?.find(e=>!e.withdrawn);};
  const runtime={
    owns:id=>lessonIds.has(id),
    catalogue:()=>structuredClone(current()),
    assertAvailable(id,hash){available(id,hash);},
    assertRecord(record){const e=available(record.lesson.id,record.session.content_sha256);if(e.package_sha256!==record.publisher_package_sha256)refuse();},
    packageFor(lesson){checkAvailable();const e=find(lesson.id,lesson.version);if(!e||e.withdrawn||e.hash!==hashLesson(lesson))refuse();return structuredClone(e.pkg);},
    card(lesson){const e=available(lesson.id,hashLesson(lesson)),l=e.pkg.lesson;return{id:l.id,version:l.version,level:l.level,level_label_vi:l.level_label_vi,title_en:l.title_en,theme:l.theme,practice_only:true,audio_available:l.audio.asset_id!==null&&['playable','matched','timing_verified','reviewed'].includes(l.audio.status),source:{source_id:l.source.source_id,collection_id:l.source.collection_id,collection_level:l.source.collection_level,book_id:l.source.book_id,month:l.source.month,story_number:l.source.story_number,predecessor_source_id:l.source.predecessor_source_id},synthetic_fixture:sourceKind==='synthetic_fixture'};},
    async sessionView(record){runtime.assertRecord(record);const pkg=runtime.packageFor(record.lesson),view=await publisherSessionView(record,pkg,options(pkg));runtime.assertRecord(record);return view;},
    async readingView({reading,lesson}){const entry=available(lesson.id,reading.content_sha256);const view=await publicPublisherLesson(entry.pkg,options(entry.pkg));available(lesson.id,reading.content_sha256);const{questions,shadowing,minny,retell,pre_read,...story}=view;return{reading:publicReading(reading),lesson:{...story,policy:{...story.policy,mode:'free_reading',completion:'self_reported',compulsory_tasks:false,rewards_awarded:false,automatic_mastery:false,automatic_promotion:false}}};},
    withdraw(id,version){const e=find(id,version);if(!e)refuse();e.withdrawn=true;},
    async media(key,{range=null,head=false}={}){
      if(!/^[a-f0-9]{64}\.(mp3|wav|ogg|png|jpg|webp)$/.test(key))refuse('not_found');
      const e=mediaEntry(key);if(!e)refuse('not_found');const asset=e.pkg.assets.find(a=>a.object_key===key);
      const bytes=await readAsset(key);
      if(!(bytes instanceof Uint8Array)||bytes.byteLength!==asset.bytes||digest(bytes)!==asset.sha256)refuse();
      if(!mediaEntry(key))refuse();
      const headers={'Content-Type':asset.mime,'Content-Length':String(bytes.length),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
      if(range===null)return new Response(head?null:bytes,{status:200,headers});
      const match=typeof range==='string'&&/^bytes=(\d*)-(\d*)$/.exec(range);
      const unsatisfied=()=>new Response(null,{status:416,headers:{...headers,'Content-Length':'0','Content-Range':'bytes */'+bytes.length}});
      if(!match||!match[1]&&!match[2])return unsatisfied();
      const suffix=!match[1],first=suffix?Math.max(0,bytes.length-Number(match[2])):Number(match[1]),last=suffix?bytes.length-1:match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
      if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>last||first>=bytes.length)return unsatisfied();
      return new Response(head?null:bytes.slice(first,last+1),{status:206,headers:{...headers,'Content-Length':String(last-first+1),'Content-Range':`bytes ${first}-${last}/${bytes.length}`}});
    }
  };
  (viewMode==='private-rehearsal'?rehearsalInstances:sourceKind==='synthetic_fixture'?instances:approvedInstances).add(runtime);return Object.freeze(runtime);
}

/** Stable branded facade for a durable synthetic catalogue. Refresh at request boundaries. */
export async function createPublishedSyntheticRuntime(options={}) {
 if(options.mode!=='synthetic-local')refuse('invalid_publisher_runtime');
 return createPublishedRuntime(options,'synthetic_fixture');
}
/** Approved content is accepted only from a fully verified durable catalogue, never raw packages. */
export async function createPublishedApprovedRuntime(options={}) {
 if(options.mode!=='approved-local')refuse('invalid_publisher_runtime');
 return createPublishedRuntime(options,'user_supplied_publisher');
}
async function createPublishedRuntime({mode,db,assetRoot,readAsset=null,now=()=>new Date().toISOString(),verification='inline'},sourceKind) {
 if(!['inline','worker'].includes(verification)||(readAsset!==null&&typeof readAsset!=='function'))refuse('invalid_publisher_runtime');
 const verifier=verification==='worker'?createPublisherWorkerLoader({mode,filename:db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file,assetRoot}):null;
 const inlineLoad=verifier?null:createPublisherCatalogueLoader({assetRoot});
 const loadCatalogue=async()=>{
  if(!verifier)return inlineLoad(db,{now:now()});
  // SQLite connection stamps are local to each connection. Bind worker output to the main connection too.
  const stamp=publisherCatalogueStamp(db),state=publisherCatalogueState(db),value=await verifier.load({now:now()});
  if(publisherCatalogueStamp(db)!==stamp||publisherCatalogueState(db)!==state||value.store_sha256!==state)refuse();
  return{...value,store_stamp:stamp};
 };
 let engine=null,snapshot=null,refreshing=null,closed=false;
 const close=async()=>{closed=true;engine=null;snapshot=null;await verifier?.close();};
 const checkSnapshot=value=>{if(closed||!value||publisherCatalogueStamp(db)!==value.store_stamp||Date.parse(now())>=value.ready_until)refuse();};
 const check=()=>checkSnapshot(snapshot);
 const refresh=async()=>{
  if(closed)refuse();
  if(refreshing)return refreshing;
  if(snapshot&&publisherCatalogueStamp(db)===snapshot.store_stamp&&Date.parse(now())<snapshot.ready_until)return;
  refreshing=(async()=>{
   const value=await loadCatalogue();
   if(value.packages.some(p=>p.lesson.source.kind!==sourceKind))refuse(sourceKind==='synthetic_fixture'?'synthetic_publisher_only':'approved_publisher_only');
   const next=value.packages.length?await createRuntime({packages:value.packages,assetProofs:value.assetProofs,catalogueVersions:value.catalogueVersions,checkAvailable:()=>checkSnapshot(value),
    readAsset:readAsset??(key=>{const root=resolve(assetRoot),file=join(root,key);if(realpathSync(root)!==root||realpathSync(file)!==file||!lstatSync(file).isFile())refuse();return readFileSync(file);})},{sourceKind,viewMode:mode,now}):null;
   if(closed||publisherCatalogueStamp(db)!==value.store_stamp||Date.parse(now())>=value.ready_until)refuse();
   snapshot=value;engine=next;
  })();try{await refreshing;}finally{refreshing=null;}
 };
 const runtime={refresh,close,owns:id=>snapshot?.published_lesson_ids.includes(id)===true,catalogue:()=>{check();return engine?.catalogue()??[];},
  diagnostics:()=>({catalogue_id:snapshot?.catalogue_id??null,blocked:structuredClone(snapshot?.blocked??[])}),
  ...Object.fromEntries(['assertAvailable','assertRecord','packageFor','card','sessionView','readingView','media'].map(name=>[name,(...args)=>{check();if(!engine)refuse();return engine[name](...args);}]))};
 (sourceKind==='synthetic_fixture'?instances:approvedInstances).add(runtime);try{await refresh();return Object.freeze(runtime);}catch(error){await close();throw error;}
}
