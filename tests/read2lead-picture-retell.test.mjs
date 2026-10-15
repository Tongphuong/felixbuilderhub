import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {pictureRetellFor,pictureRetellResult} from '../functions/lib/read2lead/picture-retell.mjs';
import {storySessionView,advanceStorySession} from '../functions/lib/read2lead/story-session.mjs';
import {activeStoryVoiceTask,validateStoryJudgment} from '../functions/lib/read2lead/story-rubric.mjs';

function setup(t){
  const lesson=structuredClone(pkg.lesson);lesson.version='1.2.8';lesson.source.source_id='osad-51fda697ea22c07a08f16b8f-s01';
  lesson.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
  lesson.questions=Array.from({length:12},(_,i)=>({...structuredClone(lesson.questions[0]),id:'question-'+i}));
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const store=new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}});
  let state=store.open('learner',lesson),serial=0;
  const send=event=>state=store.event('learner',lesson,{sessionId:state.sessionId,revision:state.revision,requestId:'event-'+serial++,event}).state;
  const input=()=>({sessionId:state.sessionId,revision:state.revision,requestId:'voice-'+serial++});
  const speak=(ids,assessed=true)=>{
    const i=input();store.beginVoice('learner',lesson,i,'audio-'+i.requestId);
    const result={transcript:'Synthetic evidence',reply:'',audio:null,assessment:assessed?'server_validated':'unassessed',judgment:{reliability:assessed?'confirmed':'uncertain',matchedCriteria:ids,replySupport:'none',intent:'answer'}};
    state=store.finishVoice('learner',lesson,i,result);return{i,result};
  };
  const finishInterview=()=>{send({type:'read_complete'});for(let n=0;n<12;n++){speak(['meaning']);send({type:'continue_voice'});}};
  return{lesson,db,store,send,speak,input,finishInterview,reopen:()=>state=store.open('learner',lesson),get state(){return state;}};
}
test('feature is isolated to approved source, version and interview; old lessons unchanged',t=>{
  const s=setup(t);assert.ok(pictureRetellFor(s.lesson));
  for(const mutate of [l=>l.source.source_id='old-original',l=>l.version='1.2.7',l=>delete l.interview]){
    const l=structuredClone(s.lesson);mutate(l);assert.equal(pictureRetellFor(l),null);
    assert.throws(()=>advanceStorySession(l,{...s.state,contentVersion:l.version,interviewVersion:l.interview?.version},{type:'start_picture_retell'}));
  }
  assert.equal(pictureRetellFor(pkg.lesson),null);
  assert.throws(()=>s.send({type:'start_picture_retell'}),/unavailable/);
});
test('twelve questions still award50; whole retell awards200 atomically once and restores on reload',t=>{
  const s=setup(t);s.finishInterview();assert.equal(s.state.missionResult.award.diamonds,50);
  s.send({type:'start_picture_retell'});const task=activeStoryVoiceTask(s.lesson,s.state);
  assert.throws(()=>s.store.beginPrompt('learner',s.lesson,s.input(),true),/no_prompt_audio/);
  const {i,result}=s.speak(task.criteria.map(c=>c.id));
  assert.equal(s.state.pictureRetellResult.status,'complete');assert.equal(s.state.voiceAwaitingContinue,false);
  assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,250);
  assert.equal(s.store.open('learner',s.lesson).pictureRetellResult.award.diamonds,200);
  const replay=s.store.beginVoice('learner',s.lesson,i,'audio-'+i.requestId);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,result);
  s.speak(task.criteria.map(c=>c.id));assert.equal(s.state.pictureRetellResult.alreadyAwarded,true);assert.equal(s.state.pictureRetellResult.award.diamonds,0);
  assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,250);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_picture_rewards').get().n,1);
  const view=storySessionView({...pkg,lesson:s.lesson},s.state);assert.deepEqual(view.lesson.sentences,[]);assert.equal(view.lesson.audio.url,null);
  assert.equal(view.session.pictureRetell.status,'complete');assert.equal(view.session.awarded.diamonds,50);
});
test('approval metadata version preserves exact retelling and cannot earn another reward',t=>{
  const s=setup(t),old=pictureRetellFor(s.lesson);
  s.finishInterview();s.send({type:'start_picture_retell'});s.speak(old.criteria.map(c=>c.id));
  assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,250);
  s.lesson.version='1.2.9';assert.deepEqual(pictureRetellFor(s.lesson),old);
  s.reopen();
  s.send({type:'read_complete'});for(let i=0;i<12;i++){s.speak(['meaning']);s.send({type:'continue_voice'});}
  s.send({type:'start_picture_retell'});s.speak(old.criteria.map(c=>c.id));
  assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,250);
  assert.equal(s.state.pictureRetellResult.award.diamonds,0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_picture_rewards').get().n,1);
});
test('partial, unrelated and unclear speech do not earn200 or change original interview result',t=>{
  const s=setup(t);s.finishInterview();const original=structuredClone(s.state.missionResult);s.send({type:'start_picture_retell'});
  for(const [matches,assessed,status] of [[['sent'],true,'needs_practice'],[[],true,'needs_practice'],[[],false,'unassessed']]){
    s.speak(matches,assessed);assert.equal(s.state.pictureRetellResult.status,status);assert.deepEqual(s.state.missionResult,original);
    assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,50);
  }
});
test('profile failure rolls back both receipt and balance; retry can succeed',t=>{
  const s=setup(t);s.finishInterview();s.send({type:'start_picture_retell'});
  s.store.profileRewardSink=()=>{throw Error('injected_profile_failure');};
  const ids=activeStoryVoiceTask(s.lesson,s.state).criteria.map(c=>c.id);
  assert.throws(()=>s.speak(ids),/injected_profile_failure/);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_picture_rewards').get().n,0);
  assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,50);
  const pending=s.db.prepare("SELECT request FROM story_speech_turns WHERE status='pending'").get();s.store.failVoice('learner',s.state.sessionId,pending.request);
  s.store.profileRewardSink=null;s.speak(ids);assert.equal(s.db.prepare('SELECT diamonds FROM story_test_wallets').get().diamonds,250);
});
test('model must quote actual speech; unknown criteria and invented evidence rejected',t=>{
  const s=setup(t),task=pictureRetellFor(s.lesson);
  const good={reliability:'confirmed',replySupport:'none',intent:'answer',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:'real words'}))};
  const judgment=validateStoryJudgment(good,task,'real words');assert.equal(pictureRetellResult(task,judgment).status,'complete');
  assert.throws(()=>validateStoryJudgment(good,task,'different words'),/unsupported/);
  good.criteria[0].id='invented';assert.throws(()=>validateStoryJudgment(good,task,'real words'),/invalid/);
});
