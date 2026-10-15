/** Fabricated provider contracts: integration evidence, never model/content QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrivateStoryStore } from '../scripts/lib/read2lead-story-store.mjs';
import { PrivateStoryBudgetStore } from '../scripts/lib/read2lead-story-budget-store.mjs';
import { initializeSyntheticTarget } from '../scripts/read2lead-local-qa.mjs';
import { createStoryTurnHandler } from '../functions/api/read2lead-story-turn.js';
import { createStorySessionHandler } from '../functions/api/read2lead-story-session.js';
import { storyRubric, validateStoryJudgment, storyDiscussionTasks } from '../functions/lib/read2lead/story-rubric.mjs';
import { createQwenStoryProvider, STORY_QWEN_MODEL, validateStoryPcmAudio } from '../functions/lib/read2lead/story-voice.mjs';
const pkg=JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url)));
const origin='http://127.0.0.1:9998';
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-turn-')),data=path.join(root,'data');initializeSyntheticTarget(data);
 let now=Date.parse('2026-09-27T00:00:00Z');const store=new PrivateStoryStore(data,{now:()=>now});
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 let owner='test-adult',available=true,calls=0;
 const runtime={catalogue:()=>available?[pkg.lesson]:[],packageFor:()=>structuredClone(pkg)},authenticate=()=>owner;
 const budget=new PrivateStoryBudgetStore(store,{month:'2026-09',baselineReconciled:true,existingCostsMicroUsd:30_000_000,approvedVoiceMicroUsd:1_000_000,worstCaseTurnMicroUsd:1000,maxTurns:8},()=>new Date(now));
 const provider={transcribe:async()=>{calls++;return pkg.lesson.retell.essential_facts.map(f=>f.quote).join(' ');},
 respond:async()=>({reply:'You found a story detail. What happens next?',sentenceIds:['s1']}),validateSafety:async()=>true,
 assess:async({task,transcript})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript.slice(0,60)}))}),
 synthesize:async()=>({audio_b64:'YXVkaW8=',content_type:'audio/mpeg'})};
 const voiceConfig={activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true},provider,budget};
 const handler=createStoryTurnHandler({store,runtime,origin,authenticate,voiceConfig});
 const sessionHandler=createStorySessionHandler({store,runtime,origin,authenticate,voiceEnabled:()=>true});
 let state=store.open(owner,pkg.lesson);
 const event=async(type,extra={})=>{const r=await sessionHandler(new Request(origin+'/api/read2lead-story-session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'event',sessionId:state.sessionId,requestId:'event-'+state.revision,revision:state.revision,event:{type,...extra}})}));const value=await r.json();state=store.get('test-adult',state.sessionId);return{status:r.status,value};};
 const request=(id='turn-'+state.revision,{audio='fixture',extra=null,headers={}}={})=>{const f=new FormData();f.set('sessionId',state.sessionId);f.set('requestId',id);f.set('revision',String(state.revision));f.set('audio',new Blob([audio],{type:'audio/webm'}),'voice.webm');if(extra)f.set('score','100');return new Request(origin+'/api/read2lead-story-turn',{method:'POST',headers:{Origin:origin,...headers},body:f});};
 const call=async(r=request())=>{const response=await handler(r);const value=await response.json();state=store.get('test-adult',state.sessionId);return{status:response.status,value};};
 const retell=async(skip=false)=>{await event('read_complete');for(const q of pkg.lesson.questions)await event(skip?'skip_question':'answer',skip?{taskId:q.id}:{taskId:q.id,optionIndex:q.correct_index});};
 return{store,data,provider,voiceConfig,runtime,handler,sessionHandler,request,call,event,retell,state:()=>state,calls:()=>calls,owner:v=>owner=v,withdraw:()=>available=false,advanceClock:ms=>now+=ms};
}
test('authenticated tap comprehension→voice retell→continue commits one durable test award',async t=>{
 const s=setup(t);await s.retell();const request=s.request(),replay=request.clone();const r=await s.call(request);assert.equal(r.status,200,JSON.stringify(r.value));
 assert.equal(r.value.view.session.stage,'retell');assert.equal(r.value.view.session.feedbackPending,true);assert.equal(r.value.voice.judgment,undefined);
 const finish=await s.event('continue_voice');assert.equal(finish.status,200);assert.equal(finish.value.session.complete,true);assert.deepEqual(finish.value.session.awarded,{diamonds:1000,xp:20});
 const again=await s.call(replay);assert.equal(again.status,200);assert.equal(again.value.replayed,true);assert.equal(s.calls(),1);
 const reader=new PrivateStoryStore(s.data);try{assert.equal(reader.get('test-adult',s.state().sessionId).missionResult.testBalance.diamonds,1000);assert.equal(reader.voiceResult('test-adult',s.state().sessionId,r.value.view.session.lastVoice.requestId).transcript,r.value.voice.transcript);}finally{reader.close();}
});
test('spoken comprehension advances only after continue; active task is server selected',async t=>{
 const s=setup(t);await s.event('read_complete');const r=await s.call();assert.equal(r.status,200);assert.equal(r.value.view.lesson.question.id,pkg.lesson.questions[0].id);
 assert.equal((await s.event('skip_question',{taskId:pkg.lesson.questions[0].id})).status,409);
 const advanced=await s.event('continue_voice');assert.equal(advanced.value.lesson.question.id,pkg.lesson.questions[1].id);
 assert.equal(advanced.value.session.feedback.result,'demonstrated');
});
test('server package resolves graded scope; practice result cannot advance or award',async t=>{
 const s=setup(t);await s.retell();let resolved=0;
 const assessed={...s.voiceConfig,activation:{...s.voiceConfig.activation}};
 s.voiceConfig.forPackage=async actual=>{
   assert.deepEqual(actual,pkg);resolved++;
   return {...assessed,practiceTrial:true,activation:{...assessed.activation,adultTrialApproved:true,providerVerified:false,assessorValidated:false}};
 };
 const practice=await s.call();assert.equal(practice.status,200);assert.ok(resolved>0);
 assert.equal(practice.value.view.session.lastVoice.assessed,false);
 const first=await s.event('continue_voice');assert.equal(first.value.session.complete,false);assert.equal(first.value.session.stage,'retell');
 s.voiceConfig.forPackage=async actual=>{assert.deepEqual(actual,pkg);return assessed;};
 const graded=await s.call();assert.equal(graded.status,200);assert.equal(graded.value.view.session.lastVoice.assessed,true);
 const finish=await s.event('continue_voice');assert.equal(finish.value.session.complete,false);
 assert.equal(finish.value.session.awarded.diamonds,0,'earlier unassessed tutor assistance is retained');
 const fresh=setup(t);await fresh.retell();const verified={...fresh.voiceConfig};
 fresh.voiceConfig.forPackage=async actual=>{assert.deepEqual(actual,pkg);return verified;};
 assert.equal((await fresh.call()).status,200);
 const done=await fresh.event('continue_voice');assert.equal(done.value.session.complete,true);assert.deepEqual(done.value.session.awarded,{diamonds:1000,xp:20});
});
test('disabled resolved package refuses voice and prompt before a provider call or claim',async t=>{
 const s=setup(t);await s.event('read_complete');s.voiceConfig.forPackage=async()=>null;
 assert.equal((await s.call()).status,503);assert.equal((await s.call(promptRequest(s))).status,503);
 assert.equal(s.calls(),0);assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_voice_turns').get().n,0);
});
test('disabled provider, unauthenticated owner, cross origin and forged scores never call STT',async t=>{
 const s=setup(t);await s.retell();s.owner(null);assert.equal((await s.call()).status,401);s.owner('test-adult');
 assert.equal((await s.call(s.request('foreign',{headers:{Origin:'https://elsewhere.example'}}))).status,403);
 assert.equal((await s.call(s.request('forged',{extra:true}))).status,400);
 s.voiceConfig.activation.spendingApproved=false;assert.equal((await s.call()).status,503);assert.equal(s.calls(),0);
});
test('rejecting a misheard assessed retell preserves progress, assistance, audit and budget without scoring',async t=>{
 const s=setup(t);await s.retell();const before=structuredClone(s.state());
 s.provider.assess=async({task,transcript})=>({reliability:'confirmed',replySupport:'model',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript.slice(0,60)}))});
 const request=s.request('misheard'),replay=request.clone();assert.equal((await s.call(request)).status,200);
 const support=structuredClone(s.state().voiceSupport),revision=s.state().revision;
 const result=await s.event('reject_voice');assert.equal(result.status,200);
 assert.equal(result.value.session.stage,'retell');assert.equal(result.value.session.feedbackPending,false);
 assert.equal(result.value.session.lastVoice,null);assert.equal(result.value.session.complete,false);
 assert.deepEqual(s.state().answers,before.answers);assert.equal(s.state().retellTries,before.retellTries);
 assert.deepEqual(s.state().voiceSupport,support);assert.equal(s.state().revision,revision+1);
 assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
 assert.ok(s.store.voiceResult('test-adult',s.state().sessionId,'misheard').transcript);
 assert.equal((await s.event('reject_voice')).status,409);
 assert.equal((await s.event('continue_voice')).status,409);
 const saved=await s.call(replay);assert.equal(saved.status,200);assert.equal(saved.value.replayed,true);
 assert.equal(saved.value.view.session.feedbackPending,false);assert.equal(s.calls(),1);
 assert.equal((await s.call(s.request('new-retell'))).status,200);
 assert.equal(s.state().lastVoice.support,'model');
 assert.equal((await s.event('continue_voice')).value.session.complete,false);
});
test('reject voice refuses extra client evidence and absent feedback',async t=>{
 const s=setup(t);await s.event('read_complete');assert.equal((await s.event('reject_voice')).status,409);
 await s.call();const before=structuredClone(s.state());
 assert.equal((await s.event('reject_voice',{matchedCriteria:['meaning']})).status,400);
 assert.deepEqual(s.state(),before);
 assert.equal((await s.event('reject_voice')).status,200);assert.equal(s.state().questionIndex,0);
 assert.equal(s.state().tries,0);assert.equal(s.state().answers.length,0);
});
test('uncertain and uncalibrated speech never advances or awards',async t=>{
 const s=setup(t);await s.retell();s.provider.assess=async({task})=>({reliability:'uncertain',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:false,quote:''}))});
 assert.equal((await s.call()).status,200);let c=await s.event('continue_voice');assert.equal(c.value.session.stage,'retell');assert.equal(c.value.session.complete,false);
 s.voiceConfig.activation.assessorValidated=false;assert.equal((await s.call()).status,200);c=await s.event('continue_voice');assert.equal(c.value.session.stage,'retell');assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
});
test('skipped comprehension cannot be hidden by a perfect retell',async t=>{
 const s=setup(t);await s.retell(true);assert.equal((await s.call()).status,200);const done=await s.event('continue_voice');assert.equal(done.value.session.complete,false);assert.equal(done.value.session.awarded.diamonds,0);
});
test('switching to a tap after a model answer cannot erase assistance',async t=>{
 const s=setup(t),q=pkg.lesson.questions[0];
 await s.event('read_complete');
 s.provider.assess=async({task})=>({reliability:'confirmed',replySupport:'model',criteria:task.criteria.map(c=>({id:c.id,met:false,quote:''}))});
 assert.equal((await s.call()).status,200);await s.event('continue_voice');
 const response=await s.event('answer',{taskId:q.id,optionIndex:q.correct_index});
 assert.equal(response.status,200);assert.equal(s.state().answers.at(-1).support,'model');
 assert.equal(s.state().answers.at(-1).result,'needs_practice');
});
test('fabricated transcript evidence is refused before TTS and not stored as a successful reply',async t=>{
 const s=setup(t);await s.retell();let tts=0;s.provider.synthesize=async()=>{tts++;throw Error('should not run');};
 s.provider.assess=async({task})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:'invented learner words'}))});
 assert.equal((await s.call()).status,503);assert.equal(tts,0);assert.equal(s.state().voiceAwaitingContinue,undefined);assert.equal(s.store.db.prepare('SELECT status FROM story_speech_turns').get().status,'failed');
});
test('concurrent turns and tap mutations are blocked; lost replies replay without a second call',async t=>{
 const s=setup(t);await s.retell();let resolve,entered;const waiting=new Promise(r=>entered=r);
 s.provider.respond=()=>{entered();return new Promise(r=>resolve=r);};
 const r=s.request('concurrent'),clone=r.clone(),first=s.call(r);await waiting;
 assert.equal((await s.call(clone.clone())).status,409);assert.equal((await s.event('retell_unassessed')).status,409);
 resolve({reply:'You noticed a detail. Tell Minny more.',sentenceIds:['s1']});assert.equal((await first).status,200);
 assert.equal((await s.call(clone)).value.replayed,true);assert.equal(s.calls(),1);
});
test('revocation or withdrawal while provider is running prevents saved progress',async t=>{
 const s=setup(t);await s.retell();s.provider.validateSafety=async()=>{s.withdraw();return true;};
 assert.equal((await s.call()).status,409);assert.equal(s.state().voiceAwaitingContinue,undefined);assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
});
test('reward write failure leaves feedback retryable and rolls back state, receipt and wallet',async t=>{
 const s=setup(t);await s.retell();await s.call();const revision=s.state().revision;
 s.store.db.exec("CREATE TRIGGER refuse_assessment BEFORE INSERT ON story_assessed_progress BEGIN SELECT RAISE(ABORT,'forced_failure'); END");
 assert.equal((await s.event('continue_voice')).status,409);assert.equal(s.state().revision,revision);assert.equal(s.state().voiceAwaitingContinue,true);assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
 s.store.db.exec('DROP TRIGGER refuse_assessment');assert.equal((await s.event('continue_voice')).value.session.awarded.diamonds,1000);assert.equal(s.calls(),1);
});
test('abandoned pending record expires and cannot accept a late result',async t=>{
 const s=setup(t);await s.retell();const input={sessionId:s.state().sessionId,requestId:'old',revision:s.state().revision};s.store.beginVoice('test-adult',pkg.lesson,input,'old');
 s.advanceClock(120001);s.store.beginVoice('test-adult',pkg.lesson,{...input,requestId:'new'},'new');
 assert.throws(()=>s.store.finishVoice('test-adult',pkg.lesson,input,{}),/stale_voice_result/);
});
test('rubric validation rejects missing, unknown, duplicated and unsupported criteria',()=>{
 const task=storyRubric(pkg.lesson).tasks[0];const base={reliability:'confirmed',replySupport:'none',criteria:[{id:'meaning',met:true,quote:'cup'}]};
 assert.equal(validateStoryJudgment(base,task,'the cup').matchedCriteria[0],'meaning');
 for(const value of [{...base,criteria:[]},{...base,criteria:[{id:'other',met:true,quote:'cup'}]},{...base,criteria:[...base.criteria,...base.criteria]},{...base,reliability:'uncertain'}])assert.throws(()=>validateStoryJudgment(value,task,'the cup'));
});
test('candidate Qwen adapter bounds calls and requires strict stopped JSON without tools',async()=>{
 const calls=[];let result={safe:true,grounded:true,staysOnTask:true,replySupport:'none'};
 const ai={run:async(model,input)=>{calls.push({model,input});return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]};}};
 const provider=createQwenStoryProvider({ai});assert.equal(calls.length,0);
 const input={lesson:pkg.lesson,task:storyRubric(pkg.lesson).tasks[0],transcript:'A learner sentence.',reply:'Tell Minny more.'};
 assert.deepEqual(await provider.validateSafety(input),{valid:true,replySupport:'none'});assert.equal(calls[0].model,STORY_QWEN_MODEL);
 assert.deepEqual(calls[0].input.response_format,{type:'json_object'});assert.equal(calls[0].input.stream,false);assert.equal(calls[0].input.max_tokens,128);
 result={safe:true,grounded:true,staysOnTask:true,extra:'ignore'};assert.equal(await provider.validateSafety(input),false);
 for(const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{content:'{}',tool_calls:[{}]}},{finish_reason:'stop',message:{content:'not JSON'}}]){
  const invalid=createQwenStoryProvider({ai:{run:async()=>({choices:[choice]})}});await assert.rejects(invalid.respond([{role:'user',content:'test'}]));
 }
 const before=calls.length;await assert.rejects(provider.respond([{role:'user',content:'x'.repeat(24001)}]),/prompt_too_large/);assert.equal(calls.length,before);
});
test('PCM duration uses validated bytes, refusing forged headers and overlong audio',async()=>{
 const bytes=new Uint8Array(44+32000),h=new DataView(bytes.buffer);
 for(const [at,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(text),at);
 for(const [at,value] of [[4,bytes.length-8],[16,16],[24,16000],[28,32000],[40,32000]])h.setUint32(at,value,true);
 for(const [at,value] of [[20,1],[22,1],[32,2],[34,16]])h.setUint16(at,value,true);
 const blob=()=>new Blob([bytes],{type:'audio/wav'});assert.equal(await validateStoryPcmAudio(blob()),1);
 h.setUint32(40,2,true);await assert.rejects(validateStoryPcmAudio(blob()),/invalid_story_pcm/);h.setUint32(40,32000,true);
 h.setUint32(24,1,true);await assert.rejects(validateStoryPcmAudio(blob()),/invalid_story_pcm/);
 await assert.rejects(validateStoryPcmAudio(new Blob([new Uint8Array(1_952_045)],{type:'audio/wav'})),/pcm_required/);
 await assert.rejects(validateStoryPcmAudio(new Blob([bytes],{type:'audio/webm'})),/pcm_required/);
});

test('only explicit adult practice permits an unverified provider and it cannot complete or reward',async t=>{
 const s=setup(t);await s.retell();
 s.voiceConfig.activation.providerVerified=false;
 assert.equal((await s.call()).status,503);assert.equal(s.calls(),0);
 s.voiceConfig.practiceTrial=true;
 assert.equal((await s.call()).status,503);assert.equal(s.calls(),0);
 s.voiceConfig.activation.adultTrialApproved=true;
 const response=await s.call();assert.equal(response.status,200);assert.equal(s.calls(),1);
 const next=await s.event('continue_voice');assert.equal(next.value.session.complete,false);
 assert.equal(next.value.session.stage,'retell');assert.deepEqual(next.value.session.awarded,{diamonds:0,xp:0});
 assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
});

test('failed provider phase survives reload without persisting provider text or secrets',async t=>{
 const s=setup(t);await s.retell();s.provider.synthesize=async()=>{throw Error('upstream fabricated-secret-key');};
 const response=await s.call(s.request('failed-speech'));assert.equal(response.status,503);assert.equal(response.value.phase,'synthesis');
 assert.equal(JSON.stringify(response.value).includes('fabricated-secret'),false);
 const saved=s.store.db.prepare("SELECT result FROM story_speech_turns WHERE request='failed-speech'").get().result;
 assert.equal(JSON.parse(saved).failure.phase,'synthesis');assert.equal(saved.includes('fabricated-secret'),false);
 const retry=await s.call(new Request(origin+'/api/read2lead-story-turn?sessionId='+s.state().sessionId+'&requestId=failed-speech'));
 assert.equal(retry.status,409);assert.equal(retry.value.code,'voice_request_failed');assert.equal(retry.value.phase,'synthesis');
});

// Assistance is a record of help already heard, not just the latest reply.
function setJudgment(s,{support='none',met=true}={}) {
 s.provider.assess=async({task,transcript})=>({reliability:'confirmed',replySupport:support,
  criteria:task.criteria.map(c=>({id:c.id,met,quote:met?transcript.slice(0,60):''}))});
}
test('model help survives neutral feedback, rejected speech and whole-lesson retry without paying copied retells',async t=>{
 const s=setup(t);await s.retell();setJudgment(s,{support:'model',met:false});
 assert.equal((await s.call()).status,200);await s.event('reject_voice');
 setJudgment(s);
 for(let i=0;i<2;i++){assert.equal((await s.call()).status,200);await s.event('continue_voice');}
 assert.equal(s.state().stage,'retell');assert.equal(s.state().retelling,'needs_practice');assert.equal(s.state().lastVoice.support,'model');
 assert.equal(s.state().missionResult,undefined);assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
 const deferred=await s.event('retell_unassessed');assert.equal(deferred.value.session.complete,false);assert.equal(deferred.value.session.awarded.diamonds,0);
 await s.event('retry_mission');await s.retell();
 for(let i=0;i<2;i++){assert.equal((await s.call()).status,200);await s.event('continue_voice');}
 assert.equal(s.state().stage,'retell');assert.equal(s.state().retelling,'needs_practice');assert.equal(s.state().lastVoice.support,'model');
 assert.equal(s.state().missionResult,undefined);assert.ok(s.state().answers.filter(a=>a.taskId==='mission-retell').every(a=>a.support==='model'&&a.result==='needs_practice'));
 assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
 const reopened=new PrivateStoryStore(s.data);try{assert.equal(reopened.get('test-adult',s.state().sessionId).voiceSupport['mission-retell'],'model');}finally{reopened.close();}
});
test('hint help remains assisted across a neutral reply and retry, while valid evidence earns exactly one normal reward',async t=>{
 const s=setup(t);await s.retell();setJudgment(s,{support:'hint',met:false});await s.call();await s.event('continue_voice');
 setJudgment(s);await s.call();await s.event('continue_voice');
 assert.equal(s.state().missionResult.assessment.assisted,true);assert.equal(s.state().missionResult.award.diamonds,1000);
 await s.event('retry_mission');await s.retell();await s.call();await s.event('continue_voice');
 assert.equal(s.state().missionResult.assessment.assisted,true);assert.equal(s.state().missionResult.assessment.independentSpokenRetelling,false);
 assert.equal(s.state().missionResult.duplicate,true);assert.equal(s.state().missionResult.award.diamonds,0);
 assert.ok(s.state().answers.filter(a=>a.taskId!=='mission-retell').every(a=>a.support==='none'),'retell help must not taint unrelated comprehension tasks');
 const wallet=s.store.db.prepare('SELECT diamonds,ledger FROM story_test_wallets').get();assert.equal(wallet.diamonds,1000);assert.equal(JSON.parse(wallet.ledger).receipts.length,1);
});
test('new model feedback does not retroactively penalize the independent answer that preceded it',async t=>{
 const s=setup(t);await s.retell();setJudgment(s,{support:'model'});await s.call();
 assert.equal(s.state().lastVoice.support,'none');assert.equal(s.state().voiceSupport['mission-retell'],'model');
 await s.event('continue_voice');assert.equal(s.state().missionResult.assessment.independentSpokenRetelling,true);assert.equal(s.state().missionResult.award.diamonds,1000);
});
test('recall cannot erase supplied model help using repeated neutral replies and claim 200 diamonds',async t=>{
 const s=setup(t);await s.retell();await s.call();await s.event('continue_voice');
 s.advanceClock(86400001);assert.equal((await s.event('start_recall')).status,200);
 setJudgment(s,{support:'model',met:false});await s.call();await s.event('continue_voice');
 setJudgment(s);
 for(let i=0;i<2;i++){assert.equal((await s.call()).status,200);await s.event('continue_voice');}
 assert.equal(s.state().stage,'recall');assert.equal(s.state().recallResult.status,'practice_only');assert.equal(s.state().recallResult.award.diamonds,0);
 const wallet=s.store.db.prepare('SELECT diamonds,ledger FROM story_test_wallets').get();assert.equal(wallet.diamonds,1000);assert.equal(JSON.parse(wallet.ledger).receipts.length,1);
});

function promptRequest(s,id='question-audio',extra={}) {
 return new Request(origin+'/api/read2lead-story-turn',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
 body:JSON.stringify({action:'prompt',sessionId:s.state().sessionId,revision:s.state().revision,requestId:id,...extra})});
}
test('question audio uses only current server prompt; reload replay is free and leaves exact progress unchanged',async t=>{
 const s=setup(t);await s.event('read_complete');const before=structuredClone(s.state());let spoken=[];
 s.provider.synthesize=async text=>{spoken.push(text);return{audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};
 const first=await s.call(promptRequest(s));assert.equal(first.status,200);assert.equal(first.value.prompt,pkg.lesson.questions[0].prompt_en);
 assert.deepEqual(spoken,[pkg.lesson.questions[0].prompt_en]);assert.deepEqual(s.state(),before);assert.equal(s.calls(),0);
 const reader=new PrivateStoryStore(s.data);t.after(()=>reader.close());
 const reload=createStoryTurnHandler({store:reader,runtime:s.runtime,origin,authenticate:()=> 'test-adult',voiceConfig:null});
 const response=await reload(promptRequest(s,'new-click'));assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
 assert.equal(spoken.length,1);assert.equal(reader.db.prepare('SELECT COUNT(*) AS n FROM story_voice_turns').get().n,1);
 assert.equal(reader.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
});
test('prompt refuses foreign session, caller text, stale revision, read stage, denied activation and denied budget',async t=>{
 const s=setup(t);let calls=0;s.provider.synthesize=async()=>{calls++;return{audio_b64:'YQ==',content_type:'audio/mpeg'};};
 assert.equal((await s.call(promptRequest(s))).status,409);await s.event('read_complete');
 assert.equal((await s.call(promptRequest(s,'text',{text:'Say an answer'}))).status,400);
 assert.equal((await s.call(promptRequest(s,'stale',{revision:0}))).status,409);
 s.owner('other');assert.equal((await s.call(promptRequest(s))).status,404);s.owner('test-adult');
 s.voiceConfig.activation.spendingApproved=false;assert.equal((await s.call(promptRequest(s))).status,503);
 s.voiceConfig.activation.spendingApproved=true;s.voiceConfig.budget.claim=()=>{throw Error('voice_budget_exhausted');};
 assert.equal((await s.call(promptRequest(s))).value.code,'voice_budget_exhausted');assert.equal(calls,0);
 assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
});
test('concurrent question clicks synthesize once; a lost response replays the saved recording',async t=>{
 const s=setup(t);await s.event('read_complete');let release,entered,calls=0;const started=new Promise(r=>entered=r);
 s.provider.synthesize=()=>{calls++;entered();return new Promise(r=>release=r);};
 const first=s.call(promptRequest(s));await started;
 assert.equal((await s.call(promptRequest(s,'second-click'))).value.code,'voice_busy');
 release({audio_b64:'YQ==',content_type:'audio/mpeg'});assert.equal((await first).status,200);
 assert.equal((await s.call(promptRequest(s,'lost-response-retry'))).value.replayed,true);assert.equal(calls,1);
});
test('question changes during synthesis discard late audio; next task speaks its own prompt',async t=>{
 const s=setup(t);await s.event('read_complete');let release,entered;const started=new Promise(r=>entered=r);
 s.provider.synthesize=()=>{entered();return new Promise(r=>release=r);};
 const first=s.call(promptRequest(s));await started;
 await s.event('answer',{taskId:pkg.lesson.questions[0].id,optionIndex:pkg.lesson.questions[0].correct_index});
 release({audio_b64:'YQ==',content_type:'audio/mpeg'});assert.equal((await first).status,409);
 let spoken;s.provider.synthesize=async text=>{spoken=text;return{audio_b64:'YQ==',content_type:'audio/mpeg'};};
 assert.equal((await s.call(promptRequest(s,'next-question'))).status,200);assert.equal(spoken,pkg.lesson.questions[1].prompt_en);
});
test('speech failure cannot automatically recharge the same request; explicit retry can succeed',async t=>{
 const s=setup(t);await s.retell();let calls=0;
 s.provider.synthesize=async()=>{calls++;throw Error('provider_failure');};
 assert.equal((await s.call(promptRequest(s))).status,503);
 assert.equal((await s.call(promptRequest(s))).status,409);assert.equal(calls,1);
 let spoken;s.provider.synthesize=async text=>{calls++;spoken=text;return{audio_b64:'YQ==',content_type:'audio/mpeg'};};
 assert.equal((await s.call(promptRequest(s,'explicit-retry'))).status,200);assert.equal(spoken,pkg.lesson.retell.prompt_en);
 assert.equal(calls,2);assert.equal(s.state().stage,'retell');assert.equal(s.state().lastVoice,undefined);
 assert.deepEqual(s.store.db.prepare('SELECT state FROM story_voice_turns ORDER BY rowid').all().map(x=>x.state),['failed_or_unknown','succeeded']);
});
test('revoked account or withdrawn content during question speech never saves a playable result',async t=>{
 for(const revoke of ['account','content']){
  const s=setup(t);await s.event('read_complete');
  s.provider.synthesize=async()=>{if(revoke==='account')s.owner(null);else s.withdraw();return{audio_b64:'YQ==',content_type:'audio/mpeg'};};
  const result=await s.call(promptRequest(s));assert.equal(result.status,revoke==='account'?401:409);
  assert.equal(s.store.db.prepare('SELECT status FROM story_prompt_audio').get().status,'failed');
 }
});

test('question save failure keeps the charge recorded and never marks a cached recording ready',async t=>{
 const s=setup(t);await s.event('read_complete');const before=structuredClone(s.state());
 s.store.db.exec("CREATE TRIGGER refuse_prompt_save BEFORE UPDATE ON story_prompt_audio WHEN NEW.status='done' BEGIN SELECT RAISE(ABORT,'forced_failure'); END");
 assert.equal((await s.call(promptRequest(s))).status,503);assert.deepEqual(s.state(),before);
 assert.equal(s.store.db.prepare('SELECT status FROM story_prompt_audio').get().status,'failed');
 assert.equal(s.store.db.prepare('SELECT state FROM story_voice_turns').get().state,'succeeded');
 assert.equal((await s.call(promptRequest(s))).status,409);
});
test('aborting question speech reserves the attempt but stores no late recording',async t=>{
 const s=setup(t);await s.event('read_complete');let release,entered;const started=new Promise(r=>entered=r);
 s.provider.synthesize=()=>{entered();return new Promise(r=>release=r);};
 const controller=new AbortController(),request=new Request(promptRequest(s),{signal:controller.signal});
 const pending=s.call(request);await started;controller.abort();assert.equal((await pending).status,503);
 release({audio_b64:'YQ==',content_type:'audio/mpeg'});await new Promise(r=>setImmediate(r));
 assert.equal(s.store.db.prepare('SELECT status FROM story_prompt_audio').get().status,'failed');
 assert.equal(s.store.db.prepare('SELECT state FROM story_voice_turns').get().state,'failed_or_unknown');
});

test('looking back is recorded in assessed retelling and survives a rejected recording',async t=>{
 const s=setup(t);await s.retell();assert.equal((await s.event('reveal_retell_text')).status,200);
 assert.equal((await s.call()).status,200);assert.equal(s.state().lastVoice.support,'text');await s.event('reject_voice');
 assert.equal(s.state().retellSupport,'text');assert.equal((await s.call(s.request('after-rejection'))).status,200);assert.equal(s.state().lastVoice.support,'text');
 await s.event('continue_voice');assert.equal(s.state().missionResult.assessment.assisted,true);assert.equal(s.state().missionResult.assessment.independentSpokenRetelling,false);
 assert.equal(s.state().missionResult.award.diamonds,1000,'Existing reward amounts and score thresholds are unchanged');
});
test('Minny model-answer support cannot be downgraded by reopening the story',async t=>{
 const s=setup(t);await s.retell();s.provider.assess=async({task,transcript})=>({reliability:'confirmed',replySupport:'model',criteria:task.criteria.map(c=>({id:c.id,met:false,quote:''}))});
 await s.call();await s.event('reject_voice');assert.equal((await s.event('reveal_retell_text')).status,200);
 s.provider.assess=async({task,transcript})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript.slice(0,60)}))});
 assert.equal((await s.call(s.request('after-model'))).status,200);assert.equal(s.state().lastVoice.support,'model');await s.event('continue_voice');assert.equal(s.state().retelling,'needs_practice');
});

test('legacy pending retell from the visible-text reader is not newly credited as independent',async t=>{
 const s=setup(t);await s.retell();await s.call();const legacy=s.store.get('test-adult',s.state().sessionId);delete legacy.retellSupport;
 s.store.db.prepare('UPDATE story_sessions SET state=? WHERE id=?').run(JSON.stringify(legacy),legacy.sessionId);
 await s.event('continue_voice');assert.equal(s.state().retellSupport,'text');assert.equal(s.state().missionResult.assessment.independentSpokenRetelling,false);assert.equal(s.state().missionResult.assessment.assisted,true);
});

test('rejected retell feedback saves a replayable clarification, no grade, then permits a fresh corrected attempt',async t=>{
 const s=setup(t);await s.retell();s.provider.validateSafety=async()=>({valid:false,replySupport:'model'});
 const request=s.request('clarification-turn'),replay=request.clone(),first=await s.call(request);assert.equal(first.status,200);assert.equal(first.value.voice.reply,'Could you say that again, please?');
 assert.equal(first.value.view.session.lastVoice.assessed,false);assert.equal(s.state().lastVoice.evidence,null);assert.equal(s.state().voiceSupport['mission-retell'],'none');
 const persisted=s.store.voiceResult('test-adult',s.state().sessionId,'clarification-turn');assert.equal(persisted.assessment,'unassessed');assert.deepEqual(persisted.judgment.matchedCriteria,[]);
 const after=await s.event('continue_voice');assert.equal(after.value.session.stage,'retell');assert.equal(after.value.session.complete,false);assert.equal(after.value.session.awarded.diamonds,0);
 assert.equal((await s.call(replay)).value.replayed,true);assert.equal(s.calls(),1);
 s.provider.validateSafety=async()=>({valid:true,replySupport:'none'});const corrected=await s.call(s.request('new-corrected-turn'));assert.equal(corrected.status,200);const completed=await s.event('continue_voice');assert.equal(completed.value.session.complete,true);assert.equal(completed.value.session.awarded.diamonds,1000);assert.equal(s.calls(),2);
});

function helpOnlyProvider(s) {
 s.provider.transcribe=async()=> 'I do not remember. Can you help me?';
 s.provider.assess=async({task})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:false,quote:''}))});
 s.provider.respond=async()=>({reply:'What do you notice beside the bowl?',sentenceIds:['s7']});
 s.provider.validateSafety=async()=>({valid:true,replySupport:'hint'});
}
test('spoken help after an unsuccessful answer stays on the question until a helped correct answer',async t=>{
 const s=setup(t);await s.event('read_complete');helpOnlyProvider(s);
 for(let i=0;i<2;i++) {
  assert.equal((await s.call()).status,200);const next=await s.event('continue_voice');assert.equal(next.status,200);
  assert.equal(next.value.lesson.question.id,pkg.lesson.questions[0].id);assert.equal(next.value.session.feedback.result,'needs_practice');
  assert.equal(next.value.session.awarded.diamonds,0);
 }
 assert.equal(s.state().answers.length,2);assert.equal(s.state().voiceSupport[pkg.lesson.questions[0].id],'hint');
 s.provider.transcribe=async()=> 'The cup is beside a bowl.';
 s.provider.assess=async({task,transcript})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript}))});
 s.provider.respond=async()=>({reply:"That's right!",sentenceIds:['s7']});s.provider.validateSafety=async()=>({valid:true,replySupport:'none'});
 assert.equal((await s.call()).status,200);const next=await s.event('continue_voice');assert.equal(next.value.lesson.question.id,pkg.lesson.questions[1].id);
 assert.equal(next.value.session.feedback.assisted,true);assert.equal(next.value.session.feedback.result,'demonstrated');
});
test('spoken practice stays voluntary: explicit skip still moves on after repeated help',async t=>{
 const s=setup(t);await s.event('read_complete');helpOnlyProvider(s);
 for(let i=0;i<3;i++){assert.equal((await s.call()).status,200);assert.equal((await s.event('continue_voice')).value.lesson.question.id,pkg.lesson.questions[0].id);}
 const next=await s.event('skip_question',{taskId:pkg.lesson.questions[0].id});assert.equal(next.status,200);assert.equal(next.value.lesson.question.id,pkg.lesson.questions[1].id);
 assert.equal(next.value.session.feedback.result,'unassessed');assert.equal(s.state().answers.length,4);assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
});
test('incomplete spoken retelling keeps its hint and stays open until the learner explicitly defers',async t=>{
 const s=setup(t);await s.retell();helpOnlyProvider(s);
 for(let i=0;i<3;i++){assert.equal((await s.call()).status,200);const next=await s.event('continue_voice');assert.equal(next.value.session.stage,'retell');assert.equal(next.value.session.complete,false);assert.equal(next.value.session.awarded.diamonds,0);}
 assert.equal(s.state().retellTries,3);assert.equal(s.state().voiceSupport['mission-retell'],'hint');
 const deferred=await s.event('retell_unassessed');assert.equal(deferred.status,200);assert.equal(deferred.value.session.stage,'reward');assert.equal(deferred.value.session.complete,false);assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
});

test('child discussion is durable conversation, not a failed answer, and preserves later help',async t=>{
 const s=setup(t);await s.event('read_complete');const first=s.state();
 let discussionCalls=0;s.provider.transcribe=async()=>{discussionCalls++;return 'Where is the cup?';};
 s.provider.assess=async({task})=>({intent:'story_question',reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:'cup'}))});
 s.provider.respond=async()=>({reply:'The cup is beside a bowl.',sentenceIds:['s7']});
 s.provider.validateSafety=async({lesson,task})=>({valid:true,replySupport:'none',taskSupport:storyDiscussionTasks(lesson,task).map((x,i)=>({taskId:x.id,support:i===1?'model':x.kind==='retell'?'hint':'none'}))});
 const request=s.request(),replay=request.clone();const response=await s.call(request);
 assert.equal(response.status,200,JSON.stringify(response.value));assert.equal(response.value.view.session.lastVoice.assessed,false);
 assert.equal(s.state().lastVoice.intent,'story_question');assert.equal(s.state().lastVoice.evidence,null);
 assert.equal((await s.call(replay)).status,200);assert.equal(discussionCalls,1);
 const reopened=new PrivateStoryStore(s.data);try{
  const state=reopened.get('test-adult',s.state().sessionId);
  assert.equal(state.lastVoice.intent,'story_question');assert.equal(state.voiceSupport[pkg.lesson.questions[1].id],'model');
  assert.equal(state.voiceSupport['mission-retell'],'hint');assert.equal(state.voiceSupport['mission-recall'],undefined);
 }finally{reopened.close();}
 await s.event('continue_voice');assert.equal(s.state().questionIndex,first.questionIndex);assert.equal(s.state().tries,first.tries);
 assert.deepEqual(s.state().answers,first.answers);assert.equal(s.state().stage,'understand');
 assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
 // A genuine answer still progresses, but later copied information is not independent.
 const q1=pkg.lesson.questions[0];await s.event('answer',{taskId:q1.id,optionIndex:q1.correct_index});
 const q2=pkg.lesson.questions[1];await s.event('answer',{taskId:q2.id,optionIndex:q2.correct_index});
 assert.equal(s.state().answers.at(-1).support,'model');assert.equal(s.state().answers.at(-1).result,'needs_practice');
});

test('retell and delayed-recall discussion preserve attempts and cannot complete or award',async t=>{
 for(const stage of ['retell','recall'])await t.test(stage,async t=>{
  const s=setup(t);await s.retell();
  if(stage==='recall') {await s.call();await s.event('continue_voice');s.advanceClock(86400001);assert.equal((await s.event('start_recall')).status,200);}
  const before=structuredClone(s.state()),balance=s.store.db.prepare('SELECT * FROM story_test_wallets').all();
  s.provider.transcribe=async()=> 'Could you explain this story?';
  s.provider.assess=async({task})=>({intent:'story_question',reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:false,quote:''}))});
  s.provider.respond=async()=>({reply:'The story is about finding the cup.',sentenceIds:['s7']});
  s.provider.validateSafety=async({lesson,task})=>({valid:true,replySupport:'model',taskSupport:storyDiscussionTasks(lesson,task).map(x=>({taskId:x.id,support:x.id===task.id?'model':'none'}))});
  assert.equal((await s.call()).status,200);await s.event('continue_voice');
  assert.equal(s.state().stage,stage);assert.equal(s.state().retellTries,before.retellTries);assert.equal(s.state().retelling,before.retelling);
  assert.deepEqual(s.state().answers,before.answers);assert.deepEqual(s.store.db.prepare('SELECT * FROM story_test_wallets').all(),balance);
  assert.equal(s.state().voiceSupport[stage==='retell'?'mission-retell':'mission-recall'],'model');
 });
});
