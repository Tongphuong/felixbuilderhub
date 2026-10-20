import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { resolveAccessiblePack } from './_read2lead-pack-access.js';
import { extractV2Pack } from './_read2lead-lesson-extract.js';
import { ensureSixActivities } from './_read2lead-lesson-activities.js';
import { rewriteAudioHost } from './_read2lead-audio-url.js';
import { isStoryPack, loadAssignedStory, storyLessonPayload } from '../lib/read2lead/story-catalogue.mjs';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('code') || '').trim().toUpperCase();
  const packId = (url.searchParams.get('pack_id') || '').trim();
  if (!accessCode || !packId) {
    return json({ ok: false, error: 'missing_params', message: 'Thiếu mã học sinh hoặc mã bài.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  const pack = resolveAccessiblePack(codeData, packId);
  if (!pack) {
    return json({ ok: false, error: 'pack_not_found', message: 'Không tìm thấy bài này trong mã học sinh.' }, 404);
  }

  if (pack.status === 'generation_in_progress') {
    return json({ ok: false, error: 'generation_in_progress', message: 'Bài vẫn đang được tạo. Vui lòng đợi thêm một chút.' }, 409);
  }

  if (isStoryPack(pack)) {
    try {
      const loaded = await loadAssignedStory(env, codeData, pack.story_reference);
      return json({ ok: true, lesson: storyLessonPayload(pack, loaded) });
    } catch {
      return json({ ok: false, error: 'story_unavailable', message: 'Chưa mở được truyện đã lưu. Con thử lại sau nhé.' }, 409);
    }
  }

  let v2Pack = extractV2Pack(pack);
  if (!v2Pack) {
    return json({
      ok: false,
      error: 'legacy_pack_removed',
      message: 'Bai nay la format cu. Read2Lead V2 chi mo bai schema_version = 2.',
    }, 410);
  }

  v2Pack = await mergeDeferredFullStoryAudio(env, pack, v2Pack);

  return json({
    ok: true,
    lesson: buildV2LessonPayload({ accessCode, codeData, pack, v2Pack, env }),
  });
}

async function mergeDeferredFullStoryAudio(env, pack, v2Pack) {
  if (!v2Pack?.story?.full_audio_url) {
    const taskId = pack.generation_task_id || pack.task_id;
    if (taskId && env.READ2LEAD_CODES) {
      const taskValue = await env.READ2LEAD_CODES.get(`task:${taskId}`, { type: 'json' });
      const mergedUrl =
        taskValue?.result?.review_context?.story?.full_audio_url ||
        taskValue?.result?.pack?.story?.full_audio_url ||
        '';
      if (mergedUrl) {
        return {
          ...v2Pack,
          story: { ...v2Pack.story, full_audio_url: mergedUrl },
        };
      }
    }
  }
  return v2Pack;
}


export function isValidBookPack(v2Pack) {
  const paragraphs = v2Pack?.story?.paragraphs_en;
  const images = v2Pack?.book_images;
  const pageAudio = v2Pack?.book_page_audio;
  return Boolean(
    typeof v2Pack?.book_slug === 'string'
    && /^book_[0-9]+$/.test(v2Pack.book_slug)
    && Array.isArray(paragraphs)
    && paragraphs.length >= 3
    && Array.isArray(images)
    && images.length === paragraphs.length
    && images.every((value) => typeof value === 'string' && value)
    && Array.isArray(pageAudio)
    && pageAudio.length === paragraphs.length
    && pageAudio.every((value) => typeof value === 'string' && value)
    && v2Pack.book_attribution
    && typeof v2Pack.book_attribution === 'object'
  );
}

function rewriteActivityAudio(activities, env) {
  return (Array.isArray(activities) ? activities : []).filter(Boolean).map((activity) => ({
    ...activity,
    ...(Array.isArray(activity.items)
      ? {
          items: activity.items.map((item) => (
            item && typeof item === 'object' && Object.hasOwn(item, 'audio_url')
              ? { ...item, audio_url: rewriteAudioHost(item.audio_url, env) }
              : item
          )),
        }
      : {}),
  }));
}

export function buildV2LessonPayload({ accessCode, codeData, pack, v2Pack, env }) {
  const progress = codeData.progress || {};
  const profile = codeData.student_profile || {};
  const story = {
    ...v2Pack.story,
    full_audio_url: rewriteAudioHost(v2Pack.story?.full_audio_url || '', env),
    ...(Array.isArray(v2Pack.story?.sentences)
      ? {
          sentences: v2Pack.story.sentences.map((sentence) =>
            sentence && typeof sentence === 'object' && Object.hasOwn(sentence, 'audio_url')
              ? { ...sentence, audio_url: rewriteAudioHost(sentence.audio_url, env) }
              : sentence,
          ),
        }
      : {}),
  };
  const isBook = isValidBookPack(v2Pack);
  const activities = isBook
    ? rewriteActivityAudio(v2Pack.activities, env)
    : ensureSixActivities(
        v2Pack.activities,
        {
          story: v2Pack.story,
          topic: v2Pack.topic || pack.topic || '',
          activities: v2Pack.activities,
        },
        env,
      );

  return {
    schema_version: 2,
    pack_id: pack.pack_id,
    review_only:pack.review_only===true||(Array.isArray(codeData.completed_books)&&codeData.completed_books.includes(v2Pack.book_slug)),
    access_code_masked: maskAccessCode(accessCode),
    student_name: profile.student_name || progress.student_name || v2Pack.student_name || '',
    level: v2Pack.level || pack.level || progress.current_level || '',
    level_label: v2Pack.level_label || pack.level_label || '',
    topic: v2Pack.topic || pack.topic || '',
    story,
    activities,
    ...(isBook
      ? {
          book_slug: v2Pack.book_slug,
          book_images: v2Pack.book_images.map((url) => rewriteAudioHost(url, env)),
          book_page_audio: v2Pack.book_page_audio.map((url) => rewriteAudioHost(url, env)),
          book_attribution: v2Pack.book_attribution,
        }
      : {}),
    rewards: v2Pack.rewards || {
      coins_on_complete: 15,
      xp_on_complete: 20,
      bonus_coins_per_activity_attempted: 2,
    },
    parent_note_vi: v2Pack.parent_note_vi || '',
    next_suggestion_vi: v2Pack.next_suggestion_vi || '',
    vocabulary: Array.isArray(v2Pack.vocabulary) ? v2Pack.vocabulary : [],
    guided_listening: v2Pack.guided_listening || pack.guided_listening || [],
    status: pack.status,
    web_session_checkpoint: pack.web_session_checkpoint || null,
  };
}

function maskAccessCode(code) {
  if (!code || code.length <= 4) return '****';
  return `${code.slice(0, 2)}**${code.slice(-2)}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
