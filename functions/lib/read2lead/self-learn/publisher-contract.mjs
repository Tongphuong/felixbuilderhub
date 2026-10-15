/** Publisher lesson contract, private preparation only until explicit release integration.
 * Separate from original-draft 1.1: never relabel publisher text/art as original.
 * Reviews attest to a particular package; this module cannot perform human review.
 */
import legacy from '../../../../schemas/read2lead-self-learn/lesson.v1.1.schema.mjs';
import { createSchemaCheck } from './schema-check.mjs';
import { levelIssues } from './level-policy.mjs';
import { contentDigest } from './catalogue.mjs';
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
import { STORY_INTERVIEW_VERSION, STORY_INTERVIEW_QUESTIONS, STORY_INTERVIEW_DIAMONDS, isStoryInterview } from '../../../../src/lib/read2lead-story-mission.mjs';

const text = { type: 'string', minLength: 1 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const list = (items, minItems = 0, maxItems = 1000) => ({ type: 'array', items, minItems, maxItems });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$' };
const nullableId = { type: ['string', 'null'] };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
const source = object({ kind: { enum: ['user_supplied_publisher', 'synthetic_fixture'] }, source_id: id,
  collection_id: id, collection_level: integer(1,3), edition_id: id, book_id: id, month: integer(1,12),
  story_number: integer(1,31), title_as_printed: text, pdf_sha256: hash, pdf_pages: list(integer(1,2000),1,30),
  printed_pages: list(text,1,30), attribution: text, predecessor_source_id: nullableId });
const segment = object({ id, sentence_ids: list(id,1,20), start_seconds: {type:'number',minimum:0}, end_seconds: {type:'number',minimum:0} });
const asset = object({ id, kind: { enum: ['image','audio'] }, sha256: hash, bytes: integer(1,104857600),
  mime: {enum:['image/webp','image/png','image/jpeg','audio/mpeg','audio/wav','audio/ogg']},
  // Private object locator is hash-based, not an arbitrary URL or filesystem path.
  object_key: {type:'string',pattern:'^[a-f0-9]{64}\\.(webp|png|jpg|mp3|wav|ogg)$'},
  width: integer(0,8192), height: integer(0,8192), duration_seconds: {type:'number',minimum:0,maximum:3600},
  provenance: {enum:['supplied_recording','new_authorized_narration','new_illustration','source_illustration','synthetic_fixture']},
  reference_hashes: list(hash,0,20), character_ids: list(id,0,30), alt_en: text });
const grant = object({ id, source_id: id, document_sha256: hash, actions: list({enum:['digital_text','activities','stream_recording','new_narration','illustrations','source_characters','translation','ai_processing']},1,8),
  valid_from: date, valid_until: date, status: {enum:['pending','granted','revoked']}, territory: text, platform: {const:'Read2Lead'}, reviewer: text });
const review = object({ kind: {enum:['text','activities','visual','audio_decode','audio_match','audio_listening','audio_timing','rights','human_teaching','human_art']},
  package_sha256: hash, status:{enum:['needs_correction','verified','approved']}, reviewer:text, method:{enum:['automated','codex_editorial','human']},
  evidence_ref: text, reviewed_at: date });
// Reuse immutable learning-field definitions; the legacy schema object stays untouched.
export const publisherSchema = structuredClone(legacy);
publisherSchema.$id = 'urn:read2lead:self-learn:publisher-package:1';
publisherSchema.title = 'Read2Lead private publisher package 1';
const lesson = publisherSchema.definitions.lesson;
// Preserve literal source evidence while allowing reviewed equivalent meanings,
// as comprehension questions already do. Older publisher versions omit this.
publisherSchema.definitions.retellFact=structuredClone(publisherSchema.definitions.span);
publisherSchema.definitions.retellFact.properties.accepted_meanings=list(text,1,8);
lesson.properties.retell.properties.essential_facts.items={$ref:'#/definitions/retellFact'};
lesson.properties.version = { type:'string', pattern:'^1\\.2\\.[1-9][0-9]*$' };
lesson.properties.source = source;
lesson.properties.response_mode = object({kind:{const:'read_speak'},typing_allowed:{const:false},tap_choices:{const:'optional'},capture_required:{const:false}});
lesson.required.push('response_mode');
// Opt-in interviews use twelve spoken questions; unmarked lessons retain three.
lesson.properties.interview = object({version:{const:STORY_INTERVIEW_VERSION},
  question_count:{const:STORY_INTERVIEW_QUESTIONS},completion_diamonds:{const:STORY_INTERVIEW_DIAMONDS}});
// Optional authored activity, carried by each new interview package. Original
// lessons and already assigned package versions do not acquire this metadata.
lesson.properties.picture_retell = object({version:{const:'picture-retell-v1'},asset_id:id,
  frames:list(object({x:integer(0,8192),y:integer(0,8192),width:integer(1,8192),height:integer(1,8192)}),4,5),
  criteria:list(object({id,meaning:text,label_vi:text,evidence_spans:list({$ref:'#/definitions/span'},1,12)}),4,5)});
lesson.properties.questions.minItems = 3;
lesson.properties.questions.maxItems = STORY_INTERVIEW_QUESTIONS;
lesson.properties.pre_read.properties.prediction_en = lesson.properties.pre_read.properties.prediction_vi;
delete lesson.properties.pre_read.properties.prediction_vi;
lesson.properties.pre_read.required = ['prediction_en','graded','vocabulary'];
lesson.properties.misconception_repair.properties.hint_en = lesson.properties.misconception_repair.properties.hint_vi;
delete lesson.properties.misconception_repair.properties.hint_vi;
lesson.properties.misconception_repair.required = lesson.properties.misconception_repair.required.map(k=>k==='hint_vi'?'hint_en':k);
lesson.properties.illustrations = list(object({ id, kind:{const:'raster'}, asset_id:id, alt_en:text, sentence_ids:list(id,1,30) }),0,12);
lesson.properties.audio = object({content_version:text,script_en:text,script_sha256:hash,asset_id:nullableId,
  voice_version:text,segments:list(segment,0,100),status:{enum:['missing','candidate','playable','matched','timing_verified','reviewed','approved_exception']}});
lesson.properties.review = object({author_check:{enum:['pending','complete']},independent_review:{const:false},pedagogical_validation:{const:'pending'},publication:{const:'not_authorized'}});
publisherSchema.properties = {format:{const:'r2l-publisher-package/1'},lesson:{$ref:'#/definitions/lesson'},assets:list(asset,0,13),rights:list(grant,0,20),reviews:list(review,0,30)};
publisherSchema.required = Object.keys(publisherSchema.properties);
// Optional, explicitly owner-approved exception for one existing recording.
// It is not a listening/timing review, and cannot enable sentence replay.
publisherSchema.properties.audio_review_exception=object({
  kind:{const:'owner_approved_existing_recording'},approval_sha256:hash,
  sentence_replay:{const:'unavailable'}
});
const check = createSchemaCheck(publisherSchema);
const legacyPublisherSchema=structuredClone(publisherSchema);
legacyPublisherSchema.definitions.lesson.properties.questions.maxItems=3;
const checkLegacy=createSchemaCheck(legacyPublisherSchema);
const fail = (code, issues=[]) => { const e=Error(code); e.code=code;e.issues=issues;throw e; };
const unique = values => new Set(values).size===values.length;
function jsonSnapshot(input) {
  let nodes=0;const active=new Set();
  const copy=(v,depth=0)=>{
    if(++nodes>20000||depth>24)fail('publisher_input_limit');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number'){if(!Number.isFinite(v))fail('invalid_publisher_json');return v;}
    if(typeof v==='string'){if(v.length>32768)fail('publisher_input_limit');return v;}
    if(!v||typeof v!=='object'||active.has(v)||Object.getOwnPropertySymbols(v).length)fail('invalid_publisher_json');
    const array=Array.isArray(v),descriptors=Object.getOwnPropertyDescriptors(v);
    if(array?Object.getPrototypeOf(v)!==Array.prototype:![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('invalid_publisher_json');
    active.add(v);
    let result;
    if(array){if(v.length>2000||Object.keys(descriptors).length!==v.length+1)fail('invalid_publisher_json');result=Array.from({length:v.length},(_,i)=>{const d=descriptors[i];if(!d||!Object.hasOwn(d,'value'))fail('invalid_publisher_json');return copy(d.value,depth+1);});}
    else result=Object.fromEntries(Object.entries(descriptors).map(([k,d])=>{if(['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('invalid_publisher_json');return[k,copy(d.value,depth+1)];}));
    active.delete(v);return result;
  };
  const result=copy(input);if(new TextEncoder().encode(JSON.stringify(result)).length>524288)fail('publisher_input_limit');return result;
}
export async function publisherDigest(pkg) {
  return contentDigest({format:pkg.format,lesson:pkg.lesson,assets:pkg.assets,rights:pkg.rights,
    ...(Object.hasOwn(pkg,'audio_review_exception')?{audio_review_exception:pkg.audio_review_exception}:{})});
}
// Pins contain no book text. The approval applies to these exact existing bytes
// and narrative, not to another recording, lesson, or a request-supplied waiver.
export function hasApprovedRecordingException(pkg) {
  const l=pkg?.lesson,e=pkg?.audio_review_exception;
  const a=pkg?.assets?.find(a=>a.id===l?.audio?.asset_id);
  return e?.kind==='owner_approved_existing_recording'&&e.sentence_replay==='unavailable'&&
    e.approval_sha256==='00476f0278bc1139ba0ab83b226ccaada02f25f9ec57afec04a39207f032ff00'&&
    l?.id==='osad-51fda697ea22c07a08f16b8f-s01'&&l.version==='1.2.9'&&l.source?.source_id===l.id&&
    l.source.kind==='user_supplied_publisher'&&
    l.story?.text_sha256==='9bd77b624cd14ab9e1b4278fe0d6f7dafbbaadebdd6bd309c0766efa10805f2a'&&
    l.audio?.script_sha256===l.story.text_sha256&&l.audio.status==='approved_exception'&&
    Array.isArray(l.audio.segments)&&l.audio.segments.length===0&&
    a?.kind==='audio'&&a.provenance==='supplied_recording'&&a.mime==='audio/mpeg'&&
    a.bytes===617073&&a.sha256==='633b0017f6485230a3ca833bbfa0d1e1205d621b07e895f5bfccdb6ce228c715';
}
export async function validatePublisherPackage(input) {
  const pkg=jsonSnapshot(input), schemaIssues=(pkg?.lesson?.interview?check:checkLegacy)(pkg);
  if(schemaIssues.length)fail('invalid_publisher_schema',schemaIssues);
  const l=pkg.lesson,issues=await levelIssues(l);
  const add=(ok,code)=>{if(!ok)issues.push(code);};
  const sentences=new Map(l.story.sentences.map(s=>[s.id,s.text_en]));
  const assets=new Map(pkg.assets.map(a=>[a.id,a]));
  add(unique(pkg.assets.map(a=>a.id)),'duplicate_asset_id');
  add(unique(l.illustrations.map(a=>a.id)),'duplicate_illustration_id');
  const ids=[l.id,l.source.source_id,l.source.collection_id,l.source.edition_id,l.source.book_id,...sentences.keys(),...assets.keys(),...l.questions.map(q=>q.id),...l.minny.turns.map(t=>t.id),l.independent_followup.id];
  add(ids.every(validId),'invalid_publisher_id');
  add(unique([...l.questions.map(q=>q.id),...l.minny.turns.map(t=>t.id),l.independent_followup.id]),'duplicate_item_id');
  add(l.source.predecessor_source_id===null||(validId(l.source.predecessor_source_id)&&l.source.predecessor_source_id!==l.source.source_id),'invalid_predecessor');
  add(unique(l.source.pdf_pages)&&l.source.pdf_pages.every((p,i,a)=>i===0||p>a[i-1]),'invalid_source_pages');
  const spans=[...l.minny.facts,...l.retell.essential_facts];
  if(l.picture_retell) {
    const p=l.picture_retell,a=assets.get(p.asset_id);
    add(isStoryInterview(l)&&l.source.kind==='user_supplied_publisher'&&
      /^osad-/.test(l.source.source_id)&&/^osad-collection-[123]$/.test(l.source.collection_id),'picture_retell_scope');
    add(a?.kind==='image','picture_retell_image_missing');
    add(p.frames.length===p.criteria.length&&unique(p.criteria.map(c=>c.id)),'picture_retell_scene_count');
    add(p.frames.every(f=>f.x+f.width<=a?.width&&f.y+f.height<=a?.height),'picture_retell_frame_bounds');
    add(p.criteria.every(c=>c.meaning.trim().length>0&&c.meaning.length<=500&&c.label_vi.trim().length>0&&c.label_vi.length<=120),'picture_retell_meaning_invalid');
    for(const c of p.criteria)spans.push(...c.evidence_spans);
  }
  for(const fact of l.retell.essential_facts)if(fact.accepted_meanings){
    const meanings=fact.accepted_meanings.map(s=>s.trim().toLowerCase());
    add(meanings.every(Boolean)&&fact.accepted_meanings.every(s=>s.length<=500)&&unique(meanings),'invalid_retell_meanings');
  }
  for(const q of l.questions){
    add(unique(q.options_en.map(s=>s.trim().toLowerCase())),'duplicate_options');
    add(JSON.stringify(q.distractors.map(d=>d.option_index).sort())===JSON.stringify([0,1,2].filter(i=>i!==q.correct_index)),'distractor_key_mismatch');
    add(q.source!=='story'||q.evidence_spans.length>0,'missing_story_evidence');spans.push(...q.evidence_spans);
  }
  add(spans.every(s=>sentences.get(s.sentence_id)===s.quote),'invalid_evidence_quote');
  if(isStoryInterview(l)) {
    add(l.questions.length===STORY_INTERVIEW_QUESTIONS,'interview_question_count');
    add(l.questions.every(q=>q.source==='story'&&['meaning','evidence'].includes(q.dimension)),'interview_story_questions_only');
    add(unique(l.questions.map(q=>q.prompt_en.trim().toLowerCase())),'duplicate_interview_prompt');
  } else {
    add(l.questions.length===3,'legacy_question_count');
    add(['meaning','evidence','transfer'].every(d=>l.questions.some(q=>q.dimension===d)),'missing_rubric_dimension');
  }
  add(l.shadowing.sentence_ids.every(s=>sentences.has(s)),'unknown_shadowing_sentence');
  add(l.minny.max_turns===l.minny.turns.length,'turn_budget_mismatch');
  add(l.independent_followup.version===l.version,'item_version_mismatch');
  add(unique(l.independent_followup.options_en.map(s=>s.trim().toLowerCase())),'duplicate_followup_options');
  add(l.minny.turns.every(t=>t.prompt_en!==l.independent_followup.prompt_en),'followup_exposed');
  for(const a of pkg.assets){
    const ext={'image/webp':'webp','image/png':'png','image/jpeg':'jpg','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg'}[a.mime];
    add(a.object_key===a.sha256+'.'+ext,'asset_locator_mismatch');
    add(a.kind==='image'?a.mime.startsWith('image/')&&a.width>0&&a.height>0&&a.width*a.height<=20000000&&a.duration_seconds===0:a.mime.startsWith('audio/')&&a.width===0&&a.height===0&&a.duration_seconds>0,'invalid_asset_dimensions');
    add(l.source.kind!=='synthetic_fixture'||a.provenance==='synthetic_fixture','mixed_fixture_provenance');
    if(a.provenance==='source_illustration')add(l.source.kind==='user_supplied_publisher'&&a.kind==='image'&&a.reference_hashes.includes(l.source.pdf_sha256),'invalid_source_illustration');
  }
  for(const picture of l.illustrations){add(assets.get(picture.asset_id)?.kind==='image','missing_image_asset');add(picture.sentence_ids.every(s=>sentences.has(s)),'unknown_scene_sentence');}
  const audio=assets.get(l.audio.asset_id);
  if(pkg.audio_review_exception||l.audio.status==='approved_exception'){
    add(hasApprovedRecordingException(pkg),'invalid_audio_review_exception');
    add(!pkg.reviews.some(r=>['audio_listening','audio_timing'].includes(r.kind)),'exception_cannot_claim_listening_or_timing');
  }
  add(l.audio.asset_id===null?l.audio.status==='missing'&&l.audio.segments.length===0:audio?.kind==='audio'&&l.audio.status!=='missing','invalid_audio_reference');
  add(unique(l.audio.segments.map(s=>s.id)),'duplicate_segment_id');
  for(const s of l.audio.segments){add(s.start_seconds<s.end_seconds&&s.end_seconds<=audio?.duration_seconds&&s.sentence_ids.every(id=>sentences.has(id))&&unique(s.sentence_ids),'invalid_audio_segment');}
  add(unique(pkg.rights.map(r=>r.id)),'duplicate_rights_id');
  for(const g of pkg.rights){add(g.source_id===l.source.source_id&&unique(g.actions)&&Number.isFinite(Date.parse(g.valid_from))&&Date.parse(g.valid_from)<Date.parse(g.valid_until),'invalid_rights_scope');}
  add(unique(pkg.reviews.map(r=>r.kind)),'duplicate_review');
  for(const r of pkg.reviews)add(Number.isFinite(Date.parse(r.reviewed_at)),'invalid_review_date');
  if(issues.length)fail('invalid_publisher_integrity',[...new Set(issues)]);
  return {package:pkg,package_sha256:await publisherDigest(pkg)};
}
export async function publisherReadiness(input,{now,assetProofs=[]}={}) {
  const {package:pkg,package_sha256}=await validatePublisherPackage(input);
  if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))fail('readiness_time_required');
  const l=pkg.lesson,blocked=[],reviews=new Map(pkg.reviews.map(r=>[r.kind,r]));
  const requireReview=(kind,method)=>{const r=reviews.get(kind);if(!r||r.package_sha256!==package_sha256||!['verified','approved'].includes(r.status)||Date.parse(r.reviewed_at)>Date.parse(now)||(method&&r.method!==method)||(['text','activities','visual','audio_match','audio_listening','audio_timing'].includes(kind)&&r.method==='automated'))blocked.push('review_'+kind);};
  const recordingException=hasApprovedRecordingException(pkg);
  for(const kind of ['text','activities','visual','audio_decode','audio_match','rights'])requireReview(kind);
  if(!recordingException)for(const kind of ['audio_listening','audio_timing'])requireReview(kind);
  for(const kind of ['human_teaching','human_art'])requireReview(kind,'human');
  if(l.source.kind==='user_supplied_publisher'&&pkg.assets.some(a=>a.provenance==='synthetic_fixture'))blocked.push('synthetic_assets_in_publisher');
  if(!l.illustrations.length)blocked.push('illustrations_missing');
  if(l.audio.asset_id===null||(l.audio.status!=='reviewed'&&!recordingException))blocked.push('audio_not_reviewed');
  if(!recordingException&&l.shadowing.sentence_ids.some(id=>!l.audio.segments.some(s=>s.sentence_ids.length===1&&s.sentence_ids[0]===id)))blocked.push('replay_segments_missing');
  if(l.review.author_check!=='complete')blocked.push('author_check_missing');
  // File proofs come from the private decoder/importer, never from child requests.
  for(const a of pkg.assets){const proof=assetProofs.filter(p=>p.id===a.id);if(proof.length!==1||proof[0].sha256!==a.sha256||proof[0].bytes!==a.bytes||proof[0].mime!==a.mime||proof[0].decoded!==true)blocked.push('asset_unverified:'+a.id);}
  const actions=['digital_text','activities','illustrations','stream_recording'];
  if(pkg.assets.some(a=>a.provenance==='new_authorized_narration'))actions.push('new_narration');
  if(pkg.assets.some(a=>a.reference_hashes.length||a.character_ids.length))actions.push('source_characters');
  if(l.pre_read.vocabulary.some(v=>v.meaning_vi.trim()))actions.push('translation');
  for(const action of actions)if(!pkg.rights.some(g=>g.status==='granted'&&g.actions.includes(action)&&Date.parse(g.valid_from)<=Date.parse(now)&&Date.parse(g.valid_until)>Date.parse(now)))blocked.push('rights_'+action);
  // A fixture must never increase the real-story count, even when all test grants pass.
  return {package_sha256,technical_ready:!blocked.some(b=>!b.startsWith('review_human_')),human_acceptance:!blocked.some(b=>b.startsWith('review_human_')),
    publication_ready:blocked.length===0,counts_toward_source_collection:l.source.kind==='user_supplied_publisher'&&blocked.length===0,
    blockers:blocked,production_release_authorized:false};
}
