import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { canAccessPackForPractice } from './_read2lead-pack-access.js';
import { loadProgressState, publicProgressState } from './_read2lead-v2-state.js';
import { rewardStudent, todayVN } from './admin/_classes.js';

// Anti-farming diamond rewards for genuine SpeakUp completion signals only
// (keyed off prompt_id — per-step logs never pay). Caps reset on VN day/week
// boundaries via the diamond_awards ledger persisted on minny_practice.
const HOMEWORK_DIAMOND_REWARD = 10;
const FREE_TALK_DIAMOND_REWARD = 20;
const HOMEWORK_DAILY_CAP = 2;
const FREE_TALK_DAILY_CAP = 1;
const WEEKLY_DIAMOND_CAP = 100;

// Same-isolate serialization for the diamond-award decision, keyed by
// accessCode ALONE (Buffet finding 2, 2026-07-17 — corrected from an
// earlier version keyed by accessCode+idemKey). A kid is one person; ALL
// of their diamond-award decisions must run one at a time on this isolate,
// even across DIFFERENT completion_ids — two concurrent requests for the
// SAME kid with different completion_ids don't share an idemKey, so a
// lock keyed on idemKey let them both read the same stale ledger and both
// write, corrupting homework_count/week_total (and, through that, letting
// a later same-day request overpay). Two different kids never block each
// other (different keys). This is a genuine mutex (each turn awaits its
// predecessor and re-reads fresh state), not a skip-if-busy flag: unlike a
// single-completion in-flight guard, distinct concurrent completions must
// each still be evaluated once it's their turn, so the daily/weekly caps
// below can legitimately admit BOTH of two eligible completions, not just
// the first one to arrive. Release always happens in a `finally` so a
// throw never leaves a kid's lock stuck held for the rest of the isolate's
// life.
const studentAwardLocks = new Map(); // accessCode -> Promise (resolves when free)

async function acquireStudentAwardLock(accessCode) {
  // Loop rather than a single await: while this waiter was asleep, another
  // waiter may have grabbed the lock first (see the release-then-resolve
  // ordering below) — re-check after waking up instead of assuming the
  // lock is free.
  for (;;) {
    const current = studentAwardLocks.get(accessCode);
    if (!current) break;
    await current;
  }
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  studentAwardLocks.set(accessCode, held);
  return () => {
    // Delete BEFORE resolving: microtasks drain one at a time, so the
    // first waiter to wake up from `await current` always sees the map
    // entry already gone (or already replaced by a still-earlier waiter)
    // rather than racing this cleanup.
    studentAwardLocks.delete(accessCode);
    release();
  };
}

function weekKey(isoDate = new Date().toISOString()) {
  const date = new Date(isoDate);
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

export function buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, summary) {
  const entry = {
    at: now,
    pack_id: packId,
    prompt_id: promptId,
    score_percent: Number.isFinite(scorePercent) ? Math.round(scorePercent) : null,
    ready_for_class: readyForClass,
  };
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    entry.summary = summary;
  }
  return entry;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Dữ liệu không hợp lệ.' }, 400);
  }

  if (body?.website) {
    return json({ ok: true, message: 'Đã ghi nhận.' });
  }

  const accessCode = String(body?.access_code || '').trim().toUpperCase();
  const packId = String(body?.pack_id || '').trim();
  const scorePercent = Number(body?.score_percent);
  const promptId = String(body?.prompt_id || '').trim();
  const readyForClass = body?.ready_for_class === true;
  const summary = body?.summary;
  const completionId = typeof body?.completion_id === 'string' ? body.completion_id.trim().slice(0, 128) : '';

  if (!accessCode || !packId) {
    return json({ ok: false, error: 'missing_fields', message: 'Thiếu mã học sinh hoặc mã bài.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) return rateLimitedResponse(rl.retryAfter);

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  if (!canAccessPackForPractice(codeData, packId)) {
    return json({ ok: false, error: 'pack_not_found', message: 'Không tìm thấy bài này.' }, 404);
  }

  const now = new Date().toISOString();
  const currentWeek = weekKey(now);
  const todayKey = todayVN();

  // Dedup ONLY on a REAL client-supplied completion_id (Buffet finding 1,
  // 2026-07-17 — corrected design; the earlier synthesized pack-based
  // fallback key was broken: pack_id is hardcoded 'general' for every
  // kid/day in minny-speaking-context.js, and no client sends
  // completion_id yet, so a kid's genuine SECOND same-day homework
  // completion reused the exact same fallback key and silently paid 0 —
  // HOMEWORK_DAILY_CAP=2 was unreachable). With no id, we do not dedup at
  // all and rely solely on the daily/weekly caps below (safe now that all
  // of one kid's awards serialize — see acquireStudentAwardLock) — worst
  // case is cap-bounded, never an under-pay of a genuine second session.
  // The client will always send a stable completion_id once Steve's
  // frontend change ships; this no-id path is purely defensive.
  const idemKey = completionId || null;

  const releaseLock = await acquireStudentAwardLock(accessCode);
  try {
    // Re-read fresh state now that it's this request's turn (Buffet finding
    // 2, 2026-07-17): concurrent requests for the SAME kid with DIFFERENT
    // completion_ids used to all read the stale codeData captured before
    // any of them had written, corrupting homework_count/week_total and
    // letting a later same-day request overpay. Serializing on accessCode
    // and re-reading here is what makes the daily/weekly caps below
    // actually hold under concurrency.
    const freshCodeData = (await env.READ2LEAD_CODES.get(accessCode, { type: 'json' })) || codeData;
    const progress = freshCodeData.progress || {};
    const prev = progress.minny_practice || {};

    const sessionsThisWeek = prev.weekly_key === currentWeek
      ? numberOrZero(prev.sessions_this_week) + 1
      : 1;

    const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, summary);

    // --- Diamond award: genuine completion signal only, anti-farming caps ---
    const prevAwards = prev.diamond_awards || {};
    const sameDay = prevAwards.day_key === todayKey;
    const sameWeek = prevAwards.week_key === currentWeek;
    let homeworkCount = sameDay ? numberOrZero(prevAwards.homework_count) : 0;
    let freetalkCount = sameDay ? numberOrZero(prevAwards.freetalk_count) : 0;
    let weekTotal = sameWeek ? numberOrZero(prevAwards.week_total) : 0;

    const prevPaidIds = Array.isArray(prevAwards.paid_ids) ? prevAwards.paid_ids : [];
    const alreadyPaid = idemKey ? prevPaidIds.includes(idemKey) : false;

    let diamondsToAward = 0;
    if (!alreadyPaid) {
      if (promptId === 'homework_summary') {
        if (homeworkCount < HOMEWORK_DAILY_CAP && weekTotal + HOMEWORK_DIAMOND_REWARD <= WEEKLY_DIAMOND_CAP) {
          diamondsToAward = HOMEWORK_DIAMOND_REWARD;
        }
      } else if (promptId === 'free_talk_summary') {
        if (freetalkCount < FREE_TALK_DAILY_CAP && weekTotal + FREE_TALK_DIAMOND_REWARD <= WEEKLY_DIAMOND_CAP) {
          diamondsToAward = FREE_TALK_DIAMOND_REWARD;
        }
      }
    }

    let diamondsAwarded = 0;
    let diamondBalance = null;
    let paidIds = prevPaidIds;
    if (diamondsToAward > 0) {
      const rewardResult = await rewardStudent(env, accessCode, { diamondDelta: diamondsToAward, coinsDelta: 0 });
      if (rewardResult?.ok) {
        // Only reflect what was ACTUALLY paid this request in the persisted
        // ledger — counts/paid_ids must never be incremented speculatively
        // ahead of a confirmed rewardStudent write (the self-consistency gap
        // Buffet also flagged).
        diamondsAwarded = diamondsToAward;
        diamondBalance = Number(rewardResult.read2lead_state?.diamonds) || 0;
        if (promptId === 'homework_summary') homeworkCount += 1;
        else if (promptId === 'free_talk_summary') freetalkCount += 1;
        weekTotal += diamondsAwarded;
        // Only a REAL completion_id is ever recorded — there is nothing to
        // dedup a no-id caller against next time, by design (see above).
        if (idemKey) paidIds = [idemKey, ...prevPaidIds].slice(0, 40);
      }
    }

    if (diamondBalance === null) {
      // Nothing was awarded (ineligible, capped, already-paid replay, or the
      // reward call failed) — report the student's actual current balance,
      // not a stale/zero value.
      const state = await loadProgressState(env, accessCode, freshCodeData);
      diamondBalance = Number(publicProgressState(state).diamonds) || 0;
    }

    const diamondAwards = {
      day_key: todayKey,
      homework_count: homeworkCount,
      freetalk_count: freetalkCount,
      week_key: currentWeek,
      week_total: weekTotal,
      paid_ids: paidIds,
    };

    const nextPractice = {
      schema_version: 2,
      last_at: now,
      weekly_key: currentWeek,
      sessions_this_week: sessionsThisWeek,
      last_ready_for_class_at: readyForClass ? now : (prev.last_ready_for_class_at || null),
      history: [entry, ...(Array.isArray(prev.history) ? prev.history : [])].slice(0, 20),
      diamond_awards: diamondAwards,
    };

    const nextCodeData = {
      ...freshCodeData,
      progress: {
        ...progress,
        minny_practice: nextPractice,
        last_activity_at: now,
      },
    };

    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(nextCodeData));

    return json({
      ok: true,
      sessions_this_week: sessionsThisWeek,
      diamonds_awarded: diamondsAwarded,
      diamond_balance: diamondBalance,
      message_vi: readyForClass
        ? 'Minny đã lưu — hẹn gặp con trong lớp coaching với Felix!'
        : 'Minny đã lưu buổi luyện của con.',
    });
  } finally {
    releaseLock();
  }
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
