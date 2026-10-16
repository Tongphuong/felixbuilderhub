import { STORY_MISSION_VERSION, STORY_STAGES } from '../lib/read2lead-story-mission.mjs';
import { pronunciationNote, VOICE_POOL_REST_VI, VOICE_POOL_REST_CODE } from '../lib/read2lead-minny-notes.mjs';
import { mountLessonHelp, createLessonAssignmentAction } from './read2lead-lesson-help.mjs';

/** Late network replies must never speak over a microphone or a new question. */
export function createStoryPromptPlayback({request,player,onLoading=()=>{},onError=()=>{},
  createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url)}) {
  let generation=0,controller,url,cachedAudio;
  const stop=()=>{generation++;controller?.abort();controller=null;player.pause();
    if(url)revokeUrl(url);url=null;player.removeAttribute('src');player.hidden=true;onLoading(false);};
  return {stop,async play(){
    stop();const token=generation,current=new AbortController();controller=current;const signal=current.signal;
    onLoading(true);
    const timer=setTimeout(()=>current.abort(),20000);
    try {
      const result=cachedAudio||await request(signal);
      if(token!==generation)return;
      if(signal.aborted)throw Error('question_audio_timeout');
      const bytes=Uint8Array.from(atob(result.audio.audio_b64),c=>c.charCodeAt(0));
      cachedAudio=result;
      url=createUrl(new Blob([bytes],{type:result.audio.content_type}));
      player.src=url;player.hidden=false;await player.play();
    }catch(error){if(token===generation)onError(error);}
    finally{clearTimeout(timer);if(token===generation){controller=null;onLoading(false);}}
  }};
}

/** Local capture only. Cancel also handles permission resolving after navigation. */
export function createStorySpeechEndDetector({threshold=4,minimumVoicedMs=500,silenceMs=1800,onEnd=()=>{}}={}) {
  let previous=null,lastVoice=null,voiced=0,ended=false;
  return (level,now)=>{
    if(ended||!Number.isFinite(level)||!Number.isFinite(now))return;
    const elapsed=previous===null?0:Math.max(0,Math.min(200,now-previous));previous=now;
    if(level>=threshold){voiced+=elapsed;lastVoice=now;}
    else if(voiced>=minimumVoicedMs&&lastVoice!==null&&now-lastVoice>=silenceMs){ended=true;onEnd();}
  };
}
export function createStoryCapture(recorder,{keepWarm=false}={}) {
  let generation=0, stream, recording, monitor, acquiring=false;
  const release=s=>s?.getTracks().forEach(t=>t.stop());
  return {
    async start({onSpeechEnd=()=>{}}={}) {
      if(recording||acquiring)throw Error('capture_busy');acquiring=true;
      const token=++generation;
      let acquired;
      try{acquired=stream?.getTracks().every(t=>t.readyState==='live')?stream:await recorder.getStream();}
      catch(error){if(token===generation)acquiring=false;throw error;}
      if(token!==generation){release(acquired);return false;}
      acquiring=false;stream=acquired;stream.getTracks().forEach(t=>t.enabled=true);
      try {
        recording=recorder.createRecorder(stream,{engine:'wav'});if(recording.engine!=='wav')throw Error('pcm_capture_unavailable');recording.start();
        if(recorder.startMonitor){
          const detect=createStorySpeechEndDetector({threshold:recorder.SILENT_LEVEL||4,onEnd:onSpeechEnd});
          const observed=await recorder.startMonitor(stream,{onLevel:level=>{if(token===generation&&recording)detect(level,performance.now());}});
          if(token!==generation){observed.stop();return false;}monitor=observed;
        }
        return true;
      }
      catch(error){release(stream);stream=null;recording=null;throw error;}
    },
    async stop() {
      const token=generation,current=recording,held=stream;recording=null;monitor?.stop();monitor=null;
      if(keepWarm)held?.getTracks().forEach(t=>t.enabled=false);else stream=null;
      try {const blob=await current?.stop();return token===generation?blob:null;}
      catch(error){if(stream===held)stream=null;if(keepWarm)release(held);throw error;}
      finally {if(!keepWarm)release(held);}
    },
    cancel() {
      generation++;acquiring=false;const current=recording;recording=null;monitor?.stop();monitor=null;
      release(stream);stream=null;
      if(current)Promise.resolve().then(()=>current.stop()).catch(()=>{});
    },
  };
}

/** Picture-only controls: changing art never changes lesson progress or audio. */
export function createStoryIllustrationReader({image,previous,next,counter,badge,credit}) {
  let key, pictures=[], index=0;
  previous.setAttribute('aria-label','Xem tranh trước');
  next.setAttribute('aria-label','Xem tranh tiếp');
  const paint=()=>{
    const pic=pictures[index];
    image.hidden=!pic;
    if(pic) {if(image.getAttribute('src')!==pic.url)image.setAttribute('src',pic.url);image.alt=pic.alt;}
    else {image.removeAttribute('src');image.alt='';}
    counter.textContent=pic?`Tranh ${index+1}/${pictures.length}`:'';
    badge.textContent=pic?`Tranh ${index+1}`:'';
    counter.hidden=badge.hidden=!pic;
    previous.hidden=next.hidden=pictures.length<2;
    previous.disabled=index===0;
    next.disabled=index>=pictures.length-1;
    credit.textContent=pic?'Minh hoạ câu chuyện':'Minh hoạ đang được chuẩn bị';
  };
  previous.onclick=()=>{if(index>0){index--;paint();}};
  next.onclick=()=>{if(index<pictures.length-1){index++;paint();}};
  return lesson=>{
    const nextKey=`${lesson.id}@${lesson.version}`,selected=nextKey===key?pictures[index]?.url:null;
    key=nextKey;pictures=lesson.illustrations;
    index=Math.max(0,pictures.findIndex(p=>p.url===selected));
    paint();
  };
}

/** Original reader adapter. No fabricated chat, client grading or wallet writes. */
export async function mountStoryMission() {
  const $ = id => document.getElementById(id);
  const node = (tag, text, className) => { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; };
  const params = new URLSearchParams(location.search);
  const endpoint = '/api/read2lead-story-session';
  const accountHeaders = params.get('pack_id') && params.get('code') ? {'X-Read2Lead-Code':params.get('code')} : {};
  let notifiedReward,promptPlayback,freshInterviewAward=false,freshPictureAward=false;
  let view, pending = null, busy = false, audio, controller, replyAudio, replyUrl, voicePending, voiceResult, capture, captureTimer, microphone, microphoneIdleTimer;
  const root = $('w1-book-reader-phase');
  root.dataset.storyMission = STORY_MISSION_VERSION;
  document.body.dataset.storyMission = STORY_MISSION_VERSION;
  for(const child of $('lesson-shell').children)if(child!==root)child.classList.add('hidden');
  const panel = $('book-reader-stage-stack');
  const notice = node('p', '', 'story-mission-status'); notice.setAttribute('role', 'status');
  const controls = node('div', '', 'story-mission-controls');
  const progress=node('p','','story-mission-question-count');
  const cue=node('p','','story-mission-cue ft-hero__eyebrow');cue.setAttribute('role','status');
  const prompt=node('h3','','story-mission-current-question minny-transcript__reply');
  const hero=node('div','','ft-hero'),avatar=node('div','','ft-hero__avatar'),portrait=node('img');
  portrait.src='/assets/minny/minny_idle.png';portrait.alt='Minny';avatar.append(portrait);
  const heroBody=node('div','','ft-hero__body');heroBody.append(node('h3','Nói chuyện với Minny','story-mission-chat-title'),cue);
  hero.append(avatar,heroBody);
  const conversation=node('div','','minny-transcript');conversation.tabIndex=0;conversation.setAttribute('role','log');conversation.setAttribute('aria-label','Trò chuyện về truyện');
  panel.replaceChildren(progress,hero,conversation,notice,controls);
  const chatHistory=new Map();let layoutReady=false;
  const pictureBoard=node('section','','picture-retell-board');pictureBoard.hidden=true;
  pictureBoard.setAttribute('aria-label','Tranh kể lại truyện');
  const pictureMode=()=>view?.session.stage==='picture_retell';
  let pictureBoardKey;
  function showPictureBoard(activity){
    const {picture:url,frames,sheetWidth}=activity,key=JSON.stringify(activity);
    if(pictureBoardKey===key)return;pictureBoardKey=key;pictureBoard.replaceChildren();
    pictureBoard.dataset.count=String(frames.length);
    // Display five panels from the original generated sheet; no repeated downloads.
    frames.forEach(({x,y,width:w,height:h},i)=>{
      const card=button('',()=>{dialog.showModal();},true);card.className='picture-retell-card';card.setAttribute('aria-label',`Phóng to tranh ${i+1}`);
      const art=node('span','','picture-retell-art');art.style.aspectRatio=`${w}/${h}`;
      const img=node('img');img.src=url;img.alt=`Tranh ${i+1} trong truyện ${view.lesson.title}`;
      img.style.cssText=`width:${sheetWidth/w*100}%;max-width:none;left:${-x/w*100}%;top:${-y/h*100}%;`;
      art.append(img);card.append(art,node('span',String(i+1),'picture-retell-number'));pictureBoard.append(card);
      const dialog=node('dialog','','picture-retell-zoom'),close=button('Đóng tranh',()=>dialog.close(),true);
      const large=art.cloneNode(true);dialog.append(close,large);pictureBoard.append(dialog);
    });
  }

  function renderConversation(){
    conversation.replaceChildren();
    for(const turn of chatHistory.values())conversation.append(node('p',turn.question,'minny-transcript__reply'),node('p','Con: '+turn.transcript,'minny-transcript__kid-chip'),node('p','Minny: '+turn.reply,'minny-transcript__reply'));
    if(!view.session.feedbackPending)conversation.append(prompt);
    conversation.scrollTop=conversation.scrollHeight;
  }
  const setCue=(state,text)=>{root.dataset.voiceState=state;cue.textContent=text;};
  const focusActivity=()=> (view?.policy.interview?$('book-reader-workspace'):panel).scrollIntoView({behavior:'instant',block:'start'});
  const narration = node('div', '', 'story-mission-narration');narration.hidden=true;
  const missingNarration = node('p', 'Truyện này chưa có bản thu âm. Con vẫn có thể đọc truyện.', 'story-mission-note');
  narration.append(missingNarration);
  $('book-reader-page-shell').append(narration);
  const hideNarration=()=>{audio?.pause();narration.hidden=true;};
  const releaseReply=()=>{promptPlayback?.stop();replyAudio?.pause();if(replyUrl)URL.revokeObjectURL(replyUrl);replyUrl=null;};
  const stop = () => { audio?.pause(); releaseReply(); controller?.abort();microphone?.cancel();microphone=null;clearTimeout(captureTimer);clearTimeout(microphoneIdleTimer); };
  const assignmentBusy=()=>busy||!!capture||!!voicePending||!!pending||view?.session.feedbackPending===true;
  mountLessonHelp({container:root,isBusy:assignmentBusy,beforeLeave:stop});
  const openAnother=createLessonAssignmentAction({code:params.get('code'),packId:params.get('pack_id'),origin:location.origin,isBusy:assignmentBusy,beforeLeave:stop});
  function finishActions() {
    const home=node('a','Xong hôm nay','r2l-primary');
    home.href='/read2lead/?'+new URLSearchParams({code:params.get('code')||'',done:'1'});home.onclick=stop;
    const another=button('Đọc thêm truyện',async()=>{
      another.disabled=true;
      try{await openAnother();}catch(error){notice.textContent=error.message;another.disabled=false;}
    },true);
    controls.append(home,another);
  }
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) {stop();if(capture){capture=null;busy=false;render();notice.textContent='Đã dừng micro. Con có thể thử nói lại.';}} });
  for (const id of ['book-reader-progress-bar','book-reader-karaoke-text','book-reader-vocab','book-reader-translate','book-reader-listen-again']) $(id)?.classList.add('hidden');
  const showIllustrations=createStoryIllustrationReader({image:$('book-reader-img'),previous:$('book-reader-art-prev'),next:$('book-reader-art-next'),counter:$('book-reader-page-counter'),badge:$('book-reader-page-badge'),credit:$('book-reader-art-credit')});
  root.querySelector('.r2l-book-karaoke')?.classList.add('hidden');
  root.querySelector('.r2l-book-shortcuts')?.classList.add('hidden');
  const stepper = $('book-reader-stage-stepper'); stepper.setAttribute('aria-label','Tiến trình nhiệm vụ');
  const trail=$('book-reader-trail');
  let progressMode;
  function configureProgress(interview) {
    if(progressMode===interview)return;progressMode=interview;
    const labels=interview?(view.policy.pictureRetell?['Đọc','Nói với Minny · 50 💎','Kể qua tranh · 200 💎']:['Đọc','Nói với Minny','50 💎']):['Đọc','Hiểu','Kể lại','Phần thưởng'];
    const stages=interview?['read','understand',view.policy.pictureRetell?'picture_retell':'reward']:STORY_STAGES;
    trail.setAttribute('aria-label',interview?'Ba chặng của bài đọc':'Bốn chặng của nhiệm vụ');
    trail.replaceChildren(...labels.map((label,i)=>{
    const li=node('li','','r2l-book-trail__node'),item=node('div','','r2l-book-trail__btn');
    item.append(node('span',String(i+1),'r2l-book-trail__icon'),node('span',label,'r2l-book-trail__label'));
    li.append(item);return li;
    }));
    stepper.replaceChildren(...labels.map((label, i) => { const s = node('span', `${i + 1}. ${label}`, 'r2l-book-stepper__step'); s.dataset.missionStep = stages[i]; return s; }));
  }
  const reading = $('book-reader-page-text'); reading.classList.add('story-mission-reading');
  const review = node('button','Xem lại truyện','r2l-secondary');
  review.type='button'; review.onclick=()=>view.session.stage==='recall'?event({type:'reveal_recall_text'})
    :view.session.stage==='retell'&&view.session.retellSupport!=='text'?event({type:'reveal_retell_text'})
    :reading.scrollIntoView({behavior:'auto',block:'start'});
  function arrangeInterview(){
    if(layoutReady)return;layoutReady=true;
    const book=node('section','','story-mission-book');book.tabIndex=0;book.setAttribute('aria-label','Truyện để đọc cùng Minny');
    const workspace=$('book-reader-workspace');workspace.prepend(pictureBoard,book);
    book.append(reading.closest('.r2l-book-story-card'),$('book-reader-page-shell'));
    const chat=panel.closest('.r2l-book-panel');chat.classList.add('story-mission-chat');chat.tabIndex=0;chat.setAttribute('aria-label','Nói chuyện với Minny');
    workspace.before(stepper);
  }
  const retry = node('button','Thử lưu lại','r2l-primary'); retry.type='button';
  retry.onclick=()=>pending ? send(pending) : start();
  async function api(input, query='') {
    const requestController = new AbortController();controller=requestController; const timer = setTimeout(()=>requestController.abort(),15000);
    try {
      const response = await fetch(endpoint+query,{credentials:'same-origin',signal:requestController.signal,
        headers:{...accountHeaders,...(input?{'Content-Type':'application/json'}:{})},
        ...(input?{method:'POST',body:JSON.stringify(input)}:{})});
      if(response.status===401)throw Error('login');
      const data = await response.json();
      if(!response.ok)throw Error(data.code||'unavailable');
      return data;
    } finally { clearTimeout(timer); }
  }
  function failure(error) {
    hideNarration();
    retry.disabled=false;
    notice.textContent=error.message==='login'?'Phiên riêng tư đã hết. Đăng nhập lại để tiếp tục.':'Chưa lưu được. Tiến trình đã lưu vẫn còn; con có thể thử lại.';
    controls.replaceChildren(retry);
    if(error.message==='login') { const a=node('a','Đăng nhập lại','r2l-secondary');a.href='/private-rehearsal/login';controls.prepend(a); }
  }
  async function send(input) {
    if(busy)return;busy=true;pending=input;hideNarration();releaseReply();
    for(const b of controls.querySelectorAll('button'))b.disabled=true;
    try {
      const wasComplete=view?.session.complete;
      view=await api(input);
      if(!wasComplete&&view.session.complete&&!view.session.alreadyAwarded&&view.session.awarded?.diamonds>0)freshInterviewAward=true;
      pending=null; render();
    }
    catch(error) {
      if(error.message==='revision_conflict') {
        try { view=await api(null,'?sessionId='+encodeURIComponent(view.session.id));pending=null;render();notice.textContent='Đã mở tiến trình mới nhất của con.'; }
        catch(e){failure(e);}
      } else failure(error);
    } finally { busy=false; }
  }
  const event = payload => send({action:'event',sessionId:view.session.id,requestId:crypto.randomUUID(),revision:view.session.revision,event:payload});
  function button(text, action, secondary=false) { const b=node('button',text,secondary?'r2l-secondary':'r2l-primary');if(text.startsWith('🔊'))b.classList.add('minny-play-chip'); b.type='button';b.onclick=action;return b; }
  function microphoneButton(label,action,recording=false){
    const b=button('',action);b.classList.add('spk-rec-btn');if(recording)b.classList.add('is-recording');
    b.setAttribute('aria-label',label);b.title=label;
    const icon=node('span','','spk-rec-btn__icon');icon.setAttribute('aria-hidden','true');b.append(icon);return b;
  }
  async function voiceRequest(input,query='') {
    const requestController=new AbortController();controller=requestController;const timer=setTimeout(()=>requestController.abort(),100000);
    try {
      const response=await fetch('/api/read2lead-story-turn'+query,{credentials:'same-origin',signal:requestController.signal,headers:accountHeaders,...(input?{method:'POST',body:input}:{})});
      if(response.status===401)throw Error('login');
      const data=await response.json();if(!response.ok)throw Error(data.code||'voice_unavailable');return data;
    } finally {clearTimeout(timer);}
  }
  const savedVoiceQuery=id=>'?sessionId='+encodeURIComponent(view.session.id)+'&requestId='+encodeURIComponent(id);
  function receivedVoice(result) {
    if(result.view.session.pictureRetell?.status==='complete'&&!result.view.session.pictureRetell.alreadyAwarded&&result.view.session.pictureRetell.award?.diamonds>0)freshPictureAward=true;
    view=result.view;voiceResult=result.voice;voicePending=null;render();
  }
  async function uploadVoice() {
    if(busy||!voicePending)return;busy=true;hideNarration();
    setCue('waiting',pictureMode()?'Đang xem phần kể của con…':'Minny đang xem câu trả lời…');
    controls.replaceChildren(node('p','Con chờ một chút nhé. Không cần bấm thêm.','story-mission-note'));
    if(view.policy.interview)focusActivity();
    try {receivedVoice(await voiceRequest(voicePending));}
    catch(error) {
      // The server may have saved a reply even if its HTTP response was lost.
      try {receivedVoice(await voiceRequest(null,savedVoiceQuery(voicePending.get('requestId'))));}
      catch {
        setCue('retry',error.message==='login'?'Mở lại phiên đọc để tiếp tục.':'Con thử lại để nhận kết quả nhé.');
        notice.textContent=error.message==='login'?'Phiên riêng tư đã hết. Đăng nhập lại để tiếp tục.':error.message===VOICE_POOL_REST_CODE?VOICE_POOL_REST_VI:'Chưa nhận được kết quả. Phần đã lưu vẫn được giữ nguyên.';
        controls.replaceChildren(button('Thử nhận lại câu trả lời',uploadVoice),button('Mở lại tiến trình đã lưu',()=>{voicePending=null;start();},true));
        if(error.message==='login'){const a=node('a','Đăng nhập lại','r2l-secondary');a.href='/private-rehearsal/login';controls.prepend(a);}
      }
    } finally {busy=false;}
  }
  async function recordVoice() {
    if(busy)return;busy=true;root.dataset.finished='false';hideNarration();releaseReply();
    setCue('opening','🎙 Đang mở micro…');
    controls.replaceChildren(node('p','Nếu có thông báo, con chọn Cho phép micro.','story-mission-note'));
    clearTimeout(microphoneIdleTimer);
    const current=microphone||createStoryCapture(window.R2LRecorder,{keepWarm:true});microphone=current;capture=current;let finishing=false;
    const cancel=()=>{current.cancel();microphone=null;clearTimeout(captureTimer);capture=null;busy=false;render();};
    controls.append(button('Huỷ',cancel,true));
    try {
      const finish=async()=>{
        if(finishing||capture!==current)return;finishing=true;
        clearTimeout(captureTimer);controls.replaceChildren(node('p','Đang lưu phần nói…'));
        try {
          const blob=await current.stop();if(!blob)return;
          if(!blob.size||blob.size>4_000_000)throw Error('invalid_audio');
          voicePending=new FormData();voicePending.set('audio',blob,'speech');voicePending.set('sessionId',view.session.id);
          voicePending.set('revision',String(view.session.revision));voicePending.set('requestId',crypto.randomUUID());
          capture=null;microphoneIdleTimer=setTimeout(()=>{current.cancel();if(microphone===current)microphone=null;},60000);busy=false;await uploadVoice();
        } catch {cancel();notice.textContent='Chưa lưu được âm thanh. Con thử nói lại nhé.';}
      };
      if(!await current.start({onSpeechEnd:pictureMode()?()=>{}:finish}))return;
      setCue('recording','Minny đang nghe con…');
      controls.replaceChildren(node('p',pictureMode()?`Con kể cả câu chuyện theo ${view.policy.pictureRetell.frames.length} tranh. Con có thể dừng để nghĩ; bấm Xong khi kể hết. Tối đa 2 phút.`:'Trả lời câu hỏi ở trên. Nói xong, con bấm nút bên dưới hoặc chờ Minny nhận.','story-mission-note'),pictureMode()?button('✓ Xong · Xem kết quả',finish):microphoneButton('✓ Con nói xong rồi',finish,true),node('p',pictureMode()?'Micro đang ghi âm':'Bấm nút vuông khi con nói xong','story-mission-mic-caption'),button('Huỷ · Chưa gửi',cancel,true));
      if(view.policy.interview)focusActivity();
      captureTimer=setTimeout(finish,pictureMode()?120000:60000);
    } catch(error) {if(capture===current){
      cancel();
      notice.textContent=error?.name==='NotFoundError'
        ?'Không tìm thấy micro. Con nhờ người lớn kết nối micro rồi thử lại nhé.'
        :error?.name==='NotAllowedError'
          ?'Micro chưa được cho phép. Con nhờ người lớn bật quyền micro rồi thử lại nhé.'
          :'Chưa mở được micro. Con nhờ người lớn kiểm tra rồi thử lại nhé.';
    }}
  }
  function showVoiceFeedback() {
    const saved=view.session.lastVoice;
    setCue('feedback',saved.assessed?'💬 Nghe lời nhắn của Minny':'💬 Mình thử nói lại nhé');
    if(view.policy.interview){
      chatHistory.set(saved.requestId,{question:view.lesson.question?.prompt||'',transcript:saved.transcript,reply:saved.reply});
      if(chatHistory.size>30)chatHistory.delete(chatHistory.keys().next().value);
      renderConversation();
    }else controls.append(node('p','Con nói: '+saved.transcript),node('p','Minny: '+saved.reply));
    if(!saved.assessed)controls.append(node('p','Phần nói này chưa được đánh giá. Con có thể thử lại sau khi nghe Minny.','story-mission-note'));
    const player=node('audio');replyAudio=player;player.controls=false;player.hidden=true;player.setAttribute('aria-label','Câu trả lời của Minny');
    const load=async()=>{
      try {
        const result=voiceResult||(await voiceRequest(null,savedVoiceQuery(saved.requestId))).voice;
        if(!view.session.feedbackPending||view.session.lastVoice.requestId!==saved.requestId||replyAudio!==player)return;
        voiceResult=result;audio?.pause();releaseReply();
        const bytes=Uint8Array.from(atob(result.audio.audio_b64),c=>c.charCodeAt(0));
        replyUrl=URL.createObjectURL(new Blob([bytes],{type:result.audio.content_type}));player.src=replyUrl;
        await player.play();
      } catch {notice.textContent='Con có thể bấm nghe lại hoặc tiếp tục với lời Minny trên màn hình.';}
    };
    const nextLabel=!view.policy.interview?'Tiếp tục →':!saved.assessed?'🎙 Thử trả lời lại':view.session.answered+1>=view.session.totalQuestions?'Xong phần câu hỏi →':'Câu hỏi tiếp theo →';
    controls.append(player,button(nextLabel,()=>{replyAudio?.pause();voiceResult=null;event({type:'continue_voice'});}),
      button('🔊 Nghe lại lời Minny',load,true),
      button('Minny nghe nhầm · Con muốn nói lại',()=>{releaseReply();voiceResult=null;chatHistory.delete(saved.requestId);event({type:'reject_voice'});},true));
    if(voiceResult||view.policy.interview)void load();
  }
  function showSpokenPrompt() {
    const sessionId=view.session.id,revision=view.session.revision;
    const player=node('audio');player.controls=false;player.hidden=true;
    player.setAttribute('aria-label','Câu hỏi của Minny');
    const speak=controls.querySelector('.r2l-primary');
    const ready=()=>{halt.hidden=true;if(speak)speak.disabled=false;setCue('ready','🎙 Đến lượt con · Bấm micro để trả lời');};
    player.addEventListener('play',()=>{audio?.pause();if(speak)speak.disabled=true;setCue('listening','👂 Con nghe Minny hỏi nhé');});
    player.addEventListener('ended',ready);
    player.addEventListener('error',()=>{ready();notice.textContent='Chưa phát được câu hỏi. Con thử bấm nghe lại nhé.';});
    const listen=button('Nghe câu hỏi 🔊',()=>{audio?.pause();void playback.play();},true);listen.classList.add('minny-play-chip');
    const halt=button('Dừng nghe · Con sẵn sàng trả lời',()=>{playback.stop();ready();},true);halt.hidden=true;
    const playback=createStoryPromptPlayback({player,
      request:async signal=>{
        const response=await fetch('/api/read2lead-story-turn',{method:'POST',credentials:'same-origin',signal,
          headers:{...accountHeaders,'Content-Type':'application/json'},
          body:JSON.stringify({action:'prompt',sessionId,revision,requestId:crypto.randomUUID()})});
        const value=await response.json();if(!response.ok)throw Error(value.code||'voice_unavailable');return value;
      },
      onLoading:loading=>{listen.disabled=loading;listen.textContent='🔊 Nghe lại câu hỏi';halt.hidden=!loading&&player.hidden;if(loading){if(speak)speak.disabled=true;setCue('loading','👂 Minny đang chuẩn bị câu hỏi…');}},
      onError:error=>{ready();notice.textContent=error?.message===VOICE_POOL_REST_CODE?VOICE_POOL_REST_VI:'Con bấm Nghe lại câu hỏi, hoặc đọc câu hỏi ở trên rồi trả lời nhé.';},
    });
    promptPlayback=playback;
    controls.append(listen,halt,player);
    if(view.policy.interview&&view.policy.providerEnabled)void playback.play();
  }
  function render() {
    releaseReply();
    review.disabled=false;
    if(view.schemaVersion!==STORY_MISSION_VERSION)throw Error('unsupported_contract');
    const {lesson:l,session:s}=view;
    const interview=!!view.policy.interview;
    configureProgress(interview);
    root.dataset.interview=String(interview);root.dataset.stage=s.stage;root.dataset.finished='false';
    if(interview)arrangeInterview();
    hero.hidden=!interview||pictureMode();conversation.hidden=!interview||pictureMode();
    pictureBoard.hidden=!pictureMode();if(pictureMode())showPictureBoard(view.policy.pictureRetell);
    if(s.stage==='read')chatHistory.clear();
    progress.hidden=!interview||s.stage!=='understand';
    progress.textContent=`Câu ${Math.min(s.answered+1,s.totalQuestions)} / ${s.totalQuestions} · Hoàn thành để nhận 50 💎`;
    prompt.hidden=!interview||s.stage!=='understand';prompt.textContent=l.question?.prompt||'';
    if(interview)renderConversation();
    setCue(s.stage,s.stage==='read'?'Nghe và đọc cùng câu chuyện.':s.stage==='reward'?(view.policy.pictureRetell&&s.pictureRetell?.status!=='complete'?'Con đã xong phần câu hỏi. Mình kể qua tranh nhé.':'Con đã hoàn thành bài đọc!'):'Chạm micro rồi trả lời nhé.');
    if(s.complete) {
      const rewardKey=`${s.id}:${s.pictureRetell?.status==='complete'?'picture-retell':s.recall?.status||'mission'}`;
      if(rewardKey!==notifiedReward) {
        notifiedReward=rewardKey;
        // Identity only: the header fetches committed progress, never adds client rewards.
        window.dispatchEvent(new CustomEvent('read2lead:progress-changed',{
          detail:{code:(params.get('code')||'').trim().toUpperCase()},
        }));
      }
    }
    if(view.learner?.name) {
      const identity=$('identity-student-name');identity.textContent=view.learner.name;
      const heading=identity.parentElement;
      if(heading.firstChild?.nodeType===Node.TEXT_NODE)heading.firstChild.textContent='Cùng đọc truyện, ';
      const description=heading.nextElementSibling;if(description)description.textContent=interview?(view.policy.pictureRetell?'Đọc truyện → Nói với Minny · 50 💎 → Kể qua tranh · 200 💎':'Đọc truyện → Trả lời 12 câu hỏi của Minny → Nhận 50 kim cương.'):'Đọc → Hiểu → Kể lại → Phần thưởng.';
    }
    const currentUrl=new URL(location.href);currentUrl.searchParams.set('session',s.id);history.replaceState(null,'',currentUrl);
    $('loading-card').classList.add('hidden');$('error-card').classList.add('hidden');
    $('lesson-shell').classList.remove('hidden');root.classList.remove('hidden');
    $('book-reader-title').textContent=l.title;
    const testProgress=view.policy.testProgressOnly!==false;
    $('book-reader-trail-meta').textContent=`${l.level} · One Story a Day`;
    $('book-reader-attribution-content').textContent=l.attribution;
    showIllustrations(l);
    if(pictureMode())$('book-reader-page-counter').textContent=`${view.policy.pictureRetell.frames.length} tranh · Kể theo thứ tự`;
    reading.replaceChildren(...l.sentences.map(s=>node('p',s.text)));
    const hiddenText=pictureMode()||(s.stage==='recall'&&s.recall.support!=='text')||(s.stage==='retell'&&s.retellSupport==='none');
    reading.closest('.r2l-book-story-card')?.classList.toggle('hidden',hiddenText);
    for(const sNode of stepper.children) { if(sNode.dataset.missionStep===s.stage)sNode.setAttribute('aria-current','step');else sNode.removeAttribute('aria-current'); }
    const stages=interview?['read','understand',view.policy.pictureRetell?'picture_retell':'reward']:STORY_STAGES;
    const stageIndex=s.stage==='recall'?3:s.stage==='reward'&&view.policy.pictureRetell?2:stages.indexOf(s.stage);
    [...trail.children].forEach((item,i)=>{item.dataset.state=i===stageIndex?'active':i<stageIndex?'visited':'pending';if(i===stageIndex)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
    $('progress-part-label').textContent=s.stage==='recall'?'Thử thách nhớ lại':`Chặng ${stageIndex+1}/${stages.length}`;
    $('sfx-toggle').hidden=true;
    panel.insertBefore(notice,controls);notice.textContent='';controls.replaceChildren();
    const minny=node('img');minny.src='/assets/minny/minny_idle.png';minny.alt='Minny';minny.className='story-mission-minny';
    if(!audio && l.audio.url) {
      audio=node('audio');audio.controls=true;audio.preload='metadata';audio.src=l.audio.url;
      audio.setAttribute('aria-label','Bản thu gốc của truyện');narration.append(audio);
      // Playback is real; listening is support, never automatic reading mastery.
      audio.addEventListener('play',async()=>{
        if(busy||pending||capture||voicePending||view.session.feedbackPending||view.session.stage==='recall'||
          (view.session.stage==='retell'&&view.session.retellSupport==='none')){audio.pause();return;}
        releaseReply();
        if(!view.session.audioUsed&&!busy){
          busy=true;
          for(const b of controls.querySelectorAll('button'))b.disabled=true;
          try { const updated=await api({action:'event',sessionId:view.session.id,requestId:crypto.randomUUID(),revision:view.session.revision,event:{type:'audio_started'}});view=updated; }
          catch {hideNarration();narration.after(notice);notice.textContent='Chưa lưu được phần nghe. Con tải lại trang để tiếp tục nhé.';}
          finally {busy=false;for(const b of controls.querySelectorAll('button'))b.disabled=false;}
        }
      });
      audio.addEventListener('error',()=>{narration.after(notice);notice.textContent='Chưa phát được bản thu. Con vẫn có thể đọc truyện.';});
    }
    missingNarration.hidden=!!l.audio.url;
    if(s.stage==='recall'||hiddenText||s.feedbackPending||(interview&&s.stage==='understand'))hideNarration();
    else narration.hidden=false;
    if(pictureMode()) {
      hideNarration();
      const savedResult=s.pictureRetell;
      root.dataset.finished=String(savedResult?.status==='complete');
      if(savedResult?.status==='complete'){
        controls.append(node('h3','Con đã hoàn thành câu chuyện!','story-mission-prompt'),
          node('p','✓ 12 câu hỏi · ✓ Kể lại qua tranh','story-mission-status'),
          node('p',savedResult.alreadyAwarded||!freshPictureAward?'200 💎 cho phần kể này đã được cộng trước đó.':'Đã cộng 200 💎 cho phần kể của con.','story-mission-status'));
        finishActions();
        const details=node('details','','story-finish-details');details.append(node('summary','Xem lại kết quả'));
        details.append(node('p',`Ý chính: ${savedResult.matched}/${savedResult.total}`));
        const meanings=node('ul','','picture-retell-meanings');
        for(const m of savedResult.meanings)meanings.append(node('li',`${m.met?'✓':'○'} ${m.label}`));
        details.append(meanings,node('p',pronunciationNote(savedResult.pronunciation),'story-mission-note'));
        if(view.policy.providerEnabled)details.append(button('Ghi âm luyện lại · Không cộng thêm thưởng',recordVoice,true));
        controls.append(details);focusActivity();return;
      }
      controls.append(node('h3','Nhìn tranh · Kể lại truyện','story-mission-prompt'),
        node('p',`Con nhìn ${view.policy.pictureRetell.frames.length} tranh theo thứ tự và kể cả câu chuyện bằng tiếng Anh. Bấm vào tranh để xem lớn hơn.`,'story-mission-note'));
      const result=s.pictureRetell;
      if(result){
        const done=result.status==='complete';
        controls.append(node('h3',done?'Con đã kể được câu chuyện!':result.status==='unassessed'?'Chưa nghe rõ phần kể của con':'Con đã nhớ được một phần câu chuyện','story-mission-prompt'));
        if(result.status!=='unassessed'){
          controls.append(node('p',`Ý chính: ${result.matched}/${result.total}`,'story-mission-status'));
          const list=node('ul','','picture-retell-meanings');
          for(const m of result.meanings)list.append(node('li',`${m.met?'✓':'○'} ${m.label}`));controls.append(list);
          controls.append(node('p',pronunciationNote(result.pronunciation),'story-mission-note'));
        }
        controls.append(node('p',done?(result.alreadyAwarded||!freshPictureAward?'200 💎 cho phần kể này đã được cộng trước đó.':'Đã cộng 200 💎 cho phần kể của con.'):'Con có thể ghi âm lại khi sẵn sàng.','story-mission-status'));
        if(done){controls.append(node('p','✓ 12 câu hỏi · ✓ Kể lại qua tranh','story-mission-status'));finishActions();}
      }
      if(view.policy.providerEnabled)controls.append(button(result?.status==='complete'?'Ghi âm luyện lại · Không cộng thêm thưởng':result?'Ghi âm lại':'🎙 Ghi âm kể chuyện',recordVoice,result?.status==='complete'));
      else controls.append(node('p','Phần ghi âm chưa sẵn sàng. Tiến trình của con vẫn được giữ.','story-mission-note'));
      controls.append(node('p','Kể bằng lời của con · Tối đa 2 phút · 200 💎 khi kể được các ý chính','story-mission-note'));
      focusActivity();return;
    }
    if(s.feedbackPending) {showVoiceFeedback();if(interview)focusActivity();return;}
    if(s.stage==='read') {
      controls.append(node('h3','Đọc xong, con cùng Minny trả lời câu hỏi nhé.','story-mission-prompt'));
      if(l.vocabulary.length) {const d=node('details'),summary=node('summary','Từ khó');d.append(summary,...l.vocabulary.map(v=>node('p',`${v.word} — ${v.meaning}`)));controls.append(d);}
      controls.append(button(interview?'🎙 Con đã đọc xong · Nói với Minny':'Con đã đọc · Khám phá câu hỏi →',()=>event({type:'read_complete'})));
      if(interview)controls.append(node('p','Nghe Minny hỏi về truyện, trả lời bằng giọng nói và nhận 50 💎 sau 12 câu.','story-mission-note'));
    } else if(s.stage==='understand') {
      const q=l.question;
      if(!interview)controls.append(minny);
      if(!interview)controls.append(node('p',`Câu hỏi ${s.answered+1}/${s.totalQuestions}`,'story-mission-note'),node('h3',q.prompt,'story-mission-prompt'));
      notice.textContent=q.retry?'Con xem lại chi tiết trong truyện rồi thử thêm một lần nhé.':s.feedback?.result==='demonstrated'?'Con đã tìm được ý phù hợp với câu hỏi trước.':'';
      controls.append(node('p',interview?(view.policy.providerEnabled?'Con nghe câu hỏi rồi bấm micro để trả lời.':'Minny chưa sẵn sàng. Tiến trình của con vẫn được giữ.'):view.policy.providerEnabled?'Con có thể nói với Minny hoặc chọn câu trả lời.':testProgress?'Con có thể chọn câu trả lời. Phần trò chuyện bằng giọng nói chưa mở trong bản riêng tư này.':'Con có thể chọn câu trả lời. Phần trò chuyện bằng giọng nói chưa sẵn sàng.','story-mission-note'));
      if(view.policy.providerEnabled)controls.append(microphoneButton('🎙 Bấm để trả lời',recordVoice),node('p','Nhấn để nói','story-mission-mic-caption'));
      if(!interview)q.options.forEach((text,i)=>controls.append(button(text,()=>event({type:'answer',taskId:q.id,optionIndex:i}),true)));
      if(!interview)controls.append(review);
      if(!interview)controls.append(button('Để câu này luyện sau',()=>event({type:'skip_question',taskId:q.id}),true));
    } else if(s.stage==='retell') {
      controls.append(minny,node('h3',l.retellPrompt,'story-mission-prompt'),node('p',view.policy.providerEnabled?'Con kể lại bằng lời của mình. Minny sẽ nghe và giúp con luyện tiếp.':'Con thử kể lại bằng lời của mình. Minny chưa thể nghe và phản hồi trong bản này; phần kể lại sẽ chưa được đánh giá.','story-mission-note'),review,
        button('Lưu để luyện nói sau',()=>event({type:'retell_unassessed'}),true));
      controls.append(node('p',s.retellSupport==='text'?'Con đã mở lại truyện. Minny ghi nhận lượt kể này có trợ giúp.':'Con nhìn tranh và kể bằng lời của mình. Con có thể bấm “Xem lại truyện” nếu cần giúp.','story-mission-note'));
      if(view.policy.providerEnabled)controls.prepend(button('Kể cho Minny 🎙',recordVoice));
    } else if(s.stage==='recall') {
      controls.append(minny,node('h3',l.retellPrompt,'story-mission-prompt'),
        node('p',s.recall.support==='text'?'Con đã mở lại truyện. Lượt này là luyện tập, không cộng thưởng nhớ lại.':'Con nhìn tranh và kể lại những điều con còn nhớ. Chưa cần mở lại lời truyện.','story-mission-note'));
      if(s.recall.status==='needs_practice')controls.append(node('p','Con thử nhớ thêm một chi tiết rồi kể lại nhé.','story-mission-status'));
      if(view.policy.providerEnabled)controls.append(button('Kể điều con nhớ 🎙',recordVoice));
      else controls.append(node('p','Minny chưa thể nghe trong bản riêng tư này. Thử thách chưa được chấm.','story-mission-note'));
      if(s.recall.support!=='text')controls.append(button('Mở lại truyện để luyện tập',()=>event({type:'reveal_recall_text'}),true));
      controls.append(button('Quay lại phần thưởng',()=>event({type:'cancel_recall'}),true));
    } else if(interview) {
      if(s.complete&&view.policy.pictureRetell&&s.pictureRetell?.status!=='complete')controls.append(button('Kể chuyện qua tranh · 200 💎',()=>event({type:'start_picture_retell'})));
      controls.append(node('h3',s.complete?'Con đã trả lời đủ 12 câu hỏi!':'Đã lưu phần luyện tập','story-mission-prompt'),
        node('p',s.complete?(s.alreadyAwarded||!freshInterviewAward?'50 💎 cho truyện này đã được cộng trước đó.':`Đã cộng ${s.awarded.diamonds} 💎${testProgress?' vào tiến trình thử nghiệm':''}.`):'Chưa hoàn thành đủ 12 câu hỏi. Tiến trình của con vẫn được giữ.','story-mission-status'),
        button('Luyện nói lại · Không cộng thưởng lần nữa',()=>event({type:'retry_mission'}),true));
      if(s.complete&&(!view.policy.pictureRetell||s.pictureRetell?.status==='complete'))finishActions();
    } else {
      controls.append(minny,node('h3',s.complete?(testProgress?'Đã hoàn thành nhiệm vụ thử nghiệm':'Đã hoàn thành nhiệm vụ'):'Đã lưu phần luyện tập','story-mission-prompt'),node('p',s.complete?(s.alreadyAwarded?'Phần thưởng cho truyện này đã được ghi trước đó.':testProgress?`Đã ghi ${s.awarded.diamonds} 💎 và ${s.awarded.xp} XP vào tiến trình thử nghiệm.`:`Đã ghi ${s.awarded.diamonds.toLocaleString('vi-VN')} 💎 và ${s.awarded.xp} XP vào tiến trình của con.`):'Chưa đủ bằng chứng hoàn thành nhiệm vụ. Chưa cộng kim cương.','story-mission-status'),
        node('p','Khi nhiệm vụ đủ bằng chứng: B · 400 💎, A · 800 💎, S · 1.000 💎.','story-mission-note'),review,
        button('Luyện lại nhiệm vụ',()=>event({type:'retry_mission'}),true));
      if(s.complete&&s.recall?.dueAt) {
        if(['complete','already_awarded'].includes(s.recall.status))controls.append(node('p','Đã ghi phần thưởng nhớ lại: 200 💎, không thêm XP.','story-mission-status'));
        else if(Date.now()>=s.recall.dueAt)controls.append(button('Thử thách nhớ lại · 200 💎',()=>event({type:'start_recall'})));
        else controls.append(node('p','Thử thách nhớ lại mở từ '+new Date(s.recall.dueAt).toLocaleString('vi-VN')+'.','story-mission-note'));
      }
    }
    if(['understand','retell','recall'].includes(s.stage))showSpokenPrompt();
    if(interview&&s.stage!=='read')focusActivity();
  }
  async function start() {
    try {
      const savedSession=new URL(location.href).searchParams.get('session');
      if(savedSession) { view=await api(null,'?sessionId='+encodeURIComponent(savedSession));render();return; }
      if(params.get('pack_id')) { view=await api({action:'open_assigned',packId:params.get('pack_id')});render();return; }
      const {lessons}=await api();
      const selected=params.get('story');
      const l=lessons.find(l=>l.id===selected)||(!selected&&lessons[0]);
      if(!l)throw Error('content_unavailable');
      view=await api({action:'open',storyId:l.id,contentVersion:l.version});render();
    } catch(error) {
      $('loading-card').classList.add('hidden');$('lesson-shell').classList.remove('hidden');root.classList.remove('hidden');failure(error);
    }
  }
  await start();
}
