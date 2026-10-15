import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {storyRubric} from '../functions/lib/read2lead/story-rubric.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMinnyReply, CONVO_MODEL, CONVO_FALLBACK_MODEL } from '../functions/api/_minny-provider.js';
import { createMinnyStoryProvider,storyVoicePrompt,validateStoryVoiceReply } from '../functions/lib/read2lead/story-voice.mjs';

const messages = [{ role: 'user', content: 'Synthetic provider contract only' }];
test('strict Cloudflare accepts current completed choices with parsed response objects',async()=>{
 const reply={reply:"That's right.",sentenceIds:['s1']};let calls=0;
 const result=await requestMinnyReply({AI:{async run(){calls++;return {response:reply,choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply),tool_calls:null,refusal:null}}]};}}},messages,{strict:true});
 assert.equal(result.rawReply,JSON.stringify(reply));assert.equal(calls,1);assert.equal(result.llmSource,'llama_fallback');
});
test('strict Cloudflare refuses bad completion metadata even when response looks valid',async()=>{
 for(const choice of [
  {finish_reason:'length',message:{content:'{}'}},
  {finish_reason:'stop',message:{content:'{}',tool_calls:[{}]}},
  {finish_reason:'stop',message:{content:'{}',refusal:'refused'}},
  {finish_reason:'stop',message:{content:{reply:'not a string'}}},
 ]){
  let calls=0;const result=await requestMinnyReply({AI:{async run(){calls++;return {response:'{}',choices:[choice]};}}},messages,{strict:true});
  assert.equal(result.rawReply,null);assert.equal(calls,2);
 }
});
test('SpeakUp defaults preserve route, model, tokens, temperature and result metadata', async () => {
  const calls = [];
  const result = await requestMinnyReply({ OPENROUTER_API_KEY: 'test-only' }, messages, { fetchFn: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ choices: [{ message: { content: '{"reply_en":"Hello"}' } }] });
  } });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].body.model, CONVO_MODEL); assert.equal(calls[0].body.max_tokens, 150);
  assert.equal(calls[0].body.temperature, 0.8); assert.deepEqual(calls[0].body.provider, { sort: 'throughput', require_parameters: true });
  assert.equal(result.llmSource, 'openrouter'); assert.equal(result.llmAttempts, 1);
});
test('exact two primary attempts then JSON/plain Cloudflare fallbacks; never another model', async () => {
  const calls = [], env = { OPENROUTER_API_KEY: 'test-only', AI: { async run(model, input) {
    calls.push({ model, input }); if (input.response_format) throw Error('unsupported'); return { response: '{"reply_en":"Hello"}' };
  } } };
  const result = await requestMinnyReply(env, messages, { fetchFn: async () => new Response('', { status: 503 }) });
  assert.equal(result.llmAttempts, 4); assert.equal(result.llmSource, 'llama_fallback');
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.model === CONVO_FALLBACK_MODEL));
});
test('strict story requests reject excessive inputs, truncated output and tool calls', async () => {
  let calls = 0; const fetchFn = async () => { calls++; return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }); };
  await assert.rejects(requestMinnyReply({}, messages, { maxTokens: 1537 }), /token_limit/);
  await assert.rejects(requestMinnyReply({}, messages, { cloudflareTimeoutMs: 10001 }), /timeout_limit/);
  await assert.rejects(requestMinnyReply({}, [{ content: 'a'.repeat(25000) }], { strict: true }), /prompt_limit/);
  const result = await requestMinnyReply({ OPENROUTER_API_KEY: 'test-only' }, messages, { fetchFn, strict: true });
  assert.equal(result.rawReply, null); assert.equal(calls, 2);
  const toolResult = await requestMinnyReply({ OPENROUTER_API_KEY: 'test-only' }, messages, { strict: true,
    fetchFn: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } }] }) });
  assert.equal(toolResult.rawReply, null);
});
test('aborted or budget-refused requests cannot reach a provider', async () => {
  const signal = AbortSignal.abort(); let calls = 0;
  const fetchFn = async () => { calls++; throw Error('unexpected'); };
  await assert.rejects(requestMinnyReply({ OPENROUTER_API_KEY: 'test-only' }, messages, { signal, fetchFn }), /interrupted/);
  await assert.rejects(requestMinnyReply({ OPENROUTER_API_KEY: 'test-only' }, messages, { fetchFn, onAttempt: () => { throw Error('budget_refused'); } }), /budget_refused/);
  assert.equal(calls, 0);
});
test('story response uses existing Minny route, with no automatic activation or Qwen call', async () => {
  const calls = [];
  const provider = createMinnyStoryProvider({ env: { AI: { run() { throw Error('unexpected fallback'); } }, OPENROUTER_API_KEY: 'test-only' },
    fetchFn: async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"reply":"You found the cup.","sentenceIds":["s7"]}' } }] }); } });
  const reply = await provider.respond(messages); assert.equal(reply.sentenceIds[0], 's7');
  assert.equal(calls.length, 1); assert.equal(calls[0].model, CONVO_MODEL); assert.equal(calls[0].max_tokens, 512);
  assert.equal(calls[0].temperature, 0); assert.equal(provider.activation, undefined);
});

test('cancellation during the first attempt prevents retries and fallback',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(requestMinnyReply({OPENROUTER_API_KEY:'test-only',AI:{run(){assert.fail('no fallback after cancellation');}}},messages,{
    signal:controller.signal,fetchFn:async()=>{calls++;controller.abort();throw Error('cancelled');},
  }),/interrupted/);
  assert.equal(calls,1);
});

test('transfer task origin reaches reply and safety prompts without requiring false original-story citations',async()=>{
 const lesson=structuredClone(pkg.lesson);lesson.questions[0].source='new_scenario';lesson.questions[0].prompt_en='New situation: Mia sees a blue sky after many grey days. Why might she smile?';
 const task=storyRubric(lesson).tasks[0],reply={reply:'Mia sees a different sky today. How might she feel?',sentenceIds:[]};
 assert.equal(task.source,'new_scenario');
 const prompt=storyVoicePrompt(lesson,task,'She likes the blue sky.');assert.equal(JSON.parse(prompt[1].content).taskSource,'new_scenario');
 assert.equal(validateStoryVoiceReply(reply,lesson,task),reply);
 assert.throws(()=>validateStoryVoiceReply(reply,lesson,{...task,source:'story'}),/invalid_story_reply/);
 assert.throws(()=>validateStoryVoiceReply({...reply,sentenceIds:['made-up']},lesson,task),/invalid_story_reply/);
 let payload;const provider=createMinnyStoryProvider({env:{AI:{run(){assert.fail('no fallback');}},OPENROUTER_API_KEY:'test-only'},fetchFn:async(url,init)=>{payload=JSON.parse(init.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({safe:true,grounded:true,staysOnTask:true,replySupport:"hint"})}}]});}});
 assert.deepEqual(await provider.validateSafety({lesson,task,transcript:'She likes it.',reply:reply.reply}),{valid:true,replySupport:'hint'});
 const context=JSON.parse(payload.messages[1].content);assert.equal(context.task.source,'new_scenario');assert.equal(context.task.prompt,task.prompt);
 assert.match(payload.messages[0].content,/only facts explicitly provided in task.prompt/);
});
