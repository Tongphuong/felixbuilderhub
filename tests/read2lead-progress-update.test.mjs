import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/read2lead-progress-update.js';
function namespace(seed={}) {
 const data=new Map(Object.entries(seed).map(([key,value])=>[key,JSON.stringify(value)])),calls=[];
 return {data,calls,async get(key,options){calls.push(['get',key]);const raw=data.get(key)||null;return options?.type==='json'||options==='json'?raw&&JSON.parse(raw):raw;},async put(key,value){calls.push(['put',key]);data.set(key,value);}};
}
for(const separate of [false,true])test('retired client reward route cannot credit arbitrary packs through '+(separate?'separate progress storage':'code storage'),async()=>{
 const code='SYNTHETIC-REWARD-QA',profile={schema_version:2,level_reset_version:20260606,current_level:'L1',initial_level:'L1',xp_in_level:0,total_xp:100,diamonds:700,completed_packs:0,completed_pack_ids:[]};
 const codes=namespace({[code]:{student_profile:{level:'L1'},progress:{review_history:[],current_pack:{pack_id:'assigned-real-pack'}}},...(!separate?{['progress:'+code]:profile}:{})}),progress=separate?namespace({['progress:'+code]:profile}):codes;
 const beforeCodes=[...codes.data],beforeProgress=[...progress.data],statuses=[];
 for(const pack of ['invented-pack','invented-pack','another-invented-pack']){
  const response=await onRequestPost({env:{READ2LEAD_CODES:codes,...(separate?{READ2LEAD_PROGRESS:progress}:{})},request:new Request('https://test.example/api/read2lead-progress-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,pack_id:pack,rewards_earned:{diamonds:1000000,xp:100000},activity_results:[{score_percent:100}],completed_at:'2026-09-28T00:00:00Z'})})});
  statuses.push(response.status);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
 assert.deepEqual([...codes.data],beforeCodes,'forged completion must not change account or code-stored wallet');
 assert.deepEqual([...progress.data],beforeProgress,'forged completion must not change separate wallet');
 assert.deepEqual(statuses,[410,410,410]);assert.deepEqual(codes.calls,[]);assert.deepEqual(progress.calls,[]);
});
test('retired route never reads a body, account, or provider even with broken configuration',async()=>{
 let touched=0;const forbidden=new Proxy({}, {get(){touched++;throw Error('retired route accessed application data');}});
 const response=await onRequestPost({request:forbidden,env:forbidden});assert.equal(response.status,410);assert.deepEqual(await response.json(),{ok:false,error:'client_reward_updates_removed'});assert.equal(touched,0);
});
test('malformed or empty client requests cannot invoke an alternative reward path',async()=>{
 for(const body of ['', '{', JSON.stringify({rewards_earned:{diamonds:-1},pack_id:'fake'})]){
  const response=await onRequestPost({env:{},request:new Request('https://test.example/api/read2lead-progress-update',{method:'POST',body})});
  assert.equal(response.status,410);assert.deepEqual(await response.json(),{ok:false,error:'client_reward_updates_removed'});
 }
});
