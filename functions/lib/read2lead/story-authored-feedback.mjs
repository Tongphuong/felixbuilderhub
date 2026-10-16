import {screenStoryTranscript} from './story-transcript-screen.mjs';
import {validateReplyShape} from '../../api/_minny-guardrails.js';

// SPEC_R2L_MINNY_VOICE_COST.md Packet A2 (approved 2026-10-16): after the
// EXISTING grader's validated judgment, a 12-question interview answer turn is
// answered with fixed, authored lines (same voice, served from saved audio).
// This module only chooses the words. It never decides right/wrong: the
// caller passes the grader result, and praise is ONLY for a fully matched,
// confirmed answer (founder ruling: exact-only credit, no fake praise).

export const STORY_PRAISE_LINES = Object.freeze([
  "Yes, that's right!",
  'Great job!',
  'You got it!',
  "That's correct!",
]);
export const STORY_TRY_PREFIX = 'Good try! The answer is: ';
const MAX_REPLY = 220;

/** Deterministic: the same question always gets the same line. */
export function storyPraiseLine(taskId) {
  let h = 0;
  for (const ch of String(taskId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STORY_PRAISE_LINES[h % STORY_PRAISE_LINES.length];
}

/** Grader result is confirmed, an answer attempt (not a question/help), with
 * every criterion matched. This is the only state allowed to hear praise. */
export function isFullyMatched(judgment, task) {
  return judgment?.reliability === 'confirmed' && (judgment.intent === undefined || judgment.intent === 'answer') &&
    Array.isArray(task?.criteria) && task.criteria.length > 0 &&
    task.criteria.every(c => judgment.matchedCriteria.includes(c.id));
}
/** Confirmed, answer attempt, but something unmatched: gets the stored answer. */
export function isConfirmedWrong(judgment, task) {
  return judgment?.reliability === 'confirmed' && (judgment.intent === undefined || judgment.intent === 'answer') && !isFullyMatched(judgment, task);
}

const speakable = (text, lesson) => {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t || t.length > MAX_REPLY - STORY_TRY_PREFIX.length) return null;
  if ((t.match(/[.!?](?:\s|$)/g) || []).length > 1) return null; // whole line <= 2 sentences
  if (/[?<>@]|https?:|www\./i.test(t)) return null;
  const line = STORY_TRY_PREFIX + (/[.!?]$/.test(t) ? t : t + '.');
  if (line.length > MAX_REPLY || screenStoryTranscript(line, lesson).flagged || validateReplyShape(line).flagged) return null;
  return line;
};

/** The question's stored answer, from the lesson's own fields only:
 * accepted_meanings[0] when it is a short speakable sentence, else the option
 * at correct_index. Returns null when nothing safe exists (caller then keeps
 * the existing AI path). */
export function storyWrongAnswerLine(lesson, task) {
  const q = lesson?.questions?.find(x => x.id === task?.id);
  if (!q) return null;
  return speakable(q.accepted_meanings?.[0], lesson) ||
    speakable(Number.isInteger(q.correct_index) ? q.options_en?.[q.correct_index] : null, lesson);
}
