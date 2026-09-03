import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HONORS_PRIZES,
  honorsExclusionReason,
  buildHonorsRanking,
  buildSeasonPronunciation,
  maskCode,
} from '../functions/api/_read2lead-honors.js';

// Matches the "Amazing Summer" window from the packet
// (2026-07-01 -> 2026-08-31).
const WINDOW = { from: '2026-07-01', to: '2026-08-31' };

function makePackHistory(scores, { insideWindow = true } = {}) {
  const types = ['read_aloud', 'listen_and_speak'];
  return scores.map((score, i) => ({
    pack_id: `p${i}`,
    completed_at: insideWindow ? '2026-07-15T00:00:00Z' : '2026-06-01T00:00:00Z',
    activity_scores: [{ type: types[i % 2], score_percent: score }],
  }));
}

function entry(accessCode, codeFlags = {}, {
  lifetimeRp = 0,
  completedPacks = 0,
  completedBooks = 0,
  pronunciationScores = [],
  studentName = 'Kid',
  packHistory = null,
} = {}) {
  return {
    access_code: accessCode,
    codeData: {
      ...codeFlags,
      student_profile: { student_name: studentName },
      completed_books: Array.from({ length: completedBooks }, (_, i) => `book_${i}`),
    },
    state: {
      lifetime_rp: lifetimeRp,
      completed_packs: completedPacks,
      pack_history: packHistory || makePackHistory(pronunciationScores),
    },
  };
}

test('HONORS_PRIZES is exactly [10000, 5000, 2000] for ranks 1, 2, 3', () => {
  assert.deepEqual(HONORS_PRIZES, [10000, 5000, 2000]);
});

test('honorsExclusionReason: null for an eligible record with a name', () => {
  assert.equal(honorsExclusionReason({ student_profile: { student_name: 'Bao' } }), null);
});

test('honorsExclusionReason: no_name when the name is blank across all three fallbacks', () => {
  assert.equal(honorsExclusionReason({ student_profile: { student_name: '   ' } }), 'no_name');
  assert.equal(honorsExclusionReason({}, { student_name: '' }), 'no_name');
  assert.equal(honorsExclusionReason({ student_profile: {} }), 'no_name');
});

test('honorsExclusionReason: the progress.student_name and state.student_name fallbacks are honored, not just student_profile', () => {
  assert.equal(honorsExclusionReason({ progress: { student_name: 'Real' } }), null);
  assert.equal(honorsExclusionReason({}, { student_name: 'Real' }), null);
});

test('maskCode matches read2lead-leaderboard.js private maskCode() for the same input', () => {
  // Mirrors functions/api/read2lead-leaderboard.js's private maskCode()
  // verbatim (not imported — editing/exporting from that file is out of this
  // packet's file scope).
  function leaderboardMaskCode(code) {
    const clean = code.toString().trim().toUpperCase();
    const last = clean.slice(-4) || '----';
    if (clean.startsWith('R2L-')) return `R2L-***${last}`;
    return `***${last}`;
  }
  const samples = ['R2L-ALICE0001', 'r2l-bob-9999', '  R2L-xyz1234  ', 'NOTR2L-1234', 'R2L-'];
  for (const sample of samples) {
    assert.equal(maskCode(sample), leaderboardMaskCode(sample), `mismatch for ${sample}`);
  }
});

test('BAD-1: is_bot, is_test, is_shared, and no_name records are excluded with an exact reason, and never reach podium/honor_roll', () => {
  const entries = [
    entry('R2L-BOT-9999', { is_bot: true }, { lifetimeRp: 99999, studentName: 'Bot' }),
    entry('R2L-TEST-8888', { is_test: true }, { lifetimeRp: 88888, studentName: 'Test' }),
    entry('R2L-SHARE-7777', { is_shared: true }, { lifetimeRp: 77777, studentName: 'Shared' }),
    entry('R2L-NONAME-6666', {}, { lifetimeRp: 66666, studentName: '' }),
    entry('R2L-REAL-0001', {}, { lifetimeRp: 100, studentName: 'Real Kid' }),
  ];

  const result = buildHonorsRanking(entries, { seasonWindow: WINDOW });

  assert.deepEqual(result.excluded, [
    { masked_code: 'R2L-***9999', reason: 'is_bot' },
    { masked_code: 'R2L-***8888', reason: 'is_test' },
    { masked_code: 'R2L-***7777', reason: 'is_shared' },
    { masked_code: 'R2L-***6666', reason: 'no_name' },
  ]);
  assert.equal(result.participants_count, 1);
  assert.equal(result.honor_roll.length, 1);
  assert.equal(result.honor_roll[0].masked_code, 'R2L-***0001');
  assert.equal(result.podium.length, 1);
  assert.equal(result.podium[0].masked_code, 'R2L-***0001');
  assert.equal(result.podium[0].rank, 1);
  assert.equal(result.podium[0].prize_diamonds, 10000);
});

test('BAD-1b (cross product): exclusion runs before the tiebreak, not after — a bot tied on every ranking field with a real student, whose access_code would win the tiebreak if not excluded, never takes the podium spot', () => {
  // Tied on lifetime_rp, pronunciation avg, completed_packs, completed_books.
  // 'R2L-AAAA1111' sorts ASC before 'R2L-ZZZZ2222' — so if exclusion ran
  // AFTER the access_code tiebreak instead of before it, the bot would win
  // rank 1 on the tie. This is the exact ordering bug the packet calls out.
  const scores = [90, 92, 91];
  const entries = [
    entry('R2L-AAAA1111', { is_bot: true }, {
      lifetimeRp: 500, completedPacks: 10, completedBooks: 5, pronunciationScores: scores, studentName: 'Bot Should Not Win',
    }),
    entry('R2L-ZZZZ2222', {}, {
      lifetimeRp: 500, completedPacks: 10, completedBooks: 5, pronunciationScores: scores, studentName: 'Real Kid',
    }),
  ];

  const result = buildHonorsRanking(entries, { seasonWindow: WINDOW });

  assert.deepEqual(result.excluded, [{ masked_code: 'R2L-***1111', reason: 'is_bot' }]);
  assert.equal(result.participants_count, 1);
  assert.equal(result.podium.length, 1);
  assert.equal(result.podium[0].masked_code, 'R2L-***2222');
  assert.equal(result.podium[0].rank, 1);
  assert.equal(result.podium[0].prize_diamonds, 10000);
});

test('BAD-4: identical inputs in different array order produce an identical podium (deterministic access-code tiebreak)', () => {
  // a and b tie on every ranking field except access_code (both have empty
  // pack_history -> pronunciation_percent is null for both, so that field
  // also ties); c is a clear third place.
  const a = entry('R2L-AAAA0001', {}, { lifetimeRp: 100, studentName: 'Tied A' });
  const b = entry('R2L-BBBB0002', {}, { lifetimeRp: 100, studentName: 'Tied B' });
  const c = entry('R2L-CCCC0003', {}, { lifetimeRp: 50, studentName: 'Lower C' });

  const forward = buildHonorsRanking([a, b, c], { seasonWindow: WINDOW });
  const reversed = buildHonorsRanking([c, b, a], { seasonWindow: WINDOW });

  assert.deepEqual(forward.podium, reversed.podium);
  assert.deepEqual(forward.podium.map((row) => row.masked_code), ['R2L-***0001', 'R2L-***0002', 'R2L-***0003']);
  assert.deepEqual(forward.podium.map((row) => row.prize_diamonds), [10000, 5000, 2000]);
});

test('tiebreak_confidence is "partial" once pack_history hits the 50-entry cap, "full" below it', () => {
  const longHistory = Array.from({ length: 50 }, (_, i) => ({
    pack_id: `p${i}`,
    completed_at: '2026-07-15T00:00:00Z',
    activity_scores: [],
  }));
  const shortHistory = Array.from({ length: 3 }, (_, i) => ({
    pack_id: `p${i}`,
    completed_at: '2026-07-15T00:00:00Z',
    activity_scores: [],
  }));
  const entries = [
    entry('R2L-LONG-9991', {}, { lifetimeRp: 10, studentName: 'Long', packHistory: longHistory }),
    entry('R2L-SHORT-9992', {}, { lifetimeRp: 5, studentName: 'Short', packHistory: shortHistory }),
  ];

  const result = buildHonorsRanking(entries, { seasonWindow: WINDOW });
  const long = result.honor_roll.find((row) => row.masked_code === 'R2L-***9991');
  const short = result.honor_roll.find((row) => row.masked_code === 'R2L-***9992');

  assert.equal(long.tiebreak_confidence, 'partial');
  assert.equal(short.tiebreak_confidence, 'full');
});

test('buildSeasonPronunciation: percent is null with fewer than 3 samples, else the mean of pronunciation-type scores only', () => {
  const packHistory = [
    {
      completed_at: '2026-07-10T00:00:00Z',
      activity_scores: [
        { type: 'read_aloud', score_percent: 80 },
        { type: 'listen_and_speak', score_percent: 90 },
      ],
    },
    {
      completed_at: '2026-07-20T00:00:00Z',
      // Not a pronunciation type — must be excluded from the average.
      activity_scores: [{ type: 'reading_comprehension', score_percent: 0 }],
    },
  ];

  const twoSamples = buildSeasonPronunciation({ packHistory, fromIso: WINDOW.from, toIso: WINDOW.to });
  assert.equal(twoSamples.sample_count, 2);
  assert.equal(twoSamples.percent, null);

  const threeSamples = buildSeasonPronunciation({
    packHistory: [...packHistory, {
      completed_at: '2026-07-25T00:00:00Z',
      activity_scores: [{ type: 'read_aloud', score_percent: 100 }],
    }],
    fromIso: WINDOW.from,
    toIso: WINDOW.to,
  });
  assert.equal(threeSamples.sample_count, 3);
  assert.equal(threeSamples.percent, 90); // (80 + 90 + 100) / 3
});

test('buildSeasonPronunciation excludes packs completed outside the season window (inclusive end-of-day on a date-only "to")', () => {
  const packHistory = [
    { completed_at: '2026-06-30T23:59:59Z', activity_scores: [{ type: 'read_aloud', score_percent: 100 }] }, // before window
    { completed_at: '2026-09-01T00:00:01Z', activity_scores: [{ type: 'read_aloud', score_percent: 100 }] }, // after window
    {
      completed_at: '2026-08-31T12:00:00Z', // last day of the window, mid-day
      activity_scores: [
        { type: 'read_aloud', score_percent: 50 },
        { type: 'listen_and_speak', score_percent: 60 },
        { type: 'read_aloud', score_percent: 70 },
      ],
    },
  ];

  const result = buildSeasonPronunciation({ packHistory, fromIso: WINDOW.from, toIso: WINDOW.to });
  assert.equal(result.sample_count, 3);
  assert.equal(result.percent, 60); // (50 + 60 + 70) / 3, the out-of-window packs excluded
});

test('buildHonorsRanking sorts DESC by lifetime_rp, falling back to rank_points then 0', () => {
  const entries = [
    { access_code: 'R2L-RP-0001', codeData: { student_profile: { student_name: 'HasLifetime' } }, state: { lifetime_rp: 300, completed_packs: 0, pack_history: [] } },
    { access_code: 'R2L-RP-0002', codeData: { student_profile: { student_name: 'HasRankPoints' } }, state: { rank_points: 200, completed_packs: 0, pack_history: [] } },
    { access_code: 'R2L-RP-0003', codeData: { student_profile: { student_name: 'HasNeither' } }, state: { completed_packs: 0, pack_history: [] } },
  ];

  const result = buildHonorsRanking(entries, { seasonWindow: WINDOW });
  assert.deepEqual(result.honor_roll.map((row) => row.masked_code), ['R2L-***0001', 'R2L-***0002', 'R2L-***0003']);
  assert.deepEqual(result.honor_roll.map((row) => row.lifetime_rp), [300, 200, 0]);
});
