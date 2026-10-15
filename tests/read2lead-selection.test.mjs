import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {selectAssignedStory,STORY_SELECTION_BATCH} from '../functions/lib/read2lead/story-catalogue.mjs';
function setup(){
 const p=structuredClone(fixture),rows=new Map(),reads=[];
 const ref={id:p.lesson.id,version:p.lesson.version};rows.set('index:L1',[ref]);rows.set(`package:${ref.id}@${ref.version}`,{status:'private-draft',package:p});
 const account={is_test:true,progress:{review_history:[]}};
 const env={R2L_PRIVATE_QA:'adult-isolated',R2L_STORY_CATALOGUE:{async get(key){reads.push(key);return structuredClone(rows.get(key));}}};
 return{p,rows,reads,account,env,ref};
}
test('bounded continuation reaches later valid content and rejects stale cursors after catalogue change',async()=>{
 const s=setup();s.rows.set('index:L1',[...Array.from({length:STORY_SELECTION_BATCH+4},(_,i)=>({id:'missing-'+i,version:'1'})),s.ref]);
 const before=structuredClone(s.account);let pending;
 await assert.rejects(selectAssignedStory(s.env,s.account,'L1'),e=>(pending=e,e.code==='story_selection_pending'));
 assert.equal(s.reads.filter(k=>k.startsWith('package:')).length,STORY_SELECTION_BATCH);assert.deepEqual(s.account,before);
 s.account.story_selection=pending.cursor;s.reads.length=0;
 assert.equal((await selectAssignedStory(s.env,s.account,'L1')).pkg.lesson.id,s.ref.id);assert.equal(s.reads.length,6);
 s.rows.set('index:L1',[s.ref]);assert.equal((await selectAssignedStory(s.env,s.account,'L1')).pkg.lesson.id,s.ref.id);
});
test('predecessor source completion is required; opening or unrelated completion is insufficient',async()=>{
 const s=setup();s.p.lesson.source.predecessor_source_id='part-one';
 for(const row of [null,{story_source_id:'part-one',story_complete:false},{story_source_id:'other',story_complete:true}]){
   s.account.progress.review_history=row?[row]:[];await assert.rejects(selectAssignedStory(s.env,s.account,'L1'),/exhausted/);
 }
 s.account.progress.review_history=[{story_source_id:'part-one',story_complete:true}];
 assert.equal((await selectAssignedStory(s.env,s.account,'L1')).pkg.lesson.id,s.ref.id);
});
test('completed source versions are offered only as review candidates and unaccepted drafts remain hidden',async()=>{
 const s=setup();s.account.progress.review_history=[{story_source_id:s.p.lesson.source.source_id,story_id:'older-version-id',story_complete:true}];
 await assert.rejects(selectAssignedStory(s.env,s.account,'L1'),e=>e.code==='story_catalogue_exhausted'&&e.reviewReference.id===s.ref.id);
 s.account.is_test=false;await assert.rejects(selectAssignedStory(s.env,s.account,'L1'),e=>e.code==='story_catalogue_exhausted'&&!e.reviewReference);
});

test('archived completed sources remain completed after short history rolls over',async()=>{
 const s=setup();s.account.story_pack_history={old:{story_complete:true,story_reference:{id:'old-id',source_id:s.p.lesson.source.source_id}}};
 await assert.rejects(selectAssignedStory(s.env,s.account,'L1'),e=>e.code==='story_catalogue_exhausted'&&e.reviewReference.id===s.ref.id);
});
