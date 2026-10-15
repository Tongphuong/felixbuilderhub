// Revision 2 supersedes the prior rank/shop/SpeakUp home design.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('src/lib/r2l-hero.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {buildHeroCta,statusMeta}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('unfinished original/story lessons resume and reviewed originals allow a new story',()=>{
 for(const schema_version of [2,'story-mission-v1']){
  const pack={pack_id:'saved',schema_version,status:'ready'};
  assert.match(buildHeroCta(pack,{state:'ready'},'CHILD').href,/pack_id=saved/);
 }
 assert.equal(buildHeroCta({status:'reviewed_pass_web_v2'},{state:'reviewed'},'CHILD').action,'create');
 assert.equal(buildHeroCta(null,{},'CHILD').action,'create');
});
test('pending retelling wins over reviewed question status',()=>{
 const pack={pack_id:'saved',schema_version:'story-mission-v1',status:'reviewed_pass_web_v2',picture_retell_required:true,story_session:{complete:true,picture_retell_complete:false}};
 assert.equal(buildHeroCta(pack,{state:'reviewed'},'CHILD').action,'lesson');
 assert.equal(statusMeta('reviewed',pack).completed,false);
 pack.story_session.picture_retell_complete=true;
 assert.equal(buildHeroCta(pack,{state:'reviewed'},'CHILD').action,'create');
});
test('pending assignment cannot be created again',()=>{
 assert.equal(buildHeroCta({status:'generation_in_progress'},{state:'generation_in_progress'},'CHILD').action,'wait');
});
test('done-for-today rests only after server-confirmed completion, never hides unfinished work',()=>{
 const completed={pack_id:'saved',status:'reviewed_pass_web_v2'};
 assert.equal(buildHeroCta(completed,{state:'reviewed'},'CHILD',true).action,'rest');
 assert.equal(buildHeroCta(completed,{state:'reviewed'},'CHILD').action,'create');
 assert.equal(buildHeroCta(null,{},'CHILD',true).action,'create');
 assert.equal(buildHeroCta({pack_id:'unfinished',status:'awaiting_review'},{state:'ready'},'CHILD',true).action,'lesson');
 assert.equal(buildHeroCta({status:'generation_in_progress'},{state:'generation_in_progress'},'CHILD',true).action,'wait');
 const pending={...completed,schema_version:'story-mission-v1',picture_retell_required:true,story_session:{complete:true,picture_retell_complete:false}};
 assert.equal(buildHeroCta(pending,{state:'reviewed'},'CHILD',true).action,'lesson');
 pending.story_session.picture_retell_complete=true;
 assert.equal(buildHeroCta(pending,{state:'reviewed'},'CHILD',true).action,'rest');
});
test('both entry routes use the same uncluttered home with no collection selection',()=>{
 for(const path of ['src/pages/read2lead.astro','src/pages/r2l/start.astro']){
  const page=readFileSync(path,'utf8');assert.match(page,/<Read2LeadChildHome/);assert.match(page,/childHome/);
 }
 const page=readFileSync('src/components/Read2LeadChildHome.astro','utf8');
 assert.doesNotMatch(page,/<select|speak-up|rank-medal|coin|Tạo bài/);
 assert.match(page,/home-open/);assert.match(page,/Dành cho ba mẹ/);
});
