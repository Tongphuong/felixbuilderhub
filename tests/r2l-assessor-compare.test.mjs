import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {lessonFromFile} from '../scripts/r2l-voice-warmup.mjs';
import {DEFAULT_PACKAGE,DEFAULT_CASES,MODEL_A,MODEL_B,buildCases,taskFor,formatDryRun,disagreements,runComparison,formatMarkdown,createCompareBinding} from '../scripts/r2l-assessor-compare.mjs';
import {createStoryEvidenceAssessor,storyAssessorMessages,STORY_ASSESSOR_MODEL} from '../functions/lib/read2lead/story-assessor.mjs';
import {storyRubric} from '../functions/lib/read2lead/story-rubric.mjs';
import {pictureRetellFor} from '../functions/lib/read2lead/picture-retell.mjs';

const fixture=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/read2lead-self-learn/publisher-package.json',import.meta.url)));
function lesson(){ // a 12-question interview lesson built the way the other story tests do
  const p=fixture(),l=p.lesson,q=l.questions[0];
  l.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
  l.questions=Array.from({length:12},(_,i)=>({...structuredClone(q),id:'interview-q'+(i+1),source:'story',dimension:'meaning'}));
  return l;
}
const reply=content=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}});
const judge=(tr,over={})=>reply({intent:'answer',unclearSpan:'',replySupport:'none',criteria:[{id:'meaning',met:true,quote:tr}],...over});
const casesDoc=(cases)=>({format:'r2l-assessor-cases-v1',cases});
const cs=[{id:'a',task:'q1',type:'correct',transcript:'The uncle.'},{id:'b',task:'q2',type:'wrong',transcript:'A letter.'}];

test('assessor model is a parameter: default 120b unchanged, 20b allowed, anything else refused',async()=>{
  const seen=[];const ai={run:async(m,input)=>{seen.push([m,input]);return judge('The uncle.');}};
  const task=storyRubric(lesson()).tasks[0],input={task,transcript:'The uncle.'};
  await createStoryEvidenceAssessor({ai})(input);
  await createStoryEvidenceAssessor({ai,model:MODEL_B})(input);
  assert.equal(seen[0][0],STORY_ASSESSOR_MODEL);assert.equal(seen[0][0],MODEL_A);assert.equal(seen[1][0],MODEL_B);
  assert.deepEqual(seen[0][1],seen[1][1],'identical messages and params for both models');
  for(const bad of ['@cf/openai/gpt-oss-1b','@cf/qwen/qwen3-30b-a3b-fp8','gpt-oss-20b',''])
    assert.throws(()=>createStoryEvidenceAssessor({ai,model:bad}),/story_assessor_model_not_supported/);
});

test('dry run is the default: lists cases + call count, no network, no credentials needed',()=>{
  const l=lesson(),built=buildCases(l,casesDoc(cs));
  const text=formatDryRun(built);
  assert.match(text,/Cases: 2   model calls: 4/);assert.match(text,/dry run/);
  const out=execFileSync('node',['scripts/r2l-assessor-compare.mjs'],{env:{PATH:process.env.PATH,HOME:process.env.HOME},encoding:'utf8',cwd:new URL('..',import.meta.url).pathname});
  assert.match(out,/dry run \(no network, no cost\)/);assert.match(out,/Cases: 65   model calls: 130/);
});

test('--execute needs both env vars and the cap is enforced',async()=>{
  const run=(args,env)=>{try{execFileSync('node',['scripts/r2l-assessor-compare.mjs',...args],{env:{PATH:process.env.PATH,HOME:process.env.HOME,...env},encoding:'utf8',stdio:'pipe',cwd:new URL('..',import.meta.url).pathname});return null;}catch(e){return e.stderr;}};
  assert.match(run(['--execute'],{}),/requires env CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN/);
  assert.match(run(['--execute'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}),/requires env/);
  assert.match(run(['--execute','--max-calls','10'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'t'.repeat(30)}),/max_calls_exceeded/);
  await assert.rejects(runComparison({cases:buildCases(lesson(),casesDoc(cs)),ai:{run(){throw Error('must not run');}},maxCalls:3}),/max_calls_exceeded/);
  assert.throws(()=>createCompareBinding({accountId:'x',token:'y'}),/compare_credentials_required/);
});

test('cases are built by the real rubric: same task the live path gives the assessor',()=>{
  const l=lesson(),built=buildCases(l,casesDoc(cs));
  assert.deepEqual(built[0].taskDef.criteria,storyRubric(l).tasks[0].criteria);
  assert.equal(built[1].taskDef.prompt,l.questions[1].prompt_en);
  assert.throws(()=>taskFor(l,'retell'),/voice_stage_conflict/,'a lesson without a picture retell is refused, not guessed');
  assert.doesNotThrow(()=>storyAssessorMessages({task:built[0].taskDef,transcript:'The uncle.'}));
  for(const bad of [casesDoc([]),{format:'x',cases:cs},casesDoc([{...cs[0],task:'q13'}]),casesDoc([{...cs[0],transcript:' '}]),casesDoc([cs[0],cs[0]])])
    assert.throws(()=>buildCases(l,bad));
  assert.throws(()=>taskFor(l,'q0'),/unknown_case_task/);
});

test('shipped Sky cases: 13 tasks x 5 answer types, every task resolves against the released Sky record',{skip:!fs.existsSync(DEFAULT_PACKAGE)&&'released Sky package not on this machine'},()=>{
  const sky=lessonFromFile(DEFAULT_PACKAGE),doc=JSON.parse(fs.readFileSync(DEFAULT_CASES,'utf8')),built=buildCases(sky,doc);
  assert.equal(built.length,65);
  const per=new Map();for(const c of built)per.set(c.task,(per.get(c.task)||new Set()).add(c.type));
  assert.equal(per.size,13);for(const [,types] of per)assert.deepEqual([...types].sort(),['correct','help','paraphrase','partial','wrong']);
  assert.equal(built.find(c=>c.task==='retell').taskDef.id,pictureRetellFor(sky).id);
  assert.equal(built.find(c=>c.task==='retell').taskDef.kind,'picture_retell');
  assert.ok(built.length*2<=140,'the default cap covers the whole run');
});

test('disagreement detection: intent, reliability, a criterion, validity; full agreement reports none',async()=>{
  const ok={valid:true,intent:'answer',reliability:'confirmed',criteria:{meaning:true}};
  assert.deepEqual(disagreements(ok,{...ok}),[]);
  assert.match(disagreements(ok,{...ok,intent:'help'})[0],/intent/);
  assert.match(disagreements(ok,{...ok,reliability:'uncertain'})[0],/reliability/);
  assert.match(disagreements(ok,{...ok,criteria:{meaning:false}})[0],/criterion meaning/);
  assert.match(disagreements(ok,{valid:false,error:'invalid_story_judgment'})[0],/validity/);
  const built=buildCases(lesson(),casesDoc(cs));
  const fakeAi=(grade20)=>({async run(model,{messages}){
    const t=JSON.parse(messages[1].content).transcript;
    return model===MODEL_A?judge(t):grade20(t);}});
  const agree=await runComparison({cases:built,ai:fakeAi(t=>judge(t))});
  assert.equal(agree.allAgree,true);assert.equal(agree.disagreementCount,0);assert.equal(agree.calls,4);
  assert.equal(agree.tokens[MODEL_B].total,220);
  const split=await runComparison({cases:built,ai:fakeAi(t=>t==='A letter.'?judge(t,{criteria:[{id:'meaning',met:false,quote:''}]}):judge(t))});
  assert.equal(split.allAgree,false);assert.equal(split.disagreementCount,1);
  assert.deepEqual(split.cases.find(c=>c.id==='b').disagreements,['criterion meaning: met true vs false']);
  assert.match(formatMarkdown(split),/1 case\(s\) disagree: keep 120b/);assert.match(formatMarkdown(agree),/ZERO disagreements/);
  // a model whose output fails the real validator (fabricated quote) is a disagreement via validity, not a crash
  const fab=await runComparison({cases:built,ai:fakeAi(()=>judge('x',{criteria:[{id:'meaning',met:true,quote:'never said'}]}))});
  assert.equal(fab.allAgree,false);assert.equal(fab.invalid[MODEL_B],2);assert.match(fab.cases[0].disagreements[0],/validity/);
});

test('three provider errors in a row stop the run early (cost guard) and the report says INCOMPLETE',async()=>{
  let n=0;const ai={async run(){n++;throw Error('compare_provider_http_500');}};
  const many=buildCases(lesson(),casesDoc(Array.from({length:10},(_,i)=>({id:'c'+i,task:'q1',type:'correct',transcript:'The uncle.'}))));
  const r=await runComparison({cases:many,ai});
  assert.equal(n,3);assert.match(r.aborted,/3 consecutive provider errors/);assert.equal(r.allAgree,false);assert.match(formatMarkdown(r),/INCOMPLETE/);
});

test('the compare binding refuses non-grader models and never echoes credentials',async()=>{
  const token='SECRET-TOKEN-'.padEnd(30,'x');
  const b=createCompareBinding({accountId:'a'.repeat(32),token,fetchFn:async()=>{throw Error('boom '+token);}});
  await assert.rejects(b.run('@cf/qwen/qwen3-30b-a3b-fp8',{}),/compare_model_refused/);
  await assert.rejects(b.run(MODEL_A,{}),e=>e.message==='compare_provider_unavailable'&&!e.message.includes(token));
  let url,headers;const ok=createCompareBinding({accountId:'a'.repeat(32),token,fetchFn:async(u,o)=>{url=u;headers=o.headers;return {ok:true,json:async()=>({success:true,result:{x:1}})};}});
  assert.deepEqual(await ok.run(MODEL_B,{messages:[]}),{x:1});assert.match(url,/ai\/run\/@cf\/openai\/gpt-oss-20b$/);assert.equal(headers.Authorization,'Bearer '+token);
});
