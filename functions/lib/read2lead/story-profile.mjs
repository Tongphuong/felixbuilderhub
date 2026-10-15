import { recordLearningReceipt } from './learning-stars.mjs';
import { normalizeProgressState, applyPackCompletion, awardRankPoints } from '../../api/_read2lead-v2-state.js';
import { pictureRetellFor } from './picture-retell.mjs';
import { safeStoryAssessment } from './parent-summary.mjs';

/** Called synchronously INSIDE the story receipt transaction. No browser route.
 * Uses the private host's same SQL account store, so a receipt/profile failure
 * rolls back the complete operation. Production migration is not implied.
 */
export function connectStoryProfileRewards(store, storage = null) {
  if(store.profileRewardSink)throw Error('story_profile_already_connected');
  const db=store.db;
  // Trusted host injection only. The default private host keeps its test-only
  // account restriction; business/reward rules below are shared unchanged.
  const {get,put,assertAccount,assertPack}=storage||{
    get:key=>{const row=db.prepare('SELECT value FROM private_site_kv WHERE key=?').get(key);return row?JSON.parse(row.value):null;},
    put:(key,value)=>db.prepare('INSERT INTO private_site_kv VALUES(?,?,NULL) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)),
    assertAccount:account=>{if(account?.is_test!==true)throw Error('private_story_profile_required');},
    assertPack:()=>{},
  };
  if([get,put,assertAccount,assertPack].some(fn=>typeof fn!=='function'))throw Error('story_profile_storage_required');
  store.profileStateSink=({owner,state,lesson})=>{
    const account=get(owner);assertAccount(account);
    const current=account.progress?.current_pack;
    const pack=[current,...Object.values(account.story_pack_history||{})].find(p=>p?.story_reference?.id===state.storyId&&p.story_reference.version===state.contentVersion);
    if(!pack||pack.story_reference.source_id!==state.sourceId)throw Error('story_profile_assignment_mismatch');
    assertPack(pack,account);
    const complete=state.missionResult?.assessment?.status==='complete'||pack.story_complete===true;
    const projection={id:state.sessionId,revision:state.revision,stage:state.stage,complete,
      question_count:state.answers?.length||0,
      question_total:lesson?.questions?.length||null,
      assessment_summary:safeStoryAssessment(state),
      picture_retell_complete:state.pictureRetellResult?.status==='complete'};
    const pictureRequired = lesson ? Boolean(pictureRetellFor(lesson)) : pack.picture_retell_required === true;
    if(JSON.stringify(pack.story_session)===JSON.stringify(projection)&&pack.picture_retell_required===pictureRequired)return;
    const next={...pack,story_session:projection,picture_retell_required:pictureRequired};
    if(pack.review_only&&complete&&(!pictureRequired||projection.picture_retell_complete))next.status='reviewed_pass_web_v2';
    put(owner,{...account,progress:{...account.progress,current_pack:current?.pack_id===pack.pack_id?next:current},
      story_pack_history:{...(account.story_pack_history||{}),[pack.pack_id]:next}});
  };
  store.profileRewardSink=({owner,state,result,now})=>{
    if(!result.receipt||result.duplicate)return null;
    const account=get(owner);
    assertAccount(account);
    const current=account.progress?.current_pack;
    const pack=[current,...Object.values(account.story_pack_history||{})].find(p=>p?.story_reference?.id===state.storyId&&p.story_reference.version===state.contentVersion);
    if(!pack||pack.story_reference.source_id!==state.sourceId)throw Error('story_profile_assignment_mismatch');
    assertPack(pack,account);
    const completedAt=new Date(now).toISOString();
    const profile=normalizeProgressState(get('progress:'+owner),{accessCode:owner,codeData:account,nowIso:completedAt});
    if(['recall','picture_retell'].includes(result.receipt.kind)) {
      const diamonds=profile.diamonds+result.award.diamonds;
      if(!Number.isSafeInteger(diamonds)||result.award.xp!==0)throw Error('story_recall_profile_invalid');
      put('progress:'+owner,{...profile,diamonds,updated_at:completedAt,
        learning_receipts:recordLearningReceipt(profile.learning_receipts,{source:'story:'+state.sourceId,kind:result.receipt.kind==='picture_retell'?'story_retell':'story_recall',at:completedAt,diamonds:result.award.diamonds})});
      return {diamonds,xp:profile.total_xp};
    }
    if(result.assessment?.status!=='complete')throw Error('story_profile_assessment_invalid');
    const applied=applyPackCompletion(profile,{packId:'story:'+state.sourceId,completedAt,
      learningSource:'story:'+state.sourceId,learningKind:'story_questions',
      rewardsEarned:result.award,scorePercent:result.assessment.scorePercent});
    if(applied.already_counted)throw Error('story_profile_receipt_mismatch');
    const next=awardRankPoints(applied.state,{scorePercent:result.assessment.scorePercent,nowIso:completedAt}).state;
    if(!Number.isSafeInteger(next.diamonds)||!Number.isSafeInteger(next.total_xp))throw Error('story_profile_overflow');
    const finished={...pack,status:'reviewed_pass_web_v2',story_complete:true,completed_at:completedAt};
    const entry={pack_id:pack.pack_id,story_id:state.storyId,story_source_id:state.sourceId,
      story_complete:true,story_title:pack.story_title,level:pack.level,reviewed_at:completedAt,
      score_percent:result.assessment.scorePercent,grade:result.assessment.reward.grade,
      rewards_earned:result.award,assisted:result.assessment.assisted,
      spoken_retelling:result.assessment.spokenRetellingDemonstrated};
    const nextAccount={...account,progress:{...account.progress,
      current_pack:current?.pack_id===pack.pack_id?finished:current,
      current_level:next.current_level,completed_packs:next.completed_packs,
      review_history:[entry,...(account.progress?.review_history||[])]},
      story_pack_history:{...(account.story_pack_history||{}),[pack.pack_id]:finished}};
    put('progress:'+owner,{...next,updated_at:completedAt});put(owner,nextAccount);
    return {diamonds:next.diamonds,xp:next.total_xp};
  };
}
