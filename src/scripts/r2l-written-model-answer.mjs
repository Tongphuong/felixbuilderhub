/** W1 written-response model answer — pack field first, RC match by question text only. */

export function normalizeQuestionText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{ question_en?: string, expected_answer_en?: string }} question
 * @param {Array<{ question_en?: string, options_en?: string[], correct_index?: number }>} rcQuestions
 * @returns {string}
 */
export function writtenModelAnswer(question, rcQuestions = []) {
  const direct = String(question?.expected_answer_en || '').trim();
  if (direct) return direct;

  const writtenKey = normalizeQuestionText(question?.question_en);
  if (!writtenKey) return '';

  const rcMatch = (rcQuestions || []).find(
    (rc) => normalizeQuestionText(rc?.question_en) === writtenKey,
  );
  if (!rcMatch?.options_en?.length) return '';

  const correctIndex = Number(rcMatch.correct_index);
  if (!Number.isInteger(correctIndex) || !rcMatch.options_en[correctIndex]) return '';

  return String(rcMatch.options_en[correctIndex]).trim();
}
