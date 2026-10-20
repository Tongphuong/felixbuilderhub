import {getDocument,GlobalWorkerOptions} from '/read2lead/library-assets/pdfjs/pdf.mjs';
GlobalWorkerOptions.workerSrc='/read2lead/library-assets/pdfjs/pdf.worker.mjs';
const $=id=>document.getElementById(id),status=$('library-status'),audio=$('story-audio');
try{const c=new URLSearchParams(location.search).get('code')||sessionStorage.getItem('r2l_access_code')||'';if(c)$('library-home').href='/read2lead/?code='+encodeURIComponent(c);}catch{/* optional: plain /read2lead/ still works with the session */}
let catalogue,selected,pdf,loading,renderTask,generation=0,page=0,renderGeneration=0;
const label=b=>`Bộ ${b.collection} · Quyển ${b.month}`;
function stopAudio(){audio.pause();audio.removeAttribute('src');audio.load();}
function updateUrl(){const u=new URL(location.href);u.search='';if(selected)u.searchParams.set('story',selected.id);history.replaceState(null,'',u);}
let activeBook='all';
/* Decorative picture tiles only (no story illustration data exists): a small rotating palette, as in the design. */
const TILE_COLOURS=['#4FB868','#3CC8F0','#E3F1FA','#FFE7A8'];
const TILE_ART=[
 '<path d="M20 80 l20 -60 20 60z M60 80 l18 -50 18 50z" fill="#237A41" stroke="#17324D" stroke-width="3"/>',
 '<path d="M10 25 q30 -30 55 0 q-25 30 -55 0z M65 25 l12 -12 v24z" fill="#FF7A3D" stroke="#17324D" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="22" r="3" fill="#17324D"/>',
 '<path d="M10 40 q-6 -22 18 -22 q6 -16 26 -10 q22 -4 24 18 q12 4 4 14z" fill="#fff" stroke="#17324D" stroke-width="3" stroke-linejoin="round"/>',
 '<ellipse cx="28" cy="32" rx="18" ry="12" fill="#C9D3DE" stroke="#17324D" stroke-width="3"/><circle cx="16" cy="18" r="6" fill="#C9D3DE" stroke="#17324D" stroke-width="3"/><ellipse cx="64" cy="32" rx="18" ry="12" fill="#E8A06B" stroke="#17324D" stroke-width="3"/><circle cx="76" cy="18" r="6" fill="#E8A06B" stroke="#17324D" stroke-width="3"/>'];
/* Tile art is CSS only: one stylesheet rule per picture (4 rules), so a card is a plain div with no SVG node of its own (was an inline SVG per card x 1,095). */
const TILE_CLASS=TILE_ART.map((_,n)=>`pic-${n}`);
{const st=document.createElement('style');st.textContent=TILE_ART.map((a,n)=>`.story-card .pic.pic-${n}{background-image:url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">${a}</svg>`)}");background-repeat:no-repeat;background-position:center;background-size:70% 70%}`).join('\n');document.head.append(st);}
/* Two drawings of the same scene: a wide strip (phone/tablet, 330x150) and the mock's near-square one (112x112) for the
   1100px+ side card (240 x ~258). One wide drawing sliced into that portrait box cut off the sun and half the cloud. */
const SCENE_ART_WIDE='<svg class="art-wide" aria-hidden="true" viewBox="0 0 112 112" preserveAspectRatio="xMidYMid slice"><circle cx="82" cy="30" r="16" fill="#FFD95A"/><ellipse cx="34" cy="38" rx="20" ry="8" fill="#fff"/><path d="M30 56 q6 -6 12 0 q6 -6 12 0" stroke="#17324D" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M0 84 C30 66 60 80 112 70 L112 112 L0 112Z" fill="#4FB868"/></svg>';
const SCENE_ART=SCENE_ART_WIDE+'<svg class="art-strip" aria-hidden="true" viewBox="0 0 330 150" preserveAspectRatio="xMidYMid slice"><circle cx="260" cy="44" r="24" fill="#FFD95A"/><ellipse cx="80" cy="50" rx="40" ry="14" fill="#fff"/><path d="M150 76 q12 -12 24 0 q12 -12 24 0" stroke="#17324D" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M0 116 C70 94 150 112 230 100 C290 92 320 100 330 98 L330 150 L0 150Z" fill="#4FB868"/></svg>';
const ARROW='<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" stroke="#17324D" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
let activeCollection='all';
/* The catalogue has 3 collections x 12 books, so the chips are two steps: "Tất cả các quyển" + one chip per Bộ,
   then (once a Bộ is chosen) one "Quyển N" chip per book in it. Every book stays reachable, as with the old selects. */
function listBooks(){
 const collections=[...new Set(catalogue.books.map(b=>b.collection))];
 const chips=[{text:'Tất cả các quyển',on:activeCollection==='all'&&activeBook==='all',go:()=>{activeCollection='all';activeBook='all';}},
  ...(collections.length<2?catalogue.books.map(b=>({text:`Quyển ${b.month}`,on:b.id===activeBook,go:()=>{activeBook=b.id;}})):collections).map(c=>c.text?c:{text:`Bộ ${c}`,on:String(c)===activeCollection&&activeBook==='all',go:()=>{activeCollection=String(c);activeBook='all';}})];
 if(activeCollection!=='all')chips.push(...catalogue.books.filter(b=>String(b.collection)===activeCollection).map(b=>({text:`Quyển ${b.month}`,on:b.id===activeBook,go:()=>{activeBook=b.id;}})));
 const bar=$('book-filters'),keep=bar.contains(document.activeElement)?document.activeElement.textContent:null;
 bar.replaceChildren(...chips.map(o=>{const t=el('button','tab',o.text);t.type='button';t.setAttribute('aria-pressed',String(o.on));t.onclick=()=>{o.go();listBooks();listStories();};return t;}));
 if(keep!==null)[...bar.children].find(b=>b.textContent===keep)?.focus({preventScroll:true});
}
/* role="toolbar": Left/Right (Up/Down) + Home/End move focus between the chips; Tab order unchanged. */
$('book-filters').addEventListener('keydown',e=>{
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)||e.altKey||e.ctrlKey||e.metaKey)return;
 const b=[...$('book-filters').querySelectorAll('button')],at=b.indexOf(document.activeElement);if(at<0)return;e.preventDefault();
 b[e.key==='Home'?0:e.key==='End'?b.length-1:(e.key==='ArrowLeft'||e.key==='ArrowUp')?(at-1+b.length)%b.length:(at+1)%b.length].focus();
});
/* "Truyện hôm nay": one readable story per calendar day, the same all day (stories that have pages; audio preferred). */
let assignedTitle='';
/* The child's CURRENT assigned story (progress current_pack, read-only) — "Truyện hôm nay" when it is in the catalogue. */
async function fetchAssignedTitle(){
 try{let c='';try{c=new URLSearchParams(location.search).get('code')||sessionStorage.getItem('r2l_access_code')||'';}catch{}
  const r=await fetch('/api/read2lead-progress'+(c?'?code='+encodeURIComponent(c):''),{credentials:'same-origin'});if(!r.ok)return '';
  const j=await r.json();return String(j?.progress?.current_pack?.story_title||'').trim().toLowerCase();}catch{return '';}
}
function todayStory(){
 const assigned=assignedTitle&&catalogue.stories.find(s=>s.pages.length&&s.title.trim().toLowerCase()===assignedTitle);if(assigned)return assigned;
 const readable=catalogue.stories.filter(s=>s.pages.length),pool=readable.filter(s=>s.audio.length).length?readable.filter(s=>s.audio.length):readable;
 if(!pool.length)return null;const now=new Date(),day=Math.floor(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/864e5);return pool[day%pool.length];
}
function storyTags(s){const box=el('div','tags');box.append(el('span',s.audio.length?'tag':'tag tag-white',s.audio.length?'Có bài nghe':'Chưa có bài nghe'));if(!s.pages.length)box.append(el('span','tag tag-white','Chưa có trang truyện'));return box;}
function renderToday(){
 const s=todayStory(),box=$('today');if(!s){box.hidden=true;return;}
 const scene=el('div','scene');scene.innerHTML=SCENE_ART;scene.append(el('span','tag tag-sun','Truyện hôm nay'));
 const body=el('div','today-body'),title=el('span','d t-2',s.title);title.lang='en';
 const cta=el('a','btn btn-sun btn-w r2l-m-ring','Đọc và nghe ');cta.href='?story='+s.id;cta.dataset.story=s.id;cta.dataset.design='lib.primary';cta.insertAdjacentHTML('beforeend',ARROW);
 cta.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();openStory(s.id);};
 body.append(title,el('span','b-m',`${label(catalogue.books.find(b=>b.id===s.bookId))} · Bài ${s.number}`),storyTags(s),cta);
 box.replaceChildren(scene,body);box.hidden=false;box.dataset.story=s.id;
}
function listStories(){
 const book=activeBook,query=$('search').value.trim().toLocaleLowerCase();
 const stories=catalogue.stories.filter(s=>(book==='all'?(activeCollection==='all'||String(catalogue.books.find(b=>b.id===s.bookId).collection)===activeCollection):s.bookId===book)&&(!query||s.title.toLocaleLowerCase().includes(query)||String(s.number)===query));
 /* the design has no running count (the header already says how many stories there are): only the no-result message shows */
 $('results-count').textContent=stories.length?'':'Chưa tìm thấy câu chuyện. Con thử tên khác nhé.';
 const today=$('today').dataset.story,rest=stories.filter(s=>s.id!==today||$('today').hidden);
 $('grid-title').hidden=!rest.length;
 $('stories-grid').replaceChildren(...rest.map(s=>{const i=Number(s.number||0)+catalogue.books.findIndex(b=>b.id===s.bookId);const a=el('a','card-f story-card');a.href='?story='+s.id;a.dataset.story=s.id;
 const pic=el('div','pic');pic.style.backgroundColor=TILE_COLOURS[i%TILE_COLOURS.length];pic.classList.add(TILE_CLASS[i%TILE_ART.length]);
 const title=el('strong','',s.title);title.lang='en';
 a.append(pic,title,el('span','where',`${activeCollection==='all'?label(catalogue.books.find(b=>b.id===s.bookId)):'Quyển '+catalogue.books.find(b=>b.id===s.bookId).month} · Bài ${s.number}`),storyTags(s));
 a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();openStory(s.id);};return a;}));
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
$('search').oninput=listStories;
$('back-library').onclick=()=>{const id=selected?.id;leaveReader();document.querySelector(`[data-story="${id}"]`)?.focus();};
$('previous-page').onclick=()=>{if(page>0){page--;renderPage();}};$('next-page').onclick=()=>{if(selected&&page<selected.pages.length-1){page++;renderPage();}};
$('retry-story').onclick=()=>{if(selected)openStory(selected.id);};$('audio-variant').onchange=()=>chooseAudio(Number($('audio-variant').value));
audio.onerror=()=>{$('audio-status').textContent='Chưa phát được bài nghe. Con bấm “Mở lại câu chuyện” để thử lại nhé.';};
window.addEventListener('pagehide',()=>{audio.pause();loading?.destroy().catch(()=>{});});document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.pause();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>renderPage(),200);});
try{const response=await fetch('/api/read2lead-library');if(!response.ok)throw Error();catalogue=await response.json();if(!catalogue.stories?.length)throw Error();const summary=`${catalogue.counts.stories.toLocaleString('vi-VN')} câu chuyện · ${catalogue.counts.books} quyển sách`;$('library-summary').textContent=summary;$('library-summary-lab').textContent=summary;assignedTitle=await fetchAssignedTitle();renderToday();listBooks();listStories();const q=new URLSearchParams(location.search);if(q.has('story'))await openStory(q.get('story'));else if(q.has('book')){const book=catalogue.books.find(b=>b.id===q.get('book'));if(book){activeCollection=String(book.collection);activeBook=book.id;listBooks();listStories();}}}
catch{$('library-summary').textContent='';$('library-summary-lab').textContent='';status.textContent='Chưa mở được thư viện. Con tải lại trang hoặc đăng nhập lại để tiếp tục.';}
