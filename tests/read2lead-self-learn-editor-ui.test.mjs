import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draftFromLesson, fieldsFromDraft, lessonFromDraft, editSection, editPath, synchronizeText, draftChanged, previewLesson, renderEditor } from '../src/lib/read2lead/self-learn/editor-views.mjs';
import { validateEditorLesson } from '../functions/lib/read2lead/self-learn/editor-policy.mjs';
const catalogue=JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/level-lessons.json',import.meta.url))),lesson=catalogue.lessons[2];
const view={document:{lesson_id:lesson.id,revision:4,head_revision:1,head_sha256:'a'.repeat(64),workflow:'qa_ready',published_revision:null,published_available:false},lesson,revisions:[{revision:1,content_sha256:'a'.repeat(64)}],reviews:[],blocks:[]};
const state={access:{editor_id:'synthetic-editor-qa'},draft:draftFromLesson(lesson,4),view,documents:[{...view.document,title_en:lesson.title_en}],templates:catalogue.lessons,audit:[]};
test('all draft fields round-trip exactly, including preserved unrecognized fields for server validation',()=>{
 const input={...structuredClone(lesson),new_field:{evidence:['preserved'],flag:false}},draft=draftFromLesson(input,7);assert.deepEqual(lessonFromDraft(draft),input);assert.equal(draft.expected_revision,7);assert.equal(draft.lesson_id,lesson.id);
});
test('invalid section text survives serialization/reload and parsing names the affected section',()=>{
 const raw='{ incomplete local edit',draft=editSection(state.draft,'questions',raw),restored=JSON.parse(JSON.stringify(draft));assert.equal(fieldsFromDraft(restored).questions,raw);
 assert.throws(()=>lessonFromDraft(restored),e=>e.code==='editor_section_json'&&e.issues.includes('questions'));
 const repaired=editSection(restored,'questions',JSON.stringify(lesson.questions));assert.deepEqual(lessonFromDraft(repaired),lesson);
});
test('simple and nested edits preserve all unrelated content and fixed lesson identity',()=>{
 const title=editPath(state.draft,'title_en','Changed title'),story=editPath(title,'story.sentences.0.text_en','Changed sentence.');const result=lessonFromDraft(story);
 assert.equal(result.title_en,'Changed title');assert.equal(result.story.sentences[0].text_en,'Changed sentence.');assert.deepEqual(result.questions,lesson.questions);assert.deepEqual(result.policy,lesson.policy);assert.equal(story.expected_revision,4);
 assert.throws(()=>editPath(state.draft,'id','other'),e=>e.code==='editor_id_locked');assert.equal(lessonFromDraft(editPath(draftFromLesson(lesson),'id','new-story')).id,'new-story');
});
test('protected policy and prototype paths cannot be edited through form helpers',()=>{
 for(const path of ['policy.automatic_promotion','__proto__.polluted','constructor.prototype.value','story.unknown.text_en'])assert.throws(()=>editPath(state.draft,path,'yes'),e=>e.code==='invalid_editor_field');
 for(const key of ['policy','review','__proto__','unknown'])assert.throws(()=>editSection(state.draft,key,'{}'),e=>e.code==='invalid_editor_field');assert.equal({}.polluted,undefined);
});
test('explicit text synchronization updates only story/audio hashes and script, never evidence or review assertions',async()=>{
 const changed=editPath(state.draft,'story.sentences.0.text_en',lesson.story.sentences[0].text_en+' Again.'),before=lessonFromDraft(changed),synced=lessonFromDraft(await synchronizeText(changed));
 assert.notEqual(synced.story.text_sha256,before.story.text_sha256);assert.equal(synced.audio.script_sha256,synced.story.text_sha256);assert.equal(synced.audio.script_en,synced.story.sentences.map(s=>s.text_en).join(' '));
 assert.deepEqual(synced.questions,before.questions);assert.deepEqual(synced.retell,before.retell);assert.deepEqual(synced.review,before.review);assert.equal(synced.audio.asset_status,'not_recorded');
 await assert.rejects(validateEditorLesson({mode:'synthetic-local',lesson:synced}),e=>e.code==='invalid_editor_integrity'&&e.issues.includes('invalid_evidence_quote'));
});
test('all reference levels round-trip and explicit text synchronization remains valid',async()=>{
 for(const value of catalogue.lessons){const draft=draftFromLesson(value);assert.deepEqual(lessonFromDraft(draft),value);const result=lessonFromDraft(await synchronizeText(draft));await validateEditorLesson({mode:'synthetic-local',lesson:result});}
});
test('preview escapes imported text, prompts, options and evidence rather than executing markup or SVG',()=>{
 const poisoned=structuredClone(lesson),attack='<img src=x onerror="alert(1)">';poisoned.title_en=attack;poisoned.story.sentences[0].text_en=attack;poisoned.questions[0].prompt_en=attack;poisoned.questions[0].options_en[0]=attack;poisoned.questions[0].evidence_spans[0].quote=attack;poisoned.illustrations[0].svg='<script>alert(2)</script>';
 const html=previewLesson(poisoned);assert.doesNotMatch(html,/<img|<script|<svg/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/alert\(2\)/);
});
test('logged out and loading views expose no draft, templates, notes or private history',()=>{
 const secret={...state,access:null,view:{...view,lesson:{...lesson,title_en:'PRIVATE_TITLE'}},draft:draftFromLesson({...lesson,title_en:'PRIVATE_DRAFT'}),audit:[{note:'PRIVATE_AUDIT'}],templates:[{...lesson,title_en:'PRIVATE_TEMPLATE'}]};
 for(const loading of [false,true]){const html=renderEditor({...secret,loading});assert.doesNotMatch(html,/PRIVATE_/);if(!loading)assert.match(html,/editor-login-form/);}
});
test('forms expose each content group and label local, saved, publication and pending states truthfully',()=>{
 const html=renderEditor(state);for(const key of ['source','objectives','difficulty','story','audio','questions','misconception_repair','minny','retell','independent_followup','policy','review'])assert.ok(html.includes('data-section="'+key+'"'),key);
 assert.match(html,/Chưa có/);assert.match(html,/Không thay thế duyệt quyền sử dụng/);assert.match(html,/Chỉ xem/);assert.match(html,/editor-review-form/);assert.match(html,/editor-quarantine-form/);
 const dirty=editPath(state.draft,'title_en','Unsaved');assert.equal(draftChanged(state.draft,view),false);assert.equal(draftChanged(dirty,view),true);assert.match(renderEditor({...state,draft:dirty}),/Lưu hoặc bỏ thay đổi/);
 const pending=renderEditor({...state,pending:{route:'draft',data:{}}});assert.match(pending,/Lượt gửi chưa được xác nhận/);assert.match(pending,/Gửi lại đúng lượt/);assert.match(pending,/data-action="discard-pending"[^>]*disabled/);
});
test('malformed section remains visible and editable after a failed preview',()=>{
 const draft=editSection(state.draft,'questions','BROKEN_JSON'),html=renderEditor({...state,draft,preview:true,error:true,message:'Fix this',issues:['questions']});assert.match(html,/BROKEN_JSON/);assert.match(html,/data-section="questions"/);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/<section class="editor-preview/);assert.doesNotMatch(html,/data-action="preview"[^>]*disabled/);assert.equal((html.match(/class="editor-section" open/g)||[]).length,1);
});
test('renderer escapes every externally supplied label, message, audit and confirmation',()=>{
 const attack='</textarea><script>BAD_SCRIPT</script>',html=renderEditor({...state,message:attack,issues:[attack],confirm:{message:attack},audit:[{note:attack}],documents:[{...view.document,title_en:attack}],templates:[{...lesson,title_en:attack}],draft:editSection(state.draft,'questions',attack)});
 assert.doesNotMatch(html,/<script>|<\/textarea><script>/);assert.match(html,/&lt;script&gt;/);
});
