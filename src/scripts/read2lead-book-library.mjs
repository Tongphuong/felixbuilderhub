import {getDocument,GlobalWorkerOptions} from '/read2lead/library-assets/pdfjs/pdf.mjs';
GlobalWorkerOptions.workerSrc='/read2lead/library-assets/pdfjs/pdf.worker.mjs';
const $=id=>document.getElementById(id),status=$('library-status'),audio=$('story-audio');
let catalogue,selected,pdf,loading,renderTask,generation=0,page=0,renderGeneration=0;
const label=b=>`Bộ ${b.collection} · Quyển ${b.month}`;
function stopAudio(){audio.pause();audio.removeAttribute('src');audio.load();}
function updateUrl(){const u=new URL(location.href);u.search='';if(selected)u.searchParams.set('story',selected.id);history.replaceState(null,'',u);}
function listBooks(){
 const value=$('collection').value,books=catalogue.books.filter(b=>value==='all'||b.collection===Number(value));
 $('book').replaceChildren(new Option('Tất cả các quyển','all'),...books.map(b=>new Option(label(b),b.id)));
}
function listStories(){
 const collection=$('collection').value,book=$('book').value,query=$('search').value.trim().toLocaleLowerCase();
 const stories=catalogue.stories.filter(s=>{const b=catalogue.books.find(b=>b.id===s.bookId);return (collection==='all'||b.collection===Number(collection))&&(book==='all'||s.bookId===book)&&(!query||s.title.toLocaleLowerCase().includes(query)||String(s.number)===query);});
 $('results-count').textContent=stories.length?`${stories.length.toLocaleString('vi-VN')} câu chuyện`:'Chưa tìm thấy câu chuyện. Con thử tên khác nhé.';
 $('stories-grid').replaceChildren(...stories.map(s=>{const a=document.createElement('a');a.className='story-card';a.href='?story='+s.id;a.dataset.story=s.id;
 const n=document.createElement('span');n.className='story-number';n.textContent=`${label(catalogue.books.find(b=>b.id===s.bookId))} · Bài ${s.number}`;
 const title=document.createElement('strong');title.textContent=s.title;title.lang='en';
 const info=document.createElement('span');info.textContent=s.pages.length?(s.audio.length?'Đọc và nghe →':'Đọc · Chưa có bài nghe'):'Chưa có trang truyện · '+(s.audio.length?'Có bài nghe':'Chưa có bài nghe');
 a.append(n,title,info);a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();openStory(s.id);};return a;}));
}
function leaveReader(){
 generation++;renderGeneration++;stopAudio();renderTask?.cancel();loading?.destroy().catch(()=>{});loading=null;pdf=null;selected=null;
 $('reader').hidden=true;$('catalogue').hidden=false;status.textContent='';updateUrl();
}
async function renderPage(){
 if(!pdf||!selected?.pages.length)return;const token=++renderGeneration,doc=pdf,story=selected,index=page;
 if(renderTask){renderTask.cancel();try{await renderTask.promise;}catch{}if(token!==renderGeneration)return;renderTask=null;}
 $('previous-page').disabled=index<=0;$('next-page').disabled=index>=story.pages.length-1;
 $('page-total').textContent=`Trang ${index+1} / ${story.pages.length}`;$('page-status').textContent='Đang mở trang…';
 try{
  const source=await doc.getPage(story.pages[index]);if(token!==renderGeneration)return;
  const available=$('canvas-wrap').clientWidth,base=source.getViewport({scale:1}),scale=Math.min(2,devicePixelRatio||1)*available/base.width,viewport=source.getViewport({scale});
  const canvas=$('pdf-page');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=available+'px';canvas.dataset.sourcePage=String(story.pages[index]);
  renderTask=source.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;if(token!==renderGeneration)return;
  $('page-status').textContent=`Trang ${index+1} của câu chuyện đã mở.`;
 }catch(error){if(error.name!=='RenderingCancelledException'&&token===renderGeneration)$('page-status').textContent='Chưa mở được trang. Con bấm “Mở lại câu chuyện” để thử lại nhé.';}
}
function chooseAudio(index=0){stopAudio();if(selected?.audio[index]){audio.src=selected.audio[index];audio.hidden=false;$('audio-status').textContent='Bấm phát để nghe câu chuyện này.';}else{audio.hidden=true;$('audio-status').textContent='Chưa tìm thấy bản ghi âm của câu chuyện này trong các tệp đã cung cấp.';}}
async function openStory(id){
 const story=catalogue.stories.find(s=>s.id===id);if(!story){status.textContent='Không tìm thấy câu chuyện này. Con chọn một bài trong thư viện nhé.';return;}
 const book=catalogue.books.find(b=>b.id===story.bookId),token=++generation;renderGeneration++;stopAudio();renderTask?.cancel();pdf=null;
 if(loading)await loading.destroy().catch(()=>{});if(token!==generation)return;loading=null;
 selected=story;page=0;$('reader').hidden=false;$('catalogue').hidden=true;$('story-title').textContent=story.title;$('story-title').focus({preventScroll:true});$('story-location').textContent=`${label(book)} · Bài ${story.number}`;
 $('audio-variant').replaceChildren(...story.audio.map((_,i)=>new Option(i?`Bản ghi ${i+1}`:'Bản ghi chính',String(i))));$('audio-variants').hidden=story.audio.length<2;chooseAudio();
 $('paper-content').hidden=!story.pages.length;$('missing-pages').hidden=!!story.pages.length;
 $('page-status').textContent='';$('pdf-page').width=0;$('pdf-page').removeAttribute('data-source-page');updateUrl();
 const siblings=catalogue.stories.filter(s=>s.bookId===book.id),position=siblings.findIndex(s=>s.id===id);
 for(const [button,offset] of [['previous-story',-1],['next-story',1]]){const target=siblings[position+offset];$(button).disabled=!target;$(button).onclick=()=>{if(target)openStory(target.id);};}
 status.textContent=story.pages.length?'Đang mở câu chuyện…':'';if(!story.pages.length)return;
 try{loading=getDocument({url:book.pdf,disableAutoFetch:true,disableStream:true,rangeChunkSize:524288,isEvalSupported:false,useWasm:false,standardFontDataUrl:'/read2lead/library-assets/pdfjs/standard_fonts/',cMapUrl:'/read2lead/library-assets/pdfjs/cmaps/',cMapPacked:true});const doc=await loading.promise;if(token!==generation)return;pdf=doc;status.textContent='';await renderPage();}
 catch{if(token===generation)status.textContent='Chưa mở được câu chuyện. Con bấm “Mở lại câu chuyện” để thử lại nhé.';}
}
$('collection').onchange=()=>{listBooks();listStories();};$('book').onchange=listStories;$('search').oninput=listStories;
$('back-library').onclick=()=>{const id=selected?.id;leaveReader();document.querySelector(`[data-story="${id}"]`)?.focus();};
$('previous-page').onclick=()=>{if(page>0){page--;renderPage();}};$('next-page').onclick=()=>{if(selected&&page<selected.pages.length-1){page++;renderPage();}};
$('retry-story').onclick=()=>{if(selected)openStory(selected.id);};$('audio-variant').onchange=()=>chooseAudio(Number($('audio-variant').value));
audio.onerror=()=>{$('audio-status').textContent='Chưa phát được bài nghe. Con bấm “Mở lại câu chuyện” để thử lại nhé.';};
window.addEventListener('pagehide',()=>{audio.pause();loading?.destroy().catch(()=>{});});document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.pause();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>renderPage(),200);});
try{const response=await fetch('/api/read2lead-library');if(!response.ok)throw Error();catalogue=await response.json();if(!catalogue.stories?.length)throw Error();$('library-summary').textContent=`${catalogue.counts.stories.toLocaleString('vi-VN')} câu chuyện · ${catalogue.counts.books} quyển sách`;listBooks();listStories();const q=new URLSearchParams(location.search);if(q.has('story'))await openStory(q.get('story'));else if(q.has('book')){const book=catalogue.books.find(b=>b.id===q.get('book'));if(book){$('collection').value=String(book.collection);listBooks();$('book').value=book.id;listStories();}}}
catch{status.textContent='Chưa mở được thư viện. Con tải lại trang hoặc đăng nhập lại để tiếp tục.';}
