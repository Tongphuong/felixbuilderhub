import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {createPrivateSiteApi,PRIVATE_SITE_CODE} from '../functions/lib/read2lead/private-site.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};

test('adult report is authenticated, owner-scoped, read-only, and excludes audio/secrets',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const store=new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}});
  const budget=new PrivateStoryBudgetStore(store,{scope:'batch',batchId:'report-test',expiresAt:'2026-10-01T00:00:00.000Z',approvedVoiceMicroUsd:400,worstCaseTurnMicroUsd:100,maxTurns:2},()=>new Date('2026-09-28T00:00:00Z'));
  const state=store.open(PRIVATE_SITE_CODE,pkg.lesson);budget.claim(state.sessionId,'request-1');budget.finish(state.sessionId,'request-1','succeeded');
  const other=store.open('another-owner',pkg.lesson);
  const api=createPrivateSiteApi({store,pkg,authenticate:r=>r.headers.get('cookie')==='adult-test',voiceConfig:{budget}});
  const result={transcript:'Off-topic answer',reply:'Try the detail about the sky.',judgment:{reliability:'confirmed',matchedCriteria:[],replySupport:'hint'},assessment:'unassessed',rewardsAwarded:false,audio:{audio_b64:'PRIVATE_AUDIO',content_type:'audio/mpeg'}};
  db.prepare('INSERT INTO story_speech_turns VALUES(?,?,?,?,?,?,?,?)').run(state.sessionId,'request-1',0,'fingerprint','task','done',Date.now(),JSON.stringify(result));
  const url='https://qa.example/api/read2lead-private-voice-report?sessionId='+state.sessionId+'&requestId=request-1';
  const call=(u=url,cookie='adult-test')=>api(new Request(u,{headers:{Cookie:cookie}}));
  assert.equal((await call(url,'')).status,401);
  const report=await(await call()).json();assert.deepEqual(report.judgment.matchedCriteria,[]);assert.equal(report.budget.reservedMicroUsd,200);assert.equal(report.budget.actualBilledMicroUsd,null);assert.deepEqual(report.budget.turns,[{state:'succeeded',count:1}]);assert.equal(JSON.stringify(report).includes('PRIVATE_AUDIO'),false);assert.equal(report.rewardsAwarded,false);
  await call();assert.equal(db.prepare('SELECT COUNT(*) AS n FROM story_voice_turns').get().n,1);
  assert.equal((await call(url+'&sessionId=duplicate')).status,400);
  assert.equal((await call(url.replace('request-1','missing'))).status,404);
  db.prepare('INSERT INTO story_speech_turns VALUES(?,?,?,?,?,?,?,?)').run(other.sessionId,'request-1',0,'fingerprint','task','done',Date.now(),JSON.stringify(result));
  assert.equal((await call(url.replace(state.sessionId,other.sessionId))).status,404);
});
