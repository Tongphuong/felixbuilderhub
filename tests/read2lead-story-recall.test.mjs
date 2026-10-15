/** Fabricated trusted evidence/clock only; never real lesson acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {createPrivateSiteApi,PRIVATE_SITE_CODE as owner} from '../functions/lib/read2lead/private-site.mjs';
import {activeStoryVoiceTask} from '../functions/lib/read2lead/story-rubric.mjs';
import {storySessionView} from '../functions/lib/read2lead/story-session.mjs';
import {STORY_RECALL_DELAY_MS} from '../src/lib/read2lead-story-mission.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
async function setup(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let now=Date.parse('2026-09-28T04:00:00Z');
 const store=new StorySqlStore(db,{now:()=>now,transaction:fn=>{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const api=createPrivateSiteApi({store,pkg,authenticate:()=>true,now:()=>now});
 const assigned=await api(new Request('https://qa.example/api/generate-read2lead-pack',{method:'POST',headers:{Origin:'https://qa.example','Content-Type':'application/json'},body:JSON.stringify({access_code:owner})}));assert.equal(assigned.status,200);
 let state=store.open(owner,pkg.lesson),lastInput;
 const event=e=>{lastInput={sessionId:state.sessionId,revision:state.revision,requestId:'event-'+state.revision,event:e};state=store.event(owner,pkg.lesson,lastInput).state;return state;};
 const voice=({assessment='server_validated',matched=true}={})=>{
  const task=activeStoryVoiceTask(pkg.lesson,state),input={sessionId:state.sessionId,revision:state.revision,requestId:'voice-'+state.revision};
  store.beginVoice(owner,pkg.lesson,input,'fixture:'+input.requestId);
  state=store.finishVoice(owner,pkg.lesson,input,{transcript:'Fabricated test recording.',reply:'Tell Minny what happened.',assessment,judgment:{reliability:'confirmed',matchedCriteria:matched?task.criteria.map(c=>c.id):[],replySupport:'none'}});
 };
 const profile=()=>JSON.parse(db.prepare('SELECT value FROM private_site_kv WHERE key=?').get('progress:'+owner).value);
 const account=()=>JSON.parse(db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(owner).value);
 event({type:'read_complete'});for(const q of pkg.lesson.questions)event({type:'answer',taskId:q.id,optionIndex:q.correct_index});
 voice();event({type:'continue_voice'});assert.equal(state.missionResult.assessment.status,'complete');
 return{db,store,event,voice,profile,account,state:()=>state,advance:ms=>now+=ms,replay:()=>store.event(owner,pkg.lesson,lastInput),view:()=>storySessionView(pkg,state),reload:()=>state=store.get(owner,state.sessionId)};
}
test('recall requires full delay, hides source text, then pays exactly 200 diamonds and no XP once',async t=>{
 const s=await setup(t),before=s.profile(),history=s.account().progress.review_history;
 assert.throws(()=>s.event({type:'start_recall'}),/recall_not_due/);
 s.advance(STORY_RECALL_DELAY_MS-1);assert.throws(()=>s.event({type:'start_recall'}),/recall_not_due/);
 s.advance(1);s.event({type:'start_recall'});assert.equal(s.state().stage,'recall');
 assert.deepEqual(s.view().lesson.sentences,[]);assert.equal(s.view().lesson.audio.url,null);assert.deepEqual(s.view().lesson.vocabulary,[]);
 s.voice();s.event({type:'continue_voice'});assert.equal(s.state().stage,'reward');assert.equal(s.state().recallResult.status,'complete');
 assert.equal(s.profile().diamonds,before.diamonds+200);assert.equal(s.profile().total_xp,before.total_xp);assert.equal(s.profile().completed_packs,before.completed_packs);
 assert.deepEqual(s.account().progress.review_history,history);assert.equal(s.replay().replayed,true);assert.equal(s.profile().diamonds,before.diamonds+200);
 assert.throws(()=>s.event({type:'start_recall'}),/recall_already_awarded/);
 const ledger=JSON.parse(s.db.prepare('SELECT ledger FROM story_test_wallets').get().ledger);assert.equal(ledger.receipts.length,2);
});
test('revealed text remains practice-only across cancel, restart and reload',async t=>{
 const s=await setup(t),before=s.profile();s.advance(STORY_RECALL_DELAY_MS);s.event({type:'start_recall'});s.event({type:'reveal_recall_text'});
 assert.ok(s.view().lesson.sentences.length);s.event({type:'cancel_recall'});s.event({type:'start_recall'});s.reload();assert.equal(s.state().recallSupport,'text');
 s.voice();s.event({type:'continue_voice'});assert.equal(s.state().recallResult.status,'practice_only');assert.equal(s.profile().diamonds,before.diamonds);assert.equal(s.profile().total_xp,before.total_xp);
});
test('unassessed and insufficient recall evidence do not pay or overwrite original completion',async t=>{
 const s=await setup(t),before=s.profile();s.advance(STORY_RECALL_DELAY_MS);s.event({type:'start_recall'});
 s.voice({assessment:'unassessed'});s.event({type:'continue_voice'});assert.equal(s.state().stage,'recall');assert.equal(s.state().recallResult,undefined);
 s.voice({matched:false});s.event({type:'continue_voice'});assert.equal(s.state().recallResult.status,'needs_practice');assert.equal(s.state().missionResult.assessment.status,'complete');assert.equal(s.profile().diamonds,before.diamonds);
});
test('recall profile failure rolls back receipt/evidence and leaves feedback retryable',async t=>{
 const s=await setup(t),before=s.profile();s.advance(STORY_RECALL_DELAY_MS);s.event({type:'start_recall'});s.voice();const state=structuredClone(s.state());
 s.db.exec("CREATE TRIGGER refuse_recall_profile BEFORE UPDATE ON private_site_kv WHEN NEW.key LIKE 'progress:%' BEGIN SELECT RAISE(ABORT,'recall_profile_failure'); END");
 assert.throws(()=>s.event({type:'continue_voice'}),/recall_profile_failure/);s.reload();assert.deepEqual(s.state(),state);assert.deepEqual(s.profile(),before);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_recall_assessments').get().n,0);
 assert.equal(JSON.parse(s.db.prepare('SELECT ledger FROM story_test_wallets').get().ledger).receipts.length,1);
 s.db.exec('DROP TRIGGER refuse_recall_profile');s.event({type:'continue_voice'});assert.equal(s.profile().diamonds,before.diamonds+200);
});
