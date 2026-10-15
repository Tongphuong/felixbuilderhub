import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/read2lead-shop.js';
import { normalizeProgressState, progressKey, MONSTER_MANIFEST } from '../functions/api/_read2lead-v2-state.js';

const code='R2L-FREE-COMPANION';
function fixture() {
  const codes=new Map([[code,JSON.stringify({student_profile:{student_name:'An',level:'L0'},progress:{current_pack:{pack_id:'preserve-answers'},review_history:[{pack_id:'old'}]}})]]);
  const state=normalizeProgressState({schema_version:2,level_reset_version:20260606,student_name:'An',current_level:'L0',initial_level:'L0',diamonds:270,completed_packs:2,completed_pack_ids:['saved-a'],unlocked_parts:['png-default-detail-blue-horn-small'],gift_goal:{item_id:'gift-a'},redemptions:[],total_xp:40},{accessCode:code});
  const progress=new Map([[progressKey(code),JSON.stringify(state)]]);
  const kv=map=>({async get(key,opts){const value=map.get(key);return value?(opts?.type==='json'?JSON.parse(value):value):null;},async put(key,value){map.set(key,value);}});
  const env={READ2LEAD_CODES:kv(codes),READ2LEAD_PROGRESS:kv(progress)};
  const request=body=>onRequestPost({env,request:new Request('https://test.example/api/read2lead-shop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_code:code,...body})})});
  return {codes,progress,request,state};
}
test('free endpoint save, reload and repeat preserve wallet, progress, gift and purchase records',async()=>{
  const f=fixture(), originalCodes=structuredClone(f.codes), before=structuredClone(f.state);
  const monster=Object.fromEntries(Object.entries(MONSTER_MANIFEST).map(([slot,parts])=>[slot,parts.at(-1).id]));
  for(let i=0;i<2;i++) {
    const response=await f.request({action:'avatar',monster});assert.equal(response.status,200);
    const data=await response.json();for(const [slot,id] of Object.entries(monster))assert.equal(data.read2lead_state.avatar.monster[slot],id);
    const reload=await (await f.request({action:'list'})).json();assert.deepEqual(reload.read2lead_state.avatar.monster,data.read2lead_state.avatar.monster);
    const saved=JSON.parse(f.progress.get(progressKey(code)));
    // Existing loader recalculates this derived timestamp on every read.
    delete saved.learning_metrics?.['7day_summary']?.calculated_at;
    delete before.learning_metrics?.['7day_summary']?.calculated_at;
    for(const key of Object.keys(before))if(!['avatar','avatar_stage','updated_at'].includes(key))assert.deepEqual(saved[key],before[key],key);
    assert.deepEqual(f.codes,originalCodes);
  }
});
test('invalid account and invalid monster cannot save',async()=>{
  const f=fixture(), before=structuredClone(f.progress);
  for(const body of [{access_code:'MISSING',action:'avatar',monster:{}},{action:'avatar',monster:{body:'unknown'}},{action:'avatar',monster:{eyes:MONSTER_MANIFEST.body[0].id}},{action:'avatar',monster:[]}]) {
    const response=await f.request(body);assert.ok(response.status>=400);assert.deepEqual(f.progress,before);
  }
});
