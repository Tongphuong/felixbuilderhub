# FELIXBUILDERHUB — REPOSITORY ENTRY POINT

Read `_ops/LEAD.md`, the last 10 lines of `_ops/AGENT_LOG.md`, and
`_ops/AGENTS.md` before this repository-specific file.

---

## What this project is

**felixbuilderhub** is the monorepo for Felix's English coaching products.
- **Frontend** (Astro): Read2Lead interactive lessons, Speak with Minny (upcoming), portfolio + lead-gen
- **Backend** (`backend/`): Python API on Render that generates reading packs
- **Users:** Vietnamese children (6-12) + their non-tech parents

---

## Key files — PROTECTED

| File | What it does | Status |
|---|---|---|
| `src/pages/read2lead/lesson.astro` | Main lesson page — renders pack activities, handles completion flow | **PROTECTED** — spec required |
| `public/scripts/r2l-recorder.js` | R2LRecorder class — on-device silence detection, WAV fallback | **PROTECTED** — spec required |
| `public/scripts/r2l-mic-check.js` | Mic permission + warmup countdown | **PROTECTED** — spec required |
| `public/scripts/read2lead-speaking-check.js` | Whisper STT + `scoreTranscript()` pronunciation scoring | **PROTECTED** — spec required |
| `functions/api/generate-pack-v2.js` | CF Worker: triggers backend pack generation | |
| `functions/api/read2lead-speaking-check.js` | CF Worker: proxies Whisper STT requests | |
| `functions/api/_read2lead-v2-state.js` | Graded rewards, badges, leaderboard state | |

---

## Non-negotiable rules

1. Big tap targets (44px+), instant feedback, no dead ends
2. No English error strings shown to kids — Vietnamese UI text
3. Lesson completion flow is protected — spec required for changes
4. Mic/recorder pipeline is protected — spec required for changes
5. `node --test` **must pass** before push (hard gate). `npx astro check` is advisory.
6. Pushing `main` = production deploy. Real kids are using this.

---

## Key references

| Doc | Purpose |
|---|---|
| `_ops/AGENTS.md` | Team roles, rules, permissions |
| `_ops/archive/MASTER_PLAN.md` | Historical roadmap (archived — current work is per-spec in `_ops/specs/`) |
| `docs/ENV.md` | Environment variables and setup |
| `schemas/SCHEMA.md` | KV data structure documentation |
