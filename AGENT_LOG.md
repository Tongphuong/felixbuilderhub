# AGENT_LOG — felixbuilderhub

Append-only log of significant changes. Read last 10 entries for context.

---

## 2026-06-27 — Why-Not-You → Codex — Session: Wave 0 + Wave 1 (ReadAloud backend)

### What was done
- **Wave 0B:** Synced root schema (`schemas/pack.schema.v2.json`) from backend (guided_listening, activity constraints)
- **Wave 0C:** Removed dead `MASTER_PLAN.md` references from CLAUDE.md
- **Wave 1A:** `read_aloud` items now populated from story sentences in `_read2lead-lesson-activities.js`
- **Wave 1E:** Submission endpoint accepts `read_aloud` as valid activity + speaking type
- **Wave 1F:** Both schemas (root + backend) updated to allow 6 activities incl. `read_aloud`
- **Wave 1G:** 2 new tests (636 total, 0 fail)
- Merged to `main` (commit `64cbac9`), auto-deploy triggered

### What's left
- **Wave 2:** SpeakUp conversation mode on `/read2lead/speaking.astro`

### Git state
- Branch: `codex/wave1-read-aloud` (pushed, merged)
- main: `64cbac9`, clean, pushed
- Tests: 636/636 pass

## 2026-06-27 — Why-Not-You (backup architect) — Session: Wave 1 Frontend (ReadAloud UI)

### What was done
- **New component:** `src/components/read2lead/v2/ReadAloud.astro` — mic shell, Minny hero, activity body placeholder
- **lesson.astro (12 edits):**
  - Import + HTML for ReadAloud component
  - ACTIVITY_LABELS: added `read_aloud: 'Đọc to'`, renamed `listen_and_speak: 'Nói theo'`
  - FRONTEND_ACTIVITY_ORDER: added 5th slot
  - MINNY_COMMANDS: added read_aloud command, updated speak command text
  - PARENT_GUIDE: added read_aloud guide
  - W1_QUEST_ICONS: added 📖
  - `useLargeMinny`: extended to read_aloud
  - `renderAllActivitiesOnce`: added read_aloud branch → `renderReadAloudActivity`
  - New `renderReadAloudActivity` function — no listen step, direct record
  - New `_r2lMergeReadAloudScores` — parallel scoring function
  - New `persistReadAloudItemResult` + `restoreReadAloudProgress`
  - Scoring callback: shell-type detection for persist/merge routing
  - `activityItemsFromCard`: now handles both shells
  - `_r2lLessonNeedsMic`: extended to read_aloud
  - `_r2lApplyMicGate`: extended to both shells
  - Mic check mount: extended to read_aloud
  - `_r2lSkipMicSpeakingProgress`: extended to read_aloud
- **ActivityProgress.astro:** 4-step → 5-step nav
- **5 tests updated** from "legacy/retired" to "active activity"
- **Tests:** 636/636 pass

### Git state
- Branch: `hermes/wave1-read-aloud` (pushed, not merged)
- `154f6d2` — single commit
- 7 files changed, 262 insertions, 32 deletions

## 2026-06-27 — Claude — Session: monorepo merge + site redesign

### What was done

1. **Monorepo merge** — absorbed `read2lead_v0_codex` repo into `backend/` via git subtree merge (commit `8e54be3`). Backend Python code now lives at `backend/` in this repo.

2. **Deep cleanup** (commit `53821cd`) — deleted dead code, unified all student profile routes to `/ho-so`, removed stale docs.

3. **Build fix** (commit `b0158b0`) — restored `ho-so-topics.ts` that was accidentally deleted during cleanup. Without it, the build breaks (TypeScript import).

4. **Model routing fix** (commit `1a55600`) — dropped `gpt-5-mini` from backend generator. Now uses `gpt-5.4-mini` for ALL levels (L1-L5), with `claude-opus-4-6` fallback on attempt 3+. Reason: gpt-5-mini was failing Activity A validation 2/3 attempts on L1.

5. **Site redesign** (commit `1b943cd`) — major visual overhaul:
   - **Deleted** `src/pages/msmw.astro` (392 lines) — MSMW had no market traction
   - **Removed** all MSMW references from Header, Footer, homepage, coaching, privacy, BaseLayout
   - **Added** `/san-pham` — product picker page (Read2Lead + SpeakUp cards)
   - **Added** `/speak-up` — coming-soon landing page for SpeakUp
   - **Homepage** — inserted 3 big entry buttons (Coaching / Sản phẩm giáo dục / Hồ sơ học sinh), added SpeakUp card with "Sắp ra mắt" badge
   - **Ho-so entry** — restyled from Read2Lead green/game theme to site navy+gold+cream. Added 2 role pre-selection buttons (Phụ huynh / Học sinh) with `preSelectedRole` wiring in `ho-so.ts`
   - **Nav** — now shows: Coaching, Read2Lead, SpeakUp, Hồ sơ, Liên hệ
   - **Tests** updated: 634 pass, 0 fail
   - **Verified live** via Chrome browser on `felixbuilderhub.com` — all pages render correctly, `/msmw` returns 404

### Files changed (commit `1b943cd`)
```
src/pages/msmw.astro              — DELETED
src/pages/san-pham.astro          — NEW (product picker)
src/pages/speak-up.astro          — NEW (coming soon)
src/pages/index.astro             — 3 buttons + SpeakUp card + MSMW section deleted
src/pages/ho-so/index.astro       — restyled entry + role buttons
src/pages/ho-so/ho-so.ts          — preSelectedRole + entry role button wiring
src/components/Header.astro       — nav links updated
src/components/Footer.astro       — MSMW → SpeakUp link
src/layouts/BaseLayout.astro      — description text
src/pages/coaching.astro          — MSMW → SpeakUp text
src/pages/privacy.astro           — MSMW → SpeakUp text
src/config/pricing.ts             — removed MSMW pricing constants
tests/coaching-site-structure.test.mjs — updated assertions
```

### Git state after session
- Branch: `main`, clean, up to date with `origin/main`
- Latest: `1b943cd`
- 634 tests pass, 23 pages build
- 9 stale remote branches (all 0 commits ahead of main) — scheduled for deletion in Wave 0

### Schema mismatch discovered
`schemas/pack.schema.v2.json` (root) is OUT OF SYNC with `backend/schemas/pack.schema.v2.json`:
- Root: activities minItems 5, no guided_listening, listen_and_speak maxItems 5, reading_comprehension requires Vietnamese fields
- Backend: activities minItems 4, has guided_listening, listen_and_speak maxItems 35, reading_comprehension requires only English fields
- **Fix:** copy backend schema over root schema (Wave 0 task)

### Stale remote branches (all merged, 0 ahead of main)
```
origin/claude/cleanup
origin/codex/activity-cleanup
origin/codex/guided-listening-fix
origin/codex/guided-listening-lesson-fix
origin/codex/guided-listening-v3
origin/codex/read-aloud
origin/codex/student-profile-d1
origin/fix/guided-listening-flow
origin/hermes/guided-listening
```

### Next steps planned
- **Wave 1 (frontend):** Add ReadAloud UI in lesson.astro + rename listen_and_speak to "Nói theo" (Shadow)
- **Wave 2:** Add conversation mode to `/read2lead/speaking.astro` (SpeakUp with Minny)
- Full plan at `.claude/plans/sharded-knitting-beaver.md`
