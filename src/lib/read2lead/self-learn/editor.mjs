import {createPublisherWorkspace,refreshPublisher,openPublisher,preparePublisherForm,reconcilePublisher,stopPublisherMedia,playPublisherSegment} from './publisher-editor-workspace.mjs';
import { EditorApi, EditorClient, EditorError } from './editor-client.mjs';
import { renderEditor, fieldsFromDraft, lessonFromDraft, draftFromLesson, editSection, editPath, synchronizeText, draftChanged } from './editor-views.mjs';
const messages = {
  invalid_editor_access:'Mã biên tập chưa đúng. Kiểm tra mã rồi thử lại nhé.', unauthorized:'Phiên biên tập đã kết thúc. Đăng nhập lại để mở bản đang giữ trên tab.', access_expired:'Phiên biên tập đã hết hạn. Bản nháp vẫn được giữ trên tab; đăng nhập lại để tiếp tục.', editor_access_revoked:'Quyền biên tập hiện không mở. Bản nháp chưa bị xóa.',
  editor_required:'Cần đúng tài khoản biên tập để tiếp tục.', csrf_failed:'Phiên truy cập đã đổi. Đăng nhập lại trước khi gửi bản đang giữ.', editor_scope_expired:'Phiên trước đã đóng. Không nhận nội dung trả về muộn.',
  connection_lost:'Chưa kết nối được máy chủ. Bản nháp và lượt gửi vẫn được giữ; có thể gửi lại đúng lượt.', request_timeout:'Máy chủ chưa trả lời kịp. Kiểm tra dữ liệu đã lưu hoặc gửi lại đúng lượt.',
  invalid_editor_draft:'Bản nháp chưa đúng cấu trúc. Sửa phần được báo bên dưới rồi lưu lại.', invalid_editor_integrity:'Nội dung hoặc dẫn chứng chưa khớp. Kiểm tra các mục bên dưới; bản đang gõ vẫn được giữ.', editor_section_json:'Một phần JSON chưa đúng cú pháp. Sửa phần đó rồi thử lại.', editor_draft_format:'Bản nháp trên tab không đúng định dạng. Xuất dữ liệu đang giữ hoặc mở lại bản máy chủ sau khi kiểm tra.',
  stale_revision:'Bản máy chủ đã thay đổi. Kiểm tra bản mới trước khi bỏ lượt đang giữ hoặc chọn dùng nội dung mới.', request_conflict:'Mã lượt gửi đã gắn với nội dung khác. Kiểm tra dữ liệu máy chủ; không tự tạo một lượt thay thế.',
  editor_pending:'Một lượt gửi đang được giữ. Đối chiếu hoặc gửi lại lượt đó trước.', editor_storage_invalid:'Dữ liệu trên tab cần kiểm tra trước khi tiếp tục.', editor_storage_changed:'Dữ liệu trên tab đã đổi ở một thao tác khác. Không ghi đè; tải lại để đối chiếu.', storage_unavailable:'Trình duyệt chưa giữ được bản nháp. Đừng đóng trang; có thể xuất bản đang xem rồi kiểm tra dung lượng hoặc quyền lưu trên trình duyệt.',
  editor_reconcile_required:'Kiểm tra dữ liệu đã lưu trước khi bỏ lượt đang giữ.', editor_input_limit:'Nội dung quá lớn cho bản biên tập cục bộ. Bản trước vẫn được giữ.',
  editor_document_not_found:'Chưa tìm thấy bản lưu này. Bản nháp trên tab vẫn được giữ.', invalid_editor_transition:'Trạng thái bản đã đổi. Cập nhật dữ liệu trước khi chuyển bước.', content_quarantined:'Bản nội dung đang tạm dừng. Chỉ mở lại sau khi kiểm tra và ghi lý do.', technical_review_required:'Cần kiểm tra kỹ thuật đúng bản nội dung trước khi mở.', rate_limited:'Đã có nhiều thao tác. Đợi một phút rồi tiếp tục; bản nháp vẫn được giữ.',
  editor_unsaved_workflow:'Lưu hoặc bỏ thay đổi đang gõ trước khi chuyển bước kiểm tra. Bản máy chủ chưa thay đổi.', choose_document:'Chọn một bản đã lưu trước.', choose_template:'Chọn một bản mẫu trước.', import_invalid:'Nội dung nhập cần là một bài học JSON hợp lệ.', invalid_editor_field:'Trường này chưa sửa được. Kiểm tra JSON hoặc mở đúng bản nội dung.', editor_id_locked:'Mã bài đã lưu được giữ cố định. Tạo bài mới từ bản mẫu nếu cần mã khác.', operation_busy:'Một thao tác đang chạy. Đợi kết quả trước khi tiếp tục.'
};
const permissions = new Set(['unauthorized','access_expired','editor_access_revoked','editor_required','csrf_failed']);
export function mountEditor(root, { api = new EditorApi(), storage = globalThis.sessionStorage } = {}) {
  if (!root) throw Error('editor_root_required');
  const state={environment:root.dataset?.editorEnvironment==='private-local'?'private-local':'synthetic',publisher:null,workspace:'legacy',access:null,client:null,busy:false,loading:true,message:'',error:false,issues:[],documents:[],templates:[],draft:null,view:null,audit:[],pending:null,storageInvalid:false,reconciled:false,preview:false,confirm:null};
  let epoch=0,expiry=null,renderedDocument=null,renderedPublisher=null;
  function paint(focus=false) {
    const publisherForms=[...root.querySelectorAll('.publisher-editor form:not(#publisher-import-form) [name]')].map(x=>({form:x.form?.id,name:x.name,value:x.value}));
    stopPublisherMedia(root);
    const opened=[...root.querySelectorAll('.editor-section[open] textarea[data-section]')].map(x=>x.dataset.section);
    const formValues=[...root.querySelectorAll('#editor-review-form [name], #editor-quarantine-form [name], #editor-import-text')].map(x=>({form:x.form?.id||'',name:x.name||x.id,value:x.value}));
    root.innerHTML=renderEditor(state);
    for(const key of opened)root.querySelector('textarea[data-section="'+CSS.escape(key)+'"]')?.closest('details')?.setAttribute('open','');
    if(state.access&&renderedDocument===state.view?.document.lesson_id)for(const x of formValues){const el=x.form?root.querySelector('#'+x.form+' [name="'+CSS.escape(x.name)+'"]'):root.querySelector('#'+x.name);if(el)el.value=x.value;}
    const publisherKey=state.publisher?.view?.source_id+':'+state.publisher?.view?.version;
    if(state.access&&publisherKey===renderedPublisher)for(const x of publisherForms){const el=root.querySelector('#'+x.form+' [name="'+CSS.escape(x.name)+'"]');if(el)el.value=x.value;}
    renderedPublisher=publisherKey;
    for(const control of root.querySelectorAll('button,input,select,textarea'))if(state.busy)control.disabled=true;
    renderedDocument=state.view?.document.lesson_id;
    if(focus)root.querySelector('#main')?.focus();
  }
  function syncClient() { if(state.client){state.pending=state.client.pending;state.storageInvalid=state.client.storageInvalid;state.reconciled=state.client.reconciled;} }
  function privateClear() {
    clearTimeout(expiry);epoch++;stopPublisherMedia(root);state.publisher?.client.deactivate();state.client?.deactivate();api.csrf=null;
    Object.assign(state,{publisher:null,workspace:'legacy',access:null,client:null,documents:[],templates:[],draft:null,view:null,audit:[],pending:null,storageInvalid:false,reconciled:false,preview:false,confirm:null});
  }
  function fail(error) {
    if(permissions.has(error.code))privateClear();
    state.error=true;state.message=messages[error.code]||'Chưa hoàn tất thao tác. Bản đang giữ không bị ghi đè; kiểm tra dữ liệu rồi thử lại.';state.issues=Array.isArray(error.issues)?error.issues:[];
  }
  async function run(work) {
    if(state.busy)return;state.busy=true;state.error=false;state.message='';state.issues=[];paint();
    try{await work();}catch(error){fail(error);}finally{state.loading=false;state.busy=false;syncClient();paint();}
  }
  function current(client) {if(client!==state.client||!state.access)throw new EditorError('editor_scope_expired');}
  function persist(draft) {state.draft=structuredClone(draft);state.client.saveDraftText(draft);syncClient();}
  async function loadDocument(id,{replace=false}={}) {
    const client=state.client,result=await client.read('document?lesson_id='+id);current(client);state.view=result.current_view;
    const log=await client.read('audit?lesson_id='+id);current(client);state.audit=log.events;
    if(replace)persist(draftFromLesson(state.view.lesson,state.view.document.revision));
  }
  async function refresh() {
    if(state.access?.publisher_only){const publisher=state.publisher;await refreshPublisher(publisher);if(publisher!==state.publisher)throw new EditorError('editor_scope_expired');state.message='Đã cập nhật danh mục riêng tư.';return;}
    const client=state.client,docs=await client.read('documents');current(client);state.documents=docs.documents;
    const templates=await client.read('templates');current(client);state.templates=templates.templates;
    const id=state.view?.document.lesson_id||state.draft?.lesson_id;
    if(id&&state.documents.some(d=>d.lesson_id===id))await loadDocument(id);else{state.view=null;state.audit=[];}
    if(state.publisher){const publisher=state.publisher;await refreshPublisher(publisher);if(publisher!==state.publisher)throw new EditorError('editor_scope_expired');}
    state.message='Đã cập nhật dữ liệu máy chủ. Bản đang gõ vẫn được giữ riêng.';
  }
  async function connect(access) {
    if((state.environment==='private-local')!==(access.environment==='private-local'))throw new EditorError('editor_required');
    api.csrf=access.csrf;const client=new EditorClient({api,storage,access});state.client?.deactivate();epoch++;state.client=client;state.access=access;state.draft=client.draft;state.publisher?.client.deactivate();state.publisher=access.publisher_editor?createPublisherWorkspace({api,storage,access}):null;state.workspace=state.publisher?'publisher':'legacy';syncClient();
    clearTimeout(expiry);const expires=Date.parse(access.expires_at);if(!Number.isFinite(expires)||expires<=Date.now())throw new EditorError('access_expired');
    expiry=setTimeout(()=>{privateClear();state.loading=false;state.busy=false;fail(new EditorError('access_expired'));paint(true);},Math.min(2147483647,expires-Date.now()));
    await refresh();state.message=state.draft?'Đã mở lại bản đang giữ trên tab. Chưa tự gửi thay đổi.':'';
  }
  function confirmReplace(work,message='Thay bản đang gõ trên tab bằng nội dung đã chọn? Bản đã lưu trên máy chủ vẫn được giữ.') {
    if(state.pending||state.storageInvalid)throw new EditorError('editor_pending');
    if(draftChanged(state.draft,state.view)){state.confirm={message,work};return;}return work();
  }
  async function applyResult(result) {
    const client=state.client;current(client);state.view=result.current_view;
    if(!state.draft||result.document.head_sha256===result.current_view.document.head_sha256)persist(draftFromLesson(result.current_view.lesson,result.current_view.document.revision));
    else persist({...state.draft,expected_revision:result.document.revision});
    const docs=await client.read('documents');current(client);state.documents=docs.documents;
    const log=await client.read('audit?lesson_id='+result.document.lesson_id);current(client);state.audit=log.events;
    state.message=result.replayed?'Đã đối chiếu đúng lượt cũ. Máy chủ chỉ ghi một lần.':'Đã lưu thao tác trên máy chủ cục bộ.';
    if(result.document.head_sha256!==result.current_view.document.head_sha256)state.message+=' Bản máy chủ đã có nội dung mới hơn; bản đang gõ được giữ riêng để đối chiếu.';
  }
  async function send(route,data) {if(route!=='draft'&&draftChanged(state.draft,state.view))throw new EditorError('editor_unsaved_workflow');const client=state.client,result=await client.submit(route,data);current(client);await applyResult(result);}
  const documentData=()=>{if(!state.view)throw new EditorError('choose_document');return {lesson_id:state.view.document.lesson_id,expected_revision:state.view.document.revision};};
  function importLesson(text) {
    if(new TextEncoder().encode(text).length>262144)throw new EditorError('editor_input_limit');let lesson;try{lesson=JSON.parse(text);}catch{throw new EditorError('import_invalid');}
    const draft=draftFromLesson(lesson,0);return confirmReplace(()=>{persist(draft);state.view=null;state.audit=[];state.preview=false;state.message='Nội dung nhập đang ở bản nháp trên tab; chưa gửi lên máy chủ.';});
  }
  function download(text,name) {const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  root.addEventListener('input',ev=>{
    if(ev.target.id==='publisher-draft'&&state.publisher&&!state.busy){state.publisher.draftText=ev.target.value;try{state.publisher.client.saveDraft(ev.target.value);state.publisher.draftStorageFailed=false;root.querySelector('#publisher-draft-status').textContent='Đã giữ bản đang gõ trên tab; chưa gửi.';}catch(error){state.publisher.draftStorageFailed=true;fail(error);root.querySelector('#publisher-draft-status').textContent=state.message;}return;}
    if(!state.client||state.busy||state.pending||state.storageInvalid||!state.draft)return;const element=ev.target;if(!element.dataset.path&&!element.dataset.section)return;
    try{const next=element.dataset.section?editSection(state.draft,element.dataset.section,element.value):editPath(state.draft,element.dataset.path,element.value);persist(next);const workflow=root.querySelector('.editor-workflow fieldset');if(workflow)workflow.disabled=draftChanged(state.draft,state.view);if(element.dataset.section)for(const input of root.querySelectorAll('[data-path]'))input.disabled=true;const badge=root.querySelector('.editor-draft .tag');if(badge)badge.textContent='Chưa lưu lên máy chủ';const status=root.querySelector('#editor-local-status');if(status){status.textContent=element.dataset.section?'Đã giữ phần JSON trên tab. Chọn Xem trước để cập nhật các trường đọc dễ hơn; chưa lưu lên máy chủ.':'Đã giữ thay đổi trên tab · Chưa lưu lên máy chủ.';status.classList.remove('editor-local-error');}}
    catch(error){fail(error);const status=root.querySelector('#editor-local-status');if(status){status.textContent=state.message;status.classList.add('editor-local-error');}}
  });
  root.addEventListener('change',ev=>{
    if(ev.target.id!=='editor-import-file'||state.busy)return;const file=ev.target.files?.[0];if(!file)return;
    void run(async()=>{if(file.size>262144)throw new EditorError('editor_input_limit');const token=epoch,text=await file.text();if(token!==epoch)throw new EditorError('editor_scope_expired');await importLesson(text);});
  });
  root.addEventListener('submit',ev=>{
    const form=ev.target;if(!(form instanceof HTMLFormElement))return;ev.preventDefault();const data=new FormData(form);
    if(form.id.startsWith('publisher-')){void run(async()=>{const publisher=state.publisher;if(!publisher)throw new EditorError('editor_required');await preparePublisherForm(publisher,form.id,Object.fromEntries(data));if(publisher!==state.publisher)throw new EditorError('editor_scope_expired');state.message='Đã chuẩn bị kế hoạch. Kiểm tra rồi chọn Áp dụng; chưa có thay đổi máy chủ.';});return;}
    if(form.id==='editor-login-form'){void run(()=>connectAfterLogin(String(data.get('editor_id')),String(data.get('access_secret'))));return;}
    if(form.id==='editor-review-form'){const value={...documentData(),decision:String(data.get('decision')),note:String(data.get('note'))};void run(()=>send('review',value));}
    if(form.id==='editor-quarantine-form'){const value={...documentData(),content_revision:Number(data.get('content_revision')),blocked:data.get('blocked')==='true',reason:String(data.get('reason'))};void run(()=>send('quarantine',value));}
  });
  async function connectAfterLogin(editor_id,access_secret){const access=await api.request('login',{editor_id,access_secret});await connect(access);}
  root.addEventListener('click',ev=>{
    const button=ev.target.closest('button[data-action]');if(!button||button.disabled||state.busy)return;const action=button.dataset.action;
    if(action==='publisher-segment'){const publisher=state.publisher;void playPublisherSegment(root,publisher?.view?.package.lesson.audio.segments[Number(button.dataset.segment)]).catch(()=>{if(publisher===state.publisher){const status=root.querySelector('#publisher-media-status');if(status)status.textContent='Chưa phát được đoạn này. Kiểm tra tệp và mốc thời gian.';}});return;}
    const publisherSelection=root.querySelector('#publisher-document')?.value;
    const selectedDocument=root.querySelector('#editor-document')?.value,selectedTemplate=root.querySelector('#editor-template')?.value,importText=root.querySelector('#editor-import-text')?.value;
    void run(async()=>{
      if(action==='workspace-publisher'||(action==='workspace-legacy'&&!state.access?.publisher_only)){state.workspace=action==='workspace-publisher'&&state.publisher?'publisher':'legacy';return;}
      if(action.startsWith('publisher-')){
        const publisher=state.publisher;if(!publisher)throw new EditorError('editor_required');const client=publisher.client,command=action.slice(10);
        if(command==='open'){const target=publisher.documents[Number(publisherSelection)];if(publisherSelection===''||!target)throw new EditorError('choose_document');return openPublisher(publisher,target);}
        if(command==='more')return refreshPublisher(publisher,{more:true});
        if(command==='refresh')return refreshPublisher(publisher);
        if(command==='copy'){if(!publisher.view)throw new EditorError('choose_document');state.confirm={message:'Đưa gói đang xem vào vùng sửa? Bản đang gõ sẽ được thay thế; máy chủ không đổi.',work:()=>{const text=JSON.stringify(publisher.view.package,null,2);client.saveDraft(text);publisher.draftText=text;publisher.draftStorageFailed=false;}};return;}
        if(command==='apply'){await client.apply();await refreshPublisher(publisher);if(publisher!==state.publisher)throw new EditorError('editor_scope_expired');state.message=state.environment==='private-local'?'Đã đối chiếu và áp dụng đúng kế hoạch trong danh mục riêng tư.':'Đã đối chiếu và áp dụng đúng kế hoạch trên máy chủ QA cục bộ.';return;}
        if(command==='reconcile'){await reconcilePublisher(publisher);state.message='Đã đối chiếu máy chủ; lượt đang giữ chưa bị bỏ.';return;}
        if(command==='discard'){state.confirm={message:'Bỏ kế hoạch đang giữ trên tab? Thao tác máy chủ đã ghi sẽ không bị hoàn tác. Xuất dữ liệu trước nếu cần giữ bằng chứng.',work:()=>client.discard()};return;}
        if(command==='export-draft'||command==='export-recovery'){const text=command==='export-draft'?(publisher.draftText??client.draft):client.recoveryText;if(text===null)throw new EditorError('editor_request_missing');download(text,command==='export-draft'?'publisher-private-draft.json':'publisher-private-recovery.json');return;}
      }
      if(action==='refresh')return refresh();
      if(action==='logout'){try{await api.request('logout',{});}finally{privateClear();state.message='Đã đóng khu vực biên tập. Bản nháp trên tab chỉ mở lại sau khi đăng nhập đúng người biên tập.';}return;}
      if(action==='confirm'){const confirmation=state.confirm;state.confirm=null;if(confirmation)return confirmation.work();return;}
      if(action==='cancel-confirm'){state.confirm=null;return;}
      if(action==='open-document'){if(!selectedDocument)throw new EditorError('choose_document');return confirmReplace(()=>loadDocument(selectedDocument,{replace:true}));}
      if(action==='use-template'){
        const lesson=state.templates.find(l=>l.id===selectedTemplate);if(!lesson)throw new EditorError('choose_template');
        return confirmReplace(async()=>{if(state.documents.some(d=>d.lesson_id===lesson.id)){await loadDocument(lesson.id,{replace:true});state.message='Bài này đã có bản lưu; đang mở bản máy chủ hiện tại.';}else{persist(draftFromLesson(lesson));state.view=null;state.audit=[];state.preview=false;}});
      }
      if(action==='import')return importLesson(importText||'');
      if(action==='save-draft'){if(!state.draft)throw new EditorError('invalid_editor_draft');persist(state.draft);return send('draft',{expected_revision:state.draft.expected_revision,lesson:lessonFromDraft(state.draft)});}
      if(action==='sync-text'){const token=epoch,next=await synchronizeText(state.draft);if(token!==epoch)throw new EditorError('editor_scope_expired');persist(next);state.message='Đã đối chiếu mã văn bản và kịch bản âm thanh. Cần tự kiểm tra lại dẫn chứng; chưa tạo bản ghi âm.';return;}
      if(action==='preview'){lessonFromDraft(state.draft);state.preview=true;return;}
      if(action==='export'){download(JSON.stringify(lessonFromDraft(state.draft),null,2)+'\n','read2lead-lesson-draft.json');state.message='Đã xuất bản đang biên tập. Tệp này chưa được xem là bản phát hành.';return;}
      if(action==='discard-draft')return confirmReplace(()=>{persist(null);state.preview=false;},'Bỏ riêng bản đang gõ trên tab? Bản máy chủ và lịch sử không đổi.');
      if(action==='use-current')return confirmReplace(()=>persist(draftFromLesson(state.view.lesson,state.view.document.revision)));
      if(action==='request-review')return send('request-review',documentData());
      if(action==='publish')return send('publish-qa',documentData());
      if(action==='retry'){const client=state.client,result=await client.retry();current(client);return applyResult(result);}
      if(action==='reconcile'){const client=state.client,result=await client.reconcile();current(client);state.documents=result.documents;if(result.current_view)state.view=result.current_view;syncClient();state.message='Đã đối chiếu dữ liệu máy chủ. Bản đang gõ và lượt đang giữ chưa bị thay đổi.';return;}
      if(action==='discard-pending'){state.confirm={message:'Bỏ riêng lượt gửi trên tab sau khi đã kiểm tra máy chủ? Bản nháp đang gõ vẫn giữ; thao tác máy chủ đã ghi sẽ không bị hoàn tác.',work:async()=>{const client=state.client,result=await client.discardPending();current(client);state.documents=result.documents;if(result.current_view)state.view=result.current_view;state.draft=client.draft;state.message='Đã bỏ lượt đang giữ trên tab. Bản máy chủ không bị hoàn tác.';}};return;}
    });
  });
  const hideMedia=()=>{if(document.hidden)stopPublisherMedia(root,{detach:false});};document.addEventListener('visibilitychange',hideMedia);
  globalThis.addEventListener('beforeunload',event=>{if(state.access&&(draftChanged(state.draft,state.view)||state.pending||state.publisher?.draftText||state.publisher?.client.draft||state.publisher?.client.pending)){event.preventDefault();event.returnValue='';}});
  paint();void run(async()=>{try{await connect(await api.request('me'));}catch(error){if(error.code==='unauthorized'){privateClear();return;}throw error;}});
  return { destroy(){document.removeEventListener('visibilitychange',hideMedia);privateClear();root.replaceChildren();} };
}
