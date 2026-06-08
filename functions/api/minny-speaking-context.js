import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { extractV2Pack } from './_read2lead-lesson-extract.js';

const DEFAULT_PROMPTS = [
  {
    id: 'intro',
    label_vi: 'Giới thiệu bản thân',
    prompt_en: 'Say hello and tell Minny your name in English.',
    expected_text: 'Hello my name is',
    check_mode: 'open',
    story_context: 'hello name student introduction',
  },
  {
    id: 'favorite',
    label_vi: 'Sở thích của con',
    prompt_en: 'Tell Minny one thing you like.',
    expected_text: 'I like',
    check_mode: 'open',
    story_context: 'like favorite hobby fun',
  },
];

export function buildPracticePrompts({ studentName, storyTitle, topic, v2Pack }) {
  const prompts = [];
  const sentences = Array.isArray(v2Pack?.story?.sentences) ? v2Pack.story.sentences : [];
  const title = String(storyTitle || v2Pack?.story?.title || '').trim();
  const topicText = String(topic || v2Pack?.topic || '').trim();

  for (let index = 0; index < Math.min(3, sentences.length); index += 1) {
    const sentence = sentences[index];
    const textEn = String(sentence?.text_en || sentence?.en || sentence || '').trim();
    if (!textEn) continue;
    prompts.push({
      id: `sentence_${index}`,
      label_vi: `Đọc câu ${index + 1}`,
      prompt_en: textEn,
      expected_text: textEn,
      check_mode: 'read',
      story_context: textEn,
    });
  }

  if (title) {
    const paragraph = Array.isArray(v2Pack?.story?.paragraphs_en)
      ? String(v2Pack.story.paragraphs_en[0] || '').trim()
      : '';
    prompts.push({
      id: 'retell',
      label_vi: 'Kể về truyện',
      prompt_en: `Tell Minny about "${title}" in your own words.`,
      expected_text: [title, topicText, paragraph].filter(Boolean).join(' '),
      check_mode: 'open',
      story_context: [title, topicText, paragraph].filter(Boolean).join(' '),
    });
  }

  if (!prompts.length) {
    const name = String(studentName || '').trim().split(/\s+/)[0] || 'friend';
    return DEFAULT_PROMPTS.map((item) => ({
      ...item,
      expected_text: item.id === 'intro' ? `Hello my name is ${name}` : item.expected_text,
      story_context: item.story_context,
    }));
  }

  return prompts;
}

export function pickPracticePack(codeData) {
  const progress = codeData?.progress || {};
  const current = progress.current_pack;
  const history = Array.isArray(progress.review_history) ? progress.review_history : [];

  if (current?.pack_id && current.status !== 'generation_in_progress') {
    const v2 = extractV2Pack(current);
    if (v2?.story) {
      return {
        pack_id: current.pack_id,
        story_title: v2.story?.title || current.story_title || '',
        topic: v2.topic || current.topic || '',
        pack: current,
        v2Pack: v2,
        source: 'current_pack',
      };
    }
  }

  const latest = history.find((entry) => entry?.pack_id);
  if (latest && current?.pack_id === latest.pack_id) {
    const v2 = extractV2Pack(current);
    if (v2?.story) {
      return {
        pack_id: current.pack_id,
        story_title: latest.title || v2.story?.title || '',
        topic: latest.topic || v2.topic || '',
        pack: current,
        v2Pack: v2,
        source: 'review_history',
      };
    }
  }

  if (latest) {
    return {
      pack_id: String(latest.pack_id),
      story_title: String(latest.title || 'Câu chuyện'),
      topic: String(latest.topic || ''),
      pack: null,
      v2Pack: null,
      source: 'history_meta_only',
    };
  }

  return null;
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
  const practice = pickPracticePack(codeData);
  const practiceLog = progress.minny_practice || { sessions_this_week: 0, last_at: null };

  if (!practice) {
    const name = String(studentName || '').trim().split(/\s+/)[0] || 'friend';
    const prompts = DEFAULT_PROMPTS.map((item) => ({
      ...item,
      expected_text: item.id === 'intro' ? `Hello my name is ${name}` : item.expected_text,
    }));
    return json({
      ok: true,
      student_name: studentName,
      has_story: false,
      prompts,
      pack_id: 'general',
      story_title: '',
      greeting_vi: `Chào ${studentName || 'bé'}! Minny luyện nói cùng con trước buổi coaching với Felix.`,
      practice_count_this_week: numberOrZero(practiceLog.sessions_this_week),
      coaching_link: '/coaching#book',
      profile_link: `/hoc-sinh?code=${encodeURIComponent(accessCode)}`,
    });
  }

  const prompts = buildPracticePrompts({
    studentName,
    storyTitle: practice.story_title,
    topic: practice.topic,
    v2Pack: practice.v2Pack,
  });

  const greeting = practice.story_title
    ? `Chào ${studentName || 'bé'}! Hôm nay mình luyện nói về "${practice.story_title}" — chuẩn bị cho buổi coaching với Felix nhé.`
    : `Chào ${studentName || 'bé'}! Minny sẵn sàng luyện nói cùng con trước buổi coaching.`;

  return json({
    ok: true,
    student_name: studentName,
    has_story: Boolean(practice.v2Pack),
    pack_id: practice.pack_id,
    story_title: practice.story_title,
    topic: practice.topic,
    prompts,
    greeting_vi: greeting,
    practice_count_this_week: numberOrZero(practiceLog.sessions_this_week),
    coaching_link: '/coaching#book',
    profile_link: `/hoc-sinh?code=${encodeURIComponent(accessCode)}`,
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
