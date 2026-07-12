import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { resolveAccessiblePack } from './_read2lead-pack-access.js';
import { extractV2Pack } from './_read2lead-lesson-extract.js';
import { ensureSixActivities } from './_read2lead-lesson-activities.js';
import { rewriteAudioHost } from './_read2lead-audio-url.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh ma hoc sinh.' }, 500);
  }

  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('code') || '').trim().toUpperCase();
  const packId = (url.searchParams.get('pack_id') || '').trim();
  if (!accessCode || !packId) {
    return json({ ok: false, error: 'missing_params', message: 'Thieu ma hoc sinh hoac ma bai.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  const pack = resolveAccessiblePack(codeData, packId);
  if (!pack) {
    return json({ ok: false, error: 'pack_not_found', message: 'Khong tim thay bai nay trong ma hoc sinh.' }, 404);
  }

  if (pack.status === 'generation_in_progress') {
    return json({ ok: false, error: 'generation_in_progress', message: 'Bai van dang duoc tao. Vui long doi them mot chut.' }, 409);
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
