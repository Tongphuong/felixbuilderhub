/* eslint-disable */ /* AUTO-GENERATED from schemas/pack.schema.v2.json — do not edit by hand. Run npm run gen:types to regenerate. */

/**
 * Schema for a V2 Read2Lead pack: story + 5 web activities + rewards. Replaces V1 chunk-based schema.
 */
export type Read2LeadPackV2 = {
  [k: string]: unknown;
} & {
  schema_version?: 2;
  student_name?: string;
  level?: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
  level_label?: string;
  topic?: string;
  slug?: string;
  audio_filename?: string;
  story: {
    title: string;
    /**
     * @minItems 2
     * @maxItems 24
     */
    paragraphs_en: [string, string, ...string[]];
    /**
     * @minItems 2
     * @maxItems 24
     */
    paragraphs_vi?: [string, string, ...string[]];
    full_audio_url?: string;
    trivia_vi?: string;
    trivia_en?: string;
    /**
     * @minItems 5
     * @maxItems 200
     */
    sentences: [
      {
        text_en: string;
        text_vi?: string;
        audio_url?: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi?: string;
        audio_url?: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi?: string;
        audio_url?: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi?: string;
        audio_url?: string;
        paragraph_index: number;
      },
      {
        text_en: string;
        text_vi?: string;
        audio_url?: string;
        paragraph_index: number;
      },
      ...{
        text_en: string;
        text_vi?: string;
        audio_url?: string;
        paragraph_index: number;
      }[]
    ];
  };
  /**
   * @minItems 1
   * @maxItems 6
   */
  activities:
    | [
        | ListeningFillBlank
        | ListenAndOrder
        | ReadingComprehension
        | WrittenResponse
        | ListenAndSpeak
        | ReadAloud
        | BookReadAloud
      ]
    | [
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        )
      ]
    | [
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        )
      ]
    | [
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        )
      ]
    | [
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        )
      ]
    | [
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        ),
        (
          | ListeningFillBlank
          | ListenAndOrder
          | ReadingComprehension
          | WrittenResponse
          | ListenAndSpeak
          | ReadAloud
          | BookReadAloud
        )
      ];
  /**
   * @minItems 1
   */
  guided_listening?: [GuidedListeningParagraph, ...GuidedListeningParagraph[]];
  rewards?: {
    coins_on_complete: number;
    xp_on_complete: number;
    bonus_coins_per_activity_attempted: number;
  };
  parent_note_vi?: string;
  next_suggestion_vi?: string;
  book_slug?: string;
  /**
   * @minItems 3
   * @maxItems 24
   */
  book_images?: [string, string, string, ...string[]];
  /**
   * @minItems 3
   * @maxItems 24
   */
  book_page_audio?: [string, string, string, ...string[]];
  book_attribution?: BookAttribution;
};

export interface ListeningFillBlank {
  type: "listening_fill_blank";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  /**
   * @minItems 5
   * @maxItems 5
   */
  items: [
    {
      id: string;
      audio_url?: string;
      source_sentence: string;
      sentence_with_blank: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      correct_index: number;
      explanation_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      source_sentence: string;
      sentence_with_blank: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      correct_index: number;
      explanation_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      source_sentence: string;
      sentence_with_blank: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      correct_index: number;
      explanation_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      source_sentence: string;
      sentence_with_blank: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      correct_index: number;
      explanation_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      source_sentence: string;
      sentence_with_blank: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      correct_index: number;
      explanation_vi: string;
    }
  ];
}
export interface ListenAndOrder {
  type: "listen_and_order";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  /**
   * @minItems 5
   * @maxItems 5
   */
  items: [
    {
      id: string;
      audio_url?: string;
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
      audio_url?: string;
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
      audio_url?: string;
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
      audio_url?: string;
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
      audio_url?: string;
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
export interface ReadingComprehension {
  type: "reading_comprehension";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  /**
   * @minItems 5
   * @maxItems 5
   */
  questions: [
    {
      id: string;
      section: "Find It" | "Think About It" | "Open Question";
      question_en: string;
      question_vi?: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_vi?: [string, string, string];
      correct_index: number;
      explanation_vi?: string;
    },
    {
      id: string;
      section: "Find It" | "Think About It" | "Open Question";
      question_en: string;
      question_vi?: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_vi?: [string, string, string];
      correct_index: number;
      explanation_vi?: string;
    },
    {
      id: string;
      section: "Find It" | "Think About It" | "Open Question";
      question_en: string;
      question_vi?: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_vi?: [string, string, string];
      correct_index: number;
      explanation_vi?: string;
    },
    {
      id: string;
      section: "Find It" | "Think About It" | "Open Question";
      question_en: string;
      question_vi?: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_vi?: [string, string, string];
      correct_index: number;
      explanation_vi?: string;
    },
    {
      id: string;
      section: "Find It" | "Think About It" | "Open Question";
      question_en: string;
      question_vi?: string;
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_en: [string, string, string];
      /**
       * @minItems 3
       * @maxItems 3
       */
      options_vi?: [string, string, string];
      correct_index: number;
      explanation_vi?: string;
    }
  ];
}
export interface WrittenResponse {
  type: "written_response";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  /**
   * @minItems 5
   * @maxItems 5
   */
  questions: [
    {
      id: string;
      question_en: string;
      question_vi: string;
      expected_answer_en?: string;
      hint_vi?: string;
    },
    {
      id: string;
      question_en: string;
      question_vi: string;
      expected_answer_en?: string;
      hint_vi?: string;
    },
    {
      id: string;
      question_en: string;
      question_vi: string;
      expected_answer_en?: string;
      hint_vi?: string;
    },
    {
      id: string;
      question_en: string;
      question_vi: string;
      expected_answer_en?: string;
      hint_vi?: string;
    },
    {
      id: string;
      question_en: string;
      question_vi: string;
      expected_answer_en?: string;
      hint_vi?: string;
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
   * @minItems 5
   * @maxItems 35
   */
  items: [
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    ...{
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    }[]
  ];
}
export interface ReadAloud {
  type: "read_aloud";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  scoring_mode: "self_rate" | "whisper_stt";
  /**
   * @minItems 5
   * @maxItems 35
   */
  items: [
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    {
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    },
    ...{
      id: string;
      audio_url?: string;
      text_en: string;
      text_vi: string;
      tip_vi: string;
    }[]
  ];
}
export interface BookReadAloud {
  type: "read_aloud";
  title_vi: string;
  identity_vi: string;
  instructions_vi: string;
  scoring_mode: "whisper_stt";
  /**
   * @minItems 5
   * @maxItems 200
   */
  items: [
    {
      id: string;
      text_en: string;
      audio_url: string;
    },
    {
      id: string;
      text_en: string;
      audio_url: string;
    },
    {
      id: string;
      text_en: string;
      audio_url: string;
    },
    {
      id: string;
      text_en: string;
      audio_url: string;
    },
    {
      id: string;
      text_en: string;
      audio_url: string;
    },
    ...{
      id: string;
      text_en: string;
      audio_url: string;
    }[]
  ];
}
export interface GuidedListeningParagraph {
  paragraph_index: number;
  /**
   * @minItems 2
   */
  questions: [GuidedListeningChoiceV3, GuidedListeningChoiceV3, ...GuidedListeningChoiceV3[]];
}
export interface GuidedListeningChoiceV3 {
  id: string;
  type: "choice";
  question_en: string;
  /**
   * @minItems 3
   * @maxItems 3
   */
  options_en: [string, string, string];
  correct_index: number;
  sentence_index: number;
}
export interface BookAttribution {
  title: string;
  /**
   * @minItems 1
   */
  creators: [string, ...string[]];
  publisher: string;
  credit_text: string;
  source_url: string;
  /**
   * @minItems 1
   */
  image_credits: [
    {
      page_index: number;
      credit_text: string;
    },
    ...{
      page_index: number;
      credit_text: string;
    }[]
  ];
  license: {
    name: "CC BY 4.0";
    url: "https://creativecommons.org/licenses/by/4.0/";
  };
}
