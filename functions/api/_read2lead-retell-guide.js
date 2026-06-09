/**
 * Deterministic retell scaffolding for activity 6 (retell_summary).
 * Fill-in-the-blank English template + kid-friendly prompts.
 */

function normalizeGuideText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function storyParagraphs(lesson) {
  return Array.isArray(lesson?.story?.paragraphs_en) ? lesson.story.paragraphs_en : [];
}

function extractProtagonist(title, paragraphs) {
  const normalizedTitle = normalizeGuideText(title);
  const andMatch = normalizedTitle.match(/^([A-Za-z]+)\s+and\s+/i);
  if (andMatch) return andMatch[1];
  const titleName = normalizedTitle.match(/^([A-Z][a-z]+)/);
  if (titleName) return titleName[1];
  const firstParagraph = paragraphs[0] || '';
  const paragraphName = firstParagraph.match(/^([A-Z][a-z]+)/);
  return paragraphName ? paragraphName[1] : 'They';
}

function extractWherePhrase(paragraphs) {
  const text = paragraphs[0] || '';
  const match = text.match(/\b(?:went|goes|go|walked|runs)\s+to\s+(?:the\s+)?([a-z]+)\b/i);
  if (!match) return 'the place';
  const noun = match[1].toLowerCase();
  return text.match(new RegExp(`\\bthe\\s+${noun}\\b`, 'i')) ? `the ${noun}` : noun;
}

function extractPurposePhrase(paragraphs) {
  const text = paragraphs.slice(0, 2).join(' ');
  const match = text.match(
    /\bto\s+(fly|play(?:\s+with)?|feed|walk|hold|run|see)\s+((?:his|her|their|a|the)\s+)?([a-z]+(?:\s+[a-z]+){0,2})/i,
  );
  if (!match) return '';
  const verb = normalizeGuideText(match[1]);
  const possessive = normalizeGuideText(match[2] || '');
  const object = normalizeGuideText(match[3] || '');
  const phrase = [possessive, object].filter(Boolean).join(' ').trim();
  return phrase ? `${verb} ${phrase}` : verb;
}

function extractEventPhrase(paragraphs) {
  if (paragraphs[1]) return normalizeGuideText(paragraphs[1]).replace(/\.$/, '');
  if (paragraphs[0]) return normalizeGuideText(paragraphs[0]).replace(/\.$/, '');
  return 'something happens in the story';
}

function extractFeeling(paragraphs) {
  const last = paragraphs[paragraphs.length - 1] || '';
  const felt = last.match(/\bfelt\s+([a-z]+)/i);
  if (felt) return felt[1].toLowerCase();
  const was = last.match(/\bwas\s+(happy|sad|excited|proud|scared|glad|safe)\b/i);
  if (was) return was[1].toLowerCase();
  const direct = last.match(/\b(happy|sad|excited|proud|scared|glad|safe)\b/i);
  return direct ? direct[1].toLowerCase() : 'happy';
}

function extractWithWhom(paragraphs) {
  const match = (paragraphs[0] || '').match(/\bwith\s+(?:his|her|their)\s+[\w\s]+/i);
  return match ? normalizeGuideText(match[0]) : '';
}

/**
 * @param {{ story?: object, topic?: string }} lesson
 * @returns {{ title: string, lines: { template: string, hint_vi: string }[], speak_prompt_en: string }}
 */
export function buildRetellTemplate(lesson) {
  const paragraphs = storyParagraphs(lesson);
  const title = normalizeGuideText(lesson?.story?.title) || 'the story';
  const name = extractProtagonist(title, paragraphs);
  const where = extractWherePhrase(paragraphs);
  const purpose = extractPurposePhrase(paragraphs);
  const event = extractEventPhrase(paragraphs);
  const feeling = extractFeeling(paragraphs);
  const withWhom = extractWithWhom(paragraphs);
  const whomSuffix = withWhom ? ` ${withWhom}` : '';

  const purposeBlank = purpose ? ' to ______ (purpose)' : '';
  const lines = [
    {
      template: `${name} goes to ______ (where)${purposeBlank}${whomSuffix}.`,
      hint_vi: purpose ? 'địa điểm · việc con đến đó làm' : 'địa điểm',
    },
    {
      template: 'Then, ______ (what happens).',
      hint_vi: `gợi ý: ${shortEventHint(event)}`,
    },
    {
      template: `At the end, ${name} feels ______ (how).`,
      hint_vi: 'cảm xúc cuối truyện',
    },
  ];

  const purposeSegment = purpose ? ` to ${purpose}` : '';
  const speak_prompt_en = normalizeGuideText(
    `${name} goes to ${where}${purposeSegment}${whomSuffix}. Then, ${event}. At the end, ${name} feels ${feeling}.`,
  );

  return { title, lines, speak_prompt_en };
}

function shortEventHint(event) {
  const words = normalizeGuideText(event).split(/\s+/).slice(0, 6);
  return words.length ? `${words.join(' ')}…` : 'what happens next';
}

/** @deprecated Use buildRetellTemplate — kept for backwards compatibility in tests/migrations */
export function buildRetellGuideQuestions(lesson) {
  return buildRetellTemplate(lesson).lines.map((line) => line.template);
}

/**
 * @param {{ story?: object }} lesson
 */
export function buildRetellPromptVi(lesson) {
  const title = normalizeGuideText(lesson?.story?.title) || 'câu chuyện';
  return `Con nhìn truyện bên dưới, điền các chỗ trống và kể lại “${title}” bằng tiếng Anh trong khoảng 1 phút nhé.`;
}

/**
 * @param {{ story?: object }} lesson
 */
export function buildRetellPromptEn(lesson) {
  const title = normalizeGuideText(lesson?.story?.title) || 'the story';
  return `Read the story below, fill in the blanks, and retell "${title}" in English.`;
}
