import {
  ACTIVE_LESSON_ACTIVITY_TYPES,
  evaluateSpeakingGate,
  extractV2LessonContext,
  isBookLessonContext,
  scoreActivityResults,
  submitV2Lesson,
} from './submit-read2lead-lesson.js';
import { PASS_THRESHOLD_PERCENT } from './_read2lead-v2-state.js';

// Remediation for packs stranded by the 1502dd6 submit bug (2026-06-27 →
// 2026-07-08) and the old manual-save funnel: a kid finished every activity
// but the pack stayed awaiting_review. Reconciliation runs when their record
// is read (dashboard, new-pack gate) and finishes the save for them — using
// only the kid's OWN recorded work, never invented data.
//
// It commits nothing unless the outcome is a genuine completion: a passive
// read must never penalize, strip a checkpoint, or record a failed attempt.

function normalizeActivityResults(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return list.filter((result) => result && typeof result === 'object' && result.type);
}

function candidateSources(currentPack) {
  const sources = [];
  const snapshot = currentPack?.web_session_checkpoint?.snapshot;
  const fromCheckpoint = normalizeActivityResults(snapshot?.activity_results);
  if (fromCheckpoint.length) {
    sources.push({ origin: 'checkpoint', activityResults: fromCheckpoint });
  }
  const attempts = Array.isArray(currentPack?.web_attempts) ? currentPack.web_attempts : [];
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const fromAttempt = normalizeActivityResults(attempts[i]?.activity_results);
    if (fromAttempt.length) {
      sources.push({ origin: 'web_attempt', activityResults: fromAttempt });
      break;
    }
  }
  return sources;
}

function wouldComplete(activityResults, lessonContext) {
  const expectedTypes = (Array.isArray(lessonContext.activities) ? lessonContext.activities : [])
    .map((activity) => activity?.type)
    .filter((type) => ACTIVE_LESSON_ACTIVITY_TYPES.has(type));
  if (!expectedTypes.length) return false;
  const completedTypes = new Set(
    activityResults
      .filter((result) => result.attempted !== false)
      .map((result) => result.type),
  );
  const allAttempted = expectedTypes.every((type) => completedTypes.has(type));
  if (!allAttempted) return false;
  const gate = evaluateSpeakingGate(activityResults, expectedTypes);
  if (gate.skipped) return true; // completed_without_reward
  const score = scoreActivityResults(activityResults, lessonContext);
  return gate.passed && score.score_percent >= PASS_THRESHOLD_PERCENT;
}

/**
 * Finalize a finished-but-stranded standard pack using the kid's own data.
 * Returns { reconciled, codeData } where codeData is re-read from KV after a
 * successful reconcile (callers should build responses from it).
 */
export async function reconcileStrandedPack({ env, accessCode, codeData }) {
  const unchanged = { reconciled: false, codeData };
  try {
    const currentPack = codeData?.progress?.current_pack;
    if (!currentPack || currentPack.status !== 'awaiting_review') return unchanged;

    const lessonContext = extractV2LessonContext(currentPack);
    if (!lessonContext || isBookLessonContext(lessonContext)) return unchanged;

    const source = candidateSources(currentPack)
      .find((candidate) => wouldComplete(candidate.activityResults, lessonContext));
    if (!source) return unchanged;

    const response = await submitV2Lesson({
      accessCode,
      codeData,
      currentPack,
      env,
      lessonContext,
      progress: codeData.progress,
      submittedAnswers: {
        schema_version: 2,
        activity_results: source.activityResults,
      },
    });
    const payload = await response.json();
    const completed = Boolean(
      payload?.ok && (payload.passed || payload.completed_without_reward || payload.already_completed),
    );
    if (!completed) return unchanged;

    const freshData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
    return { reconciled: true, codeData: freshData || codeData };
  } catch {
    // Reconciliation is best-effort; the read that triggered it must succeed.
    return unchanged;
  }
}
