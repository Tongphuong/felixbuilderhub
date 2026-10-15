import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonical} from '../src/lib/read2lead/self-learn/session-contract.mjs';
import {verifyPreviewVoicePin} from '../scripts/read2lead-story-preview-package.mjs';
import {privateVoiceConfiguration} from '../functions/lib/read2lead/private-voice.mjs';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
const sha=s=>createHash('sha256').update(s).digest('hex');
const manifest={format:'read2lead-private-cloud-preview-v1',package:pkg,sourcePackageSha256:sha(canonical(pkg))};
const raw={format:'read2lead-private-voice-v1',packageSha256:manifest.sourcePackageSha256,
  mode:'adult-practice',processingApproved:true,spendingApproved:true,adultTrialApproved:true,
  pricingEvidenceSha256:'b'.repeat(64),budget:{scope:'batch',batchId:'pin-test-only',
  expiresAt:'2026-09-29T00:00:00.000Z',approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:100000,maxTurns:8}};
test('publisher identity is verified even without voice configuration',()=>{
  assert.deepEqual(verifyPreviewVoicePin({manifest}),{configured:false,packageSha256:manifest.sourcePackageSha256});
  for(const changed of [{...manifest,sourcePackageSha256:'c'.repeat(64)},
    {...manifest,package:{...pkg,changed:true}}, {...manifest,format:'unknown'},{}]) {
    assert.throws(()=>verifyPreviewVoicePin({manifest:changed}),/preview_package_corrupt/);
  }
});
test('outer website fingerprint is rejected; only canonical publisher fingerprint matches',()=>{
  const outer=sha(JSON.stringify(manifest));assert.notEqual(outer,manifest.sourcePackageSha256);
  assert.throws(()=>verifyPreviewVoicePin({manifest,configuration:JSON.stringify({...raw,packageSha256:outer})}),/preview_voice_package_mismatch/);
  assert.deepEqual(verifyPreviewVoicePin({manifest,configuration:JSON.stringify(raw)}),{configured:true,packageSha256:manifest.sourcePackageSha256});
});
test('malformed or stale voice configuration fails without returning its contents',()=>{
  for(const configuration of ['{',null,{},' '.repeat(4097)])assert.throws(()=>verifyPreviewVoicePin({manifest,configuration}),/preview_voice_configuration_invalid/);
  for(const value of [null,{}, {...raw,format:'unknown'}, {...raw,packageSha256:'d'.repeat(64)}])assert.throws(()=>verifyPreviewVoicePin({manifest,configuration:JSON.stringify(value)}),/preview_voice_package_mismatch/);
});
test('correct identity keeps adult practice unassessed and makes no claim or provider call',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=new StorySqlStore(db,{transaction:fn=>{
    db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  }});
  let calls=0;const env={AI:{run(){calls++;throw Error('provider forbidden');}},OPENROUTER_API_KEY:'fake',R2L_PRIVATE_VOICE_CONFIG:JSON.stringify(raw)};
  verifyPreviewVoicePin({manifest,configuration:env.R2L_PRIVATE_VOICE_CONFIG});
  const result=privateVoiceConfiguration({store,env,packageSha256:manifest.sourcePackageSha256,
    now:()=>new Date('2026-09-28T00:00:00.000Z'),fetchFn:()=>{calls++;throw Error('network forbidden');}});
  assert.deepEqual(result.status,{enabled:true,mode:'adult-practice',reason:'adult_practice_unassessed'});
  assert.equal(result.config.practiceTrial,true);assert.equal(result.config.activation.assessorValidated,false);
  assert.equal(result.config.activation.providerVerified,false);assert.equal(calls,0);
  for(const table of ['story_voice_turns','story_voice_reservations'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
});
