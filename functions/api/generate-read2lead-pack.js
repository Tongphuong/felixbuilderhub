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
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã. Vui lòng nhắn Zalo Felix.' }, 500);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã không tồn tại. Kiểm tra lại hoặc nhắn Zalo Felix.' }, 403);
  }

  const availabilityError = checkCodeAvailability(codeData);
  if (availabilityError) return availabilityError;

  const progress = normalizeProgress(codeData, data);
  if (progress.current_pack && !isPackReviewed(progress.current_pack)) {
    return json(
      {
        ok: false,
        error: 'previous_pack_needs_review',
        message: 'Bài trước cần nộp ảnh bài làm và ghi âm con kể lại câu chuyện trước khi mở bài mới.',
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

  let upstreamResult;
  try {
    const interests = (data.interests || '').toString().trim().slice(0, 120);
    const topic = (data.topic || '').toString().trim().slice(0, 60);
    const levelForPack = progress.current_level || data.level;
    const reviewUrl = `${new URL(request.url).origin}/read2lead/review?code=${encodeURIComponent(accessCode)}`;
    const upstream = await fetch(`${backendUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        child_name: progress.student_name || data.child_name,
        age: progress.age || parseInt(data.age, 10),
        level: levelForPack,
        child_gender: progress.child_gender || data.child_gender,
        interests: interests || undefined,
        topic: topic || undefined,
        review_url: reviewUrl,
      }),
    });
    upstreamResult = { status: upstream.status, body: await upstream.json() };
  } catch (err) {
    console.error('Backend call failed:', err.message);
    return json({ ok: false, error: 'backend_unavailable', message: 'Backend không phản hồi. Thử lại sau.' }, 502);
  }

  if (upstreamResult.body && upstreamResult.body.ok) {
    const packId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = new Date().toISOString();
    const pack = {
      pack_id: packId,
      status: 'awaiting_review',
      created_at: now,
      pdf_url: upstreamResult.body.pdf_url,
      mp3_url: upstreamResult.body.mp3_url,
      topic: upstreamResult.body.topic,
      story_title: upstreamResult.body.story_title,
      level: progress.current_level || data.level,
      review_context: upstreamResult.body.review_context || null,
    };

    const nextProgress = {
      ...progress,
      current_level: pack.level,
      current_pack: pack,
      packs_created: (progress.packs_created || 0) + 1,
      rank: rankForStars(progress.stars || 0),
      badges: badgesForStars(progress.stars || 0),
    };

    const updatedCode = {
      ...codeData,
      student_profile: {
        student_name: progress.student_name || data.child_name,
        age: progress.age || parseInt(data.age, 10),
        level: nextProgress.current_level,
        child_gender: progress.child_gender || data.child_gender,
      },
      progress: nextProgress,
      uses_remaining: (codeData.uses_remaining ?? 0) - 1,
      last_used_at: now.slice(0, 10),
    };
    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCode));

    upstreamResult.body = {
      ok: true,
      pdf_url: pack.pdf_url,
      mp3_url: pack.mp3_url,
      topic: pack.topic,
      story_title: pack.story_title,
      review_link: `/read2lead/review?code=${encodeURIComponent(accessCode)}`,
      current_pack: publicPack(pack),
      progress: publicProgress(nextProgress),
    };
  }

  return json(upstreamResult.body, upstreamResult.status);
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
  return {
    student_name: profile.student_name || formData.child_name || '',
    age: profile.age || parseInt(formData.age, 10) || null,
    child_gender: profile.child_gender || formData.child_gender || '',
    current_level: progress.current_level || profile.level || formData.level || 'L2',
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
