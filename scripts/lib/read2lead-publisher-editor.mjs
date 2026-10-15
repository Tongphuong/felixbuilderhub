/** Authenticated editor adapter; isolated synthetic QA or explicit private publisher preparation. Source imports remain outside child requests. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validId} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import {validatePublisherPackage} from '../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {publisherReviewBundle,planPublisherReview,applyPublisherReview} from './read2lead-publisher-review.mjs';
import {planPublisherImport,applyPublisherImport,withdrawPublisherVersion,verifyPublisherAsset} from './read2lead-publisher-import.mjs';
import {publisherCatalogueHead,planPublisherCatalogue,applyPublisherCatalogue} from './read2lead-publisher-catalogue.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const requireThat=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const target=t=>requireThat(validId(t?.source_id)&&typeof t.version==='string'&&/^1\.2\.[1-9][0-9]*$/.test(t.version)&&t.version.length<=32,'invalid_request');
const actor=principal=>{requireThat(principal?.role==='editor'&&validId(principal.editorId),'editor_required');return'editor:'+principal.editorId;};
export function createPublisherEditor({mode,db,assetRoot}={}){
 requireThat(['synthetic-local','private-local'].includes(mode)&&db,'unsafe_editor_api_config');
 const sourceKind=mode==='private-local'?'user_supplied_publisher':'synthetic_fixture';
 const synthetic=p=>requireThat(p?.lesson?.source?.kind===sourceKind,mode==='private-local'?'publisher_editor_private_only':'publisher_editor_synthetic_only');
 for(const row of db.prepare('SELECT package_json FROM publisher_packages').all())synthetic(JSON.parse(row.package_json));
 const get=t=>{target(t);const row=db.prepare('SELECT package_json FROM publisher_packages WHERE source_id=? AND version=?').get(t.source_id,t.version);requireThat(row,'unknown_publisher_version');const p=JSON.parse(row.package_json);synthetic(p);return p;};
 const checkTargets=targets=>{requireThat(Array.isArray(targets)&&targets.length<=2000,'invalid_request');for(const t of targets)get(t);};
 const context=c=>{requireThat(typeof c?.guard==='function'&&typeof c?.commit==='function','editor_required');c.guard();return actor(c.principal);};
 return{
  environment:mode,
  list(cursor,c){context(c);requireThat(Number.isSafeInteger(cursor)&&cursor>=0,'invalid_request');const rows=db.prepare('SELECT rowid AS cursor,* FROM publisher_packages WHERE rowid>? ORDER BY rowid LIMIT 51').all(cursor);const selected=rows.slice(0,50),documents=selected.map(row=>{const p=JSON.parse(row.package_json);synthetic(p);const l=p.lesson;return{source_id:row.source_id,lesson_id:l.id,version:l.version,title_en:l.title_en,collection_level:l.source.collection_level,month:l.source.month,story_number:l.source.story_number,state:row.state==='withdrawn'?'withdrawn':'open_to_check',package_sha256:row.package_sha256};});c.guard();return{documents,next_cursor:rows.length>50?selected.at(-1).cursor:null};},
  async document(t,c,now){context(c);get(t);const result=await publisherReviewBundle(db,t,{assetRoot,now});c.guard();return result;},
  catalogue(c){context(c);const id=publisherCatalogueHead(db),snapshots=db.prepare('SELECT id,manifest_json,created_at FROM publisher_catalogues ORDER BY created_at DESC,id').all().map(row=>{const manifest=JSON.parse(row.manifest_json);checkTargets(manifest.entries);return{catalogue_id:row.id,created_at:row.created_at,entries:manifest.entries,active:row.id===id};});c.guard();return{catalogue_id:id,snapshots};},
  async plan(kind,data,c,now){const operator=context(c);let report;
   if(kind==='review'){
    requireThat(exact(data,['source_id','version','expected_package_sha256','reviews'])&&Array.isArray(data.reviews)&&data.reviews.length>0&&data.reviews.length<=10,'invalid_request');get(data);
    const reviews=data.reviews.map(r=>{requireThat(exact(r,['kind','package_sha256','status','method','evidence_ref']),'invalid_request');return{...r,reviewer:operator,reviewed_at:now};});
    report=await planPublisherReview(db,{...data,reviews},{assetRoot,now});
   }else if(kind==='import'){
    requireThat(exact(data,['package']),'invalid_request');synthetic(data.package);const checked=await validatePublisherPackage(data.package),pkg=checked.package;
    // New/corrected content does not inherit client-submitted approval assertions.
    pkg.reviews=[];const result=await planPublisherImport(db,[pkg],{assetRoot,now});report={...result,packages:[pkg]};
   }else if(kind==='catalogue'){
    requireThat(exact(data,['targets','reason'])||exact(data,['rollback_to','reason']),'invalid_request');
    if(data.targets)checkTargets(data.targets);else{const row=db.prepare('SELECT manifest_json FROM publisher_catalogues WHERE id=?').get(data.rollback_to);requireThat(row,'unknown_publisher_catalogue');checkTargets(JSON.parse(row.manifest_json).entries);}
    report=await planPublisherCatalogue(db,{...data,operator},{assetRoot,now});
   }else requireThat(false,'invalid_request');
   c.guard();return{operation:kind,actor:operator,report};
  },
  async apply(data,c,now){const operator=context(c);requireThat(exact(data,['operation','actor','report'])&&data.actor===operator,'invalid_request');const {report}=data;let result;
   requireThat(report&&typeof report==='object','invalid_request');
   if(data.operation==='review'){
    requireThat(Array.isArray(report.plan?.changes)&&report.plan.changes.every(r=>r.reviewer===operator),'invalid_request');get(report.plan);
    result=await applyPublisherReview(db,report,{assetRoot,now,commit:c.commit});
   }else if(data.operation==='import'){
    requireThat(Array.isArray(report.packages)&&report.packages.length===1,'invalid_request');synthetic(report.packages[0]);requireThat(Array.isArray(report.packages[0].reviews)&&report.packages[0].reviews.length===0,'invalid_request');
    result=await applyPublisherImport(db,report.packages,{...report,assetRoot,now,commit:c.commit});
   }else if(data.operation==='catalogue'){
    requireThat(report.plan?.operator===operator,'invalid_request');checkTargets(report.plan?.manifest?.entries);
    result=await applyPublisherCatalogue(db,report,{assetRoot,now,commit:c.commit});
   }else requireThat(false,'invalid_request');
   c.guard();return result;
  },
  withdraw(data,c,now){const operator=context(c);requireThat(exact(data,['source_id','version','reason']),'invalid_request');get(data);const result=c.commit(()=>withdrawPublisherVersion(db,{...data,operator,now}));c.guard();return result;},
  async media(t,request,c){context(c);requireThat(validId(t.asset_id),'invalid_request');const p=get(t),checked=await validatePublisherPackage(p);c.guard();const asset=checked.package.assets.find(a=>a.id===t.asset_id);requireThat(asset,'publisher_asset_not_found');
   let bytes;try{verifyPublisherAsset(asset,assetRoot);const root=path.resolve(assetRoot),file=path.join(root,asset.object_key);requireThat(fs.realpathSync(root)===root&&fs.realpathSync(file)===file,'publisher_asset_unavailable');bytes=fs.readFileSync(file);requireThat(bytes.length===asset.bytes&&createHash('sha256').update(bytes).digest('hex')===asset.sha256,'publisher_asset_unavailable');}catch{throw Object.assign(Error('publisher_asset_unavailable'),{code:'publisher_asset_unavailable'});}c.guard();
   const headers={'Content-Type':asset.mime,'Content-Length':String(bytes.length),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},head=request.method==='HEAD',range=request.headers.get('range');
   if(range===null)return new Response(head?null:bytes,{status:200,headers});const match=/^bytes=(\d*)-(\d*)$/.exec(range),bad=()=>new Response(null,{status:416,headers:{...headers,'Content-Length':'0','Content-Range':'bytes */'+bytes.length}});
   if(!match||!match[1]&&!match[2])return bad();const first=!match[1]?Math.max(0,bytes.length-Number(match[2])):Number(match[1]),last=!match[1]?bytes.length-1:match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
   if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>last||first>=bytes.length)return bad();return new Response(head?null:bytes.slice(first,last+1),{status:206,headers:{...headers,'Content-Length':String(last-first+1),'Content-Range':`bytes ${first}-${last}/${bytes.length}`}});
  }
 };
}
