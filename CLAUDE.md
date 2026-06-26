# READ2LEAD BACKEND — SESSION ENTRY POINT

Read this file first. Every session. No exceptions.

---

## What this project is

**Read2Lead** is the backend API that generates interactive English-learning packs for Vietnamese children (ages 6-12). Phuong (online English tutor) triggers generation from the hub website; this repo handles LLM prompt → validate → TTS audio → R2 upload → callback.

---

## Architecture (production)

**Input**: POST `/generate-async-v2` with child_name, age, level (L1-L5), gender, interests, topic.

**Pipeline**: LLM prompt → JSON pack → 5 server-side repair passes → schema validation → parallel sentence TTS (OpenAI nova) → deferred full-story TTS → R2 upload → hub callback.

**Output**: Pack JSON with story + activities + per-sentence audio URLs.

**Model routing**: gpt-5-mini for L1-L2, gpt-5.4-mini for L3-L5, Opus 4.6 fallback. Anthropic Sonnet is EOL — do NOT route Anthropic primary.

**Hub** (separate repo `felixbuilderhub`): Astro site on Cloudflare Pages, reads pack from KV, renders interactive lesson at `/read2lead/lesson`.

---

## Activity types (current production)

| Activity | Type key | Items |
|---|---|---|
| A. Listen and Fill | `listening_fill_blank` | 5 MCQ |
| B. Listen and Order | `listen_and_order` | 5 sentence reorder |
| C. Read and Understand | `reading_comprehension` | 5 MCQ about plot |
| E. Listen and Speak | `listen_and_speak` | Sentences with Whisper scoring |

Activity D (`written_response`) was killed. Activity E will be replaced by Shadow phase in the redesign.

---

## Upcoming redesign (see MASTER_PLAN.md)

The approved master plan at `_ops/specs/MASTER_PLAN.md` describes a 4-phase lesson flow:
1. **Guided Listening** — paragraph-by-paragraph Q&A (new, spaCy-generated)
2. **Activities A/B/C** — existing, no backend changes
3. **Shadow** — all story sentences, Whisper scored (replaces Activity E)
4. **Read Aloud** — no audio model, Whisper scored (replaces old Retell)

Plus **Speak with Minny** — AI voice companion (separate product, shared student profile).

---

## Folder map

```text
read2lead_v0_codex/
├── CLAUDE.md              ← you are here
├── AGENTS.md              ← backend-specific rules + invariants
├── api/
│   ├── server.py          ← Flask app, all endpoints + repair chain
│   ├── prompt_v2.py       ← LLM system + user prompt builder
│   ├── generator_v2.py    ← LLM call (OpenAI primary, Anthropic fallback)
│   ├── validator_v2.py    ← Schema + cross-field validation
│   └── r2_uploader.py     ← Cloudflare R2 upload
├── audio/
│   └── generate_story_audio_openai.py  ← TTS module (nova voice)
├── schemas/
│   └── pack.schema.v2.json             ← JSON Schema (source of truth)
├── tests/                              ← pytest suite
├── _claude/
│   └── POSITIONING_RESEARCH_RAZKIDS.md ← competitive positioning research
└── README.md
```

---

## Server repair chain (runs after every LLM response)

Order matters. Do NOT add new repair functions without Claude spec approval.

```
_hydrate_v2_pack_defaults      → fill metadata (slug, level, student_name, etc.)
_repair_story_sentences        → re-split paragraphs into canonical sentences
_repair_activity_sentence_assignments → snap activity refs to canonical sentences
_repair_activity_b_tokens      → fix scrambled_tokens when > 16 tokens
_rotate_v2_mcq_answers         → redistribute correct_index across 0/1/2
```

**RULE: No new repair function without a Claude-written spec.** If LLM output is wrong, fix the prompt first. Only add repair if prompt fix is insufficient after 3 attempts.

---

## How to work in a new session

1. Read `CLAUDE.md` (this file)
2. Read `_ops/AGENTS.md` — team roles + rules
3. Read your task spec
4. Execute
5. Report in standard format (see AGENTS.md §4)

---

## Non-negotiable rules

1. Story is the source of all activities — no fabricated content
2. Sentences in activities must be verbatim from story paragraphs
3. Pronouns: boy → he/his/him, girl → she/her/hers, no mixing
4. Tone: playful, warm, mission-like — never exam-like
5. Stories feel close to Vietnamese children
6. No new repair functions without Claude spec
7. Validator bounds are FLOOR — do not lower min_sentences/min_words
8. All tests must pass before push (`pytest tests/ -q`)

---

## Key references

| Doc | Purpose |
|---|---|
| `_ops/specs/MASTER_PLAN.md` | Approved roadmap for 4-phase redesign + Speak with Minny |
| `_ops/AGENTS.md` | Team roles, rules, permissions |
| `schemas/pack.schema.v2.json` | Pack JSON Schema (source of truth) |
| `_claude/POSITIONING_RESEARCH_RAZKIDS.md` | Competitive positioning research |
