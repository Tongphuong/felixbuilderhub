import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import {
  computeRankLadder,
  loadProgressState,
  PACKS_TO_NEXT_LEVEL,
  XP_PER_PASSED_PACK,
} from './_read2lead-v2-state.js';
import { reconcileStrandedPack } from './_read2lead-reconcile-stranded.js';
import { assessBookHealth } from '../../src/lib/read2lead-book-health.mjs';

const GENERATION_LOCK_STALE_MS = 15 * 60 * 1000;

// Hard cap on how many books we read+assess per assignment request, so a badly
// poisoned pool can't turn one request into an unbounded run of KV reads.
const MAX_HEALTH_ATTEMPTS = 8;

// 0-100: how far the child is through the CURRENT level (passed packs / packs
// required for the next level). null when not computable (L5 has no next level,
// or state is missing) — the backend then defaults to mid-level behavior.
export function levelProgressPercent(progressState, level) {
  const required = Number(PACKS_TO_NEXT_LEVEL[level] || 0);
  if (!required) return null;
  const xp = Number(progressState?.xp_in_level ?? progressState?.xp);
  if (!Number.isFinite(xp) || xp < 0) return null;
  const packsDone = Math.floor(xp / XP_PER_PASSED_PACK);
  return Math.max(0, Math.min(100, Math.round((packsDone / required) * 100)));
}
const BACKEND_CHILD_NAME_RE = /^[^\W\d_]+(?:[\s\-'][^\W\d_]+)*$/u;

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

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  let codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã không tồn tại. Kiểm tra lại hoặc nhắn Zalo Felix.' }, 403);
  }

  // A finished-but-stranded pack (1502dd6 outage / old manual-save funnel)
  // must not block a kid from creating their next pack — finish its save
  // from the kid's own recorded work before evaluating the gate.
  ({ codeData } = await reconcileStrandedPack({ env, accessCode, codeData }));

  const availabilityError = checkCodeAvailability(codeData);
  if (availabilityError) return availabilityError;

  const progressState = await loadProgressState(env, accessCode, codeData);
  const progress = normalizeProgress(codeData, progressState);
  const profileError = checkStudentProfile(progress);
  if (profileError) return profileError;
  const requireReviewBeforeNextPack = shouldRequireReviewBeforeNextPack(codeData);
  if (currentPackBlocksGeneration(progress.current_pack, requireReviewBeforeNextPack)) {
    const isGenerating = progress.current_pack.status === 'generation_in_progress';
    const errorCode = isGenerating ? 'generation_in_progress' : 'previous_pack_needs_review';
    const message = isGenerating
      ? 'Felixar đang tạo bài cho con. Vui lòng đợi thêm một chút, đừng bấm tạo lại.'
      : 'Bài của con sắp xong rồi! Con cần hoàn thành bài cũ trước khi mở bài mới nhé!';
    const lessonLink = isGenerating
      ? null
      : `/read2lead/lesson?code=${encodeURIComponent(accessCode)}&pack_id=${encodeURIComponent(progress.current_pack.pack_id)}`;
    return json(
      {
        ok: false,
        error: errorCode,
        message,
        ...(lessonLink ? { lesson_link: lessonLink } : {}),
        review_link: `/ho-so?code=${encodeURIComponent(accessCode)}`,
        current_pack: publicPack(progress.current_pack),
        progress: publicProgress(progress),
      },
      409,
    );
  }

  const interests = (data.interests || '').toString().trim().slice(0, 120);
  const topic = (data.topic || '').toString().trim().slice(0, 60);
  const levelForPack = normalizeKidLevel(progress.current_level);
  const useBookPool = (await loadBookLevels(env)).has(bandForLevel(levelForPack));
  const backendUrl = env.READ2LEAD_BACKEND_URL;
  const backendSecret = env.READ2LEAD_BACKEND_SECRET;
  if (!useBookPool && !backendUrl) {
    return json({ ok: false, error: 'backend_not_configured', message: 'Backend chưa cấu hình.' }, 500);
  }
  if (!useBookPool && !backendSecret) {
    return json({ ok: false, error: 'backend_auth_not_configured', message: 'Backend chưa cấu hình bảo mật.' }, 500);
  }
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
    if (useBookPool) {
      try {
        return await assignBookPack({
          env,
          accessCode,
          codeData,
          progress,
          lockedProgress,
          pendingPack,
          levelForPack,
          previousPack: progress.current_pack,
        });
      } catch (err) {
        console.error('Book assignment failed:', err?.name || 'BookAssignmentError');
        await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
        return json(
          {
            ok: false,
            error: err?.code || 'book_unavailable',
            message: err?.publicMessage || 'Chưa mở được truyện mới. Con thử lại sau một chút nhé.',
          },
          err?.status || 503,
        );
      }
    }

    const reviewUrl = `${new URL(request.url).origin}/ho-so?code=${encodeURIComponent(accessCode)}`;
    // Challenge dial uses LIFETIME points, never season RP: the W2R ladder
    // soft-resets each season, and pack difficulty must not drop with it.
    const lifetimeRp = progressState?.lifetime_rp ?? progressState?.rank_points;
    const rankPoints = Number.isFinite(Number(lifetimeRp))
      ? Math.max(0, Math.floor(Number(lifetimeRp)))
      : (() => {
        const rankLadder = computeRankLadder(progressState);
        return Number.isFinite(Number(rankLadder?.rank_points))
          ? Math.max(0, Math.floor(Number(rankLadder.rank_points)))
          : null;
      })();
    const upstreamRequestBody = {
      child_name: progress.student_name,
      age: progress.age,
      level: levelForPack,
      child_gender: progress.child_gender,
      interests: interests || undefined,
      topic: topic || undefined,
      review_url: reviewUrl,
    };
    if (rankPoints != null) {
      upstreamRequestBody.rank_points = rankPoints;
    }
    // In-level difficulty ramp (W2R backend leg): tell the generator how far the
    // child is through the CURRENT level so pack language ramps early→mid→late
    // instead of staying flat for 5-35 packs. Old backends ignore the field.
    const levelProgress = levelProgressPercent(progressState, levelForPack);
    if (levelProgress != null) {
      upstreamRequestBody.level_progress_percent = levelProgress;
    }
    const upstream = await fetch(`${backendUrl}/generate-async-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Read2Lead-Secret': backendSecret,
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify(upstreamRequestBody),
    });
    if (!upstream.ok) {
      await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
      const body = await upstream.json().catch(() => ({ ok: false, error: 'backend_error' }));
      return json(mapBackendGenerateError(body), upstream.status);
    }

    const upstreamBody = await upstream.json();
    if (upstreamBody.ok && upstreamBody.pack?.schema_version === 2) {
      const finalPack = buildFinalV2Pack({
        pendingPack,
        pack: upstreamBody.pack,
        createdAt: new Date().toISOString(),
      });
      const nextProgress = {
        ...lockedProgress,
        current_pack: finalPack,
        packs_created: (progress.packs_created || 0) + 1,
      };
      const updatedCode = {
        ...codeData,
        student_profile: {
          ...(codeData.student_profile || {}),
          student_name: progress.student_name,
          age: progress.age,
          level: finalPack.level,
          child_gender: progress.child_gender,
        },
        progress: nextProgress,
        uses_remaining: Math.max(0, (codeData.uses_remaining ?? 0) - 1),
        last_used_at: finalPack.created_at.slice(0, 10),
      };
      await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCode));

      return json({
        ok: true,
        status: 'done',
        pack_id: finalPack.pack_id,
        topic: finalPack.topic,
        story_title: finalPack.story_title,
        child_name: progress.student_name,
        review_link: `/ho-so?code=${encodeURIComponent(accessCode)}`,
        lesson_link: `/read2lead/lesson?code=${encodeURIComponent(accessCode)}&pack_id=${encodeURIComponent(finalPack.pack_id)}`,
        current_pack: publicPack(finalPack),
        progress: publicProgress(nextProgress),
        level: finalPack.level,
      });
    }

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


export function parseBookLevels(raw) {
  const allowed = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);
  return new Set(
    String(raw || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => allowed.has(value)),
  );
}

export async function loadBookLevels(env) {
  const configured = parseBookLevels(env.READ2LEAD_BOOK_LEVELS);
  if (configured.size || !env.READ2LEAD_CODES) return configured;
  const stored = await env.READ2LEAD_CODES.get('config:book_levels', { type: 'json' });
  return parseBookLevels(Array.isArray(stored) ? stored.join(',') : stored);
}

// R2L-PAGE-BANDS: kids are served books by PAGE COUNT band, not StoryWeaver
// text level (SPEC_R2L_PAGE_BANDS.md). The five book_index:<L> lists hold
// page-count bands; this maps a kid's learning level onto a shelf. Normalizes
// untrusted level values (admin-typed profiles) so a kid can never fall off
// the shelf map: unknown -> L1's band, L5 -> the longest band.
const BOOK_BAND_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);
const KID_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

// Kid levels come from admin-typed profiles — nothing upstream validates
// them, and a lowercase 'l2' used to 503 deep in the pack path. Normalize
// once at entry; unknown values fall back to L1.
export function normalizeKidLevel(level) {
  const normalized = String(level || '').trim().toUpperCase();
  return KID_LEVELS.has(normalized) ? normalized : 'L1';
}

export function bandForLevel(level) {
  const normalized = String(level || '').trim().toUpperCase();
  if (normalized === 'L5') return 'L4';
  return BOOK_BAND_LEVELS.has(normalized) ? normalized : 'L1';
}

// Expected page range per band — used only for the drift alarm below.
const BAND_PAGE_RANGES = {
  L0: [1, 6],
  L1: [7, 9],
  L2: [10, 12],
  L3: [13, 15],
  L4: [16, Infinity],
};

export function selectUnreadBook(
  rawIndex,
  completedBooks = [],
  currentBook = '',
  random = Math.random,
) {
  if (!Array.isArray(rawIndex)) return null;
  const completed = new Set(
    (Array.isArray(completedBooks) ? completedBooks : []).map((value) => String(value)),
  );
  if (currentBook) completed.add(String(currentBook));
  const unread = [...new Set(
    rawIndex
      .map((value) => String(value || '').trim())
      .filter((value) => /^book_[0-9]+$/.test(value)),
  )].filter((slug) => !completed.has(slug));
  if (!unread.length) return null;
  const roll = Number(random());
  const index = Number.isFinite(roll)
    ? Math.min(unread.length - 1, Math.max(0, Math.floor(roll * unread.length)))
    : 0;
  return unread[index];
}

function bookSlugFromPack(pack) {
  return (
    pack?.book_slug
    || pack?.review_context?.book_slug
    || pack?.pack?.book_slug
    || pack?.pack_json?.book_slug
    || ''
  );
}

class BookPoolError extends Error {
  constructor(code, publicMessage, status = 503) {
    super(code);
    this.name = 'BookPoolError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

// --- Book-pool quarantine (lightweight, optional-fail) ---------------------
// A book that fails the finishability gate is remembered per level so we skip it
// cheaply (before any `book:<slug>` read) on the next request, and so ops can see
// which books are broken. Quarantine is only an optimization — the gate re-checks
// every assignment — so a republished-clean book self-heals once its slug leaves
// the set. We quarantine only HARD (unfinishable) failures; a cosmetically-flawed
// but finishable book is never quarantined (it stays available as a last resort).

const QUARANTINE_KEY_PREFIX = 'book_quarantine:';

async function loadQuarantine(env, level) {
  try {
    const stored = await env.READ2LEAD_CODES.get(QUARANTINE_KEY_PREFIX + level, { type: 'json' });
    if (stored && typeof stored === 'object') return new Set(Object.keys(stored));
  } catch (err) {
    console.warn('quarantine_load_failed', level, err?.message || err);
  }
  return new Set();
}

async function quarantineBook(env, level, slug, reasons, now) {
  try {
    const key = QUARANTINE_KEY_PREFIX + level;
    const stored = (await env.READ2LEAD_CODES.get(key, { type: 'json' })) || {};
    stored[slug] = { at: now, reasons: reasons.map((reason) => reason.code) };
    await env.READ2LEAD_CODES.put(key, JSON.stringify(stored));
    console.warn('book_quarantine', JSON.stringify({ slug, level, reasons: stored[slug].reasons }));
  } catch (err) {
    // Never block a student on quarantine bookkeeping.
    console.warn('quarantine_write_failed', level, slug, err?.message || err);
  }
}

async function assignBookPack({
  env,
  accessCode,
  codeData,
  progress,
  lockedProgress,
  pendingPack,
  levelForPack,
  previousPack,
}) {
  const band = bandForLevel(levelForPack);
  const rawIndex = await env.READ2LEAD_CODES.get('book_index:' + band, { type: 'json' });
  if (!Array.isArray(rawIndex)) {
    throw new BookPoolError(
      'book_pool_unavailable',
      'Kho truyện đang được cập nhật. Con thử lại sau một chút nhé.',
    );
  }
  const rng = typeof env.RNG === 'function' ? env.RNG : Math.random;
  const previousSlug = bookSlugFromPack(previousPack);
  const now = new Date().toISOString();
  const quarantined = await loadQuarantine(env, band);
  const excluded = new Set();
  let chosen = null;          // { slug, pack } — a fully healthy book
  let softFallback = null;    // { slug, pack, reasons } — finishable but cosmetically flawed

  // Keep drawing unread, un-quarantined books until we find a healthy one (or run
  // out). Quarantined + already-excluded slugs are filtered out of selection, so
  // known-bad books aren't even re-read. Cosmetically-flawed books are set aside
  // as a last resort but we keep looking for a clean one first.
  for (let attempt = 0; attempt < MAX_HEALTH_ATTEMPTS; attempt += 1) {
    const slug = selectUnreadBook(
      rawIndex,
      [...(codeData.completed_books || []), ...excluded, ...quarantined],
      previousSlug,
      rng,
    );
    if (!slug) break;
    const candidatePack = await env.READ2LEAD_CODES.get('book:' + slug, { type: 'json' });
    const health = assessBookHealth(candidatePack, { now, expectedSlug: slug });
    if (health.ok) {
      // Drift alarm (never blocks the kid): a drawn book outside the kid's
      // page band means the shelf data has drifted — surface it in logs.
      const drawnPages = (candidatePack?.book_images || []).length;
      const [minPages, maxPages] = BAND_PAGE_RANGES[band] || [0, Infinity];
      if (drawnPages < minPages || drawnPages > maxPages) {
        console.warn('book_band_mismatch', JSON.stringify({ slug, band, pages: drawnPages }));
      }
      chosen = { slug, pack: candidatePack };
      break;
    }
    excluded.add(slug);
    if (health.hardOk && candidatePack) {
      // Finishable, only cosmetic defects — remember the first one, keep hunting.
      if (!softFallback) softFallback = { slug, pack: candidatePack, reasons: health.reasons };
    } else {
      // Genuinely unfinishable — quarantine so we skip it cheaply next time.
      await quarantineBook(env, band, slug, health.reasons, now);
    }
  }

  if (!chosen && softFallback) {
    // Don't strand the child: serve the least-bad finishable book and flag it.
    console.warn('book_pool_degraded', JSON.stringify({
      slug: softFallback.slug,
      level: levelForPack,
      reasons: softFallback.reasons.map((reason) => reason.code),
    }));
    chosen = { slug: softFallback.slug, pack: softFallback.pack };
  }

  if (!chosen) {
    // Distinguish "child has read every book" from "unread books exist but are all
    // broken (failed this pass or already quarantined)". The probe ignores the
    // quarantine + per-pass exclusions and only respects what the child has
    // actually completed, so a fully-quarantined pool reports needs_repair (a
    // human signal), not the misleading "you've read them all" message.
    const hasUnreadBooks = Boolean(selectUnreadBook(
      rawIndex,
      codeData.completed_books || [],
      previousSlug,
      () => 0,
    ));
    if (!hasUnreadBooks) {
      // No unread books remain at this level at all.
      throw new BookPoolError(
        'book_pool_exhausted',
        'Con đã đọc hết truyện ở cấp này rồi. Felix sẽ mở thêm truyện mới sớm nhé.',
        409,
      );
    }
    // Unread books existed but every one is unfinishable — needs a human fix.
    throw new BookPoolError(
      'book_pool_needs_repair',
      'Felix đang chỉnh lại truyện ở cấp này. Con quay lại sau một chút nhé.',
      409,
    );
  }

  const slug = chosen.slug;
  const storedPack = chosen.pack;

  const finalPack = buildFinalV2Pack({
    pendingPack,
    pack: storedPack,
    createdAt: new Date().toISOString(),
  });
  const nextProgress = {
    ...lockedProgress,
    current_pack: finalPack,
    packs_created: (progress.packs_created || 0) + 1,
  };
  await env.READ2LEAD_CODES.put(
    accessCode,
    JSON.stringify({
      ...codeData,
      student_profile: {
        ...(codeData.student_profile || {}),
        student_name: progress.student_name,
        age: progress.age,
        level: finalPack.level,
        child_gender: progress.child_gender,
      },
      progress: nextProgress,
      uses_remaining: Math.max(0, (codeData.uses_remaining ?? 0) - 1),
      last_used_at: finalPack.created_at.slice(0, 10),
    }),
  );

  return json({
    ok: true,
    status: 'done',
    pack_id: finalPack.pack_id,
    topic: finalPack.topic,
    story_title: finalPack.story_title,
    child_name: progress.student_name,
    review_link: '/ho-so?code=' + encodeURIComponent(accessCode),
    lesson_link: '/read2lead/lesson?code=' + encodeURIComponent(accessCode)
      + '&pack_id=' + encodeURIComponent(finalPack.pack_id),
    current_pack: publicPack(finalPack),
    progress: publicProgress(nextProgress),
    level: finalPack.level,
  });
}

function validate(data) {
  const errors = [];
  return errors;
}

function checkStudentProfile(progress) {
  if (!progress.student_name) {
    return json({ ok: false, error: 'student_profile_missing', message: 'Mã này chưa có tên học sinh. Vào admin/codes để cập nhật tên con trước khi tạo bài.' }, 400);
  }
  if (!isValidBackendChildName(progress.student_name)) {
    return json(
      {
        ok: false,
        error: 'student_name_invalid',
        message:
          'Tên con chỉ dùng chữ cái (không số, không ký tự đặc biệt). Vào admin/codes → Edit — ví dụ dùng "Pilot" thay vì "Pilot L3".',
      },
      400,
    );
  }
  if (!Number.isFinite(progress.age) || progress.age < 5 || progress.age > 14) {
    return json({ ok: false, error: 'student_age_missing', message: 'Mã này chưa có tuổi học sinh. Vào admin/codes để cập nhật tuổi con trước khi tạo bài.' }, 400);
  }
  if (!['boy', 'girl'].includes(progress.child_gender)) {
    return json({ ok: false, error: 'student_gender_missing', message: 'Mã này chưa có giới tính học sinh. Vào admin/codes để cập nhật trước khi tạo bài.' }, 400);
  }
  return null;
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

function normalizeProgress(codeData, progressState = null) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  return {
    student_name: profile.student_name || progressState?.student_name || progress.student_name || '',
    age: Number.isFinite(profile.age) ? profile.age : (Number.isFinite(progress.age) ? progress.age : null),
    child_gender: profile.child_gender || progress.child_gender || '',
    current_level: normalizeKidLevel(progressState?.current_level || earnedCurrentLevel(progress, reviewHistory)),
    packs_created: progress.packs_created || 0,
    completed_packs: progress.completed_packs || reviewHistory.length || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    weekly_key: progress.weekly_key || '',
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: progress.current_pack || null,
    review_history: reviewHistory,
  };
}

function isPackReviewed(pack) {
  return ['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web', 'reviewed_pass_web_v2'].includes(pack.status);
}

function shouldRequireReviewBeforeNextPack(codeData) {
  return !(codeData.is_test === true || codeData.is_shared === true);
}

function currentPackBlocksGeneration(pack, requireReviewBeforeNextPack = true) {
  if (!pack) return false;

  if (pack.status !== 'generation_in_progress') {
    if (!isV2Pack(pack)) return false;
    return requireReviewBeforeNextPack && !isPackReviewed(pack);
  }

  const startedAt = Date.parse(pack.created_at || '');
  if (!Number.isFinite(startedAt)) return false;
  return Date.now() - startedAt < GENERATION_LOCK_STALE_MS;
}

function isV2Pack(pack) {
  return Boolean(
    pack?.schema_version === 2 ||
      pack?.review_context?.schema_version === 2 ||
      pack?.pack?.schema_version === 2 ||
      pack?.pack_json?.schema_version === 2,
  );
}

function earnedCurrentLevel(progress, reviewHistory = []) {
  const completedPacks = numberOrZero(progress.completed_packs) || reviewHistory.length;
  if (completedPacks > 0 && ['L1', 'L2', 'L3'].includes(progress.current_level)) {
    return progress.current_level;
  }
  return 'L1';
}

function buildFinalV2Pack({ pendingPack, pack, createdAt }) {
  return {
    ...pendingPack,
    status: 'awaiting_review',
    created_at: createdAt,
    topic: pack.topic || pendingPack.topic || '',
    story_title: pack.story?.title || pack.story_title || 'Read2Lead V2 Mission',
    level: pack.level || pendingPack.level,
    schema_version: 2,
    review_context: pack,
  };
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
    schema_version: pack.schema_version || pack.review_context?.schema_version || null,
  };
}

function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    current_level: progress.current_level,
    completed_packs: progress.completed_packs || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: publicPack(progress.current_pack),
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isValidBackendChildName(name) {
  const trimmed = String(name || '').trim();
  return trimmed.length > 0 && trimmed.length <= 50 && BACKEND_CHILD_NAME_RE.test(trimmed);
}

function mapBackendGenerateError(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'backend_error' };
  if (body.error === 'Invalid child_name') {
    return {
      ...body,
      error: 'student_name_invalid',
      message:
        'Tên con chỉ dùng chữ cái (không số). Vào admin/codes → Edit — ví dụ "Pilot" thay vì "Pilot L3".',
    };
  }
  return body;
}
