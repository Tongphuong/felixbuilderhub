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
  const progress = codeData.progress || {};
  const prev = progress.minny_practice || {};
  const currentWeek = weekKey(now);
  const sessionsThisWeek = prev.weekly_key === currentWeek
    ? numberOrZero(prev.sessions_this_week) + 1
    : 1;

  const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, summary);

  // --- Diamond award: genuine completion signal only, anti-farming caps ---
  const todayKey = todayVN();
  const prevAwards = prev.diamond_awards || {};
  const sameDay = prevAwards.day_key === todayKey;
  const sameWeek = prevAwards.week_key === currentWeek;
  let homeworkCount = sameDay ? numberOrZero(prevAwards.homework_count) : 0;
  let freetalkCount = sameDay ? numberOrZero(prevAwards.freetalk_count) : 0;
  let weekTotal = sameWeek ? numberOrZero(prevAwards.week_total) : 0;

  let diamondsToAward = 0;
  if (promptId === 'homework_summary') {
    if (homeworkCount < HOMEWORK_DAILY_CAP && weekTotal + HOMEWORK_DIAMOND_REWARD <= WEEKLY_DIAMOND_CAP) {
      diamondsToAward = HOMEWORK_DIAMOND_REWARD;
    }
  } else if (promptId === 'free_talk_summary') {
    if (freetalkCount < FREE_TALK_DAILY_CAP && weekTotal + FREE_TALK_DIAMOND_REWARD <= WEEKLY_DIAMOND_CAP) {
      diamondsToAward = FREE_TALK_DIAMOND_REWARD;
    }
  }

  let diamondsAwarded = 0;
  let diamondBalance = null;
  if (diamondsToAward > 0) {
    const rewardResult = await rewardStudent(env, accessCode, { diamondDelta: diamondsToAward, coinsDelta: 0 });
    if (rewardResult?.ok) {
      diamondsAwarded = diamondsToAward;
      diamondBalance = Number(rewardResult.read2lead_state?.diamonds) || 0;
      if (promptId === 'homework_summary') homeworkCount += 1;
      else if (promptId === 'free_talk_summary') freetalkCount += 1;
      weekTotal += diamondsAwarded;
    }
  }

  if (diamondBalance === null) {
    // Nothing was awarded (ineligible, capped, or the reward call failed) —
    // report the student's actual current balance, not a stale/zero value.
    const state = await loadProgressState(env, accessCode, codeData);
    diamondBalance = Number(publicProgressState(state).diamonds) || 0;
  }

  const diamondAwards = {
    day_key: todayKey,
    homework_count: homeworkCount,
    freetalk_count: freetalkCount,
    week_key: currentWeek,
    week_total: weekTotal,
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
    ...codeData,
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
