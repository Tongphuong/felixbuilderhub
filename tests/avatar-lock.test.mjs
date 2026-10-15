// The revision-2 free companion policy supersedes the paid part locks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASIC_MONSTER_CONFIG, MONSTER_MANIFEST, normalizeProgressState, saveAvatarMonster } from '../functions/api/_read2lead-v2-state.js';
for (const stage of ['egg','basic','custom']) test(`old ${stage} accounts can select every valid slot without purchase`, () => {
  const state=normalizeProgressState({schema_version:2,level_reset_version:20260606,current_level:'L0',avatar_stage:stage,diamonds:0,unlocked_parts:[]},{accessCode:'FREE-L0'});
  for (const [slot,parts] of Object.entries(MONSTER_MANIFEST)) for (const part of parts) {
    const result=saveAvatarMonster(state,{[slot]:part.id},'FREE-L0');
    assert.equal(result.ok,true,part.id); assert.equal(result.state.avatar.monster[slot],part.id);
    assert.equal(result.state.diamonds,0);assert.deepEqual(result.state.unlocked_parts,[]);
  }
});
test('invalid slots, wrong-slot parts, unknown parts, arrays and invalid colors are rejected',()=>{
 const state=normalizeProgressState(null,{accessCode:'FREE-L0'});
 for(const monster of [{body:'not-real'},{eyes:BASIC_MONSTER_CONFIG.body},{admin:true},{body:null},{color:'invalid'},[]]) {
   const before=structuredClone(state); assert.equal(saveAvatarMonster(state,monster,'FREE-L0').ok,false);assert.deepEqual(state,before);
 }
});
test('optional parts may be cleared without reverting the selected body',()=>{
 const state=normalizeProgressState(null,{accessCode:'FREE-L0'});
 const chosen=saveAvatarMonster(state,{body:'png-default-body-bluee',detail:'png-default-detail-blue-horn-large'},'FREE-L0').state;
 const cleared=saveAvatarMonster(chosen,{detail:''},'FREE-L0').state;
 assert.equal(cleared.avatar.monster.body,'png-default-body-bluee');assert.equal(cleared.avatar.monster.detail,'');
});
