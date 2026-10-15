import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgressRefresh} from '../src/lib/read2lead-progress-refresh.mjs';
const saved=(diamonds,xp)=>({ok:true,read2lead_state:{diamonds,xp_in_level:xp}});
test('header applies the exact server account after reward, never computes its own award',async()=>{
  const data=saved(1700,20),painted=[];
  const refresh=createProgressRefresh({load:async()=>data,apply:state=>painted.push(state)});
  assert.equal(await refresh(),true);assert.equal(painted[0],data.read2lead_state);
  assert.equal(await refresh(),true);assert.deepEqual(painted,[data.read2lead_state,data.read2lead_state]);
});
test('slow pre-reward reply cannot overwrite the newer saved balance',async()=>{
  const pending=[],painted=[];const refresh=createProgressRefresh({load:()=>new Promise(resolve=>pending.push(resolve)),apply:s=>painted.push(s)});
  const before=refresh(),after=refresh();pending[1](saved(1700,20));assert.equal(await after,true);
  pending[0](saved(700,0));assert.equal(await before,false);assert.deepEqual(painted,[saved(1700,20).read2lead_state]);
});
test('unavailable account keeps the current display; a later successful refresh recovers',async()=>{
  const replies=[saved(700,0),{ok:false},{ok:true},null,Error('offline'),saved(1700,20)],painted=[];
  const refresh=createProgressRefresh({load:async()=>{const x=replies.shift();if(x instanceof Error)throw x;return x;},apply:s=>painted.push(s)});
  assert.equal(await refresh(),true);for(let i=0;i<4;i++)assert.equal(await refresh(),false);
  assert.deepEqual(painted,[saved(700,0).read2lead_state]);assert.equal(await refresh(),true);
  assert.deepEqual(painted,[saved(700,0).read2lead_state,saved(1700,20).read2lead_state]);
});
