import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {studentVoiceConfiguration} from '../functions/lib/read2lead/student-voice.mjs';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {verifiedLessonCatalogue} from '../functions/lib/read2lead/private-voice.mjs';
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {storyVoiceEnabled} from '../functions/api/read2lead-story-turn.js';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};

async function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const transaction=fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const store=new StorySqlStore(db,{transaction});
  let time=Date.parse('2026-10-15T06:00:00Z'),calls=0;
  const now=()=>new Date(time),approvalSha256='a'.repeat(64),packageSha256='b'.repeat(64);
  const grant={approvalSha256,budget:{scope:'batch',batchId:'r2l-student-launch-'+approvalSha256.slice(0,32),
    expiresAt:'2026-10-22T06:00:00.000Z',approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:70000,maxTurns:32}};
  const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:[{id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)}]});
  const raw={format:'read2lead-student-voice-v1',audience:'enrolled-students',mode:'assessed',providerRoute:'cloudflare-only',
    assessorModel:'gpt-oss-120b',packageSha256,approvalSha256,processingApproved:true,spendingApproved:true,
    pricingEvidenceSha256:'c'.repeat(64),verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256},budget:structuredClone(grant.budget)};
  const options={store,env:{AI:{run(){calls++;throw Error('provider must not be called');}}},packageSha256,lessonCatalogue:catalogue,approvedGrant:grant,now,
    fetchFn:()=>{calls++;throw Error('provider must not be called');}};
  const configure=(value=raw,extra={})=>studentVoiceConfiguration({...options,...extra,env:{...options.env,...extra.env,R2L_STUDENT_VOICE_CONFIG:typeof value==='string'?value:JSON.stringify(value)}});
  return{db,store,raw,grant,options,configure,catalogue,now,calls:()=>calls,clock:value=>time=value};
}

test('student launch refuses missing, malformed, private, mismatched or unverified configuration without provider calls',async t=>{
  const f=await fixture(t);
  assert.equal((await studentVoiceConfiguration(f.options)).config,null);
  for(const value of ['{',{}, {...f.raw,audience:'adult'},{...f.raw,mode:'adult-practice'},
    {...f.raw,providerRoute:'speakup-default'},{...f.raw,assessorModel:'legacy'},
    {...f.raw,processingApproved:false},{...f.raw,spendingApproved:false},
    {...f.raw,packageSha256:'e'.repeat(64)},{...f.raw,approvalSha256:'e'.repeat(64)},
    {...f.raw,pricingEvidenceSha256:''},{...f.raw,verification:{...f.raw.verification,provider:false}},
    {...f.raw,verification:{...f.raw.verification,assessor:false}},
    {...f.raw,verification:{...f.raw.verification,catalogueSha256:'f'.repeat(64)}},
    {...f.raw,budget:{...f.raw.budget,approvedVoiceMicroUsd:10000000}},
    {...f.raw,budget:{...f.raw.budget,batchId:'r2l-existing-student-founder'}}]){
    const result=await f.configure(value);assert.equal(result.config,null);assert.equal(result.canAssign(pkg.lesson),false);
  }
  assert.equal((await f.configure(f.raw,{approvedGrant:null})).config,null);
  assert.equal((await f.configure(f.raw,{env:{AI:null}})).config,null);
  assert.equal(f.calls(),0);
});

test('trusted grant cannot bypass launch ceiling, deterministic identity, action limit or expiry',async t=>{
  const f=await fixture(t);
  for(const change of [{approvedVoiceMicroUsd:5000001},{maxTurns:33},{worstCaseTurnMicroUsd:1},
    {batchId:f.grant.budget.batchId+'-refill'},{scope:'monthly'},
    {expiresAt:'2026-10-23T06:00:00.000Z'},{expiresAt:'2026-10-15T06:00:00.000Z'}]){
    const budget={...f.grant.budget,...change},result=await f.configure({...f.raw,budget},{approvedGrant:{...f.grant,budget}});
    assert.equal(result.config,null);
  }
  assert.equal(f.calls(),0);
});

test('only exact verified packages are assessed; no adult practice fallback',async t=>{
  const f=await fixture(t),result=await f.configure();
  assert.equal(storyVoiceEnabled(result.config),true);assert.equal(result.config.practiceTrial,false);
  assert.equal(result.config.activation.adultTrialApproved,undefined);
  assert.equal((await result.config.forPackage(pkg)).activation.assessorValidated,true);
  for(const mutate of [p=>p.lesson.version='1.2.999',p=>p.lesson.id+='-changed',p=>p.lesson.story.sentences[0].text_en+=' Changed.']){
    const changed=structuredClone(pkg);mutate(changed);assert.equal(await result.config.forPackage(changed),null);
  }
  assert.equal(result.canAssign({...pkg.lesson,id:'not-verified'}),false);
  const tampered=structuredClone(f.catalogue);tampered.lessons[0].packageSha256='f'.repeat(64);
  assert.equal((await f.configure(f.raw,{lessonCatalogue:tampered})).config,null);
  assert.equal(f.calls(),0);
});

test('two student missions fit, third is refused, and founder claims and saved work survive restart/expiry',async t=>{
  const f=await fixture(t),founder=f.store.open('founder',pkg.lesson).sessionId;
  const privateBudget=new PrivateStoryBudgetStore(f.store,{...f.grant.budget,batchId:'r2l-existing-student-private-fixture',approvedVoiceMicroUsd:2240000},f.now);
  privateBudget.claim(founder,'private-request');privateBudget.finish(founder,'private-request','failed_or_unknown');
  const privateRows=f.db.prepare('SELECT * FROM story_voice_reservations WHERE session=?').all(founder);
  const privateTurns=f.db.prepare('SELECT * FROM story_voice_turns WHERE session=?').all(founder);
  const one=f.store.open('one',pkg.lesson).sessionId,two=f.store.open('two',pkg.lesson).sessionId,three=f.store.open('three',pkg.lesson).sessionId;
  const saved=f.store.get('one',one),a=await f.configure(),b=await f.configure();
  assert.equal(a.canAssign(pkg.lesson),true);
  a.config.budget.claim(one,'one-request');a.config.budget.finish(one,'one-request','failed_or_unknown');
  assert.equal(b.canAssign(pkg.lesson),true);b.config.budget.claim(two,'two-request');
  assert.equal(a.canAssign(pkg.lesson),false);
  assert.throws(()=>a.config.budget.claim(three,'third-request'),/budget_exhausted/);
  const restarted=await f.configure();assert.equal(restarted.canAssign(pkg.lesson),false);
  assert.throws(()=>restarted.config.budget.claim(one,'one-request'),/already_claimed/);
  restarted.config.budget.claim(one,'one-retry');restarted.config.budget.finish(one,'one-retry','succeeded');
  assert.equal(f.db.prepare('SELECT SUM(reserved) AS n FROM story_voice_reservations WHERE month=?').get('batch:'+f.grant.budget.batchId).n,4480000);
  assert.deepEqual(f.db.prepare('SELECT * FROM story_voice_reservations WHERE session=?').all(founder),privateRows);
  assert.deepEqual(f.db.prepare('SELECT * FROM story_voice_turns WHERE session=?').all(founder),privateTurns);
  f.clock(Date.parse(f.grant.budget.expiresAt));
  assert.equal(a.canAssign(pkg.lesson),false);assert.equal(await a.config.forPackage(pkg),null);
  assert.throws(()=>a.config.budget.claim(one,'after-expiry'),/batch_expired/);
  assert.equal((await f.configure()).config,null);
  assert.deepEqual(f.store.get('one',one),saved);assert.equal(f.calls(),0);
});

test('changing an in-use grant configuration cannot create more capacity',async t=>{
  const f=await fixture(t),one=f.store.open('one',pkg.lesson).sessionId,original=await f.configure();
  original.config.budget.claim(one,'one-request');
  const budget={...f.grant.budget,expiresAt:'2026-10-21T06:00:00.000Z'};
  const changed=await f.configure({...f.raw,budget},{approvedGrant:{...f.grant,budget}});
  assert.equal(changed.canAssign(pkg.lesson),false);
  assert.throws(()=>changed.config.budget.claim(f.store.open('two',pkg.lesson).sessionId,'second-request'),/batch_config_conflict/);
  assert.equal(f.calls(),0);
});
