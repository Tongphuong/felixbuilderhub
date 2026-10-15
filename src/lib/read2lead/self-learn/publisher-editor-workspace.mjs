import {PublisherEditorClient,publisherQuery} from './publisher-editor-client.mjs';
import {EditorError} from './editor-client.mjs';
const requireThat=(ok,code)=>{if(!ok)throw new EditorError(code);};
export function createPublisherWorkspace(config){return{environment:config.access?.environment==='private-local'?'private-local':'synthetic',client:new PublisherEditorClient(config),draftText:null,draftStorageFailed:false,documents:[],nextCursor:null,view:null,catalogue:null,reconciliation:null};}
export async function refreshPublisher(s,{more=false}={}){
 const docs=await s.client.read('publisher-documents'+(more?'?cursor='+s.nextCursor:''));requireThat(Array.isArray(docs.documents),'invalid_response');
 s.documents=more?[...s.documents,...docs.documents]:docs.documents;s.nextCursor=docs.next_cursor;
 s.catalogue=await s.client.read('publisher-catalogue');
 if(s.view)await openPublisher(s,s.view);
}
export async function openPublisher(s,target){const result=await s.client.read('publisher-document?'+publisherQuery(target));requireThat(result.current_view?.source_id===target.source_id&&result.current_view?.version===target.version,'invalid_response');s.view=result.current_view;}
export async function preparePublisherForm(s,id,data){
 const b=s.view;
 if(id==='publisher-import-form'){requireThat(!s.draftStorageFailed,'storage_unavailable');let pkg;try{pkg=JSON.parse(s.client.draft);}catch{throw new EditorError('import_invalid');}return s.client.prepare('import',{package:pkg});}
 if(id==='publisher-rollback-form')return s.client.prepare('catalogue',{rollback_to:data.catalogue_id,reason:data.reason});
 requireThat(b,'choose_document');const target={source_id:b.source_id,version:b.version};
 if(id==='publisher-review-form')return s.client.prepare('review',{...target,expected_package_sha256:b.package_sha256,reviews:[{kind:data.kind,package_sha256:b.content_sha256,status:data.status,method:data.method,evidence_ref:data.evidence_ref}]});
 if(id==='publisher-withdraw-form')return s.client.prepareWithdrawal({...target,reason:data.reason});
 if(id==='publisher-publish-form'){
  // Replace only this source's version. The server rejects a stale catalogue plan.
  s.catalogue=await s.client.read('publisher-catalogue');const active=s.catalogue.snapshots.find(x=>x.active),targets=(active?.entries||[]).filter(x=>x.source_id!==b.source_id).map(x=>({source_id:x.source_id,version:x.version}));targets.push(target);
  return s.client.prepare('catalogue',{targets,reason:data.reason});
 }
 throw new EditorError('invalid_request');
}
export async function reconcilePublisher(s){const r=await s.client.reconcile();s.catalogue=r.catalogue;s.documents=r.documents.documents;s.nextCursor=r.documents.next_cursor;if(r.view)s.view=r.view;s.reconciliation={catalogue_id:r.catalogue.catalogue_id,view:r.view?{source_id:r.view.source_id,version:r.view.version,state:r.view.state,package_sha256:r.view.package_sha256}:null};}
const cleanup=new WeakMap();
export function stopPublisherMedia(root,{detach=true}={}){for(const media of root.querySelectorAll('.publisher-editor audio')){cleanup.get(media)?.();cleanup.delete(media);media.pause();if(detach){media.removeAttribute('src');media.load();}}}
export async function playPublisherSegment(root,segment){
 const audio=root.querySelector('#publisher-audio');requireThat(audio&&segment&&Number.isFinite(segment.start_seconds)&&Number.isFinite(segment.end_seconds),'invalid_request');cleanup.get(audio)?.();audio.pause();
 const stop=()=>{clearInterval(timer);audio.removeEventListener('pause',stop);audio.removeEventListener('ended',stop);audio.removeEventListener('timeupdate',check);};
 const check=()=>{if(!root.contains(audio)||audio.currentTime>=segment.end_seconds){audio.pause();stop();}};
 let timer=null;cleanup.set(audio,stop);
 try{await audio.play();if(!root.contains(audio)){audio.pause();stop();return;}if(cleanup.get(audio)!==stop)return;requireThat(Number.isFinite(audio.duration)&&segment.start_seconds>=0&&segment.end_seconds>segment.start_seconds&&segment.end_seconds<=audio.duration+.05,'publisher_asset_unavailable');audio.currentTime=segment.start_seconds;audio.addEventListener('pause',stop);audio.addEventListener('ended',stop);audio.addEventListener('timeupdate',check);timer=setInterval(check,40);}catch(error){audio.pause();stop();throw error;}
}
