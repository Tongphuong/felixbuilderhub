/**
 * Guided Listening — sentence-by-sentence listening comprehension.
 *
 * Phase model:
 *    'story' → 'guided_listening' → 'activities'
 *
 * Each sentence: play audio → answer 2-3 questions → auto-advance.
 *
 * Scores feed into the existing question_outcomes / lesson scoring pipeline.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GuidedQuestion {
  id: string;
  type: 'yes_no' | 'choice';
  /** Vietnamese question shown to the kid */
  question_vi: string;
  /** English question (optional, for reference) */
  question_en?: string;
  /** 2 options in English (synthesized ['Yes','No'] for yes_no) */
  options_en: string[];
  /** 2 options in Vietnamese (synthesized ['Có','Không'] for yes_no) */
  options_vi: string[];
  /** Index into options arrays of the correct answer (mapped from answer for yes_no) */
  correct_index: number;
  /** Backend paragraph index injected during normalization */
  paragraph_index: number;
  /** Global story sentence index injected during normalization */
  sentence_index: number;
  /** Raw boolean answer from backend (yes_no type only) */
  answer?: boolean;
}

export interface GuidedParagraph {
  index: number;
  /** Paragraph text (populated from story by the caller) */
  text_en?: string;
  text_vi?: string;
  audio_url?: string;
  questions: GuidedQuestion[];
}

export interface GuidedListeningState {
  /** Saved progress contract version. Version 2 is sentence-based. */
  progressVersion: 2;
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
 * Backend input shape:
 *   [{
 *     paragraph_index: number,
 *     questions: [
 *       { id, type: 'yes_no', question_en, question_vi, answer: boolean } |
 *       { id, type: 'choice', question_en, question_vi, options_en, options_vi, correct_index }
 *     ]
 *   }]
 *
 * Normalized output (each question has options_en, options_vi, correct_index):
 *   { paragraphs: GuidedParagraph[], questions: GuidedQuestion[] }
 *
 * For yes_no questions:
 *   - options_en is synthesized as ['Yes', 'No']
 *   - options_vi is synthesized as ['Có', 'Không']
 *   - answer: true  → correct_index: 0
 *   - answer: false → correct_index: 1
 * For choice questions:
 *   - options_en, options_vi, correct_index pass through as-is
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

    const entrySentenceIndex = Number(para?.sentence_index);
    const normalizedQuestions: GuidedQuestion[] = rawQuestions.map((q: any) => {
      const questionSentenceIndex = Number(q?.sentence_index);
      const base = {
        id: String(q.id ?? ''),
        question_vi: String(q.question_vi ?? ''),
        question_en: String(q.question_en ?? ''),
        paragraph_index: paraIdx,
        sentence_index: Number.isFinite(questionSentenceIndex)
          ? questionSentenceIndex
          : (Number.isFinite(entrySentenceIndex) ? entrySentenceIndex : paraIdx),
        answer: undefined as boolean | undefined,
      };

      if (q?.type === 'yes_no') {
        const answer = Boolean(q.answer);
        return {
          ...base,
          type: 'yes_no' as const,
          options_en: ['Yes', 'No'],
          options_vi: ['Có', 'Không'],
          correct_index: answer ? 0 : 1,
          answer,
        };
      }

      // choice type (default fallback)
      return {
        ...base,
        type: 'choice' as const,
        options_en: Array.isArray(q?.options_en) ? q.options_en : [],
        options_vi: Array.isArray(q?.options_vi) ? q.options_vi : [],
        correct_index: Number(q?.correct_index ?? 0),
        answer: undefined,
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
    progressVersion: 2,
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
 * `correctIndex` is the index of the correct option (from the paragraph definition).
 * Returns updated state with outcome computed.
 * For yes/no: first answer is always either correct or wrong;
 *   wrong → learner can retry (second_try). Third attempt = revealed.
 * For choice: similar; wrong lets you pick again (up to 2 attempts = revealed).
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
    outcome = attempts >= 2 ? 'revealed' : 'second_try'; // second attempt still hasn't gotten it right yet
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
 * Feeds the existing `activityResults[type]` shape.
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

  // If no entries yet, treat as zero correct out of 1 for 0%
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
  const isV2 = saved.progressVersion === 2 || Number.isFinite(Number(saved.sentenceIndex));
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
      for (let sentenceIndex = Number(start); sentenceIndex < end; sentenceIndex += 1) {
        expanded[sentenceIndex] = Boolean(flag);
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
    progressVersion: 2,
    phase,
    sentenceIndex: Math.max(0, Math.min(currentSentenceIndex, sentenceCount - 1)),
    sentencePlayed: played.length >= sentenceCount ? played.slice(0, sentenceCount) : [...played, ...empty.slice(played.length)],
    sentencesDone: done.length >= sentenceCount ? done.slice(0, sentenceCount) : [...done, ...empty.slice(done.length)],
    answers,
  };
}
