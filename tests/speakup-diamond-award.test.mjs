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



// These two tests model TWO+ genuinely distinct homework sessions the same
// day, so each carries its own completion_id (what the real UI sends per
// finished session) — otherwise, post the idempotency fix, an identical
// no-completion_id repeat is indistinguishable from a retry and would be
// deduped by the fallback key instead of exercising the daily cap. See the
// dedicated "idempotency fallback" test below for the no-id collapse case.




// ---------------------------------------------------------------------------
// Free Talk: +20, capped at 1/day
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// Non-summary prompt_id (per-step logs): always 0
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Weekly backstop: 100 diamonds/week from SpeakUp, across both reward types
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Diamonds isolation: coins/rank_points untouched by an award
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Idempotency guard (Buffet blocker, 2026-07-17): a repeated completion of
// the SAME session must pay at most once, closing the check-then-act race
// where identical retries all read the pre-write daily/weekly counters.
// ---------------------------------------------------------------------------





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


// Finding 2 (Buffet re-review, 2026-07-17): concurrent requests for the SAME
// kid with DIFFERENT completion_ids used to each read the same stale
// codeData/ledger and each write, corrupting homework_count/week_total (and
// letting a LATER, fully sequential request that day overpay on top of
// that). The fix serializes all of one kid's diamond-award decisions within
// the isolate (keyed by accessCode alone) and re-reads fresh state on each
// turn. Modeled directly on Buffet's race_repro4_cap_corruption.mjs.


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
