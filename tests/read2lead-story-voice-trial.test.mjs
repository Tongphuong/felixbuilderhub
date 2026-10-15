import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixtureAssets,fixturePackage,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
import {openPublisherStore} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {initializeSyntheticTarget} from '../scripts/read2lead-local-qa.mjs';
import {executeStoryVoiceTrial,runStoryTrialCli} from '../scripts/read2lead-story-voice-trial.mjs';
import {createStoryCloudflareBinding,STORY_TRIAL_MODELS} from '../scripts/lib/read2lead-story-cloudflare.mjs';
const now=()=>new Date('2026-09-27T12:00:00Z');
const credentials=()=>({accountId:'a'.repeat(32),token:'fixture-secret-only-123456789'});
test('diagnostic timeout cannot exceed live phase limit and actually aborts the request',async()=>{
 for(const timeoutMs of [0,-1,15001,Infinity,NaN,1.5])assert.throws(()=>createStoryCloudflareBinding({...credentials(),timeoutMs}),/timeout_limit/);
 let calls=0,aborted=false;
 const ai=createStoryCloudflareBinding({...credentials(),timeoutMs:10,fetchFn:async(_url,{signal})=>{
  calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('private transport error'));},{once:true}));
 }});
 await assert.rejects(ai.run(STORY_TRIAL_MODELS.asr,{audio:'abc'}),/trial_provider_timeout/);
 assert.equal(calls,1);assert.equal(aborted,true);
 await assert.rejects(ai.run(STORY_TRIAL_MODELS.asr,{audio:'abc'}),/trial_call_limit/);
});
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-trial-')),publisherDb=path.join(root,'publisher.sqlite');
 const db=openPublisherStore(publisherDb,{create:true});initializePublisherCatalogue(db);
 const pkg=await fixturePackage(fixtureAssets(root));await seedFixturePackages(db,[pkg]);
 const row=db.prepare('SELECT package_sha256 FROM publisher_packages').get();db.close();
 const dataRoot=path.join(root,'learners');initializeSyntheticTarget(dataRoot);
 const audioPath=path.join(root,'fixture.wav'),bytes=Buffer.alloc(32044);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);fs.writeFileSync(audioPath,bytes,{mode:0o600});
 const plan={format:'read2lead-voice-trial-v1',id:'trial-fixture',publisherDb,dataRoot,sourceId:pkg.lesson.source.source_id,contentVersion:pkg.lesson.version,packageSha256:row.package_sha256,audioPath,audioSha256:createHash('sha256').update(bytes).digest('hex'),taskId:'mission-retell',
  approval:{externalProcessing:true,spending:true,adultTrial:true,reference:'fabricated-test-only',expiresAt:'2026-09-28T00:00:00Z'},
  budget:{month:'2026-09',baselineReconciled:true,existingCostsMicroUsd:30_000_000,approvedVoiceMicroUsd:1_000_000,worstCaseTurnMicroUsd:20_000,maxTurns:1}};
 let calls=[];
 const fetchFn=async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');
  const model=Object.values(STORY_TRIAL_MODELS).find(m=>url.endsWith(m));
  if(model===STORY_TRIAL_MODELS.speech)return new Response(new Uint8Array([73,68,51,0]),{headers:{'Content-Type':'audio/mpeg'}});
  let result;
  if(model===STORY_TRIAL_MODELS.asr)result={text:pkg.lesson.retell.essential_facts.map(f=>f.quote).join(' ')};
  else {
   const payload=JSON.parse(options.body),system=payload.messages[0].content;
   const content=system.startsWith('Check ')?{safe:true,grounded:true,staysOnTask:true,replySupport:'none'}:system.startsWith('Assess ')?
    {intent:'answer',reliability:'confirmed',replySupport:'none',criteria:[...pkg.lesson.retell.essential_facts.map((f,i)=>({id:'fact-'+(i+1),met:true,quote:f.quote})),
      {id:'order-causality',met:true,quote:pkg.lesson.retell.essential_facts.map(f=>f.quote).join(' ')}]}:
    {reply:'Tell Minny one more detail.',sentenceIds:[pkg.lesson.story.sentences[0].id]};
   result={choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]};
  }
  return Response.json({success:true,result});
 };
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,plan,pkg,fetchFn,calls,options:{now,credentials,fetchFn,execute:true}};
}
test('dry-run reads pinned local materials but never reads credentials or calls network',async t=>{
 const s=await setup(t);let secrets=0;
 const result=await executeStoryVoiceTrial({...s.plan,approval:null,budget:null},{credentials:()=>{secrets++;throw Error('no');},fetchFn:()=>{throw Error('network');}});
 assert.equal(result.mode,'dry-run');assert.equal(result.providerCalls,0);assert.equal(result.audioSeconds,1);assert.equal(secrets,0);
 const file=path.join(s.root,'plan.json');fs.writeFileSync(file,JSON.stringify(s.plan));assert.equal((await runStoryTrialCli(['--plan',file],{fetchFn:()=>{throw Error('network');}})).mode,'dry-run');
});
test('approved fixture exercises real adapter shapes but produces no calibrated grade or award',async t=>{
 const s=await setup(t),r=await executeStoryVoiceTrial(s.plan,s.options);
 assert.equal(r.providerCalls,5);assert.equal(r.completeLessons,0);assert.equal(r.result.assessment,'unassessed');assert.equal(r.result.rewardsAwarded,false);
 assert.equal(r.result.judgment.reliability,'confirmed');assert.equal(r.result.audio.content_type,'audio/mpeg');
 assert.ok(r.result.judgment.matchedCriteria.includes('order-causality'));
 const replay=await executeStoryVoiceTrial(s.plan,{...s.options,credentials:()=>{throw Error('must not read');}});
 assert.equal(replay.replayed,true);assert.equal(replay.providerCalls,0);assert.equal(s.calls.length,5);
});
test('missing/expired approval and unreconciled or excessive budget refuse before network',async t=>{
 const s=await setup(t);
 for(const plan of [{...s.plan,approval:null},{...s.plan,approval:{...s.plan.approval,expiresAt:'2026-09-26'}},{...s.plan,budget:{...s.plan.budget,baselineReconciled:false}},{...s.plan,budget:{...s.plan.budget,approvedVoiceMicroUsd:2_000_000}},{...s.plan,budget:{...s.plan.budget,existingCostsMicroUsd:40_000_000}}])await assert.rejects(executeStoryVoiceTrial(plan,s.options));
 assert.equal(s.calls.length,0);
});
test('changed package/audio and unknown task refuse before network',async t=>{
 const s=await setup(t);
 for(const patch of [{packageSha256:'0'.repeat(64)},{audioSha256:'0'.repeat(64)},{taskId:'invented-task'}])await assert.rejects(executeStoryVoiceTrial({...s.plan,...patch},s.options));
 assert.equal(s.calls.length,0);
});
test('unknown provider failure retains reservation and replay cannot spend again',async t=>{
 const s=await setup(t);let count=0;
 const options={...s.options,fetchFn:async()=>{count++;throw Error('private token should never leak');}};
 const failed=await executeStoryVoiceTrial(s.plan,options);
 assert.equal(failed.status,'failed');assert.equal(failed.providerCalls,1);
 assert.deepEqual(failed.failure,{code:'workers_ai_transcription_failed',cause:'trial_provider_unavailable',phase:'transcription'});
 assert.equal(JSON.stringify(failed).includes('private token'),false);
 const replay=await executeStoryVoiceTrial(s.plan,{...options,credentials:()=>{throw Error('must not read');}});
 assert.equal(replay.replayed,true);assert.equal(replay.providerCalls,0);assert.equal(replay.status,'failed');assert.equal(count,1);
 await assert.rejects(executeStoryVoiceTrial({...s.plan,taskId:'invented-task'},options));
});
test('HTTP provider failure is retained without its private response body',async t=>{
 const s=await setup(t);
 const result=await executeStoryVoiceTrial(s.plan,{...s.options,fetchFn:async()=>new Response('private error body',{status:403})});
 assert.equal(result.failure.cause,'trial_provider_http_403');assert.equal(result.providerCalls,1);
 assert.equal(JSON.stringify(result).includes('private error body'),false);
});
test('each failed voice phase is saved without raw errors and replay performs no calls',async t=>{
 for(const [index,phase] of ['transcription','assessment','reply','safety','synthesis'].entries())await t.test(phase,async t=>{
  const s=await setup(t);let calls=0;
  const result=await executeStoryVoiceTrial(s.plan,{...s.options,fetchFn:async(...args)=>{
   calls++;
   if(calls===index+1){
    if(phase==='transcription')return Response.json({success:true,result:{text:''}});
    if(phase==='synthesis')return new Response('private audio error',{headers:{'Content-Type':'text/plain'}});
    return Response.json({success:true,result:{choices:[{finish_reason:'stop',message:{content:'private malformed model response'}}]}});
   }
   return s.fetchFn(...args);
  }});
  assert.equal(result.status,'failed');assert.equal(result.failure.phase,phase);
  if(phase==='synthesis')assert.equal(result.failure.code,'trial_audio_response_required');
  assert.equal(result.providerCalls,index+1);assert.equal(calls,index+1);
  assert.equal(JSON.stringify(result).includes('private malformed'),false);
  assert.equal(JSON.stringify(result).includes('private audio'),false);
  const replay=await executeStoryVoiceTrial(s.plan,{...s.options,credentials:()=>{throw Error('no secret read on replay');},fetchFn:()=>{throw Error('no replay call');}});
  assert.equal(replay.failure.phase,phase);assert.equal(replay.providerCalls,0);assert.equal(replay.replayed,true);
 });
});
test('Cloudflare transport rejects unknown models, excessive calls, redirects and response shape errors',async()=>{
 let calls=0;const ai=createStoryCloudflareBinding({...credentials(),fetchFn:async()=>{calls++;return Response.json({success:true,result:{text:'hello'}});}});
 await assert.rejects(ai.run('@cf/myshell-ai/melotts',{}),/model_refused/);assert.equal(calls,0);
 await ai.run(STORY_TRIAL_MODELS.asr,{audio:'abc'});await assert.rejects(ai.run(STORY_TRIAL_MODELS.asr,{audio:'abc'}),/call_limit/);assert.equal(calls,1);
 for(const response of [new Response('',{status:302}),Response.json({success:false,result:{}}),new Response('bad json')]){
  const bad=createStoryCloudflareBinding({...credentials(),fetchFn:async()=>response});await assert.rejects(bad.run(STORY_TRIAL_MODELS.asr,{audio:'abc'}));
 }
 const text=createStoryCloudflareBinding({...credentials(),fetchFn:async()=>{throw Error('unexpected');}});await assert.rejects(text.run(STORY_TRIAL_MODELS.text,{messages:[],stream:true,max_tokens:20}),/text_limit/);
});
