/**
 * Deterministic retell scaffolding for activity 6 (retell_summary).
 * Derives 3–4 kid-friendly Vietnamese guide questions from pack data.
 */

const ROADMAP_FALLBACK = (title) => [
  `Câu chuyện "${title}" kể về ai? Họ ở đâu?`,
  'Chuyện gì đã xảy ra? Con kể theo thứ tự nhé.',
  'Cuối câu chuyện, điều gì đã xảy ra?',
  'Con thích nhất điều gì trong truyện? Vì sao?',
];

function normalizeGuideText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function dedupeQuestions(questions) {
  const seen = new Set();
  const out = [];
  for (const raw of questions) {
    const text = normalizeGuideText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function pickComprehensionGuides(questions) {
  const guides = [];
  const findIt = questions.filter((q) => q?.section === 'Find It');
  const thinkIt = questions.filter((q) => q?.section === 'Think About It');
  const openQ = questions.find((q) => q?.section === 'Open Question');

  for (const q of findIt.slice(0, 2)) {
    if (q?.question_vi) guides.push(normalizeGuideText(q.question_vi));
  }
  for (const q of thinkIt.slice(0, 1)) {
    if (q?.question_vi) guides.push(normalizeGuideText(q.question_vi));
  }
  if (openQ?.question_vi) guides.push(normalizeGuideText(openQ.question_vi));

  return guides;
}

function pickWrittenGuides(questions) {
  const guides = [];
  for (const q of (questions || []).slice(0, 2)) {
    if (q?.question_vi) guides.push(normalizeGuideText(q.question_vi));
  }
  return guides;
}

function hintFromStory(story, topic) {
  const title = normalizeGuideText(story?.title);
  const paragraphs = Array.isArray(story?.paragraphs_en) ? story.paragraphs_en : [];
  const firstParagraph = normalizeGuideText(paragraphs[0]);
  const hint = title || normalizeGuideText(topic) || 'câu chuyện';
  return { title: title || 'câu chuyện', firstParagraph, hint };
}

/**
 * @param {{ story?: object, topic?: string, activities?: object[] }} lesson
 * @returns {string[]}
 */
export function buildRetellGuideQuestions(lesson) {
  const activities = Array.isArray(lesson?.activities) ? lesson.activities : [];
  const { title, hint } = hintFromStory(lesson?.story, lesson?.topic);

  const comprehension = activities.find((a) => a?.type === 'reading_comprehension');
  const written = activities.find((a) => a?.type === 'written_response');

  const derived = dedupeQuestions([
    `Câu chuyện "${title}" kể về điều gì?`,
    ...pickComprehensionGuides(comprehension?.questions || []),
    ...pickWrittenGuides(written?.questions || []),
    ...ROADMAP_FALLBACK(hint),
  ]);

  return derived.slice(0, 4);
}

/**
 * @param {{ story?: object, topic?: string, activities?: object[] }} lesson
 */
export function buildRetellPromptVi(lesson) {
  const title = normalizeGuideText(lesson?.story?.title) || 'câu chuyện';
  return `Con dùng ${Math.min(buildRetellGuideQuestions(lesson).length, 4)} câu gợi ý bên dưới để kể lại “${title}” bằng tiếng Anh trong khoảng 1 phút nhé.`;
}

/**
 * @param {{ story?: object }} lesson
 */
export function buildRetellPromptEn(lesson) {
  const title = normalizeGuideText(lesson?.story?.title) || 'the story';
  return `Use the guide questions below to tell the story of "${title}" in English. Say what happened and how it ended.`;
}
