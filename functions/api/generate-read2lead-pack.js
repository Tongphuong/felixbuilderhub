const GENERATION_LOCK_STALE_MS = 15 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (data.website) {
    return json({ ok: false, error: 'Spam detected' }, 400);
  }

  const errors = validate(data);
  if (errors.length) {
    return json({ ok: false, error: 'Validation failed', fields: errors }, 400);
  }

  const accessCode = (data.access_code || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }

  if (!env.READ2LEAD_CODES) {
    console.error('READ2LEAD_CODES KV binding missing');
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình mã. Vui lòng nhắn Zalo Felix.' }, 500);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã không tồn tại. Kiểm tra lại hoặc nhắn Zalo Felix.' }, 403);
  }

  const availabilityError = checkCodeAvailability(codeData);
  if (availabilityError) return availabilityError;

  const progress = normalizeProgress(codeData, data);
  if (currentPackBlocksGeneration(progress.current_pack)) {
    return json(
      {
        ok: false,
        error: progress.current_pack.status === 'generation_in_progress' ? 'generation_in_progress' : 'previous_pack_needs_review',
        message:
          progress.current_pack.status === 'generation_in_progress'
            ? 'Felixar đang tạo bài cho con. Vui lòng đợi thêm một chút, đừng bấm tạo lại.'
            : 'Bài trước cần nộp ảnh bài làm và ghi âm con kể lại câu chuyện trước khi mở bài mới.',
        review_link: `/read2lead/review?code=${encodeURIComponent(accessCode)}`,
        current_pack: publicPack(progress.current_pack),
        progress: publicProgress(progress),
      },
      409,
    );
  }

  const backendUrl = env.READ2LEAD_BACKEND_URL;
  if (!backendUrl) {
    return json({ ok: false, error: 'backend_not_configured', message: 'Backend chưa cấu hình.' }, 500);
  }
  const backendSecret = env.READ2LEAD_BACKEND_SECRET;
  if (!backendSecret) {
    return json({ ok: false, error: 'backend_auth_not_configured', message: 'Backend chưa cấu hình bảo mật.' }, 500);
  }

  const interests = (data.interests || '').toString().trim().slice(0, 120);
  const topic = (data.topic || '').toString().trim().slice(0, 60);
  const levelForPack = progress.current_level || data.level;
  const lockCreatedAt = new Date().toISOString();
  const pendingPackId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pendingPack = {
    pack_id: pendingPackId,
    status: 'generation_in_progress',
    created_at: lockCreatedAt,
    topic: topic || '',
    story_title: 'Đang tạo bài Read2Lead',
    level: levelForPack,
  };
  const lockedProgress = {
    ...progress,
    current_level: levelForPack,
    current_pack: pendingPack,
  };
  await env.READ2LEAD_CODES.put(
    accessCode,
    JSON.stringify({
      ...codeData,
      student_profile: {
        ...(codeData.student_profile || {}),
        student_name: progress.student_name,
        age: progress.age,
        level: levelForPack,
        child_gender: progress.child_gender,
      },
      progress: lockedProgress,
    }),
  );

  try {
    const reviewUrl = `${new URL(request.url).origin}/read2lead/review?code=${encodeURIComponent(accessCode)}`;
    const upstream = await fetch(`${backendUrl}/generate-async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Read2Lead-Secret': backendSecret,
      },
      body: JSON.stringify({
        child_name: progress.student_name,
        age: progress.age,
        level: levelForPack,
        child_gender: progress.child_gender,
        interests: interests || undefined,
        topic: topic || undefined,
        review_url: reviewUrl,
      }),
    });
    if (!upstream.ok) {
      await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
      const body = await upstream.json().catch(() => ({ ok: false, error: 'backend_error' }));
      return json(body, upstream.status);
    }

    const upstreamBody = await upstream.json();
    if (!upstreamBody.ok || !upstreamBody.task_id) {
      await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
      return json({ ok: false, error: 'backend_invalid_response' }, 502);
    }

    const pendingPackWithTaskId = {
      ...pendingPack,
      task_id: upstreamBody.task_id,
    };
    const lockedProgressWithTaskId = {
      ...lockedProgress,
      current_pack: pendingPackWithTaskId,
    };
    const lockedWithTaskId = {
      ...codeData,
      student_profile: {
        ...(codeData.student_profile || {}),
        student_name: progress.student_name,
        age: progress.age,
        level: levelForPack,
        child_gender: progress.child_gender,
      },
      progress: lockedProgressWithTaskId,
    };
    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(lockedWithTaskId));

    return json({
      ok: true,
      task_id: upstreamBody.task_id,
      status: 'pending',
      current_pack: publicPack(pendingPackWithTaskId),
      progress: publicProgress(lockedProgressWithTaskId),
      level: levelForPack,
    });
  } catch (err) {
    console.error('Backend call failed:', err.message);
    await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
    return json({ ok: false, error: 'backend_unavailable', message: 'Backend không phản hồi. Thử lại sau.' }, 502);
  }
}

function validate(data) {
  const errors = [];
  if (!data.child_name || data.child_name.trim().length === 0 || data.child_name.length > 50) errors.push('child_name');
  const age = parseInt(data.age, 10);
  if (isNaN(age) || age < 5 || age > 14) errors.push('age');
  if (!['L1', 'L2', 'L3'].includes(data.level)) errors.push('level');
  if (!['boy', 'girl'].includes(data.child_gender)) errors.push('child_gender');
  return errors;
}

function checkCodeAvailability(codeData) {
  if (codeData.expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (codeData.expires_at < today) {
      return json({ ok: false, error: 'code_expired', message: 'Mã đã hết hạn. Vui lòng liên hệ Felix qua Zalo để gia hạn.' }, 403);
    }
  }

  if ((codeData.uses_remaining ?? 0) <= 0) {
    return json({ ok: false, error: 'code_exhausted', message: 'Mã đã hết lượt. Vui lòng liên hệ Felix qua Zalo để gia hạn.' }, 403);
  }
  return null;
}

function normalizeProgress(codeData, formData = {}) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const stars = Number.isFinite(progress.stars) ? progress.stars : 0;
  const formAge = parseInt(formData.age, 10);
  return {
    student_name: (formData.child_name || '').trim() || profile.student_name || '',
    age: Number.isFinite(formAge) ? formAge : (profile.age || null),
    child_gender: formData.child_gender || profile.child_gender || '',
    current_level: formData.level || progress.current_level || profile.level || 'L2',
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

function currentPackBlocksGeneration(pack) {
  if (!pack || isPackReviewed(pack)) return false;
  if (pack.status !== 'generation_in_progress') return true;

  const startedAt = Date.parse(pack.created_at || '');
  if (!Number.isFinite(startedAt)) return true;
  return Date.now() - startedAt < GENERATION_LOCK_STALE_MS;
}

async function clearGenerationLock(kv, accessCode, pendingPackId) {
  const current = await kv.get(accessCode, { type: 'json' });
  if (!current?.progress?.current_pack || current.progress.current_pack.pack_id !== pendingPackId) return;

  await kv.put(
    accessCode,
    JSON.stringify({
      ...current,
      progress: {
        ...current.progress,
        current_pack: null,
      },
    }),
  );
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
