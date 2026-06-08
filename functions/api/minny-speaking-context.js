import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { extractV2Pack } from './_read2lead-lesson-extract.js';

const FALLBACK_QUESTIONS = [
  {
    vi: 'Con tên gì? Con giới thiệu bản thân bằng tiếng Anh nhé.',
    en: 'What is your name? Please introduce yourself in English.',
    context: 'hello name student introduction',
  },
  {
    vi: 'Con thích làm gì nhất?',
    en: 'What do you like to do?',
    context: 'like hobby favorite fun',
  },
];

export function extractMinnyQuestions(v2Pack, storyTitle) {
  const questions = [];
  const activities = Array.isArray(v2Pack?.activities) ? v2Pack.activities : [];

  const comprehension = activities.find((a) => a.type === 'reading_comprehension');
  const openMcq = (comprehension?.questions || []).find((q) => q.section === 'Open Question');
  if (openMcq?.question_vi) {
    questions.push({
      vi: String(openMcq.question_vi),
      en: String(openMcq.question_en || openMcq.question_vi),
      context: buildStoryContext(v2Pack, storyTitle),
    });
  }

  const written = activities.find((a) => a.type === 'written_response');
  const writtenQ = written?.questions?.[0];
  if (writtenQ?.question_vi) {
    questions.push({
      vi: String(writtenQ.question_vi),
      en: String(writtenQ.question_en || writtenQ.question_vi),
      context: buildStoryContext(v2Pack, storyTitle),
    });
  }

  const title = String(storyTitle || v2Pack?.story?.title || 'the story').trim();
  if (!questions.length) {
    questions.push({
      vi: `Con thích nhất điều gì trong câu chuyện “${title}”? Vì sao?`,
      en: `What did you like most about "${title}"? Why?`,
      context: buildStoryContext(v2Pack, storyTitle),
    });
  }

  return questions.slice(0, 3);
}

function buildStoryContext(v2Pack, storyTitle) {
  const chunks = [];
  if (storyTitle) chunks.push(String(storyTitle));
  if (v2Pack?.topic) chunks.push(String(v2Pack.topic));
  for (const paragraph of v2Pack?.story?.paragraphs_en || []) {
    chunks.push(String(paragraph));
  }
  return chunks.join(' ').trim();
}

export function buildRetellSteps({ storyTitle, topic, v2Pack }) {
  const title = String(storyTitle || v2Pack?.story?.title || '').trim();
  const storyContext = buildStoryContext(v2Pack, title);
  const hasStory = Boolean(title || storyContext);

  const steps = [
    {
      id: 'retell_main',
      kind: 'retell',
      label_vi: 'Kể lại truyện',
      instruction_vi:
        'Bấm Nghe để nghe Minny nhắc, rồi con kể lại bằng lời của mình — không cần đọc y nguyên từng câu.',
      prompt_vi: hasStory
        ? `Con kể lại câu chuyện “${title || 'vừa đọc'}” cho Minny nghe nhé (khoảng 30–60 giây).`
        : 'Con kể về một điều con thích — dùng tiếng Anh, khoảng 30–60 giây nhé.',
      prompt_en: hasStory
        ? `Tell me about "${title || 'the story'}" in your own words.`
        : 'Tell me about something you like, in your own words.',
      expected_text: [storyContext, title, topic].filter(Boolean).join(' '),
      story_context: storyContext || String(topic || '').trim(),
      check_mode: 'open',
      max_seconds: 60,
    },
  ];

  if (hasStory && storyContext) {
    steps.push({
      id: 'retell_more',
      kind: 'retell',
      label_vi: 'Kể thêm',
      instruction_vi: 'Hay lắm! Con kể thêm một chi tiết con thích nhất trong truyện nhé.',
      prompt_vi: `Trong “${title}”, điều gì con thích nhất? Kể thêm cho Minny nghe.`,
      prompt_en: `What was your favorite part of "${title}"? Tell me more.`,
      expected_text: storyContext,
      story_context: storyContext,
      check_mode: 'open',
      max_seconds: 45,
    });
  }

  return steps;
}

export function buildQuestionSteps({ v2Pack, storyTitle, topic }) {
  const title = String(storyTitle || v2Pack?.story?.title || '').trim();
  const questions = v2Pack
    ? extractMinnyQuestions(v2Pack, title)
    : FALLBACK_QUESTIONS;

  return questions.map((question, index) => ({
    id: `question_${index}`,
    kind: 'question',
    label_vi: `Câu hỏi ${index + 1}`,
    instruction_vi: 'Bấm Nghe để nghe Minny hỏi, rồi con trả lời bằng tiếng Anh nhé.',
    question_vi: question.vi,
    question_en: question.en,
    expected_text: [question.en, title, topic, question.context].filter(Boolean).join(' '),
    story_context: question.context || buildStoryContext(v2Pack, title),
    check_mode: 'open',
    max_seconds: 30,
  }));
}

export function buildSpeakingModes({ studentName, storyTitle, topic, v2Pack }) {
  const retellSteps = buildRetellSteps({ storyTitle, topic, v2Pack });
  const questionSteps = buildQuestionSteps({ studentName, storyTitle, topic, v2Pack });

  return [
    {
      id: 'retell',
      title_vi: 'Kể lại truyện',
      subtitle_vi: 'Con kể lại truyện vừa đọc bằng lời của mình — Minny nghe và gợi ý nhẹ.',
      steps: retellSteps,
    },
    {
      id: 'questions',
      title_vi: 'Minny hỏi — con trả lời',
      subtitle_vi: 'Nghe Minny hỏi về truyện, rồi con trả lời bằng tiếng Anh.',
      steps: questionSteps,
    },
  ];
}

/** @deprecated use buildSpeakingModes — kept for tests */
export function buildPracticePrompts(opts) {
  const modes = buildSpeakingModes(opts);
  return [...modes[0].steps, ...modes[1].steps];
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

  const profileLink = `/hoc-sinh?code=${encodeURIComponent(accessCode)}`;
  const coachingLink = '/coaching#book';

  if (!practice) {
    const modes = buildSpeakingModes({ studentName, storyTitle: '', topic: '', v2Pack: null });
    return json({
      ok: true,
      student_name: studentName,
      has_story: false,
      pack_id: 'general',
      story_title: '',
      modes,
      greeting_vi: `Chào ${studentName || 'bé'}! Minny luyện nói cùng con trước buổi coaching với Felix.`,
      practice_count_this_week: numberOrZero(practiceLog.sessions_this_week),
      coaching_link: coachingLink,
      profile_link: profileLink,
    });
  }

  const modes = buildSpeakingModes({
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
    modes,
    greeting_vi: greeting,
    practice_count_this_week: numberOrZero(practiceLog.sessions_this_week),
    coaching_link: coachingLink,
    profile_link: profileLink,
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
