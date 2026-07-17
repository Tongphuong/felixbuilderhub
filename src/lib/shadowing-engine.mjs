/**
 * Pure, DOM-free session state machine for the Shadowing page. No DOM, no
 * timers, no network — the page drives it entirely through events and reads
 * the returned state to render. Grading itself lives in shadowing-score.mjs
 * (imported only for PASS_PERCENT) and, ultimately, the server's Whisper
 * endpoint — this module only decides what step comes next and keeps score.
 *
 * createShadowingSession(video, savedSnapshot?) -> state
 * reduce(state, event) -> new state (always a new object; reduce never
 *   mutates the state it was given)
 *
 * `state.phase` sequence per segment: 'watch' -> ('question' if an
 * unanswered question is keyed to this segment, else skipped) -> ('record'
 * if segment.shadow, else skipped straight to advancing) -> next segment's
 * 'watch', or 'complete' after the last one.
 *
 * reduce() is defensive: an event that doesn't apply to the current phase
 * (e.g. SPEECH_SCORED while a question is pending) is a no-op — returns the
 * same state unchanged (aside from the always-cleared `celebration`/
 * `lastQuestionResult` transients, see below). This keeps the engine
 * crash-proof against a page race or a stale/duplicate event, the same
 * "never throw" posture the snapshot functions use.
 *
 * The page needs "can I retry?" / "must I give up?" to render its buttons —
 * these are deliberately NOT separate stored fields (a second source of
 * truth that could drift): derive them from what's already in state —
 * `canRetry = phase === 'record' && attemptsForSegment > 0`,
 * `mustGiveUp = phase === 'record_exhausted'`.
 */
import { PASS_PERCENT } from './shadowing-score.mjs';

const SNAPSHOT_VERSION = 1;
const MAX_ATTEMPTS_PER_SEGMENT = 3;
const CELEBRATION_STREAK_TIERS = new Set([3, 5, 8]);

function questionForSegment(video, segmentIndex, answeredQuestionIds) {
  const questions = Array.isArray(video?.questions) ? video.questions : [];
  // Only the FIRST unanswered question keyed to this segment fires — the
  // schema doesn't forbid a second one on the same after_segment, but
  // nothing in the spec describes stacking two on one step, so a second one
  // is simply never reached (a content-authoring edge case, not a runtime
  // decision worth a branch here).
  return questions.find((q) => q?.after_segment === segmentIndex && !answeredQuestionIds.has(q?.id)) || null;
}

function segmentAt(video, index) {
  const segments = Array.isArray(video?.segments) ? video.segments : [];
  return index >= 0 && index < segments.length ? segments[index] : null;
}

// Decide the phase to land in for `segmentIndex` right after arriving on it
// (fresh 'watch') is always 'watch' itself — this helper instead decides
// what comes AFTER watch/question is done for that segment: 'record' if the
// segment is shadow-able, otherwise skip straight to the next segment (or
// 'complete').
function afterWatchAndQuestion(state, segmentIndex) {
  const segment = segmentAt(state.video, segmentIndex);
  if (segment?.shadow) {
    return { ...state, phase: 'record', attemptsForSegment: 0 };
  }
  return advanceFrom(state, segmentIndex);
}

function enterSegment(state, segmentIndex) {
  const total = Array.isArray(state.video?.segments) ? state.video.segments.length : 0;
  if (segmentIndex >= total) {
    return { ...state, phase: 'complete', status: 'complete', summary: buildSummary(state) };
  }
  // Always lands in 'watch' — question gating (if any) is evaluated later,
  // when THIS segment's own SEGMENT_WATCHED arrives (see reduce()), not on
  // arrival here.
  return { ...state, currentSegmentIndex: segmentIndex, phase: 'watch' };
}

function advanceFrom(state, fromSegmentIndex) {
  return enterSegment(state, fromSegmentIndex + 1);
}

function buildSummary(state) {
  const results = state.results || [];
  let totalStars = 0;
  let segmentsPassed = 0;
  let segmentsPracticed = 0;
  for (const r of results) {
    if (!r) continue;
    totalStars += r.stars;
    if (r.practiced) segmentsPracticed += 1;
    else if (r.stars > 0) segmentsPassed += 1;
  }
  return {
    total_stars: totalStars,
    best_streak: state.bestStreak,
    segments_passed: segmentsPassed,
    segments_practiced: segmentsPracticed,
  };
}

export function createShadowingSession(video, savedSnapshot) {
  if (savedSnapshot) {
    const restored = fromSnapshot(video, savedSnapshot);
    if (restored) return restored;
  }
  const total = Array.isArray(video?.segments) ? video.segments.length : 0;
  return {
    video,
    currentSegmentIndex: 0,
    phase: total > 0 ? 'watch' : 'complete',
    attemptsForSegment: 0,
    answeredQuestionIds: new Set(),
    results: new Array(total).fill(null),
    streak: 0,
    bestStreak: 0,
    celebration: null,
    lastQuestionResult: null,
    status: total > 0 ? 'in_progress' : 'complete',
    summary: total > 0 ? null : buildSummary({ results: [], bestStreak: 0 }),
  };
}

export function reduce(state, event) {
  // Transient one-shot fields are cleared at the start of every call
  // (whether or not the event turns out to be valid for the current
  // phase) — they exist to be read by the page for exactly one state
  // snapshot after the qualifying transition.
  const base = { ...state, celebration: null, lastQuestionResult: null };

  switch (event?.type) {
    case 'SEGMENT_WATCHED': {
      if (base.phase !== 'watch') return base;
      const question = questionForSegment(base.video, base.currentSegmentIndex, base.answeredQuestionIds);
      if (question) return { ...base, phase: 'question' };
      return afterWatchAndQuestion(base, base.currentSegmentIndex);
    }

    case 'QUESTION_ANSWERED': {
      if (base.phase !== 'question') return base;
      const question = questionForSegment(base.video, base.currentSegmentIndex, base.answeredQuestionIds);
      if (!question) return base;
      const answeredQuestionIds = new Set(base.answeredQuestionIds);
      answeredQuestionIds.add(question.id);
      const withAnswer = {
        ...base,
        answeredQuestionIds,
        lastQuestionResult: { questionId: question.id, correct: Boolean(event?.correct) },
      };
      // Never blocks or retries on a wrong answer — always continues.
      return afterWatchAndQuestion(withAnswer, base.currentSegmentIndex);
    }

    case 'SPEECH_SCORED': {
      if (base.phase !== 'record') return base;
      const attemptsForSegment = base.attemptsForSegment + 1;
      const scorePercent = Number(event?.scorePercent) || 0;
      const pass = scorePercent >= PASS_PERCENT;
      if (pass) {
        const stars = attemptsForSegment === 1 ? 2 : 1;
        const results = base.results.slice();
        results[base.currentSegmentIndex] = { stars, practiced: false };
        const streak = base.streak + 1;
        const bestStreak = Math.max(base.bestStreak, streak);
        const celebration = CELEBRATION_STREAK_TIERS.has(streak) ? streak : null;
        const advanced = advanceFrom(
          { ...base, results, streak, bestStreak, celebration, attemptsForSegment },
          base.currentSegmentIndex,
        );
        return advanced;
      }
      if (attemptsForSegment >= MAX_ATTEMPTS_PER_SEGMENT) {
        return { ...base, phase: 'record_exhausted', attemptsForSegment };
      }
      return { ...base, phase: 'record', attemptsForSegment };
    }

    case 'RETRY': {
      if (base.phase !== 'record' || base.attemptsForSegment === 0 || base.attemptsForSegment >= MAX_ATTEMPTS_PER_SEGMENT) {
        return base;
      }
      // No-op on counts — SPEECH_SCORED owns attempt counting. RETRY just
      // clears transients (already done above) and keeps 'record' active,
      // ready for the next SPEECH_SCORED.
      return base;
    }

    case 'GIVE_UP_ADVANCE': {
      if (base.phase !== 'record_exhausted') return base;
      const results = base.results.slice();
      results[base.currentSegmentIndex] = { stars: 0, practiced: true };
      // Founder ruling: streak RESETS to 0 on give-up. Stars already banked
      // on earlier segments (and bestStreak) are untouched.
      return advanceFrom({ ...base, results, streak: 0, attemptsForSegment: 0 }, base.currentSegmentIndex);
    }

    case 'REPLAY': {
      // Purely a page/player concern (replaying audio/video) — the engine
      // has no state tied to it; always a no-op here, kept as a recognized
      // event type rather than falling through to "unknown" so a page that
      // dispatches REPLAY through the same reduce() call site never needs a
      // special case.
      return base;
    }

    default:
      return base;
  }
}

export function toSnapshot(state) {
  return {
    v: SNAPSHOT_VERSION,
    videoId: state.video?.id,
    currentSegmentIndex: state.currentSegmentIndex,
    phase: state.phase,
    attemptsForSegment: state.attemptsForSegment,
    answeredQuestionIds: Array.from(state.answeredQuestionIds || []),
    results: state.results,
    streak: state.streak,
    bestStreak: state.bestStreak,
    status: state.status,
  };
}

function isValidSnapshotShape(video, snap) {
  if (!snap || typeof snap !== 'object') return false;
  if (snap.v !== SNAPSHOT_VERSION) return false;
  if (!video || snap.videoId !== video.id) return false;
  const total = Array.isArray(video.segments) ? video.segments.length : 0;
  if (!Number.isInteger(snap.currentSegmentIndex) || snap.currentSegmentIndex < 0 || snap.currentSegmentIndex > total) return false;
  if (!Array.isArray(snap.results) || snap.results.length !== total) return false;
  if (!Array.isArray(snap.answeredQuestionIds)) return false;
  if (!['watch', 'question', 'record', 'record_exhausted', 'complete'].includes(snap.phase)) return false;
  if (!Number.isInteger(snap.attemptsForSegment) || snap.attemptsForSegment < 0) return false;
  if (!Number.isInteger(snap.streak) || !Number.isInteger(snap.bestStreak)) return false;
  return true;
}

export function fromSnapshot(video, snap) {
  if (!isValidSnapshotShape(video, snap)) return null;
  const state = {
    video,
    currentSegmentIndex: snap.currentSegmentIndex,
    phase: snap.phase,
    attemptsForSegment: snap.attemptsForSegment,
    answeredQuestionIds: new Set(snap.answeredQuestionIds),
    results: snap.results.slice(),
    streak: snap.streak,
    bestStreak: snap.bestStreak,
    celebration: null,
    lastQuestionResult: null,
    status: snap.status === 'complete' ? 'complete' : 'in_progress',
    summary: null,
  };
  if (state.status === 'complete' || state.phase === 'complete') {
    return { ...state, phase: 'complete', status: 'complete', summary: buildSummary(state) };
  }
  return state;
}
