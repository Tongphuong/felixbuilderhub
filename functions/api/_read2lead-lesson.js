export const PASS_THRESHOLD = 70;

const REVIEWED_STATUSES = new Set(['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web']);

export function isPackReviewed(pack) {
  return Boolean(pack && REVIEWED_STATUSES.has(pack.status));
}

export function normalizeProgress(codeData) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const stars = Number.isFinite(progress.stars) ? progress.stars : 0;
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  return {
    student_name: profile.student_name || progress.student_name || '',
    age: profile.age || progress.age || null,
    child_gender: profile.child_gender || progress.child_gender || '',
    current_level: progress.current_level || profile.level || 'L2',
    stars,
    rank: progress.rank || rankForStars(stars),
    badges: Array.isArray(progress.badges) ? progress.badges : badgesForStars(stars),
    packs_created: numberOrZero(progress.packs_created),
    completed_packs: numberOrZero(progress.completed_packs) || reviewHistory.length,
    weekly_completed_count: numberOrZero(progress.weekly_completed_count),
    weekly_key: progress.weekly_key || '',
    streak_days: numberOrZero(progress.streak_days),
    last_activity_at: progress.last_activity_at || codeData.last_reviewed_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: progress.current_pack || null,
    review_history: reviewHistory,
  };
}

export function buildLessonPayload({ accessCode, codeData, pack }) {
  const progress = normalizeProgress(codeData);
  const context = pack.review_context || {};
  const activities = buildActivities(context);
  return {
    pack_id: pack.pack_id,
    access_code_masked: maskAccessCode(accessCode),
    student_name: progress.student_name || context.student_name || '',
    level: pack.level || progress.current_level || context.level_label || 'L2',
    topic: pack.topic || context.topic || '',
    story_title: pack.story_title || context.story_title || '',
    mp3_url: pack.mp3_url || '',
    pdf_url: pack.pdf_url || '',
    status: pack.status,
    activities,
  };
}

export function buildActivities(context) {
  const activities = [];
  const storyText = Array.isArray(context.story_text) ? context.story_text : [];
  if (storyText.length) {
    activities.push({
      id: 'story',
      type: 'story',
      title_vi: 'Đọc câu chuyện',
      instruction_vi: 'Con đọc câu chuyện một lần. Sau đó nghe MP3 và đọc lại nếu cần.',
      items: storyText.map((text, index) => ({ index, text })),
    });
  }

  const matching = context.matching_activity || {};
  const matchingItems = Array.isArray(matching.items) ? matching.items : [];
  const meanings = Array.isArray(matching.meanings) ? matching.meanings : [];
  if (matchingItems.length && meanings.length) {
    activities.push({
      id: 'matching',
      type: 'matching',
      title_vi: 'Nối cụm câu với nghĩa',
      instruction_vi: 'Con chọn nghĩa đúng cho từng cụm câu.',
      items: matchingItems.map((chunk, index) => ({ index, chunk, options: meanings })),
    });
  }

  const chunkOptions = (Array.isArray(context.power_chunks) ? context.power_chunks : []).map((item) => item.chunk || '').filter(Boolean);

  const fillBlanks = Array.isArray(context.fill_in_the_blank) ? context.fill_in_the_blank : [];
  if (fillBlanks.length && chunkOptions.length) {
    activities.push({
      id: 'fill_blank',
      type: 'fill_blank',
      title_vi: 'Điền cụm câu vào chỗ trống',
      instruction_vi: 'Con chọn cụm câu phù hợp nhất cho mỗi chỗ trống.',
      items: fillBlanks.map((prompt, index) => ({
        index,
        prompt,
        options: chunkOptions,
      })),
    });
  }

  const contextSentences = Array.isArray(context.chunk_in_context) ? context.chunk_in_context : [];
  if (contextSentences.length && chunkOptions.length) {
    activities.push({
      id: 'chunk_in_context',
      type: 'chunk_in_context',
      title_vi: 'Dùng cụm câu trong tình huống mới',
      instruction_vi: 'Mỗi câu là một tình huống KHÁC truyện chính. Con chọn cụm câu phù hợp nhất từ danh sách bên dưới.',
      items: contextSentences.map((sentence, index) => ({
        index,
        sentence,
        options: chunkOptions,
      })),
    });
  }

  const questions = Array.isArray(context.comprehension_questions) ? context.comprehension_questions : [];
  const COMPREHENSION_KEEP = new Set(['Find It', 'Language in the Story']);
  const comprehension = questions.filter((item) => COMPREHENSION_KEEP.has(item.section));
  if (comprehension.length) {
    activities.push({
      id: 'comprehension',
      type: 'comprehension',
      title_vi: 'Câu hỏi sau khi đọc',
      instruction_vi: 'Con trả lời bằng câu ngắn. Phần này để bố mẹ đọc cùng con, chưa tính điểm tự động.',
      items: comprehension.map((item, index) => ({
        index,
        section: item.section || '',
        question: item.question || '',
      })),
    });
  }

  const chunks = Array.isArray(context.power_chunks) ? context.power_chunks : [];
  if (chunks.length) {
    activities.push({
      id: 'power_chunks',
      type: 'power_chunks',
      title_vi: 'Thư viện cụm câu',
      instruction_vi: 'Con xem lại các cụm câu đã học để chuẩn bị kể lại câu chuyện ở phần tiếp theo.',
      items: chunks.map((item, index) => ({
        index,
        chunk: item.chunk || '',
        meaning: item.meaning || '',
        example: item.example || '',
      })),
    });
  }

  const openQuestions = questions.filter((item) => ['Open Question', 'Your Turn'].includes(item.section));
  if (openQuestions.length) {
    activities.push({
      id: 'open_response',
      type: 'open_response',
      title_vi: 'Con tự trả lời',
      instruction_vi: 'Con viết 1-2 câu theo suy nghĩ của mình. Không cần trả lời giống đáp án.',
      items: openQuestions.map((item, index) => ({
        index,
        section: item.section || '',
        question: item.question || '',
      })),
    });
  }

  return activities;
}

function addLineActivity(activities, id, title, instruction, source) {
  const items = Array.isArray(source) ? source : [];
  if (!items.length) return;
  activities.push({
    id,
    type: id,
    title_vi: title,
    instruction_vi: instruction,
    items: items.map((prompt, index) => ({ index, prompt })),
  });
}

export function gradeLessonSubmission(context, answers = {}) {
  const sections = [];
  let correct = 0;
  let total = 0;

  const addSection = (id, title, sectionCorrect, sectionTotal) => {
    if (!sectionTotal) return;
    correct += sectionCorrect;
    total += sectionTotal;
    sections.push({
      id,
      title,
      correct: sectionCorrect,
      total: sectionTotal,
      passed: sectionCorrect === sectionTotal,
    });
  };

  addSection('matching', 'Nối nghĩa', ...gradeMatching(context, answers.matching));
  addSection('fill_blank', 'Điền chỗ trống', ...gradeArrayAnswers(context.answer_key?.fill_in_the_blank, answers.fill_blank));
  addSection('chunk_in_context', 'Tình huống mới', ...gradeArrayAnswers(context.answer_key?.chunk_in_context, answers.chunk_in_context));

  const scorePercent = total ? Math.round((correct / total) * 100) : 0;
  const passed = total > 0 && scorePercent >= PASS_THRESHOLD;
  return {
    passed,
    score_percent: scorePercent,
    correct_count: correct,
    total_count: total,
    sections,
    open_answers: {
      comprehension: answers.comprehension || {},
      open_response: answers.open_response || {},
    },
  };
}

function gradeMatching(context, answerMap = {}) {
  const items = Array.isArray(context.matching_activity?.items) ? context.matching_activity.items : [];
  const chunks = Array.isArray(context.power_chunks) ? context.power_chunks : [];
  let correct = 0;
  items.forEach((chunk, index) => {
    const expected = chunks.find((item) => normalizeText(item.chunk) === normalizeText(chunk))?.meaning || '';
    if (!expected) {
      console.warn(`[read2lead-lesson][matching] chunk "${chunk}" không tìm thấy meaning tương ứng trong power_chunks — pack có thể bị lệch data`);
    }
    const actual = getIndexedAnswer(answerMap, index);
    if (expected && normalizeText(actual) === normalizeText(expected)) correct += 1;
  });
  return [correct, items.length];
}

function gradeArrayAnswers(expectedList, answerMap = {}) {
  const expected = Array.isArray(expectedList) ? expectedList : [];
  let correct = 0;
  expected.forEach((item, index) => {
    if (normalizeText(getIndexedAnswer(answerMap, index)) === normalizeText(item)) correct += 1;
  });
  return [correct, expected.length];
}

function gradeStoryOrder(expectedList, answerMap = {}) {
  const expected = Array.isArray(expectedList) ? expectedList : [];
  let correct = 0;
  expected.forEach((item, index) => {
    if (normalizeText(getIndexedAnswer(answerMap, index)) === normalizeText(item)) correct += 1;
  });
  return [correct, expected.length];
}

function getIndexedAnswer(answerMap, index) {
  if (Array.isArray(answerMap)) return answerMap[index] || '';
  if (answerMap && typeof answerMap === 'object') return answerMap[String(index)] || answerMap[index] || '';
  return '';
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildWebReviewSummary({ grading, context, completedAt }) {
  const weakSection = grading.sections.find((section) => !section.passed);
  const firstChunk = Array.isArray(context.power_chunks) && context.power_chunks[0]?.chunk
    ? context.power_chunks[0].chunk
    : 'try again slowly';
  return {
    reviewed_at: completedAt,
    passed: grading.passed,
    star_awarded: grading.passed,
    completed_via: 'web',
    scores: {
      web_lesson_percent: grading.score_percent,
      correct_count: grading.correct_count,
      total_count: grading.total_count,
      sections: grading.sections,
    },
    feedback_vi: {
      summary: grading.passed
        ? `Con đã hoàn thành bài làm trên web với ${grading.score_percent}%.`
        : `Con đạt ${grading.score_percent}%. Bố mẹ cho con xem lại vài phần rồi làm lại nhé.`,
      strength: grading.sections.find((section) => section.passed)?.title || 'Con đã đọc và nộp bài trên web.',
      practice: weakSection ? `Con nên xem lại phần ${weakSection.title}.` : 'Con có thể nghe lại MP3 và đọc câu chuyện thêm một lần.',
      parent_next_step: grading.passed
        ? 'Bố mẹ khen con, nghe lại MP3 một lần, rồi tạo bài tiếp theo khi sẵn sàng.'
        : 'Bố mẹ cho con đọc lại truyện, sửa phần chưa chắc, rồi bấm làm lại.',
    },
    mini_practice_vi: {
      read_again: Array.isArray(context.story_text) && context.story_text[0] ? context.story_text[0] : 'Read one story sentence again slowly.',
      chunk_to_practice: firstChunk,
      parent_question: 'Con kể lại cho bố mẹ nghe chuyện gì xảy ra trong bài này nhé?',
    },
    level_recommendation: 'stay',
  };
}

export function reviewHistoryItem(pack) {
  const summary = pack.review_summary || {};
  return {
    pack_id: pack.pack_id,
    story_title: pack.story_title,
    topic: pack.topic,
    level: pack.level,
    reviewed_at: summary.reviewed_at,
    passed: summary.passed,
    star_awarded: summary.star_awarded,
    completed_via: summary.completed_via || 'review',
    level_recommendation: summary.level_recommendation,
    scores: summary.scores || {},
    feedback_vi: summary.feedback_vi || {},
    mini_practice_vi: summary.mini_practice_vi || {},
  };
}

export function nextWeeklyCompletedCount(progress, reviewedAt) {
  const currentWeek = weekKey(reviewedAt);
  if (!currentWeek) return 1;
  return progress.weekly_key === currentWeek ? numberOrZero(progress.weekly_completed_count) + 1 : 1;
}

export function nextStreakDays(lastActivityAt, reviewedAt, currentStreak = 0) {
  if (!lastActivityAt) return 1;
  if (sameUtcDate(lastActivityAt, reviewedAt)) return numberOrZero(currentStreak) || 1;
  return previousUtcDate(lastActivityAt, reviewedAt) ? numberOrZero(currentStreak) + 1 : 1;
}

function weekKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function sameUtcDate(a, b) {
  return String(a || '').slice(0, 10) === String(b || '').slice(0, 10);
}

function previousUtcDate(previous, current) {
  const prev = Date.parse(`${String(previous || '').slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${String(current || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(prev) || !Number.isFinite(now)) return false;
  return now - prev === 24 * 60 * 60 * 1000;
}

export function publicPack(pack) {
  if (!pack) return null;
  return {
    pack_id: pack.pack_id,
    status: pack.status,
    topic: pack.topic,
    story_title: pack.story_title,
    level: pack.level,
    pdf_url: pack.pdf_url,
    mp3_url: pack.mp3_url,
    reviewed_at: pack.reviewed_at,
    web_score_percent: pack.web_lesson_summary?.score_percent || pack.review_summary?.scores?.web_lesson_percent || null,
  };
}

export function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    current_level: progress.current_level,
    stars: progress.stars || 0,
    rank: progress.rank || rankForStars(progress.stars || 0),
    badges: progress.badges || badgesForStars(progress.stars || 0),
    completed_packs: progress.completed_packs || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: publicPack(progress.current_pack),
  };
}

export function rankForStars(stars) {
  if (stars >= 15) return 'Reading Champion';
  if (stars >= 10) return 'Story Hero';
  if (stars >= 6) return 'Mission Builder';
  if (stars >= 3) return 'Chunk Explorer';
  if (stars >= 1) return 'Story Starter';
  return 'Rookie Reader';
}

export function badgesForStars(stars) {
  const badges = [];
  if (stars >= 1) badges.push('First Mission Complete');
  if (stars >= 3) badges.push('Chunk Hunter');
  if (stars >= 5) badges.push('Retell Rookie');
  if (stars >= 10) badges.push('Story Hero');
  return badges;
}

export function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function maskAccessCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (clean.length <= 4) return '***';
  return `${clean.slice(0, 4)}***${clean.slice(-4)}`;
}
