import { STORY_RECALL_DELAY_MS } from '../../../src/lib/read2lead-story-mission.mjs';
import { newStorySession, advanceStorySession, StorySessionError } from './story-session.mjs';
import { completeStoryMission, completeStoryRecall, emptyStoryRewardLedger } from './story-assessment.mjs';
import { activeStoryVoiceTask, savedStoryAttempt, storyRubric, validateStoryDiscussionSupport } from './story-rubric.mjs';
import {pictureRetellResult,PICTURE_RETELL_DIAMONDS} from './picture-retell.mjs';

/** Shared private-preview transactions; never connects to production wallets. */
export class StorySqlStore {
  constructor(db,{now=()=>Date.now(),transaction,uuid=()=>crypto.randomUUID()}={}) {
    if(typeof transaction!=='function')throw Error('story_transaction_required');
    this.db=db;this.now=now;this.runTransaction=transaction;this.uuid=uuid;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS story_picture_rewards (owner TEXT NOT NULL, source TEXT NOT NULL,
        receipt TEXT NOT NULL, PRIMARY KEY(owner,source));
      CREATE TABLE IF NOT EXISTS story_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL,
        story TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(owner,story,version));
      CREATE TABLE IF NOT EXISTS story_events (session TEXT NOT NULL, request_id TEXT NOT NULL,
        request TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(session,request_id));
      CREATE TABLE IF NOT EXISTS story_test_wallets (owner TEXT PRIMARY KEY, diamonds INTEGER NOT NULL,
        xp INTEGER NOT NULL, ledger TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS story_assessed_progress (session TEXT PRIMARY KEY, evidence TEXT NOT NULL,
        assessment TEXT NOT NULL, assessed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS story_recall_assessments (session TEXT PRIMARY KEY, evidence TEXT NOT NULL, assessment TEXT NOT NULL, assessed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS story_attempt_history (session TEXT NOT NULL, attempt INTEGER NOT NULL,
        state TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY(session,attempt));
      CREATE TABLE IF NOT EXISTS story_speech_turns (session TEXT NOT NULL, request TEXT NOT NULL,
        revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, result TEXT, PRIMARY KEY(session,request));
      CREATE TABLE IF NOT EXISTS story_prompt_audio (session TEXT NOT NULL, task TEXT NOT NULL,
        prompt TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, result TEXT, PRIMARY KEY(session,task));`);
  }
  transaction(fn) {return this.runTransaction(fn);}

  beginPrompt(owner,lesson,input,enabled) {
    return this.transaction(()=>{
      const state=this.get(owner,input.sessionId);
      if(state.revision!==input.revision)throw new StorySessionError('revision_conflict',409);
      const task=activeStoryVoiceTask(lesson,state);
      if(task.kind==='picture_retell')throw new StorySessionError('picture_retell_has_no_prompt_audio',409);
      const row=this.db.prepare('SELECT * FROM story_prompt_audio WHERE session=? AND task=?').get(input.sessionId,task.id);
      if(row) {
        if(row.prompt!==task.prompt)throw new StorySessionError('story_prompt_changed',409);
        if(row.status==='done')return {replayed:true,task,audio:JSON.parse(row.result)};
        if(row.status==='pending'&&this.now()-row.started_at<120000)throw new StorySessionError('voice_busy',409);
        if(row.request===input.requestId)throw new StorySessionError('voice_request_failed',409);
      }
      if(!enabled)throw new StorySessionError('story_voice_not_authorized',503);
      this.db.prepare(`INSERT INTO story_prompt_audio VALUES(?,?,?,?,?,?,NULL)
        ON CONFLICT(session,task) DO UPDATE SET request=excluded.request,status=excluded.status,started_at=excluded.started_at,result=NULL`)
        .run(input.sessionId,task.id,task.prompt,input.requestId,'pending',this.now());
      return {replayed:false,task};
    });
  }
  finishPrompt(owner,lesson,input,audio) {
    return this.transaction(()=>{
      const state=this.get(owner,input.sessionId),task=activeStoryVoiceTask(lesson,state);
      const row=this.db.prepare('SELECT * FROM story_prompt_audio WHERE session=? AND task=?').get(input.sessionId,task.id);
      if(state.revision!==input.revision||row?.request!==input.requestId||row.status!=='pending'||
        row.prompt!==task.prompt||this.now()-row.started_at>120000)throw new StorySessionError('stale_voice_result',409);
      this.db.prepare("UPDATE story_prompt_audio SET status='done',result=? WHERE session=? AND task=?")
        .run(JSON.stringify(audio),input.sessionId,task.id);
    });
  }
  failPrompt(owner,input) {
    this.get(owner,input.sessionId);
    this.db.prepare("UPDATE story_prompt_audio SET status='failed' WHERE session=? AND request=? AND status='pending'")
      .run(input.sessionId,input.requestId);
  }

  open(owner, lesson) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT state FROM story_sessions WHERE owner=? AND story=? AND version=?').get(owner, lesson.id, lesson.version);
      if (row) {const state=JSON.parse(row.state);this.profileStateSink?.({owner,state,lesson});return state;}
      const state = newStorySession(lesson, this.uuid());
      this.db.prepare('INSERT INTO story_sessions VALUES(?,?,?,?,?)').run(state.sessionId, owner, lesson.id, lesson.version, JSON.stringify(state));
      this.profileStateSink?.({owner,state,lesson});
      return state;
    });
  }
  get(owner, id) {
    const row = this.db.prepare('SELECT state FROM story_sessions WHERE owner=? AND id=?').get(owner, id);
    if (!row) throw new StorySessionError('session_not_found', 404);
    return JSON.parse(row.state);
  }
  event(owner, lesson, input) {
    return this.transaction(() => {
      const current = this.get(owner, input.sessionId);
      const request = JSON.stringify([input.revision, input.event]);
      const old = this.db.prepare('SELECT request,response FROM story_events WHERE session=? AND request_id=?').get(input.sessionId, input.requestId);
      if (old) {
        if (old.request !== request) throw new StorySessionError('request_id_conflict', 409);
        // Return current state: a delayed replay must never rewind the UI.
        return { state: current, replayed: true };
      }
      if (current.revision !== input.revision) throw new StorySessionError('revision_conflict', 409);
      this.expireVoice(input.sessionId);
      if(this.db.prepare("SELECT request FROM story_speech_turns WHERE session=? AND status='pending'").get(input.sessionId))throw new StorySessionError('voice_busy',409);
      if(input.event.type==='start_recall') {
        const row=this.db.prepare('SELECT ledger FROM story_test_wallets WHERE owner=?').get(owner);
        const receipts=row?JSON.parse(row.ledger).receipts:[];
        const completion=receipts.find(r=>r.kind==='completion'&&r.storyId===current.sourceId);
        if(!completion)throw new StorySessionError('recall_not_completed',409);
        if(receipts.some(r=>r.kind==='recall'&&r.storyId===current.sourceId))throw new StorySessionError('recall_already_awarded',409);
        if(this.now()<completion.awardedAt+STORY_RECALL_DELAY_MS)throw new StorySessionError('recall_not_due',409);
      }
      const state = advanceStorySession(lesson, current, input.event);
      if(input.event.type==='retry_mission')this.db.prepare('INSERT INTO story_attempt_history VALUES(?,?,?,?)').run(input.sessionId,current.attempt||0,JSON.stringify(current),this.now());
      this.db.prepare('UPDATE story_sessions SET state=? WHERE id=? AND owner=?').run(JSON.stringify(state), input.sessionId, owner);
      if(input.event.type==='continue_voice'&&current.stage==='recall'&&state.recallAnswer&&state.lastVoice?.evidence) {
        state.recallResult=this._commitTrustedRecall(owner,lesson,state,this.now());
        if(['complete','already_awarded'].includes(state.recallResult.status))state.stage='reward';
        delete state.recallAnswer;
        this.db.prepare('UPDATE story_sessions SET state=? WHERE id=? AND owner=?').run(JSON.stringify(state),input.sessionId,owner);
      }
      if(input.event.type==='continue_voice' && current.stage!=='recall' && state.stage==='reward' && state.lastVoice?.evidence) {
        const {manifest,attempt}=savedStoryAttempt(lesson,state);
        state.missionResult=this._commitTrustedAssessment(owner,input.sessionId,manifest,attempt,this.now());
        this.db.prepare('UPDATE story_sessions SET state=? WHERE id=? AND owner=?').run(JSON.stringify(state),input.sessionId,owner);
      }
      this.profileStateSink?.({owner,state,lesson});
      this.db.prepare('INSERT INTO story_events VALUES(?,?,?,?)').run(input.sessionId, input.requestId, request, JSON.stringify(state));
      return { state, replayed: false };
    });
  }
  expireVoice(sessionId) {
    this.db.prepare("UPDATE story_speech_turns SET status='failed' WHERE session=? AND status='pending' AND started_at<?").run(sessionId,this.now()-120000);
  }
  beginVoice(owner,lesson,input,fingerprint) {
    return this.transaction(()=>{
      const state=this.get(owner,input.sessionId);
      this.expireVoice(input.sessionId);
      const old=this.db.prepare('SELECT * FROM story_speech_turns WHERE session=? AND request=?').get(input.sessionId,input.requestId);
      if(old){
        if(old.fingerprint!==fingerprint || old.revision!==input.revision)throw new StorySessionError('request_id_conflict',409);
        if(old.status==='done')return {replayed:true,result:JSON.parse(old.result),state};
        throw new StorySessionError(old.status==='pending'?'voice_busy':'voice_request_failed',409);
      }
      if(state.revision!==input.revision)throw new StorySessionError('revision_conflict',409);
      if(this.db.prepare("SELECT request FROM story_speech_turns WHERE session=? AND status='pending'").get(input.sessionId))throw new StorySessionError('voice_busy',409);
      const task=activeStoryVoiceTask(lesson,state);
      this.db.prepare('INSERT INTO story_speech_turns VALUES(?,?,?,?,?,?,?,NULL)').run(input.sessionId,input.requestId,input.revision,fingerprint,task.id,'pending',this.now());
      return {replayed:false,state,task};
    });
  }
  finishVoice(owner,lesson,input,result) {
    return this.transaction(()=>{
      const state=this.get(owner,input.sessionId);
      const row=this.db.prepare('SELECT * FROM story_speech_turns WHERE session=? AND request=?').get(input.sessionId,input.requestId);
      if(!row || row.status!=='pending' || row.revision!==state.revision || this.now()-row.started_at>120000)throw new StorySessionError('stale_voice_result',409);
      const task=activeStoryVoiceTask(lesson,state);
      if(task.id!==row.task)throw new StorySessionError('stale_voice_task',409);
      if(task.kind==='picture_retell') {
        const summary=pictureRetellResult(task,result.assessment==='server_validated'?result.judgment:null,result.pronunciation);
        let award={diamonds:0,xp:0},duplicate=false;
        if(summary.status==='complete') {
          const old=this.db.prepare('SELECT * FROM story_test_wallets WHERE owner=?').get(owner);
          if(!old||!JSON.parse(old.ledger).receipts.some(r=>r.kind==='completion'&&r.storyId===state.sourceId))throw new StorySessionError('picture_retell_interview_required',409);
          duplicate=!!this.db.prepare('SELECT receipt FROM story_picture_rewards WHERE owner=? AND source=?').get(owner,state.sourceId);
          if(!duplicate) {
            award={diamonds:PICTURE_RETELL_DIAMONDS,xp:0};
            const diamonds=old.diamonds+award.diamonds;
            if(!Number.isSafeInteger(diamonds))throw Error('test_wallet_overflow');
            const receipt={kind:'picture_retell',storyId:state.sourceId,contentVersion:state.contentVersion,diamonds:award.diamonds,awardedAt:this.now()};
            this.db.prepare('INSERT INTO story_picture_rewards VALUES(?,?,?)').run(owner,state.sourceId,JSON.stringify(receipt));
            this.db.prepare('UPDATE story_test_wallets SET diamonds=? WHERE owner=?').run(diamonds,owner);
            this.profileRewardSink?.({owner,state,result:{receipt,duplicate:false,award},now:this.now()});
          }
        }
        state.pictureRetellResult={...summary,award,alreadyAwarded:duplicate,requestId:input.requestId};
        state.revision++;
        this.db.prepare('UPDATE story_sessions SET state=? WHERE id=? AND owner=?').run(JSON.stringify(state),input.sessionId,owner);
        this.db.prepare("UPDATE story_speech_turns SET status='done',result=? WHERE session=? AND request=?").run(JSON.stringify(result),input.sessionId,input.requestId);
        this.profileStateSink?.({owner,state,lesson});
        return state;
      }
      const priorSupport=state.voiceSupport?.[task.id];
      const retellSupport=priorSupport==='model'?'model':(state.retellSupport??'text')==='text'?'text':priorSupport||'none';
      state.lastVoice={requestId:input.requestId,taskId:task.id,transcript:result.transcript,reply:result.reply,
        ...(result.judgment?.intent?{intent:result.judgment.intent}:{}),
        support:state.stage==='recall'?(state.recallSupport==='text'?'text':state.voiceSupport?.[task.id]||state.recallSupport||'picture'):state.stage==='retell'?retellSupport:state.voiceSupport?.[task.id] || (state.tries>0?'hint':'none'),
        evidence:result.assessment==='server_validated'&&result.judgment&&(!result.judgment.intent||result.judgment.intent==='answer')?{reliability:result.judgment.reliability,matchedCriteria:result.judgment.matchedCriteria,totalCriteria:task.criteria.length}:null};
      // Help already heard remains available on later attempts. A neutral
      // reply cannot erase a supplied answer, including after reject/retry.
      // lastVoice above describes help BEFORE this reply, so a correct first
      // answer is not penalized by the feedback Minny gives afterwards.
      const previousSupport=state.voiceSupport?.[task.id]||'none';
      const replySupport=result.judgment?.replySupport||'model';
      const support=previousSupport==='model'||replySupport==='model'?'model'
        :previousSupport==='hint'||replySupport==='hint'?'hint':'none';
      state.voiceSupport={...state.voiceSupport,[task.id]:support};
      if(result.judgment?.taskSupport) {
        for(const entry of validateStoryDiscussionSupport(result.judgment.taskSupport,lesson,task)) {
          const prior=state.voiceSupport[entry.taskId]||'none';
          state.voiceSupport[entry.taskId]=prior==='model'||entry.support==='model'?'model':prior==='hint'||entry.support==='hint'?'hint':'none';
        }
      }
      state.voiceAwaitingContinue=true;state.revision++;
      this.db.prepare('UPDATE story_sessions SET state=? WHERE id=? AND owner=?').run(JSON.stringify(state),input.sessionId,owner);
      this.db.prepare("UPDATE story_speech_turns SET status='done',result=? WHERE session=? AND request=?").run(JSON.stringify(result),input.sessionId,input.requestId);
      this.profileStateSink?.({owner,state,lesson});
      return state;
    });
  }
  failVoice(owner,sessionId,requestId,failure={}) {
    this.get(owner,sessionId);
    const phase=['transcription','reply','safety','assessment','synthesis','persistence','budget'].includes(failure.phase)?failure.phase:null;
    this.db.prepare("UPDATE story_speech_turns SET status='failed',result=? WHERE session=? AND request=? AND status='pending'").run(JSON.stringify({failure:{code:'voice_request_failed',phase,at:this.now()}}),sessionId,requestId);
  }
  voiceResult(owner,sessionId,requestId) {
    this.get(owner,sessionId);
    const row=this.db.prepare('SELECT status,result FROM story_speech_turns WHERE session=? AND request=?').get(sessionId,requestId);
    if(row?.status==='failed'){
      const phase=row.result?JSON.parse(row.result).failure?.phase:null;
      throw Object.assign(new StorySessionError('voice_request_failed',409),{storyVoicePhase:phase});
    }
    if(!row || row.status!=='done')throw new StorySessionError('voice_result_unavailable',409);
    return JSON.parse(row.result);
  }
  /** ONLY calibrated server evidence may call this; no public HTTP route exposes
   * it. Separate private test wallets never mutate existing learner balances.
   * The immutable publisher source ID, not its lesson/version ID, owns awards. */
  commitTrustedAssessment(owner, sessionId, manifest, attempt, now) {
    return this.transaction(() => this._commitTrustedAssessment(owner,sessionId,manifest,attempt,now));
  }
  _commitTrustedAssessment(owner,sessionId,manifest,attempt,now) {
      const state=this.get(owner,sessionId);
      if(!state.readComplete || !['retell','reward'].includes(state.stage) ||
          manifest.storyId!==state.sourceId || manifest.contentVersion!==state.contentVersion ||
          (manifest.interviewVersion||null)!==(state.interviewVersion||null) ||
          attempt.readComplete!==state.readComplete)throw new StorySessionError('assessment_session_mismatch',409);
      const old=this.db.prepare('SELECT * FROM story_test_wallets WHERE owner=?').get(owner);
      const ledger=old?JSON.parse(old.ledger):emptyStoryRewardLedger();
      const result=completeStoryMission(ledger,manifest,attempt,now);
      const diamonds=(old?.diamonds||0)+result.award.diamonds,xp=(old?.xp||0)+result.award.xp;
      if(!Number.isSafeInteger(diamonds)||!Number.isSafeInteger(xp))throw Error('test_wallet_overflow');
      this.db.prepare('INSERT INTO story_test_wallets VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET diamonds=excluded.diamonds,xp=excluded.xp,ledger=excluded.ledger')
        .run(owner,diamonds,xp,JSON.stringify(result.ledger));
      this.db.prepare('INSERT INTO story_assessed_progress VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET evidence=excluded.evidence,assessment=excluded.assessment,assessed_at=excluded.assessed_at')
        .run(sessionId,JSON.stringify({manifest,attempt}),JSON.stringify(result.assessment),now);
      const profileBalance=this.profileRewardSink?.({owner,state,manifest,attempt,result,now});
      const completion=result.ledger.receipts.find(r=>r.kind==='completion'&&r.storyId===state.sourceId);
      return {recallDueAt:completion&&!manifest.interviewVersion?completion.awardedAt+STORY_RECALL_DELAY_MS:null,assessment:result.assessment,duplicate:result.duplicate,award:result.award,testBalance:{diamonds,xp},
        ...(profileBalance?{profileBalance}:{})};
  }
  _commitTrustedRecall(owner,lesson,state,now) {
    if(state.stage!=='recall'||!state.recallAnswer?.semantic)throw new StorySessionError('recall_evidence_missing',409);
    const {manifest}=storyRubric(lesson),answer=state.recallAnswer;
    const attempt={storyId:state.sourceId,contentVersion:state.contentVersion,answer:{taskId:answer.taskId,
      responseId:answer.responseId,modality:'spoken',support:answer.support,
      reliability:answer.semantic.reliability,matchedCriteria:answer.semantic.matchedCriteria}};
    const old=this.db.prepare('SELECT * FROM story_test_wallets WHERE owner=?').get(owner);
    const result=completeStoryRecall(old?JSON.parse(old.ledger):emptyStoryRewardLedger(),manifest,attempt,now);
    const diamonds=(old?.diamonds||0)+result.award.diamonds,xp=old?.xp||0;
    if(!Number.isSafeInteger(diamonds))throw Error('test_wallet_overflow');
    this.db.prepare('INSERT INTO story_test_wallets VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET diamonds=excluded.diamonds,xp=excluded.xp,ledger=excluded.ledger').run(owner,diamonds,xp,JSON.stringify(result.ledger));
    this.db.prepare('INSERT INTO story_recall_assessments VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET evidence=excluded.evidence,assessment=excluded.assessment,assessed_at=excluded.assessed_at').run(state.sessionId,JSON.stringify({manifest,attempt}),JSON.stringify({status:result.status,award:result.award}),now);
    const profileBalance=this.profileRewardSink?.({owner,state,result,now});
    return {status:result.status,award:result.award,...(profileBalance?{profileBalance}:{})};
  }
  close() { this.db.close?.(); }
}
