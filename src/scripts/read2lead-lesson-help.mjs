/** Continue only server-owned selection work. Retries cannot choose an offset. */
export async function requestLessonAssignment({code,packId=null,easier=false,request=fetch,timeoutMs=15000}) {
  for(let batch=0;batch<80;batch++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await request('/api/generate-read2lead-pack',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({access_code:code,collection:'auto',...(easier?{easier_from_pack:packId}:{})})});
      const data=await response.json();
      if(response.status===202&&data.status==='selecting')continue;
      if((!response.ok||!data.ok)&&!(data.error==='previous_pack_needs_review'&&data.lesson_link))throw Error(data.message||'Chưa mở được truyện. Bài đã lưu vẫn còn; con thử lại nhé.');
      return data;
    }catch(error){
      if(error?.name==='AbortError')throw Error('Mạng hơi chậm. Bài đã lưu vẫn còn; con thử lại nhé.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  throw Error('Kho truyện đang cập nhật. Bài đã lưu vẫn còn; con thử lại sau nhé.');
}

/** Explicit child action only. Never run assignment when mounting or returning home. */
export function createLessonAssignmentAction({code,packId,origin,request=fetch,isBusy=()=>false,navigate=url=>location.assign(url),beforeLeave=()=>{},prepareSwitch=async()=>{}}) {
  let pending=false;
  return async function open({easier=false}={}) {
    if(pending||isBusy())throw Error('Con nói xong hoặc huỷ phần ghi âm đang mở trước nhé. Bài đã lưu vẫn còn.');
    pending=true;
    try {
      if(easier)await prepareSwitch();
      const data=await requestLessonAssignment({code,packId,easier,request});
      if(!data.lesson_link)throw Error('Chưa mở được truyện. Bài đã lưu vẫn còn; con thử lại nhé.');
      const target=new URL(data.lesson_link,origin);
      if(target.origin!==origin||target.pathname.replace(/\/$/,'')!=='/read2lead/lesson')throw Error('Chưa mở được truyện. Con quay lại góc đọc sách nhé.');
      beforeLeave();navigate(target.href);return data;
    }catch(error){
      if(error instanceof TypeError)throw Error('Mất kết nối. Bài đã lưu vẫn còn; con thử lại nhé.');
      throw error;
    }finally{pending=false;}
  };
}

export function mountLessonHelp({container,isBusy=()=>false,beforeLeave=()=>{},prepareSwitch=async()=>{}}) {
  const params=new URLSearchParams(location.search),code=params.get('code'),packId=params.get('pack_id');
  if(!container||!code||!packId)return;
  if(params.get('review')==='1'){const note=document.createElement('p');note.id='lesson-review-note';note.className='story-mission-status';note.textContent='Ôn lại truyện · Không cộng thêm thưởng';container.prepend(note);}
  const help=document.createElement('details');help.className='lesson-support';
  const summary=document.createElement('summary');summary.textContent='Truyện này hơi khó';
  const note=document.createElement('p');note.textContent='Mình thử một truyện dễ hơn nhé. Phần con đã làm vẫn được lưu.';
  const status=document.createElement('p');status.setAttribute('role','status');
  const easier=document.createElement('button');easier.type='button';easier.className='r2l-primary';easier.textContent='Đọc truyện dễ hơn';
  const keep=document.createElement('button');keep.type='button';keep.className='r2l-secondary';keep.textContent='Giữ truyện này';
  const action=createLessonAssignmentAction({code,packId,origin:location.origin,isBusy,beforeLeave,prepareSwitch});
  easier.onclick=async()=>{
    if(isBusy()){status.textContent='Con nói xong hoặc huỷ phần ghi âm đang mở trước nhé.';return;}
    easier.disabled=true;keep.disabled=true;status.textContent='Đang tìm truyện dễ hơn cho con…';
    try{await action({easier:true});}catch(error){status.textContent=error.message;}
    finally{easier.disabled=false;keep.disabled=false;}
  };
  keep.onclick=()=>{help.open=false;summary.focus();};
  help.append(summary,note,easier,keep,status);container.prepend(help);return help;
}

export function originalLessonBusy(root=document) {
  return Boolean(root.querySelector('[data-lesson-saving="true"],[data-rec-state="recording"],[data-rec-state="checking"],[data-rec-state="warming"],[data-rec-state="processing"],[data-rec-state="stopping"],[data-rec-state="requesting"]'));
}
