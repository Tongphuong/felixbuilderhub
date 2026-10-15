import test from 'node:test';
import assert from 'node:assert/strict';
import lessons from './fixtures/read2lead-self-learn/level-lessons.json' with {type:'json'};
import {validatePublisherPackage,publisherReadiness,publisherDigest,hasApprovedRecordingException} from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {contentDigest} from '../functions/lib/read2lead/self-learn/catalogue.mjs';
import {validateEditorLesson} from '../functions/lib/read2lead/self-learn/editor-policy.mjs';

const NOW='2026-09-20T12:00:00.000Z', SHA='a'.repeat(64);
function fixture(){
 const l=structuredClone(lessons.lessons.find(l=>l.level==='L1'));
 l.response_mode={kind:'read_speak',typing_allowed:false,tap_choices:'optional',capture_required:false};
 l.version='1.2.1';l.questions.forEach(q=>q.version=l.version);l.independent_followup.version=l.version;
 l.source={kind:'synthetic_fixture',source_id:'synthetic-story-01',collection_id:'synthetic-collection-1',collection_level:1,edition_id:'synthetic-edition',book_id:'synthetic-january',month:1,story_number:1,title_as_printed:l.title_en,pdf_sha256:SHA,pdf_pages:[6,7],printed_pages:['2','3'],attribution:'Synthetic contract test, not One Story a Day',predecessor_source_id:null};
 l.pre_read.prediction_en='What might happen?';delete l.pre_read.prediction_vi;
 l.misconception_repair.hint_en='Read the story again.';delete l.misconception_repair.hint_vi;
 l.illustrations=[{id:'synthetic-scene',kind:'raster',asset_id:'synthetic-image',alt_en:'Synthetic test scene',sentence_ids:[l.story.sentences[0].id]}];
 l.audio={content_version:l.version,script_en:l.audio.script_en,script_sha256:l.audio.script_sha256,asset_id:'synthetic-audio',voice_version:'synthetic-voice',status:'reviewed',segments:l.shadowing.sentence_ids.map((s,i)=>({id:'segment-'+i,sentence_ids:[s],start_seconds:i*2,end_seconds:i*2+1}))};
 const makeAsset=(kind)=>({id:'synthetic-'+kind,kind:kind==='image'?'image':'audio',sha256:SHA,bytes:123,mime:kind==='image'?'image/png':'audio/mpeg',object_key:SHA+(kind==='image'?'.png':'.mp3'),width:kind==='image'?800:0,height:kind==='image'?600:0,duration_seconds:kind==='image'?0:30,provenance:'synthetic_fixture',reference_hashes:[],character_ids:[],alt_en:'Synthetic test asset'});
 return {format:'r2l-publisher-package/1',lesson:l,assets:[makeAsset('image'),makeAsset('audio')],rights:[{id:'synthetic-grant',source_id:l.source.source_id,document_sha256:SHA,actions:['digital_text','activities','stream_recording','illustrations','translation'],valid_from:'2026-01-01T00:00:00.000Z',valid_until:'2027-01-01T00:00:00.000Z',status:'granted',territory:'synthetic only',platform:'Read2Lead',reviewer:'synthetic-reviewer'}],reviews:[]};
}
async function reviewed(){const p=fixture(),digest=await publisherDigest(p);for(const kind of ['text','activities','visual','audio_decode','audio_match','audio_listening','audio_timing','rights','human_teaching','human_art'])p.reviews.push({kind,package_sha256:digest,status:'verified',reviewer:'synthetic-reviewer',method:kind.startsWith('human_')?'human':'codex_editorial',evidence_ref:'synthetic-only-'+kind,reviewed_at:'2026-09-20T10:00:00.000Z'});return p;}
const proofs=p=>p.assets.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes,mime:a.mime,decoded:true}));
const ready=p=>publisherReadiness(p,{now:NOW,assetProofs:proofs(p)});
test('separate publisher contract validates and old original-only contract remains strict',async()=>{const p=fixture();const r=await validatePublisherPackage(p);assert.equal(r.package.lesson.source.kind,'synthetic_fixture');await assert.rejects(validateEditorLesson({mode:'synthetic-local',lesson:p.lesson}),/invalid_editor_draft/);});
test('retell meanings are optional reviewed metadata; exact evidence and other spans stay strict',async()=>{
 const p=fixture(),fact=p.lesson.retell.essential_facts[0],quote=fact.quote;
 const before=await publisherDigest(p);fact.accepted_meanings=['A reviewed equivalent meaning.'];
 const result=await validatePublisherPackage(p);assert.equal(result.package.lesson.retell.essential_facts[0].quote,quote);assert.notEqual(await publisherDigest(p),before);
 for(const meanings of [[],[' '],['same',' SAME '],['x'.repeat(501)],Array(9).fill('x')]){
  const bad=structuredClone(p);bad.lesson.retell.essential_facts[0].accepted_meanings=meanings;await assert.rejects(validatePublisherPackage(bad));
 }
 const invented=structuredClone(p);invented.lesson.retell.essential_facts[0].quote='Invented source quote';await assert.rejects(validatePublisherPackage(invented),e=>e.issues?.includes('invalid_evidence_quote'));
 const otherSpan=structuredClone(p);otherSpan.lesson.minny.facts[0].accepted_meanings=['Unrelated'];await assert.rejects(validatePublisherPackage(otherSpan),/invalid_publisher_schema/);
 const extra=structuredClone(p);extra.lesson.retell.essential_facts[0].score=100;await assert.rejects(validatePublisherPackage(extra),/invalid_publisher_schema/);
});
test('complete synthetic controls never count as real stories or production release',async()=>{const r=await ready(await reviewed());assert.deepEqual(r.blockers,[]);assert.equal(r.publication_ready,true);assert.equal(r.counts_toward_source_collection,false);assert.equal(r.production_release_authorized,false);});
test('missing media is an importable private draft, never a complete lesson',async()=>{const p=fixture();p.lesson.illustrations=[];p.lesson.audio.asset_id=null;p.lesson.audio.status='missing';p.lesson.audio.segments=[];p.assets=[];const r=await ready(p);assert.equal(r.publication_ready,false);assert.ok(r.blockers.includes('audio_not_reviewed'));assert.ok(r.blockers.includes('illustrations_missing'));});
test('ordinary text or media correction invalidates every prior review',async()=>{const p=await reviewed();p.lesson.title_en+=' corrected';const r=await ready(p);assert.ok(r.blockers.includes('review_text'));assert.ok(r.blockers.includes('review_audio_timing'));assert.equal(r.publication_ready,false);});
test('human acceptance cannot be replaced by automated or Codex checks',async()=>{const p=await reviewed();p.reviews.find(r=>r.kind==='human_teaching').method='codex_editorial';const r=await ready(p);assert.equal(r.technical_ready,true);assert.equal(r.human_acceptance,false);assert.equal(r.publication_ready,false);});
test('expired and revoked grants block their exact required actions',async()=>{for(const status of ['revoked','granted']){const p=await reviewed();p.rights[0].status=status;if(status==='granted')p.rights[0].valid_until='2026-09-19T00:00:00.000Z';assert.ok((await ready(p)).blockers.includes('rights_stream_recording'));}});
test('unverified and corrupt file proofs cannot masquerade as uploaded assets',async()=>{const p=await reviewed();const evidence=proofs(p);evidence[0].sha256='b'.repeat(64);const r=await publisherReadiness(p,{now:NOW,assetProofs:evidence});assert.ok(r.blockers.includes('asset_unverified:synthetic-image'));});
for(const [name,mutate,issue] of [
 ['wrong evidence',p=>p.lesson.questions[0].evidence_spans[0].quote='Invented source fact','invalid_evidence_quote'],
 ['wrong source pages',p=>p.lesson.source.pdf_pages=[7,6],'invalid_source_pages'],
 ['negative timing',p=>p.lesson.audio.segments[0].end_seconds=0,'invalid_audio_segment'],
 ['past audio duration',p=>p.lesson.audio.segments[0].end_seconds=100,'invalid_audio_segment'],
 ['unknown replay sentence',p=>p.lesson.audio.segments[0].sentence_ids=['missing'],'invalid_audio_segment'],
 ['asset hash-path mismatch',p=>p.assets[0].sha256='b'.repeat(64),'asset_locator_mismatch'],
 ['same source prerequisite',p=>p.lesson.source.predecessor_source_id=p.lesson.source.source_id,'invalid_predecessor'],
 ['duplicate assets',p=>p.assets.push(structuredClone(p.assets[0])),'duplicate_asset_id'],
 ['hidden source level relabel',p=>p.lesson.level='L5','level_reasoning'],
 ['wrong recording script',p=>p.lesson.audio.script_en='Unrelated narration','audio_text_mismatch']]){
 test(name+' refused',async()=>{const p=fixture();mutate(p);await assert.rejects(validatePublisherPackage(p),e=>e.code==='invalid_publisher_integrity'&&e.issues.includes(issue));});
}
test('private extra fields and executable URLs fail closed',async()=>{for(const mutate of [p=>p.lesson.source.secret='private',p=>p.assets[0].object_key='https://evil.test/x.png']){const p=fixture();mutate(p);await assert.rejects(validatePublisherPackage(p),/invalid_publisher_schema/);}});
test('accessors are rejected without execution',async()=>{let calls=0;const p=fixture();Object.defineProperty(p,'evil',{enumerable:true,get(){calls++;return'bad';}});await assert.rejects(validatePublisherPackage(p),/invalid_publisher_json/);assert.equal(calls,0);});
test('missing replay and future reviews block readiness',async()=>{const p=await reviewed();p.lesson.audio.segments=[];p.reviews[0].reviewed_at='2030-01-01T00:00:00.000Z';const r=await ready(p);assert.ok(r.blockers.includes('replay_segments_missing'));assert.ok(r.blockers.includes('review_text'));});

test('automatic OCR or decoding cannot attest editorial fidelity or actual listening',async()=>{for(const kind of ['text','activities','visual','audio_match','audio_listening','audio_timing']){const p=await reviewed();p.reviews.find(r=>r.kind===kind).method='automated';assert.ok((await ready(p)).blockers.includes('review_'+kind));}});

test('publisher activities require oral mode with optional taps and no forced microphone',async()=>{for(const change of [p=>delete p.lesson.response_mode,p=>p.lesson.response_mode.typing_allowed=true,p=>p.lesson.response_mode.tap_choices='required',p=>p.lesson.response_mode.capture_required=true,p=>p.lesson.questions.push(structuredClone(p.lesson.questions[0]))]){const p=fixture();change(p);await assert.rejects(validatePublisherPackage(p),/invalid_publisher_schema/);}});

test('source illustrations retain their PDF reference and do not imply rights or art approval',async()=>{
 const p=fixture();p.lesson.source.kind='user_supplied_publisher';p.assets[0].provenance='source_illustration';p.assets[0].reference_hashes=[p.lesson.source.pdf_sha256];p.assets[1].provenance='supplied_recording';p.rights=[];
 await validatePublisherPackage(p);const readiness=await ready(p);assert.equal(readiness.publication_ready,false);assert.ok(readiness.blockers.includes('rights_illustrations'));assert.ok(readiness.blockers.includes('review_visual'));
 for(const mutate of [x=>x.assets[0].reference_hashes=[],x=>x.assets[0].reference_hashes=['b'.repeat(64)],x=>x.assets[1].provenance='source_illustration']){const bad=structuredClone(p);mutate(bad);await assert.rejects(validatePublisherPackage(bad),e=>e.issues?.includes('invalid_source_illustration'));}
});

const exceptionRecord=()=>({kind:'owner_approved_existing_recording',approval_sha256:'00476f0278bc1139ba0ab83b226ccaada02f25f9ec57afec04a39207f032ff00',sentence_replay:'unavailable'});
// Identity-only unit fixture, intentionally not a valid publisher package. The
// real private package is separately exercised without publishing its book text.
function exceptionIdentity(){
 const storyHash='9bd77b624cd14ab9e1b4278fe0d6f7dafbbaadebdd6bd309c0766efa10805f2a';
 const id='osad-51fda697ea22c07a08f16b8f-s01';
 return {audio_review_exception:exceptionRecord(),lesson:{id,version:'1.2.9',source:{source_id:id,kind:'user_supplied_publisher'},
  story:{text_sha256:storyHash},audio:{asset_id:'recording',script_sha256:storyHash,status:'approved_exception',segments:[]}},
  assets:[{id:'recording',kind:'audio',provenance:'supplied_recording',mime:'audio/mpeg',bytes:617073,
   sha256:'633b0017f6485230a3ca833bbfa0d1e1205d621b07e895f5bfccdb6ce228c715'}]};
}
test('owner exception pins exact identity, content and recording; it is not package approval',async()=>{
 const p=exceptionIdentity();assert.equal(hasApprovedRecordingException(p),true);
 await assert.rejects(validatePublisherPackage(p),/invalid_publisher_schema/);
 for(const change of [
  p=>delete p.audio_review_exception,p=>p.audio_review_exception.approval_sha256=SHA,
  p=>p.audio_review_exception.kind='generic_waiver',p=>p.audio_review_exception.sentence_replay='available',
  p=>p.lesson.id='another-story',p=>p.lesson.version='1.2.10',p=>p.lesson.source.source_id='another-source',
  p=>p.lesson.source.kind='synthetic_fixture',p=>p.lesson.story.text_sha256=SHA,
  p=>p.lesson.audio.script_sha256=SHA,p=>p.lesson.audio.status='reviewed',
  p=>p.lesson.audio.segments=[{id:'invented'}],p=>p.lesson.audio.asset_id='missing',
  p=>p.assets[0].sha256=SHA,p=>p.assets[0].bytes++,p=>p.assets[0].mime='audio/wav',
  p=>p.assets[0].provenance='new_authorized_narration',p=>p.assets[0].kind='image'
 ]){const bad=structuredClone(p);change(bad);assert.equal(hasApprovedRecordingException(bad),false);}
});
test('exception metadata is optional for old digests but bound in new package digests',async()=>{
 const p=await reviewed();const before=await publisherDigest(p);
 assert.equal(before,await contentDigest({format:p.format,lesson:p.lesson,assets:p.assets,rights:p.rights}));
 p.audio_review_exception=exceptionRecord();assert.notEqual(await publisherDigest(p),before);
 p.audio_review_exception.approval_sha256=SHA;const altered=await publisherDigest(p);
 p.audio_review_exception=exceptionRecord();assert.notEqual(await publisherDigest(p),altered);
});
test('exception cannot promote another package or relabel its audio review',async()=>{
 for(const change of [p=>p.audio_review_exception=exceptionRecord(),p=>p.lesson.audio.status='approved_exception',
  p=>{p.audio_review_exception=exceptionRecord();p.lesson.audio.status='approved_exception';p.lesson.audio.segments=[];}]){
  const p=await reviewed();change(p);
  await assert.rejects(publisherReadiness(p,{now:NOW,assetProofs:proofs(p)}),e=>e.issues?.includes('invalid_audio_review_exception'));
 }
});
