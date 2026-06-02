export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình mã học sinh.' }, 500);
  }
  if (!env.READ2LEAD_BACKEND_URL) {
    return json({ ok: false, error: 'backend_not_configured', message: 'Backend chưa cấu hình.' }, 500);
  }
  const backendSecret = env.READ2LEAD_BACKEND_SECRET;
  if (!backendSecret) {
    return json({ ok: false, error: 'backend_auth_not_configured', message: 'Backend chưa cấu hình bảo mật.' }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form', message: 'Không đọc được dữ liệu nộp bài.' }, 400);
  }

  // Honeypot — silently accept bot submissions so they think they succeeded.
  const honeypot = (form.get('website') || '').toString().trim();
  if (honeypot) {
    return json({ ok: true, already_reviewed: true, message: 'Đã ghi nhận.' });
  }

  const accessCode = (form.get('access_code') || '').toString().trim().toUpperCase();
  const legacyWorksheetPhoto = form.get('worksheet_photo');
  const worksheetPhotos = form
    .getAll('worksheet_photos')
    .filter((item) => item instanceof File && item.size > 0);
  if (!worksheetPhotos.length && legacyWorksheetPhoto instanceof File && legacyWorksheetPhoto.size > 0) {
    worksheetPhotos.push(legacyWorksheetPhoto);
  }
  const retellAudio = form.get('retell_audio');
  const typedAnswers = (form.get('typed_answers') || '').toString().trim().slice(0, 2000);

  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }
  if (!worksheetPhotos.length) {
    return json({ ok: false, error: 'worksheet_photo_required', message: 'Vui lòng tải lên ít nhất 1 ảnh bài làm của con.' }, 400);
  }
  if (worksheetPhotos.length > 8) {
    return json({ ok: false, error: 'too_many_photos', message: 'Một lần nộp tối đa 8 ảnh bài làm.' }, 400);
  }
  if (!(retellAudio instanceof File) || retellAudio.size === 0) {
    return json({ ok: false, error: 'retell_audio_required', message: 'Vui lòng ghi âm phần con kể lại câu chuyện.' }, 400);
  }
  if (worksheetPhotos.some((photo) => photo.size > 8 * 1024 * 1024)) {
    return json({ ok: false, error: 'photo_too_large', message: 'Mỗi ảnh cần dưới 8MB. Vui lòng chụp/tải ảnh nhẹ hơn.' }, 413);
  }
  const totalPhotoBytes = worksheetPhotos.reduce((sum, photo) => sum + photo.size, 0);
  if (totalPhotoBytes > 24 * 1024 * 1024) {
    return json({ ok: false, error: 'photos_too_large', message: 'Tổng dung lượng ảnh cần dưới 24MB.' }, 413);
  }
  if (retellAudio.size > 15 * 1024 * 1024) {
    return json({ ok: false, error: 'audio_too_large', message: 'Audio quá lớn. Vui lòng ghi đoạn ngắn khoảng 30-60 giây.' }, 413);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 403);
  }

  const progress = normalizeProgress(codeData);
  const currentPack = progress.current_pack;
  if (!currentPack) {
    return json({ ok: false, error: 'no_pack', message: 'Mã này chưa có bài đọc nào để nộp. Vui lòng tạo bài trước.' }, 400);
  }
  if (isPackReviewed(currentPack)) {
    return json({
      ok: true,
      already_reviewed: true,
      message: 'Bài này đã được nhận xét rồi. Con không bị mất sao, nhưng Felixar không cộng sao lần hai.',
      progress: publicProgress(progress),
      current_pack: publicPack(currentPack),
      review: currentPack.review_summary || null,
      next_pack_unlocked: true,
    });
  }
  if (!currentPack.review_context) {
    return json({ ok: false, error: 'missing_context', message: 'Bài này thiếu dữ liệu review. Vui lòng tạo lại bài hoặc nhắn Felix.' }, 400);
  }

  const reviewForm = new FormData();
  worksheetPhotos.forEach((photo, index) => {
    reviewForm.append('worksheet_photos', photo, photo.name || `worksheet-${index + 1}.jpg`);
  });
  reviewForm.set('retell_audio', retellAudio, retellAudio.name || 'retell.webm');
  if (typedAnswers) {
    reviewForm.set('typed_answers', typedAnswers);
  }
  reviewForm.set(
    'context',
    JSON.stringify({
      ...currentPack.review_context,
      student_name: progress.student_name || currentPack.review_context.student_name,
      age: progress.age || currentPack.review_context.age,
      level_label: currentPack.review_context.level_label || currentPack.level,
    }),
  );

  let upstream;
  try {
    const res = await fetch(`${env.READ2LEAD_BACKEND_URL}/review`, {
      method: 'POST',
      headers: {
        'X-Read2Lead-Secret': backendSecret,
      },
      body: reviewForm,
    });
    upstream = { status: res.status, body: await res.json() };
  } catch (err) {
    console.error('Review backend failed:', err.message);
    return json({ ok: false, error: 'backend_unavailable', message: 'Felixar chưa phản hồi. Vui lòng thử lại sau.' }, 502);
  }

  if (!upstream.body || !upstream.body.ok) {
    return json(upstream.body || { ok: false, error: 'review_failed' }, upstream.status || 500);
  }

  const review = upstream.body.review;
  const passed = Boolean(review.passed);
  const oldStars = progress.stars || 0;
  const nextStars = passed ? oldStars + 1 : oldStars;
  const reviewedAt = new Date().toISOString();
  const reviewSummary = {
    reviewed_at: reviewedAt,
    passed,
    star_awarded: passed,
    transcript: review.transcript || '',
    scores: review.scores || {},
    feedback_vi: review.feedback_vi || {},
    mini_practice_vi: review.mini_practice_vi || {},
    level_recommendation: review.level_recommendation || 'stay',
    photo_review: review.photo_review || {},
  };

  const reviewedPack = {
    ...currentPack,
    status: passed ? 'reviewed_pass' : 'reviewed_retry',
    reviewed_at: reviewedAt,
    review_summary: reviewSummary,
  };

  const nextReviewHistory = [
    reviewHistoryItem(reviewedPack),
    ...(progress.review_history || []),
  ].slice(0, 20);
  const nextProgress = {
    ...progress,
    stars: nextStars,
    rank: rankForStars(nextStars),
    badges: badgesForStars(nextStars),
    completed_packs: (progress.completed_packs || 0) + 1,
    weekly_completed_count: nextWeeklyCompletedCount(progress, reviewedAt),
    weekly_key: weekKey(reviewedAt),
    streak_days: nextStreakDays(progress.last_activity_at, reviewedAt, progress.streak_days),
    last_activity_at: reviewedAt,
    last_level_recommendation: reviewSummary.level_recommendation,
    current_pack: reviewedPack,
    review_history: nextReviewHistory,
  };

  const updatedCode = {
    ...codeData,
    progress: nextProgress,
    student_profile: {
      ...(codeData.student_profile || {}),
      student_name: progress.student_name,
      age: progress.age,
      level: nextProgress.current_level,
      child_gender: progress.child_gender,
    },
    last_reviewed_at: reviewedAt,
  };
  await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCode));

  const alert = buildReviewAlert({
    accessCode,
    progress: nextProgress,
    currentPack: reviewedPack,
    reviewSummary,
    origin: new URL(request.url).origin,
  });
  if (alert) {
    const alertPromise = sendTelegramAlert(env, alert);
    if (context.waitUntil) context.waitUntil(alertPromise);
    else await alertPromise;
  }

  return json({
    ok: true,
    passed,
    star_awarded: passed,
    next_pack_unlocked: true,
    message: passed
      ? 'Con đã hoàn thành bài này và được cộng 1 sao.'
      : 'Bài này đã được nhận xét. Con chưa được cộng sao, nhưng bài tiếp theo cùng mức sẽ được mở để con luyện thêm.',
    review: reviewSummary,
    progress: publicProgress(nextProgress),
    current_pack: publicPack(reviewedPack),
  });
}

function normalizeProgress(codeData) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const stars = Number.isFinite(progress.stars) ? progress.stars : 0;
  return {
    student_name: profile.student_name || progress.student_name || '',
    age: profile.age || progress.age || null,
    child_gender: profile.child_gender || progress.child_gender || '',
    current_level: progress.current_level || profile.level || 'L2',
    stars,
    rank: progress.rank || rankForStars(stars),
    badges: Array.isArray(progress.badges) ? progress.badges : badgesForStars(stars),
    packs_created: progress.packs_created || 0,
    completed_packs: numberOrZero(progress.completed_packs) || (Array.isArray(progress.review_history) ? progress.review_history.length : 0),
    weekly_completed_count: numberOrZero(progress.weekly_completed_count),
    weekly_key: progress.weekly_key || '',
    streak_days: numberOrZero(progress.streak_days),
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: progress.current_pack || null,
    review_history: Array.isArray(progress.review_history) ? progress.review_history : [],
  };
}

function isPackReviewed(pack) {
  return ['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web'].includes(pack.status);
}

function publicPack(pack) {
  if (!pack) return null;
  return {
    pack_id: pack.pack_id,
    status: pack.status,
    topic: pack.topic,
    story_title: pack.story_title,
    level: pack.level,
    pdf_url: pack.pdf_url,
    mp3_url: pack.mp3_url,
  };
}

function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    current_level: progress.current_level,
    stars: progress.stars || 0,
    rank: progress.rank || rankForStars(progress.stars || 0),
    badges: progress.badges || badgesForStars(progress.stars || 0),
    completed_packs: progress.completed_packs || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: publicPack(progress.current_pack),
  };
}

function reviewHistoryItem(pack) {
  const summary = pack.review_summary || {};
  return {
    pack_id: pack.pack_id,
    story_title: pack.story_title,
    topic: pack.topic,
    level: pack.level,
    reviewed_at: summary.reviewed_at,
    passed: summary.passed,
    star_awarded: summary.star_awarded,
    level_recommendation: summary.level_recommendation,
    scores: summary.scores || {},
    feedback_vi: summary.feedback_vi || {},
    mini_practice_vi: summary.mini_practice_vi || {},
  };
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function weekKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function nextWeeklyCompletedCount(progress, reviewedAt) {
  const currentWeek = weekKey(reviewedAt);
  if (!currentWeek) return 1;
  return progress.weekly_key === currentWeek ? numberOrZero(progress.weekly_completed_count) + 1 : 1;
}

function nextStreakDays(lastActivityAt, reviewedAt, currentStreak = 0) {
  if (!lastActivityAt) return 1;
  if (sameUtcDate(lastActivityAt, reviewedAt)) return numberOrZero(currentStreak) || 1;
  return previousUtcDate(lastActivityAt, reviewedAt) ? numberOrZero(currentStreak) + 1 : 1;
}

function sameUtcDate(a, b) {
  return String(a || '').slice(0, 10) === String(b || '').slice(0, 10);
}

function previousUtcDate(previous, current) {
  const prev = Date.parse(`${String(previous || '').slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${String(current || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(prev) || !Number.isFinite(now)) return false;
  return now - prev === 24 * 60 * 60 * 1000;
}

function buildReviewAlert({ accessCode, progress, currentPack, reviewSummary, origin }) {
  const reasons = [];
  if (!reviewSummary.passed) reasons.push('review_fail');
  if (reviewSummary.level_recommendation === 'easier') reasons.push('level_easier');
  if (hasConsecutiveUnpassed(progress.review_history, 2)) reasons.push('two_reviews_without_star');
  if (!reasons.length) return null;

  return [
    '⚠️ FELIXAR NEEDS ATTENTION',
    '',
    `Lý do: ${reasons.join(', ')}`,
    `Mã: ${maskAccessCode(accessCode)}`,
    `Học sinh: ${progress.student_name || '(chưa rõ tên)'}`,
    `Level: ${currentPack.level || progress.current_level || '(không rõ)'}`,
    `Bài: ${currentPack.story_title || '(không rõ)'}`,
    `Sao hiện tại: ${progress.stars || 0}`,
    `Gợi ý level: ${levelRecommendationLabel(reviewSummary.level_recommendation)}`,
    '',
    `Tóm tắt: ${reviewSummary.feedback_vi?.summary || '(không có)'}`,
    `Cần luyện: ${reviewSummary.feedback_vi?.practice || '(không có)'}`,
    '',
    `Admin: ${origin}/admin/codes`,
  ].join('\n');
}

function hasConsecutiveUnpassed(reviewHistory, count) {
  if (!Array.isArray(reviewHistory) || reviewHistory.length < count) return false;
  return reviewHistory.slice(0, count).every((item) => item && item.passed === false);
}

async function sendTelegramAlert(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
      }),
    });
  } catch (err) {
    console.error('Felixar alert failed:', err.message);
  }
}

function maskAccessCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (clean.length <= 4) return '***';
  return `${clean.slice(0, 4)}***${clean.slice(-4)}`;
}

function levelRecommendationLabel(value) {
  return {
    easier: 'Nên dễ hơn',
    stay: 'Giữ level',
    move_up: 'Có thể tăng level',
  }[value] || 'Giữ level';
}

function rankForStars(stars) {
  if (stars >= 15) return 'Reading Champion';
  if (stars >= 10) return 'Story Hero';
  if (stars >= 6) return 'Mission Builder';
  if (stars >= 3) return 'Chunk Explorer';
  if (stars >= 1) return 'Story Starter';
  return 'Rookie Reader';
}

function badgesForStars(stars) {
  const badges = [];
  if (stars >= 1) badges.push('First Mission Complete');
  if (stars >= 3) badges.push('Chunk Hunter');
  if (stars >= 5) badges.push('Retell Rookie');
  if (stars >= 10) badges.push('Story Hero');
  return badges;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
