import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {createPrivateSiteApi,PRIVATE_SITE_CODE} from '../functions/lib/read2lead/private-site.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {makeStoredBookPack,makeBookReaderState} from './helpers/book-pack-fixture.mjs';
import {createPrivateContent} from '../functions/lib/read2lead/private-content.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {deriveR2lPackAllowlist} from '../functions/api/read2lead-voice.js';

function fixture(t,content={}) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const newStore=()=>new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}});
  let api,store,authorized=true;const restart=(next=content)=>{store=newStore();api=createPrivateSiteApi({store,pkg,...next,authenticate:r=>authorized&&r.headers.get('cookie')==='private-test'});};restart();
  async function call(path,body,headers={}) {
    const response=await api(new Request('https://qa.example'+path,{method:body?'POST':'GET',
      headers:{cookie:'private-test',...(body?{Origin:'https://qa.example',...(body instanceof FormData?{}:{'Content-Type':'application/json'})}:{}),...headers},
      ...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}));return {status:response.status,value:await response.json()};
  }
  const assign=collection=>call('/api/generate-read2lead-pack',{access_code:PRIVATE_SITE_CODE,collection});
  return {call,assign,db,restart,revoke:()=>{authorized=false;},get store(){return store;}};
}
test('normal existing assignment→lesson→session→profile path shares one isolated test account',async t=>{
  const s=fixture(t),a=await s.assign();assert.equal(a.status,200);
  const l=await s.call(`/api/read2lead-lesson?code=${PRIVATE_SITE_CODE}&pack_id=${a.value.pack_id}`);
  assert.equal(l.status,200);assert.equal(l.value.lesson.title,pkg.lesson.title_en);
  const session=await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:a.value.pack_id},{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
  assert.equal(session.status,200);assert.equal(session.value.lesson.id,pkg.lesson.id);
  const again=await s.call('/api/read2lead-story-session?sessionId='+session.value.session.id,null,{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
  assert.equal(again.value.session.id,session.value.session.id);
  const profile=await s.call('/api/read2lead-progress?code='+PRIVATE_SITE_CODE);
  assert.equal(profile.status,200);assert.equal(profile.value.progress.current_pack.pack_id,a.value.pack_id);
  assert.equal(profile.value.read2lead_state.diamonds,700);
  assert.equal(profile.value.progress.current_pack.story_session.stage,'read');
  const next=await s.call('/api/read2lead-story-session',{action:'event',sessionId:session.value.session.id,revision:session.value.session.revision,requestId:'read-start',event:{type:'read_complete'}},{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
  assert.equal(next.status,200);
  const stored=JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value);
  delete stored.progress.current_pack.story_session;
  s.db.prepare('UPDATE private_site_kv SET value=? WHERE key=?').run(JSON.stringify(stored),PRIVATE_SITE_CODE);
  const resumed=await s.call('/api/read2lead-progress?code='+PRIVATE_SITE_CODE);
  assert.equal(resumed.value.progress.current_pack.story_session.stage,'understand');
  assert.equal(resumed.value.progress.current_pack.story_session.complete,false);
});
test('anonymous/cross-origin/other-account and unassigned packs cannot create sessions',async t=>{
  const s=fixture(t);
  assert.equal((await s.call('/api/read2lead-progress?code='+PRIVATE_SITE_CODE,null,{cookie:''})).status,401);
  assert.equal((await s.call('/api/generate-read2lead-pack',{access_code:PRIVATE_SITE_CODE},{Origin:'https://evil.example'})).status,403);
  assert.equal((await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:'unassigned'},{'X-Read2Lead-Code':PRIVATE_SITE_CODE})).status,404);
  assert.equal((await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:'unassigned'},{'X-Read2Lead-Code':'OTHER'})).status,401);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_sessions').get().n,0);
});
test('maintenance story routes use assigned content only and refuse a changed saved source pin',async t=>{
  const second=anotherStory(),s=fixture(t,{packages:[pkg,second]});
  const headers={'X-Read2Lead-Code':PRIVATE_SITE_CODE};
  assert.deepEqual((await s.call('/api/read2lead-story-session',null,headers)).value.lessons,[]);
  const assigned=await s.assign();
  const opened=await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:assigned.value.pack_id},headers);
  assert.equal(opened.status,200);assert.equal(opened.value.policy.testProgressOnly,true);
  const available=await s.call('/api/read2lead-story-session',null,headers);
  assert.deepEqual(available.value.lessons.map(l=>l.id),[pkg.lesson.id]);
  const raw=JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value);
  raw.progress.current_pack.story_reference.sha256='0'.repeat(64);
  s.db.prepare('UPDATE private_site_kv SET value=? WHERE key=?').run(JSON.stringify(raw),PRIVATE_SITE_CODE);
  const before=s.db.prepare('SELECT * FROM story_sessions').all();
  const refused=await s.call('/api/read2lead-story-session?sessionId='+opened.value.session.id,null,headers);
  assert.equal(refused.status,409);assert.deepEqual(s.db.prepare('SELECT * FROM story_sessions').all(),before);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='read2lead_account_kv'").get().n,0,'shared handler must reuse the existing private account rows');
});
test('shared story handler rechecks private login after voice work before saving feedback',async t=>{
  let s,calls=0;
  const voiceConfig={activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true},
    budget:{claim(){},finish(){}},provider:{
      transcribe:async()=>{calls++;s.revoke();return pkg.lesson.retell.essential_facts.map(f=>f.quote).join(' ');},
      respond:async()=>({reply:'What happens next?',sentenceIds:['s1']}),validateSafety:async()=>true,
      assess:async({task,transcript})=>({reliability:'confirmed',replySupport:'none',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:transcript.slice(0,60)}))}),
      synthesize:async()=>({audio_b64:'YXVkaW8=',content_type:'audio/mpeg'})}};
  s=fixture(t,{voiceConfig});const assigned=await s.assign(),headers={'X-Read2Lead-Code':PRIVATE_SITE_CODE};
  let view=(await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:assigned.value.pack_id},headers)).value;
  view=(await s.call('/api/read2lead-story-session',{action:'event',sessionId:view.session.id,revision:view.session.revision,requestId:'read-before-expiry',event:{type:'read_complete'}},headers)).value;
  const before=s.db.prepare('SELECT state FROM story_sessions WHERE id=?').get(view.session.id).state;
  const form=new FormData();form.set('sessionId',view.session.id);form.set('revision',String(view.session.revision));form.set('requestId','expiring-login-voice');form.set('audio',new Blob(['synthetic'],{type:'audio/webm'}),'voice.webm');
  const result=await s.call('/api/read2lead-story-turn',form,headers);
  assert.equal(result.status,401);assert.equal(calls,1);
  assert.equal(s.db.prepare('SELECT state FROM story_sessions WHERE id=?').get(view.session.id).state,before);
  assert.equal(s.db.prepare('SELECT status FROM story_speech_turns WHERE request=?').get('expiring-login-voice').status,'failed');
});
test('simultaneous start requests resume one assignment and never spend/reward twice',async t=>{
  const s=fixture(t);const replies=await Promise.all(Array.from({length:8},()=>s.assign()));
  assert.ok(replies.every(r=>r.status===200));assert.equal(new Set(replies.map(r=>r.value.pack_id)).size,1);
  const data=JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value);
  assert.equal(data.progress.packs_created,1);assert.equal(data.uses_remaining,100);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_test_wallets').get().n,0);
});

test('private voice route denies calls while provider and budget are disabled',async t=>{
 const s=fixture(t),assigned=await s.assign();
 const opened=await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:assigned.value.pack_id},{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 const form=new FormData();form.set('sessionId',opened.value.session.id);form.set('revision',String(opened.value.session.revision));form.set('requestId','disabled-voice');form.set('audio',new Blob(['audio'],{type:'audio/wav'}),'voice.wav');
 const response=await s.call('/api/read2lead-story-turn',form, {'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 assert.equal(response.status,503);assert.equal(response.value.code,'story_voice_not_authorized');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_speech_turns').get().n,0);
});

test('existing shop, gift prices and rank routes use only isolated account storage',async t=>{
 const s=fixture(t);await s.assign();
 for(const path of ['/api/read2lead-shop-list','/api/read2lead-gifts-list']) {
  const r=await s.call(path,{code:PRIVATE_SITE_CODE});assert.equal(r.status,200,JSON.stringify(r.value));
 }
 const gifts=await s.call('/api/read2lead-gifts-list',{code:PRIVATE_SITE_CODE});
 assert.equal(gifts.value.items.find(g=>g.id==='sticker').price_diamonds,1000);
 const rank=await s.call('/api/read2lead-leaderboard?limit=50');assert.equal(rank.status,200,JSON.stringify(rank.value));
 assert.deepEqual(rank.value.boards.xp.leaders,[],'private test account is excluded');
 assert.deepEqual(rank.value.boards.diamonds.leaders,[]); assert.equal(rank.value.boards.xp.own,null);
});

test('private home uses the original token resolver and denies anonymous entry discovery',async t=>{
 const s=fixture(t);await s.assign();
 assert.equal((await s.call('/api/read2lead-private-entry',null,{cookie:''})).status,401);
 const entry=await s.call('/api/read2lead-private-entry'),token=new URL(entry.value.homeHref,'https://qa.example').searchParams.get('t');
 assert.match(token,/^[a-f0-9]{32}$/);
 const result=await s.call('/api/r2l-link?token='+token);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.access_code,PRIVATE_SITE_CODE);
 assert.equal((await s.call('/api/r2l-link?token='+'f'.repeat(32))).status,404);
});

const oldBook=()=>makeStoredBookPack('book_123',{pages:6,sentencesPerPage:5,title:'Existing reading lesson'});
function anotherStory() {
 const second=structuredClone(pkg);second.lesson.id='second-synthetic-story';second.lesson.source.source_id='second-synthetic-source';
 second.lesson.title_en='Second synthetic story';return second;
}
function markFixtureCompleted(s) {
 // Deliberate test setup, not evidence of real learner completion or grading.
 const row=JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value);
 const pack=row.progress.current_pack;pack.status='reviewed_pass_web_v2';pack.story_complete=true;
 row.progress.review_history.push({pack_id:pack.pack_id,story_complete:true,story_id:pack.story_reference.id,story_source_id:pack.story_reference.source_id});
 s.db.prepare('UPDATE private_site_kv SET value=? WHERE key=?').run(JSON.stringify(row),PRIVATE_SITE_CODE);
}
test('bundled old books enable combined default while explicit stories remain assignable',async t=>{
 for(const choice of [undefined,'read2lead','one-story-a-day']) {
  const s=fixture(t,{legacyBooks:[oldBook()]});const result=await s.assign(choice);
  assert.equal(result.status,200,JSON.stringify(result.value));
  assert.equal(result.value.current_pack.schema_version,choice==='one-story-a-day'?'story-mission-v1':2);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM private_site_kv WHERE key LIKE 'book:%'").get().n,0,'content is not copied into learner records');
  const next=await s.assign(choice==='one-story-a-day'?'read2lead':'one-story-a-day');
  assert.equal(next.status,choice==='one-story-a-day'?200:409);
  assert.match(next.value.lesson_link,new RegExp(result.value.pack_id));
 }
});
test('second bundled story uses its own session and preserves earlier assignment history across restart',async t=>{
 const second=anotherStory(),content={packages:[pkg,second],legacyBooks:[oldBook()]},s=fixture(t,content);
 const first=await s.assign('one-story-a-day');assert.equal(first.status,200);
 const open=packId=>s.call('/api/read2lead-story-session',{action:'open_assigned',packId},{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 const firstSession=await open(first.value.pack_id);assert.equal(firstSession.status,200);
 markFixtureCompleted(s);
 const next=await s.assign('one-story-a-day');assert.equal(next.status,200,JSON.stringify(next.value));
 const opened=await open(next.value.pack_id);assert.equal(opened.status,200);
 assert.equal(opened.value.lesson.id,second.lesson.id);assert.notEqual(opened.value.session.id,firstSession.value.session.id);
 const saved=await s.call('/api/read2lead-story-session',{action:'event',sessionId:opened.value.session.id,revision:0,requestId:'second-read',event:{type:'read_complete'}},{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 assert.equal(saved.value.session.stage,'understand');
 s.restart();
 const resumed=await s.call('/api/read2lead-story-session?sessionId='+opened.value.session.id,null,{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 assert.deepEqual(resumed.value.session,saved.value.session);assert.equal(resumed.value.lesson.id,second.lesson.id);
 const history=await s.call(`/api/read2lead-lesson?code=${PRIVATE_SITE_CODE}&pack_id=${first.value.pack_id}`);
 assert.equal(history.status,200);assert.equal(history.value.lesson.story_id,pkg.lesson.id);
 assert.equal((await s.call('/api/read2lead-progress?code='+PRIVATE_SITE_CODE)).value.read2lead_state.diamonds,700);
});
test('bundle input mutations cannot alter content and changed published version is refused on restart',async t=>{
 const source=structuredClone(pkg),s=fixture(t,{packages:[source]});
 const first=await s.assign();assert.equal(first.status,200);
 source.lesson.title_en='Tampered after initialization';
 assert.equal((await s.call(`/api/read2lead-lesson?code=${PRIVATE_SITE_CODE}&pack_id=${first.value.pack_id}`)).value.lesson.title,pkg.lesson.title_en);
 const changed=structuredClone(pkg);changed.lesson.title_en='Changed bytes under the same version';
 s.restart({pkg:changed,packages:[changed]});
 const response=await s.call('/api/read2lead-progress?code='+PRIVATE_SITE_CODE);
 assert.equal(response.status,503);assert.equal(response.value.code,'private_content_unavailable');
 s.restart({packages:[pkg]});assert.equal((await s.assign()).value.pack_id,first.value.pack_id);
});
test('bundle selects the first version but retains exact older session content',async t=>{
 const newer=structuredClone(pkg);newer.lesson.version='1.2.2';newer.lesson.audio.content_version='1.2.2';
 newer.lesson.questions.forEach(q=>q.version='1.2.2');newer.lesson.independent_followup.version='1.2.2';
 const s=fixture(t);const first=await s.assign();
 const old=await s.call('/api/read2lead-story-session',{action:'open_assigned',packId:first.value.pack_id},{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 s.restart({packages:[newer,pkg]});
 const again=await s.call('/api/read2lead-story-session?sessionId='+old.value.session.id,null,{'X-Read2Lead-Code':PRIVATE_SITE_CODE});
 assert.equal(again.status,200,JSON.stringify(again.value));assert.equal(again.value.lesson.version,pkg.lesson.version);
 const registry=createPrivateContent({pkg,packages:[newer,pkg]});
 assert.equal(registry.storyValue('index:'+pkg.lesson.level)[0].version,'1.2.2');
 assert.equal(registry.runtime.packageFor(pkg.lesson).lesson.version,pkg.lesson.version);
 const fresh=fixture(t,{packages:[newer,pkg]}),assigned=await fresh.assign();
 assert.equal(assigned.status,200);
 const latest=await fresh.call(`/api/read2lead-lesson?code=${PRIVATE_SITE_CODE}&pack_id=${assigned.value.pack_id}`);
 assert.equal(latest.value.lesson.content_version,'1.2.2');
});
test('malformed, conflicting and broken bundles are refused before account initialization',()=>{
 const withMedia=structuredClone(pkg),conflict=anotherStory();
 const asset={object_key:'a'.repeat(64)+'.mp3',sha256:'a'.repeat(64),bytes:123,mime:'audio/mpeg'};
 withMedia.assets=[asset];conflict.assets=[{...asset,bytes:124}];
 const broken=oldBook();broken.book_page_audio.pop();
 for(const options of [{packages:[]},{packages:[pkg,pkg]},{packages:[anotherStory()]},{pkg:withMedia,packages:[withMedia,conflict]},
  {legacyBooks:[oldBook(),oldBook()]},{legacyBooks:[broken]}]) {
  assert.throws(()=>createPrivateContent({pkg,...options}),/private_content_invalid/);
 }
 const content=createPrivateContent({pkg,legacyBooks:[oldBook()]});
 assert.deepEqual(content.bookValue('book_index:L1'),['book_123']);assert.deepEqual(content.bookValue('book_index:L5'),undefined);
 const copy=content.bookValue('book:book_123');copy.story.title='changed';
 assert.equal(content.bookValue('book:book_123').story.title,'Existing reading lesson');
});

const accountRow=s=>JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value);
const walletRow=s=>JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get('progress:'+PRIVATE_SITE_CODE).value);
const submission=(packId,book)=>({access_code:PRIVATE_SITE_CODE,pack_id:packId,answers:{book_flow_version:3,book_reader:makeBookReaderState(book,{version:3}),activity_results:[]}});

test('old lesson checkpoint persists through restart and returns with the exact assignment',async t=>{
 const s=fixture(t,{legacyBooks:[oldBook()]}),assigned=await s.assign('read2lead');assert.equal(assigned.status,200);
 const before=accountRow(s),wallet=walletRow(s),snapshot={schema_version:2,w1_phase:'book_reader',book_reader:{pageIndex:1,stage:'questions',pages:[]}};
 const body={access_code:PRIVATE_SITE_CODE,pack_id:assigned.value.pack_id,snapshot};
 const saved=await s.call('/api/read2lead-checkpoint-save',body);assert.equal(saved.status,200);assert.equal(saved.value.stored,true);
 assert.deepEqual(accountRow(s).student_profile,before.student_profile);assert.deepEqual(walletRow(s),wallet);
 s.restart();
 const lesson=await s.call(`/api/read2lead-lesson?code=${PRIVATE_SITE_CODE}&pack_id=${assigned.value.pack_id}`);
 assert.equal(lesson.status,200);assert.deepEqual(lesson.value.lesson.web_session_checkpoint.snapshot,snapshot);
 assert.equal((await s.assign('one-story-a-day')).status,409);
 const stale=await s.call('/api/read2lead-checkpoint-save',{...body,pack_id:'wrong-pack'});assert.equal(stale.value.stored,false);
 assert.equal((await s.call('/api/read2lead-checkpoint-save',{...body,snapshot:{tooBig:'x'.repeat(20001)}})).status,413);
 assert.equal((await s.call('/api/read2lead-checkpoint-save',body,{cookie:''})).status,401);
 assert.equal((await s.call('/api/read2lead-checkpoint-save',body,{Origin:'https://wrong.example'})).status,403);
 assert.deepEqual(walletRow(s),wallet);
});

test('old lesson rejects incomplete submission, then concurrent valid fixture completions pay once',async t=>{
 const book=oldBook(),s=fixture(t,{legacyBooks:[book]}),assigned=await s.assign('read2lead');assert.equal(assigned.status,200);
 const id=assigned.value.pack_id,initial=walletRow(s),before=accountRow(s);
 const complete=submission(id,book),incomplete=structuredClone(complete);incomplete.answers.book_reader.pages.pop();
 const bad=await s.call('/api/submit-read2lead-lesson',incomplete);assert.equal(bad.status,400);assert.equal(bad.value.error,'invalid_book_flow');
 assert.deepEqual(walletRow(s),initial);assert.deepEqual(accountRow(s),before);
 const replies=await Promise.all(Array.from({length:6},()=>s.call('/api/submit-read2lead-lesson',complete)));
 assert.ok(replies.every(r=>r.status===200&&r.value.passed===true),JSON.stringify(replies));
 assert.equal(replies.filter(r=>r.value.already_completed===true).length,5);
 const award=replies.find(r=>!r.value.already_completed).value.rewards_earned,final=walletRow(s);
 assert.equal(final.diamonds,initial.diamonds+award.diamonds);assert.equal(final.total_xp,initial.total_xp+award.xp);
 assert.equal(final.completed_pack_ids.filter(x=>x===id).length,1);
 assert.deepEqual(accountRow(s).completed_books,[book.book_slug]);
 assert.equal(accountRow(s).progress.review_history.filter(x=>x.pack_id===id).length,1);
 const lateSave=await s.call('/api/read2lead-checkpoint-save',{access_code:PRIVATE_SITE_CODE,pack_id:id,snapshot:{stale:true}});
 assert.equal(lateSave.value.stored,false);assert.equal(accountRow(s).progress.current_pack.web_session_checkpoint,undefined);
 assert.deepEqual(accountRow(s).student_profile,before.student_profile);assert.deepEqual(final.avatar,initial.avatar);
 s.restart();assert.equal((await s.call('/api/submit-read2lead-lesson',complete)).value.already_completed,true);assert.deepEqual(walletRow(s),final);
 const story=await s.assign('one-story-a-day');assert.equal(story.status,200);
 const old=await s.call(`/api/read2lead-lesson?code=${PRIVATE_SITE_CODE}&pack_id=${id}`);assert.equal(old.status,200);
 assert.deepEqual(walletRow(s),final);
});

test('account write failure rolls back the old-book reward, and retry succeeds exactly once',async t=>{
 const book=oldBook(),s=fixture(t,{legacyBooks:[book]}),assigned=await s.assign('read2lead');assert.equal(assigned.status,200);
 const input=submission(assigned.value.pack_id,book),initial=walletRow(s),before=accountRow(s);
 s.db.exec(`CREATE TRIGGER fail_old_account BEFORE UPDATE ON private_site_kv
 WHEN NEW.key='R2L-ADULT-PRIVATE-QA' AND json_extract(NEW.value,'$.progress.current_pack.status')='reviewed_pass_web_v2'
 BEGIN SELECT RAISE(ABORT,'deliberate test write failure'); END;`);
 const failed=await s.call('/api/submit-read2lead-lesson',input);assert.equal(failed.status,503);assert.equal(failed.value.error,'private_storage_unavailable');
 assert.deepEqual(walletRow(s),initial);assert.deepEqual(accountRow(s),before);
 s.db.exec('DROP TRIGGER fail_old_account');
 const retry=await s.call('/api/submit-read2lead-lesson',input);assert.equal(retry.status,200);assert.equal(retry.value.passed,true);
 assert.equal(walletRow(s).diamonds,initial.diamonds+retry.value.rewards_earned.diamonds);
 const final=walletRow(s);assert.equal((await s.call('/api/submit-read2lead-lesson',input)).value.already_completed,true);assert.deepEqual(walletRow(s),final);
});

test('old-book submission cannot complete a publisher story or mutate another assignment',async t=>{
 const s=fixture(t),assigned=await s.assign('one-story-a-day'),before=accountRow(s),wallet=walletRow(s);
 const attempt=await s.call('/api/submit-read2lead-lesson',submission(assigned.value.pack_id,oldBook()));
 assert.equal(attempt.status,410);assert.deepEqual(walletRow(s),wallet);assert.deepEqual(accountRow(s),before);
 assert.equal((await s.call('/api/submit-read2lead-lesson',submission('unassigned',oldBook()))).status,404);
});

function voiceFixture(t,{run=async()=>new Uint8Array([73,68,51]),reserve=true,maxTurns=2}={}) {
 const calls=[],voiceConfig={activation:{externalProcessingApproved:true,spendingApproved:true,adultTrialApproved:true},
  legacyAI:{async run(model,input){calls.push({model,input});return run(model,input);}}};
 const s=fixture(t,{legacyBooks:[oldBook()],voiceConfig});
 // Budget-only fixture history; no claim that a real learner completed it.
 const budgetStore=new StorySqlStore(s.db,{transaction:fn=>s.store.transaction(fn)});
 voiceConfig.budget=new PrivateStoryBudgetStore(budgetStore,{scope:'batch',batchId:'legacy-service-fixture',expiresAt:'2026-10-02T00:00:00.000Z',
  approvedVoiceMicroUsd:1000000,worstCaseTurnMicroUsd:100000,maxTurns},()=>new Date('2026-09-28T00:00:00.000Z'));
 const sessionId=budgetStore.open(PRIVATE_SITE_CODE,pkg.lesson).sessionId;
 if(reserve)voiceConfig.budget.reserve(sessionId);
 const request=text=>({access_code:PRIVATE_SITE_CODE,text});
 const sentences=()=>[...deriveR2lPackAllowlist(JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value).progress.current_pack).sentences];
 const turns=()=>s.db.prepare('SELECT request,state FROM story_voice_turns ORDER BY rowid').all();
 return {...s,store:budgetStore,calls,voiceConfig,sessionId,request,sentences,turns};
}
test('original question voice uses one existing slot, caches audio, and shares exhaustion with story turns',async t=>{
 const s=voiceFixture(t);await s.assign('read2lead');const [one,two]=s.sentences();
 const first=await s.call('/api/read2lead-voice',s.request(one));assert.equal(first.status,200,JSON.stringify(first.value));
 assert.equal(first.value.audio_b64,'SUQz');assert.equal(s.calls.length,1);assert.match(s.turns()[0].request,/^service-tts-/);assert.equal(s.turns()[0].state,'succeeded');
 assert.equal((await s.call('/api/read2lead-voice',s.request(one))).status,200);assert.equal(s.calls.length,1);assert.equal(s.turns().length,1);
 s.voiceConfig.budget.claim(s.sessionId,'actual-story-slot');s.voiceConfig.budget.finish(s.sessionId,'actual-story-slot','failed_or_unknown');
 const exhausted=await s.call('/api/read2lead-voice',s.request(two));assert.equal(exhausted.status,503);assert.equal(exhausted.value.error,'private_voice_unavailable');
 assert.equal(s.calls.length,1);assert.equal(s.turns().length,2);
 assert.equal((await s.call('/api/read2lead-voice',s.request(one))).status,200,'cached playback remains free after exhaustion');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_voice_reservations').get().n,1,'no new reservation');
 assert.equal(JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get('progress:'+PRIVATE_SITE_CODE).value).diamonds,700);
});
test('original voice validates account, origin, allowlist and method without provider claims',async t=>{
 const s=voiceFixture(t);await s.assign('read2lead');const body=s.request(s.sentences()[0]);
 assert.equal((await s.call('/api/read2lead-voice',body,{cookie:''})).status,401);
 assert.equal((await s.call('/api/read2lead-voice',body,{Origin:'https://evil.example'})).status,403);
 assert.equal((await s.call('/api/read2lead-voice')).status,405);
 assert.equal((await s.call('/api/read2lead-voice',{...body,access_code:'OTHER'})).status,404);
 assert.equal((await s.call('/api/read2lead-voice',s.request('Arbitrary off-lesson speech'))).status,403);
 assert.equal(s.calls.length,0);assert.equal(s.turns().length,0);
});
test('original voice fallback retains one reservation and provider failures cannot refill it',async t=>{
 const s=voiceFixture(t,{maxTurns:1,run:async model=>{
  if(model==='@cf/deepgram/aura-2-en')throw Error('synthetic primary outage');
  return {audio:'SUQz'};
 }});await s.assign('read2lead');const text=s.sentences()[0];
 assert.equal((await s.call('/api/read2lead-voice',s.request(text))).status,200);
 assert.equal(s.calls.length,2);assert.equal(s.turns().length,1);assert.equal(s.turns()[0].state,'failed_or_unknown');
 assert.equal((await s.call('/api/read2lead-voice',s.request(text))).status,503,'fallback audio is not cached under primary voice');assert.equal(s.calls.length,2);
 const failed=voiceFixture(t,{maxTurns:1,run:async()=>{throw Error('synthetic complete outage');}});await failed.assign('read2lead');
 assert.equal((await failed.call('/api/read2lead-voice',failed.request(failed.sentences()[0]))).status,502);
 assert.equal(failed.calls.length,2);assert.equal(failed.turns()[0].state,'failed_or_unknown');
});
test('unreserved, expired, ambiguous, unapproved and unavailable provider states make no provider request',async t=>{
 for(const state of ['unreserved','expired','ambiguous','unapproved','no-provider']) {
  const s=voiceFixture(t,{reserve:state!=='unreserved'});await s.assign('read2lead');
  if(state==='expired')s.voiceConfig.budget.now=()=>new Date('2026-10-03T00:00:00Z');
  if(state==='ambiguous')s.voiceConfig.budget.reserve(s.store.open(PRIVATE_SITE_CODE,{...pkg.lesson,id:'another-fixture-story'}).sessionId);
  if(state==='unapproved')s.voiceConfig.activation.spendingApproved=false;
  if(state==='no-provider')delete s.voiceConfig.legacyAI;
  const response=await s.call('/api/read2lead-voice',s.request(s.sentences()[0]));assert.equal(response.status,503,state);
  assert.equal(s.calls.length,0,state);assert.equal(s.turns().length,0,state);
 }
 const disabled=fixture(t,{legacyBooks:[oldBook()]});await disabled.assign('read2lead');
 const pack=JSON.parse(disabled.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(PRIVATE_SITE_CODE).value).progress.current_pack;
 assert.equal((await disabled.call('/api/read2lead-voice',{access_code:PRIVATE_SITE_CODE,text:[...deriveR2lPackAllowlist(pack).sentences][0]})).status,503);
});
test('original microphone handler validates pack/audio and returns its unchanged synthetic transcript result',async t=>{
 const s=voiceFixture(t,{maxTurns:1,run:async()=>({text:'hello world'})});const assignment=await s.assign('read2lead');
 function form(patch={}) {
  const f=new FormData();for(const [key,value] of Object.entries({access_code:PRIVATE_SITE_CODE,pack_id:assignment.value.pack_id,expected_text:'hello world',audio:new Blob(['synthetic audio'],{type:'audio/webm'}),...patch}))f.set(key,value);return f;
 }
 assert.equal((await s.call('/api/read2lead-speaking-check',form({pack_id:'other'}))).status,404);
 assert.equal((await s.call('/api/read2lead-speaking-check',form(),{cookie:''})).status,401);
 assert.equal((await s.call('/api/read2lead-speaking-check',form(),{Origin:'https://evil.example'})).status,403);
 assert.equal((await s.call('/api/read2lead-speaking-check',form({audio:new Blob([new Uint8Array(5*1024*1024+1)])}))).status,413);
 assert.equal(s.calls.length,0);assert.equal(s.turns().length,0);
 const result=await s.call('/api/read2lead-speaking-check',form());assert.equal(result.status,200,JSON.stringify(result.value));
 assert.equal(result.value.transcript,'hello world');assert.equal(s.calls.length,1);assert.equal(s.calls[0].model,'@cf/openai/whisper-large-v3-turbo');
 assert.match(s.turns()[0].request,/^service-asr-/);assert.equal(s.turns()[0].state,'succeeded');
 assert.equal((await s.call('/api/read2lead-speaking-check',form())).status,503);assert.equal(s.calls.length,1);
 assert.equal(JSON.parse(s.db.prepare('SELECT value FROM private_site_kv WHERE key=?').get('progress:'+PRIVATE_SITE_CODE).value).diamonds,700,'speech check alone never completes/rewards');
});

test('simultaneous speech requests share one slot and cached replay survives adapter restart',async t=>{
 const s=voiceFixture(t,{maxTurns:1});await s.assign('read2lead');const [one,two]=s.sentences();
 const results=await Promise.all([one,two].map(text=>s.call('/api/read2lead-voice',s.request(text))));
 assert.deepEqual(results.map(r=>r.status),[200,503]);assert.equal(s.calls.length,1);assert.equal(s.turns().length,1);
 s.restart();assert.equal((await s.call('/api/read2lead-voice',s.request(one))).status,200);
 assert.equal((await s.call('/api/read2lead-voice',s.request(two))).status,503);assert.equal(s.calls.length,1);
});

test('SpeakUp tap-to-hear shares reserved capacity with original reading and survives restart from cache',async t=>{
 const s=voiceFixture(t,{maxTurns:1});await s.assign('read2lead');
 const phrase={access_code:PRIVATE_SITE_CODE,phrase_id:'wrap_up_1'};
 const response=await s.call('/api/minny-voice',phrase);
 assert.equal(response.status,200,JSON.stringify(response.value));assert.equal(response.value.audio_b64,'SUQz');
 assert.equal(s.calls.length,1);assert.equal(s.calls[0].model,'@cf/deepgram/aura-2-en');
 assert.equal(s.turns().length,1);assert.equal(s.turns()[0].state,'succeeded');
 assert.equal((await s.call('/api/read2lead-voice',s.request(s.sentences()[0]))).status,503);
 s.restart();assert.equal((await s.call('/api/minny-voice',phrase)).status,200);
 assert.equal(s.calls.length,1);assert.equal(s.turns().length,1);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_voice_reservations').get().n,1);
 assert.equal(walletRow(s).diamonds,700);
});

test('SpeakUp tap-to-hear rejects unauthorized inputs before any provider call or reservation claim',async t=>{
 const s=voiceFixture(t),phrase={access_code:PRIVATE_SITE_CODE,phrase_id:'wrap_up_1'};
 assert.equal((await s.call('/api/minny-voice',phrase,{cookie:''})).status,401);
 assert.equal((await s.call('/api/minny-voice',phrase,{Origin:'https://evil.example'})).status,403);
 assert.equal((await s.call('/api/minny-voice')).status,405);
 assert.equal((await s.call('/api/minny-voice',{...phrase,access_code:'OTHER'})).status,404);
 assert.equal((await s.call('/api/minny-voice',{...phrase,phrase_id:'invented-phrase'})).status,403);
 assert.equal((await s.call('/api/minny-voice',{access_code:PRIVATE_SITE_CODE,text:'arbitrary text'})).status,403);
 assert.equal((await s.call('/api/minny-voice',{access_code:PRIVATE_SITE_CODE,word:'unassigned'})).status,403);
 assert.equal(s.calls.length,0);assert.equal(s.turns().length,0);
});

test('SpeakUp unavailable and failed voice retains the existing spending guard',async t=>{
 const phrase={access_code:PRIVATE_SITE_CODE,phrase_id:'wrap_up_1'};
 const unreserved=voiceFixture(t,{reserve:false});
 const denied=await unreserved.call('/api/minny-voice',phrase);
 assert.equal(denied.status,503);assert.equal(denied.value.error,'private_voice_unavailable');
 assert.equal(unreserved.calls.length,0);assert.equal(unreserved.turns().length,0);
 const failed=voiceFixture(t,{maxTurns:1,run:async()=>{throw Error('synthetic outage');}});
 assert.equal((await failed.call('/api/minny-voice',phrase)).status,502);
 assert.equal(failed.calls.length,2);assert.equal(failed.turns().length,1);assert.equal(failed.turns()[0].state,'failed_or_unknown');
 assert.equal((await failed.call('/api/minny-voice',phrase)).status,503);assert.equal(failed.calls.length,2);
});
