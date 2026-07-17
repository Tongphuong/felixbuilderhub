import test from 'node:test';
import assert from 'node:assert/strict';

import { createShadowingSession, reduce, toSnapshot, fromSnapshot } from '../src/lib/shadowing-engine.mjs';
import { PASS_PERCENT } from '../src/lib/shadowing-score.mjs';

const PASS = PASS_PERCENT + 10;
const FAIL = PASS_PERCENT - 10;

function video({ segments, questions = [] }) {
  return { id: 'demo', segments, questions };
}

function seg(i, { shadow = true } = {}) {
  return { i, start: i * 3, end: i * 3 + 3, text_en: `segment ${i}`, shadow };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('happy path: watch -> record -> pass -> advance -> complete, with correct star/streak math', () => {
  const v = video({ segments: [seg(0), seg(1)] });
  let state = createShadowingSession(v);
  assert.equal(state.phase, 'watch');
  assert.equal(state.currentSegmentIndex, 0);

  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  assert.equal(state.phase, 'record'); // no question keyed here

  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });
  assert.deepEqual(state.results[0], { stars: 2, practiced: false }); // first-attempt pass
  assert.equal(state.currentSegmentIndex, 1);
  assert.equal(state.phase, 'watch');
  assert.equal(state.streak, 1);

  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });

  assert.equal(state.status, 'complete');
  assert.equal(state.phase, 'complete');
  assert.deepEqual(state.summary, {
    total_stars: 4, // 2 + 2, both first-attempt passes
    best_streak: 2,
    segments_passed: 2,
    segments_practiced: 0,
  });
});

test('first-try pass earns 2 stars; a pass after a retry earns 1 star', () => {
  const v = video({ segments: [seg(0)] });
  let state = createShadowingSession(v);
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });
  assert.equal(state.summary.total_stars, 2);

  const v2 = video({ segments: [seg(0)] });
  let s2 = createShadowingSession(v2);
  s2 = reduce(s2, { type: 'SEGMENT_WATCHED' });
  s2 = reduce(s2, { type: 'SPEECH_SCORED', scorePercent: FAIL }); // attempt 1, fail
  assert.equal(s2.phase, 'record');
  s2 = reduce(s2, { type: 'RETRY' });
  assert.equal(s2.phase, 'record');
  s2 = reduce(s2, { type: 'SPEECH_SCORED', scorePercent: PASS }); // attempt 2, pass
  assert.equal(s2.summary.total_stars, 1);
});

// ---------------------------------------------------------------------------
// Question gating
// ---------------------------------------------------------------------------

test('a question fires exactly once, blocks the mic step until answered, and a wrong answer still continues', () => {
  const q = { id: 'q1', after_segment: 0, type: 'yes_no', question_en: 'x', question_vi: 'y', answer: true };
  const v = video({ segments: [seg(0)], questions: [q] });
  let state = createShadowingSession(v);

  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  assert.equal(state.phase, 'question');

  // SPEECH_SCORED must not do anything while a question is pending.
  const blocked = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });
  assert.equal(blocked.phase, 'question');
  assert.equal(blocked.answeredQuestionIds.size, 0);

  // A WRONG answer still continues (no retry, no block).
  state = reduce(state, { type: 'QUESTION_ANSWERED', correct: false });
  assert.equal(state.phase, 'record'); // segment 0 is shadow:true
  assert.ok(state.answeredQuestionIds.has('q1'));
  assert.deepEqual(state.lastQuestionResult, { questionId: 'q1', correct: false });

  // lastQuestionResult is a one-shot transient, cleared on the next reduce().
  state = reduce(state, { type: 'RETRY' }); // no-op event, but still clears transients
  assert.equal(state.lastQuestionResult, null);
});

test('a question keyed to a later segment does not fire early, and never fires twice across a resume', () => {
  const q = { id: 'q1', after_segment: 0, type: 'yes_no', question_en: 'x', question_vi: 'y', answer: true };
  const v = video({ segments: [seg(0), seg(1)], questions: [q] });

  // Resume with q1 already answered: re-arriving at segment 0's watch phase
  // must skip straight past the question (never fires a second time).
  const snap = {
    v: 1, videoId: 'demo', currentSegmentIndex: 0, phase: 'watch',
    attemptsForSegment: 0, answeredQuestionIds: ['q1'], results: [null, null],
    streak: 0, bestStreak: 0, status: 'in_progress',
  };
  const state = fromSnapshot(v, snap);
  const next = reduce(state, { type: 'SEGMENT_WATCHED' });
  assert.equal(next.phase, 'record'); // straight to record, not 'question'
});

// ---------------------------------------------------------------------------
// Retry cap + GIVE_UP_ADVANCE
// ---------------------------------------------------------------------------

test('retry cap: 3 attempts total, then GIVE_UP_ADVANCE marks practiced (not starred), resets streak, keeps earned stars', () => {
  const v = video({ segments: [seg(0), seg(1)] });
  let state = createShadowingSession(v);

  // Pass segment 0 first-try to establish a streak of 1 (and 2 banked stars).
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });
  assert.equal(state.streak, 1);

  // Fail segment 1 three times.
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL }); // attempt 1
  assert.equal(state.phase, 'record');
  state = reduce(state, { type: 'RETRY' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL }); // attempt 2
  assert.equal(state.phase, 'record');
  state = reduce(state, { type: 'RETRY' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL }); // attempt 3
  assert.equal(state.phase, 'record_exhausted');

  // After the 3rd miss, RETRY and another SPEECH_SCORED are no-ops.
  const stillExhausted = reduce(state, { type: 'RETRY' });
  assert.equal(stillExhausted.phase, 'record_exhausted');
  const alsoNoop = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });
  assert.equal(alsoNoop.phase, 'record_exhausted');

  state = reduce(state, { type: 'GIVE_UP_ADVANCE' });
  assert.equal(state.status, 'complete');
  assert.equal(state.streak, 0); // reset
  assert.deepEqual(state.summary, {
    total_stars: 2, // only segment 0's earned stars — untouched
    best_streak: 1,
    segments_passed: 1,
    segments_practiced: 1,
  });
});

test('GIVE_UP_ADVANCE is a no-op before attempts are exhausted', () => {
  const v = video({ segments: [seg(0)] });
  let state = createShadowingSession(v);
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL }); // attempt 1 only
  const noop = reduce(state, { type: 'GIVE_UP_ADVANCE' });
  assert.equal(noop.phase, 'record');
  assert.equal(noop.currentSegmentIndex, 0);
});

// ---------------------------------------------------------------------------
// shadow:false skip
// ---------------------------------------------------------------------------

test('a shadow:false segment skips the record step entirely', () => {
  const v = video({ segments: [seg(0, { shadow: false }), seg(1)] });
  let state = createShadowingSession(v);
  assert.equal(state.currentSegmentIndex, 0);
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  // No record phase for segment 0 -- straight to segment 1's watch.
  assert.equal(state.currentSegmentIndex, 1);
  assert.equal(state.phase, 'watch');
  assert.equal(state.results[0], null); // never attempted
});

test('a shadow:false segment with a keyed question still asks it, then skips record', () => {
  const q = { id: 'q1', after_segment: 0, type: 'yes_no', question_en: 'x', question_vi: 'y', answer: true };
  const v = video({ segments: [seg(0, { shadow: false }), seg(1, { shadow: false })], questions: [q] });
  let state = createShadowingSession(v);
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  assert.equal(state.phase, 'question');
  state = reduce(state, { type: 'QUESTION_ANSWERED', correct: true });
  assert.equal(state.currentSegmentIndex, 1);
  assert.equal(state.phase, 'watch');
});

// ---------------------------------------------------------------------------
// Snapshot round-trip + tolerance
// ---------------------------------------------------------------------------

test('snapshot round-trip preserves progress', () => {
  const v = video({ segments: [seg(0), seg(1), seg(2)] });
  let state = createShadowingSession(v);
  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });

  const snap = toSnapshot(state);
  assert.equal(snap.v, 1);
  assert.equal(snap.videoId, 'demo');

  const restored = fromSnapshot(v, snap);
  assert.equal(restored.currentSegmentIndex, state.currentSegmentIndex);
  assert.equal(restored.phase, state.phase);
  assert.equal(restored.streak, state.streak);
  assert.deepEqual(restored.results, state.results);
});

test('a bad or mismatched snapshot yields a fresh session, never a throw', () => {
  const v = video({ segments: [seg(0), seg(1)] });

  assert.doesNotThrow(() => {
    const wrongVersion = fromSnapshot(v, { v: 99, videoId: 'demo' });
    assert.equal(wrongVersion, null);
  });
  assert.doesNotThrow(() => {
    const wrongVideo = fromSnapshot(v, {
      v: 1, videoId: 'someone-else', currentSegmentIndex: 0, phase: 'watch',
      attemptsForSegment: 0, answeredQuestionIds: [], results: [null, null], streak: 0, bestStreak: 0, status: 'in_progress',
    });
    assert.equal(wrongVideo, null);
  });
  assert.doesNotThrow(() => {
    const outOfRange = fromSnapshot(v, {
      v: 1, videoId: 'demo', currentSegmentIndex: 99, phase: 'watch',
      attemptsForSegment: 0, answeredQuestionIds: [], results: [null, null], streak: 0, bestStreak: 0, status: 'in_progress',
    });
    assert.equal(outOfRange, null);
  });
  assert.doesNotThrow(() => {
    const garbage = fromSnapshot(v, 'not even an object');
    assert.equal(garbage, null);
  });

  // createShadowingSession falls back to fresh when the snapshot is unusable.
  const state = createShadowingSession(v, { v: 99, videoId: 'demo' });
  assert.equal(state.phase, 'watch');
  assert.equal(state.currentSegmentIndex, 0);
});

// ---------------------------------------------------------------------------
// Celebration tiers
// ---------------------------------------------------------------------------

test('celebration is set exactly when streak hits 3/5/8, and cleared the very next reduce() call', () => {
  const segments = Array.from({ length: 8 }, (_, i) => seg(i));
  const v = video({ segments });
  let state = createShadowingSession(v);
  const celebrationsSeen = [];

  for (let i = 0; i < segments.length; i += 1) {
    state = reduce(state, { type: 'SEGMENT_WATCHED' });
    state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS });
    celebrationsSeen.push(state.celebration);
    if (state.phase !== 'complete') {
      const after = reduce(state, { type: 'REPLAY' }); // any subsequent reduce clears it
      assert.equal(after.celebration, null, `celebration must clear after segment ${i}`);
    }
  }

  assert.deepEqual(celebrationsSeen, [null, null, 3, null, 5, null, null, 8]);
});

// ---------------------------------------------------------------------------
// Completion summary invariants
// ---------------------------------------------------------------------------

test('completion summary: shadow:false segments count toward neither passed nor practiced', () => {
  const v = video({ segments: [seg(0), seg(1, { shadow: false }), seg(2)] });
  let state = createShadowingSession(v);

  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: PASS }); // segment 0 passed

  state = reduce(state, { type: 'SEGMENT_WATCHED' }); // segment 1, shadow:false, auto-skips

  state = reduce(state, { type: 'SEGMENT_WATCHED' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL });
  state = reduce(state, { type: 'RETRY' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL });
  state = reduce(state, { type: 'RETRY' });
  state = reduce(state, { type: 'SPEECH_SCORED', scorePercent: FAIL }); // 3rd miss
  state = reduce(state, { type: 'GIVE_UP_ADVANCE' }); // segment 2 practiced

  assert.equal(state.status, 'complete');
  const shadowTrueCount = v.segments.filter((s) => s.shadow).length;
  assert.equal(shadowTrueCount, 2);
  assert.equal(state.summary.segments_passed + state.summary.segments_practiced, shadowTrueCount);
  assert.deepEqual(state.summary, {
    total_stars: 2, best_streak: 1, segments_passed: 1, segments_practiced: 1,
  });
});

test('an empty-segments video is immediately complete with a zeroed summary', () => {
  const v = video({ segments: [] });
  const state = createShadowingSession(v);
  assert.equal(state.status, 'complete');
  assert.deepEqual(state.summary, { total_stars: 0, best_streak: 0, segments_passed: 0, segments_practiced: 0 });
});
