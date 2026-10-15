import test from 'node:test';
import {storyRubric} from '../functions/lib/read2lead/story-rubric.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStoryVoiceTurn, storyVoicePrompt, validateStoryVoiceReply, createStoryVoiceProvider, createMinnyStoryProvider, STORY_VOICE_CLARIFICATION } from '../functions/lib/read2lead/story-voice.mjs';
import { validateStoryBudget } from '../functions/lib/read2lead/story-budget.mjs';
import { PrivateStoryStore } from '../scripts/lib/read2lead-story-store.mjs';
import { PrivateStoryBudgetStore } from '../scripts/lib/read2lead-story-budget-store.mjs';
import { initializeSyntheticTarget } from '../scripts/read2lead-local-qa.mjs';
const lesson=JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url))).lesson;
const config={month:'2026-09',baselineReconciled:true,existingCostsMicroUsd:30_000_000,approvedVoiceMicroUsd:1_000_000,worstCaseTurnMicroUsd:100_000,maxTurns:2};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-voice-')),data=path.join(root,'data');initializeSyntheticTarget(data);
 const store=new PrivateStoryStore(data),state=store.open('adult-test',lesson),budget=new PrivateStoryBudgetStore(store,config,()=>new Date('2026-09-27T00:00:00Z'));
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const calls=[];
 const provider={transcribe:async()=>{calls.push('stt');return 'The cup is beside a bowl.';},respond:async()=>{calls.push('llm');return{reply:'You found the cup. What does Linh do next?',sentenceIds:['s7']};},validateSafety:async()=>{calls.push('guard');return true;},synthesize:async()=>{calls.push('tts');return{audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};}};
 const input={activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true},provider,budget,sessionId:state.sessionId,requestId:'voice-turn-1',lesson,task:{prompt:lesson.questions[0].prompt_en},audio:new Blob(['synthetic audio contract bytes'],{type:'audio/webm'})};
 return{input,calls,store,budget,state,data};
}
test('unapproved, unreconciled and over-ceiling voice makes no provider calls',async t=>{
 const s=fixture(t);await assert.rejects(runStoryVoiceTurn({...s.input,activation:{}}),/not_authorized/);assert.deepEqual(s.calls,[]);
 assert.throws(()=>validateStoryBudget({...config,baselineReconciled:false}),/not_reconciled/);
 assert.throws(()=>validateStoryBudget({...config,existingCostsMicroUsd:40_000_000}),/not_reconciled/);
 assert.throws(()=>validateStoryBudget({...config,maxTurns:9}),/not_reconciled/);
 assert.throws(()=>createStoryVoiceProvider({}),/provider_required/);
});
test('reserved STT→response→guard→TTS is practice only; duplicate cannot call provider again',async t=>{
 const s=fixture(t),result=await runStoryVoiceTurn(s.input);assert.deepEqual(s.calls,['stt','llm','guard','tts']);assert.equal(result.assessment,'unassessed');assert.equal(result.rewardsAwarded,false);
 await assert.rejects(runStoryVoiceTurn(s.input),/already_claimed/);assert.equal(s.calls.length,4);
 const row=s.store.db.prepare('SELECT reserved FROM story_voice_reservations').get();assert.equal(row.reserved,200_000);
});
test('bad citations, links, phone numbers and reward claims are replaced before TTS',async t=>{
 const s=fixture(t);
 for(const reply of [{reply:'Here are 1000 diamonds.',sentenceIds:['s7']},{reply:'Visit https://example.com',sentenceIds:['s7']},{reply:'Call 01234567890.',sentenceIds:['s7']},{reply:'Well done.',sentenceIds:['invented']}])assert.throws(()=>validateStoryVoiceReply(reply,lesson),/invalid_story_reply/);
 s.input.provider.respond=async()=>({reply:'I give you a reward.',sentenceIds:['s7']});let spoken;s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};const result=await runStoryVoiceTurn(s.input);assert.deepEqual(s.calls,['stt']);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.assessment,'unassessed');assert.deepEqual(result.judgment.matchedCriteria,[]);
 assert.equal(s.store.db.prepare('SELECT state FROM story_voice_turns').get().state,'succeeded');
});
test('rejected response becomes only a safe ungraded clarification; blank capture remains refused',async t=>{
 const s=fixture(t);s.input.provider.validateSafety=async()=>false;let spoken;s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.reply,STORY_VOICE_CLARIFICATION);assert.equal(result.assessment,'unassessed');assert.deepEqual(result.judgment.matchedCriteria,[]);
 s.input.requestId='voice-turn-2';s.input.provider.transcribe=async()=>'';await assert.rejects(runStoryVoiceTurn(s.input),/unclear/);
 s.input.requestId='voice-turn-3';await assert.rejects(runStoryVoiceTurn(s.input),/turn_limit/);
});
test('neutral follow-up may omit citations, but uncited statements and ungrounded questions cannot reach speech',async t=>{
 const reply={reply:'I see. What color is the sky usually?',sentenceIds:[]};
 assert.deepEqual(validateStoryVoiceReply(reply,lesson),reply);
 assert.throws(()=>validateStoryVoiceReply({reply:'The city sky is green.',sentenceIds:[]},lesson),/invalid_story_reply/);
 assert.throws(()=>validateStoryVoiceReply({reply:'The city sky is green. Why?',sentenceIds:[]},lesson),/invalid_story_reply/);
 assert.throws(()=>validateStoryVoiceReply({reply:'That is sentence s7.',sentenceIds:['s7']},lesson),/invalid_story_reply/);
 const s=fixture(t);s.input.provider.respond=async()=>({reply:'Why is the city sky green?',sentenceIds:[]});
 s.input.provider.validateSafety=async()=>false;
 let spoken;s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.assessment,'unassessed');
});
test('interruption prevents later synthesis and keeps unknown-cost reservation',async t=>{
 const s=fixture(t),abort=new AbortController();let started;
 const waiting=new Promise(resolve=>started=resolve);
 s.input.provider.respond=async()=>{started();return new Promise(()=>{});};
 const turn=runStoryVoiceTurn({...s.input,signal:abort.signal});await waiting;abort.abort();
 await assert.rejects(turn,/interrupted/);assert.equal(s.calls.includes('tts'),false);
 assert.equal(s.store.db.prepare('SELECT reserved FROM story_voice_reservations').get().reserved,200_000);
});
test('selected reasoning assessor may finish after15seconds without changing other provider defaults',async t=>{
 const s=fixture(t),selected=createMinnyStoryProvider({env:{AI:{run(){throw Error('must not call native provider');}}},assessor:'gpt-oss-120b'});
 assert.equal(selected.assessmentTimeoutMs,30000);assert.equal(createMinnyStoryProvider({env:{AI:{}}}).assessmentTimeoutMs,undefined);
 t.mock.timers.enable({apis:['setTimeout']});let started;const waiting=new Promise(resolve=>started=resolve);
 s.input.activation.assessorValidated=true;s.input.task.criteria=[{id:'meaning',meaning:'The cup is beside a bowl.'}];s.input.provider.assessmentTimeoutMs=selected.assessmentTimeoutMs;
 s.input.provider.assess=()=>{started();return new Promise(resolve=>setTimeout(()=>resolve({reliability:'confirmed',criteria:[{id:'meaning',met:true,quote:'The cup is beside a bowl.'}],replySupport:'none'}),16000));};
 const turn=runStoryVoiceTurn(s.input);await waiting;t.mock.timers.tick(16000);const result=await turn;
 assert.equal(result.assessment,'server_validated');assert.deepEqual(result.judgment.matchedCriteria,['meaning']);assert.equal(s.calls.filter(x=>x==='tts').length,1);
});
for(const [label,configured,limit] of [['reasoning',30000,30000],['legacy',undefined,15000],['unrecognized',999999,15000]])
test(label+' assessor timeout aborts once, keeps reservation and cannot reach reply or speech',async t=>{
 const s=fixture(t);t.mock.timers.enable({apis:['setTimeout']});let started,phaseSignal,attempts=0;const waiting=new Promise(resolve=>started=resolve);
 s.input.activation.assessorValidated=true;s.input.task.criteria=[{id:'meaning',meaning:'The cup is beside a bowl.'}];s.input.provider.assessmentTimeoutMs=configured;
 s.input.provider.assess=({signal})=>{attempts++;phaseSignal=signal;started();return new Promise(()=>{});};
 const turn=runStoryVoiceTurn(s.input),rejection=assert.rejects(turn,e=>e.message==='story_voice_timeout'&&e.storyVoicePhase==='assessment');await waiting;t.mock.timers.tick(limit);await rejection;
 assert.equal(phaseSignal.aborted,true);assert.equal(attempts,1);assert.deepEqual(s.calls,['stt']);assert.equal(s.store.db.prepare('SELECT state FROM story_voice_turns').get().state,'failed_or_unknown');
});
test('two SQLite connections share budget reservations, replay claims and the hard cap',async t=>{
 const s=fixture(t),other=new PrivateStoryStore(s.data);t.after(()=>other.close());
 const second=new PrivateStoryBudgetStore(other,{...config,approvedVoiceMicroUsd:200_000},()=>new Date('2026-09-27T00:00:00Z'));
 second.claim(s.state.sessionId,'request-1');
 const same=new PrivateStoryBudgetStore(s.store,{...config,approvedVoiceMicroUsd:200_000},()=>new Date('2026-09-27T00:00:00Z'));
 assert.throws(()=>same.claim(s.state.sessionId,'request-1'),/already_claimed/);
 const another=s.store.open('another-adult',lesson);assert.throws(()=>same.reserve(another.sessionId),/exhausted/);
 const expired=new PrivateStoryBudgetStore(s.store,config,()=>new Date('2026-10-01T00:00:00Z'));assert.throws(()=>expired.reserve(s.state.sessionId),/expired/);
});

test('real provider message boundary judges learner before feedback and independently classifies future help',async t=>{
 const s=fixture(t),requests=[];
 const real=createMinnyStoryProvider({env:{AI:{},OPENROUTER_API_KEY:'fabricated-test-only'},fetchFn:async(_url,options)=>{
  const input=JSON.parse(options.body),system=input.messages[0].content,context=JSON.parse(input.messages[1].content);requests.push({system,context});
  let content;
  if(system.startsWith('Assess ')){
   content={intent:'answer',reliability:'confirmed',criteria:[{id:'meaning',met:true,quote:'The cup'}],replySupport:'none'};
  }else if(system.startsWith('You are Minny')){
   assert.deepEqual(context.learnerAssessment.matchedCriteria,['meaning']);assert.equal(context.learnerAssessment.allCriteriaMet,true);assert.equal(context.previousTurn,null);
   content={reply:'You found the cup. What does Linh do next?',sentenceIds:['s7']};
  }else{
   assert.ok(system.startsWith('Check '));assert.deepEqual(context.learnerAssessment.matchedCriteria,['meaning']);
   assert.equal(context.reply,'You found the cup. What does Linh do next?');
   content={safe:true,grounded:true,staysOnTask:true,replySupport:'model'};
  }
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
 }});
 s.input.task={id:'meaning-task',prompt:'What did Linh find?',source:'story',criteria:[{id:'meaning',meaning:'The cup'}],previousTurn:{transcript:'The cup',reply:'WRONG TUTOR HISTORY'}};
 s.input.activation.assessorValidated=true;
 Object.assign(s.input.provider,{assess:real.assess,respond:real.respond,validateSafety:real.validateSafety});
 // Caller-supplied reply is deliberately ignored by the actual assessor adapter.
 await real.assess({...s.input,transcript:'The cup',reply:'WRONG TUTOR HISTORY'});
 const assessorInput=requests[0].context;assert.equal('reply' in assessorInput,false);assert.equal('previousTurn' in assessorInput.task,false);assert.equal(JSON.stringify(assessorInput).includes('WRONG TUTOR HISTORY'),false);requests.length=0;
 const result=await runStoryVoiceTurn(s.input);
 assert.equal(requests.length,3);assert.ok(requests[0].system.startsWith('Assess '));assert.ok(requests[1].system.startsWith('You are Minny'));assert.ok(requests[2].system.startsWith('Check '));
 assert.deepEqual(result.judgment,{intent:'answer',reliability:'confirmed',matchedCriteria:['meaning'],replySupport:'model'});
 assert.equal(result.assessment,'server_validated');assert.equal(result.rewardsAwarded,false);
});
test('invalid or unsafe feedback is replaced with the fixed clarification, never granted evidence',async t=>{
 for(const safety of [{valid:true,replySupport:'unknown'},{valid:false,replySupport:'none'},{valid:true,replySupport:'none',extra:true}])await t.test(JSON.stringify(safety),async t=>{
  const s=fixture(t);s.input.provider.validateSafety=async()=>safety;
  let spoken;s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.assessment,'unassessed');assert.deepEqual(result.judgment,{reliability:'uncertain',matchedCriteria:[],replySupport:'none'});
 });
});

test('uncertain assessment requests another try without generating feedback or awarding criteria',async t=>{
 const s=fixture(t);s.input.task={id:'meaning',prompt:'Where is the cup?',criteria:[{id:'meaning',meaning:'by the bowl'}]};
 s.input.activation.assessorValidated=true;s.input.provider.assess=async()=>({reliability:'uncertain',criteria:[{id:'meaning',met:false,quote:''}],replySupport:'none'});
 s.input.provider.respond=async()=>{throw Error('No generated feedback for uncertain evidence');};s.input.provider.validateSafety=async()=>{throw Error('Fixed clarification needs no model call');};
 let spoken;s.input.provider.synthesize=async text=>{spoken=text;return{audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};
 const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.transcript,'The cup is beside a bowl.');assert.equal(result.assessment,'unassessed');assert.equal(result.rewardsAwarded,false);assert.deepEqual(result.judgment,{reliability:'uncertain',matchedCriteria:[],replySupport:'none'});
});

test('clear help reaches grounded feedback without manufacturing answer evidence',async t=>{
 for(const transcript of ['Please give me a hint for my retelling.','I do not know.']){
  const s=fixture(t),requests=[];
  s.input.task={...storyRubric(lesson).tasks[0],source:'story',prompt:'Where is the cup?',criteria:[{id:'meaning',meaning:'beside a bowl'}]};
  const real=createMinnyStoryProvider({env:{AI:{},OPENROUTER_API_KEY:'fabricated-test-only'},fetchFn:async(_url,options)=>{
   const input=JSON.parse(options.body),system=input.messages[0].content,context=JSON.parse(input.messages[1].content);requests.push(system);
   let content;
   if(system.startsWith('Assess ')){
    assert.match(system,/A clear request for a hint\/help.*is confirmed, not uncertain/);
    assert.match(system,/Such a request alone has every met false and every quote empty/);
    assert.equal(context.transcript,transcript);
    content={intent:'help',reliability:'confirmed',criteria:[{id:'meaning',met:false,quote:''}],replySupport:'none'};
   }else if(system.startsWith('You are Minny')){
    assert.match(system,/Do not ask them to repeat a clear help request/);
    assert.equal(context.learnerAssessment.allCriteriaMet,false);assert.deepEqual(context.learnerAssessment.matchedCriteria,[]);
    content={reply:'What is beside the cup?',sentenceIds:[]};
   }else{
    assert.match(system,/A clear request for help or admission of not knowing is on-task/);
    assert.deepEqual(context.learnerAssessment.matchedCriteria,[]);
    content={safe:true,grounded:true,staysOnTask:true,replySupport:'hint',taskSupport:context.lessonTasks.map(t=>({taskId:t.id,support:t.id===context.task.id?'hint':'none'}))};
   }
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
  }});
  Object.assign(s.input.provider,{assess:real.assess,respond:real.respond,validateSafety:real.validateSafety,transcribe:async()=>transcript});
  s.input.activation={externalProcessingApproved:true,spendingApproved:true,adultTrialApproved:true,assessorTrial:true};s.input.practiceTrial=true;
  const result=await runStoryVoiceTurn(s.input);
  assert.equal(requests.length,3);assert.equal(result.reply,'What is beside the cup?');
  assert.deepEqual(result.judgment,{intent:'help',reliability:'confirmed',matchedCriteria:[],replySupport:'hint',taskSupport:storyRubric(lesson).tasks.map(t=>({taskId:t.id,support:t.id===s.input.task.id?'hint':'none'}))});
  assert.equal(result.assessment,'unassessed');assert.equal(result.rewardsAwarded,false);
 }
});

test('returned malformed or uncited feedback cannot retain a confirmed assessment',async t=>{
 for(const proposed of [{reply:'Nice retelling.',sentenceIds:[]},{reply:'A correct response.',sentenceIds:['missing']},{reply:'x'.repeat(221),sentenceIds:['s7']},'{malformed'])await t.test(JSON.stringify(proposed),async t=>{
  const s=fixture(t);s.input.task={id:'meaning',prompt:'Where is the cup?',criteria:[{id:'meaning',meaning:'by the bowl'}]};s.input.activation.assessorValidated=true;
  s.input.provider.assess=async()=>({reliability:'confirmed',criteria:[{id:'meaning',met:true,quote:'beside a bowl'}],replySupport:'none'});
  s.input.provider.respond=async()=>proposed;s.input.provider.validateSafety=async()=>{throw Error('Rejected reply must be discarded before model safety');};
  let spoken;s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};
  const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.assessment,'unassessed');assert.equal(result.rewardsAwarded,false);assert.deepEqual(result.judgment,{reliability:'uncertain',matchedCriteria:[],replySupport:'none'});
 });
});

test('uncited acknowledgments and verified confirmations do not invent story citations',()=>{
 const checked={id:'meaning',source:'story',criteria:[{id:'meaning'}],learnerAssessment:{reliability:'confirmed',matchedCriteria:['meaning']}};
 for(const text of ['Thank you.','Thanks for sharing your ideas!','I see.'])assert.equal(validateStoryVoiceReply({reply:text,sentenceIds:[]},lesson).reply,text);
 for(const text of ["That's correct!",'That is right.','You got it!'])assert.equal(validateStoryVoiceReply({reply:text,sentenceIds:[]},lesson,checked).reply,text);
 for(const text of ["That's correct! The sky is green.",'Thank you. The city sky is green.','The city sky is blue.'])assert.throws(()=>validateStoryVoiceReply({reply:text,sentenceIds:[]},lesson,checked),/invalid_story_reply/);
 assert.throws(()=>validateStoryVoiceReply({reply:"That's correct!",sentenceIds:[]},lesson),/invalid_story_reply/);
 assert.throws(()=>validateStoryVoiceReply({reply:'Thank you.',sentenceIds:['invented']},lesson,checked),/invalid_story_reply/);
});

test('uncited confirmation uses current learner evidence and still passes safety before speech',async t=>{
 for(const correct of [true,false])await t.test(correct?'correct answer':'wrong answer',async t=>{
  const s=fixture(t);s.input.task={id:'meaning',source:'story',prompt:'Where is the cup?',criteria:[{id:'meaning',meaning:'beside a bowl'}]};s.input.activation.assessorValidated=true;
  s.input.provider.assess=async()=>({reliability:'confirmed',criteria:[{id:'meaning',met:correct,quote:correct?'beside a bowl':''}],replySupport:'none'});
  s.input.provider.respond=async()=>({reply:"That's correct!",sentenceIds:[]});let safetyCalls=0,spoken;
  s.input.provider.validateSafety=async input=>{safetyCalls++;assert.deepEqual(input.judgment.matchedCriteria,['meaning']);return {valid:true,replySupport:'none'};};
  s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};
  const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,correct?"That's correct!":STORY_VOICE_CLARIFICATION);assert.equal(safetyCalls,correct?1:0);
  assert.equal(result.assessment,correct?'server_validated':'unassessed');assert.deepEqual(result.judgment.matchedCriteria,correct?['meaning']:[]);assert.equal(result.rewardsAwarded,false);
 });
});

test('partial or uncertain evidence cannot authorize explicit confirmation even with valid citations',()=>{
 for(const evidence of [{reliability:'confirmed',matchedCriteria:['fact-1']},{reliability:'uncertain',matchedCriteria:[]}]){
  const task={source:'story',criteria:[{id:'fact-1'},{id:'fact-2'}],learnerAssessment:evidence};
  for(const sentenceIds of [[],['s7']])assert.throws(()=>validateStoryVoiceReply({reply:"That's right!",sentenceIds},lesson,task),/invalid_story_reply/);
 }
});

test('story questions use grounded discussion and complete help classification at the real adapter boundary',async t=>{
 const {storyRubric,storyDiscussionTasks}=await import('../functions/lib/read2lead/story-rubric.mjs');
 const s=fixture(t),task=storyRubric(lesson).tasks[0],requests=[];
 task.previousTurn={transcript:'What did Linh find?',reply:'She found the cup.'};
 const followup=JSON.parse(storyVoicePrompt(lesson,{...task,learnerAssessment:{intent:'story_question',reliability:'confirmed',matchedCriteria:[]}},'Why?')[1].content);
 assert.deepEqual(followup.previousTurn,task.previousTurn,'A follow-up question needs the previous exchange');
 const supports=storyDiscussionTasks(lesson,task).map(t=>({taskId:t.id,support:'none'}));
 let safety={safe:true,grounded:true,staysOnTask:true,replySupport:'none',taskSupport:supports};
 const real=createMinnyStoryProvider({env:{AI:{},OPENROUTER_API_KEY:'fabricated-test-only'},fetchFn:async(_url,options)=>{
  const input=JSON.parse(options.body),system=input.messages[0].content,context=JSON.parse(input.messages[1].content);requests.push({system,context,maxTokens:input.max_tokens});
  let content;
  if(system.startsWith('Assess ')){assert.equal(JSON.stringify(context).includes('She found the cup.'),false);content={intent:'story_question',reliability:'confirmed',criteria:task.criteria.map(c=>({id:c.id,met:false,quote:''})),replySupport:'none'};}
  else if(system.startsWith('You are Minny')) {
   assert.equal(context.learnerAssessment.intent,'story_question');assert.equal(context.learnerAssessment.allCriteriaMet,false);
   assert.deepEqual(context.previousTurn,task.previousTurn);
   assert.ok(context.lessonTasks.length>1);assert.match(system,/respond to the child’s own question/);
   content={reply:'The story does not say which city.',sentenceIds:[]};
  } else {
   assert.equal(context.interaction,'story_question');assert.deepEqual(context.previousTurn,task.previousTurn);assert.deepEqual(context.lessonTasks.map(t=>t.id),supports.map(t=>t.taskId));
   assert.match(system,/include later questions and retell facts/);content=safety;
  }
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
 }});
 Object.assign(s.input.provider,{assess:real.assess,respond:real.respond,validateSafety:real.validateSafety});
 s.input.provider.transcribe=async()=> 'Which city does this story happen in?';
 s.input.task=task;s.input.activation.assessorValidated=true;
 const result=await runStoryVoiceTurn(s.input);
 assert.equal(requests.length,3);assert.equal(result.reply,'The story does not say which city.');assert.equal(result.assessment,'unassessed');
 assert.equal(result.judgment.intent,'story_question');assert.deepEqual(result.judgment.matchedCriteria,[]);assert.deepEqual(result.judgment.taskSupport,supports);
 // Complete support must be present, unique, scoped and consistent; unsafe speech never reaches TTS.
 const input={lesson,task,transcript:'Which city?',reply:'The story does not say.',judgment:{intent:'story_question',reliability:'confirmed',matchedCriteria:[],replySupport:'none'}};
 for(const broken of [
  {...safety,taskSupport:undefined}, {...safety,taskSupport:supports.slice(1)},
  {...safety,taskSupport:supports.map((v,i)=>i===1?supports[0]:v)},
  {...safety,taskSupport:supports.map((v,i)=>i===0?{...v,taskId:'invented'}:v)},
  {...safety,replySupport:'model'}, {...safety,grounded:false},
 ]) {safety=broken;const checked=await real.validateSafety(input);assert.ok(checked===false||checked.valid===false);}
});

test('discussion cannot skip support validation with legacy boolean safety or incomplete metadata',async t=>{
 const {storyRubric,storyDiscussionTasks}=await import('../functions/lib/read2lead/story-rubric.mjs');
 for(const kind of ['boolean','missing','mismatch'])await t.test(kind,async t=>{
  const s=fixture(t);s.input.task=storyRubric(lesson).tasks[0];s.input.activation.assessorValidated=true;
  s.input.provider.assess=async()=>({intent:'story_question',reliability:'confirmed',criteria:s.input.task.criteria.map(c=>({id:c.id,met:false,quote:''})),replySupport:'none'});
  s.input.provider.respond=async()=>({reply:'The story does not say.',sentenceIds:[]});
  s.input.provider.validateSafety=async()=>kind==='boolean'?true:kind==='missing'?{valid:true,replySupport:'none'}:
   {valid:true,replySupport:'model',taskSupport:storyDiscussionTasks(lesson,s.input.task).map(t=>({taskId:t.id,support:'none'}))};
  let spoken;s.input.provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};
  const result=await runStoryVoiceTurn(s.input);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.equal(result.assessment,'unassessed');
  assert.deepEqual(result.judgment.matchedCriteria,[]);
 });
});

 test('fresh legacy provider judgments require intent while saved legacy evidence stays compatible',async()=>{
  const provider=createMinnyStoryProvider({env:{AI:{},OPENROUTER_API_KEY:'local-fake'},fetchFn:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reliability:'confirmed',criteria:[],replySupport:'none'})}}]})});
  await assert.rejects(provider.assess({lesson,task:storyRubric(lesson).tasks[0],transcript:'Is it blue?'}),/invalid_semantic_judgment/);
 });


test('interview safety accepts harmless assessment echo without trusting it or weakening verdicts',async()=>{
 const story=structuredClone(lesson);story.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
 const task=storyRubric(lesson).tasks[0],judgment={reliability:'confirmed',matchedCriteria:[],replySupport:'none',intent:'answer'};
 const good={safe:true,grounded:true,staysOnTask:true,replySupport:'model',learnerAssessment:{reliability:'confirmed',matchedCriteria:[],intent:'answer'}};
 let raw=good;
 const provider=createMinnyStoryProvider({env:{AI:{async run(){return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]};}}}});
 const input={lesson:story,task,transcript:'A car!',reply:'The uncle sends a picture.',judgment};
 assert.deepEqual(await provider.validateSafety(input),{valid:true,replySupport:'model'});
 assert.deepEqual(judgment,{reliability:'confirmed',matchedCriteria:[],replySupport:'none',intent:'answer'});
 // The echo never becomes evidence or changes the four required safety values.
 raw={...good,learnerAssessment:{matchedCriteria:['invented'],safe:true}};
 assert.deepEqual(await provider.validateSafety(input),{valid:true,replySupport:'model'});
 for(const broken of [{...good,safe:false},{...good,grounded:false},{...good,staysOnTask:false},
   {...good,safe:'true'},{...good,replySupport:'unknown'},{...good,grounded:undefined},
   {...good,extra:true}]) {
  raw=broken;const result=await provider.validateSafety(input);assert.ok(result===false||result.valid===false);
 }
 raw=good;assert.equal(await provider.validateSafety({...input,lesson}),false,'legacy schema unchanged');
});
