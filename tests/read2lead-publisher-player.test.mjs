import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {createPublisherJourney,applyPublisherEvent} from '../functions/lib/read2lead/self-learn/publisher-journey.mjs';
import {publisherSessionView,publicPublisherLesson} from '../functions/lib/read2lead/self-learn/publisher-views.mjs';
import {publisherPayload,filterPublisherCards} from '../src/lib/read2lead/self-learn/publisher-client.mjs';
import {publisherLearningPanel,publisherStory,publisherMedia,publisherShelves} from '../src/lib/read2lead/self-learn/publisher-player-views.mjs';
import {renderPlayer,escapeHTML as e} from '../src/lib/read2lead/self-learn/player-views.mjs';
import {renderLibrary} from '../src/lib/read2lead/self-learn/library-views.mjs';
const now='2026-09-20T12:00:00.000Z',actor={active:true,childId:'synthetic-child'},opts={mode:'synthetic-local'};
const seed=()=>createPublisherJourney({package:fixture,sessionId:'player-session',childId:actor.childId,now});
const data=(entries=[])=>{const d=new FormData();for(const [k,v] of entries)d.append(k,v);return d;};
const payload=(event,itemId,entries=[],responseKind='spoken')=>publisherPayload({event,itemId,data:data(entries),responseKind});
function send(r,event,payload={}){const result=applyPublisherEvent(r,{api_version:'1.3',request_id:'player-'+r.session.revision,child_id:actor.childId,session_id:r.session.session_id,expected_revision:r.session.revision,event,payload},actor,now);assert.equal(result.response.ok,true,JSON.stringify(result.response));return result.record;}
const state=view=>({access:{active_child_id:actor.childId,children:[{id:actor.childId,label_vi:'An',level:'L1'}]},client:{view,row:{},wallet:13},screen:'learning'});
function noTyping(html){assert.doesNotMatch(html,/<textarea|name="text"|id="response-text"|name="choice"[^>]*required/);assert.doesNotMatch(html,/undefined|\[object Object\]/);}
test('oral form keeps absent answers null and skips a previously selected answer',()=>{
 for(const event of ['answer','repair_answer','followup_answer']){
  const empty=payload(event,'q');assert.equal(empty.choice_index,null);assert.equal(empty.response_kind,'spoken');assert.equal(empty.text,'');
  const tap=payload(event,'q',[['choice','0']]);assert.equal(tap.choice_index,0);assert.equal(tap.response_kind,'tap');
  const skip=payload(event,'q',[['choice','0'],['evidence','s1'],['text','never send']], 'skipped');assert.equal(skip.choice_index,null);assert.equal(skip.response_kind,'skipped');assert.equal(skip.text,'');if(event==='answer')assert.deepEqual(skip.evidence_sentence_ids,[]);
 }
});
test('every rendered lesson stage completes without typing, tap, microphone or invented assessment',async()=>{
 let r=await seed();const stages=new Set();
 const check=async()=>{const view=await publisherSessionView(r,fixture,opts),html=renderPlayer(state(view));noTyping(html);assert.match(html,/Read2Lead/);stages.add(r.session.stage);return view;};
 await check();r=send(r,'prediction',payload('prediction'));await check();r=send(r,'input_complete',{order:['read']});
 for(const q of r.lesson.questions){await check();r=send(r,'answer',payload('answer',q.id));}
 await check();r=send(r,'save_understand');await check();r=send(r,'begin_use');await check();r=send(r,'shadow_complete',payload('shadow_complete'));
 for(const t of r.lesson.minny.turns){await check();r=send(r,'minny_turn',payload('minny_turn',t.id));}
 await check();r=send(r,'retell',payload('retell'));await check();r=send(r,'followup_answer',payload('followup_answer',r.lesson.independent_followup.id));await check();r=send(r,'complete');const final=await check();
 assert.deepEqual([...stages],['pre_read','input','comprehension','understand_saved','shadowing','mini_story','retell','complete']);assert.ok(final.summary.reading.every(x=>x.status==='unassessable'));assert.match(renderPlayer(state(final)),/13 kim cương/);assert.match(renderPlayer(state(final)),/Speaking has not been assessed/);
});
test('repair is rendered after an incorrect tap and remains optional',async()=>{
 let r=await seed();r=send(r,'prediction',payload('prediction'));r=send(r,'input_complete',{order:['read']});const q=r.lesson.questions[0];r=send(r,'answer',payload('answer',q.id,[['choice',String((q.correct_index+1)%q.options_en.length)]]));
 for(const q of r.lesson.questions.slice(1))r=send(r,'answer',payload('answer',q.id));
 assert.match(publisherLearningPanel(await publisherSessionView(r,fixture,opts),e),/begin-repair/);r=send(r,'begin_repair');const html=publisherLearningPanel(await publisherSessionView(r,fixture,opts),e);noTyping(html);assert.match(html,/data-event="repair_answer"/);assert.match(html,/Skip for now/);
});
test('public raster assets render at their sentence once, escape attributes and retain free-reading bookmark',async()=>{
 const l=await publicPublisherLesson(fixture,opts);l.illustrations=[{id:'picture',url:'/api/media/example.png?x="<',alt_en:'A "test" <picture>',sentence_ids:l.story.sentences.slice(0,2).map(s=>s.id)}];const html=publisherStory(l,e,{free:true,bookmark:l.story.sentences[0].id});assert.equal((html.match(/<img /g)||[]).length,1);assert.match(html,/&quot;&lt;/);assert.doesNotMatch(html,/data:image\/svg/);assert.match(html,/data-free-sentence=/);assert.match(html,/bookmark-label/);
});
test('unmatched audio is unavailable and verified phrase buttons require timing evidence',async()=>{
 const l=await publicPublisherLesson(fixture,opts);l.audio={available:true,status:'playable',duration_seconds:2,timing_verified:false,segments:[]};assert.doesNotMatch(publisherMedia(l,e),/data-narration/);l.audio.status='matched';assert.match(publisherMedia(l,e),/narration-pause/);const v=await publisherSessionView(await seed(),fixture,opts);v.lesson=l;v.session.stage='shadowing';assert.doesNotMatch(publisherLearningPanel(v,e),/data-action="narration-segment"/);l.audio.timing_verified=true;l.audio.segments=[{id:'s1',sentence_ids:[l.shadowing.sentence_ids[0]]}];assert.match(publisherLearningPanel(v,e),/data-action="narration-segment"/);
});
test('private rehearsal exposes playable whole-story audio without claiming verified timing',async()=>{
 const l=await publicPublisherLesson(fixture,opts);l.audio={...l.audio,available:true,status:'playable',timing_verified:false,segments:[]};l.policy.private_rehearsal=true;
 assert.match(publisherMedia(l,e),/data-action="narration-play"/);assert.match(publisherMedia(l,e),/not verified yet/);
 const v=await publisherSessionView(await seed(),fixture,opts);v.lesson=l;v.session.stage='shadowing';assert.doesNotMatch(publisherLearningPanel(v,e),/data-action="narration-segment"/);
 l.audio.available=false;assert.doesNotMatch(publisherMedia(l,e),/data-narration/);
});
test('source filters distinguish collection levels from learning levels and sort stories numerically',()=>{
 const rows=[{id:'late',title_en:'The Blue Kite',level:'L1',source:{collection_level:3,month:2,story_number:12}},{id:'early',title_en:'The Red Kite',level:'L1',source:{collection_level:3,month:2,story_number:2}},{id:'other',title_en:'A Small Boat',level:'L3',source:{collection_level:1,month:1,story_number:1}}];assert.deepEqual(filterPublisherCards(rows,{query:'ＫＩＴＥ',collection:'3',month:'2'}).map(r=>r.id),['late','early']);assert.deepEqual(filterPublisherCards(rows,{collection:'2'}),[]);const html=publisherShelves(rows,e,l=>`<p>${l.id}</p>`);assert.equal((html.match(/class="publisher-collection"/g)||[]).length,3);assert.ok(html.indexOf('<p>early')<html.indexOf('<p>late'));
});
test('library displays source groups and new search controls; free reader preserves bookmarking',async()=>{
 const l=await publicPublisherLesson(fixture,opts),s=state(null);s.screen='library';s.libraryCatalogue=[l];s.libraryLessons=[l];s.libraryFilters={};s.libraryClient={library:{child_id:actor.childId,level:'L1',favorites:[],suggestions:[],preferences:{interest_ids:[]},groups:[],reading_history:[]}};
 let html=renderLibrary(s,e);assert.match(html,/library-title-search/);assert.match(html,/library-collection-filter/);assert.match(html,/source-collection-3/);assert.match(html,/Truyện 1/);
 s.screen='free-reading';s.libraryClient.view={lesson:l,reading:{child_id:actor.childId,reading_id:'read-1',sentence_id:l.story.sentences[0].id,content_version:l.version}};html=renderLibrary(s,e);noTyping(html);assert.match(html,/free-save-position/);assert.match(html,/free-mark-finished/);assert.doesNotMatch(html,/data:image\/svg/);
});

test('first rendered scene is eager and dimensions reserve space while later scenes stay lazy',async()=>{
 const l=await publicPublisherLesson(fixture,opts);l.illustrations=[{id:'later',url:'/later.png',alt_en:'Later',width:800,height:500,sentence_ids:['s5']},{id:'first',url:'/first.png',alt_en:'First',width:800,height:500,sentence_ids:['s1','s2']}];
 const html=publisherStory(l,e),images=[...html.matchAll(/<img [^>]+>/g)].map(m=>m[0]);assert.equal(images.length,2);assert.match(images[0],/src="\/first.png"/);assert.match(images[0],/width="800" height="500"/);assert.match(images[0],/loading="eager" fetchpriority="high"/);assert.match(images[1],/loading="lazy"/);assert.doesNotMatch(images[1],/fetchpriority/);assert.doesNotMatch(publisherStory(l,e,{pictures:false}),/<img /);
 l.illustrations[1].width='800" onerror="bad';assert.doesNotMatch(publisherStory(l,e),/onerror|width="800" on/);
});
