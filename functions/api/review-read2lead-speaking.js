export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }
  if (!env.READ2LEAD_BACKEND_URL) {
    return json({ ok: false, error: 'backend_not_configured', message: 'Backend chưa cấu hình.' }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form', message: 'Không đọc được dữ liệu nộp bài.' }, 400);
  }

  const accessCode = (form.get('access_code') || '').toString().trim().toUpperCase();
  const worksheetPhoto = form.get('worksheet_photo');
  const retellAudio = form.get('retell_audio');
  const typedAnswers = (form.get('typed_answers') || '').toString().trim().slice(0, 2000);

  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }
  if (!(worksheetPhoto instanceof File) || worksheetPhoto.size === 0) {
    return json({ ok: false, error: 'worksheet_photo_required', message: 'Vui lòng tải lên ảnh bài làm của con.' }, 400);
  }
  if (!(retellAudio instanceof File) || retellAudio.size === 0) {
    return json({ ok: false, error: 'retell_audio_required', message: 'Vui lòng ghi âm phần con kể lại câu chuyện.' }, 400);
  }
  if (worksheetPhoto.size > 8 * 1024 * 1024) {
    return json({ ok: false, error: 'photo_too_large', message: 'Ảnh quá lớn. Vui lòng chụp/tải ảnh dưới 8MB.' }, 413);
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
      message: 'Bài này đã được nhận xét rồi. Con không bị mất sao, nhưng hệ thống không cộng sao lần hai.',
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
  reviewForm.set('worksheet_photo', worksheetPhoto, worksheetPhoto.name || 'worksheet.jpg');
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
      body: reviewForm,
    });
    upstream = { status: res.status, body: await res.json() };
  } catch (err) {
    console.error('Review backend failed:', err.message);
    return json({ ok: false, error: 'backend_unavailable', message: 'Hệ thống nhận xét chưa phản hồi. Vui lòng thử lại sau.' }, 502);
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
    level_recommendation: review.level_recommendation || 'stay',
    photo_review: review.photo_review || {},
  };

  const reviewedPack = {
    ...currentPack,
    status: passed ? 'reviewed_pass' : 'reviewed_retry',
    reviewed_at: reviewedAt,
    review_summary: reviewSummary,
  };

  const nextProgress = {
    ...progress,
    stars: nextStars,
    rank: rankForStars(nextStars),
    badges: badgesForStars(nextStars),
    current_pack: reviewedPack,
    review_history: [
      reviewHistoryItem(reviewedPack),
      ...(progress.review_history || []),
    ].slice(0, 20),
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
    current_pack: progress.current_pack || null,
    review_history: Array.isArray(progress.review_history) ? progress.review_history : [],
  };
}

function isPackReviewed(pack) {
  return ['reviewed_pass', 'reviewed_retry'].includes(pack.status);
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
  };
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
