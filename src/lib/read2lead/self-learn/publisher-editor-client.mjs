/** Private publisher workspace recovery; explicit prepare/apply, no automatic retries. */
import {EditorError} from './editor-client.mjs';
import {validId} from './session-contract.mjs';
const requireThat=(ok,code)=>{if(!ok)throw new EditorError(code);};
const bytes=s=>new TextEncoder().encode(s).length;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validTarget=t=>validId(t?.source_id)&&typeof t.version==='string'&&/^1\.2\.[1-9][0-9]*$/.test(t.version)&&t.version.length<=32;
export const publisherQuery=t=>{requireThat(validTarget(t),'invalid_request');return new URLSearchParams({source_id:t.source_id,version:t.version}).toString();};
function validPending(p,editor){
 if(p===null)return true;
 if(!exact(p,['route','data','attempted'])||typeof p.attempted!=='boolean')return false;
 if(p.route==='publisher-withdraw')return exact(p.data,['source_id','version','reason'])&&validTarget(p.data)&&typeof p.data.reason==='string'&&p.data.reason.trim()&&p.data.reason.length<=1000;
 return p.route==='publisher-apply'&&exact(p.data,['operation','actor','report'])&&['review','import','catalogue'].includes(p.data.operation)&&p.data.actor==='editor:'+editor&&p.data.report?.plan&&typeof p.data.report.plan_sha256==='string'&&/^[a-f0-9]{64}$/.test(p.data.report.plan_sha256)&&bytes(JSON.stringify(p.data))<=2097152;
}
function validRow(row,editor){return exact(row,['format','editor_id','draft','pending'])&&row.format===1&&row.editor_id===editor&&(row.draft===null||typeof row.draft==='string'&&bytes(row.draft)<=1048576)&&validPending(row.pending,editor);}
export class PublisherEditorClient{
 #active=true;#epoch=0;#busy=false;#raw=null;#invalid=false;#row;#csrf;#reconciled=false;
 constructor({api,storage,access}){
  requireThat(access?.publisher_editor===true&&access.role==='editor'&&validId(access.editor_id)&&typeof access.csrf==='string'&&api.csrf===access.csrf,'editor_required');
  Object.assign(this,{api,storage,editorId:access.editor_id,environment:access.environment==='private-local'?'private-local':'synthetic',key:(access.environment==='private-local'?'r2l-publisher-editor-private:':'r2l-publisher-editor-local:')+access.editor_id});this.#csrf=access.csrf;this.#row={format:1,editor_id:this.editorId,draft:null,pending:null};
  try{this.#raw=storage.getItem(this.key);}catch{throw new EditorError('storage_unavailable');}
  if(this.#raw!==null){let row;try{if(this.#raw.length<=3500000)row=JSON.parse(this.#raw);}catch{}if(validRow(row,this.editorId))this.#row=row;else this.#invalid=true;}
 }
 get draft(){return this.#active?this.#row.draft:null;}
 get pending(){return this.#active?structuredClone(this.#row.pending):null;}
 get storageInvalid(){return this.#invalid;}
 get reconciled(){return this.#reconciled;}
 get recoveryText(){this.#current();return this.#raw;}
 deactivate(){this.#active=false;this.#epoch++;}
 #current(epoch=this.#epoch){requireThat(this.#active&&epoch===this.#epoch,'editor_scope_expired');}
 #idle(){this.#current();requireThat(!this.#busy,'operation_busy');}
 #write(row){
  const raw=row.draft===null&&row.pending===null?null:JSON.stringify(row);requireThat(validRow(row,this.editorId),'editor_storage_invalid');
  try{requireThat(this.storage.getItem(this.key)===this.#raw,'editor_storage_changed');if(raw===null)this.storage.removeItem(this.key);else this.storage.setItem(this.key,raw);}catch(e){if(e instanceof EditorError)throw e;throw new EditorError('storage_unavailable');}
  this.#row=structuredClone(row);this.#raw=raw;this.#invalid=false;this.#reconciled=false;
 }
 saveDraft(text){this.#idle();requireThat(!this.#invalid,'editor_storage_invalid');requireThat(!this.#row.pending,'editor_pending');this.#write({...this.#row,draft:text});}
 async #live(epoch){
  this.#current(epoch);requireThat(this.api.csrf===this.#csrf,'csrf_failed');const access=await this.api.request('me');this.#current(epoch);
  requireThat((access.environment==='private-local'?'private-local':'synthetic')===this.environment&&access.publisher_editor===true&&access.role==='editor'&&access.editor_id===this.editorId,'editor_required');requireThat(access.csrf===this.#csrf&&this.api.csrf===this.#csrf,'csrf_failed');
 }
 async #request(route,data,epoch){await this.#live(epoch);const result=await this.api.request(route,data);await this.#live(epoch);return result;}
 async read(route){this.#idle();requireThat(/^publisher-(documents(?:\?cursor=\d+)?|document\?|catalogue$)/.test(route),'invalid_route');const epoch=this.#epoch;this.#busy=true;try{return await this.#request(route,undefined,epoch);}finally{if(epoch===this.#epoch)this.#busy=false;}}
 async prepare(kind,data){
  this.#idle();requireThat(!this.#invalid,'editor_storage_invalid');requireThat(!this.#row.pending,'editor_pending');requireThat(['review','import','catalogue'].includes(kind),'invalid_request');const epoch=this.#epoch;this.#busy=true;
  try{const result=await this.#request('publisher-'+kind+'-plan',structuredClone(data),epoch);const pending={route:'publisher-apply',data:result.prepared,attempted:false};requireThat(validPending(pending,this.editorId),'invalid_response');this.#write({...this.#row,pending});return this.pending;}finally{if(epoch===this.#epoch)this.#busy=false;}
 }
 prepareWithdrawal(data){this.#idle();requireThat(!this.#invalid,'editor_storage_invalid');requireThat(!this.#row.pending,'editor_pending');const pending={route:'publisher-withdraw',data:structuredClone(data),attempted:false};requireThat(validPending(pending,this.editorId),'invalid_request');this.#write({...this.#row,pending});}
 async apply(){
  this.#idle();requireThat(!this.#invalid,'editor_storage_invalid');requireThat(this.#row.pending,'editor_request_missing');const epoch=this.#epoch,pending=structuredClone(this.#row.pending);this.#write({...this.#row,pending:{...pending,attempted:true}});this.#busy=true;
  try{const result=await this.#request(pending.route,pending.data,epoch);requireThat(result?.ok===true&&result.result&&typeof result.result==='object','invalid_response');this.#write({...this.#row,pending:null});return result.result;}finally{if(epoch===this.#epoch)this.#busy=false;}
 }
 async #snapshot(epoch){
  const catalogue=await this.#request('publisher-catalogue',undefined,epoch),documents=await this.#request('publisher-documents',undefined,epoch),p=this.#row.pending;
  const t=p?.route==='publisher-withdraw'?p.data:p?.data.operation==='review'?p.data.report.plan:p?.data.operation==='import'?{source_id:p.data.report.packages?.[0]?.lesson?.source?.source_id,version:p.data.report.packages?.[0]?.lesson?.version}:null;
  let view=null;if(t){try{view=(await this.#request('publisher-document?'+publisherQuery(t),undefined,epoch)).current_view;}catch(e){if(e.code!=='unknown_publisher_version')throw e;await this.#live(epoch);}}
  return{catalogue,documents,view};
 }
 async reconcile(){this.#idle();const epoch=this.#epoch;this.#busy=true;try{const result=await this.#snapshot(epoch);this.#reconciled=true;return result;}finally{if(epoch===this.#epoch)this.#busy=false;}}
 async discard(){
  this.#idle();requireThat(!this.#invalid&&!this.#row.pending?.attempted||this.#reconciled,'editor_reconcile_required');const epoch=this.#epoch;this.#busy=true;
  try{if(this.#invalid||this.#row.pending?.attempted)await this.#snapshot(epoch);else await this.#live(epoch);this.#write({...this.#row,pending:null});}finally{if(epoch===this.#epoch)this.#busy=false;}
 }
}
