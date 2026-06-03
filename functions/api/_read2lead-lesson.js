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
  const levelLabel = String(context.level_label || '').trim();
  const isL1 = /^L1\b/i.test(levelLabel) || /Beginner/i.test(levelLabel);
  const activities = [];
  const storyText = Array.isArray(context.story_text) ? context.story_text : [];
  if (storyText.length) {
    activities.push({
      id: 'story',
      type: 'story',
      title_vi: '🎯 Nhiệm vụ 1: Đọc câu chuyện',
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
      title_vi: '🔗 Nhiệm vụ: Nối cụm câu',
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
      title_vi: '✏️ Nhiệm vụ: Điền cụm câu',
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
      title_vi: '🌍 Nhiệm vụ: Dùng trong đời thật',
      instruction_vi: 'Mỗi câu là một tình huống KHÁC truyện chính. Con chọn cụm câu phù hợp nhất từ danh sách bên dưới.',
      items: contextSentences.map((sentence, index) => ({
        index,
        sentence,
        options: chunkOptions,
      })),
    });
  }

  const shadowSentences = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  const sentenceAudios = (context.sentence_audio_urls && typeof context.sentence_audio_urls === 'object') ? context.sentence_audio_urls : {};

  if (shadowSentences.length) {
    const dictationType = isL1 ? 'tap_words' : 'dictation';
    const dictationTitle = isL1
      ? '🎧 Mission: Nghe và sắp chữ thành câu'
      : '🎧 Mission: Nghe và chép chính tả';
    const dictationInstruction = isL1
      ? 'Bấm 🔊 nghe câu. Sau đó bấm từng từ theo đúng thứ tự con vừa nghe. Bấm vào từ trong khung trả lời để bỏ ra.'
      : 'Bấm 🔊 nghe câu. Sau đó gõ lại CHÍNH XÁC câu con vừa nghe. Con có thể nghe nhiều lần. Viết hoa hay thường đều được, không cần chính xác dấu câu.';
    activities.push({
      id: 'dictation',
      type: dictationType,
      title_vi: dictationTitle,
      instruction_vi: dictationInstruction,
      items: shadowSentences.map((sentence, index) => ({
        index,
        audio_url: sentenceAudios[sentence] || '',
        expected: sentence,
        shuffled_words: isL1 ? shuffleWordsForTap(sentence, `${context.student_name || 'r2l'}_${index}`) : undefined,
      })),
    });

    activities.push({
      id: 'shadowing',
      type: 'shadowing',
      title_vi: '🗣️ Mission: Nghe và đọc theo (Shadowing)',
      instruction_vi: 'Bấm 🔊 nghe câu mẫu (có thể nghe nhiều lần). Sau đó bấm 🎤 đọc lại y hệt câu mẫu. Bấm ▶ nghe lại bản ghi của con để tự so sánh.',
      items: shadowSentences.map((sentence, index) => ({
        index,
        audio_url: sentenceAudios[sentence] || '',
      })),
    });
  }

  const challengeItems = Array.isArray(context.best_line_challenge) ? context.best_line_challenge : [];
  if (challengeItems.length) {
    activities.push({
      id: 'best_line',
      type: 'best_line',
      title_vi: '🎯 Best Line Challenge',
      instruction_vi: 'Mỗi câu hỏi có 3 cách viết. Con chọn cách nghe tự nhiên nhất trong tiếng Anh.',
      items: challengeItems.map((item, index) => ({
        index,
        options: Array.isArray(item?.options) ? item.options : [],
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
      title_vi: '🔍 Quick Check: Con hiểu chuyện chưa?',
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
      title_vi: '📚 Power Chunks — Để tham khảo',
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
      title_vi: '💭 Use It About You',
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

function shuffleWordsForTap(sentence, seed) {
  const words = String(sentence || '').trim().split(/\s+/).filter(Boolean);
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  let s = Math.abs(h) || 1;
  const out = words.slice();
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length >= 2 && out.every((word, index) => word === words[index])) {
    [out[0], out[1]] = [out[1], out[0]];
  }
  return out;
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
  addSection('fill_blank', 'Điền chỗ trống', ...gradeArrayAnswers(context.answer_key?.fill_in_the_blank, answers.fill_blank, context.fill_in_the_blank));
  addSection('chunk_in_context', 'Tình huống mới', ...gradeArrayAnswers(context.answer_key?.chunk_in_context, answers.chunk_in_context, context.chunk_in_context));
  addSection('best_line', 'Best Line', ...gradeBestLine(context, answers.best_line));
  const levelLabelGrade = String(context.level_label || '').trim();
  const isL1Grade = /^L1\b/i.test(levelLabelGrade) || /Beginner/i.test(levelLabelGrade);
  if (isL1Grade) {
    addSection('dictation', 'Sắp chữ thành câu', ...gradeTapWords(context, answers.dictation));
  } else {
    addSection('dictation', 'Chính tả', ...gradeDictation(context, answers.dictation));
  }

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

function gradeBestLine(context, answerMap = {}) {
  const items = Array.isArray(context.best_line_challenge) ? context.best_line_challenge : [];
  const keyList = Array.isArray(context.answer_key?.best_line_challenge) ? context.answer_key.best_line_challenge : [];
  // Defensive: prefer answer_key, fall back to item.correct_index. Skip if both unavailable.
  let correct = 0;
  let gradeable = 0;
  items.forEach((item, index) => {
    const fromKey = keyList[index];
    const fromItem = item && typeof item.correct_index === 'number' ? item.correct_index : undefined;
    let expectedIdx;
    if (typeof fromKey === 'number' && typeof fromItem === 'number' && fromKey !== fromItem) {
      console.warn(`[grader][best_line] item[${index}] correct_index desync: answer_key=${fromKey}, item=${fromItem}. Skipping for fair grading.`);
      return;
    }
    if (typeof fromKey === 'number') expectedIdx = fromKey;
    else if (typeof fromItem === 'number') expectedIdx = fromItem;
    else {
      console.warn(`[grader][best_line] item[${index}] missing correct_index in both sources — skipping`);
      return;
    }
    gradeable += 1;
    const actual = getIndexedAnswer(answerMap, index);
    if (actual !== '' && actual !== null && actual !== undefined && Number(actual) === Number(expectedIdx)) correct += 1;
  });
  return [correct, gradeable];
}

function gradeDictation(context, answerMap = {}) {
  const expected = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  let correct = 0;
  expected.forEach((sentence, index) => {
    const actual = getIndexedAnswer(answerMap, index);
    const normA = normalizeText(actual);
    const normE = normalizeText(sentence);
    if (!normA) return;
    // Tolerance: 1 edit per ~8 chars, minimum 2, max 15% of length
    const tolerance = Math.max(2, Math.min(Math.floor(normE.length / 8), Math.floor(normE.length * 0.15)));
    if (levenshtein(normA, normE) <= tolerance) correct += 1;
  });
  return [correct, expected.length];
}

function gradeTapWords(context, answerMap = {}) {
  const expected = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  let correct = 0;
  expected.forEach((sentence, index) => {
    const actual = getIndexedAnswer(answerMap, index);
    if (!actual) return;
    if (normalizeText(actual) === normalizeText(sentence)) correct += 1;
  });
  return [correct, expected.length];
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function gradeMatching(context, answerMap = {}) {
  const items = Array.isArray(context.matching_activity?.items) ? context.matching_activity.items : [];
  const availableMeanings = Array.isArray(context.matching_activity?.meanings) ? context.matching_activity.meanings : [];
  const chunks = Array.isArray(context.power_chunks) ? context.power_chunks : [];
  let correct = 0;
  let gradeable = 0;
  items.forEach((chunk, index) => {
    const chunkEntry = chunks.find((item) => normalizeText(item.chunk) === normalizeText(chunk));
    const expectedMeaning = chunkEntry?.meaning || '';
    // Defensive: skip grading this item if pack data is inconsistent
    if (!expectedMeaning) {
      console.warn(`[grader][matching] item[${index}] chunk "${chunk}" has no meaning in power_chunks — skipping`);
      return;
    }
    // Defensive: if expected meaning is not present in dropdown options, kid cannot pick it
    const meaningInOptions = availableMeanings.some((meaning) => normalizeText(meaning) === normalizeText(expectedMeaning));
    if (!meaningInOptions) {
      console.warn(`[grader][matching] item[${index}] expected meaning "${expectedMeaning}" not in matching_activity.meanings — skipping`);
      return;
    }
    gradeable += 1;
    const actual = getIndexedAnswer(answerMap, index);
    if (normalizeText(actual) === normalizeText(expectedMeaning)) correct += 1;
  });
  return [correct, gradeable];
}

function gradeArrayAnswers(expectedList, answerMap = {}, promptList = null) {
  const expected = Array.isArray(expectedList) ? expectedList : [];
  const prompts = Array.isArray(promptList) ? promptList : null;
  // Defensive: use the smaller of prompts vs answers length to avoid penalizing
  // kid for missing answers when UI rendered N items but answer_key has M.
  let gradeable = expected.length;
  if (prompts && prompts.length !== expected.length) {
    console.warn(`[grader] length mismatch — prompts=${prompts.length}, answers=${expected.length}. Using min for fair grading.`);
    gradeable = Math.min(prompts.length, expected.length);
  }
  let correct = 0;
  for (let index = 0; index < gradeable; index += 1) {
    const item = expected[index];
    if (item === undefined) continue;
    if (normalizeText(getIndexedAnswer(answerMap, index)) === normalizeText(item)) correct += 1;
  }
  return [correct, gradeable];
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
