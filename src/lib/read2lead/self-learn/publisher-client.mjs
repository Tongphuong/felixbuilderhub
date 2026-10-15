/** Oral form payloads. Missing choices are null; no written answers or inferred speech scores. */
export function publisherPayload({event,itemId,data,responseKind,captureStatus='not_attempted'}) {
  const choice=data.get('choice'),skip=responseKind==='skipped';
  const hasChoice=!skip&&choice!==null&&choice!=='';
  const response_kind=skip?'skipped':hasChoice?'tap':'spoken';
  if(event==='prediction')return{text:'',response_kind:skip?'skipped':'spoken'};
  const speech={text:'',capture_status:captureStatus,support_used:event==='shadow_complete'?['reference_script']:[],response_kind};
  if(['answer','repair_answer','followup_answer'].includes(event))return{...speech,item_id:itemId,choice_index:hasChoice?Number(choice):null,...(event==='answer'?{evidence_sentence_ids:skip?[]:data.getAll('evidence')}: {})};
  if(event==='minny_turn')return{...speech,turn_id:itemId};
  return speech;
}
export const isPublisherLesson=lesson=>lesson?.response_mode?.kind==='read_speak';
export function filterPublisherCards(lessons,{query='',collection='',month=''}={}) {
  const needle=query.normalize('NFKC').toLocaleLowerCase('en').trim();
  return lessons.filter(l=>(!needle||l.title_en.normalize('NFKC').toLocaleLowerCase('en').includes(needle))&&(!collection||String(l.source?.collection_level)===collection)&&(!month||String(l.source?.month)===month));
}
