/**
 * Guided Listening — paragraph-by-paragraph listening comprehension.
 *
 * Phase model:
 *    'story' → 'guided_listening' → 'activities'
 *
 * Each paragraph: play audio → answer yes/no + choice questions → done.
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
  /** Current phase of the guided listening flow */
  phase: 'idle' | 'playing' | 'questioning' | 'done';
  /** Index of the paragraph currently being worked on */
  paragraphIndex: number;
  /** Which paragraphs have been marked as played (audio consumed) */
  paragraphPlayed: boolean[];
  /** Which paragraphs have all questions answered correctly */
  paragraphsDone: boolean[];
  /** Per-question answers: key = `${paragraphIndex}:${questionId}` */
  answers: Record<string, GuidedAnswer>;
}

export interface GuidedAnswer {
  paragraphIndex: number;
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

    const normalizedQuestions: GuidedQuestion[] = rawQuestions.map((q: any) => {
      const base = {
        id: String(q.id ?? ''),
        question_vi: String(q.question_vi ?? ''),
        question_en: String(q.question_en ?? ''),
        paragraph_index: paraIdx,
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

export function createGuidedListeningState(paragraphCount: number): GuidedListeningState {
  const empty = new Array(paragraphCount).fill(false);
  return {
    phase: 'idle',
    paragraphIndex: 0,
    paragraphPlayed: [...empty],
    paragraphsDone: [...empty],
    answers: {},
  };
}

// ── State machine helpers ─────────────────────────────────────────────────────

/**
 * Mark that audio has been played for the current paragraph.
 * Transitions from 'idle'/'questioning' → 'questioning'.
 */
export function markParagraphPlayed(
  state: GuidedListeningState,
  paragraphIndex: number,
): GuidedListeningState {
  if (paragraphIndex < 0 || paragraphIndex >= state.paragraphPlayed.length) return state;
  const played = state.paragraphPlayed.slice();
  played[paragraphIndex] = true;
  return { ...state, paragraphPlayed: played, phase: 'questioning' };
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
  paragraphIndex: number,
  questionId: string,
  selectedIndex: number,
  correctIndex: number,
): GuidedListeningState {
  const key = `${paragraphIndex}:${questionId}`;
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

  const answers = { ...state.answers, [key]: { paragraphIndex, questionId, selectedIndex, correct, outcome, attempts } };

  // Check if all questions in this paragraph are correct → mark done
  const allCorrect = isParagraphAllCorrect(paragraphIndex, answers);

  if (allCorrect) {
    const done = state.paragraphsDone.slice();
    done[paragraphIndex] = true;
    const nextPhase = paragraphIndex >= state.paragraphPlayed.length - 1
      ? 'done'
      : 'idle';
    return { ...state, answers, paragraphsDone: done, phase: nextPhase };
  }

  return { ...state, answers, phase: 'questioning' };
}

/**
 * Whether every question in the paragraph has a correct answer recorded.
 */
function isParagraphAllCorrect(
  paragraphIndex: number,
  answers: Record<string, GuidedAnswer>,
): boolean {
  const relevant = Object.entries(answers).filter(
    ([, a]) => a.paragraphIndex === paragraphIndex,
  );
  // A paragraph with no questions is trivially complete.
  if (relevant.length === 0) return true;
  return relevant.every(([, a]) => a.correct);
}

/**
 * Move to the next paragraph. Phase resets to 'idle'.
 */
export function advanceToNextParagraph(state: GuidedListeningState): GuidedListeningState {
  const next = state.paragraphIndex + 1;
  if (next >= state.paragraphPlayed.length) {
    return { ...state, paragraphIndex: Math.min(next, state.paragraphPlayed.length - 1), phase: 'done' };
  }
  return { ...state, paragraphIndex: next, phase: 'idle' };
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
  paragraph_index: number;
  paragraph_played: boolean[];
  paragraphs_done: boolean[];
  answers: Record<string, { selected_index: number; correct: boolean; outcome: string; attempts: number }>;
}

export function restoreGuidedListeningState(
  saved: GuidedListeningSaveData | null | undefined,
  paragraphCount: number,
): GuidedListeningState {
  if (!saved) return createGuidedListeningState(paragraphCount);

  const empty = new Array(paragraphCount).fill(false);
  const answers: Record<string, GuidedAnswer> = {};

  Object.entries(saved.answers || {}).forEach(([key, a]) => {
    const [pIdx, qId] = key.split(':');
    answers[key] = {
      paragraphIndex: Number(pIdx),
      questionId: qId,
      selectedIndex: a.selected_index,
      correct: a.correct,
      outcome: a.outcome as GuidedAnswer['outcome'],
      attempts: a.attempts,
    };
  });

  const played = Array.isArray(saved.paragraph_played)
    ? saved.paragraph_played.map(Boolean)
    : [...empty];
  const done = Array.isArray(saved.paragraphs_done)
    ? saved.paragraphs_done.map(Boolean)
    : [...empty];

  const allDone = done.length > 0 && done.every(Boolean);
  const phase: GuidedListeningState['phase'] = allDone
    ? 'done'
    : (played[saved.paragraph_index] ? 'questioning' : 'idle');

  return {
    phase,
    paragraphIndex: Math.min(saved.paragraph_index, paragraphCount - 1),
    paragraphPlayed: played.length >= paragraphCount ? played : [...played, ...empty.slice(played.length)],
    paragraphsDone: done.length >= paragraphCount ? done : [...done, ...empty.slice(done.length)],
    answers,
  };
}
