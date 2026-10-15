import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {normalizeProgressState} from '../functions/api/_read2lead-v2-state.js';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {connectStoryProfileRewards} from '../functions/lib/read2lead/story-profile.mjs';
import {createPrivateSiteApi,PRIVATE_SITE_CODE as owner} from '../functions/lib/read2lead/private-site.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};

test('older question-complete sessions recover pending-retell metadata without changing answers or paying again',t=>{
 const lesson=structuredClone(pkg.lesson);lesson.version='1.2.8';lesson.source.source_id='osad-51fda697ea22c07a08f16b8f-s01';
 lesson.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
 lesson.questions=Array.from({length:12},(_,i)=>({...structuredClone(lesson.questions[0]),id:'question-'+i}));
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const store=new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}});
 let state=store.open(owner,lesson),serial=0;
 const event=event=>state=store.event(owner,lesson,{sessionId:state.sessionId,revision:state.revision,requestId:'event-'+serial++,event}).state;
 event({type:'read_complete'});
 for(let i=0;i<12;i++){
   const input={sessionId:state.sessionId,revision:state.revision,requestId:'voice-'+serial++};
   store.beginVoice(owner,lesson,input,'synthetic');
   state=store.finishVoice(owner,lesson,input,{transcript:'Synthetic answer',reply:'Saved feedback',audio:null,assessment:'server_validated',judgment:{intent:'answer',reliability:'confirmed',matchedCriteria:['meaning'],replySupport:'none'}});
   event({type:'continue_voice'});
 }
 const before=JSON.stringify(state),wallet=JSON.stringify(db.prepare('SELECT * FROM story_test_wallets').all());
 const pack={pack_id:'older-pack',status:'reviewed_pass_web_v2',story_complete:true,story_reference:{id:lesson.id,version:lesson.version,source_id:lesson.source.source_id}};
 let account={progress:{current_pack:pack,review_history:[{story_complete:true,story_source_id:lesson.source.source_id}]}};
 connectStoryProfileRewards(store,{get:()=>structuredClone(account),put:(_key,value)=>account=value,assertAccount:()=>{},assertPack:()=>{}});
 assert.equal(JSON.stringify(store.open(owner,lesson)),before);
 assert.equal(account.progress.current_pack.picture_retell_required,true);
 assert.equal(account.progress.current_pack.story_session.question_count,12);
 assert.equal(account.progress.current_pack.story_session.question_total,12);
 assert.equal(account.progress.current_pack.story_session.assessment_summary.pronunciation,null);
 assert.equal(account.progress.current_pack.story_session.picture_retell_complete,false);
 assert.equal(account.progress.current_pack.status,'reviewed_pass_web_v2');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM story_test_wallets').all()),wallet);
 assert.equal(account.progress.review_history.length,1);
 // Reopening a fully completed no-retell review is terminal on the home page.
 const reviewLesson={...lesson,interview:undefined};
 account.progress.current_pack={...account.progress.current_pack,review_only:true,status:'story_in_progress',picture_retell_required:false};
 delete account.progress.current_pack.story_session;
 store.open(owner,reviewLesson);
 assert.equal(account.progress.current_pack.status,'reviewed_pass_web_v2');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM story_test_wallets').all()),wallet);
});

async function setup(t,voiceConfig=null){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const store=new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const api=createPrivateSiteApi({store,pkg,voiceConfig,authenticate:r=>r.headers.get('cookie')==='test-only'});
 const call=async(path,body)=>api(new Request('https://qa.example'+path,{method:body?'POST':'GET',headers:{cookie:'test-only','X-Read2Lead-Code':owner,...(body?{'Content-Type':'application/json',Origin:'https://qa.example'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 assert.equal((await call('/api/generate-read2lead-pack',{access_code:owner})).status,200);
 let state=store.open(owner,pkg.lesson);
 const event=e=>state=store.event(owner,pkg.lesson,{sessionId:state.sessionId,revision:state.revision,requestId:'step-'+state.revision,event:e}).state;
 event({type:'read_complete'});for(const q of pkg.lesson.questions)event({type:'answer',taskId:q.id,optionIndex:q.correct_index});
 const manifest={schemaVersion:'story-mission-v1',storyId:pkg.lesson.source.source_id,contentVersion:pkg.lesson.version,
  tasks:[{id:'meaning',kind:'understand',criteria:['meaning-1']},{id:'retell',kind:'retell',criteria:['fact-1','fact-2']}],recallTask:{id:'recall',criteria:['recall-1']}};
 const attempt={storyId:manifest.storyId,contentVersion:manifest.contentVersion,readComplete:true,answers:manifest.tasks.map(x=>({taskId:x.id,responseId:'response-'+x.id,modality:'spoken',reliability:'confirmed',support:'none',matchedCriteria:x.criteria}))};
 const get=key=>JSON.parse(db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(key).value);
 const commit=()=>store.commitTrustedAssessment(owner,state.sessionId,manifest,attempt,Date.parse('2026-09-28T08:00:00Z'));
 return{db,store,state,manifest,attempt,get,commit,call,api};
}
test('server story receipt updates existing profile once, preserves avatar/history, survives unrelated endpoint normalization',async t=>{
 const s=await setup(t);
 const prior=normalizeProgressState({...s.get('progress:'+owner),lifetime_rp:123,rank_points:123,avatar_stage:'basic'},{accessCode:owner,codeData:s.get(owner)});
 s.db.prepare('UPDATE private_site_kv SET value=? WHERE key=?').run(JSON.stringify(prior),'progress:'+owner);
 const before=await (await s.call('/api/read2lead-progress?code='+owner)).json();
 const result=s.commit();assert.deepEqual(result.award,{diamonds:1000,xp:20});assert.deepEqual(result.profileBalance,{diamonds:1700,xp:120});
 assert.equal(s.get('progress:'+owner).learning_receipts.length,1);assert.equal(s.get('progress:'+owner).learning_receipts[0].kind,'story_questions');assert.equal(s.get('progress:'+owner).learning_receipts[0].diamonds,1000);
 const second=s.commit();assert.equal(second.duplicate,true);assert.deepEqual(second.award,{diamonds:0,xp:0});
 assert.equal((await s.call('/api/read2lead-ceremony-ack',{code:owner})).status,200);
 const after=await (await s.call('/api/read2lead-progress?code='+owner)).json();
 assert.equal(s.get('progress:'+owner).learning_receipts.length,1);
 assert.equal(after.read2lead_state.diamonds,1700);assert.equal(after.read2lead_state.total_xp,120);
 assert.deepEqual(after.read2lead_state.avatar,before.read2lead_state.avatar);
 const account=s.get(owner);assert.equal(account.progress.review_history.length,1);assert.equal(account.progress.review_history[0].story_source_id,pkg.lesson.source.source_id);
 assert.equal(account.progress.current_pack.status,'reviewed_pass_web_v2');
 assert.equal(account.progress.review_history[0].grade,'S');
 assert.ok(s.get('progress:'+owner).lifetime_rp>=123);
 assert.equal(after.progress.current_pack.schema_version,'story-mission-v1');
});
test('failure writing profile rolls back receipt, assessment and both balances',async t=>{
 const s=await setup(t),before=s.get('progress:'+owner);
 s.db.exec("CREATE TRIGGER refuse_profile BEFORE UPDATE ON private_site_kv WHEN NEW.key LIKE 'progress:%' BEGIN SELECT RAISE(ABORT,'injected_profile_failure'); END");
 assert.throws(s.commit,/injected_profile_failure/);
 assert.deepEqual(s.get('progress:'+owner),before);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_assessed_progress').get().n,0);
 s.db.exec('DROP TRIGGER refuse_profile');assert.equal(s.commit().profileBalance.diamonds,1700);
});
test('uncertain spoken evidence leaves the existing profile and completion history unchanged',async t=>{
 const s=await setup(t),before=s.get('progress:'+owner);s.attempt.answers[1].reliability='uncertain';s.attempt.answers[1].matchedCriteria=[];
 const result=s.commit();assert.equal(result.assessment.status,'retry_technical');assert.equal(result.profileBalance,undefined);
 assert.deepEqual(s.get('progress:'+owner),before);assert.deepEqual(s.get(owner).progress.review_history,[]);
});
test('private host refuses client-supplied reward injection',async t=>{
 const s=await setup(t);const response=await s.call('/api/read2lead-progress-update',{code:owner,pack_id:'forged',rewards_earned:{diamonds:1000000,xp:100000}});
 assert.equal(response.status,404);assert.equal(s.get('progress:'+owner).diamonds,700);
});

test('concurrent HTTP completion, gift spending and profile normalization preserve one reward and one debit',async t=>{
 let providerCalls=0;
 const voiceConfig={activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true},
  budget:{claim(){},finish(){}},provider:{
   transcribe:async()=>{providerCalls++;return pkg.lesson.retell.essential_facts.map(f=>f.quote).join(' ');},
   respond:async()=>({reply:'You found a story detail. What happens next?',sentenceIds:['s1']}),validateSafety:async()=>true,
   assess:async({task,transcript})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript.slice(0,60)}))}),
   synthesize:async()=>({audio_b64:'YXVkaW8=',content_type:'audio/mpeg'})}};
 const s=await setup(t,voiceConfig),form=new FormData();
 form.set('sessionId',s.state.sessionId);form.set('requestId','voice-http');form.set('revision',String(s.state.revision));form.set('audio',new Blob(['fixture'],{type:'audio/webm'}),'test.webm');
 const voice=await s.api(new Request('https://qa.example/api/read2lead-story-turn',{method:'POST',headers:{cookie:'test-only','X-Read2Lead-Code':owner,Origin:'https://qa.example'},body:form}));
 assert.equal(voice.status,200,await voice.clone().text());
 const state=s.store.get(owner,s.state.sessionId);
 const finishBody={action:'event',sessionId:state.sessionId,revision:state.revision,requestId:'finish-http',event:{type:'continue_voice'}};
 const [finish,gift,ack]=await Promise.all([
  s.call('/api/read2lead-story-session',finishBody),
  s.call('/api/read2lead-gifts-redeem',{code:owner,gift_id:'sticker'}),
  s.call('/api/read2lead-ceremony-ack',{code:owner})]);
 assert.equal(finish.status,200,await finish.clone().text());assert.equal((await finish.json()).session.complete,true);
 assert.equal(gift.status,200,await gift.clone().text());assert.equal(ack.status,200);
 let profile=s.get('progress:'+owner);assert.equal(profile.diamonds,700);assert.equal(profile.total_xp,120);
 assert.equal(profile.redemptions.length,1);assert.equal(profile.redemptions[0].price_diamonds,1000);
 assert.equal(s.get(owner).progress.review_history.length,1);
 assert.equal((await s.call('/api/read2lead-story-session',finishBody)).status,200);
 assert.equal((await s.call('/api/read2lead-gifts-redeem',{code:owner,gift_id:'sticker'})).status,400);
 profile=s.get('progress:'+owner);assert.equal(profile.diamonds,700);assert.equal(profile.total_xp,120);assert.equal(providerCalls,1);
});

for(const failedKey of ['admin:gift-redemptions:v1','progress:'+owner,'config:gifts:v1'])test('gift failure at '+failedKey+' rolls back queue, debit and gift count; retry commits once',async t=>{
 const s=await setup(t);s.commit();
 const snapshot=()=>s.db.prepare('SELECT key,value,expires FROM private_site_kv ORDER BY key').all();const before=snapshot();
 s.db.exec(`CREATE TRIGGER fail_gift_write BEFORE INSERT ON private_site_kv WHEN NEW.key='${failedKey}' BEGIN SELECT RAISE(ABORT,'deliberate gift persistence failure'); END`);
 let response;try{response=await s.call('/api/read2lead-gifts-redeem',{code:owner,gift_id:'sticker'});}catch{response={status:500};}
 assert.deepEqual(snapshot(),before,'failed purchase must not leave a queue item, debit or gift-count change');assert.equal(response.status,503);
 s.db.exec('DROP TRIGGER fail_gift_write');
 const replies=await Promise.all(Array.from({length:4},()=>s.call('/api/read2lead-gifts-redeem',{code:owner,gift_id:'sticker'})));
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,400,400,400]);assert.equal(s.get('progress:'+owner).diamonds,700);assert.equal(s.get('progress:'+owner).redemptions.length,1);assert.equal(s.get('admin:gift-redemptions:v1').entries.length,1);assert.equal(s.get('config:gifts:v1').gifts.find(g=>g.id==='sticker').redeemed_count,1);
 assert.equal(s.get(owner).progress.review_history.length,1,'story completion must survive purchase recovery');
});
test('two isolated learners cannot exceed a shared gift redemption cap or lose either balance',async t=>{
 const s=await setup(t);s.commit();const other='SYNTHETIC-GIFT-SECOND';
 const put=(key,value)=>s.db.prepare('INSERT INTO private_site_kv VALUES(?,?,NULL) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 put(other,{is_test:true,student_profile:{student_name:'Second synthetic learner',level:'L1'},progress:{review_history:[],current_pack:null}});
 put('progress:'+other,{...s.get('progress:'+owner),access_code:other,redemptions:[]});
 put('config:gifts:v1',{schema_version:1,gifts:[{id:'sticker',name_vi:'Sticker',price_diamonds:1000,limit_total:1,redeemed_count:0,active:true}]});
 const replies=await Promise.all([owner,other].map(code=>s.call('/api/read2lead-gifts-redeem',{code,gift_id:'sticker'})));
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,400]);assert.equal(s.get('progress:'+owner).diamonds+s.get('progress:'+other).diamonds,2400);
 assert.equal(s.get('admin:gift-redemptions:v1').entries.length,1);assert.equal(s.get('config:gifts:v1').gifts[0].redeemed_count,1);
 const redemptions=[...s.get('progress:'+owner).redemptions,...s.get('progress:'+other).redemptions];assert.equal(redemptions.length,1);assert.equal(redemptions[0].id,s.get('admin:gift-redemptions:v1').entries[0].redemption_id);
});
