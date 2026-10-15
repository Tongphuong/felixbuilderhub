import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import fixture from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import catalogue from './fixtures/read2lead-self-learn/level-lessons.json' with {type:'json'};
import interests from './fixtures/read2lead-self-learn/library-interests.json' with {type:'json'};
import families from './fixtures/read2lead-self-learn/family-access.json' with {type:'json'};
import {publisherSuggestions,validatePublisherSeries} from '../functions/lib/read2lead/self-learn/publisher-library-policy.mjs';
import {createSyntheticPublisherRuntime} from '../scripts/lib/read2lead-publisher-runtime.mjs';
import {SyntheticStore} from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import {SyntheticFamilyStore} from '../scripts/lib/read2lead-self-learn-family.mjs';
import {SyntheticLibraryStore} from '../scripts/lib/read2lead-self-learn-library.mjs';
import {publicLibrary} from '../functions/lib/read2lead/self-learn/library-views.mjs';
import {renderLibrary} from '../src/lib/read2lead/self-learn/library-views.mjs';
import {renderPlayer,escapeHTML} from '../src/lib/read2lead/self-learn/player-views.mjs';
const now='2026-09-20T12:00:00.000Z',staff={active:true,role:'staff',id:'synthetic-staff'};
function pkg(number,{id='story-'+number,month=1,prior=null,collection=1}={}){
 const p=structuredClone(fixture);p.lesson.id=id;p.lesson.title_en='Synthetic part '+number;
 Object.assign(p.lesson.source,{source_id:'source-'+collection+'-'+month+'-'+number,collection_id:'collection-'+collection,collection_level:collection,book_id:'book-'+collection+'-'+month,month,story_number:number,predecessor_source_id:prior});return p;
}
const root=pkg(1,{id:'z-first'}),second=pkg(2,{id:'a-second',prior:root.lesson.source.source_id}),third=pkg(3,{prior:second.lesson.source.source_id}),standalone=pkg(12,{id:'a-twelve'});
const options=lessons=>({lessons:lessons.map(p=>p.lesson),groups:interests.groups,level:'L1',interestIds:[],favoriteIds:[]});
const row=(p,more={})=>({id:'reading-'+p.lesson.id,lesson_id:p.lesson.id,source_id:p.lesson.source.source_id,version:p.lesson.version,level:p.lesson.level,status:'active',available:true,updated_at:now,...more});
test('default suggestion order is numeric source order, independent of IDs, dates and input array order',()=>{
 const december=pkg(2,{month:12}),march=pkg(4,{month:3});const args=options([december,standalone,march,root]);args.limit=10;
 const result=publisherSuggestions(args);assert.deepEqual(result.map(x=>x.lesson_id),[root.lesson.id,standalone.lesson.id,march.lesson.id,december.lesson.id]);assert.deepEqual(publisherSuggestions({...args,lessons:[...args.lessons].reverse()}),result);
 assert.ok(result.some(x=>x.lesson_id===december.lesson.id));assert.deepEqual(publisherSuggestions({...args,level:'L5'}),[]);
});
test('unfinished visits do not satisfy multipart prerequisites; every prior part must be complete and available',()=>{
 const args=options([third,second,root,standalone]);const before=JSON.stringify(args);
 assert.deepEqual(publisherSuggestions(args).map(x=>x.lesson_id),[root.lesson.id,standalone.lesson.id]);
 assert.ok(!publisherSuggestions({...args,readings:[row(root)]}).some(x=>x.lesson_id===second.lesson.id));
 assert.ok(publisherSuggestions({...args,readings:[row(root,{status:'complete'})]}).some(x=>x.lesson_id===second.lesson.id));
 assert.ok(!publisherSuggestions({...args,sessions:[row(second,{status:'complete'})]}).some(x=>x.lesson_id===third.lesson.id));
 assert.ok(publisherSuggestions({...args,readings:[row(root,{status:'complete'})],sessions:[row(second,{status:'complete'})],limit:10}).some(x=>x.lesson_id===third.lesson.id));
 assert.ok(!publisherSuggestions({...options([second,standalone]),readings:[row(root,{status:'complete'})]}).some(x=>x.lesson_id===second.lesson.id));assert.equal(JSON.stringify(args),before);
});
test('continuation targets the newest exact available pin; completed stories follow new suitable stories',()=>{
 const args=options([root,standalone]);const readings=[row(root,{id:'older',updated_at:'2026-09-19T00:00:00Z'}),row(root,{id:'newer'})];
 assert.deepEqual(publisherSuggestions({...args,readings})[0],{lesson_id:root.lesson.id,reason:'publisher_continue_reading',reading_id:'newer'});
 assert.deepEqual(publisherSuggestions({...args,readings,sessions:[row(root,{id:'saved-session',status:'saved'})]})[0],{lesson_id:root.lesson.id,reason:'publisher_continue_practice',session_id:'saved-session'});
 for(const change of [{version:'1.2.2'},{available:false},{level:'L2'},{source_id:'different-source'}])assert.ok(!publisherSuggestions({...args,sessions:[row(root,change)]}).some(x=>x.session_id));
 const finished=[row(root,{status:'complete'})];assert.equal(publisherSuggestions({...args,readings:finished,favoriteIds:[root.lesson.id]})[0].lesson_id,standalone.lesson.id);
 const done=[row(root,{status:'complete',updated_at:'2026-09-20T01:00:00Z'}),row(standalone,{status:'complete',updated_at:'2026-09-19T01:00:00Z'})];assert.equal(publisherSuggestions({...args,readings:done})[0].lesson_id,standalone.lesson.id);
});
test('missing predecessor remains reconcilable; contradictory, cross-collection and aliased source identities fail',async()=>{
 assert.equal(validatePublisherSeries([second.lesson]).size,1);
 const backward=structuredClone(root);backward.lesson.source.predecessor_source_id=second.lesson.source.source_id;
 assert.throws(()=>validatePublisherSeries([backward.lesson,second.lesson]),/invalid_publisher_series_order/);
 const cross=pkg(2,{collection:2,prior:root.lesson.source.source_id});assert.throws(()=>validatePublisherSeries([root.lesson,cross.lesson]),/invalid_publisher_series_order/);
 const alias=structuredClone(root);alias.lesson.id='alias';alias.lesson.source.source_id='alias-source';assert.throws(()=>validatePublisherSeries([root.lesson,alias.lesson]),/publisher_source_slot_conflict/);
 await assert.rejects(createSyntheticPublisherRuntime({mode:'synthetic-local',packages:[root,alias]}),/publisher_source_slot_conflict/);
 const renamed=structuredClone(root);renamed.lesson.id='renamed-lesson';await assert.rejects(createSyntheticPublisherRuntime({mode:'synthetic-local',packages:[root,renamed]}),/publisher_identity_conflict/);
 await assert.rejects(createSyntheticPublisherRuntime({mode:'synthetic-local',packages:[backward,second]}),/invalid_publisher_series_order/);
 const monthEnd=pkg(31),nextMonth=pkg(1,{month:2,prior:monthEnd.lesson.source.source_id});assert.equal(validatePublisherSeries([nextMonth.lesson,monthEnd.lesson]).size,2);
});
async function setup(t){
 const target=mkdtempSync(join(tmpdir(),'r2l-series-'));writeFileSync(join(target,'synthetic-target.json'),JSON.stringify({format:1,purpose:'read2lead-local-synthetic',database:'read2lead-synthetic.sqlite'}));
 const publisherRuntime=await createSyntheticPublisherRuntime({mode:'synthetic-local',packages:[standalone,second,root]});
 const core=new SyntheticStore({root:target,publisherRuntime}),family=new SyntheticFamilyStore({mode:'synthetic-local',root:target});
 const seed=structuredClone(families.accounts[0]);seed.children.forEach(c=>c.level='L1');family.seed(staff,seed,now);
 const config={mode:'synthetic-local',root:target,catalogue,interests,publisherRuntime};let library=await SyntheticLibraryStore.open(config);
 t.after(()=>{library.close();family.close();core.close();});const principal={...family.authenticateAccess(seed.access_code),childId:'synthetic-an'};
 return{core,family,publisherRuntime,principal,get library(){return library;},async reopen(){library.close();library=await SyntheticLibraryStore.open(config);}};
}
test('SQLite recommendations preserve child scope, read-only rewards, continuation and long-history prerequisites across reopen',async t=>{
 const f=await setup(t),p=f.principal,ids=()=>publicLibrary(f.library.view(p)).suggestions.map(x=>x.lesson_id);
 assert.deepEqual(ids(),[root.lesson.id,standalone.lesson.id]);const wallet=f.core.wallet(p,p.childId);
 const opened=f.library.openReading(p,{request_id:'open-first',lesson_id:root.lesson.id},now).reading;
 assert.deepEqual(publicLibrary(f.library.view(p)).suggestions[0],{lesson_id:root.lesson.id,reason:'publisher_continue_reading',reading_id:opened.reading_id});assert.ok(!ids().includes(second.lesson.id));
 f.library.updateReading(p,{request_id:'finish-first',reading_id:opened.reading_id,expected_revision:0,sentence_id:root.lesson.story.sentences.at(-1).id,marked_finished:true},now);
 assert.equal(ids()[0],second.lesson.id);assert.ok(!f.library.view({...p,childId:'synthetic-binh'}).suggestions.some(x=>x.lesson_id===second.lesson.id));
 // More than the displayed history cap must not erase an older completed prerequisite.
 for(let i=0;i<101;i++){
  const r=f.library.openReading(p,{request_id:'history-'+i,lesson_id:standalone.lesson.id},'2026-09-21T00:00:00.000Z').reading;
  f.library.updateReading(p,{request_id:'finish-history-'+i,reading_id:r.reading_id,expected_revision:0,sentence_id:standalone.lesson.story.sentences.at(-1).id,marked_finished:true},'2026-09-21T00:00:00.000Z');
 }
 assert.equal(f.library.view(p).reading_history.length,100);assert.ok(!f.library.view(p).reading_history.some(r=>r.lesson_id===root.lesson.id));assert.equal(ids()[0],second.lesson.id);
 await f.reopen();assert.equal(ids()[0],second.lesson.id);assert.deepEqual(f.core.wallet(p,p.childId),wallet);assert.equal(f.core.history(p,p.childId).length,0);
 await f.core.start(p,{sessionId:'continue-practice',childId:p.childId,publisherPackage:standalone,apiVersion:'1.3',now});assert.equal(publicLibrary(f.library.view(p)).suggestions[0].session_id,'continue-practice');
 f.publisherRuntime.withdraw(root.lesson.id,root.lesson.version);assert.ok(!ids().includes(second.lesson.id));assert.ok(f.library.catalogue(p).some(l=>l.id===second.lesson.id));assert.deepEqual(f.core.wallet(p,p.childId),wallet);
});
test('completed oral practice also unlocks the next part without using assessment or changing rewards',async t=>{
 const f=await setup(t),p=f.principal,id='complete-practice';await f.core.start(p,{sessionId:id,childId:p.childId,publisherPackage:root,apiVersion:'1.3',now});
 const speech={text:'',capture_status:'not_attempted',support_used:[],response_kind:'spoken'};
 for(let i=0;i<35;i++){
  const r=f.core.record(p,p.childId,id),s=r.session,l=r.lesson;if(s.status==='complete')break;let name,payload={};
  switch(s.stage){case'pre_read':name='prediction';payload={text:'',response_kind:'skipped'};break;case'input':name='input_complete';payload={order:['read']};break;case'comprehension':name=s.question_cursor<3?'answer':'save_understand';if(name==='answer')payload={...speech,item_id:l.questions[s.question_cursor].id,choice_index:null,evidence_sentence_ids:[]};break;case'understand_saved':name='begin_use';break;case'shadowing':name='shadow_complete';payload=speech;break;case'mini_story':name='minny_turn';payload={...speech,turn_id:l.minny.turns[s.dialogue_cursor].id};break;case'retell':name=!r.retell_received?'retell':s.followup_state==='ready'?'followup_answer':'complete';payload=name==='retell'?speech:name==='followup_answer'?{...speech,item_id:l.independent_followup.id,choice_index:null}:{};break;default:throw Error('unexpected_stage');}
  f.core.submit(p,{api_version:'1.3',request_id:'finish-'+s.revision,session_id:id,child_id:p.childId,expected_revision:s.revision,event:name,payload},now);
 }
 assert.equal(f.core.record(p,p.childId,id).session.status,'complete');assert.equal(f.library.view(p).suggestions[0].lesson_id,second.lesson.id);assert.equal(f.core.wallet(p,p.childId).balance,10);await f.reopen();assert.equal(f.library.view(p).suggestions[0].lesson_id,second.lesson.id);
});
test('cards show multipart links or missing notices and continue the saved record; home prioritizes unfinished publisher work',()=>{
 const lessons=[root.lesson,second.lesson],access={active_child_id:'synthetic-an',children:[{id:'synthetic-an',label_vi:'An',level:'L1'}]};
 const state={access,screen:'library',libraryCatalogue:lessons,libraryLessons:lessons,libraryFilters:{},libraryClient:{library:{child_id:'synthetic-an',level:'L1',groups:[],favorites:[],preferences:{interest_ids:[]},suggestions:[{lesson_id:root.lesson.id,reason:'publisher_continue_practice',session_id:'saved-session'}],reading_history:[]}}};
 state.libraryClient.library=publicLibrary(state.libraryClient.library);
 let html=renderLibrary(state,escapeHTML);assert.match(html,/data-session="saved-session"/);assert.match(html,/Đọc phần trước/);
 state.libraryCatalogue=[second.lesson];state.libraryLessons=[second.lesson];state.libraryClient.library.suggestions=[];html=renderLibrary(state,escapeHTML);assert.match(html,/Phần trước của câu chuyện chưa sẵn sàng/);
 const home=renderPlayer({access,screen:'learning',lessons,sessions:[{session_id:'done',lesson_id:root.lesson.id,status:'complete',stage:'complete'},{session_id:'unfinished',lesson_id:second.lesson.id,status:'saved',stage:'input'}]});assert.ok(home.indexOf('data-session="unfinished"')<home.indexOf('data-session="done"'));
});

test('public continuation projection allows only the matching safe ID and keeps private fields out',()=>{
 const view={child_id:'synthetic-an',level:'L1',preferences:{revision:0,interest_ids:[]},groups:[],favorites:[],reading_history:[],suggestions:[
  {lesson_id:'story',reason:'publisher_continue_reading',reading_id:'saved-reading',session_id:'unrelated-session',private_note:'never expose'},
  {lesson_id:'story',reason:'publisher_continue_practice',session_id:'saved-session',reading_id:'unrelated-reading'},
  {lesson_id:'story',reason:'same_level_new',reading_id:'not-a-continuation'},
  {lesson_id:'story',reason:'publisher_continue_reading',reading_id:'<unsafe>'}
 ]};
 assert.deepEqual(publicLibrary(view).suggestions,[
  {lesson_id:'story',reason:'publisher_continue_reading',reading_id:'saved-reading'},
  {lesson_id:'story',reason:'publisher_continue_practice',session_id:'saved-session'},
  {lesson_id:'story',reason:'same_level_new'},
  {lesson_id:'story',reason:'publisher_continue_reading'}
 ]);
});
test('recommendation selection handles a complete 1095-entry synthetic load without changing source order',t=>{
 const packages=[];for(let collection=1;collection<=3;collection++)for(let month=1;month<=12;month++)for(let day=1;day<=[31,28,31,30,31,30,31,31,30,31,30,31][month-1];day++)packages.push(pkg(day,{collection,month,id:`load-${collection}-${month}-${day}`}));
 assert.equal(packages.length,1095);const args=options(packages.reverse()),started=performance.now(),result=publisherSuggestions(args);t.diagnostic(`1095 synthetic entries selected in ${(performance.now()-started).toFixed(2)} ms`);
 assert.deepEqual(result.map(x=>x.lesson_id),['load-1-1-1','load-1-1-2','load-1-1-3']);assert.equal(args.lessons[0].id,'load-3-12-31');
});
