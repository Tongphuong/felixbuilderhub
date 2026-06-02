export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình bảng vinh danh.' }, 500);
  }

  const url = new URL(request.url);
  const requestedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;

  const leaders = [];
  let cursor;

  do {
    const list = await env.READ2LEAD_CODES.list({ limit: 100, cursor });
    cursor = list.cursor;

    const records = await Promise.all(
      list.keys.map(async (key) => {
        const value = await env.READ2LEAD_CODES.get(key.name, { type: 'json' });
        return value ? publicLeader(key.name, value) : null;
      }),
    );

    for (const record of records) {
      if (record) leaders.push(record);
    }
  } while (cursor);

  leaders.sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (b.completed_packs !== a.completed_packs) return b.completed_packs - a.completed_packs;
    return Date.parse(b.last_reviewed_at || 0) - Date.parse(a.last_reviewed_at || 0);
  });

  return json({
    ok: true,
    updated_at: new Date().toISOString(),
    leaders: leaders.slice(0, limit).map((leader, index) => ({
      position: index + 1,
      ...leader,
    })),
  });
}

function publicLeader(code, codeData) {
  const progress = codeData.progress || {};
  const profile = codeData.student_profile || {};
  const stars = numberOrZero(progress.stars);
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const completedPacks = numberOrZero(progress.completed_packs) || reviewHistory.length || stars;
  const studentName = cleanName(profile.student_name || progress.student_name || '');

  if (!studentName && stars === 0 && completedPacks === 0) return null;

  const rank = progress.rank || rankForStars(stars);

  return {
    display_name: studentName || 'Bạn đọc bí mật',
    masked_code: maskCode(code),
    stars,
    completed_packs: completedPacks,
    rank,
    rank_vi: rankVi(rank),
    badges_vi: badgesVi(Array.isArray(progress.badges) ? progress.badges : badgesForStars(stars)),
    current_level: progress.current_level || profile.level || 'L2',
    last_reviewed_at: codeData.last_reviewed_at || progress.last_activity_at || progress.last_reviewed_at || latestReviewDate(reviewHistory),
  };
}

function cleanName(name) {
  return name.toString().trim().replace(/\s+/g, ' ').slice(0, 40);
}

function maskCode(code) {
  const clean = code.toString().trim().toUpperCase();
  const last = clean.slice(-4) || '----';
  if (clean.startsWith('R2L-')) return `R2L-***${last}`;
  return `***${last}`;
}

function latestReviewDate(reviewHistory) {
  return reviewHistory
    .map((item) => item.reviewed_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function rankForStars(stars) {
  if (stars >= 15) return 'Reading Champion';
  if (stars >= 10) return 'Story Hero';
  if (stars >= 6) return 'Mission Builder';
  if (stars >= 3) return 'Chunk Explorer';
  if (stars >= 1) return 'Story Starter';
  return 'Rookie Reader';
}

function rankVi(rank) {
  return {
    'Rookie Reader': 'Mầm Đọc Sách',
    'Story Starter': 'Người Kể Chuyện Nhí',
    'Chunk Explorer': 'Nhà Khám Phá Câu',
    'Mission Builder': 'Người Hoàn Thành Nhiệm Vụ',
    'Story Hero': 'Anh Hùng Câu Chuyện',
    'Reading Champion': 'Nhà Vô Địch Đọc',
  }[rank] || rank;
}

function badgesForStars(stars) {
  const badges = [];
  if (stars >= 1) badges.push('First Mission Complete');
  if (stars >= 3) badges.push('Chunk Hunter');
  if (stars >= 5) badges.push('Retell Rookie');
  if (stars >= 10) badges.push('Story Hero');
  return badges;
}

function badgesVi(badges) {
  const labels = {
    'First Mission Complete': 'Hoàn thành bài đầu tiên',
    'Chunk Hunter': 'Nhà săn sao',
    'Retell Rookie': 'Kể lại tự tin',
    'Story Hero': 'Anh hùng câu chuyện',
  };
  return badges.map((badge) => labels[badge] || badge).slice(0, 4);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
