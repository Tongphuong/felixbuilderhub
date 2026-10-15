import {azureSpeechConfigured,azureUsageKey,AZURE_PA_MONTHLY_FREE_SECONDS,
  assessPronunciationWithAzure,splitWavIntoChunks,mergeAzureChunkResults,mapAzureOpenResult} from '../../api/_azure-pronunciation.js';
import {validateStoryJudgment} from './story-rubric.mjs';
import {screenStoryTranscript} from './story-transcript-screen.mjs';

/** Same free-tier meter as SpeakUp. Reserve all audio BEFORE starting, and keep
 * the reservation on failure. A partial Azure result never grades a whole clip. */
export function createPicturePronunciation({env,fetchFn=fetch}) {
  return async audio=>{
    if(!azureSpeechConfigured(env)||!env.READ2LEAD_CODES)return null;
    try {
      const chunks=splitWavIntoChunks(await audio.arrayBuffer(),30);
      if(!chunks?.length)return null;
      const seconds=chunks.reduce((sum,c)=>sum+c.sampledSeconds,0),key=azureUsageKey();
      const raw=await env.READ2LEAD_CODES.get(key,{type:'json'});
      const used=raw===null?0:Number(raw);
      if(!Number.isFinite(used)||used<0||used+seconds>AZURE_PA_MONTHLY_FREE_SECONDS)return null;
      // Unlike the legacy best-effort bump, a failed reservation forbids calls.
      await env.READ2LEAD_CODES.put(key,JSON.stringify(used+seconds),{expirationTtl:40*24*3600});
      const results=[];
      for(const chunk of chunks) {
        const best=await assessPronunciationWithAzure({env,audioBlob:chunk.wav,referenceText:'',fetchFn});
        if(!best?.Display?.trim()||![best.AccuracyScore,best.FluencyScore].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100))return null;
        results.push({best,sampledSeconds:chunk.sampledSeconds});
      }
      const result=mapAzureOpenResult(mergeAzureChunkResults(results));
      if(!result.transcript||![result.accuracy_percent,result.fluency_percent].every(n=>Number.isFinite(n)&&n>=0&&n<=100))return null;
      return {transcript:result.transcript,pronunciation:{accuracy:result.accuracy_percent,fluency:result.fluency_percent,seconds}};
    } catch {return null;}
  };
}

/** No generated reply, safety-review-of-reply or TTS: only a validated judgment.
 * UI uses authored labels, so untrusted provider prose is never shown. */
export async function assessPictureRetell({provider,activation,trial,lesson,task,audio,phase}) {
  const pcm=new DataView(await audio.arrayBuffer());let energy=0;
  for(let i=44;i<pcm.byteLength;i+=2)energy+=pcm.getInt16(i,true)**2;
  const silent=Math.sqrt(energy/Math.max(1,(pcm.byteLength-44)/2))<20;
  if(silent)return {transcript:'',reply:'',audio:null,judgment:{reliability:'uncertain',matchedCriteria:[],replySupport:'none'},pronunciation:null,assessment:'unassessed',practiceOnly:true,rewardsAwarded:false};
  let acoustic=null;
  if(provider.picturePronunciation)try{acoustic=await phase(()=>provider.picturePronunciation(audio),65000);}catch(error){if(error.message==='story_voice_interrupted')throw error;}
  const transcript=String(acoustic?.transcript??await phase(()=>provider.transcribe(audio))).trim();
  if(transcript.length>2000)throw Error('story_transcript_unclear');
  let judgment={reliability:'uncertain',matchedCriteria:[],replySupport:'none'};
  if(transcript&&!screenStoryTranscript(transcript,lesson).flagged&&(activation.assessorValidated===true||(trial&&activation.assessorTrial===true))) {
    judgment=validateStoryJudgment(await phase(signal=>provider.assess({transcript,lesson,task,signal}),30000),task,transcript);
  }
  return {transcript,reply:'',audio:null,judgment,
    pronunciation:acoustic?.pronunciation||null,
    assessment:!trial&&activation.assessorValidated===true&&judgment.reliability==='confirmed'&&(!judgment.intent||judgment.intent==='answer')?'server_validated':'unassessed',
    practiceOnly:true,rewardsAwarded:false};
}
