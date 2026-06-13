# AGENTS.md — felixbuilderhub (hub) repo rules

> **Canonical multi-agent rules live in `D:\_ops\AGENTS.md`** (GitHub: Tongphuong/read2lead-ops).
> Read that FIRST every session. This file only contains hub-specific zones + invariants.
> Claude maintains. Codex reads `AGENTS.md` automatically. Cursor: read both files first, every task.

---

## 0. Read order before any task

1. `D:\_ops\AGENTS.md` — role + behavior rules (canonical)
2. `D:\_ops\PERMISSIONS.md` — what you can / cannot do
3. `D:\_ops\BRANCH_CONVENTIONS.md` — branch naming + worktree
4. `D:\_ops\AGENT_LOG.md` — last 10 lines (xí chỗ trước)
5. This file — hub-specific zones + invariants
6. Your spec (`docs/SPEC_*.md` or `docs/V{N}_*.md`)

---

## 1. Hub-specific protected invariants — DO NOT touch without a Claude spec

1. **Minny voice (M0):** xưng "Minny"/"con"; no red/"sai"/FOMO; 1-2 câu; tiếng Việt chính; khen effort không khen rank. Any Minny copy you add must follow this.
2. **R2L positioning:** lesson/hero copy stays **functional** (bài tập, từ vựng, tự học). No USP/personalization hype/anti-competitor copy.
3. **Lesson completion logic** in `src/pages/read2lead/lesson.astro` (activity-complete → CTA enable → submit). Don't refactor it casually.
4. **The mic flow** (`public/scripts/r2l-mic-check.js`, `public/scripts/r2l-recorder.js`, the warmup countdown, `_r2lStartRecording`). Hard-won. Change only to a spec.
5. **Backend contract:** the pack JSON shape the hub reads from backend. Don't rename fields the lesson renderer depends on.

Touching any of these requires a Claude-written spec — không exception.

---

## 2. Hub-specific deploy rails (Cloudflare Pages auto-deploys `main` — students LIVE)

- **`main` deploys to production instantly. Real kids are using the site right now.**
- **V3 features**: branch `v3/<phase>` → PR into `v3` (NOT `main`) → Phương promotes `v3 → main`.
- **Feature-flag all new V3 UI** behind `import.meta.env.PUBLIC_R2L_V3` (production `=0` until launch). New code merges dark.
- **Live data sacred**: `progress:<code>` KV records are real students' coins/rank/streak. All schema changes **additive + defaulted**. Never rename/remove a field.
- Preview URL: `<branch>.felixbuilderhub.pages.dev`. QA there, never on prod.
- Hotfix exception per `_ops/PERMISSIONS.md` — crash/mic/data-loss → Codex được đi thẳng `main` sau test pass + ping Phương.

Full plan: `docs/V3_ROADMAP.md`.

---

## 3. Test + commit (hub-specific)

- **`node --test`** must pass before every commit.
- For `.astro` page logic changes: `npx astro check` — no NEW errors (pre-existing Header.astro / admin/codes.astro errors are known, ignore).
- Granular commits, present tense, one logical change.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never `--no-verify`, never force-push `main`, never skip hooks.

---

## 4. Zone matrix (cập nhật khi giao task mới)

| Agent | Vùng được sửa | Cấm đụng |
|---|---|---|
| **Claude** | main merges, specs, incident response, mic/speaking pipeline (`lesson.astro`, `r2l-recorder.js`, `r2l-mic-check.js`, `read2lead-speaking-check.js`) | — |
| **Codex** | Parent Portfolio (`docs/SPEC_PARENT_PORTFOLIO.md`): `src/pages/phu-huynh/*`, `src/pages/admin/portfolio.astro`, `functions/api/admin/portfolio*`, `functions/api/parent/*`, `tests/parent-portfolio.test.mjs` | lesson.astro, mic/recorder scripts, speaking-check API, mọi file V3/V4 |
| **Cursor #1** | `docs/SPEC_W2R_R1_RANK_CORE.md`: `functions/api/_read2lead-v2-state.js`, `functions/api/_read2lead-seasons.js` (new), `functions/api/submit-read2lead-lesson.js`, tests rank/seasons | mọi file src/, lesson.astro, leaderboard |
| **Cursor #2** | `docs/SPEC_W2R_R2_RANK_UI.md`: `src/components/read2lead/**`, `src/pages/hoc-sinh/**`, `src/scripts/r2l-w1-page.ts`, tests rank-ui | mọi file functions/, lesson.astro, leaderboard.astro |
| **Cursor #3** | `docs/SPEC_W2R_R3_LEADERBOARD.md`: `functions/api/read2lead-leaderboard.js`, `src/pages/read2lead/leaderboard.astro`, tests leaderboard | `_read2lead-v2-state.js`, mọi file hoc-sinh/, lesson.astro |

**Cập nhật zone**: chỉ Claude. Trước khi nhận task mới, agent check zone của mình ở đây + xem `D:\_ops\AGENT_REGISTRY.md` để chắc không trùng worktree.

---

## 5. Hub-specific customer reality

Users = **young VN kids (6-12)** + **non-tech parents zero patience**. Slow / confusing / breakable on weak 3G / cheap Android / iPad Safari = wrong, dù code đúng. Big tap targets, instant feedback, no dead ends, no English error strings shown to kids.

---

## 6. Files migrated to `_ops/`

These were in this file pre-2026-06-13, now canonical in `D:\_ops\`:

- Role definitions → `D:\_ops\AGENTS.md` §0
- Permission matrix → `D:\_ops\PERMISSIONS.md`
- Branch naming + worktree → `D:\_ops\BRANCH_CONVENTIONS.md`
- AGENT_LOG protocol → `D:\_ops\AGENT_LOG.md` (replaces deprecated `docs/AGENT_LOG.md`)
- Multi-agent ground rules + Cursor strict rules → `D:\_ops\AGENTS.md` §1, §3

`docs/AGENT_LOG.md` này **deprecated** — agents append vào `D:\_ops\AGENT_LOG.md` từ giờ.
