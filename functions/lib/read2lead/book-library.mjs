const HASH=/^[a-f0-9]{64}$/;
export function validateBookLibrary(v) {
  if(v?.format!=='read2lead-book-library-v1'||!Array.isArray(v.books)||v.books.length>40||!v.media||typeof v.media!=='object')throw Error('invalid_library');
  for(const [hash,m] of Object.entries(v.media)){
    if(!HASH.test(hash)||!['application/pdf','audio/mpeg'].includes(m.mime)||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>512*1024*1024||!Array.isArray(m.parts)||!m.parts.length||m.parts.length>64||m.parts.some(p=>!HASH.test(p.hash)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>8*1024*1024)||m.parts.reduce((n,p)=>n+p.bytes,0)!==m.bytes)throw Error('invalid_library_media');
  }
  const seen=new Set();
  for(const b of v.books){
    if(!/^c[123]-b\d{2}$/.test(b.id)||seen.has(b.id)||![1,2,3].includes(b.collection)||!Number.isInteger(b.month)||b.month<1||b.month>12||v.media[b.pdf]?.mime!=='application/pdf'||!Number.isInteger(b.pages)||b.pages<1||!Array.isArray(b.tracks)||b.tracks.some(t=>v.media[t.media]?.mime!=='audio/mpeg'||typeof t.title!=='string'||t.title.length>300))throw Error('invalid_library_book');
    seen.add(b.id);
  }
  if(v.stories!==undefined){
    if(!Array.isArray(v.stories)||v.stories.length>1240)throw Error('invalid_library_stories');
    const ids=new Set(),pages=new Set(),books=new Map(v.books.map(b=>[b.id,b]));
    for(const s of v.stories){
      const b=books.get(s.bookId),days=b&&[31,28,31,30,31,30,31,31,30,31,30,31][b.month-1];
      if(!b||!Number.isInteger(s.number)||s.number<1||s.number>days||s.id!==`${b.id}-s${String(s.number).padStart(2,'0')}`||ids.has(s.id)||typeof s.title!=='string'||!s.title.trim()||s.title.length>200)throw Error('invalid_library_story');
      if(!Array.isArray(s.pages)||(s.pages.length!==0&&s.pages.length!==2)||s.pages.some(p=>!Number.isInteger(p)||p<4||p>=b.pages)||(s.pages.length&&s.pages[1]!==s.pages[0]+1)||s.pageStatus!==(s.pages.length?'present':'missing_from_scan'))throw Error('invalid_story_pages');
      for(const p of s.pages){const key=b.id+':'+p;if(pages.has(key))throw Error('overlapping_story_pages');pages.add(key);}
      if(!Array.isArray(s.audio)||s.audio.length>8||new Set(s.audio).size!==s.audio.length||s.audio.some(h=>!b.tracks.some(t=>t.day===s.number&&t.media===h)))throw Error('invalid_story_audio');
      ids.add(s.id);
    }
    const expected=v.books.reduce((n,b)=>n+[31,28,31,30,31,30,31,31,30,31,30,31][b.month-1],0);
    if(ids.size!==expected)throw Error('incomplete_library_stories');
  }
  return v;
}
export function libraryRange(header,size){
  if(!header)return {start:0,end:size-1,partial:false};
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||(!m[1]&&!m[2]))return null;
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end&&start<size&&(m[1]||Number(m[2])>0)?{start,end,partial:true}:null;
}
/** Called only after the existing same-origin session authentication. No writes. */
export async function bookLibraryMedia(request,library,assets){
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
  const url=new URL(request.url),key=url.pathname.slice('/api/read2lead-library-media/'.length),m=library.media[key];
  if(url.search||!HASH.test(key)||!m)return new Response(null,{status:404});
  const range=libraryRange(request.headers.get('Range'),m.bytes);
  if(!range)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${m.bytes}`}});
  const headers={'Content-Type':m.mime,'Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),
    'Content-Disposition':`inline; filename="read2lead-${key.slice(0,12)}.${m.mime==='application/pdf'?'pdf':'mp3'}"`};
  if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${m.bytes}`;
  if(request.method==='HEAD')return new Response(null,{status:range.partial?206:200,headers});
  let offset=0;const wanted=[];
  for(const part of m.parts){const end=offset+part.bytes-1;if(end>=range.start&&offset<=range.end)wanted.push({part,start:Math.max(0,range.start-offset),end:Math.min(part.bytes-1,range.end-offset)});offset=end+1;}
  let reader=null,position=0,current=null,index=0,cancelled=false;
  const body=new ReadableStream({
    async pull(controller){
      try{
        while(!cancelled){
          if(!reader){
            if(index===wanted.length){controller.close();return;}
            current=wanted[index++];position=0;
            const response=await assets.fetch(new Request('https://preview-assets.invalid/__private/book-parts/'+current.part.hash+'.bin'));
            if(response.status!==200||!response.body)throw Error('library_part_unavailable');
            if(cancelled){await response.body.cancel();return;}
            reader=response.body.getReader();
          }
          const {done,value}=await reader.read();
          if(cancelled)return;
          if(done){reader.releaseLock();reader=null;if(position<current.end+1)throw Error('library_part_truncated');continue;}
          const start=Math.max(0,current.start-position),end=Math.min(value.length,current.end-position+1);position+=value.length;
          if(end>start)controller.enqueue(value.subarray(start,end));
          if(position>current.end){await reader.cancel();reader=null;}
          if(end>start)return;
        }
      }catch(error){controller.error(error);if(reader)await reader.cancel().catch(()=>{});}
    },
    async cancel(){cancelled=true;if(reader)await reader.cancel();},
  });
  // Workers ignores a manual Content-Length on an arbitrary stream. Preserve
  // the known byte length so PDF.js can fetch pages with bounded byte ranges.
  const output=typeof globalThis.FixedLengthStream==='function'
    ?body.pipeThrough(new globalThis.FixedLengthStream(range.end-range.start+1)):body;
  return new Response(output,{status:range.partial?206:200,headers});
}
export function libraryPublicView(library){
  const media=h=>'/api/read2lead-library-media/'+h;
  return {books:library.books.map(b=>({id:b.id,collection:b.collection,month:b.month,pages:b.pages,pdf:media(b.pdf),
    tracks:b.tracks.map(t=>({day:t.day,title:t.title,url:media(t.media)}))})),
    stories:(library.stories||[]).map(s=>({id:s.id,bookId:s.bookId,number:s.number,title:s.title,pages:s.pages.slice(),audio:s.audio.map(media),pageStatus:s.pageStatus})),
    counts:{books:library.books.length,recordings:Object.values(library.media).filter(m=>m.mime==='audio/mpeg').length,
      stories:library.stories?.length||0,readableStories:library.stories?.filter(s=>s.pages.length).length||0,
      storiesWithAudio:library.stories?.filter(s=>s.audio.length).length||0}};
}
