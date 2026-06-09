# READ2LEAD V3 — Gamification Initiative · Master Roadmap

**Codename:** V3 · **Started:** 2026-06-09 · **Owner of this doc:** Claude
**Status:** Phase A spec ready; deploy rails defined; parallel-agent plan defined.

> **What V3 is:** V2 = the shipped 5-activity lesson engine. **V3 = the gamification layer on top of it** — a Roblox-style compulsion loop: Avatar identity → earn coins → spend in a shop → climb a fast rank ladder → daily streak → "just one more." V2 has the skeleton (coins, avatar, rank, streak, leaderboard) but the loop is **broken** (coins can't be spent; rank advances only 4× in the whole journey). V3 fixes and completes the loop.

> **Read this if Phương is rate-limited and you (Codex/Cursor) must continue:** execute only **READY** items and the **STANDING BACKLOG**. Never improvise rank tiers, coin prices, or shop economy — those are Phương+Claude decisions. Follow `AGENTS.md` in each repo. Follow the **deploy rails** (§2) — students are using the live site right now.

---

## 1. Phases

| Phase | Goal | Repo | Status | Spec |
|---|---|---|---|---|
| **A. Prompt & story** | Kill cramming, native-author prose, (A.2) spaced repetition | backend | **READY (A.1)** | `read2lead_v0_codex/_claude/PROMPT_QUALITY_SPEC_2026-06-09.md` |
| **B. Rank ladder (Liên Quân)** | Decouple rank from level; Đồng I/II/III → Thách Đấu; rank-up every 1-2 packs | hub | SCOPED — needs Claude spec | TBD `docs/V3_PHASE_B_RANK_SPEC.md` |
| **C. Shop + cosmetics** | Coin sink: avatar/Minny cosmetics + consumables | hub | SCOPED — needs Claude spec | TBD `docs/V3_PHASE_C_SHOP_SPEC.md` |
| **D. Mini-game hub** | Spend coins on educational games (Phaser/kaboom) | hub | SCOPED — needs Claude spec + Phương game picks | TBD |
| **E. Juice & game-feel** | Confetti, sound, Minny animation, fix hard-to-tap activities | hub | SCOPED — needs Claude spec | TBD |
| **F. Logic & SEO hardening** | Fix audit bugs (double-submit, leaderboard cache, timeouts), SEO landing | hub | **READY (see Standing Backlog)** | this doc §5 |

**Dependency order:** A is independent (backend). B+C+E share the hub state layer → the **state-core foundation (§4 Zone Z2) must land first**, then B/C/E/F run in parallel. D after C (needs the coin-spend API).

---

## 2. Deploy rails — SAFE shipping while students use the live site

**The danger:** pushing to `main` auto-deploys to production instantly — Cloudflare Pages (hub) and Render (backend). Live kids are on it. So:

### Branch model
- **`main`** = production. Always shippable. Protected. **No direct feature commits.**
- **`v3`** = integration branch for the whole initiative. Gets a stable Cloudflare preview URL (`v3.felixbuilderhub.pages.dev`) to QA the full thing.
- **`v3/<phase>`** = one branch per work item, one agent each (`v3/a-prompt`, `v3/b-rank`, `v3/c-shop`, `v3/e-juice`, `v3/f-…`).

### Flow
1. Agent: `git checkout v3 && git pull` → `git checkout -b v3/<phase>`.
2. Work → test green → granular commits.
3. Push branch → Cloudflare auto-builds a **preview URL**. QA there, never on prod.
4. PR into **`v3`** (NOT `main`). Phương/Claude review on the preview.
5. Phương promotes **`v3` → `main`** only when a slice is complete AND flag-gated off, or fully verified.
6. **Rollback** = `git revert` the merge commit on `main` → push → auto-redeploys the previous good state.

### Feature flags (so half-built V3 can sit on main, dark)
- Hub (Astro): gate ALL new V3 UI behind `import.meta.env.PUBLIC_R2L_V3` (or `src/config/flags.ts`). Cloudflare env: **production `PUBLIC_R2L_V3=0`** until launch, **preview `=1`**. New code merges safely while invisible to kids.
- Backend prompt (Phase A): can't be flagged cleanly (it changes generated output). It is low-risk (better stories), so: test via `pilot_e2e_generate.py` + 4-pack manual QA on a **staging generation** before merging A → main. Do NOT merge prompt changes straight to main untested.

### Hard state-safety rule (live data!)
The `progress:<code>` KV records belong to real students. **All schema changes are additive + defaulted.** New code must read OLD records without crashing (missing field → sensible default). Never rename/remove an existing field. No destructive migration. This is non-negotiable — a bad migration corrupts a child's coins/rank/streak.

### Hotfix exception
Genuine **bug fixes** that help current users (a crash, mic failure, lost data) may go to `main` directly after tests pass — they are not "features." V3 **features** always go through `v3/<phase>` + flags.

---

## 3. Parallel agents — Cursor multi-agent plan

Cursor can run several agents at once. The only way that's safe is **strict file ownership: one file has exactly one owner at a time.** Collisions = merge hell. Use the zone matrix:

| Zone | Owner files (exclusive) | Phase | Repo |
|---|---|---|---|
| **Z1 Prompt** | `api/prompt_v2.py`, `tests/test_prompt_v2_invariants.py` | A | backend |
| **Z2 State-core** | `functions/api/_read2lead-v2-state.js`, `_read2lead-growth.js` (+ their tests) | B/C foundation | hub |
| **Z3 Rank UI** | `src/components/read2lead/v3/rank/*` (new), rank section of `review.astro` | B | hub |
| **Z4 Shop** | `src/pages/read2lead/shop.astro` (new), `src/components/read2lead/v3/shop/*` (new), `functions/api/read2lead-shop*.js` (new) | C | hub |
| **Z5 Juice** | `RewardBurst.astro`, reward visuals + CSS, sound assets, the reward calls in `lesson.astro` | E | hub |
| **Z6 Logic/SEO** | `submit-read2lead-lesson.js`, `read2lead-leaderboard.js`, `read2lead-progress*.js`, landing/SEO pages | F | hub |

### Collision guards
- **Z2 is shared by B and C** → it lands FIRST (one agent, serial). It defines: the rank-tier math (rank decoupled from level) + the coin-spend/inventory API contract. Until Z2 is merged to `v3`, B and C cannot start their UI.
- **`lesson.astro` has ONE owner at a time.** Z5 (juice) owns its reward visuals; if Z3 needs a rank-up hook in lesson, coordinate so they don't edit it simultaneously. When in doubt, serialize anything touching `lesson.astro`.
- Each agent works on its own `v3/<phase>` branch; integrate via `v3`.

### Recommended waves
- **Wave 0 (parallel):** Agent-A → Z1 Prompt (backend) ‖ Agent-B → Z2 State-core (hub foundation).
- **Wave 1 (parallel, after Z2 merges to `v3`):** Agent-C → Z3 Rank UI ‖ Agent-D → Z4 Shop ‖ Agent-E → Z6 backlog bugs.
- **Wave 2:** Agent-F → Z5 Juice (when `lesson.astro` is free).

Each new V3 zone (B/C/D/E) still **needs a Claude spec before coding** (see §1). Z6 backlog is pre-specified below.

---

## 4. What needs a Claude spec before any code (decision gates for Phương)

These can't be agent-improvised — Phương decides, Claude specs:
- **Rank tiers (B):** exact ladder names + how many sub-divisions + how XP/stars map to rank-up cadence (target: rank-up every 1-2 packs).
- **Shop economy (C):** coin prices, what's purchasable (cosmetics list), consumables, anti-grind balance.
- **Games (D):** which 1-2 educational games to clone/build, coin cost to play.
- **Juice (E):** which moments get effects, asset/sound choices (Phương's asset picks).

Ask Phương to pick the next phase; Claude writes the spec (5-lens audited) before the zone opens.

---

## 5. STANDING BACKLOG — READY, safe, pull anytime (rate-limit filler)

Pre-approved bug fixes from the QA audit. Each is self-contained, low-risk, and a clear improvement for **current** users — these may go to `main` as hotfixes after tests pass. One agent, one task, one commit.

| # | Task | File | Fix | Done when |
|---|---|---|---|---|
| BL-1 | Double-submit guards XP/coins | `functions/api/submit-read2lead-lesson.js` | Before awarding, check `web_attempts` already has a passing attempt for this `pack_id`; if so return `already_completed`. Also confirm hub disables submit button on click (it does). | A 2nd rapid submit awards nothing twice; test added. |
| BL-2 | Leaderboard O(N) → cached | `functions/api/read2lead-leaderboard.js` | Cache computed board in KV key `leaderboard-cache` with 5-min TTL; recompute on miss. Add rate limit. | No full KV scan per request; stale ≤5 min OK. |
| BL-3 | Fetch timeouts | `functions/api/generate-read2lead-pack.js`, `read2lead-speaking-check.js` | Add `AbortSignal.timeout(25000)`/`(20000)` to the Render/Groq fetches; return clean JSON error on timeout. | Slow upstream → friendly error, not Cloudflare 5xx page. |
| BL-4 | topicEmoji always default | `functions/api/_read2lead-library.js` | `TOPIC_EMOJI.length` → `Object.keys(TOPIC_EMOJI).length`. | Non-mapped topics get a varied emoji. |
| BL-5 | Dead code | `functions/api/submit-read2lead-lesson.js` | Remove unused `nextStreakDays`. | File smaller, tests green. |
| BL-6 | written_response re-render | `src/pages/read2lead/lesson.astro` | After `renderWrittenActivity`, call `finalizeCurrentActivityIfReady()` once so pre-filled drafts re-enable CTA without an extra keystroke. | Navigate away & back with all answers → CTA enabled immediately. |
| BL-7 | ensureLessonActivities dup retell | `src/pages/read2lead/lesson.astro` | Guard the second `< 6` block so it can't append a 2nd `retell_summary`. | Never >1 retell; dots match activity count. |

**Backend backlog (separate, in `read2lead_v0_codex`):**
| # | Task | File | Fix |
|---|---|---|---|
| BL-B1 | Crash on non-dict LLM output | `api/server.py` | After `generate_pack_v2`, `if not isinstance(pack, dict): raise ValueError(...)` so retry path triggers cleanly. |
| BL-B2 | `_publish_task_state` retry sends stale body | `api/server.py` | Rebuild the `urllib.Request` inside the retry loop (body is consumed after first send). |

> BL items are governed by `AGENTS.md`. Anything not listed here that touches a Protected Invariant still needs a Claude spec.

---

## 6. Change log of this roadmap
- 2026-06-09: Created. Named initiative **V3**. Phase A spec ready. Deploy rails + parallel-agent zones + standing backlog defined.
