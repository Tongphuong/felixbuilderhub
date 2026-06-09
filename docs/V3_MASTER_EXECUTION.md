# V3 MASTER EXECUTION — autonomous Cursor runbook (Claude away ~1 week)

**Owner:** Claude · **Updated:** 2026-06-09 (FINAL — after 5 self-critiques + 3 audits) · **For:** Cursor executing without Claude for ~1 week.

> **SINGLE ENTRY POINT.** Read top-to-bottom. Do items **in order** (§2). Sequential is the default; parallel only if you use separate git worktrees/agents (never two tasks on one working dir).
>
> **Prime directive:** make safe progress, never break the live site, never improvise product decisions. Ambiguous / needs a product/economy/art decision not written here → **SKIP, note it, move on.** Don't guess.

---

## 0. NON-NEGOTIABLE RULES

1. **Live students are on `main`** → `main` auto-deploys to production (Cloudflare hub + Render backend).
2. **Features go on branches, never straight to `main`.** Branch `v3-<phase>` → PR into **`v3`** (integration, has preview URL). **NEVER set `PUBLIC_R2L_V3=1` in production** — launch is Phương's call. All feature work lands flag-OFF in prod (invisible to kids); review via `?v3=1` on preview.
3. **Only these may reach `main` autonomously:** docs (Q0), observability (Q3, gated+scrubbed), and the LOW-RISK additive hub fixes explicitly listed in Q4. **Everything else stays on a branch + HOLD for Claude review** — especially anything touching `api/server.py`, the submit/XP/coins path, or the validator.
4. **Live data is sacred:** `progress:<code>` KV = real kids' coins/rank/streak. **Additive + defaulted only; never rename/remove a field; no destructive migration.** New code must read OLD records without crashing.
5. **Protected invariants (NO touch without a Claude spec):** the 5-function repair chain + validator floors (backend); Minny M0 voice; lesson completion logic. See `AGENTS.md` both repos.
6. **Gate ALL new V3 UI** behind `isV3Enabled()` (`src/config/flags.ts`: env `PUBLIC_R2L_V3` OR client `?v3=1`).
7. **One file = one task at a time.** `lesson.astro` and `_read2lead-v2-state.js` are hot — single owner. Parallel work requires separate worktrees.
8. **Every commit:** tests first (`node --test` hub / `pytest tests/ -q` backend) all green; `npx astro check` no NEW errors (pre-existing Header/admin errors known). Granular commits; end message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `--no-verify`, never force-push `main`.
9. **Report after each item:** commit hashes, files, test result, anything skipped + why.
10. **If tests won't pass after a reasonable attempt, or you're stuck:** revert that item's changes (`git restore` / drop the commit), leave a clear note in the report, and **move to the next item.** NEVER force a broken/red commit. A skipped item is fine; a broken live deploy is not.

---

## 0b. RESUMING ACROSS SESSIONS (Cursor's ~200k context resets)

This runbook is **stateless-resumable**: when your context fills and you start a fresh session, you lose memory but **git + this file are the source of truth**. Follow this every new session:

**BOOT CHECKLIST (start of every session):**
1. Read this file (`docs/V3_MASTER_EXECUTION.md`) + `AGENTS.md`.
2. `git fetch --all && git branch -a && git log --oneline --all -25` — see what's already been done.
3. Map the branches/commits to the queue (§2) → find the **first item NOT yet done**. **Never redo a completed item.** (e.g. if `v3-b-rank` already has a "monotonic rank_points" commit, Q1 is done.)
4. Read ONLY the spec + files needed for THAT one item — don't read everything; save context. (`lesson.astro` and `_read2lead-v2-state.js` are huge — reading them eats context fast.)

**RESUMPTION RULES:**
- **One queue item per session for the big ones (Q6 shop, Q7 juice).** They touch large files; budget your whole context for one item. Small items (Q0–Q4) can be batched.
- **Commit atomically.** Finish an item as one clean, tested commit. If you feel context running low mid-item, commit a clean, working, tested increment with a clear message (e.g. "Q6 shop: state layer (UI pending)") so the next session resumes from there — **never leave a broken or uncommitted mess.**
- **If `git status` is dirty at session start** (leftover from a cut-off session): inspect it. If it's coherent and tests pass → finish + commit it. If not → `git restore .` and restart that item cleanly.
- **End every session by reporting:** which queue items are now DONE (with commit hashes) and which item is NEXT. Phương saves these notes; Claude uses git + these on return.

> Net: a context reset costs nothing but a re-read. The danger is only redoing/half-doing an item — the boot checklist prevents that.

---

## 1. CURRENT STATE (2026-06-09)
- ✅ **Phase A (story prompt naturalness)** — MERGED `main`, live.
- 🟡 **Observability (Clarity+Sentry)** — built on `v3-observability`, verified safe, env vars set. Pending merge (Q3).
- 🟡 **Phase B (rank ladder)** — built on `v3-b-rank` (math/gating/voice/confetti verified). One fix pending: monotonic rank_points (Q1). Detail: `docs/V3_PHASE_B_RANK_SPEC.md` (incl. §6b).
- Flag OFF in prod (keep off all week). Branches: `v3-b-rank`, `v3-observability`; integration `v3`.
- ⚠️ Working tree currently has UNCOMMITTED docs → **Q0 cleans this first.**

---

## 1b. DEPENDENCIES & INTEGRATIONS (libraries / data / repos)

**Committed npm deps (vetted, keep):**
- `canvas-confetti` — already installed on `v3-b-rank` (rank-up burst). Reused by Q7 (juice). Import **dynamically** (`await import`) so it never bloats the lesson bundle.

**Scheduled deps:**
- `kaplay` (kaboom) — ONLY if a future mini-game needs game physics. The Q8 first game does NOT need it → **do not install unless required**, and if installed, lazy-load on the games page only.

**Free data integration (Q9):**
- **NGSL / CEFR wordlist** (free, published) — to tighten per-level vocabulary. **Prompt-side soft guidance only, on a branch, HOLD for review** (validator enforcement is too risky for the live pipeline).

**Paid integrations — Phương account + Claude spec required, NOT this week:** Microsoft Immersive Reader (reading), pronunciation API (SpeechAce/Azure), ElevenLabs TTS. See `docs/V3_ROADMAP.md` §4c.

**Repo policy:** **Do NOT clone third-party game/UI repos into this project** (license/quality/security risk). Use vetted npm packages only; look at open-source repos for IDEAS but build our own.

---

## 2. WORK QUEUE — do in order

### Q0 — Clean the tree: commit pending docs to `main`  ·  [DO FIRST, before any branch work]
```
git checkout main && git pull
git add docs/V3_ROADMAP.md docs/V3_PHASE_B_RANK_SPEC.md docs/V3_OBSERVABILITY_SPEC.md docs/V3_MASTER_EXECUTION.md
git commit -m "Add V3 specs + master execution runbook"
git push origin main
```
Confirm `git status` is clean before moving on.

### Q1 — FIX monotonic rank_points  ·  branch `v3-b-rank`
Implement `docs/V3_PHASE_B_RANK_SPEC.md` §6b exactly (persist cumulative `state.rank_points`; increment only in the newly-completed branch of `applyPackCompletion`; `computeRankLadder` prefers stored value else `rankPointsFromHistory`; add the "pack #51 low score doesn't lower rank" test). `node --test` green. Commit. Push `v3-b-rank`. Do NOT merge to main.

### Q2 — Land Phase B on `v3`  ·  [after Q1]
Merge `v3-b-rank` → `v3`; push `v3`. (Makes rank available on the `v3` preview via `?v3=1`, AND brings the `canvas-confetti` dep into `v3` for Q7.) Do NOT merge `v3` → `main`.

### Q3 — Ship observability to `main`  ·  [parallel-safe via worktree, else after Q0]
Merge `v3-observability` → `main` (verified: env-gated, PII scrubbed) → `node --test` green → push. Monitoring, not a flagged feature → main is correct. Data starts flowing once env vars are set (done).

### Q4 — LOW-RISK hub backlog → `main` hotfixes  ·  [safe, good filler]
Additive/low-risk, tested, one commit each. Detail in `docs/V3_ROADMAP.md` §5.
- **BL-2** leaderboard KV cache (5-min TTL) — `read2lead-leaderboard.js`.
- **BL-3** fetch timeouts (`AbortSignal.timeout`) — `generate-read2lead-pack.js`, `read2lead-speaking-check.js`.
- **BL-4** `topicEmoji` `Object.keys().length` — `_read2lead-library.js`.
- **BL-6** written_response re-render finalize — `lesson.astro`.
- **BL-7** ensureLessonActivities dup-retell guard — `lesson.astro`.
- (BL-5 dead-code removal optional.)

### Q5 — HIGHER-RISK fixes → branch `v3-fixes`, HOLD for Claude review  ·  [build, do NOT merge to main]
These touch live money/XP or the generation pipeline → build + test on a branch, **leave for review**.
- **BL-1** double-submit idempotency guard — `submit-read2lead-lesson.js` (gates rank; must land before flag-on, but needs review).
- **BL-B1** non-dict LLM guard — `read2lead_v0_codex/api/server.py`.
- **BL-B2** `_publish_task_state` rebuild Request in retry — `server.py`.
Push `v3-fixes`; report; wait.

### Q6 — Phase C: Coin Shop + cosmetics  ·  branch `v3-c-shop` (off `v3` after Q2)  ·  flag-gated
Full buildable MVP in `docs/V3_ROADMAP.md`/this file — **no art (emoji/CSS items), prices = tunable constants.**
- **State** (`_read2lead-v2-state.js`, additive): `inventory: string[]`, `equipped: {[slot]:itemId}` (default `[]`/`{}`); `SHOP_CATALOG` (~8 emoji/CSS cosmetics across slots hat/pet/frame/name_color with `price_coins`); `purchaseItem` (validate exists, not owned, coins≥price; deduct; never negative; idempotent), `equipItem`/`unequipSlot` (only if owned). Expose in responses. Tests: buy once / broke fails / owned no-op / equip-if-owned / old-record no crash.
- **Endpoint** `functions/api/read2lead-shop.js` (POST `{access_code, action, item_id|slot}`, rate-limited via `_rate-limit.js`, consistent `{ok,...}` JSON).
- **UI** (gated): `src/pages/read2lead/shop.astro` — balance, catalog (owned vs buyable), buy-with-confirm, equip toggle; show equipped on `hoc-sinh` near rank badge; Minny M0 line on buy. Link from profile (gated).
- Branch `v3-c-shop` → `v3`. Flag off prod. Unclear economy → use constants, note for Phương.

### Q7 — Phase E: Juice & game-feel  ·  branch `v3-e-juice`  ·  [after Q2 for confetti dep]
- **Confetti** (reuse `canvas-confetti`, dynamic import, respect `prefers-reduced-motion`): on a 3-in-a-row correct streak and on lesson-submit pass.
- **Sound — Web Audio ONLY, NO external files** (extend the existing synthesized beeps `_r2lPlayGoBeep`/`_r2lTickBeep` in `lesson.astro`): add short synth tones for correct / wrong / coin / level-up. Respect the existing `#sfx-toggle`.
- **Minny reactions:** swap existing Minny PNGs (`minny_idle/celebrate/...`) on correct/wrong/celebrate via CSS transitions.
- **Easier taps:** `listen_and_order` — ensure tap-to-place works on touch; instruction text "Bấm từng từ theo thứ tự" on mobile (HTML5 drag fails on touch). (written_response typing on mobile = note for later, don't solve now.)
- Tests structural; `astro check` no new errors. Branch `v3-e-juice` → `v3`. Single owner of `lesson.astro`.

### Q8 — Phase D: Mini-game hub  ·  branch `v3-d-games`  ·  flag-gated  ·  [OPTIONAL, lowest priority]
**If underspecified or the data isn't there, build only the hub shell + coin-gating and leave the game as a TODO — or SKIP entirely.**
- `src/pages/read2lead/games.astro` (gated): lists games; coin cost to play (consumable spend via the Q6 endpoint).
- First game (plain DOM, **no engine**): "Nghe & Chạm" — play a word's audio, tap the matching picture/word from 3-4 options, 5 rounds, words from the student's recent pack. **Note the data dependency:** if the games page can't fetch the student's recent vocab via an existing API, stop at the shell + leave a TODO (do not build new data plumbing without a spec).

### Q9 — CEFR/NGSL vocab tightening  ·  branch `v3-vocab`, HOLD for review  ·  [OPTIONAL]
Prepare the free NGSL/CEFR wordlist as data + a **prompt-side soft-guidance** change (give the model the level's word band as guidance). **Do NOT enforce in the validator** (would reject live output). Branch + report + wait for Claude.

---

## 3. SEQUENCING
- **Strict order:** Q0 → Q1 → Q2 (these unblock everything; Q2 brings rank + confetti into `v3`).
- **Then any time:** Q3 (observability→main), Q4 (safe bugs→main). Q5 (build+hold).
- **After Q2:** Q6 (shop) → Q7 (juice). Q6 and Q7 mostly different files but **must not both edit `hoc-sinh`/profile simultaneously**; do sequentially unless using worktrees.
- **Last / optional:** Q8 (games), Q9 (vocab).
- **Safe one-shot subset** (one capable agent, one session): **Q0 → Q1 → Q2 → Q3 → Q4.** Stop there; Q5–Q9 each get their own branch.

---

## 4. LEAVE FOR PHƯƠNG / CLAUDE (do NOT decide alone)
- Flipping `PUBLIC_R2L_V3=1` in production (the launch).
- Merging Q5 (`v3-fixes`) or Q9 (`v3-vocab`) to anything — HOLD for Claude review.
- Custom rank/shop ART; final coin PRICES; RP cadence; which games beyond the first; any paid 3rd-party (Immersive Reader / pronunciation / ElevenLabs).
- Any Protected-Invariant change (§0.5).

**When the queue is done:** stop, write a summary of every branch + its state + open questions, and wait. Do not invent new scope.

---

## 5. REFERENCE SPECS
- `docs/V3_ROADMAP.md` — phases, library decisions §4b, integrations research §4c, standing backlog §5.
- `docs/V3_PHASE_B_RANK_SPEC.md` — rank math/UI + §6b monotonic fix.
- `docs/V3_OBSERVABILITY_SPEC.md` — Clarity+Sentry.
- `read2lead_v0_codex/_claude/PROMPT_QUALITY_SPEC_2026-06-09.md` + `PROMPT_NATURALNESS_SPEC_2026-06-09.md` — story prompt (Phase A, done).
- `AGENTS.md` (both repos) — collaboration + protected invariants.
