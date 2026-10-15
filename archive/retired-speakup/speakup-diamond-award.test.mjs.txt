import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/minny-practice-log.js';
import { enrichClass, normalizeClass } from '../functions/api/admin/_classes.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

/**
 * Tests for SpeakUp diamond-award anti-farming caps (minny-practice-log.js)
 * and the teacher-dashboard practice signals (admin/_classes.js enrichClass).
 *
 * Diamonds are ONLY paid on a genuine completion signal keyed off prompt_id:
 *   - 'homework_summary' -> +10, capped at 2 payouts/day
 *   - 'free_talk_summary' -> +20, capped at 1 payout/day
 *   - anything else (per-step logs) -> 0, always
 * plus a 100/week backstop shared across both. See minny-practice-log.js.
 */

function makeKv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts = [];
  return {
    puts,
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

function baseCodeData(overrides = {}) {
  return {
    progress: {},
    ...overrides,
  };
}

// Same shape as makeKv, but with artificial latency on get/put so genuinely
// concurrent requests interleave their KV round trips -- mirrors Buffet's
// race_repro4_cap_corruption.mjs, needed to actually exercise the
// per-student serialization lock rather than a same-tick synchronous race.
function makeRacyKv(seed = {}, latencyMs = 5) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, opts) {
      await new Promise((resolve) => { setTimeout(resolve, latencyMs); });
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      await new Promise((resolve) => { setTimeout(resolve, latencyMs); });
      store.set(key, value);
    },
  };
}

// Mirrors the private weekKey() in minny-practice-log.js (Monday-anchored ISO
// week) so the weekly-backstop fixture below always lands in the SAME week
// bucket the endpoint computes for "now", regardless of what day the suite
// runs on.
function currentWeekKey(isoDate = new Date().toISOString()) {
  const date = new Date(isoDate);
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

async function postPracticeLog({ kv, accessCode, promptId, scorePercent = 90, completionId }) {
  return onRequestPost({
    request: new Request('https://example.com/api/minny-practice-log', {
      method: 'POST',
      body: JSON.stringify({
        access_code: accessCode,
        pack_id: 'general',
        prompt_id: promptId,
        score_percent: scorePercent,
        ready_for_class: false,
        ...(completionId ? { completion_id: completionId } : {}),
      }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
}

// ---------------------------------------------------------------------------
// Homework: +10, capped at 2/day
// ---------------------------------------------------------------------------

test('homework_summary pays +10 the first time', async () => {
  const kv = makeKv({ 'R2L-HW-DAY1': baseCodeData() });
  const res = await postPracticeLog({ kv, accessCode: 'r2l-hw-day1', promptId: 'homework_summary' });
  const payload = await res.json();
  assert.equal(res.status, 200);
  assert.equal(payload.diamonds_awarded, 10);
  assert.equal(payload.diamond_balance, 10);
});

// These two tests model TWO+ genuinely distinct homework sessions the same
// day, so each carries its own completion_id (what the real UI sends per
// finished session) — otherwise, post the idempotency fix, an identical
// no-completion_id repeat is indistinguishable from a retry and would be
// deduped by the fallback key instead of exercising the daily cap. See the
// dedicated "idempotency fallback" test below for the no-id collapse case.
test('a 2nd same-day homework_summary (distinct session) also pays +10 (still within the 2/day cap)', async () => {
  const kv = makeKv({ 'R2L-HW-DAY2': baseCodeData() });
  await postPracticeLog({ kv, accessCode: 'r2l-hw-day2', promptId: 'homework_summary', completionId: 'hw-day2-session-1' });
  const res2 = await postPracticeLog({ kv, accessCode: 'r2l-hw-day2', promptId: 'homework_summary', completionId: 'hw-day2-session-2' });
  const payload2 = await res2.json();
  assert.equal(payload2.diamonds_awarded, 10);
  assert.equal(payload2.diamond_balance, 20);
});

test('a 3rd same-day homework_summary (distinct session) pays 0 (2/day cap enforced)', async () => {
  const kv = makeKv({ 'R2L-HW-DAY3': baseCodeData() });
  await postPracticeLog({ kv, accessCode: 'r2l-hw-day3', promptId: 'homework_summary', completionId: 'hw-day3-session-1' });
  await postPracticeLog({ kv, accessCode: 'r2l-hw-day3', promptId: 'homework_summary', completionId: 'hw-day3-session-2' });
  const res3 = await postPracticeLog({ kv, accessCode: 'r2l-hw-day3', promptId: 'homework_summary', completionId: 'hw-day3-session-3' });
  const payload3 = await res3.json();
  assert.equal(payload3.diamonds_awarded, 0, 'a 3rd DISTINCT homework completion the same day must be blocked by the daily cap, not idempotency');
  assert.equal(payload3.diamond_balance, 20, 'balance stays at the 2-payout total');
});

// ---------------------------------------------------------------------------
// Free Talk: +20, capped at 1/day
// ---------------------------------------------------------------------------

test('free_talk_summary pays +20 once', async () => {
  const kv = makeKv({ 'R2L-FT-DAY1': baseCodeData() });
  const res = await postPracticeLog({ kv, accessCode: 'r2l-ft-day1', promptId: 'free_talk_summary' });
  const payload = await res.json();
  assert.equal(payload.diamonds_awarded, 20);
  assert.equal(payload.diamond_balance, 20);
});

test('a 2nd same-day free_talk_summary pays 0 (1/day cap enforced)', async () => {
  const kv = makeKv({ 'R2L-FT-DAY2': baseCodeData() });
  await postPracticeLog({ kv, accessCode: 'r2l-ft-day2', promptId: 'free_talk_summary' });
  const res2 = await postPracticeLog({ kv, accessCode: 'r2l-ft-day2', promptId: 'free_talk_summary' });
  const payload2 = await res2.json();
  assert.equal(payload2.diamonds_awarded, 0);
  assert.equal(payload2.diamond_balance, 20, 'balance stays at the single payout');
});

// ---------------------------------------------------------------------------
// Non-summary prompt_id (per-step logs): always 0
// ---------------------------------------------------------------------------

test('a non-summary prompt_id (per-step log) pays 0', async () => {
  const kv = makeKv({ 'R2L-STEP-0001': baseCodeData() });
  const res = await postPracticeLog({ kv, accessCode: 'r2l-step-0001', promptId: 'step_3' });
  const payload = await res.json();
  assert.equal(payload.diamonds_awarded, 0);
  assert.equal(payload.diamond_balance, 0);
});

// ---------------------------------------------------------------------------
// Weekly backstop: 100 diamonds/week from SpeakUp, across both reward types
// ---------------------------------------------------------------------------

test('weekly backstop: once week_total reaches 100, further eligible completions pay 0', async () => {
  const accessCode = 'R2L-WEEK-CAP';
  const thisWeek = currentWeekKey();
  const kv = makeKv({
    [accessCode]: baseCodeData({
      progress: {
        minny_practice: {
          schema_version: 2,
          weekly_key: thisWeek,
          sessions_this_week: 5,
          diamond_awards: {
            day_key: '2025-01-01', // a stale day so today's counters start fresh
            homework_count: 0,
            freetalk_count: 0,
            week_key: thisWeek,
            week_total: 95,
          },
        },
      },
    }),
  });

  // 95 + 10 (homework) > 100 -> capped to 0.
  const res = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary' });
  const payload = await res.json();
  assert.equal(payload.diamonds_awarded, 0, '95 + 10 would exceed the 100/week backstop');
  assert.equal(payload.diamond_balance, 0, 'no reward was ever applied to this fresh progress record');
});

// ---------------------------------------------------------------------------
// Diamonds isolation: coins/rank_points untouched by an award
// ---------------------------------------------------------------------------

test('an award changes diamonds only — coins and rank_points are unchanged', async () => {
  const accessCode = 'R2L-ISOLATE';
  const kv = makeKv({
    [accessCode]: baseCodeData({ student_profile: { student_name: 'Kid' } }),
  });
  await kv.put(progressKey(accessCode), JSON.stringify({
    schema_version: 2,
    level_reset_version: 20260606,
    diamonds: 5,
    coins: 42,
    rank_points: 7,
  }));

  const res = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary' });
  const payload = await res.json();
  assert.equal(payload.diamonds_awarded, 10);
  assert.equal(payload.diamond_balance, 15, 'diamonds increase by exactly the awarded amount');

  const savedProgress = JSON.parse(await kv.get(progressKey(accessCode)));
  assert.equal(savedProgress.coins, 42, 'coins must be untouched by a diamond award');
  assert.equal(savedProgress.rank_points, 7, 'rank_points must be untouched by a diamond award');
});

// ---------------------------------------------------------------------------
// Idempotency guard (Buffet blocker, 2026-07-17): a repeated completion of
// the SAME session must pay at most once, closing the check-then-act race
// where identical retries all read the pre-write daily/weekly counters.
// ---------------------------------------------------------------------------

test('idempotency: two POSTs with the SAME completion_id pay only once', async () => {
  const accessCode = 'R2L-IDEM-SAME';
  const kv = makeKv({ [accessCode]: baseCodeData() });
  const completionId = 'session-uuid-abc-123';

  const res1 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId });
  const payload1 = await res1.json();
  assert.equal(payload1.diamonds_awarded, 10, 'the first completion of this session pays');

  const res2 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId });
  const payload2 = await res2.json();
  assert.equal(payload2.diamonds_awarded, 0, 'a retry of the SAME completion_id must not pay again');
  assert.equal(payload2.diamond_balance, 10, 'balance is unchanged by the replayed retry');

  const res3 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId });
  const payload3 = await res3.json();
  assert.equal(payload3.diamonds_awarded, 0, 'a third replay of the same id still pays 0');
});

test('idempotency: two POSTs with DIFFERENT completion_ids pay twice (up to the existing 2/day cap)', async () => {
  const accessCode = 'R2L-IDEM-DIFF';
  const kv = makeKv({ [accessCode]: baseCodeData() });

  const res1 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId: 'session-1' });
  const payload1 = await res1.json();
  assert.equal(payload1.diamonds_awarded, 10);

  const res2 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId: 'session-2' });
  const payload2 = await res2.json();
  assert.equal(payload2.diamonds_awarded, 10, 'a genuinely different completion still pays, distinct from a replay');
  assert.equal(payload2.diamond_balance, 20);
});

// Finding 1 (Buffet re-review, 2026-07-17 -- corrected design): the earlier
// synthesized pack-based fallback key (access_code:prompt_id:pack_id:day)
// was broken -- pack_id is hardcoded 'general' for every kid/day
// (minny-speaking-context.js), and no client sends completion_id yet, so a
// kid's genuine SECOND same-day homework completion reused the exact same
// fallback key and silently paid 0, making HOMEWORK_DAILY_CAP=2
// unreachable. The corrected rule: dedup ONLY on a real completion_id; with
// no id, rely solely on the daily/weekly caps (safe now that one kid's
// awards serialize -- see the concurrency test below), so a genuine second
// session is never under-paid, only cap-bounded.
test('no completion_id (real current frontend shape): two same-day homework_summary posts with NO completion_id BOTH pay, up to the cap', async () => {
  const accessCode = 'R2L-NO-ID';
  const kv = makeKv({ [accessCode]: baseCodeData() });

  const res1 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary' });
  const payload1 = await res1.json();
  assert.equal(payload1.diamonds_awarded, 10, 'the first no-id completion pays');

  const res2 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary' });
  const payload2 = await res2.json();
  assert.equal(payload2.diamonds_awarded, 10, 'a second no-id completion the same day must NOT be collapsed to 0 -- only the cap should stop it');
  assert.equal(payload2.diamond_balance, 20);

  const res3 = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary' });
  const payload3 = await res3.json();
  assert.equal(payload3.diamonds_awarded, 0, 'a third no-id completion the same day is blocked by the 2/day cap, same as with distinct ids');
});

// Finding 2 (Buffet re-review, 2026-07-17): concurrent requests for the SAME
// kid with DIFFERENT completion_ids used to each read the same stale
// codeData/ledger and each write, corrupting homework_count/week_total (and
// letting a LATER, fully sequential request that day overpay on top of
// that). The fix serializes all of one kid's diamond-award decisions within
// the isolate (keyed by accessCode alone) and re-reads fresh state on each
// turn. Modeled directly on Buffet's race_repro4_cap_corruption.mjs.
test('Finding 2 (concurrency): N concurrent distinct-completion_id homework completions for one kid never exceed the daily cap, and the ledger stays consistent with the real balance', async () => {
  const accessCode = 'R2L-CONCURRENT-CAP';
  const kv = makeRacyKv({ [accessCode]: baseCodeData() });

  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((id) =>
      postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId: `concurrent-${id}` }),
    ),
  );
  const payloads = await Promise.all(results.map((r) => r.json()));
  const totalAwarded = payloads.reduce((sum, p) => sum + p.diamonds_awarded, 0);

  assert.ok(totalAwarded <= 20, `total awarded (${totalAwarded}) must never exceed the 2/day x 10 = 20 cap`);
  assert.equal(totalAwarded, 20, 'exactly 2 of the 5 concurrent completions should have been admitted (the daily cap)');

  const ledgerCodeData = await kv.get(accessCode, { type: 'json' });
  const ledger = ledgerCodeData.progress.minny_practice.diamond_awards;
  assert.equal(ledger.homework_count, 2, 'the ledger must correctly remember 2 payouts, not be corrupted by the race');
  assert.equal(ledger.week_total, 20);

  const progressData = await kv.get(progressKey(accessCode), { type: 'json' });
  assert.equal(progressData.diamonds, 20, 'the REAL persisted diamond balance must match the ledger exactly -- no corruption drift');

  // A further, fully sequential, distinct-id request the same day must
  // correctly see the cap as already exhausted (not overpay because the
  // race corrupted homework_count below its true value).
  const followUp = await postPracticeLog({ kv, accessCode, promptId: 'homework_summary', completionId: 'concurrent-follow-up' });
  const followUpPayload = await followUp.json();
  assert.equal(followUpPayload.diamonds_awarded, 0, 'the cap must already be remembered as exhausted');
});

// ---------------------------------------------------------------------------
// enrichClass — practice_status buckets
// ---------------------------------------------------------------------------

function classWithOneStudent(code) {
  return normalizeClass({ id: 'class-test', name: 'Test class', student_codes: [code] });
}

test('enrichClass: practice_status is "today" when last_activity_at is today (VN)', async () => {
  const code = 'R2L-STATUS-TODAY';
  const nowIso = new Date().toISOString();
  const kv = makeKv({ [code]: baseCodeData({ progress: { last_activity_at: nowIso } }) });
  const env = { READ2LEAD_CODES: kv };
  const enriched = await enrichClass(env, classWithOneStudent(code));
  const student = enriched.students.find((s) => s.code === code);
  assert.equal(student.practice_status, 'today');
  assert.equal(student.last_activity_at, nowIso);
});

test('enrichClass: practice_status is "recent" when last_activity_at is 2 days ago', async () => {
  const code = 'R2L-STATUS-RECENT';
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const kv = makeKv({ [code]: baseCodeData({ progress: { last_activity_at: twoDaysAgo } }) });
  const env = { READ2LEAD_CODES: kv };
  const enriched = await enrichClass(env, classWithOneStudent(code));
  const student = enriched.students.find((s) => s.code === code);
  assert.equal(student.practice_status, 'recent', 'off-by-one on the 1-3 day window must not ship silently');
});

test('enrichClass: practice_status is "inactive" when last_activity_at is 4 days ago', async () => {
  const code = 'R2L-STATUS-OLD';
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const kv = makeKv({ [code]: baseCodeData({ progress: { last_activity_at: fourDaysAgo } }) });
  const env = { READ2LEAD_CODES: kv };
  const enriched = await enrichClass(env, classWithOneStudent(code));
  const student = enriched.students.find((s) => s.code === code);
  assert.equal(student.practice_status, 'inactive');
});

test('enrichClass: practice_status is "inactive" when the student never practiced', async () => {
  const code = 'R2L-STATUS-NEVER';
  const kv = makeKv({ [code]: baseCodeData() });
  const env = { READ2LEAD_CODES: kv };
  const enriched = await enrichClass(env, classWithOneStudent(code));
  const student = enriched.students.find((s) => s.code === code);
  assert.equal(student.practice_status, 'inactive');
  assert.equal(student.last_activity_at, null);
});
