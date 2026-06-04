# Read2Lead pack schema

Canonical: [pack.schema.json](pack.schema.json). Versioned alongside hub
repo. R2L backend mirrors this file (see Phase β.3).

## Why a schema

Before β, every schema change required updating 3 places by hand
(`api/prompt.py` SYSTEM_PROMPT, `api/validator.py` required fields, hub
JS readers). Drift produced Phase G/I/L/N bugs. The schema is now the
single source of truth.

## Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `student_name` | string | yes | Child name used throughout the story and activities. |
| `level_label` | string enum | yes | Exact level label emitted by current backend prompt. |
| `topic` | string | yes | Short English topic name. |
| `slug` | string | yes | Lowercase underscore slug for generated file names. |
| `worksheet_title` | string | yes | Printable reading pack title. |
| `audio_filename` | string | yes | Story narration filename ending in `.mp3`. |
| `story_title` | string | yes | English story title. |
| `story_text` | string[] | yes | English story paragraphs, at least 2. |
| `story_text_vi` | string[] | yes | Vietnamese parent/teacher reference paragraphs, at least 2. |
| `power_chunks` | object[] | yes | 4-6 chunk objects with chunk, meaning, and example. |
| `matching_activity` | object | yes | Chunk strings and Vietnamese meanings for the matching task. |
| `build_the_chunk` | string[] | yes | Word-order prompts for building chunks. |
| `fill_in_the_blank` | string[] | yes | Scenario blanks using target chunks. |
| `fix_the_chunk` | string[] | yes | Incorrect chunk versions for correction. |
| `story_cloze` | string[] | yes | Exactly 3 story-recall sentences, each with one blank. |
| `shadowing_sentences` | string[] | yes | One short speak-aloud sentence per power chunk. |
| `best_line_challenge` | object[] | yes | Exactly 3 natural-English choice items. |
| `comprehension_questions` | object[] | yes | Exactly 7 comprehension/open-response questions. |
| `story_order` | string[] | yes | Story event ordering prompts. |
| `retell_frame` | string[] | yes | Exactly 3 retell sentence starters. |
| `answer_key` | object | yes | Teacher/parent answers for all graded tasks. |
| `parent_teacher_note` | string | yes | Vietnamese note for parent or teacher. |
| `next_lesson_suggestion` | string | yes | Vietnamese suggestion for the next pack. |

## Nested types

### power_chunks[i]

- `chunk` — base-form collocation, e.g., "kick the ball"
- `meaning` — Vietnamese gloss, e.g., "đá quả bóng"
- `example` — example sentence using the chunk

### comprehension_questions[i]

- `section` — enum: "Find It" | "Think About It" | "Language in the Story" | "Open Question" | "Your Turn"
- `question` — English question text
- `hint_vi` — Vietnamese sentence-starter or hint

### best_line_challenge[i]

- `options` — exactly 3 grammatical English variants
- `correct_index` — 0, 1, or 2

### answer_key

- `matching` — matching answer string, e.g., "1-X, 2-Y"
- `build_the_chunk` — array of correct chunk strings
- `fill_in_the_blank` — array of correct chunk strings
- `fix_the_chunk` — array of corrected chunk strings
- `story_cloze` — exactly 3 base-form chunk answers
- `best_line_challenge` — exactly 3 indices, each 0-2
- `comprehension` — exactly 7 answer strings
- `story_order` — correct event order string
- `suggested_retell` — model retell answer

## What the schema does NOT enforce

Semantic rules stay in Python validator:

- Every power_chunk must appear (substring) in story_text
- story_cloze sentences should resemble story_text sentences
- Story word count within level range (L1 60-130, L2 110-210, L3 170-310)
- answer_key.story_cloze[i] must be a base-form chunk from power_chunks
- best_line_challenge correct_index matches answer_key.best_line_challenge

These require domain knowledge JSON Schema can't express.

## Schema versioning

When making a breaking change (renaming a field, removing required):

1. Bump the schema's `version` property (add if not present)
2. Update CHANGELOG.md in hub
3. Sync to R2L mirror via Phase β.4 CI check
4. Hub frontend graceful-skip new field BEFORE backend emits it

Additive changes (new optional field) do not require version bump.
