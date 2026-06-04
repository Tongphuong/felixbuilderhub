/* eslint-disable */ /* AUTO-GENERATED from schemas/pack.schema.json — do not edit by hand. Run npm run gen:types to regenerate. */

/**
 * Canonical schema for a Read2Lead reading pack. Hub-owned source of truth; R2L backend mirrors via schemas/pack.schema.json.
 */
export interface Read2LeadPack {
  /**
   * Child name used throughout the pack.
   */
  student_name: string;
  /**
   * Exact label emitted by the backend prompt for the requested level.
   */
  level_label: "L1 Beginner (A1/A1+)" | "L2 Early Reader (A2)" | "L3 Growing Reader (A2+/low B1)";
  /**
   * Short English topic name.
   */
  topic: string;
  /**
   * Lowercase underscore slug used for generated asset names.
   */
  slug: string;
  worksheet_title: string;
  /**
   * Story narration filename.
   */
  audio_filename: string;
  story_title: string;
  /**
   * English story paragraphs. Semantic word count is enforced by the Python validator.
   *
   * @minItems 2
   */
  story_text: [string, string, ...string[]];
  /**
   * Vietnamese parent/teacher reference paragraphs.
   *
   * @minItems 2
   */
  story_text_vi: [string, string, ...string[]];
  /**
   * @minItems 4
   * @maxItems 6
   */
  power_chunks:
    | [PowerChunk, PowerChunk, PowerChunk, PowerChunk]
    | [PowerChunk, PowerChunk, PowerChunk, PowerChunk, PowerChunk]
    | [PowerChunk, PowerChunk, PowerChunk, PowerChunk, PowerChunk, PowerChunk];
  matching_activity: MatchingActivity;
  build_the_chunk: string[];
  fill_in_the_blank: string[];
  fix_the_chunk: string[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  story_cloze: [string, string, string];
  /**
   * One sentence per power chunk. Pairing and level word ranges are semantic validator rules.
   */
  shadowing_sentences: string[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  best_line_challenge: [BestLineChallenge, BestLineChallenge, BestLineChallenge];
  /**
   * @minItems 7
   * @maxItems 7
   */
  comprehension_questions: [
    ComprehensionQuestion,
    ComprehensionQuestion,
    ComprehensionQuestion,
    ComprehensionQuestion,
    ComprehensionQuestion,
    ComprehensionQuestion,
    ComprehensionQuestion
  ];
  story_order: string[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  retell_frame: [string, string, string];
  answer_key: AnswerKey;
  parent_teacher_note: string;
  next_lesson_suggestion: string;
}
export interface PowerChunk {
  /**
   * Base-form collocation or useful phrase.
   */
  chunk: string;
  /**
   * Vietnamese gloss.
   */
  meaning: string;
  /**
   * Example sentence using the chunk.
   */
  example: string;
}
export interface MatchingActivity {
  /**
   * Same chunk strings as power_chunks, usually shuffled for display.
   *
   * @minItems 4
   * @maxItems 6
   */
  items:
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string];
  /**
   * Same Vietnamese meanings as power_chunks, in a different order.
   *
   * @minItems 4
   * @maxItems 6
   */
  meanings:
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string];
}
export interface BestLineChallenge {
  /**
   * @minItems 3
   * @maxItems 3
   */
  options: [string, string, string];
  correct_index: number;
}
export interface ComprehensionQuestion {
  section: "Find It" | "Think About It" | "Language in the Story" | "Open Question" | "Your Turn";
  question: string;
  hint_vi: string;
}
export interface AnswerKey {
  matching: string;
  build_the_chunk: string[];
  fill_in_the_blank: string[];
  fix_the_chunk: string[];
  /**
   * @minItems 3
   * @maxItems 3
   */
  story_cloze: [string, string, string];
  /**
   * @minItems 3
   * @maxItems 3
   */
  best_line_challenge: [number, number, number];
  /**
   * @minItems 7
   * @maxItems 7
   */
  comprehension: [string, string, string, string, string, string, string];
  story_order: string;
  suggested_retell: string;
}
