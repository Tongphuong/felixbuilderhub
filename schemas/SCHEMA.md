# Read2Lead V2 pack schema

Canonical: [pack.schema.v2.json](pack.schema.v2.json). Versioned alongside
the hub repo. R2L backend mirrors this file.

## Why V2

V1 was a printable worksheet contract: chunks, blanks, answer keys, PDF links.
V2 is a web-first lesson contract: story audio, sentence audio, four activity
blocks, rewards, and rank-state readiness. Keeping the schema explicit prevents
backend, hub functions, and lesson UI from drifting apart.

## Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer const `2` | yes | Version marker. V2 lesson only opens packs with this value. |
| `student_name` | string | yes | Child name used in story and UI. |
| `level` | enum | yes | `L1` through `L5`. |
| `level_label` | string | yes | Human-readable level label. |
| `topic` | string | yes | Topic/theme of the pack. |
| `slug` | string | yes | Lowercase file-safe slug. |
| `audio_filename` | string | yes | MP3 filename. Kept for future audio packaging. |
| `story` | object | yes | Story title, paragraphs, translations, sentence audio map. |
| `activities` | array | yes | Exactly four V2 activities. |
| `rewards` | object | yes | Coins/XP awarded on completion. |
| `parent_note_vi` | string | yes | Short Vietnamese parent note. |
| `next_suggestion_vi` | string | yes | Suggested next lesson direction. |

## Nested types

### story

- `title` — story title shown in the lesson UI.
- `paragraphs_en` — English story paragraphs.
- `paragraphs_vi` — Vietnamese support paragraphs.
- `full_audio_url` — full story audio URL when available.
- `sentences[]` — sentence-level English, Vietnamese, audio URL, and paragraph index.

### activities[]

Exactly four activity types are allowed:

- `listening_comprehension` — listen to story, answer multiple-choice questions.
- `listen_and_order` — listen to sentence audio and rebuild sentence order.
- `listen_and_speak` — listen and repeat; currently self-rated/soft-checked.
- `reading_comprehension` — read story, answer comprehension questions.

Each activity carries:

- `type`
- `title_vi`
- `identity_vi`
- `instructions_vi`
- `items` or `questions`, depending on activity type

### rewards

- `coins_on_complete` — base coins for completing the lesson.
- `xp_on_complete` — XP earned on completion.
- `bonus_coins_per_activity_attempted` — small reward per attempted activity.

## What the schema does NOT enforce

Semantic rules stay in the R2L backend validator:

- Story should be natural and level-appropriate.
- Audio URLs may be empty during early V2 pilot if audio generation is deferred.
- Activity questions should be answerable from the story.
- Listen-and-order tokens must reconstruct the original sentence.
- Reward values should feel motivating without inflating the economy.

JSON Schema enforces structure. Product quality still lives in prompt,
validator, tests, and Felix's pilot review.

## Versioning

Breaking changes require:

1. Update `schemas/pack.schema.v2.json`.
2. Regenerate `src/types/pack.d.ts` with `npm run gen:types`.
3. Mirror the schema to R2L backend.
4. Update both CHANGELOG files.
5. Deploy hub graceful handling before backend emits changed data.

Additive optional fields can ship without a major version bump, but must still
update this doc and regenerate types.
