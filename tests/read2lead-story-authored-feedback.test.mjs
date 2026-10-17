import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runStoryVoiceTurn,runStoryPromptAudio,STORY_VOICE_CLARIFICATION} from '../functions/lib/read2lead/story-voice.mjs';
import {STORY_PRAISE_LINES,storyWrongAnswerLine} from '../functions/lib/read2lead/story-authored-feedback.mjs';
import {storyRubric,storyDiscussionTasks} from '../functions/lib/read2lead/story-rubric.mjs';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {STORY_POOL_DEBIT_MICRO_USD as DEBIT,STORY_POOL_MONTHLY_MICRO_USD,STORY_POOL_MIN_REMAINING_MICRO_USD} from '../functions/lib/read2lead/story-budget.mjs';
import {createStudentSynthesizer,studentVoiceConfiguration,STUDENT_POOL_ID} from '../functions/lib/read2lead/student-voice.mjs';
import {createPicturePronunciation} from '../functions/lib/read2lead/picture-retell-voice.mjs';
import {PRONUNCIATION_UNAVAILABLE_VI,VOICE_POOL_REST_VI,pronunciationNote} from '../src/lib/read2lead-minny-notes.mjs';
import {verifiedLessonCatalogue} from '../functions/lib/read2lead/private-voice.mjs';
import {collectWarmupLines,estimate,formatDryRun,executeWarmup} from '../scripts/r2l-voice-warmup.mjs';
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';

const base=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url)));
function interviewPackage(){
  const p=base(),l=p.lesson,q=l.questions[0];
  l.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
  l.questions=Array.from({length:12},(_,i)=>({...structuredClone(q),id:'interview-q'+(i+1),source:'story',dimension:'meaning'}));
  return p;
}
const activation={externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true};
const audio=()=>new Blob(['synthetic'],{type:'audio/webm'});
const mp3={audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};
const judgment=(over={})=>({intent:'answer',reliability:'confirmed',replySupport:'none',criteria:[{id:'meaning',met:false,quote:''}],...over});
const spyBudget=()=>{const log=[];return{log,claim(){},finish(...a){log.push(a);}};};
function turn(lessonPkg,assess,extra={}){
  const lesson=lessonPkg.lesson,task=storyRubric(lesson).tasks[0],calls=[],spoken=[];
  const provider={
    transcribe:async()=>{calls.push('stt');return 'Some answer.';},
    assess:async()=>{calls.push('assess');return assess;},
    respond:async()=>{calls.push('respond');return {reply:'The uncle sent the picture.',sentenceIds:['s1']};},
    validateSafety:async()=>{calls.push('safety');return {valid:true,replySupport:'none'};},
    synthesize:async text=>{calls.push('tts');spoken.push(text);return mp3;},
    ...extra.provider,
  };
  const budget=spyBudget();
  const run=(over={})=>runStoryVoiceTurn({lesson,task:over.task||task,provider,budget,sessionId:'s',requestId:'r'+Math.random().toString(36).slice(2),
    activation,audio:audio(),...over});
  return{run,calls,spoken,budget,lesson,task};
}

test('T1 debits are the live-measured x1.25 values (Addendum 2026-10-17) and the provisional hold is AI-reply + synthesis',()=>{
  assert.deepEqual({...DEBIT},{cachedPlayback:0,freshSynthesis:1_700,authoredAnswerTurn:700,aiReplyTurn:5_000,retell:700});
  assert.equal(DEBIT.aiReplyTurn+DEBIT.freshSynthesis,6_700);
  assert.equal(STORY_POOL_MIN_REMAINING_MICRO_USD,50_000);
  const f=poolFixture({after(){}}), s=f.store.open('kid',f.pkg.lesson).sessionId;
  f.budget.claim(s,'p');f.budget.finish(s,'p','failed_or_unknown');
  assert.equal(f.budget.poolUsed(),6_700,'a failed turn keeps the 6,700 provisional hold');
});

test('T3 assessorModel: 120b default unchanged, 20b routed to the 20b model, unknown refused',async t=>{
  const f=poolFixture(t),pkg=base(),approvalSha256='a'.repeat(64),packageSha256='b'.repeat(64);
  const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:[{id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)}]});
  const budget={scope:'pool',poolId:STUDENT_POOL_ID,approvedVoiceMicroUsd:STORY_POOL_MONTHLY_MICRO_USD,maxTurns:32};
  const raw={format:'read2lead-student-voice-v1',audience:'enrolled-students',mode:'assessed',providerRoute:'cloudflare-only',assessorModel:'gpt-oss-120b',
    packageSha256,approvalSha256,processingApproved:true,spendingApproved:true,pricingEvidenceSha256:'c'.repeat(64),
    verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256},budget};
  const models=[];
  const configure=over=>studentVoiceConfiguration({store:f.store,env:{AI:{async run(model){models.push(model);throw Error('stop');}},
    R2L_STUDENT_VOICE_CONFIG:JSON.stringify({...raw,...over})},packageSha256,lessonCatalogue:catalogue,approvedGrant:{approvalSha256,budget},now:f.now});
  const task={id:'t',prompt:'Who?',criteria:[{id:'meaning',meaning:'The uncle.'}]};
  for(const [name,id] of [['gpt-oss-120b','@cf/openai/gpt-oss-120b'],['gpt-oss-20b','@cf/openai/gpt-oss-20b']]){
    const c=await configure({assessorModel:name});assert.equal(c.status.enabled,true,name);
    await assert.rejects(c.config.provider.assess({task,transcript:'The uncle.'}),/stop/);
    assert.equal(models.at(-1),id,name+' is graded by '+id);
  }
  for(const bad of ['gpt-oss-1b','@cf/openai/gpt-oss-20b','legacy','',undefined,null])
    assert.equal((await configure({assessorModel:bad})).status.reason,'package_or_policy_mismatch','refused: '+bad);
});

test('A2 correct answer: one fixed praise line, zero reply and safety model calls',async()=>{
  const t=turn(interviewPackage(),judgment({criteria:[{id:'meaning',met:true,quote:'Some answer.'}]}));
  const r=await t.run();
  assert.deepEqual(t.calls,['stt','assess','tts']);
  assert.ok(STORY_PRAISE_LINES.includes(r.reply));assert.equal(t.spoken[0],r.reply);
  assert.deepEqual(r.judgment.matchedCriteria,['meaning']);assert.equal(r.judgment.replySupport,'none');
  assert.equal(r.assessment,'server_validated');
  // deterministic: the same question always gets the same line
  assert.equal((await t.run()).reply,r.reply);
});

test('A2 known-bad: ANY unmatched criterion never hears praise',async()=>{
  const pkg=interviewPackage(),lesson=pkg.lesson,rubric=storyRubric(lesson);
  const two={...rubric.tasks[0],criteria:[{id:'meaning',meaning:'a'},{id:'second',meaning:'b'}]};
  // The grader matched only one of two criteria.
  const t=turn(pkg,{...judgment(),criteria:[{id:'meaning',met:true,quote:'Some answer.'},{id:'second',met:false,quote:''}]});
  const r=await t.run({task:two});
  assert.equal(STORY_PRAISE_LINES.includes(r.reply),false);
  assert.match(r.reply,/^Good try! /);
  assert.deepEqual(r.judgment.matchedCriteria,['meaning']);
  // And no matched criterion at all.
  const none=turn(pkg,judgment());const nr=await none.run();
  assert.equal(STORY_PRAISE_LINES.includes(nr.reply),false);
});

test('A2 wrong answer: stored answer line, replySupport model, no model reply',async()=>{
  const t=turn(interviewPackage(),judgment());
  const r=await t.run();
  assert.deepEqual(t.calls,['stt','assess','tts']);
  assert.equal(r.reply,'Good try! The answer is: '+t.lesson.questions[0].accepted_meanings[0]);
  assert.equal(r.judgment.replySupport,'model');assert.deepEqual(r.judgment.matchedCriteria,[]);
  assert.equal(r.assessment,'server_validated');
});

test('A2 stored answer falls back to the correct option, and to the AI path when nothing safe exists',()=>{
  const l=interviewPackage().lesson,task={id:l.questions[0].id};
  l.questions[0].accepted_meanings=['x '.repeat(200)];// too long to speak
  assert.equal(storyWrongAnswerLine(l,task),'Good try! The answer is: '+l.questions[0].options_en[1]);
  l.questions[0].options_en[1]='See https://example.com now';
  assert.equal(storyWrongAnswerLine(l,task),null);
  assert.equal(storyWrongAnswerLine(l,{id:'missing'}),null);
});

test('A2 uncertain speech: existing clarification, no model calls',async()=>{
  const t=turn(interviewPackage(),judgment({reliability:'uncertain'}));
  const r=await t.run();
  assert.deepEqual(t.calls,['stt','assess','tts']);assert.equal(r.reply,STORY_VOICE_CLARIFICATION);
  assert.deepEqual(r.judgment.matchedCriteria,[]);
});

test('A2 story_question and help keep the AI reply AND safety path',async()=>{
  for(const intent of ['story_question','help']){
    const pkg=interviewPackage(),lesson=pkg.lesson;
    const tasks=storyDiscussionTasks(lesson,storyRubric(lesson).tasks[0]);
    const t=turn(pkg,judgment({intent}),{provider:{validateSafety:async()=>{return {valid:true,replySupport:'none',taskSupport:tasks.map(x=>({taskId:x.id,support:'none'}))};}}});
    const calls=t.calls;
    const r=await t.run();
    assert.deepEqual(calls,['stt','assess','respond','tts'],intent);// respond ran; safety validated inside provider
    assert.equal(r.reply,'The uncle sent the picture.');
  }
  // safety is genuinely consulted
  const t=turn(interviewPackage(),judgment({intent:'story_question'}));
  await t.run().catch(()=>{});
  assert.ok(t.calls.includes('respond')&&t.calls.includes('safety'));
});

test('A2 non-interview lessons are unchanged',async()=>{
  const pkg=base(),t=turn(pkg,judgment({criteria:[{id:'meaning',met:true,quote:'Some answer.'}]}));
  await t.run();
  assert.ok(t.calls.includes('respond')&&t.calls.includes('safety'));
});

function fakeAi(){
  const ai={runs:0,run(){ai.runs++;return Promise.resolve(new Uint8Array([1,2,3,4]));}};return ai;
}
const memoryCache=()=>{const m=new Map();return{m,async get(k){return m.has(k)?JSON.parse(m.get(k)):null;},async put(k,v){m.set(k,v);}};};

test('A1 second child on the same story causes ZERO new synthesis (counting fake AI)',async()=>{
  const ai=fakeAi(),cache=memoryCache();
  const pkg=interviewPackage(),lesson=pkg.lesson,task=storyRubric(lesson).tasks[0];
  const provider=child=>({transcribe:async()=>'a',assess:async()=>judgment(),respond:()=>{throw Error('no');},validateSafety:()=>{throw Error('no');},
    synthesize:createStudentSynthesizer({AI:ai,READ2LEAD_CODES:cache})});
  const prompt=async(session)=>runStoryPromptAudio({activation,provider:provider(),budget:spyBudget(),sessionId:session,requestId:'p'+session,task});
  const first=await prompt('child-1');
  assert.equal(ai.runs,1);
  const spent=ai.runs;
  await prompt('child-2');
  await runStoryVoiceTurn({activation,provider:provider(),budget:spyBudget(),sessionId:'child-1',requestId:'ans1',lesson,task,audio:audio()});
  const afterFirstWrong=ai.runs;
  await runStoryVoiceTurn({activation,provider:provider(),budget:spyBudget(),sessionId:'child-2',requestId:'ans2',lesson,task,audio:audio()});
  assert.equal(ai.runs,afterFirstWrong,'same authored line for a second child must be served from saved audio');
  assert.equal(ai.runs,spent+1,'only the first wrong-answer line was synthesized');
  assert.ok(first.audio_b64);
  // a cache outage degrades to plain synthesis, never a failed turn
  const broken=createStudentSynthesizer({AI:fakeAi(),READ2LEAD_CODES:{get:async()=>{throw Error('down');},put:async()=>{throw Error('down');}}});
  assert.ok((await broken('Hello there.')).audio_b64);
});

function poolFixture(t,{cap=15_000_000,start='2026-10-17T00:00:00Z'}={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const transaction=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const store=new StorySqlStore(db,{transaction});
  let time=Date.parse(start);const now=()=>new Date(time);
  const budget=new PrivateStoryBudgetStore(store,{scope:'pool',poolId:STUDENT_POOL_ID,approvedVoiceMicroUsd:cap,maxTurns:32},now);
  return{db,store,budget,now,clock:v=>time=Date.parse(v),pkg:base()};
}

test('B pool debits per claimed action and never reserves per mission',async t=>{
  const f=poolFixture(t),s=f.store.open('kid',f.pkg.lesson).sessionId;
  const lesson=interviewPackage().lesson,task=storyRubric(lesson).tasks[0];
  const ai=fakeAi(),cache=memoryCache();
  const provider={transcribe:async()=>'a',assess:async()=>judgment(),respond:async()=>({reply:'The uncle sent the picture.',sentenceIds:['s1']}),
    validateSafety:async()=>({valid:true,replySupport:'none'}),synthesize:createStudentSynthesizer({AI:ai,READ2LEAD_CODES:cache})};
  assert.equal(f.budget.poolUsed(),0,'starting a mission reserves nothing');
  await runStoryPromptAudio({activation,provider,budget:f.budget,sessionId:s,requestId:'p1',task});
  assert.equal(f.budget.poolUsed(),DEBIT.freshSynthesis,'first playback is a fresh synthesis');
  await runStoryPromptAudio({activation,provider,budget:f.budget,sessionId:s,requestId:'p2',task});
  assert.equal(f.budget.poolUsed(),DEBIT.freshSynthesis+DEBIT.cachedPlayback,'replay from saved audio is free');
  const before=f.budget.poolUsed();
  await runStoryVoiceTurn({activation,provider,budget:f.budget,sessionId:s,requestId:'a1',lesson,task,audio:audio()});
  assert.equal(f.budget.poolUsed()-before,DEBIT.authoredAnswerTurn+DEBIT.freshSynthesis,'authored turn + its first synthesis');
  const mid=f.budget.poolUsed();
  await runStoryVoiceTurn({activation,provider,budget:f.budget,sessionId:s,requestId:'a2',lesson,task,audio:audio()});
  assert.equal(f.budget.poolUsed()-mid,DEBIT.authoredAnswerTurn,'same line again: saved audio, only the grader');
  // AI-reply turn (help) costs the larger amount
  const tasks=storyDiscussionTasks(lesson,task);
  provider.assess=async()=>judgment({intent:'help'});
  provider.validateSafety=async()=>({valid:true,replySupport:'none',taskSupport:tasks.map(x=>({taskId:x.id,support:'none'}))});
  provider.respond=async()=>({reply:'Think about who sends it.',sentenceIds:['s1']});
  const m2=f.budget.poolUsed();
  await runStoryVoiceTurn({activation,provider,budget:f.budget,sessionId:s,requestId:'a3',lesson,task,audio:audio()});
  assert.equal(f.budget.poolUsed()-m2,DEBIT.aiReplyTurn+DEBIT.freshSynthesis);
  // a failed turn keeps the conservative provisional debit (no speculative refund)
  provider.transcribe=async()=>{throw Error('stt down');};
  const m3=f.budget.poolUsed();
  await assert.rejects(runStoryVoiceTurn({activation,provider,budget:f.budget,sessionId:s,requestId:'a4',lesson,task,audio:audio()}));
  assert.equal(f.budget.poolUsed()-m3,DEBIT.aiReplyTurn+DEBIT.freshSynthesis);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM story_voice_reservations').get().n,0,'no per-mission reservation rows');
});

test('B picture retell debits its own small amount',async t=>{
  const f=poolFixture(t),s=f.store.open('kid',f.pkg.lesson).sessionId;
  const b=new Uint8Array(44+32000);const dv=new DataView(b.buffer);
  [...'RIFF'].forEach((c,i)=>b[i]=c.charCodeAt(0));dv.setUint32(4,b.length-8,true);[...'WAVEfmt '].forEach((c,i)=>b[8+i]=c.charCodeAt(0));
  dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,16000,true);dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);
  [...'data'].forEach((c,i)=>b[36+i]=c.charCodeAt(0));dv.setUint32(40,32000,true);for(let i=44;i<b.length;i+=2)dv.setInt16(i,i%4?1000:-1000,true);
  const provider={transcribe:async()=>'My retelling.',assess:async({transcript})=>({intent:'answer',reliability:'confirmed',criteria:[{id:'event',met:true,quote:transcript}],replySupport:'none'})};
  await runStoryVoiceTurn({activation,provider,budget:f.budget,sessionId:s,requestId:'r1',lesson:{},task:{id:'picture-retell-v1',kind:'picture_retell',prompt:'Retell',criteria:[{id:'event',meaning:'x'}]},audio:new Blob([b],{type:'audio/wav'})});
  assert.equal(f.budget.poolUsed(),DEBIT.retell);
});

test('B pool resets on the 1st (UTC) and old rows are left alone',async t=>{
  const f=poolFixture(t,{cap:13_000,start:'2026-10-31T23:59:00Z'}),s=f.store.open('kid',f.pkg.lesson).sessionId;
  f.budget.claim(s,'a');f.budget.finish(s,'a','failed_or_unknown');// 6700 provisional
  f.budget.claim(s,'b');f.budget.finish(s,'b','failed_or_unknown');// 13400 >= cap
  assert.throws(()=>f.budget.claim(s,'c'),/voice_pool_exhausted/);
  const rows=f.db.prepare('SELECT * FROM story_voice_pool_debits ORDER BY request').all();
  f.clock('2026-11-01T00:00:00Z');
  assert.equal(f.budget.poolUsed(),0);assert.equal(f.budget.poolStatus().exhausted,false);
  f.budget.claim(s,'c');f.budget.finish(s,'c','succeeded',0);
  assert.deepEqual(f.db.prepare('SELECT * FROM story_voice_pool_debits WHERE request IN (?,?)').all('a','b').sort((x,y)=>x.request<y.request?-1:1),rows,'history untouched');
  assert.equal(f.db.prepare('SELECT month FROM story_voice_pool_debits WHERE request=?').get('c').month,'2026-11');
});

test('B no child limit: one child starts many missions while the pool has money; guard is per mission only',async t=>{
  const f=poolFixture(t);
  for(let i=0;i<60;i++){
    const s=f.store.open('kid-'+i,f.pkg.lesson).sessionId;// a new mission; the budget has no per-child dimension
    f.budget.claim(s,'q'+i);f.budget.finish(s,'q'+i,'succeeded',0);
  }
  assert.equal(f.budget.poolUsed(),0);
  const s=f.store.open('kid2',f.pkg.lesson).sessionId;
  for(let i=0;i<32;i++){f.budget.claim(s,'g'+i);f.budget.finish(s,'g'+i,'succeeded',0);}
  assert.throws(()=>f.budget.claim(s,'g32'),/voice_turn_limit/);
  const other=f.store.open('kid3',f.pkg.lesson).sessionId;
  f.budget.claim(other,'fresh-mission');// a new mission is never blocked by the old one's guard
  assert.throws(()=>f.budget.claim(other,'fresh-mission'),/already_claimed/);
});

test('B pool exhausted: voice refused cleanly with no provider call, reading is not hidden',async t=>{
  const f=poolFixture(t,{cap:6_000}),s=f.store.open('kid',f.pkg.lesson).sessionId;
  f.budget.claim(s,'x');f.budget.finish(s,'x','failed_or_unknown');
  let calls=0;const lesson=interviewPackage().lesson,task=storyRubric(lesson).tasks[0];
  const boom=async()=>{calls++;throw Error('provider must not be called');};
  const provider={transcribe:boom,assess:boom,respond:boom,validateSafety:boom,synthesize:boom};
  await assert.rejects(runStoryVoiceTurn({activation,provider,budget:f.budget,sessionId:s,requestId:'y',lesson,task,audio:audio()}),/voice_pool_exhausted/);
  await assert.rejects(runStoryPromptAudio({activation,provider,budget:f.budget,sessionId:s,requestId:'z',task}),/voice_pool_exhausted/);
  assert.equal(calls,0);
  assert.match(VOICE_POOL_REST_VI,/Minny đang nghỉ/);
  const source=fs.readFileSync(new URL('../src/scripts/read2lead-story-voice.mjs',import.meta.url),'utf8');
  assert.match(source,/VOICE_POOL_REST_CODE/);assert.match(source,/VOICE_POOL_REST_VI/);
  assert.match(fs.readFileSync(new URL('../functions/api/read2lead-story-turn.js',import.meta.url),'utf8'),/'voice_pool_exhausted'/);
});

test('B student config accepts the standing pool (no expiry), keeps the cap, and a nearly-empty pool stops offering new voice stories',async t=>{
  const f=poolFixture(t),pkg=base(),approvalSha256='a'.repeat(64),packageSha256='b'.repeat(64);
  const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:[{id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)}]});
  const budget={scope:'pool',poolId:STUDENT_POOL_ID,approvedVoiceMicroUsd:STORY_POOL_MONTHLY_MICRO_USD,maxTurns:32};
  const raw={format:'read2lead-student-voice-v1',audience:'enrolled-students',mode:'assessed',providerRoute:'cloudflare-only',assessorModel:'gpt-oss-120b',
    packageSha256,approvalSha256,processingApproved:true,spendingApproved:true,pricingEvidenceSha256:'c'.repeat(64),
    verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256},budget};
  const configure=(over={},grantBudget=budget,now=f.now)=>studentVoiceConfiguration({store:f.store,env:{AI:{run(){throw Error('no');}},R2L_STUDENT_VOICE_CONFIG:JSON.stringify({...raw,...over})},
    packageSha256,lessonCatalogue:catalogue,approvedGrant:{approvalSha256,budget:grantBudget},now});
  const ok=await configure();assert.equal(ok.status.enabled,true);
  // A1 wiring: the REAL student provider goes through saved audio (second request: zero synthesis)
  const ai=fakeAi(),cache=memoryCache();
  const wired=await studentVoiceConfiguration({store:f.store,env:{AI:{run:(...a)=>ai.run(...a)},READ2LEAD_CODES:cache,R2L_STUDENT_VOICE_CONFIG:JSON.stringify(raw)},
    packageSha256,lessonCatalogue:catalogue,approvedGrant:{approvalSha256,budget},now:f.now});
  await wired.config.provider.synthesize('Who sends the picture?');await wired.config.provider.synthesize('Who sends the picture?');
  assert.equal(ai.runs,1);
  // far in the future (after the old 2026-10-22 batch expiry) it still works
  const later=await configure({},budget,()=>new Date('2027-03-05T00:00:00Z'));assert.equal(later.status.enabled,true);
  assert.equal(later.canAssign(pkg.lesson),true);
  assert.ok(await later.config.forPackage(pkg));
  for(const bad of [{...budget,approvedVoiceMicroUsd:STORY_POOL_MONTHLY_MICRO_USD+1},{...budget,poolId:'other'},{...budget,maxTurns:31},{...budget,expiresAt:'2026-10-22T00:00:00.000Z'}]){
    assert.equal((await configure({budget:bad},bad)).config,null);
  }
  // No tap path in the interview: a new voice story is offered only while >= 50_000 remains this month.
  assert.equal(STORY_POOL_MIN_REMAINING_MICRO_USD,50_000);
  const small={...budget,approvedVoiceMicroUsd:100_000};
  const low=await configure({budget:small},small);assert.equal(low.status.enabled,true);
  assert.equal(low.canAssign(pkg.lesson),true,'plenty left');
  const s=f.store.open('kid',pkg.lesson).sessionId;
  for(let i=0;i<8;i++){low.config.budget.claim(s,'burn'+i);low.config.budget.finish(s,'burn'+i,'failed_or_unknown');}// 53_600 used, 46_400 left
  assert.equal(low.canAssign(pkg.lesson),false,'under 50_000 left: no new voice story offered');
  assert.equal(ok.canAssign(pkg.lesson),true,'the real $15 pool is untouched by this small one');
  f.clock('2026-11-01T00:00:00Z');
  assert.equal(low.canAssign(pkg.lesson),true,'next UTC month the pool is whole again');
});

test('B pool canAssign fails closed: a SQL error from poolStatus means no new voice story, never a throw',async t=>{
  const f=poolFixture(t),pkg=base(),approvalSha256='a'.repeat(64),packageSha256='b'.repeat(64);
  const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:[{id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)}]});
  const budget={scope:'pool',poolId:STUDENT_POOL_ID,approvedVoiceMicroUsd:STORY_POOL_MONTHLY_MICRO_USD,maxTurns:32};
  const raw={format:'read2lead-student-voice-v1',audience:'enrolled-students',mode:'assessed',providerRoute:'cloudflare-only',assessorModel:'gpt-oss-120b',
    packageSha256,approvalSha256,processingApproved:true,spendingApproved:true,pricingEvidenceSha256:'c'.repeat(64),
    verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256},budget};
  const v=await studentVoiceConfiguration({store:f.store,env:{AI:{run(){throw Error('no');}},R2L_STUDENT_VOICE_CONFIG:JSON.stringify(raw)},
    packageSha256,lessonCatalogue:catalogue,approvedGrant:{approvalSha256,budget},now:f.now});
  assert.equal(v.canAssign(pkg.lesson),true,'healthy pool offers a story');
  v.config.budget.poolStatus=()=>{throw Error('SQL error');};
  assert.equal(v.canAssign(pkg.lesson),false);
});

test('B6 Azure unavailable: retell says so in Vietnamese, content score still saved',async()=>{
  let fetched=0;
  const env={AZURE_SPEECH_KEY:'synthetic',AZURE_SPEECH_REGION:'test',READ2LEAD_CODES:{get:async()=>18000,put:async()=>{}}};// meter full
  const pron=await createPicturePronunciation({env,fetchFn:async()=>{fetched++;throw Error();}})(new Blob([new Uint8Array(44+32000)],{type:'audio/wav'}));
  assert.equal(pron,null);assert.equal(fetched,0);
  assert.equal(pronunciationNote(null),PRONUNCIATION_UNAVAILABLE_VI);
  assert.match(PRONUNCIATION_UNAVAILABLE_VI,/Điểm phát âm chưa có/);
  assert.match(PRONUNCIATION_UNAVAILABLE_VI,/nội dung/);
  assert.equal(pronunciationNote({accuracy:80,fluency:70}),'Phát âm: 80/100 · Độ trôi chảy: 70/100');
  const source=fs.readFileSync(new URL('../src/scripts/read2lead-story-voice.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/pronunciationNote\(/g)||[]).length,2);
  assert.doesNotMatch(source,/Lượt này chưa có điểm phát âm/);
});

test('A3 warm-up: dry run lists every fixed line with cost, --execute synthesizes only uncached lines',async()=>{
  const lesson=interviewPackage().lesson,lines=collectWarmupLines(lesson);
  assert.equal(lines.filter(l=>l.kind==='question').length,12);
  assert.equal(lines.filter(l=>l.kind==='wrong').length,12);
  assert.equal(lines.filter(l=>l.kind==='praise').length,STORY_PRAISE_LINES.length);
  assert.equal(lines.filter(l=>l.kind==='clarification').length,1);
  const out=formatDryRun(lesson,lines),e=estimate(lines);
  assert.match(out,/dry run/);assert.match(out,/est\. neurons/);
  assert.equal(e.neurons,Math.round(e.chars/1000*2727.27));
  assert.throws(()=>collectWarmupLines(base().lesson),/not_an_interview/);
  const ai=fakeAi(),cache=memoryCache();
  const first=await executeWarmup(lines,{AI:ai,READ2LEAD_CODES:cache});
  assert.equal(first.synthesized,e.uniqueLines);assert.equal(ai.runs,e.uniqueLines);
  const again=await executeWarmup(lines,{AI:ai,READ2LEAD_CODES:cache});
  assert.deepEqual(again,{cached:e.uniqueLines,synthesized:0});assert.equal(ai.runs,e.uniqueLines);
});
