import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StorySqlStore} from '../functions/lib/read2lead/story-store.mjs';
import {PrivateStoryBudgetStore} from '../scripts/lib/read2lead-story-budget-store.mjs';
import {createPrivateSiteApi,PRIVATE_SITE_CODE as code} from '../functions/lib/read2lead/private-site.mjs';
import {runPrivateConversation} from '../functions/lib/read2lead/private-conversation.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
const reply='Nice! What do you like?';
function fixture(t,{maxTurns=8,reserve=true,run,fetchFn}={}) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const store=new StorySqlStore(db,{transaction:fn=>{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const calls=[],budget=new PrivateStoryBudgetStore(store,{scope:'batch',batchId:'conversation-fixture',expiresAt:'2026-10-02T00:00:00.000Z',approvedVoiceMicroUsd:2000000,worstCaseTurnMicroUsd:100000,maxTurns},()=>new Date('2026-09-28T00:00:00.000Z'));
 const config={budget,activation:{externalProcessingApproved:true,spendingApproved:true,adultTrialApproved:true},legacyAI:{async run(model,input){calls.push({model,input});if(run)return run(model,input);if(model.includes('whisper'))return {text:'I enjoy drawing pictures'};if(model.includes('guard'))return {response:'safe'};if(model.includes('instruct'))return {response:JSON.stringify({reply_en:reply,mood:'idle'})};return new Uint8Array([73,68,51]);}},legacyConversationFetch:async(url,options)=>{calls.push({model:'openrouter',url,body:JSON.parse(options.body)});if(fetchFn)return fetchFn(url,options);return Response.json({choices:[{message:{content:JSON.stringify({reply_en:reply,mood:'idle'})}}]});}};
 let api;const restart=()=>{api=createPrivateSiteApi({store:new StorySqlStore(db,{transaction:fn=>store.transaction(fn)}),pkg,voiceConfig:config,authenticate:r=>r.headers.get('cookie')==='fixture'});};
 // Synthetic reservation history only, created before connecting assignment/profile sinks.
 const session=store.open(code,pkg.lesson).sessionId;if(reserve)budget.reserve(session);restart();
 async function call(body,headers={},method='POST') {
  const request=new Request('https://qa.example/api/minny-conversation',{method,headers:{cookie:'fixture',Origin:'https://qa.example',...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},...(method==='POST'?{body:body instanceof FormData?body:JSON.stringify({access_code:code,...body})}:{})});
  const r=await api(request);return {status:r.status,value:await r.json()};
 }
 const row=key=>{const x=db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(key);return x?JSON.parse(x.value):null;};
 const turns=()=>db.prepare('SELECT state FROM story_voice_turns ORDER BY rowid').all().map(x=>x.state);
 return {db,store,config,calls,budget,session,restart,call,row,turns};
}






test('private conversation timeout denies late writes and spending, retaining uncertain reservation',async t=>{
 const s=fixture(t);let release,cap;const held=new Promise(r=>{release=r;});let commits=0;
 const response=await runPrivateConversation({handler:async ctx=>{cap=ctx;await ctx.env.AI.run('@cf/deepgram/aura-2-en',{text:'Hello'});return Response.json({ok:true});},request:new Request('https://qa.example'),env:{READ2LEAD_CODES:{get:async()=>null}},voiceConfig:{...s.config,legacyAI:{run:()=>held}},store:s.store,owner:code,commit:()=>{commits++;},timeoutMs:5});
 assert.equal(response.status,503);assert.deepEqual(s.turns(),['failed_or_unknown']);assert.equal(commits,0);
 await assert.rejects(()=>cap.env.READ2LEAD_CODES.put('late','value'),/closed/);await assert.rejects(()=>cap.env.AI.run('@cf/deepgram/aura-2-en',{text:'Late'}),/closed/);
 release(new Uint8Array([1]));await new Promise(r=>setImmediate(r));assert.deepEqual(s.turns(),['failed_or_unknown']);assert.equal(commits,0);
});
test('private conversation refuses alternate destinations and models without exposing credentials',async t=>{
 const s=fixture(t);
 for(const handler of [async ctx=>{assert.equal(ctx.env.OPENROUTER_API_KEY,'private-capability');assert.equal(ctx.env.OPENAI_API_KEY,undefined);await ctx.minnyReplyOptions.fetchFn('https://unapproved.example',{method:'POST',body:'{}'});return Response.json({ok:true});},async ctx=>{await ctx.env.AI.run('unapproved-model',{});return Response.json({ok:true});}]) {
  const r=await runPrivateConversation({handler,request:new Request('https://qa.example'),env:{READ2LEAD_CODES:{}},voiceConfig:s.config,store:s.store,owner:code,commit:()=>assert.fail('must not commit')});assert.equal(r.status,503);
 }
 assert.equal(s.calls.length,0);assert.equal(s.turns().length,0);
});


test('conversation capability enforces per-model attempts and rolls back denied work',async t=>{
 const s=fixture(t);
 const response=await runPrivateConversation({handler:async ctx=>{await ctx.env.READ2LEAD_CODES.put('must-not-save','true');for(let i=0;i<3;i++)await ctx.env.AI.run('@cf/deepgram/aura-2-en',{text:'Hello'});return Response.json({ok:true});},request:new Request('https://qa.example'),env:{READ2LEAD_CODES:{}},voiceConfig:s.config,store:s.store,owner:code,commit:()=>assert.fail('denied request cannot commit')});
 assert.equal(response.status,503);assert.equal(s.calls.length,2);assert.deepEqual(s.turns(),['succeeded','succeeded']);
});
