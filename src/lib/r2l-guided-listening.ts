/**
 * Guided Listening — sentence-by-sentence listening comprehension.
 *
 * Phase model:
 *    'story' → 'guided_listening' → 'activities'
 *
 * Each sentence: play audio → answer 2 WH- comprehension questions → auto-advance.
 * All questions are choice type with 3 options.
 *
 * Scores feed into the existing question_outcomes / lesson scoring pipeline.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GuidedQuestion {
  id: string;
  type: 'choice';
  /** English WH- comprehension question (Who/What/Where/When/Why/How) */
  question_en: string;
  /** 3 options in English */
  options_en: string[];
  /** Index into options arrays of the correct answer */
  correct_index: number;
  /** Backend paragraph index injected during normalization */
  paragraph_index: number;
  /** Global story sentence index */
  sentence_index: number;
}

export interface GuidedParagraph {
  index: number;
  questions: GuidedQuestion[];
}

export interface GuidedListeningState {
  /** Saved progress contract version. Version 3 is sentence-based with WH- questions. */
  progressVersion: 3;
  /** Current phase of the guided listening flow */
  phase: 'idle' | 'playing' | 'questioning' | 'done';
  /** Global index of the story sentence currently being worked on */
  sentenceIndex: number;
  /** Which sentence audio clips have been consumed */
  sentencePlayed: boolean[];
  /** Which sentences have all questions resolved or were skipped */
  sentencesDone: boolean[];
  /** Per-question answers: key = `${sentenceIndex}:${questionId}` */
  answers: Record<string, GuidedAnswer>;
}

export interface GuidedAnswer {
  sentenceIndex: number;
  questionId: string;
  selectedIndex: number;
  correct: boolean;
  /** 'first_try' | 'second_try' | 'revealed' — maps to lesson scoring */
  outcome: 'first_try' | 'second_try' | 'revealed';
  attempts: number;
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize the raw backend guided_listening array into the internal shape.
 *
 * Backend input shape (v3):
 *   [{
 *     paragraph_index: number,
 *     questions: [
 *       { id: 'gl_p0_s0_q1', type: 'choice', question_en: 'Who...?',
 *         options_en: ['A','B','C'], correct_index: 0, sentence_index: 0 }
 *     ]
 *   }]
 *
 * Normalized output:
 *   { paragraphs: GuidedParagraph[], questions: GuidedQuestion[] }
 */
export function normalizeGuidedListening(raw: any[]): { paragraphs: GuidedParagraph[]; questions: GuidedQuestion[] } {
  const paragraphs: GuidedParagraph[] = [];
  const questions: GuidedQuestion[] = [];

  if (!Array.isArray(raw)) {
    return { paragraphs, questions };
  }

  for (const para of raw) {
    const paraIdx = Number(para?.paragraph_index ?? 0);
    const rawQuestions = Array.isArray(para?.questions) ? para.questions : [];

    const normalizedQuestions: GuidedQuestion[] = rawQuestions.map((q: any) => {
      const questionType = q?.type === 'choice' ? 'choice' : 'choice'; // everything is choice in v3
      return {
        id: String(q.id ?? ''),
        type: 'choice' as const,
        question_en: String(q.question_en ?? ''),
        options_en: Array.isArray(q?.options_en) ? q.options_en.slice(0, 3) : [],
        correct_index: Number(q?.correct_index ?? 0),
        paragraph_index: paraIdx,
        sentence_index: Number.isFinite(Number(q?.sentence_index))
          ? Number(q.sentence_index)
          : paraIdx,
      };
    });

    paragraphs.push({
      index: paraIdx,
      questions: normalizedQuestions,
    });

    questions.push(...normalizedQuestions);
  }

  return { paragraphs, questions };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGuidedListeningState(sentenceCount: number): GuidedListeningState {
  const empty = new Array(sentenceCount).fill(false);
  return {
    progressVersion: 3,
    phase: 'idle',
    sentenceIndex: 0,
    sentencePlayed: [...empty],
    sentencesDone: [...empty],
    answers: {},
  };
}

// ── State machine helpers ─────────────────────────────────────────────────────

/**
 * Mark that audio has been played for the current sentence.
 * Transitions from 'idle'/'questioning' → 'questioning'.
 */
export function markSentencePlayed(
  state: GuidedListeningState,
  sentenceIndex: number,
): GuidedListeningState {
  if (sentenceIndex < 0 || sentenceIndex >= state.sentencePlayed.length) return state;
  const played = state.sentencePlayed.slice();
  played[sentenceIndex] = true;
  return { ...state, sentencePlayed: played, phase: 'questioning' };
}

/**
 * Record a learner's answer to a guided question.
 * First wrong answer → can retry (second_try). Second wrong = revealed.
 */
export function recordAnswer(
  state: GuidedListeningState,
  sentenceIndex: number,
  questionId: string,
  selectedIndex: number,
  correctIndex: number,
  expectedQuestionIds: string[] = [questionId],
): GuidedListeningState {
  const key = `${sentenceIndex}:${questionId}`;
  const existing = state.answers[key];

  // If already correct on first_try, ignore subsequent submissions.
  if (existing?.outcome === 'first_try') return state;

  const prevAttempts = existing?.attempts ?? 0;
  const attempts = prevAttempts + 1;
  const correct = selectedIndex >= 0 && selectedIndex === correctIndex;

  let outcome: 'first_try' | 'second_try' | 'revealed';
  if (correct) {
    outcome = attempts === 1 ? 'first_try' : 'second_try';
  } else {
    outcome = attempts >= 2 ? 'revealed' : 'second_try';
  }

  const answers = { ...state.answers, [key]: { sentenceIndex, questionId, selectedIndex, correct, outcome, attempts } };

  const allCorrect = isSentenceAllCorrect(sentenceIndex, answers, expectedQuestionIds);

  if (allCorrect) {
    const done = state.sentencesDone.slice();
    done[sentenceIndex] = true;
    const nextPhase = sentenceIndex >= state.sentencePlayed.length - 1
      ? 'done'
      : 'idle';
    return { ...state, answers, sentencesDone: done, phase: nextPhase };
  }

  return { ...state, answers, phase: 'questioning' };
}

/**
 * Whether every recorded question for the sentence has a correct answer.
 */
function isSentenceAllCorrect(
  sentenceIndex: number,
  answers: Record<string, GuidedAnswer>,
  expectedQuestionIds: string[],
): boolean {
  if (expectedQuestionIds.length === 0) return true;
  return expectedQuestionIds.every((questionId) => answers[`${sentenceIndex}:${questionId}`]?.correct);
}

/**
 * Move to the next sentence. Phase resets to 'idle'.
 */
export function advanceToNextSentence(state: GuidedListeningState): GuidedListeningState {
  const next = state.sentenceIndex + 1;
  if (next >= state.sentencePlayed.length) {
    return { ...state, sentenceIndex: Math.min(next, state.sentencePlayed.length - 1), phase: 'done' };
  }
  return { ...state, sentenceIndex: next, phase: 'idle' };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface GuidedScore {
  correct_count: number;
  total_count: number;
  score_percent: number;
  /** Outcome-by-outcome breakdown for question_outcomes pipeline */
  question_outcomes: Array<{ id: string; outcome: string; attempts: number }>;
}

/**
 * Build a score snapshot from the guided listening answers.
 */
export function scoreGuidedListening(state: GuidedListeningState): GuidedScore {
  const entries = Object.values(state.answers);
  let correct = 0;
  let total = 0;
  const question_outcomes: GuidedScore['question_outcomes'] = [];

  entries.forEach((entry) => {
    total += 1;
    if (entry.correct) correct += 1;
    question_outcomes.push({
      id: entry.questionId,
      outcome: entry.outcome,
      attempts: entry.attempts,
    });
  });

  const effectiveTotal = Math.max(total, 1);

  return {
    correct_count: correct,
    total_count: effectiveTotal,
    score_percent: Math.round((correct / effectiveTotal) * 100),
    question_outcomes,
  };
}

// ── Migration / restore from saved session ────────────────────────────────────

export interface GuidedListeningSaveData {
  progressVersion?: number;
  sentenceIndex?: number;
  sentencePlayed?: boolean[];
  sentencesDone?: boolean[];
  paragraph_index?: number;
  paragraphIndex?: number;
  paragraph_played?: boolean[];
  paragraphPlayed?: boolean[];
  paragraphs_done?: boolean[];
  paragraphsDone?: boolean[];
  answers: Record<string, { selected_index: number; correct: boolean; outcome: string; attempts: number }>;
}

export function restoreGuidedListeningState(
  saved: GuidedListeningSaveData | null | undefined,
  sentenceCount: number,
  sentenceIndexesByParagraph: number[] = [],
): GuidedListeningState {
  if (!saved) return createGuidedListeningState(sentenceCount);

  const empty = new Array(sentenceCount).fill(false);
  const answers: Record<string, GuidedAnswer> = {};
  const isV2 = saved.progressVersion === 2 || saved.progressVersion === 3 || Number.isFinite(Number(saved.sentenceIndex));
  const legacyParagraphIndex = Number(saved.paragraphIndex ?? saved.paragraph_index ?? 0);
  const migratedSentenceIndex = sentenceIndexesByParagraph[legacyParagraphIndex] ?? legacyParagraphIndex;
  const currentSentenceIndex = isV2 ? Number(saved.sentenceIndex ?? 0) : migratedSentenceIndex;

  Object.entries(saved.answers || {}).forEach(([key, a]) => {
    const [savedIndex, qId] = key.split(':');
    const sentenceIndex = isV2
      ? Number(savedIndex)
      : (sentenceIndexesByParagraph[Number(savedIndex)] ?? Number(savedIndex));
    const migratedKey = `${sentenceIndex}:${qId}`;
    answers[migratedKey] = {
      sentenceIndex,
      questionId: qId,
      selectedIndex: a.selected_index,
      correct: a.correct,
      outcome: a.outcome as GuidedAnswer['outcome'],
      attempts: a.attempts,
    };
  });

  const savedPlayed = isV2
    ? saved.sentencePlayed
    : (saved.paragraphPlayed ?? saved.paragraph_played);
  const savedDone = isV2
    ? saved.sentencesDone
    : (saved.paragraphsDone ?? saved.paragraphs_done);
  const expandLegacyFlags = (flags: boolean[] | undefined): boolean[] => {
    if (!Array.isArray(flags)) return [...empty];
    if (isV2 || sentenceIndexesByParagraph.length === 0) return flags.map(Boolean);
    const expanded = [...empty];
    flags.forEach((flag, paragraphIndex) => {
      const start = sentenceIndexesByParagraph[paragraphIndex];
      if (!Number.isFinite(start)) return;
      const nextStart = sentenceIndexesByParagraph
        .slice(paragraphIndex + 1)
        .find((index) => Number.isFinite(index));
      const end = Number.isFinite(nextStart) ? Number(nextStart) : sentenceCount;
      for (let sIdx = Number(start); sIdx < end; sIdx += 1) {
        expanded[sIdx] = Boolean(flag);
      }
    });
    return expanded;
  };
  const played = expandLegacyFlags(savedPlayed);
  const done = expandLegacyFlags(savedDone);

  const allDone = done.length > 0 && done.every(Boolean);
  const phase: GuidedListeningState['phase'] = allDone
    ? 'done'
    : (played[currentSentenceIndex] ? 'questioning' : 'idle');

  return {
    progressVersion: 3,
    phase,
    sentenceIndex: Math.max(0, Math.min(currentSentenceIndex, sentenceCount - 1)),
    sentencePlayed: played.length >= sentenceCount ? played.slice(0, sentenceCount) : [...played, ...empty.slice(played.length)],
    sentencesDone: done.length >= sentenceCount ? done.slice(0, sentenceCount) : [...done, ...empty.slice(done.length)],
    answers,
  };
}
