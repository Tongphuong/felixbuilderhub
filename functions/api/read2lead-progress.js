export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (!code) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }

  const codeData = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeData) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  const progress = normalizeProgress(codeData);
  const requireReviewBeforeNextPack = shouldRequireReviewBeforeNextPack(codeData);
  return json({
    ok: true,
    progress: publicProgress(progress),
    next_pack_locked: currentPackBlocksGeneration(progress.current_pack, requireReviewBeforeNextPack),
    review_link: `/read2lead/review?code=${encodeURIComponent(code)}`,
  });
}

function normalizeProgress(codeData) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const stars = Number.isFinite(progress.stars) ? progress.stars : 0;
  return {
    student_name: profile.student_name || progress.student_name || '',
    age: profile.age || progress.age || null,
    current_level: progress.current_level || profile.level || 'L2',
    stars,
    rank: progress.rank || rankForStars(stars),
    badges: Array.isArray(progress.badges) ? progress.badges : badgesForStars(stars),
    current_pack: progress.current_pack || null,
  };
}

function isPackReviewed(pack) {
  return ['reviewed_pass', 'reviewed_retry'].includes(pack.status);
}

function shouldRequireReviewBeforeNextPack(codeData) {
  return !(codeData.is_test === true || codeData.is_shared === true);
}

function currentPackBlocksGeneration(pack, requireReviewBeforeNextPack = true) {
  if (!pack) return false;
  if (pack.status === 'generation_in_progress') return true;
  return requireReviewBeforeNextPack && !isPackReviewed(pack);
}

function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    age: progress.age,
    current_level: progress.current_level,
    stars: progress.stars || 0,
    rank: progress.rank || rankForStars(progress.stars || 0),
    badges: progress.badges || badgesForStars(progress.stars || 0),
    current_pack: progress.current_pack
      ? {
          pack_id: progress.current_pack.pack_id,
          status: progress.current_pack.status,
          topic: progress.current_pack.topic,
          story_title: progress.current_pack.story_title,
          level: progress.current_pack.level,
          pdf_url: progress.current_pack.pdf_url,
          mp3_url: progress.current_pack.mp3_url,
        }
      : null,
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
