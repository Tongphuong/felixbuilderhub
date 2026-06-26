# AGENTS.md — read2lead_v0_codex (backend) repo rules

> **Canonical multi-agent rules live in `_ops/AGENTS.md`** (GitHub: Tongphuong/read2lead-ops).
> Read that FIRST every session. This file = backend-specific zones + invariants only.

---

## 0. Read order before any task

1. `_ops/AGENTS.md` — role + behavior rules (canonical)
2. `_ops/PERMISSIONS.md` — what you can / cannot do
3. `CLAUDE.md` — architecture, folder map, repair chain
4. This file — backend-specific zones + invariants
5. Your spec (`_ops/specs/SPEC_*.md`)

---

## 1. Backend-specific protected invariants — DO NOT touch without a Claude spec

1. **5-function repair chain** (`_hydrate_v2_pack_defaults → _repair_story_sentences → _repair_activity_sentence_assignments → _repair_activity_b_tokens → _rotate_v2_mcq_answers`). **No 6th repair function.** If LLM output is wrong, fix the **prompt** (`api/prompt_v2.py`), not the server.
2. **Validator floor** (`api/validator_v2.py`): `min_sentences` / `min_words` are FLOOR values. Never lower them.
3. **Story-first contract:** activities use verbatim story sentences. No fabricated activity content.
4. **Pronoun rule:** boy → he/his/him, girl → she/her/hers. No mixing.
5. **Pack JSON shape** the hub consumes (`schemas/pack.schema.v2.json`). Renaming fields = cross-repo spec required.
6. **Generation cost:** each pack costs real LLM+TTS money. Do not add retries/loops that multiply calls.

Touching any of these requires a Claude-written spec — no exceptions.

---

## 2. Zone matrix

| Zone | Owner | Notes |
|---|---|---|
| `api/prompt_v2.py` | Codex | Prompt changes need Claude spec if they alter output shape |
| `api/server.py` | Codex | Repair chain is frozen — prompt fix first |
| `api/validator_v2.py` | Codex | Floor values are invariant |
| `api/generator_v2.py` | Codex | Model routing is locked (see CLAUDE.md) |
| `schemas/pack.schema.v2.json` | Claude only | Cross-repo impact |
| `tests/` | Codex | Must pass before any push |

---

## 3. Test requirements

```bash
pytest tests/ -q
```

All tests must pass before push. No `--no-verify`, no skipping.
