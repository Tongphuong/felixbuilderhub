import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { VOICE_POOL_REST_CODE, VOICE_POOL_REST_VI } from '../src/lib/read2lead-minny-notes.mjs';
import { createStoryCapture, createStorySpeechEndDetector, createStoryIllustrationReader } from '../src/scripts/read2lead-story-voice.mjs';
const page=fs.readFileSync(new URL('../src/pages/read2lead/lesson.astro',import.meta.url),'utf8');
function voiceUploadHarness({login=false,picture=false,recover=false}={}) {
 const source=fs.readFileSync(new URL('../src/scripts/read2lead-story-voice.mjs',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf('  async function uploadVoice()'),source.indexOf('  async function recordVoice()'));
 const pending=new Map([['requestId','same-recording']]),cues=[],requests=[],received=[];
 const context={VOICE_POOL_REST_CODE,VOICE_POOL_REST_VI,busy:false,voicePending:pending,hideNarration(){},pictureMode:()=>picture,
  setCue:(state,text)=>cues.push({state,text}),node:(tag,text)=>({tag,text}),button:(text,action)=>({text,action}),
  controls:{children:[],replaceChildren(...children){this.children=children;},prepend(child){this.children.unshift(child);}},
  view:{policy:{interview:!picture}},focusActivity(){},notice:{textContent:''},start(){},
  savedVoiceQuery:id=>'?requestId='+id,
  voiceRequest:async(input,query)=>{requests.push({input,query});if(!input&&recover)return{saved:true};throw Error(login?'login':'network');},
  receivedVoice:result=>received.push(result)};
 vm.createContext(context);vm.runInContext(handler+';this.uploadVoice=uploadVoice;',context);
 return {context,pending,cues,requests,received};
}
test('failed voice upload and lookup leave an honest retry cue and preserve the same recording',async()=>{
 for(const picture of [false,true])for(const login of [false,true]){
  const h=voiceUploadHarness({picture,login});await h.context.uploadVoice();
  assert.equal(h.cues.at(-1).state,'retry');
  assert.doesNotMatch(h.cues.at(-1).text,/đang xem/);
  assert.equal(h.context.busy,false);assert.equal(h.context.voicePending,h.pending);
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].input,h.pending);
  assert.equal(h.requests[1].query,'?requestId=same-recording');assert.equal(h.received.length,0);
  assert.deepEqual(h.context.controls.children.slice(login?1:0).map(c=>c.text),['Thử nhận lại câu trả lời','Mở lại tiến trình đã lưu']);
  if(login){assert.equal(h.context.controls.children[0].href,'/private-rehearsal/login');assert.match(h.context.notice.textContent,/Đăng nhập lại/);}
  else {assert.equal(h.context.notice.textContent,'Chưa nhận được kết quả. Phần đã lưu vẫn được giữ nguyên.');}
  await h.context.controls.children[login?1:0].action();
  assert.equal(h.requests[2].input,h.pending);assert.equal(h.context.busy,false);
 }
});
test('lost upload response recovered from its receipt does not show a failure or resubmit audio',async()=>{
 const h=voiceUploadHarness({recover:true});await h.context.uploadVoice();
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].input,null);
 assert.deepEqual(h.received,[{saved:true}]);assert.equal(h.context.notice.textContent,'');
 assert.equal(h.cues.some(c=>c.state==='retry'),false);assert.equal(h.context.busy,false);
});
function pictureReader(){
 const element=()=>({attributes:{},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},removeAttribute(k){delete this.attributes[k];}});
 const elements=Object.fromEntries(['image','previous','next','counter','badge','credit'].map(k=>[k,element()]));
 return {...elements,update:createStoryIllustrationReader(elements)};
}
const picturedLesson=()=>({id:'story-one',version:'1.2.3',illustrations:[{url:'/first.png',alt:'First original illustration'},{url:'/second.png',alt:'Second original illustration'}]});
test('all original pictures can be reached and boundaries cannot wrap or overflow',()=>{
 const r=pictureReader();r.update(picturedLesson());
 assert.equal(r.credit.textContent,'Minh hoạ câu chuyện');
 assert.equal(r.image.getAttribute('src'),'/first.png');assert.equal(r.previous.disabled,true);assert.equal(r.next.hidden,false);assert.equal(r.counter.textContent,'Tranh 1/2');
 r.previous.onclick();assert.equal(r.image.getAttribute('src'),'/first.png');
 r.next.onclick();assert.equal(r.image.getAttribute('src'),'/second.png');assert.equal(r.image.alt,'Second original illustration');assert.equal(r.next.disabled,true);assert.equal(r.counter.textContent,'Tranh 2/2');
 r.next.onclick();assert.equal(r.image.getAttribute('src'),'/second.png');
 r.previous.onclick();assert.equal(r.image.getAttribute('src'),'/first.png');
});
test('server refresh retains selected picture by identity; another story or version resets it',()=>{
 const r=pictureReader(),l=picturedLesson();r.update(l);r.next.onclick();r.update(structuredClone(l));assert.equal(r.image.getAttribute('src'),'/second.png');
 r.update({...l,illustrations:[...l.illustrations].reverse()});assert.equal(r.image.getAttribute('src'),'/second.png');assert.equal(r.counter.textContent,'Tranh 1/2');
 r.update({...l,id:'another-story'});assert.equal(r.image.getAttribute('src'),'/first.png');
 r.next.onclick();r.update({...l,id:'another-story',version:'1.2.4'});assert.equal(r.image.getAttribute('src'),'/first.png');
});
test('single and absent illustrations hide navigation and clear obsolete image content',()=>{
 const r=pictureReader(),l=picturedLesson();r.update(l);r.next.onclick();
 r.update({...l,illustrations:l.illustrations.slice(0,1)});assert.equal(r.image.getAttribute('src'),'/first.png');assert.equal(r.previous.hidden,true);assert.equal(r.next.hidden,true);
 r.update({...l,illustrations:[]});assert.equal(r.image.hidden,true);assert.equal(r.image.getAttribute('src'),undefined);assert.equal(r.image.alt,'');assert.equal(r.counter.hidden,true);assert.equal(r.badge.hidden,true);
 r.next.onclick();assert.equal(r.image.getAttribute('src'),undefined);
});
test('mission guard parses as classic script and does not start the legacy controller',()=>{
 const script=page.match(/<script is:inline>\s*(\/\/ Explicit new contract only\.[\s\S]*?)<\/script>/)[1];
 const compiled=new vm.Script(script);
 compiled.runInNewContext({window:{location:{search:'?mission=story-mission-v1'}},URLSearchParams});
 // Deliberately missing document: entering the legacy path must reach its DOM
 // dependency, proving the explicit guard was active in the positive case.
 assert.throws(()=>compiled.runInNewContext({window:{location:{search:'?code=OLD&pack_id=old'}},URLSearchParams}),/document|localStorage/);
});
test('microphone permission arriving after cancellation releases tracks without recording',async()=>{
 let resolve,stops=0,starts=0;
 const capture=createStoryCapture({getStream:()=>new Promise(r=>resolve=r),createRecorder:()=>{starts++;}});
 const pending=capture.start();capture.cancel();resolve({getTracks:()=>[{stop:()=>stops++}]});
 assert.equal(await pending,false);assert.equal(stops,1);assert.equal(starts,0);
});
test('capture returns real recorder blob and releases tracks even when encoding fails',async()=>{
 let stops=0,fail=false;const blob=new Blob(['recorded'],{type:'audio/wav'});
 const capture=createStoryCapture({getStream:async()=>({getTracks:()=>[{stop:()=>stops++}]}),createRecorder:()=>({engine:'wav',start(){},stop:async()=>{if(fail)throw Error('encoding');return blob;}})});
 assert.equal(await capture.start(),true);assert.equal(await capture.stop(),blob);assert.equal(stops,1);
 fail=true;await capture.start();await assert.rejects(capture.stop(),/encoding/);assert.equal(stops,2);
});
test('cancel during encoding suppresses a late blob so it cannot be uploaded',async()=>{
 let resolve,stops=0;
 const capture=createStoryCapture({getStream:async()=>({getTracks:()=>[{stop:()=>stops++}]}),createRecorder:()=>({engine:'wav',start(){},stop:()=>new Promise(r=>resolve=r)})});
 await capture.start();const pending=capture.stop();capture.cancel();resolve(new Blob(['late']));
 assert.equal(await pending,null);assert.equal(stops,1);
});
test('browser adapter pins saved sessions and cannot call legacy completion or providers',()=>{
 const source=fs.readFileSync(new URL('../src/scripts/read2lead-story-voice.mjs',import.meta.url),'utf8');
 assert.match(source,/searchParams\.set\('session',s\.id\)/);
 assert.match(source,/api\(null,'\?sessionId='/);
 assert.doesNotMatch(source,/submit-read2lead-lesson|\/api\/minny-|speechSynthesis|getUserMedia/);
 assert.match(source,/pagehide/);assert.match(source,/visibilitychange/);
});
test('warm microphone is disabled between turns, reused once, and released on cancel',async()=>{
 let permissions=0,stops=0,recordings=0;const track={readyState:'live',enabled:true,stop(){stops++;this.readyState='ended';}};
 const capture=createStoryCapture({getStream:async()=>{permissions++;return{getTracks:()=>[track]};},createRecorder:()=>({engine:'wav',start(){recordings++;},stop:async()=>new Blob(['pcm'])})},{keepWarm:true});
 await capture.start();assert.equal(track.enabled,true);await capture.stop();assert.equal(track.enabled,false);assert.equal(stops,0);
 await capture.start();assert.equal(track.enabled,true);await capture.stop();capture.cancel();
 assert.equal(permissions,1);assert.equal(recordings,2);assert.equal(stops,1);
});
test('speech end requires sustained voice then silence; silence and a click do not submit',()=>{
 let ends=0;const detect=createStorySpeechEndDetector({onEnd:()=>ends++});
 for(let t=0;t<3000;t+=100)detect(0,t);assert.equal(ends,0);
 detect(9,3000);for(let t=3100;t<6000;t+=100)detect(0,t);assert.equal(ends,0);
 for(let t=6000;t<6700;t+=100)detect(8,t);
 for(let t=6700;t<8400;t+=100)detect(0,t);assert.equal(ends,0);
 detect(0,8400);assert.equal(ends,1);detect(0,9000);assert.equal(ends,1);
});
test('cancel while monitor starts closes the late monitor and stops capture',async()=>{
 let resolve,closed=0,stops=0;
 const capture=createStoryCapture({getStream:async()=>({getTracks:()=>[{stop:()=>stops++}]}),createRecorder:()=>({engine:'wav',start(){},stop:async()=>new Blob([])}),startMonitor:()=>new Promise(r=>resolve=r)});
 const pending=capture.start();await new Promise(r=>setImmediate(r));capture.cancel();resolve({stop:()=>closed++});
 assert.equal(await pending,false);assert.equal(closed,1);assert.equal(stops,1);
});

test('question audio stopped during loading cannot play a late reply over the microphone',async()=>{
 const {createStoryPromptPlayback}=await import('../src/scripts/read2lead-story-voice.mjs');
 let resolve,signal,plays=0,urls=0,errors=0;
 const player={pause(){},removeAttribute(){},play(){plays++;}};
 const playback=createStoryPromptPlayback({player,request:s=>{signal=s;return new Promise(r=>resolve=r);},createUrl:()=>{urls++;return'blob:question';},revokeUrl(){},onError:()=>errors++});
 const pending=playback.play();playback.stop();assert.equal(signal.aborted,true);
 resolve({audio:{audio_b64:'YQ==',content_type:'audio/mpeg'}});await pending;
 assert.equal(plays,0);assert.equal(urls,0);assert.equal(errors,0);assert.equal(player.hidden,true);
});
test('question playback releases its recording on stop and recovers from a failed request',async()=>{
 const {createStoryPromptPlayback}=await import('../src/scripts/read2lead-story-voice.mjs');
 let failed=true,plays=0,errors=0,revoked=[];const loading=[];
 const player={pause(){},removeAttribute(){delete this.src;},play(){plays++;return Promise.resolve();}};
 const playback=createStoryPromptPlayback({player,request:async()=>{if(failed)throw Error('offline');return{audio:{audio_b64:'YQ==',content_type:'audio/mpeg'}};},createUrl:()=> 'blob:question',revokeUrl:url=>revoked.push(url),onError:()=>errors++,onLoading:v=>loading.push(v)});
 await playback.play();assert.equal(errors,1);assert.equal(player.hidden,true);assert.equal(loading.at(-1),false);
 failed=false;await playback.play();assert.equal(plays,1);assert.equal(player.hidden,false);
 playback.stop();assert.equal(player.hidden,true);assert.equal(player.src,undefined);assert.deepEqual(revoked,['blob:question']);
});
test('replaying a successful question reuses audio; another question has its own request',async()=>{
 const {createStoryPromptPlayback}=await import('../src/scripts/read2lead-story-voice.mjs');
 let calls=0,plays=0;const revoked=[];
 const make=()=>createStoryPromptPlayback({player:{pause(){},removeAttribute(){},play(){plays++;return Promise.resolve();}},request:async()=>{calls++;return{audio:{audio_b64:'YQ==',content_type:'audio/mpeg'}};},createUrl:()=>`blob:${plays}`,revokeUrl:u=>revoked.push(u)});
 const first=make();await first.play();await first.play();first.stop();await first.play();
 assert.equal(calls,1);assert.equal(plays,3);assert.equal(revoked.length,2);
 const second=make();await second.play();assert.equal(calls,2);first.stop();second.stop();
});
test('autoplay denial keeps received question audio for an explicit replay',async()=>{
 const {createStoryPromptPlayback}=await import('../src/scripts/read2lead-story-voice.mjs');
 let calls=0,plays=0,errors=0;
 const playback=createStoryPromptPlayback({player:{pause(){},removeAttribute(){},play(){if(++plays===1)throw Error('autoplay_denied');}},request:async()=>{calls++;return{audio:{audio_b64:'YQ==',content_type:'audio/mpeg'}};},createUrl:()=> 'blob:question',revokeUrl(){},onError:()=>errors++});
 await playback.play();await playback.play();assert.equal(calls,1);assert.equal(plays,2);assert.equal(errors,1);playback.stop();
});
