// Synthetic rehearsal harness for a Read2Lead Worker candidate. Local only.
// Adapted from Codex's theme-worker.mjs (2026-10-16). rehearse.mjs replaces __SRC__ with the
// candidate's source/ directory and bundles this file with esbuild. Never production source.
import {Read2LeadPrivatePreview} from '__SRC__/cloudflare/read2lead-private-preview/worker.mjs';
import {durableSqlAdapter} from '__SRC__/cloudflare/read2lead-private-preview/app.mjs';
import {createAccountTransactionRunner} from '__SRC__/functions/lib/read2lead/account-transactions.mjs';
import {importAccountSnapshot,mergeAccountSnapshot} from '__SRC__/functions/lib/read2lead/account-snapshot.mjs';
import {unifiedAccountGateway} from '__SRC__/functions/lib/read2lead/account-unified-gateway.mjs';

function wav(){const b=new Uint8Array(32044),v=new DataView(b.buffer);const tag=(at,s)=>[...s].forEach((c,i)=>b[at+i]=c.charCodeAt(0));tag(0,'RIFF');v.setUint32(4,b.length-8,true);tag(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,32000,true);for(let i=44;i<b.length;i+=2)v.setInt16(i,i%4?1000:-1000,true);return b;}
const audio=wav();
const choices=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
export class SyntheticReleaseState extends Read2LeadPrivatePreview{
 constructor(ctx,env){
  const fixture=JSON.parse(env.SYNTHETIC_FIXTURE),adapter=durableSqlAdapter(ctx.storage),state={sessionId:null,original:'',calls:0,models:{}};
  const AI={async run(model,input){
   state.calls++;state.models[model]=(state.models[model]||0)+1;
   if(model.includes('whisper')){
    if(!state.sessionId)return {text:state.original};
    const row=adapter.db.prepare('SELECT state FROM story_sessions WHERE id=?').get(state.sessionId),session=JSON.parse(row.state);
    return {text:session.stage==='picture_retell'?fixture.pkg.lesson.story.sentences.map(s=>s.text_en).join(' '):fixture.pkg.lesson.questions[session.questionIndex].accepted_meanings[0]};
   }
   if(model.includes('aura')||model.includes('melotts'))return new Response(audio).body;
   const value=JSON.parse(input.messages.at(-1).content);
   if(model.includes('gpt-oss'))return choices({intent:'answer',unclearSpan:'',criteria:value.task.criteria.map(c=>({id:c.id,met:true,quote:value.transcript.slice(0,120)})),replySupport:'none'});
   if(input.messages[0].content.startsWith('Check only the proposed tutor reply'))return choices({safe:true,grounded:true,staysOnTask:true,replySupport:'none'});
   return choices({reply:'Thank you.',sentenceIds:[]});
  }};
  super(ctx,{...env,AI});this.ctx=ctx;this.state=state;this.adapter=adapter;
  this.ready=ctx.blockConcurrencyWhile(async()=>{
   createAccountTransactionRunner({...adapter,progressInCodes:true});
   await importAccountSnapshot({...adapter,snapshot:fixture.initial,expectedSha256:fixture.initial.sha256,progressInCodes:true});
   await mergeAccountSnapshot({...adapter,snapshot:fixture.snapshot,plan:fixture.plan,expectedPlanSha256:fixture.plan.sha256,progressInCodes:true});
  });
 }
 async fetch(request){
  await this.ready;const url=new URL(request.url);
  const tableExists=name=>!!this.adapter.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if(url.pathname==='/__synthetic/report')return Response.json({simulatedModelCalls:this.state.calls,models:this.state.models,accounts:this.adapter.db.prepare("SELECT key,value FROM read2lead_account_kv WHERE key LIKE 'R2L-SYNTHETIC-%' OR key LIKE 'progress:R2L-SYNTHETIC-%'").all().map(r=>({...r,value:JSON.parse(r.value)})),sessions:tableExists('story_sessions')?this.adapter.db.prepare('SELECT owner,state FROM story_sessions').all().map(r=>({...r,state:JSON.parse(r.state)})):[],reservations:tableExists('story_voice_reservations')?this.adapter.db.prepare('SELECT * FROM story_voice_reservations').all():[]});
  if(request.headers.get('content-type')?.startsWith('multipart/form-data')){const form=await request.clone().formData();this.state.sessionId=String(form.get('sessionId')||'')||null;this.state.original=String(form.get('expected_text')||'');}
  return super.fetch(request);
 }
}
const notice='<aside data-synthetic-rehearsal style="background:#fff;color:#172f42;padding:8px;font:13px system-ui">LOCAL REHEARSAL · Invented accounts · Simulated audio and grading · Not production</aside>';
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.origin!=='https://release-rehearsal.invalid')return new Response('Invalid local origin',{status:403});
 if(url.pathname.startsWith('/admin')||url.pathname.startsWith('/api/admin')||url.pathname.startsWith('/__private'))return new Response(null,{status:404});
 if(url.pathname==='/__synthetic/report')return env.R2L_MAINTENANCE_STATE.get(env.R2L_MAINTENANCE_STATE.idFromName('existing-student-test-v1')).fetch(request);
 if(url.pathname==='/scripts/r2l-mic-check.js'){
  const b64=btoa(String.fromCharCode(...audio));
  return new Response(`window.R2LMicCheck={sessionPassed:()=>true,mount(root,options){root.hidden=true;options.onPass();}};window.R2LRecorder={getStream:async()=>({getTracks:()=>[{readyState:'live',enabled:true,stop(){}}]}),createRecorder:()=>({engine:'wav',start(){},stop:async()=>new Blob([Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0))],{type:'audio/wav'})})};`,{headers:{'Content-Type':'text/javascript'}});
 }
 // Same routing as production (functions/_middleware.js): the gateway sees EVERY request and decides itself
 // (it returns null for paths it does not own, and serves /_astro and /story-retell assets to a reader cookie);
 // null falls through to Pages (repo dist).
 const response=(await unifiedAccountGateway({request,env:{...env},data:{},waitUntil:p=>ctx.waitUntil(p)}))||await env.PAGES_ASSETS.fetch(request);
 const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Robots-Tag','noindex');headers.set('X-Synthetic-Rehearsal','release');
 if(response.headers.get('content-type')?.includes('text/html')&&response.status===200){headers.delete('content-length');return new Response((await response.text()).replace('</body>',notice+'</body>'),{status:response.status,headers});}
 return new Response(response.body,{status:response.status,headers});
}};
