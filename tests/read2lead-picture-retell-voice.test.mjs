import test from 'node:test';
import assert from 'node:assert/strict';
import {runStoryVoiceTurn} from '../functions/lib/read2lead/story-voice.mjs';
import {createPicturePronunciation} from '../functions/lib/read2lead/picture-retell-voice.mjs';
function wav(seconds=1,silent=false){
  const b=Buffer.alloc(44+32000*seconds);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
  if(!silent)for(let i=44;i<b.length;i+=2)b.writeInt16LE(i%4?1000:-1000,i);
  return new Blob([b],{type:'audio/wav'});
}
function fixture(){
  const calls=[];const input={activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true},sessionId:'session',requestId:'request',lesson:{},task:{id:'picture-retell-v1',kind:'picture_retell',prompt:'Retell',criteria:[{id:'event',meaning:'Story meaning'}]},audio:wav(),budget:{claim(){calls.push('claim');},finish(_,__,status){calls.push(status);}},provider:{
    transcribe:async()=>{calls.push('stt');return 'My own words.';},assess:async({transcript})=>{calls.push('assess');return {intent:'answer',reliability:'confirmed',criteria:[{id:'event',met:true,quote:transcript}],replySupport:'none'};},
    respond:()=>{throw Error('no new conversation');},synthesize:()=>{throw Error('no speech');},validateSafety:()=>{throw Error('no generated reply to check');},
  }};return{calls,input};
}
test('fallback reuses transcription+assessment only and never manufactures pronunciation',async()=>{
 const s=fixture();const r=await runStoryVoiceTurn(s.input);assert.deepEqual(s.calls,['claim','stt','assess','succeeded']);assert.equal(r.audio,null);assert.equal(r.reply,'');assert.equal(r.pronunciation,null);assert.equal(r.assessment,'server_validated');
});
test('safe retelling reaches assessment, remaining unsafe speech does not',async()=>{
 const s=fixture();s.input.lesson={source:{kind:'generated',source_id:'synthetic-retelling'},story:{sentences:[{text_en:'A cheerful dog runs.'}]}};
 s.input.provider.transcribe=async()=> 'The dog runs through a park.';
 assert.equal((await runStoryVoiceTurn(s.input)).assessment,'server_validated');
 s.calls.length=0;s.input.provider.transcribe=async()=> 'The dog runs. I will kill you.';
 assert.equal((await runStoryVoiceTurn(s.input)).assessment,'unassessed');assert.equal(s.calls.includes('assess'),false);
});
test('full Azure transcript avoids duplicate STT; Azure error automatically falls back',async()=>{
 const s=fixture();s.input.provider.picturePronunciation=async()=>({transcript:'My spoken retelling.',pronunciation:{accuracy:75,fluency:70,seconds:1}});
 const r=await runStoryVoiceTurn(s.input);assert.equal(s.calls.includes('stt'),false);assert.equal(r.pronunciation.accuracy,75);
 s.input.provider.picturePronunciation=async()=>{throw Error('Azure down');};const fallback=await runStoryVoiceTurn(s.input);assert.equal(fallback.pronunciation,null);assert.equal(s.calls.includes('stt'),true);
});
test('silent PCM invokes no speech provider; blank STT and uncertain model remain unassessed',async()=>{
 const s=fixture();s.input.audio=wav(1,true);const silent=await runStoryVoiceTurn(s.input);assert.equal(silent.assessment,'unassessed');assert.deepEqual(s.calls,['claim','succeeded']);
 s.input.audio=wav();s.input.provider.transcribe=async()=>'';const blank=await runStoryVoiceTurn(s.input);assert.equal(blank.assessment,'unassessed');
 s.input.provider.transcribe=async()=> 'flerm';s.input.provider.assess=async()=>({intent:'answer',reliability:'uncertain',replySupport:'none',criteria:[{id:'event',met:false,quote:''}]});assert.equal((await runStoryVoiceTurn(s.input)).assessment,'unassessed');
});
test('two-minute retelling allowed; oversized recordings rejected before spending',async()=>{
 const s=fixture();s.input.audio=wav(120);assert.equal((await runStoryVoiceTurn(s.input)).assessment,'server_validated');
 s.calls.length=0;s.input.audio=wav(122);await assert.rejects(runStoryVoiceTurn(s.input),/pcm/);assert.deepEqual(s.calls,[]);
});
test('Azure free quota, unreadable meter and failed reservation cause zero external calls',async()=>{
 let calls=0;for(const mode of ['full','bad','read-fails','write-fails']){
  const env={AZURE_SPEECH_KEY:'synthetic',AZURE_SPEECH_REGION:'test',READ2LEAD_CODES:{get:async()=>{if(mode==='read-fails')throw Error();return mode==='full'?18000:mode==='bad'?'broken':0;},put:async()=>{if(mode==='write-fails')throw Error();}}};
  const result=await createPicturePronunciation({env,fetchFn:async()=>{calls++;throw Error();}})(wav());assert.equal(result,null);
 }assert.equal(calls,0);
});
test('partial Azure results are discarded; all chunks must cover the complete recording',async()=>{
 let calls=0,reserved=0;const env={AZURE_SPEECH_KEY:'synthetic',AZURE_SPEECH_REGION:'test',READ2LEAD_CODES:{get:async()=>0,put:async(k,v)=>reserved=JSON.parse(v)}};
 const fetchFn=async()=>{calls++;if(calls===2)throw Error('chunk failed');return Response.json({RecognitionStatus:'Success',NBest:[{Display:'First half.',AccuracyScore:80,FluencyScore:70,PronScore:75}]});};
 const result=await createPicturePronunciation({env,fetchFn})(wav(45));assert.equal(result,null);assert.equal(calls,2);assert.equal(reserved,45);
});

test('successful Azure assessment combines every chunk and reserves complete duration',async()=>{
 let calls=0,reserved=0;const env={AZURE_SPEECH_KEY:'synthetic',AZURE_SPEECH_REGION:'test',READ2LEAD_CODES:{get:async()=>100,put:async(k,v)=>reserved=JSON.parse(v)}};
 const fetchFn=async()=>Response.json({RecognitionStatus:'Success',NBest:[{Display:++calls===1?'First half.':'Last half.',AccuracyScore:80,FluencyScore:70,PronScore:75}]});
 const result=await createPicturePronunciation({env,fetchFn})(wav(45));assert.equal(calls,2);assert.equal(reserved,145);assert.match(result.transcript,/First half/);assert.match(result.transcript,/Last half/);assert.equal(result.pronunciation.seconds,45);assert.equal(result.pronunciation.accuracy,80);
});
