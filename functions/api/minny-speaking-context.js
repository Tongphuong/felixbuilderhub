import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { normalizeHomeworkRecord } from './_homework.js';

// SpeakUp is a separate product from Read2Lead: they share student codes and
// profile/XP state, never activities. This endpoint must not read the kid's
// Read2Lead pack/story (Phương, 2026-07-06 — retell/questions modes removed).

export function buildHomeworkSteps(codeData) {
  const homework = normalizeHomeworkRecord(codeData?.homework);
  if (!homework) return null;
  const sentences = Array.isArray(homework.sentences) ? homework.sentences : [];
  const frame = homework.frame || null;
  const steps = [];

  for (const item of sentences) {
    steps.push({
      id: `hw_${item.id}`,
      kind: 'homework',
      prompt_vi: 'Con đọc câu này cho Minny nghe nhé',
      prompt_en: item.text_en,
      expected_text: item.text_en,
      check_mode: 'read',
      max_seconds: 30,
    });
  }

  if (frame && Array.isArray(frame.stems) && frame.stems.length) {
    steps.push({
      id: 'hw_frame',
      kind: 'speech',
      check_mode: 'frame',
      prompt_vi: 'Con thuyết trình theo khung nhé — nói một mạch!',
      stems: frame.stems,
      max_seconds: (frame.duration_s || 60) + 15,
    });
  }

  // Photo-only homework: the photo carries the task; the kid looks at it
  // and speaks. Graded pronunciation-only downstream (open check mode).
  if (!steps.length && homework.photo) {
    const talkSeconds = homework.photo_talk?.duration_s || 60;
    steps.push({
      id: 'hw_photo_talk',
      kind: 'speech',
      check_mode: 'open',
      expected_text: 'photo_talk',
      prompt_vi: 'Con xem ảnh bài tập rồi thuyết trình theo ảnh nhé — nói một mạch!',
      max_seconds: talkSeconds + 15,
    });
  }

  const note = homework.note_vi || '';
  const updatedAt = homework.updated_at || '';

  return {
    id: 'homework',
    title_vi: 'Bài tập thầy giao',
    subtitle_vi: note ? `Thầy Phương nhắn: ${note}` : 'Thầy Phương giao bài tập luyện nói.',
    steps,
    photo: homework.photo ? { id: homework.photo.id } : null,
    homework_note_vi: note,
    homework_updated_at: updatedAt,
  };
}

export function buildSpeakingModes(codeData) {
  const modes = [];

  const homeworkMode = buildHomeworkSteps(codeData);
  if (homeworkMode) {
    modes.push(homeworkMode);
  }

  modes.push({
    id: 'free_talk',
    title_vi: 'Nói chuyện với Minny',
    subtitle_vi: 'Con trò chuyện tự do với Minny bằng tiếng Anh.',
    steps: [],
  });

  return modes;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) return rateLimitedResponse(rl.retryAfter);

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const studentName = profile.student_name || progress.student_name || '';
  const practiceLog = progress.minny_practice || { sessions_this_week: 0, last_at: null };

  const profileLink = `/ho-so?code=${encodeURIComponent(accessCode)}`;
  const coachingLink = '/coaching#book';

  const modes = buildSpeakingModes(codeData);

  let greeting;
  const homeworkMode = modes.find(m => m.id === 'homework');
  if (homeworkMode && homeworkMode.homework_updated_at) {
    const dateStr = new Date(homeworkMode.homework_updated_at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
    greeting = `Chào ${studentName || 'bé'}! Hôm nay mình luyện bài thầy Phương giao ngày ${dateStr} — chuẩn bị cho buổi coaching với Felix nhé.`;
  } else if (homeworkMode) {
    greeting = `Chào ${studentName || 'bé'}! Hôm nay mình luyện bài thầy Phương giao — chuẩn bị cho buổi coaching với Felix nhé.`;
  } else {
    greeting = `Chào ${studentName || 'bé'}! Minny sẵn sàng luyện nói cùng con.`;
  }

  // has_story / pack_id / story_title are kept for response-shape stability
  // with the page JS; SpeakUp no longer reads any Read2Lead story.
  return json({
    ok: true,
    student_name: studentName,
    // V1.2 packet 2 (2026-07-12): the client needs the level BEFORE calling
    // start — the topic picker renders only at L3+ (same lookup
    // minny-conversation.js uses for the session level).
    level: codeData?.progress?.current_level || codeData?.student_profile?.level || 'L1',
    has_story: false,
    pack_id: 'general',
    story_title: '',
    modes,
    greeting_vi: greeting,
    practice_count_this_week: numberOrZero(practiceLog.sessions_this_week),
    coaching_link: coachingLink,
    profile_link: profileLink,
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
