import {
  STORY_MISSION_VERSION, STORY_REWARD_VERSION, STORY_RECALL_DIAMONDS,
  STORY_RECALL_DELAY_MS, storyRewardForScore,
  STORY_INTERVIEW_VERSION, STORY_INTERVIEW_QUESTIONS, STORY_INTERVIEW_DIAMONDS,
} from '../../../src/lib/read2lead-story-mission.mjs';

/**
 * Pure server policy, NOT an HTTP endpoint or an AI evaluator.
 * Inputs must be authenticated server-owned records, never browser JSON or raw
 * model replies. A future endpoint must validate the model's semantic judgments,
 * bind them to the saved response, and atomically persist ledger + balance.
 * Each learner has a separate ledger. Version-pinned attempts use stable story IDs.
 */
function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

function id(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value), 'Invalid identity');
  return value;
}

function ids(values) {
  requireValue(Array.isArray(values) && values.length > 0 && values.length <= 20, 'Invalid criteria');
  values.forEach(id);
  requireValue(new Set(values).size === values.length, 'Duplicate criteria');
}

function validateManifest(manifest) {
  requireValue(manifest?.schemaVersion === STORY_MISSION_VERSION, 'Unsupported mission version');
  id(manifest.storyId);
  id(manifest.contentVersion);
  const interview=manifest.interviewVersion===STORY_INTERVIEW_VERSION;
  requireValue(manifest.interviewVersion===undefined||interview,'Unsupported interview version');
  requireValue(Array.isArray(manifest.tasks) && (interview?manifest.tasks.length===STORY_INTERVIEW_QUESTIONS:
    manifest.tasks.length >= 2 && manifest.tasks.length <= 8), 'Invalid tasks');
  const taskIds = [];
  for (const task of manifest.tasks) {
    taskIds.push(id(task.id));
    requireValue(['understand', 'retell'].includes(task.kind), 'Invalid task kind');
    ids(task.criteria);
  }
  requireValue(new Set(taskIds).size === taskIds.length, 'Duplicate task');
  if(interview) {
    requireValue(manifest.tasks.every(task=>task.kind==='understand')&&!manifest.recallTask,'Invalid interview tasks');
    return;
  }
  requireValue(manifest.tasks.some((task) => task.kind === 'understand'), 'Missing comprehension');
  requireValue(manifest.tasks.filter((task) => task.kind === 'retell').length === 1, 'Require one retelling task');
  id(manifest.recallTask?.id);
  requireValue(!taskIds.includes(manifest.recallTask.id), 'Recall task must be distinct');
  ids(manifest.recallTask.criteria);
}

function validateEvidence(task, answer) {
  requireValue(answer && answer.taskId === task.id, 'Evidence task mismatch');
  id(answer.responseId);
  requireValue(['spoken', 'tap'].includes(answer.modality), 'Unsupported response modality');
  requireValue(['confirmed', 'uncertain'].includes(answer.reliability), 'Invalid evidence reliability');
  requireValue(['none', 'hint', 'picture', 'text', 'model'].includes(answer.support), 'Invalid support');
  requireValue(Array.isArray(answer.matchedCriteria), 'Missing semantic evidence');
  requireValue(new Set(answer.matchedCriteria).size === answer.matchedCriteria.length, 'Duplicate semantic evidence');
  requireValue(answer.matchedCriteria.every((criterion) => task.criteria.includes(criterion)), 'Unknown semantic evidence');
  requireValue(answer.reliability !== 'uncertain' || answer.matchedCriteria.length === 0, 'Uncertain evidence cannot claim matches');
}

export function assessStoryMission(manifest, attempt) {
  validateManifest(manifest);
  requireValue(attempt?.storyId === manifest.storyId && attempt.contentVersion === manifest.contentVersion, 'Story/version mismatch');
  requireValue(typeof attempt.readComplete === 'boolean', 'Invalid reading state');
  requireValue(Array.isArray(attempt.answers) && attempt.answers.length <= manifest.tasks.length, 'Invalid answers');
  const tasks = new Map(manifest.tasks.map((task) => [task.id, task]));
  const seen = new Set();
  const responses = new Set();
  for (const answer of attempt.answers) {
    requireValue(answer && tasks.has(answer.taskId) && !seen.has(answer.taskId), 'Unknown or repeated task');
    validateEvidence(tasks.get(answer.taskId), answer);
    requireValue(!responses.has(answer.responseId), 'Repeated response');
    seen.add(answer.taskId);
    responses.add(answer.responseId);
  }
  const empty = { grade: null, xp: 0, diamonds: 0 };
  if (!attempt.readComplete || seen.size !== tasks.size) {
    return { status: 'in_progress', reward: empty };
  }
  if (attempt.answers.some((answer) => answer.reliability === 'uncertain')) {
    return { status: 'retry_technical', reward: empty };
  }
  if(manifest.interviewVersion===STORY_INTERVIEW_VERSION) {
    if(attempt.answers.some(answer=>answer.modality!=='spoken'))return {status:'in_progress',reward:empty};
    const matched=attempt.answers.reduce((sum,a)=>sum+(a.support==='model'?0:a.matchedCriteria.length),0);
    const total=manifest.tasks.reduce((sum,t)=>sum+t.criteria.length,0);
    const scorePercent=100*matched/total;
    return {status:'complete',scorePercent,understandPercent:scorePercent,
      assisted:attempt.answers.some(a=>a.support!=='none'),
      spokenRetellingDemonstrated:false,independentSpokenRetelling:false,
      reward:{grade:null,xp:0,diamonds:STORY_INTERVIEW_DIAMONDS}};
  }
  const domains = { understand: { matched: 0, total: 0 }, retell: { matched: 0, total: 0 } };
  for (const task of manifest.tasks) {
    const answer = attempt.answers.find((entry) => entry.taskId === task.id);
    // Echoing a supplied model answer is practice, not evidence of understanding.
    domains[task.kind].matched += answer.support === 'model' ? 0 : answer.matchedCriteria.length;
    domains[task.kind].total += task.criteria.length;
  }
  const understandPercent = 100 * domains.understand.matched / domains.understand.total;
  const retellPercent = 100 * domains.retell.matched / domains.retell.total;
  // Equal domain weight prevents a large question bank from hiding no retelling.
  const scorePercent = (understandPercent + retellPercent) / 2;
  const complete = understandPercent >= 50 && retellPercent >= 50;
  const retelling = attempt.answers.find((answer) => tasks.get(answer.taskId).kind === 'retell');
  return {
    status: complete ? 'complete' : 'needs_practice',
    scorePercent,
    understandPercent,
    retellPercent,
    assisted: attempt.answers.some((answer) => answer.support !== 'none'),
    spokenRetellingDemonstrated: retellPercent >= 50 && retelling.modality === 'spoken',
    independentSpokenRetelling: retellPercent >= 50 && retelling.modality === 'spoken' && retelling.support === 'none',
    reward: complete ? storyRewardForScore(scorePercent) : empty,
  };
}

function validateTime(now) {
  requireValue(Number.isSafeInteger(now) && now >= 0, 'Invalid server time');
}

function validateLedger(ledger) {
  requireValue(ledger?.schemaVersion === STORY_REWARD_VERSION && Array.isArray(ledger.receipts), 'Invalid reward ledger');
  const keys = new Set();
  for (const receipt of ledger.receipts) {
    requireValue(receipt && ['completion', 'recall'].includes(receipt.kind), 'Invalid receipt');
    id(receipt.storyId);
    id(receipt.contentVersion);
    validateTime(receipt.awardedAt);
    requireValue(Number.isSafeInteger(receipt.diamonds) && receipt.diamonds > 0, 'Invalid receipt diamonds');
    requireValue(Number.isSafeInteger(receipt.xp) && receipt.xp >= 0, 'Invalid receipt XP');
    const key = `${receipt.kind}/${receipt.storyId}`;
    requireValue(!keys.has(key), 'Duplicate receipt');
    keys.add(key);
  }
}

export function emptyStoryRewardLedger() {
  return { schemaVersion: STORY_REWARD_VERSION, receipts: [] };
}

function award(ledger, manifest, kind, reward, now) {
  const receipt = { kind, storyId: manifest.storyId, contentVersion: manifest.contentVersion,
    awardedAt: now, xp: reward.xp, diamonds: reward.diamonds };
  return { ledger: { ...ledger, receipts: [...ledger.receipts, receipt] },
    award: { xp: receipt.xp, diamonds: receipt.diamonds }, receipt };
}

export function completeStoryMission(ledger, manifest, attempt, now) {
  validateLedger(ledger);
  validateTime(now);
  const assessment = assessStoryMission(manifest, attempt);
  const previous = ledger.receipts.find((receipt) => receipt.kind === 'completion' && receipt.storyId === manifest.storyId);
  if (previous || assessment.status !== 'complete') {
    return { ledger, assessment, duplicate: Boolean(previous), award: { xp: 0, diamonds: 0 } };
  }
  return { ...award(ledger, manifest, 'completion', assessment.reward, now), assessment, duplicate: false };
}

export function completeStoryRecall(ledger, manifest, attempt, now) {
  validateLedger(ledger);
  validateManifest(manifest);
  requireValue(!manifest.interviewVersion,'Interview has no recall reward');
  validateTime(now);
  requireValue(attempt?.storyId === manifest.storyId && attempt.contentVersion === manifest.contentVersion, 'Story/version mismatch');
  validateEvidence(manifest.recallTask, attempt.answer);
  const previous = ledger.receipts.find((receipt) => receipt.kind === 'recall' && receipt.storyId === manifest.storyId);
  const completed = ledger.receipts.find((receipt) => receipt.kind === 'completion' && receipt.storyId === manifest.storyId);
  let status = 'complete';
  if (previous) status = 'already_awarded';
  else if (!completed) status = 'not_completed';
  else if (now < completed.awardedAt + STORY_RECALL_DELAY_MS) status = 'not_due';
  else if (attempt.answer.reliability !== 'confirmed') status = 'retry_technical';
  else if (['text', 'model'].includes(attempt.answer.support)) status = 'practice_only';
  else if (attempt.answer.matchedCriteria.length / manifest.recallTask.criteria.length < 0.5) status = 'needs_practice';
  if (status !== 'complete') return { ledger, status, award: { xp: 0, diamonds: 0 } };
  return { ...award(ledger, manifest, 'recall', { xp: 0, diamonds: STORY_RECALL_DIAMONDS }, now), status,
    assisted: attempt.answer.support !== 'none' };
}
