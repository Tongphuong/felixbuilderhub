/* eslint-disable */ /* AUTO-GENERATED from schemas/pack.schema.v2.json — do not edit by hand. Run npm run gen:types to regenerate. */

/**
 * Schema for a V2 Read2Lead pack: story + 4 activities + rewards. Replaces V1 chunk-based schema.
 */
export interface Read2LeadPackV2 {
  schema_version: 2;
  student_name: string;
  level: "L1" | "L2" | "L3" | "L4" | "L5";
  level_label: string;
  topic: string;
  slug: string;
  audio_filename: string;
  story: {
    title: string;
    /**
     * @minItems 2
     * @maxItems 6
     */
    paragraphs_en:
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string];
    /**
     * @minItems 2
     * @maxItems 6
     */
    paragraphs_vi:
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string];
    full_audio_url: string;
    /**
     * @minItems 6
     * @maxItems 35
     */
    sentences: [
      {
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      },
      ...{
        text_en: string;
        text_vi: string;
        audio_url: string;
        paragraph_index: number;
      }[]
    ];
  };
  /**
   * @minItems 4
   * @maxItems 4
   */
  activities: [
    ListeningComprehension | ListenAndOrder | ListenAndSpeak | ReadingComprehension,
    ListeningComprehension | ListenAndOrder | ListenAndSpeak | ReadingComprehension,
    ListeningComprehension | ListenAndOrder | ListenAndSpeak | ReadingComprehension,
    ListeningComprehension | ListenAndOrder | ListenAndSpeak | ReadingComprehension
  ];
  rewards: {
    coins_on_complete: number;
    xp_on_complete: number;
    bonus_coins_per_activity_attempted: number;
  };
  parent_note_vi: string;
  next_suggestion_vi: string;
}
export interface ListeningComprehension {
  type: "listening_comprehension";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  full_story_audio_url: string;
  /**
   * @minItems 2
   * @maxItems 5
   */
  questions:
    | [McqQuestion, McqQuestion]
    | [McqQuestion, McqQuestion, McqQuestion]
    | [McqQuestion, McqQuestion, McqQuestion, McqQuestion]
    | [McqQuestion, McqQuestion, McqQuestion, McqQuestion, McqQuestion];
}
export interface McqQuestion {
  id: string;
  question_en: string;
  question_vi: string;
  /**
   * @minItems 3
   * @maxItems 3
   */
  options_en: [string, string, string];
  /**
   * @minItems 3
   * @maxItems 3
   */
  options_vi: [string, string, string];
  correct_index: number;
  explanation_vi: string;
}
export interface ListenAndOrder {
  type: "listen_and_order";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  /**
   * @minItems 3
   * @maxItems 6
   */
  items:
    | [
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        },
        {
          id: string;
          audio_url: string;
          original_sentence: string;
          /**
           * @minItems 3
           * @maxItems 16
           */
          scrambled_tokens:
            | [string, string, string]
            | [string, string, string, string]
            | [string, string, string, string, string]
            | [string, string, string, string, string, string]
            | [string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string]
            | [string, string, string, string, string, string, string, string, string, string, string, string, string]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ]
            | [
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string,
                string
              ];
          /**
           * @minItems 3
           * @maxItems 16
           */
          correct_order_indices:
            | [number, number, number]
            | [number, number, number, number]
            | [number, number, number, number, number]
            | [number, number, number, number, number, number]
            | [number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number]
            | [number, number, number, number, number, number, number, number, number, number, number, number, number]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ]
            | [
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
                number
              ];
          translation_vi: string;
        }
      ];
}
export interface ListenAndSpeak {
  type: "listen_and_speak";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  scoring_mode: "self_rate" | "whisper_stt";
  /**
   * @minItems 4
   * @maxItems 10
   */
  items:
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ]
    | [
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        },
        {
          id: string;
          audio_url: string;
          text_en: string;
          text_vi: string;
          tip_vi: string;
        }
      ];
}
export interface ReadingComprehension {
  type: "reading_comprehension";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  /**
   * @minItems 3
   * @maxItems 6
   */
  questions:
    | [
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        }
      ]
    | [
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        }
      ]
    | [
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        }
      ]
    | [
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        },
        {
          id: string;
          section: "Find It" | "Think About It" | "Open Question";
          question_en: string;
          question_vi: string;
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_en: [string, string, string];
          /**
           * @minItems 3
           * @maxItems 3
           */
          options_vi: [string, string, string];
          correct_index: number;
          explanation_vi: string;
        }
      ];
}
