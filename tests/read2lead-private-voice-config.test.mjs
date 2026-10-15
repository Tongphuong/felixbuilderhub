import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {privateVoiceConfiguration,existingStudentVoiceConfiguration,runPrivateLegacyVoice,verifiedLessonCatalogue} from '../functions/lib/read2lead/private-voice.mjs';
import {storyVoiceEnabled} from '../functions/api/read2lead-story-turn.js';
import {publisherDigest} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
function setup(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const packageSha256='a'.repeat(64),now=()=>new Date('2026-09-28T00:00:00Z');let calls=0;
 const env={AI:{run(){calls++;throw Error('must not call provider');}},OPENROUTER_API_KEY:'fabricated-test-key',READ2LEAD_CODES:{get(){throw Error('never production storage');}}};
 const raw={format:'read2lead-private-voice-v1',packageSha256,mode:'adult-practice',processingApproved:true,spendingApproved:true,adultTrialApproved:true,pricingEvidenceSha256:'b'.repeat(64),
  budget:{month:'2026-09',baselineReconciled:true,existingCostsMicroUsd:39980000,approvedVoiceMicroUsd:20000,worstCaseTurnMicroUsd:10000,maxTurns:2}};
 const configure=value=>privateVoiceConfiguration({store,env:{...env,...(value===undefined?{}:{R2L_PRIVATE_VOICE_CONFIG:typeof value==='string'?value:JSON.stringify(value)})},packageSha256,now,fetchFn:()=>{calls++;throw Error('must not call provider');}});
 return{db,store,env,raw,configure,calls:()=>calls};
}
test('absent, malformed, unapproved, unpinned and unreconciled config stays disabled without provider calls',t=>{
 const s=setup(t);const inputs=[undefined,'{',{}, {...s.raw,processingApproved:false},{...s.raw,packageSha256:'c'.repeat(64)},
  {...s.raw,pricingEvidenceSha256:''},{...s.raw,budget:{...s.raw.budget,month:'2026-08'}},
  {...s.raw,budget:{...s.raw.budget,existingCostsMicroUsd:40000000}},
  {...s.raw,budget:{...s.raw.budget,approvedVoiceMicroUsd:0}},
  {...s.raw,mode:'assessed'},{...s.raw,mode:'assessed',verification:{provider:true,assessor:false,evidenceSha256:'d'.repeat(64)}}];
 for(const input of inputs){const result=s.configure(input);assert.equal(result.config,null);assert.equal(result.status.enabled,false);assert.equal(storyVoiceEnabled(result.config),false);}
 assert.equal(s.calls(),0);
});
test('explicit Cloudflare trial uses existing services and never falls back to external credentials',async t=>{
 const s=setup(t),calls=[];delete s.env.OPENROUTER_API_KEY;s.env.OPENAI_API_KEY='must-not-use';
 s.env.AI.run=async(model,input)=>{calls.push(model);if(model.includes('llama'))return {choices:[{finish_reason:'stop',message:{content:'{"reply":"That is right.","sentenceIds":["s1"]}'}}]};throw Error('provider unavailable');};
 assert.equal(s.configure(s.raw).status.reason,'existing_providers_missing');
 assert.equal(s.configure({...s.raw,providerRoute:'unknown'}).status.reason,'provider_route_not_supported');
 const configured=s.configure({...s.raw,providerRoute:'cloudflare-only'});assert.equal(configured.status.enabled,true);
 await configured.config.provider.respond([{role:'user',content:'test'}]);
 await assert.rejects(configured.config.provider.synthesize('Hello.'),/provider unavailable/);
 await assert.rejects(configured.config.provider.transcribe(new Blob(['test'],{type:'audio/wav'})),/workers_ai_transcription_failed/);
 assert.deepEqual(calls,['@cf/meta/llama-3.3-70b-instruct-fp8-fast','@cf/deepgram/aura-2-en','@cf/openai/whisper-large-v3-turbo']);assert.equal(s.calls(),0);
});
test('adult configuration remains unassessed and reserves bounded SQL budget without speculative refunds',t=>{
 const s=setup(t),r=s.configure(s.raw);assert.equal(r.status.mode,'adult-practice');assert.equal(storyVoiceEnabled(r.config),true);assert.equal(r.config.activation.assessorValidated,false);assert.equal(r.config.activation.providerVerified,false);assert.equal(r.config.practiceTrial,true);
 const a=s.store.open('one',pkg.lesson),b=s.store.open('two',pkg.lesson);r.config.budget.claim(a.sessionId,'trial-1');r.config.budget.finish(a.sessionId,'trial-1','failed_or_unknown');
 assert.throws(()=>r.config.budget.claim(b.sessionId,'other'),/budget_exhausted/);
 assert.throws(()=>r.config.budget.claim(a.sessionId,'trial-1'),/already_claimed/);
 r.config.budget.claim(a.sessionId,'trial-2');assert.throws(()=>r.config.budget.claim(a.sessionId,'trial-3'),/turn_limit/);assert.equal(s.calls(),0);
});
test('assessed configuration requires exact lesson verification; older or changed packages stay ungraded',async t=>{
 const s=setup(t),verification={provider:true,assessor:true,evidenceSha256:'d'.repeat(64)};
 for(const lessons of [undefined,[],[{}],[{id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:'wrong'}]])
   assert.equal(s.configure({...s.raw,mode:'assessed',verification:{...verification,lessons}}).status.reason,'verification_scope_missing');
 const entry={id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)};
 assert.equal(s.configure({...s.raw,mode:'assessed',verification:{...verification,lessons:[entry,entry]}}).status.reason,'verification_scope_missing');
 const r=s.configure({...s.raw,mode:'assessed',verification:{...verification,lessons:[entry]}});
 assert.equal(r.config.practiceTrial,true);assert.equal(r.config.activation.assessorValidated,false);
 const approved=await r.config.forPackage(pkg);
 assert.equal(approved.practiceTrial,false);assert.equal(approved.activation.assessorValidated,true);
 for(const mutation of [p=>p.lesson.version='1.2.999',p=>p.lesson.id+='-other',p=>p.lesson.story.sentences[0].text_en+=' Changed.',p=>p.assets.push({sha256:'f'.repeat(64)})]) {
   const changed=structuredClone(pkg);mutation(changed);const config=await r.config.forPackage(changed);
   assert.equal(config.practiceTrial,true);assert.equal(config.activation.providerVerified,false);assert.equal(config.activation.assessorValidated,false);
   assert.equal(config.budget,approved.budget,'scope never creates a new allowance');
 }
 assert.equal(s.calls(),0);
 delete s.env.OPENROUTER_API_KEY;assert.equal(s.configure(s.raw).status.reason,'existing_providers_missing');
});

test('candidate assessor is explicit, stays ungraded in adult practice and never changes legacy services',async t=>{
 const s=setup(t);assert.equal(s.configure({...s.raw,assessorModel:'unknown'}).status.reason,'assessor_not_supported');assert.equal(s.calls(),0);
 const result=s.configure({...s.raw,assessorModel:'gpt-oss-120b',assessorTrial:true});assert.equal(result.status.enabled,true);
 assert.equal(result.config.practiceTrial,true);assert.equal(result.config.activation.assessorValidated,false);
 assert.equal(result.config.activation.providerVerified,false);assert.equal(result.config.legacyAI,s.env.AI);assert.equal(s.calls(),0);
 let model;
 s.env.AI.run=async selected=>{model=selected;return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({intent:'help',unclearSpan:'',criteria:[{id:'meaning',met:false,quote:''}],replySupport:'none'})}}]};};
 const answer=await result.config.provider.assess({task:{id:'test',source:'story',prompt:'What happens?',criteria:[{id:'meaning',meaning:'An uncle sends a picture.'}]},transcript:'I do not know.'});
 assert.equal(model,'@cf/openai/gpt-oss-120b');assert.equal(answer.reliability,'confirmed');assert.equal(answer.criteria[0].met,false);
 assert.equal(answer.intent,'help');
 s.env.AI.run=async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({unclearSpan:'',criteria:[{id:'meaning',met:false,quote:''}],replySupport:'none'})}}]});
 await assert.rejects(result.config.provider.assess({task:{id:'test',prompt:'What happens?',criteria:[{id:'meaning',meaning:'An uncle sends a picture.'}]},transcript:'I do not know.'}),/invalid_semantic_judgment/);
 assert.equal(s.configure({...s.raw,mode:'assessed',assessorModel:'gpt-oss-120b'}).status.reason,'verification_missing');
});
test('explicit test batch needs no monthly reconciliation, but expired or missing cap stays disabled',t=>{
 const s=setup(t),budget={scope:'batch',batchId:'private-fixture',expiresAt:'2026-09-29T00:00:00.000Z',approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:20000,maxTurns:8};
 const r=s.configure({...s.raw,budget});assert.equal(r.status.enabled,true);assert.equal(r.config.practiceTrial,true);
 assert.equal(r.config.legacyAI,s.env.AI,'only validated configuration exposes the existing AI capability');
 assert.equal(s.configure({...s.raw,budget:{...budget,expiresAt:'2026-09-28T00:00:00.000Z'}}).status.reason,'budget_batch_expired');
 assert.equal(s.configure({...s.raw,budget:{...budget,approvedVoiceMicroUsd:0}}).status.enabled,false);
 assert.equal(s.calls(),0);
});

function serviceConfiguration(t) {
 const s=setup(t),value={...s.raw,budget:{scope:'batch',batchId:'service-fixture',expiresAt:'2026-09-29T00:00:00.000Z',approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:100000,maxTurns:2}};
 const {config}=s.configure(value),session=s.store.open('owner',pkg.lesson).sessionId;config.budget.reserve(session);
 const invoke=handler=>runPrivateLegacyVoice({handler,request:new Request('https://qa.example/api/read2lead-voice'),env:{READ2LEAD_CODES:{},OPENAI_API_KEY:'must-not-forward',OPENROUTER_API_KEY:'must-not-forward'},voiceConfig:config,store:s.store,owner:'owner',service:'tts'});
 return {...s,config,session,invoke};
}
test('existing student voice never inherits adult allowance and preserves a spent student batch across configuration reload',async t=>{
 const s=setup(t),now=()=>new Date('2026-09-28T00:00:00.000Z');
 const adult={...s.raw,budget:{scope:'batch',batchId:'r2l-private-adult-fixture',expiresAt:'2026-09-29T00:00:00.000Z',approvedVoiceMicroUsd:20000,worstCaseTurnMicroUsd:10000,maxTurns:2}};
 const student={...adult,budget:{...adult.budget,batchId:'r2l-existing-student-fixture'}};
 const configure=value=>existingStudentVoiceConfiguration({store:s.store,env:{...s.env,R2L_PRIVATE_VOICE_CONFIG:JSON.stringify(adult),...(value===undefined?{}:{R2L_EXISTING_TEST_VOICE_CONFIG:typeof value==='string'?value:JSON.stringify(value)})},packageSha256:s.raw.packageSha256,now,fetchFn:()=>{throw Error('must not call provider');}});
 assert.equal(configure().status.reason,'not_configured');
 for(const raw of [adult,s.raw,{...student,budget:{...student.budget,batchId:'r2l-existing-student-'}}])assert.equal(configure(raw).status.reason,'student_batch_required');
 assert.equal(configure('{').status.reason,'invalid_configuration');
 assert.equal(configure({...student,spendingApproved:false}).status.reason,'approval_missing');
 assert.equal(configure({...student,packageSha256:'e'.repeat(64)}).status.reason,'package_or_mode_mismatch');
 const configured=configure(student);assert.equal(configured.status.enabled,true);assert.equal(storyVoiceEnabled(configured.config),true);
 const session=s.store.open('existing-test-learner',pkg.lesson).sessionId;
 configured.config.budget.claim(session,'one');configured.config.budget.finish(session,'one','succeeded');
 configured.config.budget.claim(session,'two');configured.config.budget.finish(session,'two','failed_or_unknown');
 const rows=s.db.prepare('SELECT * FROM story_voice_reservations').all();
 assert.throws(()=>configure(student).config.budget.claim(session,'three'),/voice_turn_limit/);
 assert.throws(()=>configure(student).config.budget.claim(s.store.open('second-session',pkg.lesson).sessionId,'four'),/voice_budget_exhausted/);
 assert.deepEqual(s.db.prepare('SELECT * FROM story_voice_reservations').all(),rows);
 assert.equal(configure({...student,budget:{...student.budget,expiresAt:'2026-09-28T00:00:00.000Z'}}).status.reason,'budget_batch_expired');
 assert.equal(s.calls(),0);
});
test('service capability cannot leak external credentials, use another model or exceed two calls',async t=>{
 const s=serviceConfiguration(t);let calls=0;s.env.AI.run=async()=>{calls++;return new Uint8Array([1]);};
 const response=await s.invoke(async({env})=>{
  assert.deepEqual(Object.keys(env).sort(),['AI','READ2LEAD_CODES']);
  await env.AI.run('@cf/deepgram/aura-2-en',{});await env.AI.run('@cf/myshell-ai/melotts',{});
  await env.AI.run('@cf/myshell-ai/melotts',{});return Response.json({ok:true});
 });assert.equal(response.status,503);assert.equal(calls,2);
 assert.equal(s.db.prepare('SELECT state FROM story_voice_turns').get().state,'failed_or_unknown');
 const refused=await s.invoke(async({env})=>{await env.AI.run('unknown-model',{});return Response.json({ok:true});});
 assert.equal(refused.status,503);assert.equal(calls,2);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_voice_turns').get().n,1);
});
test('late provider completion retains unknown outcome and cannot start background spending',async t=>{
 const s=serviceConfiguration(t);let resolve,pending,capability,calls=0;
 s.env.AI.run=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const response=await s.invoke(async({env})=>{capability=env.AI;pending=env.AI.run('@cf/deepgram/aura-2-en',{});return Response.json({ok:true});});
 assert.equal(response.status,200);assert.equal(s.db.prepare('SELECT state FROM story_voice_turns').get().state,'failed_or_unknown');
 await assert.rejects(()=>capability.run('@cf/myshell-ai/melotts',{}),/not_authorized/);assert.equal(calls,1);
 resolve(new Uint8Array([1]));await pending;
 assert.equal(s.db.prepare('SELECT state FROM story_voice_turns').get().state,'failed_or_unknown');
});

test('validated conversation fetch capability keeps provider credentials server-side',async t=>{
 const s=setup(t),calls=[];
 const raw={...s.raw,budget:{scope:'batch',batchId:'credential-fixture',expiresAt:'2026-09-29T00:00:00.000Z',approvedVoiceMicroUsd:5000000,worstCaseTurnMicroUsd:100000,maxTurns:2}};
 const result=privateVoiceConfiguration({store:s.store,env:{...s.env,R2L_PRIVATE_VOICE_CONFIG:JSON.stringify(raw)},packageSha256:s.raw.packageSha256,now:()=>new Date('2026-09-28T00:00:00.000Z'),fetchFn:async(url,options)=>{calls.push({url,options});return Response.json({ok:true});}});
 assert.equal(result.status.enabled,true);assert.equal(calls.length,0);
 const response=await result.config.legacyConversationFetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private-capability','Content-Type':'application/json'},body:'{}'});
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+s.env.OPENROUTER_API_KEY);assert.equal(calls[0].options.headers['Content-Type'],'application/json');assert.deepEqual(await response.json(),{ok:true});
 assert.equal(JSON.stringify(result.status).includes(s.env.OPENROUTER_API_KEY),false);assert.equal(result.config.OPENROUTER_API_KEY,undefined);
});

test('restricted grant cannot be consumed by an older, different or modified lesson',async t=>{
 const s=setup(t),entry={id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)};
 assert.equal(s.configure({...s.raw,verifiedLessonsOnly:true}).status.reason,'verified_scope_required');
 const r=s.configure({...s.raw,mode:'assessed',verifiedLessonsOnly:true,verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),lessons:[entry]}});
 assert.equal((await r.config.forPackage(pkg)).practiceTrial,false);
 for(const change of [p=>p.lesson.version='1.2.999',p=>p.lesson.id+='-different',p=>p.lesson.story.sentences[0].text_en+=' Changed']){const altered=structuredClone(pkg);change(altered);assert.equal(await r.config.forPackage(altered),null);}
 assert.equal(s.calls(),0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_voice_reservations').get().n,0);
});

test('300 manifest-pinned lessons share one persisted allowance and reject modified packages',async t=>{
 const s=setup(t),packages=Array.from({length:300},(_,i)=>{const p=structuredClone(pkg);p.lesson.id='catalogue-lesson-'+i;return p;});
 const lessons=await Promise.all(packages.map(async p=>({id:p.lesson.id,version:p.lesson.version,packageSha256:await publisherDigest(p)})));
 const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:lessons});
 const raw={...s.raw,mode:'assessed',verifiedLessonsOnly:true,verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256}};
 assert.ok(JSON.stringify(raw).length<4096);
 const configure=(value=raw,lessonCatalogue=catalogue)=>privateVoiceConfiguration({store:s.store,env:{...s.env,R2L_PRIVATE_VOICE_CONFIG:JSON.stringify(value)},packageSha256:s.raw.packageSha256,lessonCatalogue,now:()=>new Date('2026-09-28T00:00:00Z')});
 const configured=configure();assert.equal(configured.status.enabled,true);
 for(const p of packages){const c=await configured.config.forPackage(p);assert.equal(c.practiceTrial,false);assert.equal(c.budget,configured.config.budget);}
 const changed=structuredClone(packages[299]);changed.lesson.story.sentences[0].text_en+=' Different.';
 assert.equal(await configured.config.forPackage(changed),null);assert.equal(await configured.config.forPackage(pkg),null);
 const session=s.store.open('catalogue-owner',packages[0].lesson).sessionId;
 configured.config.budget.claim(session,'first');configured.config.budget.finish(session,'first','succeeded');
 configured.config.budget.claim(session,'second');configured.config.budget.finish(session,'second','succeeded');
 const reloaded=configure();assert.throws(()=>reloaded.config.budget.claim(s.store.open('other',packages[299].lesson).sessionId,'third'),/budget_exhausted/);
 lessons[0].packageSha256='e'.repeat(64);assert.equal((await configured.config.forPackage(packages[0])).practiceTrial,false,'snapshot survives original array mutation');
 assert.throws(()=>{catalogue.lessons[0].packageSha256='e'.repeat(64)},TypeError);
 for(const [value,list] of [[raw,null],[{...raw,verification:{...raw.verification,catalogueSha256:'f'.repeat(64)}},catalogue],[{...raw,verification:{...raw.verification,lessons:[catalogue.lessons[0]]}},catalogue],[{...raw,verifiedLessonsOnly:false},catalogue]])assert.equal(configure(value,list).status.reason,'verification_catalogue_mismatch');
 const altered=await verifiedLessonCatalogue({voiceVerificationLessons:lessons});assert.notEqual(altered.sha256,catalogue.sha256);assert.equal(configure(raw,altered).status.reason,'verification_catalogue_mismatch');
 assert.equal(s.calls(),0);
});

test('catalogue rejects malformed, duplicate and oversized lists; existing student uses explicit catalogue only',async t=>{
 const s=setup(t),entry={id:pkg.lesson.id,version:pkg.lesson.version,packageSha256:await publisherDigest(pkg)};
 assert.equal(await verifiedLessonCatalogue({}),null);
 for(const lessons of [null,[],[entry,entry],[{...entry,extra:true}],[{...entry,version:'2.0.0'}],[{...entry,packageSha256:'wrong'}],Array.from({length:321},(_,i)=>({...entry,id:'lesson-'+i}))])await assert.rejects(verifiedLessonCatalogue({voiceVerificationLessons:lessons}),/voice_catalogue_invalid/);
 const catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:[entry]}),raw={...s.raw,mode:'assessed',verifiedLessonsOnly:true,verification:{provider:true,assessor:true,evidenceSha256:'d'.repeat(64),catalogueSha256:catalogue.sha256},budget:{scope:'batch',batchId:'r2l-existing-student-catalogue',expiresAt:'2026-09-29T00:00:00.000Z',approvedVoiceMicroUsd:20000,worstCaseTurnMicroUsd:10000,maxTurns:2}};
 const configure=lessonCatalogue=>existingStudentVoiceConfiguration({store:s.store,env:{...s.env,R2L_EXISTING_TEST_VOICE_CONFIG:JSON.stringify(raw)},packageSha256:s.raw.packageSha256,lessonCatalogue,now:()=>new Date('2026-09-28T00:00:00Z')});
 assert.equal(configure().status.enabled,false);assert.equal((await configure(catalogue).config.forPackage(pkg)).practiceTrial,false);
 assert.equal(s.calls(),0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM story_voice_reservations').get().n,0);
});
