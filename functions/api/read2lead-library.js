import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { buildStoryProgressForProfile } from './_read2lead-library.js';
import { loadProgressState, PACKS_TO_NEXT_LEVEL } from './_read2lead-v2-state.js';

/** Legacy route — story progress now lives on the student profile. Redirect browsers; JSON for API clients. */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('code') || '').trim().toUpperCase();

  if (!accessCode) {
    return redirect('/read2lead/review');
  }

  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('application/json')) {
    return redirect(`/read2lead/review?code=${encodeURIComponent(accessCode)}`);
  }

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh ma hoc sinh.' }, 500);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  const progress = codeData.progress || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const v2State = await loadProgressState(env, accessCode, codeData);

  return json({
    ok: true,
    moved_to: `/read2lead/review?code=${encodeURIComponent(accessCode)}`,
    story_progress: buildStoryProgressForProfile({
      reviewHistory,
      studentName: progress.student_name || codeData.student_profile?.student_name || '',
      currentLevel: v2State.current_level,
      packsCompletedInLevel: numberOrZero(v2State.level_progress?.[v2State.current_level]),
      packsNeededForLevelUp: numberOrZero(PACKS_TO_NEXT_LEVEL[v2State.current_level]),
      accessCode,
    }),
  });
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
