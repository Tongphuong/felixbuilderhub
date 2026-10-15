/** Allowlisted publisher views. Caller still owns identity, withdrawal and route authorization. */
import {validatePublisherPackage,publisherReadiness} from './publisher-contract.mjs';
import {contentDigest} from './catalogue.mjs';
import {publicCheckpoint} from './views.mjs';
import {publisherPracticeSummary} from './publisher-journey.mjs';

async function usablePackage(input,{mode,now,assetProofs=[]}={}) {
  const {package:pkg,package_sha256}=await validatePublisherPackage(input);
  if(mode==='synthetic-local') {
    if(pkg.lesson.source.kind!=='synthetic_fixture') throw Error('synthetic_publisher_only');
  } else if(mode==='approved-local') {
    const readiness=await publisherReadiness(pkg,{now,assetProofs});
    if(!readiness.publication_ready) throw Error('publisher_not_ready');
  } else if(mode==='private-rehearsal') {
    // Explicit server-only adult rehearsal, never publication or human acceptance.
    if(pkg.lesson.source.kind!=='user_supplied_publisher') throw Error('private_publisher_only');
  } else throw Error('publisher_view_mode_required');
  return{pkg,package_sha256};
}
const verified=(a,proofs)=>a&&proofs.filter(p=>p.id===a.id&&p.sha256===a.sha256&&p.bytes===a.bytes&&p.mime===a.mime&&p.decoded===true).length===1;
function lessonView(pkg,proofs) {
  const l=pkg.lesson,assets=new Map(pkg.assets.map(a=>[a.id,a]));
  const route=a=>'/api/read2lead/self-learn/media/'+a.object_key;
  const audio=assets.get(l.audio.asset_id),playable=verified(audio,proofs)&&['playable','matched','timing_verified','reviewed'].includes(l.audio.status);
  const timing=playable&&['timing_verified','reviewed'].includes(l.audio.status);
  return{id:l.id,version:l.version,level:l.level,level_label_vi:l.level_label_vi,title_en:l.title_en,theme:l.theme,rubric_version:l.rubric_version,practice_only:true,
    response_mode:{kind:'read_speak',typing_allowed:false,tap_choices:'optional',capture_required:false},
    source:{kind:l.source.kind,attribution:l.source.attribution,source_id:l.source.source_id,collection_id:l.source.collection_id,collection_level:l.source.collection_level,book_id:l.source.book_id,month:l.source.month,story_number:l.source.story_number,predecessor_source_id:l.source.predecessor_source_id},
    input:{order:l.input.order,break_after_sentence_ids:[...l.input.break_after_sentence_ids]},
    pre_read:{prediction_en:l.pre_read.prediction_en,vocabulary:l.pre_read.vocabulary.map(v=>({word_en:v.word_en,meaning_vi:v.meaning_vi}))},
    story:{sentences:l.story.sentences.map(s=>({id:s.id,text_en:s.text_en})),text_sha256:l.story.text_sha256},
    illustrations:l.illustrations.filter(i=>verified(assets.get(i.asset_id),proofs)).map(i=>({id:i.id,kind:'raster',url:route(assets.get(i.asset_id)),width:assets.get(i.asset_id).width,height:assets.get(i.asset_id).height,alt_en:i.alt_en,sentence_ids:[...i.sentence_ids]})),
    audio:{available:!!playable,status:l.audio.status,content_version:l.audio.content_version,script_sha256:l.audio.script_sha256,url:playable?route(audio):null,duration_seconds:playable?audio.duration_seconds:0,timing_verified:!!timing,segments:timing?l.audio.segments.map(s=>({id:s.id,sentence_ids:[...s.sentence_ids],start_seconds:s.start_seconds,end_seconds:s.end_seconds})):[]},
    questions:l.questions.map(q=>({id:q.id,version:q.version,kind:q.kind,dimension:q.dimension,prompt_en:q.prompt_en,options_en:[...q.options_en],evidence_requested:q.evidence_spans.length>0,support_available:true})),
    shadowing:{sentence_ids:[...l.shadowing.sentence_ids],mode:l.shadowing.mode,capture_optional:true},
    minny:{max_turns:l.minny.max_turns,turns:l.minny.turns.map(t=>({id:t.id,prompt_en:t.prompt_en}))},
    retell:{prompt_en:l.retell.prompt_en,support_form:l.retell.support_form},
    policy:{practice_only:true,automatic_promotion:false,real_rewards:false,open_response_scoring:'pending_validated_assessor'}};
}
export async function publicPublisherLesson(input,options={}) {
  ({input,options}=structuredClone({input,options}));
  const{pkg}=await usablePackage(input,options);return rehearsalLabel(lessonView(pkg,options.assetProofs||[]),options);
}
function rehearsalLabel(view,options){
  if(options.mode==='private-rehearsal')view.policy={...view.policy,private_rehearsal:true,publication_ready:false,human_accepted:false};
  return view;
}
export async function publisherSessionView(record,input,options={}) {
  // Snapshot before asynchronous verification, including the caller's record and proof array.
  const snapshot=structuredClone({record,input,options});({record,input,options}=snapshot);
  const{pkg,package_sha256}=await usablePackage(input,options),l=pkg.lesson;
  if(record.session.schema_version!=='1.3.0'||record.publisher_package_sha256!==package_sha256||await contentDigest(l)!==record.session.content_sha256||await contentDigest(record.lesson)!==record.session.content_sha256) throw Error('publisher_session_content_mismatch');
  const s=record.session,repair=l.misconception_repair,follow=l.independent_followup;
  return{session:{...publicCheckpoint(s),input_audio_used:s.input_audio_used===true,repair_state:s.repair_state,followup_state:s.followup_state},lesson:rehearsalLabel(lessonView(pkg,options.assetProofs||[]),options),summary:publisherPracticeSummary(record),retell_received:record.retell_received,
    support:record.support.map(item=>{const q=l.questions.find(q=>q.id===item.item_id);return{item_id:item.item_id,kind:item.kind,
      text_en:item.kind==='revealing_hint'?'Read this part again.':item.kind==='frame'?'Use these words to begin.':'You used support for this response.',
      frame_en:item.kind==='frame'?{L0:'… does …',L1:'First … Next … Finally …',L2:'At first … Then … because … In the end …',L3:'Problem … Attempt … Outcome … Evidence …',L4:'From this viewpoint … Compared with … The story shows …',L5:'My claim … My evidence … My reason … An alternative … What I still need to know …'}[l.level]:null,
      sentences:item.kind==='revealing_hint'&&q?q.evidence_spans.map(e=>({id:e.sentence_id,text_en:e.quote})):item.kind==='reference_script'?l.story.sentences.filter(s=>l.shadowing.sentence_ids.includes(s.id)).map(s=>({id:s.id,text_en:s.text_en})):[]};}),
    learning_steps:{repair:{state:s.repair_state,prompt:['shown','answered'].includes(s.repair_state)?{id:repair.id,hint_en:repair.hint_en,prompt_en:repair.fresh_prompt_en,options_en:[...repair.options_en],practice_only:true}:null},
      followup:{state:s.followup_state,prompt:record.retell_received?{id:follow.id,prompt_en:follow.prompt_en,options_en:[...follow.options_en]}:null}}};
}
