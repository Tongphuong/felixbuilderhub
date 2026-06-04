export const PASS_THRESHOLD = 70;

const REVIEWED_STATUSES = new Set(['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web']);

export function isPackReviewed(pack) {
  return Boolean(pack && REVIEWED_STATUSES.has(pack.status));
}

export function pickPackAssets(context) {
  const topic = String(context?.topic || '').toLowerCase();
  let setting = 'park';
  if (/school|class|recess|classroom/.test(topic)) setting = 'school';
  else if (/home|family|cook|kitchen/.test(topic)) setting = 'home';
  else if (/garden|outdoor|nature|park/.test(topic)) setting = 'park';

  const chunkText = (Array.isArray(context?.power_chunks) ? context.power_chunks : [])
    .map((chunk) => String(chunk?.chunk || ''))
    .join(' ')
    .toLowerCase();
  let animal = '';
  for (const candidate of ['puppy', 'kitten', 'hamster', 'bird', 'fish', 'rabbit']) {
    if (chunkText.includes(candidate)) {
      animal = candidate;
      break;
    }
  }

  return {
    minny_idle: '/assets/r2l/minny/idle.png',
    minny_clap: '/assets/r2l/minny/clap.png',
    minny_dance: '/assets/r2l/minny/dance.png',
    kid_reading: '/assets/r2l/kid/reading.png',
    setting: `/assets/r2l/settings/${setting}.png`,
    animal: animal ? `/assets/r2l/animals/${animal}.png` : '',
  };
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
    assets: pickPackAssets(context),
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
      title_vi: '🎯 Nhiệm vụ 1: Đọc câu chuyện',
      instruction_vi: 'Con đọc câu chuyện một lần 📖. Sau đó nghe MP3 và đọc lại nếu cần.',
      items: storyText.map((text, index) => ({ index, text })),
    });
  }

  const chunks = Array.isArray(context.power_chunks) ? context.power_chunks : [];
  const matching = context.matching_activity || {};
  const matchingItems = Array.isArray(matching.items) ? matching.items : [];
  const meanings = Array.isArray(matching.meanings) ? matching.meanings : [];
  if (chunks.length) {
    const parts = [
      {
        kind: 'chunks_glossary',
        items: chunks.map((item, index) => ({
          index,
          chunk: item.chunk || '',
          meaning: item.meaning || '',
          example: item.example || '',
        })),
      },
    ];
    if (matchingItems.length && meanings.length) {
      parts.push({
        kind: 'matching',
        items: matchingItems.map((chunk, index) => ({ index, chunk, options: meanings })),
      });
    }
    activities.push({
      id: 'cum_cau_con',
      type: 'cum_cau_con',
      title_vi: '📚 Cụm câu của con',
      instruction_vi: 'Xem ý nghĩa các cụm câu ✨, sau đó nối chunk với nghĩa đúng ở phần dưới.',
      parts,
    });
  }

  const chunkOptions = chunks.map((item) => item.chunk || '').filter(Boolean);
  const fillBlanks = Array.isArray(context.fill_in_the_blank) ? context.fill_in_the_blank : [];
  const contextSentences = Array.isArray(context.story_cloze) ? context.story_cloze : [];

  if ((fillBlanks.length || contextSentences.length) && chunkOptions.length) {
    const parts = [];
    if (fillBlanks.length) {
      parts.push({
        kind: 'fill_blank',
        sub_title_vi: 'Phần A — Điền cụm câu vào chỗ trống (theo truyện)',
        items: fillBlanks.map((prompt, index) => ({ index, prompt, options: chunkOptions })),
      });
    }
    if (contextSentences.length) {
      parts.push({
        kind: 'story_cloze',
        sub_title_vi: 'Phần B — Tìm cụm câu đúng trong truyện',
        items: contextSentences.map((sentence, index) => ({ index, sentence, options: chunkOptions })),
      });
    }
    activities.push({
      id: 'dung_cum_cau',
      type: 'dung_cum_cau',
      title_vi: '✏️ Dùng cụm câu',
      instruction_vi: parts.length > 1
        ? 'Chọn cụm câu phù hợp cho mỗi chỗ trống 🎯. Có 2 phần nhỏ phía dưới.'
        : 'Chọn cụm câu phù hợp cho mỗi chỗ trống 🎯.',
      parts,
    });
  }

  const shadowSentences = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  const sentenceAudios = (context.sentence_audio_urls && typeof context.sentence_audio_urls === 'object') ? context.sentence_audio_urls : {};

  if (shadowSentences.length) {
    const sentenceUnits = shadowSentences.map((sentence, index) => ({
      index,
      audio_url: sentenceAudios[sentence] || '',
      expected: sentence,
      shuffled_words: shuffleWordsForTap(sentence, `${context.student_name || 'r2l'}_${index}`),
    }));
    activities.push({
      id: 'nghe_doc_theo',
      type: 'nghe_doc_theo',
      title_vi: '🎧 Nghe & Đọc theo',
      instruction_vi: 'Cùng Minny luyện nói nhé! Bấm 🔊 nghe, sau đó ghép từ lại đúng thứ tự, rồi 🎤 đọc theo cho thật vui.',
      parts: [
        {
          kind: 'sentence_unit',
          items: sentenceUnits,
        },
      ],
    });
  }

  const challengeItems = Array.isArray(context.best_line_challenge) ? context.best_line_challenge : [];
  const questions = Array.isArray(context.comprehension_questions) ? context.comprehension_questions : [];
  const COMPREHENSION_KEEP = new Set(['Find It', 'Language in the Story']);
  const comprehension = questions.filter((item) => COMPREHENSION_KEEP.has(item.section));

  if (comprehension.length || challengeItems.length) {
    const parts = [];
    if (comprehension.length) {
      parts.push({
        kind: 'comprehension',
        sub_title_vi: 'Phần A — Câu hỏi hiểu bài',
        items: comprehension.map((item, index) => ({
          index,
          section: item.section || '',
          question: item.question || '',
          hint_vi: item.hint_vi || '',
        })),
      });
    }
    if (challengeItems.length) {
      parts.push({
        kind: 'best_line',
        sub_title_vi: 'Phần B — Câu nào nghe tự nhiên nhất?',
        items: challengeItems.map((item, index) => ({
          index,
          options: Array.isArray(item?.options) ? item.options : [],
        })),
      });
    }
    activities.push({
      id: 'hieu_truyen',
      type: 'hieu_truyen',
      title_vi: '💭 Minny hỏi con xíu nhé',
      instruction_vi: 'Phần A — Minny hỏi con vài câu về truyện. Phần B — chọn câu nào ‘ngon tai’ nhất nhé 👂',
      story_text: storyText,
      parts,
    });
  }

  const openQuestions = questions.filter((item) => ['Open Question', 'Your Turn'].includes(item.section));
  if (openQuestions.length) {
    activities.push({
      id: 'ke_chuyen_con',
      type: 'ke_chuyen_con',
      title_vi: '✍️ Con kể cho Minny nghe',
      instruction_vi: 'Đây là phần con kể chuyện cho Minny. Viết hay nói gì cũng được nhé — không có đúng sai 💭',
      story_text: storyText,
      parts: [
        {
          kind: 'open_response',
          items: openQuestions.map((item, index) => ({
            index,
            section: item.section || '',
            question: item.question || '',
            hint_vi: item.hint_vi || '',
          })),
        },
      ],
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

// Grade just one slot's answers and return wrong_items tagged by data-answer-type.
// Used by POST /api/grade-slot for inline per-slot feedback before the kid hits
// the final submit. Idempotent / read-only — does NOT touch KV state.
//
// slot_id values map to the activity IDs emitted by buildActivities:
//   cum_cau_con / dung_cum_cau / nghe_doc_theo / hieu_truyen / ke_chuyen_con
//
// Returns: { wrong_items: [{ type, index }] }
export function gradeSingleSlot(context, answers = {}, slotId = '') {
  const tag = (type, indices) => (Array.isArray(indices) ? indices : []).map((index) => ({ type, index }));
  const wrong = [];

  if (slotId === 'cum_cau_con') {
    const [, , w] = gradeMatching(context, answers.matching);
    wrong.push(...tag('matching', w));
  } else if (slotId === 'dung_cum_cau') {
    const [, , fbW] = gradeArrayAnswers(
      context.answer_key?.fill_in_the_blank,
      answers.fill_blank,
      context.fill_in_the_blank,
    );
    let scW = [];
    if (Array.isArray(context.story_cloze) && context.story_cloze.length) {
      [, , scW] = gradeArrayAnswers(
        context.answer_key?.story_cloze,
        answers.story_cloze,
        context.story_cloze,
      );
    }
    wrong.push(...tag('fill_blank', fbW), ...tag('story_cloze', scW));
  } else if (slotId === 'nghe_doc_theo') {
    const [, , w] = gradeTapWords(context, answers.dictation);
    wrong.push(...tag('dictation', w));
  } else if (slotId === 'hieu_truyen') {
    const [, , blW] = gradeBestLine(context, answers.best_line);
    wrong.push(...tag('best_line', blW));
    const compItems = (Array.isArray(context.comprehension_questions) ? context.comprehension_questions : [])
      .filter((q) => ['Find It', 'Language in the Story'].includes(q.section));
    const [, , compW] = gradeSoftWritten(compItems, answers.comprehension, context);
    wrong.push(...tag('comprehension', compW));
  } else if (slotId === 'ke_chuyen_con') {
    const openItems = (Array.isArray(context.comprehension_questions) ? context.comprehension_questions : [])
      .filter((q) => ['Open Question', 'Your Turn'].includes(q.section));
    const [, , w] = gradeSoftWritten(openItems, answers.open_response, context);
    wrong.push(...tag('open_response', w));
  }

  return { wrong_items: wrong };
}

export function gradeLessonSubmission(context, answers = {}) {
  const sections = [];
  let correct = 0;
  let total = 0;

  const addSection = (id, title, sectionCorrect, sectionTotal, wrongItems = []) => {
    if (!sectionTotal) return;
    correct += sectionCorrect;
    total += sectionTotal;
    sections.push({
      id,
      title,
      correct: sectionCorrect,
      total: sectionTotal,
      passed: sectionCorrect === sectionTotal,
      wrong_items: Array.isArray(wrongItems) ? wrongItems : [],
    });
  };

  const tagWrong = (type, indices) => (Array.isArray(indices) ? indices : []).map((index) => ({ type, index }));

  // Cluster 1: Cụm câu của con (matching only — chunks_glossary not graded)
  {
    const [c, t, wrong] = gradeMatching(context, answers.matching);
    addSection('cum_cau_con', '📚 Cụm câu của con', c, t, tagWrong('matching', wrong));
  }

  // Cluster 2: Dùng cụm câu (fill_blank + story_cloze combined)
  const [fbCorrect, fbTotal, fbWrong] = gradeArrayAnswers(
    context.answer_key?.fill_in_the_blank,
    answers.fill_blank,
    context.fill_in_the_blank,
  );
  let scCorrect = 0;
  let scTotal = 0;
  let scWrong = [];
  if (Array.isArray(context.story_cloze) && context.story_cloze.length) {
    [scCorrect, scTotal, scWrong] = gradeArrayAnswers(
      context.answer_key?.story_cloze,
      answers.story_cloze,
      context.story_cloze,
    );
  }
  addSection(
    'dung_cum_cau',
    '✏️ Dùng cụm câu',
    fbCorrect + scCorrect,
    fbTotal + scTotal,
    [...tagWrong('fill_blank', fbWrong), ...tagWrong('story_cloze', scWrong)],
  );

  // Cluster 3: Nghe & Đọc theo (tap_words for every level; shadowing not graded)
  {
    const [c, t, wrong] = gradeTapWords(context, answers.dictation);
    addSection('nghe_doc_theo', '🎧 Nghe & Đọc theo', c, t, tagWrong('dictation', wrong));
  }

  const comprehensionQuestions = Array.isArray(context.comprehension_questions)
    ? context.comprehension_questions
    : [];

  // Cluster 4: Minny asks story questions (best_line + soft written answers)
  {
    const [c, t, wrong] = gradeBestLine(context, answers.best_line);
    addSection('hieu_truyen_best', '💭 Minny hỏi con xíu nhé — Câu nghe tự nhiên', c, t, tagWrong('best_line', wrong));
  }
  const comprehensionItems = comprehensionQuestions.filter((q) => ['Find It', 'Language in the Story'].includes(q.section));
  {
    const [c, t, wrong] = gradeSoftWritten(comprehensionItems, answers.comprehension, context);
    addSection('hieu_truyen_text', '💭 Minny hỏi con xíu nhé — Trả lời câu hỏi', c, t, tagWrong('comprehension', wrong));
  }

  // Cluster 5: child tells Minny (soft grade with bilingual keyword pool)
  const openItems = comprehensionQuestions.filter((q) => ['Open Question', 'Your Turn'].includes(q.section));
  {
    const [c, t, wrong] = gradeSoftWritten(openItems, answers.open_response, context);
    addSection('ke_chuyen_con', '✍️ Con kể cho Minny nghe', c, t, tagWrong('open_response', wrong));
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
  const wrong = [];
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
    else wrong.push(index);
  });
  return [correct, gradeable, wrong];
}

// Tokenize a string into normalized lowercase words ≥2 letters.
// Pattern accepts Latin (a-z), Vietnamese diacritics (À-ỹ), and digits
// so kid answers in English OR Vietnamese both tokenize correctly.
const _WORD_RE = /[a-zA-ZÀ-ỹĐđÀ-ɏ]{2,}/g;
function _tokenize(value) {
  const s = String(value || '').toLowerCase();
  return s.match(_WORD_RE) || [];
}

function _buildSoftKeywordPool(items, context, currentQuestion = '') {
  const pool = new Set();
  const add = (text) => _tokenize(text).forEach((t) => pool.add(t));
  const ctx = context || {};
  // Story (EN + VN)
  if (Array.isArray(ctx.story_text)) ctx.story_text.forEach(add);
  if (Array.isArray(ctx.story_text_vi)) ctx.story_text_vi.forEach(add);
  // Power chunks (EN chunk + VN meaning)
  if (Array.isArray(ctx.power_chunks)) {
    ctx.power_chunks.forEach((c) => {
      add(c?.chunk);
      add(c?.meaning);
      add(c?.example);
    });
  }
  // All questions text in the items set (gives kid credit for repeating any keyword from any question)
  (Array.isArray(items) ? items : []).forEach((it) => add(it?.question));
  add(currentQuestion);
  return pool;
}

// Soft-grade rule (after pilot feedback that "asdf" was passing):
//   Pass requires BOTH:
//     (a) ≥3 word tokens (letters only, length ≥2 each)
//     (b) ≥1 token overlap with a bilingual keyword pool built from
//         story_text + story_text_vi + power_chunks + question text
//   Bilingual: works whether kid writes in English or Vietnamese.
function gradeSoftWritten(items, answerMap = {}, context = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [0, 0, []];
  const pool = _buildSoftKeywordPool(list, context);
  const MIN_TOKENS = 3;
  let correct = 0;
  const wrong = [];
  list.forEach((item, index) => {
    const tokens = _tokenize(answerMap?.[index]);
    if (tokens.length < MIN_TOKENS) {
      wrong.push(index);
      return;
    }
    // Allow per-item question keywords too (already in pool from buildKeywordPool,
    // but kept here for clarity if pool building changes later)
    const overlap = tokens.some((t) => pool.has(t));
    if (overlap) correct += 1;
    else wrong.push(index);
  });
  return [correct, list.length, wrong];
}

function gradeDictation(context, answerMap = {}) {
  const expected = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  let correct = 0;
  const wrong = [];
  expected.forEach((sentence, index) => {
    const actual = getIndexedAnswer(answerMap, index);
    const normA = normalizeText(actual);
    const normE = normalizeText(sentence);
    if (!normA) { wrong.push(index); return; }
    // Tolerance: 1 edit per ~8 chars, minimum 2, max 15% of length
    const tolerance = Math.max(2, Math.min(Math.floor(normE.length / 8), Math.floor(normE.length * 0.15)));
    if (levenshtein(normA, normE) <= tolerance) correct += 1;
    else wrong.push(index);
  });
  return [correct, expected.length, wrong];
}

function gradeTapWords(context, answerMap = {}) {
  const expected = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  let correct = 0;
  const wrong = [];
  expected.forEach((sentence, index) => {
    const actual = getIndexedAnswer(answerMap, index);
    if (!actual) { wrong.push(index); return; }
    if (normalizeText(actual) === normalizeText(sentence)) correct += 1;
    else wrong.push(index);
  });
  return [correct, expected.length, wrong];
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
  const wrong = [];
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
    else wrong.push(index);
  });
  return [correct, gradeable, wrong];
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
  const wrong = [];
  for (let index = 0; index < gradeable; index += 1) {
    const item = expected[index];
    if (item === undefined) continue;
    if (normalizeText(getIndexedAnswer(answerMap, index)) === normalizeText(item)) correct += 1;
    else wrong.push(index);
  }
  return [correct, gradeable, wrong];
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
