#!/usr/bin/env node
/** One approved, pinned, non-learner trial. Default operation is local dry-run. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {PrivateStoryStore} from './lib/read2lead-story-store.mjs';
import {PrivateStoryBudgetStore} from './lib/read2lead-story-budget-store.mjs';
import {createStoryCloudflareBinding,STORY_TRIAL_MODELS} from './lib/read2lead-story-cloudflare.mjs';
import {createQwenStoryProvider,runStoryVoiceTurn,validateStoryPcmAudio} from '../functions/lib/read2lead/story-voice.mjs';
import {storyRubric} from '../functions/lib/read2lead/story-rubric.mjs';
import {validateStoryBudget} from '../functions/lib/read2lead/story-budget.mjs';

export const TRIAL_TURN_RESERVE_MICRO_USD=20_000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeFailure=error=>{
  const code=value=>typeof value==='string'&&/^(?:trial_|voice_|story_|workers_ai_)[a-z0-9_]{1,100}$/.test(value)?value:null;
  const phase=['transcription','reply','safety','assessment','synthesis','persistence'].includes(error?.storyVoicePhase)?error.storyVoicePhase:null;
  return {code:code(error?.message)||'trial_failed',cause:code(error?.detail),phase};
};
function privateFile(filename,maxBytes) {
  if(!path.isAbsolute(filename||'')||fs.realpathSync(filename)!==filename||filename.split(path.sep).some(s=>['public','dist','.git'].includes(s)))throw Error('trial_private_path_required');
  const info=fs.lstatSync(filename);if(!info.isFile()||info.nlink!==1||info.size>maxBytes)throw Error('trial_private_file_required');
  return fs.readFileSync(filename);
}
export async function prepareStoryVoiceTrial(plan) {
  if(plan?.format!=='read2lead-voice-trial-v1'||!/^trial-[a-zA-Z0-9-]{1,60}$/.test(plan.id||''))throw Error('invalid_trial_plan');
  privateFile(plan.publisherDb,100_000_000);
  const db=new DatabaseSync(plan.publisherDb,{readOnly:true});let row;
  try{row=db.prepare('SELECT package_json,package_sha256,state FROM publisher_packages WHERE source_id=? AND version=?').get(plan.sourceId,plan.contentVersion);}finally{db.close();}
  if(!row||row.state==='withdrawn'||row.package_sha256!==plan.packageSha256)throw Error('trial_package_changed');
  const lesson=JSON.parse(row.package_json).lesson,task=storyRubric(lesson).tasks.find(t=>t.id===plan.taskId);
  if(!task)throw Error('trial_task_unknown');
  const bytes=privateFile(plan.audioPath,1_952_044);if(hash(bytes)!==plan.audioSha256)throw Error('trial_audio_changed');
  const audio=new Blob([bytes],{type:'audio/wav'}),seconds=await validateStoryPcmAudio(audio);
  return {lesson,task,audio,summary:{id:plan.id,title:lesson.title_en,contentVersion:lesson.version,taskId:task.id,
    audioSeconds:seconds,packageSha256:plan.packageSha256,audioSha256:plan.audioSha256,
    destination:'Cloudflare Workers AI',models:Object.values(STORY_TRIAL_MODELS),maximumReservedUsd:0.02,
    awardsEnabled:false,calibrationEstablished:false}};
}
export async function executeStoryVoiceTrial(plan,{execute=false,credentials=()=>({}),fetchFn=fetch,now=()=>new Date()}={}) {
  const prepared=await prepareStoryVoiceTrial(plan);
  if(!execute)return {...prepared.summary,mode:'dry-run',providerCalls:0};
  const approval=plan.approval;
  if(approval?.externalProcessing!==true||approval?.spending!==true||approval?.adultTrial!==true||
    typeof approval.reference!=='string'||!approval.reference.trim()||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=now().getTime())throw Error('trial_approval_required');
  const config=validateStoryBudget(plan.budget);
  if(config.worstCaseTurnMicroUsd!==TRIAL_TURN_RESERVE_MICRO_USD||config.maxTurns!==1||config.approvedVoiceMicroUsd>1_000_000)throw Error('trial_budget_refused');
  // Data root is the existing marked private sandbox; never creates/initializes it here.
  const store=new PrivateStoryStore(plan.dataRoot);
  try {
    store.db.exec('CREATE TABLE IF NOT EXISTS story_trial_results (trial TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)');
    const fingerprint=hash(JSON.stringify({id:plan.id,source:plan.sourceId,version:plan.contentVersion,package:plan.packageSha256,audio:plan.audioSha256,task:plan.taskId}));
    const saved=store.db.prepare('SELECT fingerprint,result FROM story_trial_results WHERE trial=?').get(plan.id);
    if(saved){if(saved.fingerprint!==fingerprint)throw Error('trial_identity_conflict');return {...JSON.parse(saved.result),replayed:true,providerCalls:0};}
    const state=store.open('adult-voice-trial:'+plan.id,prepared.lesson);
    const budget=new PrivateStoryBudgetStore(store,config,now);
    let providerCalls=0;const counts={};
    const ai=createStoryCloudflareBinding({...credentials(),fetchFn,onCall:model=>{providerCalls++;counts[model]=(counts[model]||0)+1;}});
    const started=performance.now();
    let result,failure;
    try {result=await runStoryVoiceTurn({activation:{externalProcessingApproved:true,spendingApproved:true,adultTrialApproved:true,providerVerified:false,assessorValidated:false,assessorTrial:true},
      practiceTrial:true,provider:createQwenStoryProvider({ai}),budget,sessionId:state.sessionId,requestId:fingerprint,
      lesson:prepared.lesson,task:prepared.task,audio:prepared.audio});
    } catch(error) {
      // Pre-call refusal must not overwrite an earlier reservation's history.
      if(providerCalls===0)throw error;
      failure=safeFailure(error);
    }
    const report={...prepared.summary,mode:'approved-adult-trial',status:failure?'failed':'succeeded',providerCalls,callCounts:counts,elapsedMs:Math.round(performance.now()-started),
      timingMeaning:'server request-to-encoded-reply; NOT microphone-end-to-audible latency',...(failure?{failure}:{result}),completeLessons:0};
    store.db.prepare('INSERT INTO story_trial_results VALUES(?,?,?)').run(plan.id,fingerprint,JSON.stringify(report));
    return report;
  } finally {store.close();}
}
export async function runStoryTrialCli(args,{credentials=()=>({accountId:process.env.R2L_STORY_CF_ACCOUNT_ID,token:process.env.R2L_STORY_CF_TOKEN}),fetchFn=fetch}={}) {
  if(args.length<2||args[0]!=='--plan'||args.length>3||(args[2]&&args[2]!=='--execute'))throw Error('usage: --plan /private/plan.json [--execute]');
  const plan=JSON.parse(privateFile(args[1],16384));
  return executeStoryVoiceTrial(plan,{execute:args[2]==='--execute',credentials,fetchFn});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try {const result=await runStoryTrialCli(process.argv.slice(2));const {result:privateResult,...summary}=result;console.log(JSON.stringify(summary));if(result.status==='failed')process.exitCode=1;}
  catch(error){console.error(JSON.stringify({status:'refused',code:/^(trial_|invalid_trial_|voice_|usage:|story_)/.test(error.message)?error.message:'trial_failed'}));process.exitCode=1;}
}
