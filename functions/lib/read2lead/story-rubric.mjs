import { STORY_MISSION_VERSION, STORY_INTERVIEW_VERSION, isStoryInterview } from '../../../src/lib/read2lead-story-mission.mjs';
import { exactFields, StorySessionError } from './story-session.mjs';
import {pictureRetellFor} from './picture-retell.mjs';

export const STORY_RETELL_TASK = 'mission-retell';
export const STORY_RECALL_TASK = 'mission-recall';
/** Server-only adapter from an immutable, runtime-validated publisher package. */
export function storyRubric(lesson) {
  if (lesson.questions.some(q=>[STORY_RETELL_TASK,'mission-recall'].includes(q.id))) throw Error('rubric_id_conflict');
  const tasks=lesson.questions.map(q=>({id:q.id,kind:'understand',source:q.source,prompt:q.prompt_en,
    criteria:[{id:'meaning',meaning:isStoryInterview(lesson)?q.accepted_meanings[0]:q.accepted_meanings.join(' / '),
      ...(isStoryInterview(lesson)?{acceptedMeanings:[...q.accepted_meanings]}:{})}]}));
  if(isStoryInterview(lesson))return {tasks,recallTask:null,manifest:{schemaVersion:STORY_MISSION_VERSION,
    interviewVersion:STORY_INTERVIEW_VERSION,storyId:lesson.source.source_id,contentVersion:lesson.version,
    tasks:tasks.map(t=>({id:t.id,kind:t.kind,criteria:t.criteria.map(c=>c.id)}))}};
  const factMeaning=f=>f.accepted_meanings?.length?f.accepted_meanings[0]:f.quote;
  const retellCriteria=lesson.retell.essential_facts.map((f,i)=>({id:'fact-'+(i+1),meaning:factMeaning(f),
    ...(f.accepted_meanings?.length?{acceptedMeanings:[...f.accepted_meanings]}:{})}));
  if(lesson.retell.dimensions.includes('order_causality')) {
    // The authored dimensions are part of the pinned lesson, not optional
    // assessor advice. Keep fact IDs stable and derive order from the source,
    // rather than trusting the editorial order of essential_facts.
    const orderedFacts=[...lesson.retell.essential_facts].sort((a,b)=>
      lesson.story.sentences.findIndex(s=>s.id===a.sentence_id)-lesson.story.sentences.findIndex(s=>s.id===b.sentence_id));
    retellCriteria.push({id:'order-causality',meaning:
      'Retell the main events in a coherent order and preserve the cause-and-effect relationships explicitly stated in the story. '+
      'Credit this criterion only when all essential facts in this retelling are demonstrated. '+
      (orderedFacts.some(f=>f.accepted_meanings?.length)?'For each event, any one alternative in its acceptedMeanings is sufficient; never require all alternatives. ':'')+
      'Relevant events in story order: '+orderedFacts.map(factMeaning).join(' ')+' '+
      'Do not require exact wording, first/next/last labels, perfect grammar, or causes the story does not state.'});
  }
  // Intelligibility is evidence reliability; support_used is support metadata.
  // Neither is an extra point for fluent speech or for receiving less help.
  tasks.push({id:STORY_RETELL_TASK,kind:'retell',source:'story',prompt:lesson.retell.prompt_en,
    acceptedParaphrases:[...lesson.retell.accepted_paraphrases],
    criteria:retellCriteria});
  if(!tasks.at(-1).criteria.length || tasks.at(-1).criteria.length>20)throw Error('invalid_retell_rubric');
  const recallTask={...tasks.at(-1),id:STORY_RECALL_TASK,kind:'recall'};
  return {tasks,recallTask,manifest:{schemaVersion:STORY_MISSION_VERSION,storyId:lesson.source.source_id,contentVersion:lesson.version,
    tasks:tasks.map(t=>({id:t.id,kind:t.kind,criteria:t.criteria.map(c=>c.id)})),
    recallTask:{id:STORY_RECALL_TASK,criteria:recallTask.criteria.map(c=>c.id)}}};
}
export function activeStoryVoiceTask(lesson,state) {
  if(state.stage==='picture_retell') {
    const task=pictureRetellFor(lesson);
    if(!task||state.missionResult?.assessment?.status!=='complete'||state.voiceAwaitingContinue)throw new StorySessionError('voice_stage_conflict',409);
    return task;
  }
  const id=state.stage==='understand'?lesson.questions[state.questionIndex]?.id:state.stage==='retell'?STORY_RETELL_TASK:null;
  const rubric=storyRubric(lesson);
  const task=state.stage==='recall'?rubric.recallTask:rubric.tasks.find(t=>t.id===id);
  if(!task || state.voiceAwaitingContinue)throw new StorySessionError('voice_stage_conflict',409);
  return {...task,previousTurn:state.lastVoice?.taskId===task.id?{transcript:state.lastVoice.transcript,reply:state.lastVoice.reply}:null};
}

/** Schema/evidence validation, NOT proof of semantic accuracy. Only activate a
 * calibrated assessor. Literal transcript quotes prevent fabricated evidence. */
export function validateStoryJudgment(raw,task,transcript) {
  const value=typeof raw==='string'?JSON.parse(raw):raw;
  exactFields(value,['reliability','criteria','replySupport',...('intent' in value?['intent']:[])]);
  if('intent' in value&&!['answer','story_question','help'].includes(value.intent))throw Error('invalid_semantic_judgment');
  if(!['confirmed','uncertain'].includes(value.reliability)||!['none','hint','model'].includes(value.replySupport)||
      !Array.isArray(value.criteria)||value.criteria.length!==task.criteria.length)throw Error('invalid_semantic_judgment');
  const seen=new Set(),matches=[];
  for(const c of value.criteria){
    exactFields(c,['id','met','quote']);
    if(!task.criteria.some(t=>t.id===c.id)||seen.has(c.id)||typeof c.met!=='boolean'||typeof c.quote!=='string'||c.quote.length>500)throw Error('invalid_semantic_judgment');
    seen.add(c.id);
    if(c.met){if(value.reliability==='uncertain'||!c.quote.trim()||!transcript.includes(c.quote))throw Error('unsupported_semantic_evidence');matches.push(c.id);}
    else if(c.quote!=='')throw Error('unexpected_semantic_evidence');
  }
  // A complete causal sequence cannot be credited when the same judgment says
  // an essential event/fact is absent. Keep supported partial facts; never fill
  // the missing evidence from the story or the proposed Minny reply.
  const missingFact=task.criteria.some(c=>/^fact-\d+$/.test(c.id)&&!matches.includes(c.id));
  return {reliability:value.reliability,
    matchedCriteria:value.intent&&value.intent!=='answer'?[]:missingFact?matches.filter(id=>id!=='order-causality'):matches,
    replySupport:value.replySupport,...(value.intent?{intent:value.intent}:{})};
}

/** Help during learning does not invalidate a later independent recall. */
export function storyDiscussionTasks(lesson,task) {
  const rubric=storyRubric(lesson);
  return task.id===STORY_RECALL_TASK?[rubric.recallTask]:rubric.tasks;
}
export function validateStoryDiscussionSupport(value,lesson,task) {
  const tasks=storyDiscussionTasks(lesson,task),seen=new Set();
  if(!Array.isArray(value)||value.length!==tasks.length)throw Error('invalid_discussion_support');
  for(const entry of value) {
    exactFields(entry,['taskId','support']);
    if(!tasks.some(t=>t.id===entry.taskId)||seen.has(entry.taskId)||!['none','hint','model'].includes(entry.support))throw Error('invalid_discussion_support');
    seen.add(entry.taskId);
  }
  return value.map(entry=>({...entry}));
}

/** Derive evidence from saved state. Missing/skipped tasks remain uncertain. */
export function savedStoryAttempt(lesson,state) {
  const {manifest}=storyRubric(lesson);
  return {manifest,attempt:{storyId:manifest.storyId,contentVersion:manifest.contentVersion,readComplete:state.readComplete,
    answers:manifest.tasks.map(task=>{
      const answer=state.answers.findLast(a=>a.taskId===task.id);
      if(answer?.semantic)return {taskId:task.id,responseId:answer.responseId,modality:'spoken',support:answer.support,
        reliability:answer.semantic.reliability,matchedCriteria:[...answer.semantic.matchedCriteria]};
      return {taskId:task.id,responseId:task.id+':tap',modality:'tap',support:answer?.support||(answer?.assisted?'hint':'none'),
        reliability:answer&&answer.result!=='unassessed'?'confirmed':'uncertain',
        matchedCriteria:answer?.result==='demonstrated'?['meaning']:[]};
    })}};
}
