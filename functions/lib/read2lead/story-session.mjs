import { STORY_MISSION_VERSION, STORY_REWARDS, STORY_INTERVIEW_VERSION, STORY_INTERVIEW_DIAMONDS, isStoryInterview } from '../../../src/lib/read2lead-story-mission.mjs';
import {pictureRetellFor} from './picture-retell.mjs';

export class StorySessionError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
const refuse = (code, status) => { throw new StorySessionError(code, status); };
export function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) refuse('invalid_fields');
}
export function storyIdentity(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) refuse('invalid_identity');
  return value;
}

/** Input is a validated, private publisher package, obtained only from the runtime. */
export function newStorySession(lesson, sessionId) {
  return { schemaVersion: STORY_MISSION_VERSION, sessionId, storyId: lesson.id,
    ...(isStoryInterview(lesson)?{interviewVersion:STORY_INTERVIEW_VERSION}:{}),
    contentVersion: lesson.version, sourceId: lesson.source.source_id, revision: 0,
    stage: 'read', readComplete: false, audioUsed: false, questionIndex: 0,
    answers: [], tries: 0, retelling: 'unassessed', retellSupport: 'none' };
}

/** Only tap answers are assessed here. Provider speech and rewards are fail-closed. */
export function advanceStorySession(lesson, current, event) {
  const state = structuredClone(current);
  const interview=isStoryInterview(lesson);
  if (state.storyId !== lesson.id || state.contentVersion !== lesson.version) refuse('content_changed', 409);
  if((state.interviewVersion||null)!==(interview?STORY_INTERVIEW_VERSION:null))refuse('content_changed',409);
  if(interview&&['answer','skip_question','retell_unassessed','reveal_retell_text','start_recall','cancel_recall','reveal_recall_text'].includes(event.type))refuse('interview_spoken_answers_required',409);
  if(state.stage==='retell'&&state.retellSupport===undefined) {
    state.retellSupport='text';
    if(state.lastVoice&&state.lastVoice.support!=='model')state.lastVoice.support='text';
  }
  if (state.voiceAwaitingContinue && !['continue_voice','reject_voice'].includes(event.type)) refuse('voice_feedback_pending',409);
  if(event.type==='reject_voice') {
    exactFields(event,['type']);
    if(!state.voiceAwaitingContinue || !state.lastVoice || !['understand','retell','recall'].includes(state.stage))refuse('voice_feedback_missing',409);
    // No answer has been committed until continue. Keep prior answers, help,
    // attempts and the durable voice audit/budget; only dismiss this feedback.
    state.voiceAwaitingContinue=false;
    delete state.lastVoice;
    state.revision++;
    return state;
  }
  if(event.type==='start_picture_retell') {
    exactFields(event,['type']);
    if(!pictureRetellFor(lesson)||!['reward','picture_retell'].includes(state.stage)||state.missionResult?.assessment?.status!=='complete')refuse('picture_retell_unavailable',409);
    state.stage='picture_retell';delete state.lastVoice;
    if(state.pictureRetellResult?.status!=='complete')delete state.pictureRetellResult;
  } else if(event.type==='reveal_retell_text') {
    exactFields(event,['type']);
    if(state.stage!=='retell')refuse('stage_conflict',409);
    state.retellSupport='text';
  } else if(['start_recall','cancel_recall','reveal_recall_text'].includes(event.type)) {
    exactFields(event,['type']);
    if(event.type==='start_recall') {
      if(state.stage!=='reward'||state.missionResult?.assessment?.status!=='complete')refuse('recall_not_completed',409);
      state.stage='recall';state.recallSupport=state.recallSupport||'picture';delete state.lastVoice;
    } else {
      if(state.stage!=='recall')refuse('stage_conflict',409);
      if(event.type==='cancel_recall')state.stage='reward';else state.recallSupport='text';
    }
  } else if(event.type==='retry_mission') {
    exactFields(event,['type']);
    if(state.stage!=='reward')refuse('stage_conflict',409);
    return {...newStorySession(lesson,state.sessionId),revision:state.revision+1,attempt:(state.attempt||0)+1,voiceSupport:state.voiceSupport||{},retellSupport:state.retellSupport??'text',recallSupport:state.recallSupport,recallResult:state.recallResult,...(state.pictureRetellResult?{pictureRetellResult:state.pictureRetellResult}:{})};
  } else if (event.type === 'continue_voice') {
    exactFields(event,['type']);
    if(!state.voiceAwaitingContinue || !state.lastVoice)refuse('voice_feedback_missing',409);
    state.voiceAwaitingContinue=false;
    const evidence=state.lastVoice.evidence;
    if(evidence?.reliability==='confirmed'&&(!state.lastVoice.intent||state.lastVoice.intent==='answer')) {
      const correct=evidence.matchedCriteria.length/evidence.totalCriteria>=0.5 && state.lastVoice.support!=='model';
      const answer={taskId:state.lastVoice.taskId,responseId:state.lastVoice.requestId,modality:'spoken',
        semantic:{reliability:evidence.reliability,matchedCriteria:evidence.matchedCriteria},
        support:state.lastVoice.support,assisted:state.lastVoice.support!=='none',result:correct?'demonstrated':'needs_practice'};
      if(state.stage==='recall')state.recallAnswer=answer;else state.answers.push(answer);
      if(state.stage==='understand') {
        // A hint or unsuccessful spoken answer leaves room to try it.
        // Moving on is the learner's existing explicit skip choice.
        if(!correct&&!interview)state.tries=1;
        else{state.questionIndex++;state.tries=0;}
        if(state.questionIndex===lesson.questions.length){state.stage=interview?'reward':'retell';state.retellSupport??='none';}
      } else if(state.stage==='retell') {
        state.retellTries=(state.retellTries||0)+1;state.retelling=correct?'demonstrated':'needs_practice';
        if(correct)state.stage='reward';
      }
    }
  } else if (event.type === 'audio_started') {
    exactFields(event, ['type']);
    if (!lesson.audio.asset_id) refuse('audio_unavailable', 409);
    state.audioUsed = true;
  } else if (event.type === 'read_complete') {
    exactFields(event, ['type']);
    if (state.stage !== 'read') refuse('stage_conflict', 409);
    state.readComplete = true; state.stage = 'understand';
  } else if (event.type === 'answer' || event.type === 'skip_question') {
    exactFields(event, event.type === 'answer' ? ['type', 'taskId', 'optionIndex'] : ['type', 'taskId']);
    const q = lesson.questions[state.questionIndex];
    if (state.stage !== 'understand' || !q || event.taskId !== q.id) refuse('stage_conflict', 409);
    let result = 'unassessed';
    if (event.type === 'answer') {
      if (!Number.isSafeInteger(event.optionIndex) || event.optionIndex < 0 || event.optionIndex >= q.options_en.length) refuse('invalid_option');
      result = event.optionIndex === q.correct_index ? 'demonstrated' : 'needs_practice';
    }
    const support=state.voiceSupport?.[q.id]||(state.tries>0?'hint':'none');
    if(support==='model'&&result==='demonstrated')result='needs_practice';
    const attempt = { taskId: q.id, result, modality: 'tap', support, assisted: support!=='none',
      ...(event.type === 'answer' ? { optionIndex: event.optionIndex } : {}) };
    state.answers.push(attempt);
    if (result === 'needs_practice' && state.tries === 0) state.tries = 1;
    else { state.questionIndex++; state.tries = 0; }
    if (state.questionIndex === lesson.questions.length) {state.stage = 'retell';state.retellSupport??='none';}
  } else if (event.type === 'retell_unassessed') {
    exactFields(event, ['type']);
    if (state.stage !== 'retell') refuse('stage_conflict', 409);
    state.retelling = 'unassessed'; state.stage = 'reward';
  } else refuse('unsupported_event');
  state.revision++;
  return state;
}

/** Explicit allow-list. Do not spread the publisher lesson or stored assessment. */
export function storySessionView(pkg, state, {voiceEnabled=false}={}) {
  const l = pkg.lesson;
  const pictureRetell=pictureRetellFor(l);
  const asset = id => pkg.assets.find(a => a.id === id);
  const url = a => a ? '/api/read2lead-story-media/' + a.object_key : null;
  const q = state.stage === 'understand' ? l.questions[state.questionIndex] : null;
  const audio = asset(l.audio.asset_id);
  const last = state.answers.at(-1);
  const hiddenRecall=state.stage==='recall'&&state.recallSupport!=='text';
  // Older retell sessions displayed the full text; never relabel them independent.
  const retellSupport=state.retellSupport??(state.stage==='retell'?'text':'none');
  const hiddenText=hiddenRecall||state.stage==='picture_retell'||(state.stage==='retell'&&retellSupport==='none');
  return { schemaVersion: STORY_MISSION_VERSION,
    session: { id: state.sessionId, revision: state.revision, stage: state.stage,
      readComplete: state.readComplete, audioUsed: state.audioUsed,
      answered: state.questionIndex, totalQuestions: l.questions.length,
      feedback: last ? { result: last.result, assisted: last.assisted, taskId: last.taskId } : null,
      retelling: state.retelling, retellSupport, complete: state.missionResult?.assessment?.status==='complete',
      awarded: state.missionResult?.award || {diamonds:0,xp:0},
      alreadyAwarded:state.missionResult?.duplicate===true,
      recall:{dueAt:state.missionResult?.recallDueAt||null,support:state.recallSupport||null,
        status:state.recallResult?.status||null,awarded:state.recallResult?.award||{diamonds:0,xp:0}},
      feedbackPending:state.voiceAwaitingContinue===true,
      ...(pictureRetell?{pictureRetell:state.pictureRetellResult||null}:{}),
      lastVoice:state.lastVoice?{requestId:state.lastVoice.requestId,taskId:state.lastVoice.taskId,
        transcript:state.lastVoice.transcript,reply:state.lastVoice.reply,
        assessed:state.lastVoice.evidence?.reliability==='confirmed'}:null },
    lesson: { id: l.id, version: l.version, title: l.title_en, level: l.level,
      attribution: l.source.attribution,
      sentences: hiddenText?[]:l.story.sentences.map(s => ({ id: s.id, text: s.text_en })),
      vocabulary: hiddenText?[]:l.pre_read.vocabulary.map(v => ({ word: v.word_en, meaning: v.meaning_vi })),
      illustrations: l.illustrations.map(i => ({ url: url(asset(i.asset_id)), alt: i.alt_en || l.title_en })).filter(i => i.url),
      audio: { url: hiddenText?null:url(audio), status: l.audio.status, timingVerified: ['timing_verified', 'reviewed'].includes(l.audio.status) },
      question: q ? { id: q.id, prompt: q.prompt_en, options: [...q.options_en], retry: state.tries > 0 } : null,
      retellPrompt: l.retell.prompt_en },
    policy: { privateDraft: true, testProgressOnly: true, providerEnabled: voiceEnabled===true,
      ...(isStoryInterview(l)?{interview:{version:STORY_INTERVIEW_VERSION,questionCount:l.questions.length,completionDiamonds:STORY_INTERVIEW_DIAMONDS}}:{}),
      ...(pictureRetell?{pictureRetell:{picture:pictureRetell.picture||url(asset(pictureRetell.assetId)),
        frames:pictureRetell.frames,sheetWidth:pictureRetell.sheetWidth||asset(pictureRetell.assetId)?.width,
        sheetHeight:pictureRetell.sheetHeight||asset(pictureRetell.assetId)?.height,
        maxSeconds:pictureRetell.maxSeconds,diamonds:200}}:{}),
      voiceReason: voiceEnabled ? null : 'approval_and_verification_pending', rewardTiers: isStoryInterview(l)?[]:STORY_REWARDS,
      rewardState: state.missionResult?.assessment?.status==='complete'?'test_award_recorded':'not_awarded', contentComplete: false } };
}
