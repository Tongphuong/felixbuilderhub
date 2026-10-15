import test from 'node:test';
import assert from 'node:assert/strict';
import original from './fixtures/read2lead-self-learn/publisher-package.json' with {type:'json'};
import {validatePublisherPackage} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {pictureRetellFor,pictureRetellResult} from '../functions/lib/read2lead/picture-retell.mjs';
import {storySessionView,newStorySession} from '../functions/lib/read2lead/story-session.mjs';
function sample(count=4){
 const p=structuredClone(original),l=p.lesson;l.source.kind='user_supplied_publisher';l.source.source_id='osad-other-story';l.source.collection_id='osad-collection-2';
 l.interview={version:'story-interview-v1',question_count:12,completion_diamonds:50};
 l.questions=Array.from({length:12},(_,i)=>({...structuredClone(l.questions[0]),id:'interview-'+i,source:'story',dimension:'meaning',prompt_en:'Story question '+i+'?'}));
 const a={id:'retell-image',kind:'image',sha256:'a'.repeat(64),bytes:100,mime:'image/png',object_key:'a'.repeat(64)+'.png',width:1600,height:900,duration_seconds:0,provenance:'new_illustration',reference_hashes:[],character_ids:[],alt_en:'Four scene story illustration'};p.assets.push(a);const s=l.story.sentences[0];
 l.picture_retell={version:'picture-retell-v1',asset_id:a.id,frames:Array.from({length:count},()=>({x:0,y:0,width:a.width,height:a.height})),criteria:Array.from({length:count},(_,i)=>({id:'scene-'+i,meaning:'Meaning '+i,label_vi:'Ý chính '+(i+1),evidence_spans:[{sentence_id:s.id,quote:s.text_en}]}))};return p;
}
for(const count of [4,5])test('validated '+count+' scene package uses its own image and grading labels',async()=>{
 const p=sample(count);await validatePublisherPackage(p);const task=pictureRetellFor(p.lesson);assert.equal(task.criteria.length,count);assert.match(task.prompt,new RegExp(p.lesson.title_en));
 const result=pictureRetellResult(task,{intent:'answer',reliability:'confirmed',matchedCriteria:task.criteria.map(c=>c.id)});assert.equal(result.status,'complete');assert.equal(result.meanings[0].label,'Ý chính 1');
 const view=storySessionView(p,newStorySession(p.lesson,'test'));assert.match(view.policy.pictureRetell.picture,/\/api\/read2lead-story-media\//);assert.equal(view.policy.pictureRetell.frames.length,count);assert.equal(JSON.stringify(view).includes('Meaning 0'),false,'grading answers stay server-side');
});
for(const [name,mutate] of [
 ['unknown picture',p=>p.lesson.picture_retell.asset_id='missing'],
 ['out of bounds crop',p=>p.lesson.picture_retell.frames[0].x=8192],
 ['wrong source quote',p=>p.lesson.picture_retell.criteria[0].evidence_spans[0].quote='Invented words'],
 ['duplicate grading ID',p=>p.lesson.picture_retell.criteria[1].id='scene-0'],
 ['not an OSAD story',p=>p.lesson.source.collection_id='old-original'],
 ['not an interview',p=>{delete p.lesson.interview;p.lesson.questions=p.lesson.questions.slice(0,3)}],
 ['mismatched scenes',p=>p.lesson.picture_retell.frames.pop()],
 ['blank grading meaning',p=>p.lesson.picture_retell.criteria[0].meaning='  '],
])test('package rejects '+name,async()=>{const p=sample();mutate(p);await assert.rejects(validatePublisherPackage(p));});
test('unmodified original publisher package stays valid without new activity',async()=>{await validatePublisherPackage(original);assert.equal(pictureRetellFor(original.lesson),null);});
