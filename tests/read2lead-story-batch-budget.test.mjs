import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateStoryBudget} from '../functions/lib/read2lead/story-budget.mjs';
import {PrivateStoryStore} from '../scripts/lib/read2lead-story-store.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {initializeSyntheticTarget} from '../scripts/read2lead-local-qa.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};

const grant={scope:'batch',batchId:'adult-qa-fixture',expiresAt:'2026-10-02T00:00:00.000Z',approvedVoiceMicroUsd:400000,worstCaseTurnMicroUsd:100000,maxTurns:2};
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-batch-')),data=path.join(root,'data');initializeSyntheticTarget(data);
  const first=new PrivateStoryStore(data),second=new PrivateStoryStore(data);
  t.after(()=>{first.close();second.close();fs.rmSync(root,{recursive:true,force:true});});
  const now=()=>new Date('2026-09-28T00:00:00Z');
  return {first,second,now,open:id=>first.open(id,pkg.lesson).sessionId};
}
test('explicit batch accepts no monthly baseline but refuses absent, malformed or unbounded grants',()=>{
  assert.equal(validateStoryBudget(grant).missionReserveMicroUsd,200000);
  for(const patch of [{batchId:''},{batchId:'../bad'},{expiresAt:'never'},{expiresAt:'2026-02-30T00:00:00.000Z'},
    {approvedVoiceMicroUsd:0},{approvedVoiceMicroUsd:Infinity},{worstCaseTurnMicroUsd:0},{maxTurns:9},
    {approvedVoiceMicroUsd:100000},{scope:'unlimited'}]) assert.throws(()=>validateStoryBudget({...grant,...patch}));
});
test('monthly reservation remains intact and cannot block a separately approved batch',t=>{
  const s=setup(t),legacy=new PrivateStoryBudgetStore(s.first,{month:'2026-09',baselineReconciled:true,existingCostsMicroUsd:39980000,approvedVoiceMicroUsd:20000,worstCaseTurnMicroUsd:20000,maxTurns:1},s.now);
  const old=s.open('legacy');legacy.claim(old,'old');legacy.finish(old,'old','failed_or_unknown');
  const budget=new PrivateStoryBudgetStore(s.first,grant,s.now);budget.claim(s.open('new'),'new');
  assert.equal(s.first.db.prepare('SELECT reserved FROM story_voice_reservations WHERE session=?').get(old).reserved,20000);
  assert.equal(s.first.db.prepare('SELECT SUM(reserved) AS n FROM story_voice_reservations WHERE month=?').get('batch:'+grant.batchId).n,200000);
});
test('two connections enforce one batch cap, preserve failed reservations and reject replay or changed grant',t=>{
  const s=setup(t),a=new PrivateStoryBudgetStore(s.first,grant,s.now),b=new PrivateStoryBudgetStore(s.second,grant,s.now);
  const one=s.open('one'),two=s.open('two'),three=s.open('three');
  a.claim(one,'turn1');a.finish(one,'turn1','failed_or_unknown');b.claim(two,'turn1');
  assert.throws(()=>b.claim(one,'turn1'),/already_claimed/);
  assert.throws(()=>a.claim(three,'turn1'),/budget_exhausted/);
  b.claim(one,'turn2');assert.throws(()=>a.claim(one,'turn3'),/turn_limit/);
  const changed=new PrivateStoryBudgetStore(s.second,{...grant,approvedVoiceMicroUsd:800000},s.now);
  assert.throws(()=>changed.claim(three,'turn1'),/batch_config_conflict/);
  assert.equal(s.first.db.prepare('SELECT SUM(reserved) AS n FROM story_voice_reservations WHERE month=?').get('batch:'+grant.batchId).n,400000);
});
test('batch persists across month boundary and expires exactly at its approved end',t=>{
  const s=setup(t),one=s.open('one');
  const september=new PrivateStoryBudgetStore(s.first,grant,s.now);september.claim(one,'turn1');
  const october=new PrivateStoryBudgetStore(s.second,grant,()=>new Date('2026-10-01T00:00:00Z'));october.claim(one,'turn2');
  const expired=new PrivateStoryBudgetStore(s.second,grant,()=>new Date(grant.expiresAt));
  assert.throws(()=>expired.claim(s.open('expired'),'turn1'),/batch_expired/);
  assert.equal(s.first.db.prepare('SELECT SUM(reserved) AS n FROM story_voice_reservations').get().n,200000);
});

test('new explicit batch resumes the same saved lesson and preserves every prior ledger row',t=>{
 const s=setup(t),session=s.open('continuing'),old=new PrivateStoryBudgetStore(s.first,grant,s.now);
 old.claim(session,'old-failed');old.finish(session,'old-failed','failed_or_unknown');old.claim(session,'old-pending');
 const reservations=s.first.db.prepare('SELECT * FROM story_voice_reservations').all();
 const turns=s.first.db.prepare('SELECT * FROM story_voice_turns').all();
 const nextGrant={...grant,batchId:'explicit-next-fixture',approvedVoiceMicroUsd:200000};
 const next=new PrivateStoryBudgetStore(s.second,nextGrant,s.now);
 assert.deepEqual(next.reservedSessionsForOwner('continuing'),[]);next.claim(session,'fresh');next.finish(session,'fresh','succeeded');
 assert.deepEqual(next.reservedSessionsForOwner('continuing'),[{session}]);assert.deepEqual(next.reservedSessionsForOwner('someone-else'),[]);
 assert.deepEqual(s.first.db.prepare('SELECT * FROM story_voice_reservations WHERE session=?').all(session),reservations);
 assert.deepEqual(s.first.db.prepare('SELECT * FROM story_voice_turns WHERE session=?').all(session),turns);
 const restarted=new PrivateStoryBudgetStore(s.first,nextGrant,s.now);assert.throws(()=>restarted.claim(session,'fresh'),/already_claimed/);assert.throws(()=>restarted.claim(session,'old-failed'),/already_claimed/);
 restarted.claim(session,'fresh-2');assert.throws(()=>next.claim(session,'fresh-3'),/turn_limit/);
 assert.throws(()=>next.claim(s.open('another'),'attempt'),/budget_exhausted/);
 assert.throws(()=>next.finish(session,'old-pending','succeeded'),/claim_missing/);old.finish(session,'old-pending','succeeded');
 assert.equal(s.first.db.prepare('SELECT COUNT(*) n FROM story_voice_reservations').get().n,2);
 assert.equal(s.first.db.prepare('SELECT SUM(reserved) n FROM story_voice_reservations').get().n,400000);
 const changed=new PrivateStoryBudgetStore(s.first,{...nextGrant,maxTurns:1},s.now);assert.throws(()=>changed.claim(session,'extra'),/batch_config_conflict/);
});

test('later batches cannot replay an earlier scoped request or reserve a nonexistent lesson',t=>{
 const s=setup(t),session=s.open('continuing'),a=new PrivateStoryBudgetStore(s.first,grant,s.now);a.claim(session,'first');
 const b=new PrivateStoryBudgetStore(s.first,{...grant,batchId:'second'},s.now);b.claim(session,'second-request');b.finish(session,'second-request','failed_or_unknown');
 const c=new PrivateStoryBudgetStore(s.second,{...grant,batchId:'third'},s.now);assert.throws(()=>c.claim(session,'second-request'),/already_claimed/);
 assert.throws(()=>c.reserve('not-a-story-session'),/unknown_voice_session/);c.claim(session,'third-request');
 const expired=new PrivateStoryBudgetStore(s.first,{...grant,batchId:'expired'},()=>new Date(grant.expiresAt));assert.throws(()=>expired.reserve(session),/batch_expired/);
 assert.equal(s.first.db.prepare('SELECT COUNT(*) n FROM story_voice_turns').get().n,3);
 assert.equal(s.first.db.prepare('SELECT COUNT(*) n FROM story_voice_reservations').get().n,3);
});
