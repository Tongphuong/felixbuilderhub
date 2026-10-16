import { StorySessionError, storyIdentity, storySessionView } from '../lib/read2lead/story-session.mjs';
import { runStoryVoiceTurn, runStoryPromptAudio } from '../lib/read2lead/story-voice.mjs';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export const storyVoiceEnabled=config=>Boolean(config?.activation?.externalProcessingApproved===true && config.activation.spendingApproved===true && (config.activation.providerVerified===true || (config.practiceTrial===true && config.activation.adultTrialApproved===true)) && config.provider && config.budget);
const publicVoice=({transcript,reply,audio})=>({transcript,reply,audio});
async function voiceBody(request) {
  const contentType=request.headers.get('content-type')||'';
  if(!contentType.startsWith('multipart/form-data;'))throw new StorySessionError('multipart_required',415);
  const reader=request.body?.getReader();if(!reader)throw new StorySessionError('audio_required');
  let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4_010_000){await reader.cancel();throw new StorySessionError('audio_too_large',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  const form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();
  if([...form.keys()].sort().join(',')!=='audio,requestId,revision,sessionId')throw new StorySessionError('invalid_fields');
  const sessionId=storyIdentity(form.get('sessionId')),requestId=storyIdentity(form.get('requestId')),rawRevision=form.get('revision');
  if(typeof rawRevision!=='string'||!/^\d{1,10}$/.test(rawRevision))throw new StorySessionError('invalid_revision');
  const audio=form.get('audio');if(!(audio instanceof Blob))throw new StorySessionError('audio_required');
  const digest=await crypto.subtle.digest('SHA-256',await audio.arrayBuffer());
  const fingerprint=audio.type+':'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return {input:{sessionId,requestId,revision:Number(rawRevision)},audio,fingerprint};
}

/** HTTP glue uses server-owned activation, task, rubric and budget only. */
export function createStoryTurnHandler({store,runtime,origin,authenticate,voiceConfig=null,policyFor=null}) {
  const configFor=pkg=>typeof voiceConfig?.forPackage==='function'?voiceConfig.forPackage(pkg):voiceConfig;
  const pkgFor=state=>{
    const lesson=runtime.catalogue().find(l=>l.id===state.storyId&&l.version===state.contentVersion);
    if(!lesson)throw new StorySessionError('content_unavailable',409);
    return runtime.packageFor(lesson);
  };
  const response=async(pkg,state,result,replayed)=>{
    const view=storySessionView(pkg,state,{voiceEnabled:storyVoiceEnabled(await configFor(pkg))});
    if(policyFor)view.policy={...view.policy,...policyFor(pkg,state)};
    return json({view,voice:publicVoice(result),replayed});
  };
  return async request=>{
    let owner,input,claimed=false,promptClaimed=false;
    try {
      const url=new URL(request.url);
      if(url.origin!==origin||request.headers.get('sec-fetch-site')==='cross-site')return json({code:'origin_refused'},403);
      owner=await authenticate(request);if(!owner)return json({code:'authentication_required'},401);
      if(request.method==='GET') {
        if([...url.searchParams.keys()].sort().join(',')!=='requestId,sessionId')throw new StorySessionError('invalid_query');
        const sessionId=storyIdentity(url.searchParams.get('sessionId')),requestId=storyIdentity(url.searchParams.get('requestId'));
        const state=store.get(owner,sessionId),pkg=await pkgFor(state);
        return response(pkg,store.get(owner,sessionId),store.voiceResult(owner,sessionId,requestId),true);
      }
      if(request.method!=='POST')return json({code:'method_not_allowed'},405);
      if(request.headers.get('origin')!==origin||url.search)return json({code:'origin_refused'},403);
      if((request.headers.get('content-type')||'').split(';')[0]==='application/json') {
        // Only a small fixed command; never accept caller-supplied speech text.
        const reader=request.body?.getReader();let body='',size=0;
        if(!reader)throw new StorySessionError('invalid_fields');
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
          if(size>1024){await reader.cancel();throw new StorySessionError('invalid_fields');}body+=new TextDecoder().decode(value);}
        let command;try{command=JSON.parse(body);}catch{throw new StorySessionError('invalid_fields');}
        if(!command||Object.keys(command).sort().join(',')!=='action,requestId,revision,sessionId'||command.action!=='prompt'||
          !Number.isSafeInteger(command.revision)||command.revision<0)throw new StorySessionError('invalid_fields');
        input={sessionId:storyIdentity(command.sessionId),requestId:storyIdentity(command.requestId),revision:command.revision};
        const state=store.get(owner,input.sessionId),pkg=await pkgFor(state);
        if(await authenticate(request)!==owner)throw new StorySessionError('authentication_required',401);
        const config=await configFor(pkg);
        const claim=store.beginPrompt(owner,pkg.lesson,input,storyVoiceEnabled(config));
        if(claim.replayed)return json({prompt:claim.task.prompt,audio:claim.audio,replayed:true});
        promptClaimed=true;
        const audio=await runStoryPromptAudio({...config,...input,task:claim.task,signal:request.signal});
        if(await authenticate(request)!==owner)throw new StorySessionError('authentication_required',401);
        await pkgFor(state);
        store.finishPrompt(owner,pkg.lesson,input,audio);promptClaimed=false;
        return json({prompt:claim.task.prompt,audio,replayed:false});
      }
      if(!storyVoiceEnabled(voiceConfig))return json({code:'story_voice_not_authorized',assessed:false,rewardsAwarded:false},503);
      const parsed=await voiceBody(request);input=parsed.input;
      if(await authenticate(request)!==owner)return json({code:'authentication_required'},401);
      const state=store.get(owner,input.sessionId),pkg=await pkgFor(state);
      const config=await configFor(pkg);
      if(!storyVoiceEnabled(config))return json({code:'story_voice_not_authorized',assessed:false,rewardsAwarded:false},503);
      const claim=store.beginVoice(owner,pkg.lesson,input,parsed.fingerprint);
      if(claim.replayed)return response(pkg,claim.state,claim.result,true);
      claimed=true;
      const result=await runStoryVoiceTurn({...config,sessionId:input.sessionId,requestId:input.requestId,lesson:pkg.lesson,task:claim.task,audio:parsed.audio,signal:request.signal});
      if(await authenticate(request)!==owner)throw new StorySessionError('authentication_required',401);
      await pkgFor(state);
      const current=store.finishVoice(owner,pkg.lesson,input,result);claimed=false;
      return response(pkg,current,result,false);
    } catch(error) {
      const known=['voice_pool_exhausted','voice_budget_exhausted','voice_turn_limit','voice_budget_month_expired','voice_request_already_claimed'];
      const phase=['transcription','reply','safety','assessment','synthesis','persistence'].includes(error.storyVoicePhase)?error.storyVoicePhase:known.includes(error.message)?'budget':null;
      const reason=['invalid_story_reply','story_model_invalid_json','story_model_unavailable','story_voice_timeout',
        'story_reply_unverified','invalid_semantic_judgment','unsupported_semantic_evidence','unexpected_semantic_evidence',
        'invalid_story_pcm','story_pcm_required','voice_reservation_config_conflict','voice_batch_config_conflict'].includes(error.message)?error.message:null;
      if(claimed)store.failVoice(owner,input.sessionId,input.requestId,{phase});
      if(promptClaimed)store.failPrompt(owner,input);
      return json({code:error instanceof StorySessionError?error.message:known.includes(error.message)?error.message:'voice_unavailable',...(phase?{phase}:{}),...(reason?{reason}:{})},error instanceof StorySessionError?error.status:503);
    }
  };
}
// No credentials/provider choice or deployment activation inferred from code.
export function onRequest(){return json({code:'story_voice_not_authorized',assessed:false,rewardsAwarded:false},503);}
