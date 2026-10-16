import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PrivateStoryStore} from '../scripts/lib/read2lead-story-store.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {validateStoryBudget} from '../functions/lib/read2lead/story-budget.mjs';
import {initializeSyntheticTarget} from '../scripts/read2lead-local-qa.mjs';
import {validatePublisherPackage} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {storyRubric,savedStoryAttempt} from '../functions/lib/read2lead/story-rubric.mjs';
import {newStorySession,advanceStorySession,storySessionView} from '../functions/lib/read2lead/story-session.mjs';
import {assessStoryMission,completeStoryRecall,emptyStoryRewardLedger} from '../functions/lib/read2lead/story-assessment.mjs';
import {createPrivateSiteApi,PRIVATE_SITE_CODE} from '../functions/lib/read2lead/private-site.mjs';
import {storyVoicePrompt,runStoryVoiceTurn} from '../functions/lib/read2lead/story-voice.mjs';
import {storyAssessorMessages} from '../functions/lib/read2lead/story-assessor.mjs';

// Synthetic contract evidence only; this does not prove provider accuracy or microphone operation.
const fixture=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url)));
function interview() {
  const p=fixture(),l=p.lesson,q=l.questions[0];
  l.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
  l.questions=Array.from({length:12},(_,i)=>({...structuredClone(q),id:'interview-q'+(i+1),
    prompt_en:`Synthetic contract slot ${i+1}: ${q.prompt_en}`,source:'story',dimension:'meaning'}));
  return p;
}
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-interview-')),data=path.join(root,'data');
  initializeSyntheticTarget(data);
  const store=new PrivateStoryStore(data),lesson=interview().lesson,owner='test-owner';
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  let state=store.open(owner,lesson),serial=0;
  const send=event=>state=store.event(owner,lesson,{sessionId:state.sessionId,revision:state.revision,requestId:'event-'+serial++,event}).state;
  const speak=(options={})=>{
    const input={sessionId:state.sessionId,revision:state.revision,requestId:'voice-'+serial++};
    store.beginVoice(owner,lesson,input,'synthetic-'+input.requestId);
    state=store.finishVoice(owner,lesson,input,{transcript:'Synthetic answer',reply:'Synthetic feedback',assessment:'server_validated',
      judgment:{reliability:options.reliability||'confirmed',matchedCriteria:options.correct?['meaning']:[],replySupport:'none',intent:options.intent||'answer'}});
    return state;
  };
  send({type:'read_complete'});
  return {store,lesson,owner,data,send,speak,get state(){return state;}};
}

test('explicit capped batch funds all twelve prompts and answers; retries, expiry and money remain bounded',t=>{
  const s=setup(t);
  // Fabricated test prices, NOT a quote or permission for real providers.
  const config={scope:'batch',batchId:'synthetic-interview-budget',expiresAt:'2030-01-02T00:00:00.000Z',
    approvedVoiceMicroUsd:32000,worstCaseTurnMicroUsd:1000,maxTurns:32};
  const budget=new PrivateStoryBudgetStore(s.store,config,()=>new Date('2030-01-01'));
  for(let i=0;i<12;i++)for(const kind of ['prompt','answer']){
    const request=kind+'-'+i;budget.claim(s.state.sessionId,request);budget.finish(s.state.sessionId,request,'succeeded');
  }
  for(let i=0;i<8;i++){budget.claim(s.state.sessionId,'retry-'+i);budget.finish(s.state.sessionId,'retry-'+i,'failed_or_unknown');}
  assert.throws(()=>budget.claim(s.state.sessionId,'one-too-many'),/voice_turn_limit/);
  assert.throws(()=>budget.claim(s.state.sessionId,'answer-0'),/already_claimed/);
  const row=s.store.db.prepare('SELECT reserved FROM story_voice_reservations').get();assert.equal(row.reserved,32000);
  const another=s.store.open('another-synthetic-owner',s.lesson);
  assert.throws(()=>budget.claim(another.sessionId,'second-session'),/budget_exhausted/);
  assert.throws(()=>validateStoryBudget({...config,approvedVoiceMicroUsd:31999}),/batch_budget_invalid/);
  assert.throws(()=>validateStoryBudget({...config,maxTurns:33,approvedVoiceMicroUsd:33000}),/batch_budget_invalid/);
  const reopened=new PrivateStoryBudgetStore(s.store,config,()=>new Date('2030-01-01'));
  assert.throws(()=>reopened.claim(s.state.sessionId,'restart-extra'),/voice_turn_limit/);
  const changed=new PrivateStoryBudgetStore(s.store,{...config,maxTurns:24},()=>new Date('2030-01-01'));
  assert.throws(()=>changed.claim(s.state.sessionId,'changed-grant'),/config_conflict/);
  const expired=new PrivateStoryBudgetStore(s.store,config,()=>new Date('2030-01-02'));
  assert.throws(()=>expired.claim(s.state.sessionId,'expired'),/batch_expired/);
  assert.throws(()=>validateStoryBudget({month:'2030-01',baselineReconciled:true,existingCostsMicroUsd:0,
    approvedVoiceMicroUsd:32000,worstCaseTurnMicroUsd:1000,maxTurns:9}),/not_reconciled/);
});

test('publisher requires exactly twelve distinct story prompts for interviews; legacy stays three',async()=>{
  await validatePublisherPackage(fixture());await validatePublisherPackage(interview());
  for(const change of [p=>p.lesson.questions.pop(),p=>p.lesson.questions.push({...p.lesson.questions[0],id:'thirteen'}),
    p=>delete p.lesson.interview,p=>p.lesson.interview.completion_diamonds=1000,
    p=>p.lesson.questions[1].prompt_en=p.lesson.questions[0].prompt_en,
    p=>p.lesson.questions[0].source='new_scenario',p=>p.lesson.questions[0].dimension='transfer',
    p=>p.lesson.questions[0].evidence_spans[0].quote='Invented story fact']) {
    const p=interview();change(p);await assert.rejects(validatePublisherPackage(p),/invalid_publisher/);
  }
});

test('interview grader receives alternate short answers as alternatives, not combined requirements',()=>{
  const lesson=interview().lesson;
  lesson.questions[0].prompt_en='How does the uncle feel?';
  lesson.questions[0].accepted_meanings=['Happy.','Excited.','Glad.'];
  const task=storyRubric(lesson).tasks[0];
  const messages=storyAssessorMessages({task,transcript:'Glad.'});
  assert.match(messages[0].content,/demonstrating ANY ONE alternative/);
  const input=JSON.parse(messages[1].content);
  assert.deepEqual(input.task.criteria[0].acceptedMeanings,['Happy.','Excited.','Glad.']);
  assert.equal(input.task.criteria[0].meaning,'Happy.');
  assert.equal(input.transcript,'Glad.');
  task.criteria[0].acceptedMeanings.pop();assert.equal(lesson.questions[0].accepted_meanings.length,3);
  const legacy=fixture().lesson;legacy.questions[0].accepted_meanings=['First alternative','Second alternative'];
  assert.deepEqual(storyRubric(legacy).tasks[0].criteria,[{id:'meaning',meaning:'First alternative / Second alternative'}]);
});

test('twelve confirmed spoken answers earn completion reward even if incorrect; no retell or recall',()=>{
  const lesson=interview().lesson,{manifest,recallTask}=storyRubric(lesson);
  assert.equal(manifest.tasks.length,12);assert.equal(recallTask,null);
  const attempt={storyId:manifest.storyId,contentVersion:manifest.contentVersion,readComplete:true,
    answers:manifest.tasks.map(t=>({taskId:t.id,responseId:'voice-'+t.id,modality:'spoken',reliability:'confirmed',support:'none',matchedCriteria:[]}))};
  const result=assessStoryMission(manifest,attempt);
  assert.equal(result.status,'complete');assert.equal(result.scorePercent,0);assert.deepEqual(result.reward,{grade:null,xp:0,diamonds:50});
  for(const change of [a=>a.answers.pop(),a=>a.readComplete=false,a=>a.answers[0].modality='tap',a=>a.answers[0].reliability='uncertain']) {
    const a=structuredClone(attempt);change(a);assert.equal(assessStoryMission(manifest,a).reward.diamonds,0);
  }
  assert.throws(()=>completeStoryRecall(emptyStoryRewardLedger(),manifest,{},1000),/no recall reward/);
  const bad=structuredClone(manifest);bad.tasks[11].kind='retell';assert.throws(()=>assessStoryMission(bad,attempt),/Invalid interview tasks/);
});

test('tap, skip, retell and recall cannot advance interview; legacy still accepts taps',()=>{
  const pkg=interview(),l=pkg.lesson,start=newStorySession(l,'synthetic-session');
  const state=advanceStorySession(l,start,{type:'read_complete'});
  for(const type of ['answer','skip_question','retell_unassessed','start_recall'])assert.throws(()=>advanceStorySession(l,state,{type,taskId:l.questions[0].id,optionIndex:0}),/interview_spoken_answers_required/);
  assert.equal(storySessionView(pkg,state).policy.interview.completionDiamonds,50);
  assert.deepEqual(storySessionView(pkg,state).policy.rewardTiers,[]);
  const old=fixture().lesson,oldState=advanceStorySession(old,newStorySession(old,'old-session'),{type:'read_complete'});
  assert.equal(advanceStorySession(old,oldState,{type:'answer',taskId:old.questions[0].id,optionIndex:old.questions[0].correct_index}).questionIndex,1);
});

test('unclear speech, help and failed provider do not consume a question; rejected feedback is recoverable',t=>{
  const s=setup(t);
  s.speak({reliability:'uncertain'});s.send({type:'continue_voice'});assert.equal(s.state.questionIndex,0);
  s.speak({intent:'help'});s.send({type:'continue_voice'});assert.equal(s.state.questionIndex,0);
  s.speak();s.send({type:'reject_voice'});assert.equal(s.state.questionIndex,0);assert.equal(s.state.answers.length,0);
  const input={sessionId:s.state.sessionId,revision:s.state.revision,requestId:'failed-voice'};
  s.store.beginVoice(s.owner,s.lesson,input,'failed-voice');s.store.failVoice(s.owner,input.sessionId,input.requestId,{phase:'transcription'});
  assert.equal(s.store.get(s.owner,input.sessionId).questionIndex,0);
  s.speak();s.send({type:'continue_voice'});assert.equal(s.state.questionIndex,1);
});

test('saved twelve-answer flow resumes and awards exactly fifty once, including request replay and new content version',t=>{
  const s=setup(t);
  for(let i=0;i<11;i++){s.speak({correct:i%2===0});s.send({type:'continue_voice'});}
  assert.equal(s.state.stage,'understand');assert.equal(s.state.questionIndex,11);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
  const other=new PrivateStoryStore(s.data);
  try {assert.equal(other.open(s.owner,s.lesson).questionIndex,11);}finally{other.close();}
  s.speak();
  const input={sessionId:s.state.sessionId,revision:s.state.revision,requestId:'last-continue',event:{type:'continue_voice'}};
  const finished=s.store.event(s.owner,s.lesson,input).state;
  assert.equal(finished.stage,'reward');assert.equal(finished.questionIndex,12);assert.equal(finished.missionResult.recallDueAt,null);
  assert.deepEqual(finished.missionResult.award,{diamonds:50,xp:0});assert.equal(finished.retelling,'unassessed');
  assert.equal(s.store.event(s.owner,s.lesson,input).replayed,true);
  const evidence=savedStoryAttempt(s.lesson,finished);
  assert.equal(s.store.commitTrustedAssessment(s.owner,finished.sessionId,evidence.manifest,evidence.attempt,1000).award.diamonds,0);
  const modified={...evidence.manifest};delete modified.interviewVersion;
  assert.throws(()=>s.store.commitTrustedAssessment(s.owner,finished.sessionId,modified,evidence.attempt,1000),/assessment_session_mismatch/);
  const next={...s.lesson,version:'1.2.2'};let state=s.store.open(s.owner,next);
  state=s.store.event(s.owner,next,{sessionId:state.sessionId,revision:0,requestId:'next-read',event:{type:'read_complete'}}).state;
  for(let i=0;i<12;i++){
    const input={sessionId:state.sessionId,revision:state.revision,requestId:'next-voice-'+i};
    s.store.beginVoice(s.owner,next,input,'next-'+i);
    state=s.store.finishVoice(s.owner,next,input,{transcript:'Synthetic wrong answer',reply:'Synthetic feedback',assessment:'server_validated',judgment:{reliability:'confirmed',matchedCriteria:[],replySupport:'none'}});
    state=s.store.event(s.owner,next,{sessionId:state.sessionId,revision:state.revision,requestId:'next-continue-'+i,event:{type:'continue_voice'}}).state;
  }
  assert.equal(state.missionResult.duplicate,true);assert.equal(state.missionResult.award.diamonds,0);
  const wallet=s.store.db.prepare('SELECT * FROM story_test_wallets').get();assert.equal(wallet.diamonds,50);assert.equal(JSON.parse(wallet.ledger).receipts.length,1);
});

test('failure during final payment rolls back question progress and reward; retry succeeds once',t=>{
  const s=setup(t);
  for(let i=0;i<11;i++){s.speak();s.send({type:'continue_voice'});}s.speak();
  const before=s.store.get(s.owner,s.state.sessionId);
  s.store.db.exec("CREATE TRIGGER fail_interview BEFORE INSERT ON story_assessed_progress BEGIN SELECT RAISE(ABORT,'injected_failure'); END");
  const input={sessionId:s.state.sessionId,revision:s.state.revision,requestId:'final-atomic',event:{type:'continue_voice'}};
  assert.throws(()=>s.store.event(s.owner,s.lesson,input),/injected_failure/);
  assert.deepEqual(s.store.get(s.owner,s.state.sessionId),before);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
  s.store.db.exec('DROP TRIGGER fail_interview');
  assert.equal(s.store.event(s.owner,s.lesson,input).state.missionResult.award.diamonds,50);
  assert.equal(s.store.event(s.owner,s.lesson,input).replayed,true);
});

test('interview wrong answer is answered with the authored stored answer, not a model reply (Packet A2)',async()=>{
  const l=interview().lesson,task=storyRubric(l).tasks[0],calls=[];
  const expected='Good try! The answer is: '+l.questions[0].accepted_meanings[0];
  const provider={
    transcribe:async()=>{calls.push('speech-to-text');return 'A clearly wrong answer.';},
    assess:async()=>{calls.push('check-answer');return {intent:'answer',reliability:'confirmed',replySupport:'none',criteria:[{id:'meaning',met:false,quote:''}]};},
    respond:async()=>{calls.push('reply');throw Error('authored path must not call the reply model');},
    validateSafety:async()=>{calls.push('safety');throw Error('authored path must not call the safety model');},
    synthesize:async text=>{calls.push('text-to-speech');assert.equal(text,expected);return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};},
  };
  const result=await runStoryVoiceTurn({lesson:l,task,provider,budget:{claim(){},finish(){}},sessionId:'synthetic-interview',requestId:'synthetic-wrong',
    activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true},audio:new Blob(['synthetic'],{type:'audio/webm'})});
  assert.deepEqual(calls,['speech-to-text','check-answer','text-to-speech']);
  assert.equal(result.reply,expected);
  assert.equal(result.assessment,'server_validated');assert.deepEqual(result.judgment.matchedCriteria,[]);
  assert.equal(result.judgment.replySupport,'model');
  assert.match(storyVoicePrompt(fixture().lesson,task,'Wrong')[0].content,/try again/);
});

test('completion adds fifty to the existing profile, keeps XP/avatar, and profile failure rolls back the final answer',async t=>{
  const s=setup(t),pkg=interview(),owner=PRIVATE_SITE_CODE;
  const api=createPrivateSiteApi({store:s.store,pkg,authenticate:()=>true});
  const call=async(path,body)=>api(new Request('https://qa.example'+path,{method:body?'POST':'GET',
    headers:{'X-Read2Lead-Code':owner,Origin:'https://qa.example',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await call('/api/generate-read2lead-pack',{access_code:owner})).status,200);
  const get=key=>JSON.parse(s.store.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(key).value);
  const before=get('progress:'+owner);
  let state=s.store.open(owner,pkg.lesson);
  const send=(requestId,event)=>state=s.store.event(owner,pkg.lesson,{sessionId:state.sessionId,revision:state.revision,requestId,event}).state;
  send('profile-read',{type:'read_complete'});
  for(let i=0;i<12;i++){
    const input={sessionId:state.sessionId,revision:state.revision,requestId:'profile-voice-'+i};
    s.store.beginVoice(owner,pkg.lesson,input,'profile-'+i);
    state=s.store.finishVoice(owner,pkg.lesson,input,{transcript:'Synthetic wrong answer',reply:'Synthetic correction',assessment:'server_validated',judgment:{reliability:'confirmed',matchedCriteria:[],replySupport:'model'}});
    if(i===11) {
      s.store.db.exec("CREATE TRIGGER fail_profile_interview BEFORE UPDATE ON private_site_kv WHEN NEW.key LIKE 'progress:%' BEGIN SELECT RAISE(ABORT,'profile_failure'); END");
      assert.throws(()=>send('profile-finish-'+i,{type:'continue_voice'}),/profile_failure/);
      assert.equal(s.store.get(owner,state.sessionId).questionIndex,11);
      assert.deepEqual(get('progress:'+owner),before);
      assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM story_test_wallets').get().n,0);
      s.store.db.exec('DROP TRIGGER fail_profile_interview');
    }
    send('profile-finish-'+i,{type:'continue_voice'});
  }
  const after=get('progress:'+owner);
  assert.equal(after.diamonds,before.diamonds+50);assert.equal(after.total_xp,before.total_xp);
  assert.deepEqual(after.avatar,before.avatar);assert.equal(get(owner).progress.review_history.length,1);
  assert.equal(get(owner).progress.current_pack.status,'reviewed_pass_web_v2');
  assert.equal(state.missionResult.assessment.scorePercent,0);assert.equal(state.missionResult.award.diamonds,50);
});
