# AGENTS.md — Hard rules for Codex & Cursor (felixbuilderhub / hub)

> **This file is the source of truth for how AI coders behave in this repo.**
> Claude owns this file. If a rule is wrong, Phương/Claude edits HERE — do not argue with it in chat.
> Codex reads `AGENTS.md` automatically. Cursor: read this file first, every task.

---

## 0. Who does what (do not cross these lines)

| Role | Owns |
|---|---|
| **Claude** | Architecture, specs, roadmap, 5-lens audits, reviewing your commits. |
| **Codex / Cursor (you)** | Implement an existing Claude spec, exactly. Run tests. Commit. Report. |
| **Phương** | Final decisions, money/economy values, asset/voice/UX picks, manual test. |

**Golden rule:** You implement specs. You do **not** invent systems. If there is no written spec for the task, **STOP** and tell Phương "cần Claude viết spec trước" — do not improvise rank tiers, coin prices, shop economy, new activity types, or new data schemas.

---

## 1. Only execute work that is marked READY

- Read `docs/ROADMAP_GAMIFICATION_2026-06-09.md`.
- Execute only phases/tasks marked **READY** (a full spec exists).
- Tasks marked **SCOPED — NEEDS SPEC** are NOT cleared for coding. You may read/plan but must not finalize.
- When idle / Phương is away (rate limit), pull from the **STANDING BACKLOG** in the roadmap — those are pre-approved, low-risk, fully specified.

---

## 2. Protected invariants — DO NOT touch without a Claude spec

- **Minny voice (M0):** xưng "Minny"/"con"; no red/"sai"/FOMO; 1-2 câu; tiếng Việt chính; khen effort không khen rank. Any Minny copy you add must follow this.
- **R2L positioning:** lesson/hero copy stays **functional** (bài tập, từ vựng, tự học). No USP/personalization hype/anti-competitor copy.
- **Lesson completion logic** in `src/pages/read2lead/lesson.astro` (the repair of activity-complete → CTA enable → submit). Don't refactor it casually.
- **The mic flow** (`public/scripts/r2l-mic-check.js`, the warmup countdown, `_r2lStartRecording`). It was hard-won. Change only to a spec.
- **Backend contract:** the pack JSON shape the hub reads. Don't rename fields the lesson renderer depends on.

If a task seems to require touching these, flag it — Claude will spec it.

---

## 3. Scope discipline

- One logical change per branch and per commit. No drive-by refactors.
- Touch only the files the spec names. If you discover you need another file, note it in the report — don't silently expand.
- No new npm dependency unless the spec says so. If you add one, state why in the commit body.
- Never delete a file you did not create in this task.
- No mass find-replace across the repo.

---

## 3b. Branch & deploy discipline (Cloudflare auto-deploys — students are LIVE)

**Pushing to `main` deploys to production instantly. Real kids are using the site right now.**

- **Never push V3 features to `main`.** Work on `v3/<phase>` (e.g. `v3/b-rank`). PR into the **`v3`** integration branch, not `main`. Phương promotes `v3 → main`.
- Pushing your branch creates a Cloudflare **preview URL** — QA there, never on prod.
- **Feature-flag all new V3 UI** behind `import.meta.env.PUBLIC_R2L_V3` (production `=0` until launch). New code merges dark, invisible to kids.
- **Live data is sacred:** `progress:<code>` KV records are real students' coins/rank/streak. All schema changes are **additive + defaulted**; new code must read OLD records without crashing. Never rename/remove a field. No destructive migration.
- One file = one agent at a time (see `docs/V3_ROADMAP.md` §3 zone matrix). `lesson.astro` has a single owner per task.
- **Hotfix exception:** a real bug fix that helps current users (crash, mic, data loss) may go to `main` after tests pass — that's not a "feature."
- Full plan: `docs/V3_ROADMAP.md`.

---

## 4. Commit & test discipline

- **Run tests before every commit.** Hub: `node --test`. Must be all green.
- For `.astro` page logic changes, also run `npx astro check` and confirm **no new** errors (pre-existing Header.astro / admin/codes.astro errors are known, ignore those).
- Granular commits, present tense, one logical change each. Example: `Add n/6 dots mission chrome`.
- End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Never** `--no-verify`, never skip hooks, never force-push `main`.
- If you branched, open a PR; do not merge to `main` without Phương.

---

## 5. Report back (so Claude can audit fast)

After finishing, output:
1. Commit hash(es) + one-line each.
2. Files changed.
3. Test result (`node --test` summary line: tests/pass/fail).
4. Anything you deviated from the spec on, and why.
5. Open questions for Claude/Phương.

Claude reviews by `git show <hash>` + 5-lens audit. Clear commits = fast review.

---

## 6. Customer reality (every build decision bends to this)

Users are **young VN kids (6-12)** + **non-tech parents with zero patience**. If a change makes the app slower, more confusing, or breakable on weak 3G / cheap Android / iPad Safari, it is wrong — even if it's "correct" code. Big tap targets, instant feedback, no dead ends, no English error strings shown to kids.
