import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountVoiceMetadata} from '../functions/lib/read2lead/account-voice-metadata.mjs';
import {createPicturePronunciation} from '../functions/lib/read2lead/picture-retell-voice.mjs';
import {studentVoiceConfiguration} from '../functions/lib/read2lead/student-voice.mjs';
import {existingStudentVoiceConfiguration,verifiedLessonCatalogue} from '../functions/lib/read2lead/private-voice.mjs';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {azureUsageKey} from '../functions/api/_azure-pronunciation.js';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};

const key=()=>azureUsageKey();
const cache='tts:aura-2-en:luna:'+ 'a'.repeat(64);
function wav(){
  const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);
  return new Blob([b],{type:'audio/wav'});
}
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());let broken=false,legacyReads=0,legacyWrites=0;
  const transaction=fn=>{if(broken)throw Error('synthetic storage failure');db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
  const legacy={async get(k){assert.equal(k,cache,'only validated TTS may reach legacy');legacyReads++;return {audio_b64:'legacy-cache'};},put(){legacyWrites++;throw Error('legacy writes forbidden');}};
  const options={db,transaction,progressInCodes:true,legacySpeechCache:legacy};
  const meter=createAccountVoiceMetadata(options);
  db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,?,?)').run('codes','progress:SYNTHETIC','{"diamonds":520,"saved":"keep"}',null,null);
  const seed=(value,expires=null)=>db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,expires=excluded.expires').run('codes',key(),value,expires,null);
  const used=()=>JSON.parse(db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get('codes',key()).value);
  return {db,transaction,options,meter,seed,used,broken:v=>broken=v,legacyReads:()=>legacyReads,legacyWrites:()=>legacyWrites};
}
test('Azure reservation reads and updates only authoritative SQL while preserving progress',async t=>{
  const f=fixture(t);f.seed('100');assert.equal(await f.meter.reserveAzureSeconds(key(),45),true);assert.equal(f.used(),145);
  const row=f.db.prepare('SELECT * FROM read2lead_account_kv WHERE key=?').get(key());assert.ok(row.expires>Date.now()+39*86400000);
  assert.equal(f.db.prepare('SELECT value FROM read2lead_account_kv WHERE key=?').get('progress:SYNTHETIC').value,'{"diamonds":520,"saved":"keep"}');
  assert.equal(f.legacyReads(),0);assert.equal(f.legacyWrites(),0);
});
test('concurrent reservations cannot exceed the cap or overwrite another increment',async t=>{
  const f=fixture(t);f.seed('17999');const results=await Promise.all(Array.from({length:20},()=>f.meter.reserveAzureSeconds(key(),1)));
  assert.equal(results.filter(Boolean).length,1);assert.equal(f.used(),18000);
  f.seed('100');const accepted=await Promise.all(Array.from({length:20},()=>f.meter.reserveAzureSeconds(key(),0.5)));
  assert.ok(accepted.every(Boolean));assert.equal(f.used(),110);
});
test('separate host adapters conflict safely rather than losing shared usage',async t=>{
  const f=fixture(t);f.seed('17999');const other=createAccountVoiceMetadata(f.options);
  const results=await Promise.all([f.meter.reserveAzureSeconds(key(),1),other.reserveAzureSeconds(key(),1)]);
  assert.equal(results.filter(Boolean).length,1);assert.equal(f.used(),18000);
});
test('invalid, exhausted, corrupt or unavailable meters refuse without resetting them',async t=>{
  const f=fixture(t);
  for(const raw of ['18000','-1','"broken"','{}','false','"0"','not-json']){
    f.seed(raw);assert.equal(await f.meter.reserveAzureSeconds(key(),1),false);assert.equal(f.db.prepare('SELECT value FROM read2lead_account_kv WHERE key=?').get(key()).value,raw);
  }
  f.seed('100');f.broken(true);assert.equal(await f.meter.reserveAzureSeconds(key(),1),false);assert.equal(f.used(),100);
  for(const seconds of [0,-1,NaN,Infinity,122,'1'])assert.equal(await f.meter.reserveAzureSeconds(key(),seconds),false);
  assert.equal(await f.meter.reserveAzureSeconds('azure-pa-secs:2000-01',1),false);
  assert.equal(f.legacyReads(),0);assert.equal(f.legacyWrites(),0);
});
test('retained cache is read-only fallback; new cache is written to SQL',async t=>{
  const f=fixture(t);assert.deepEqual(await f.meter.get(cache,{type:'json'}),{audio_b64:'legacy-cache'});assert.equal(f.legacyReads(),1);
  await f.meter.put(cache,'{"audio_b64":"new-cache"}');assert.deepEqual(await f.meter.get(cache,{type:'json'}),{audio_b64:'new-cache'});assert.equal(f.legacyReads(),1);assert.equal(f.legacyWrites(),0);
  f.db.prepare('UPDATE read2lead_account_kv SET value=? WHERE key=?').run('invalid-json',cache);
  await assert.rejects(f.meter.get(cache,{type:'json'}),/unavailable/);assert.equal(f.legacyReads(),1,'SQL failure never falls through to old state');
});
test('providers cannot read or write arbitrary account, diagnostic or counter keys',async t=>{
  const f=fixture(t);
  for(const k of ['progress:SYNTHETIC',key(),'debug:speaking-errors','tts:unvalidated']){
    await assert.rejects(f.meter.get(k,{type:'json'}),/key_refused/);await assert.rejects(f.meter.put(k,'0'),/key_refused/);
  }
  await assert.rejects(f.meter.get(cache,{type:'text'}),/key_refused/);assert.equal(f.legacyReads(),0);
});
test('picture pronunciation reserves before calls and retains reservations on failures',async t=>{
  const f=fixture(t);f.seed('100');let calls=0;
  const pronounce=createPicturePronunciation({env:{AZURE_SPEECH_KEY:'synthetic',AZURE_SPEECH_REGION:'test',READ2LEAD_CODES:f.meter},fetchFn:async()=>{calls++;assert.equal(f.used(),101);throw Error('simulated provider failure');}});
  assert.equal(await pronounce(wav()),null);assert.equal(calls,1);assert.equal(f.used(),101);assert.equal(f.legacyWrites(),0);
  f.seed('18000');assert.equal(await pronounce(wav()),null);assert.equal(calls,1);
});

async function configured(t,kind,{legacyBug=false}={}){
  const f=fixture(t),store=new StorySqlStore(f.db,{transaction:f.transaction});
  const approvalSha256='a'.repeat(64),packageSha256='b'.repeat(64),digest=await publisherDigest(pkg);
  const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:[{id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:digest}]});
  const budget={scope:'batch',batchId:kind==='student'?'r2l-student-launch-'+approvalSha256.slice(0,32):'r2l-existing-student-synthetic',expiresAt:new Date(Date.now()+86400000).toISOString(),approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:70000,maxTurns:32};
  const common={mode:'assessed',providerRoute:'cloudflare-only',assessorModel:'gpt-oss-120b',packageSha256,processingApproved:true,spendingApproved:true,pricingEvidenceSha256:'c'.repeat(64),verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256},budget};
  let calls=0,wrongWrites=0;
  const env={AI:{run(){throw Error('no model calls');}},AZURE_SPEECH_KEY:'synthetic',AZURE_SPEECH_REGION:'test',READ2LEAD_CODES:legacyBug?{get:async()=>0,put:async()=>{wrongWrites++;}}:f.meter};
  const options={store,env,packageSha256,lessonCatalogue:catalogue,fetchFn:async()=>{calls++;return Response.json({RecognitionStatus:'Success',NBest:[{Display:'Synthetic spoken result.',AccuracyScore:80,FluencyScore:70,PronScore:75}]});}};
  let result;
  if(kind==='student'){
    env.R2L_STUDENT_VOICE_CONFIG=JSON.stringify({...common,format:'read2lead-student-voice-v1',audience:'enrolled-students',approvalSha256});
    result=await studentVoiceConfiguration({...options,approvedGrant:{approvalSha256,budget}});
  }else{
    env.R2L_EXISTING_TEST_VOICE_CONFIG=JSON.stringify({...common,format:'read2lead-private-voice-v1',adultTrialApproved:true,verifiedLessonsOnly:true});
    result=existingStudentVoiceConfiguration(options);
  }
  assert.ok(result.config);return {...f,provider:result.config.provider,calls:()=>calls,wrongWrites:()=>wrongWrites};
}
for(const kind of ['student','founder'])test(`configured ${kind} provider respects migrated SQL quota and preserved balance`,async t=>{
  const f=await configured(t,kind);f.seed('18000');assert.equal(await f.provider.picturePronunciation(wav()),null);assert.equal(f.calls(),0);
  f.seed('100');assert.ok(await f.provider.picturePronunciation(wav()));assert.equal(f.calls(),1);assert.equal(f.used(),101);assert.equal(f.legacyWrites(),0);
  assert.equal(f.db.prepare('SELECT value FROM read2lead_account_kv WHERE key=?').get('progress:SYNTHETIC').value,'{"diamonds":520,"saved":"keep"}');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM story_voice_reservations').get().n,0,'metadata does not mint or reset dollar grants');
});
test('known-bad raw legacy binding is caught by the exhausted SQL quota assertion',async t=>{
  const f=await configured(t,'student',{legacyBug:true});f.seed('18000');await f.provider.picturePronunciation(wav());
  assert.throws(()=>assert.equal(f.calls(),0),assert.AssertionError);assert.equal(f.wrongWrites(),1);assert.equal(f.used(),18000);
});
