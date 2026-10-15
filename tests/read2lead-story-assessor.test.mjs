import test from 'node:test';import assert from 'node:assert/strict';
import {createStoryEvidenceAssessor,STORY_ASSESSOR_MODEL} from '../functions/lib/read2lead/story-assessor.mjs';
import {createMinnyStoryProvider,runStoryVoiceTurn,STORY_VOICE_CLARIFICATION} from '../functions/lib/read2lead/story-voice.mjs';
const task={id:'retell',prompt:'Tell what happened.',source:'story',criteria:[{id:'fact-1',meaning:'An uncle sends a picture.'},{id:'fact-2',meaning:'The sky is grey because of cars.'}]};
const transcript='The uncle sends a picture. The sky is pray because of cars.';
const raw=()=>({intent:'answer',unclearSpan:'pray',criteria:[{id:'fact-1',met:true,quote:'The uncle sends a picture.'},{id:'fact-2',met:false,quote:''}],replySupport:'none'});
const envelope=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
test('a copied unclear span overrides otherwise creditable partial facts in the real voice pipeline',async()=>{
 let calls=0,spoken;const provider=createMinnyStoryProvider({env:{AI:{run:async(model,input)=>{
  calls++;assert.equal(model,STORY_ASSESSOR_MODEL);assert.equal(input.max_tokens,3072);assert.equal(input.temperature,0);assert.equal(input.reasoning_effort,'low');
  const context=JSON.parse(input.messages[1].content);assert.deepEqual(Object.keys(context).sort(),['task','transcript']);assert.equal('story' in context,false);
  return envelope(raw());
 }}},assessor:'gpt-oss-120b'});
 provider.transcribe=async()=>transcript;delete provider.validateAudio;
 provider.respond=async()=>{throw Error('Unclear input must not generate graded feedback');};
 provider.validateSafety=async()=>{throw Error('Fixed clarification needs no generated safety call');};
 provider.synthesize=async text=>{spoken=text;return {audio_b64:'YXVkaW8=',content_type:'audio/mpeg'};};
 const result=await runStoryVoiceTurn({activation:{externalProcessingApproved:true,spendingApproved:true,providerVerified:true,assessorValidated:true},provider,
  budget:{claim(){},finish(_s,_r,state){assert.equal(state,'succeeded');}},sessionId:'adult',requestId:'unclear',task,
  lesson:{story:{sentences:[{id:'s1',text_en:'An uncle sends a picture.'}]}},audio:new Blob(['fixture'],{type:'audio/webm'})});
 assert.equal(calls,1);assert.equal(spoken,STORY_VOICE_CLARIFICATION);assert.deepEqual(result.judgment,{reliability:'uncertain',matchedCriteria:[],replySupport:'none'});assert.equal(result.assessment,'unassessed');assert.equal(result.rewardsAwarded,false);
});
test('clear wrong and correct responses preserve independent evidence',async()=>{
 for(const correct of [false,true]){
  const value={intent:'answer',unclearSpan:'',criteria:task.criteria.map(c=>({id:c.id,met:correct,quote:correct?'The uncle sends a picture. The sky is grey because of cars.':''})),replySupport:'none'};
  const assess=createStoryEvidenceAssessor({ai:{run:async()=>envelope(value)}});
  const result=await assess({task,transcript:'The uncle sends a picture. The sky is grey because of cars.'});assert.equal(result.reliability,'confirmed');assert.equal(result.criteria.every(c=>c.met===correct),true);
 }
});
test('picture retelling safely discards literal non-scoring quotes without awarding credit',async()=>{
 const text='The uncle sends a picture. The sky is grey.';
 const value={intent:'answer',unclearSpan:'',criteria:[{id:'fact-1',met:true,quote:'The uncle sends a picture.'},{id:'fact-2',met:false,quote:'The sky is grey.'}],replySupport:'none'};
 const assess=createStoryEvidenceAssessor({ai:{run:async()=>envelope(value)}});
 const result=await assess({task:{...task,kind:'picture_retell'},transcript:text});
 assert.deepEqual(result.criteria,[value.criteria[0],{id:'fact-2',met:false,quote:''}]);
 assert.equal(result.reliability,'confirmed');
 await assert.rejects(assess({task,transcript:text}),/unexpected_semantic_evidence/,'interviews retain their existing contract');
});
test('non-scoring quote normalization cannot conceal invalid or fabricated evidence',async()=>{
 for(const change of [c=>c.quote='invented words',c=>c.quote='x'.repeat(501),c=>c.id='unknown',c=>c.score=1]){
  const value={intent:'answer',unclearSpan:'',criteria:[{id:'fact-1',met:false,quote:'real words'},{id:'fact-2',met:false,quote:''}],replySupport:'none'};change(value.criteria[0]);
  const assess=createStoryEvidenceAssessor({ai:{run:async()=>envelope(value)}});
  await assert.rejects(assess({task:{...task,kind:'picture_retell'},transcript:'real words '+ 'x'.repeat(501)}));
 }
});
test('raw evidence and unclear spans cannot bypass strict validation',async t=>{
 const cases=[
  ['invented span',v=>{v.unclearSpan='not in transcript';}],['blank span',v=>{v.unclearSpan=' ';}],
  ['extra field',v=>{v.score=100;}],['missing criterion',v=>{v.criteria.pop();}],
  ['duplicate criterion',v=>{v.criteria[1].id='fact-1';}],['invented quote',v=>{v.criteria[0].quote='Invented words';}],
  ['extra criterion field',v=>{v.criteria[0].score=1;}],['help in assessor',v=>{v.replySupport='hint';}],
 ];
 for(const [name,alter] of cases)await t.test(name,async()=>{const value=raw();alter(value);let calls=0;
  const assess=createStoryEvidenceAssessor({ai:{run:async()=>{calls++;return envelope(value);}}});await assert.rejects(assess({task,transcript}));assert.equal(calls,1);
 });
});
test('truncated, tool-calling, refused, malformed and missing outputs fail without retry',async t=>{
 for(const kind of ['length','tool','refusal','json','missing'])await t.test(kind,async()=>{let calls=0;const output=envelope(raw());
  if(kind==='length')output.choices[0].finish_reason='length';if(kind==='tool')output.choices[0].message.tool_calls=[{}];
  if(kind==='refusal')output.choices[0].message.refusal='Refused';if(kind==='json')output.choices[0].message.content='not-json';if(kind==='missing')delete output.choices;
  const assess=createStoryEvidenceAssessor({ai:{run:async()=>{calls++;return output;}}});await assert.rejects(assess({task,transcript}));assert.equal(calls,1);
 });
});
test('input limits and prior cancellation prevent calls; late cancellation rejects result',async()=>{
 let calls=0;const abort=new AbortController();const assess=createStoryEvidenceAssessor({ai:{run:async()=>{calls++;abort.abort();return envelope(raw());}}});
 await assert.rejects(assess({task,transcript:'x'.repeat(2001)}),/invalid_story_context/);
 await assert.rejects(assess({task:{...task,criteria:[{id:'x',meaning:'x'.repeat(14000)}]},transcript}),/prompt_too_large/);
 await assert.rejects(assess({task,transcript,signal:AbortSignal.abort()}),/interrupted/);assert.equal(calls,0);
 await assert.rejects(assess({task,transcript,signal:abort.signal}),/interrupted/);assert.equal(calls,1);
});
test('provider errors do not silently switch graders and unknown selections are refused',async()=>{
 let calls=0;const provider=createMinnyStoryProvider({env:{AI:{run:async()=>{calls++;throw Error('unavailable');}}},assessor:'gpt-oss-120b'});
 await assert.rejects(provider.assess({task,transcript}),/unavailable/);assert.equal(calls,1);
 assert.throws(()=>createMinnyStoryProvider({env:{AI:{}},assessor:'unknown'}),/not_supported/);
});

test('discussion intent discards credit even when the provider quotes words from a question',async()=>{
 for(const intent of ['story_question','help']) {
  const value={intent,unclearSpan:'',criteria:task.criteria.map(c=>({id:c.id,met:true,quote:'picture'})),replySupport:'none'};
  const assess=createStoryEvidenceAssessor({ai:{run:async(_model,input)=>{
   assert.match(input.messages[0].content,/attempted answer phrased as a question/);
   assert.match(input.messages[0].content,/Dialogue quoted or paraphrased within a retelling/);
   return envelope(value);
  }}});
  const result=await assess({task,transcript:'Who sends the picture?'});
  assert.equal(result.intent,intent);assert.equal(result.reliability,'confirmed');
  assert.ok(result.criteria.every(c=>!c.met&&c.quote===''));
 }
 for(const intent of [undefined,'grant_credit']) {
  const value=raw();if(intent===undefined)delete value.intent;else value.intent=intent;
  await assert.rejects(createStoryEvidenceAssessor({ai:{run:async()=>envelope(value)}})({task,transcript}),/invalid_semantic_judgment/);
 }
});
