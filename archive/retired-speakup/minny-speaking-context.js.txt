import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { normalizeHomeworkRecord } from './_homework.js';
import { loadProgressState, publicProgressState } from './_read2lead-v2-state.js';

// SpeakUp is a separate product from Read2Lead: they share student codes and
// profile/XP state, never activities. This endpoint must not read the kid's
// Read2Lead pack/story (Phương, 2026-07-06 — retell/questions modes removed).

// Schema v3 (2026-07-13): tasks[] -> steps[] compiler. Every step keeps the
// exact field names the client and grader already use; the only new field
// is the additive `task_type`. Everything compiles onto the existing
// read/frame/open check_modes — zero new grading code, zero new check_modes
// (contract `homework-tasks-contract.md` §0/§3).
//
// v1/v2 records upgrade to tasks[] in memory via normalizeHomeworkRecord
// before reaching this function, so this compiler only ever sees v3 shape —
// but the STEPS it emits for an upgraded v2 record must be byte-identical to
// today's output (see tests/minny-speaking.test.mjs deep-equal fixtures).
export function buildHomeworkSteps(codeData) {
  const homework = normalizeHomeworkRecord(codeData?.homework);
  if (!homework) return null;
  const tasks = Array.isArray(homework.tasks) ? homework.tasks : [];
  const steps = [];

  // Step ids must be unique: the kid client keys progress, scoring and the
  // fix-it round off them. Item/card ids restart at s1/q1 inside every task
  // and `present` uses the literal 'hw_frame', so two tasks of the SAME type
  // (a vocabulary list AND a sentence list; two presentations) would collide.
  //
  // Dedupe on collision only, never pre-emptively: the FIRST use of a base id
  // is always handed back unchanged, and the v1/v2 upgrade path can only ever
  // produce one task of each type — so legacy records keep byte-identical step
  // ids and the regression gate still holds.
  const usedIds = new Set();
  const uniqueId = (base) => {
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let n = 2;
    while (usedIds.has(`${base}_${n}`)) n += 1;
    const id = `${base}_${n}`;
    usedIds.add(id);
    return id;
  };

  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;

    if (task.type === 'read') {
      for (const item of (Array.isArray(task.items) ? task.items : [])) {
        steps.push({
          id: uniqueId(`hw_${item.id}`),
          kind: 'homework',
          task_type: 'read',
          prompt_vi: 'Con đọc câu này cho Minny nghe nhé',
          prompt_en: item.text_en,
          expected_text: item.text_en,
          check_mode: 'read',
          max_seconds: 30,
        });
      }
    } else if (task.type === 'present') {
      if (Array.isArray(task.stems) && task.stems.length) {
        steps.push({
          id: uniqueId('hw_frame'),
          kind: 'speech',
          task_type: 'present',
          check_mode: 'frame',
          prompt_vi: 'Con thuyết trình theo khung nhé — nói một mạch!',
          stems: task.stems,
          max_seconds: (task.duration_s || 60) + 15,
        });
      }
    } else if (task.type === 'story') {
      steps.push({
        id: uniqueId(`hw_${task.id}`),
        kind: 'speech',
        task_type: 'story',
        check_mode: 'frame',
        prompt_vi: task.prompt_vi || 'Con kể chuyện cho Minny nghe nhé — nói một mạch!',
        prompt_en: task.prompt_en,
        stems: [{ id: 'story', text_en: task.prompt_en, anchor_words: Array.isArray(task.must_use) ? task.must_use : [] }],
        must_use: Array.isArray(task.must_use) ? task.must_use : [],
        show_photo: !!task.use_photo,
        max_seconds: (task.duration_s || 90) + 15,
      });
    } else if (task.type === 'picture') {
      if (Array.isArray(task.anchors) && task.anchors.length) {
        // Coverage-scored picture describe — opt-in (anchors present).
        steps.push({
          id: uniqueId(`hw_${task.id}`),
          kind: 'speech',
          task_type: 'picture',
          check_mode: 'frame',
          prompt_vi: 'Con xem ảnh rồi kể cho Minny nghe con thấy gì nhé — nói một mạch!',
          stems: [{ id: 'picture', text_en: '', anchor_words: task.anchors }],
          show_photo: true,
          max_seconds: (task.duration_s || 60) + 15,
        });
      } else {
        // Zero anchors: the ONE intentional behaviour carve-out (contract
        // §3) — a picture task with no anchors emits the LEGACY step
        // exactly as today's photo_talk (check_mode:'open',
        // expected_text:'photo_talk'). This is what a v1/v2 photo-only
        // record upgrades to, and it MUST keep grading byte-identical to
        // today — getting this wrong silently changes live kids' scores.
        steps.push({
          id: uniqueId('hw_photo_talk'),
          kind: 'speech',
          task_type: 'picture',
          check_mode: 'open',
          expected_text: 'photo_talk',
          prompt_vi: 'Con xem ảnh bài tập rồi thuyết trình theo ảnh nhé — nói một mạch!',
          max_seconds: (task.duration_s || 60) + 15,
        });
      }
    } else if (task.type === 'build') {
      const n = Math.max(1, Math.min(5, Number(task.sentences_required) || 1));
      for (let i = 1; i <= n; i++) {
        steps.push({
          id: uniqueId(`hw_${task.id}_${i}`),
          kind: 'build',
          task_type: 'build',
          check_mode: 'read',
          prompt_vi: 'Con chọn một ô ở mỗi cột rồi nói câu của con nhé',
          columns: task.columns,
          max_seconds: 30,
        });
      }
    } else if (task.type === 'qa') {
      for (const card of (Array.isArray(task.cards) ? task.cards : [])) {
        steps.push({
          id: uniqueId(`hw_${card.id}`),
          kind: 'speech',
          task_type: 'qa',
          check_mode: 'frame',
          prompt_vi: 'Con trả lời câu hỏi của Minny nhé',
          prompt_en: card.question_en,
          stems: [card.stem],
          max_seconds: (task.duration_s || 30) + 15,
        });
      }
    }
  }

  // Safety net (Mark, 2026-07-13): a homework record whose tasks[] compiled
  // to zero steps but still carries a photo gets the same legacy speaking
  // step as today's photo-only fallback. For the v1/v2 upgrade path this is
  // provably redundant — normalizeHomeworkRecord always synthesizes a
  // zero-anchor picture task in that exact case, which the branch above
  // already turns into this identical step. It only ever fires for a
  // hand-built v3 record with an empty tasks[] and a photo but no explicit
  // picture task — an edge case the contract doesn't spell out; flagged to
  // Elon in the dispatch report rather than silently deciding it away.
  if (!steps.length && homework.photo) {
    const talkSeconds = homework.photo_talk?.duration_s || 60;
    steps.push({
      id: 'hw_photo_talk',
      kind: 'speech',
      task_type: 'picture',
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

  // A KV hiccup loading progress state must only degrade the diamond pill,
  // never the whole bootstrap response a kid needs to start practicing.
  let diamondBalance = 0;
  try {
    const progressState = await loadProgressState(env, accessCode, codeData);
    diamondBalance = Number(publicProgressState(progressState).diamonds) || 0;
  } catch (err) {
    console.error('[minny-speaking-context] loadProgressState failed', accessCode, err?.message || err);
  }

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
    diamond_balance: diamondBalance,
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
