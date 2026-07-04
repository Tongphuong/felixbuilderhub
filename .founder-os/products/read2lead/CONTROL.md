# Control — Read2Lead

- Product: Read2Lead
- Current goal: Fix in-progress lesson resetting to zero after browser/tab close
- Latest staging URL: none
- Active workers: 0
- Last updated: 2026-07-04

## Operating team

| Agent | Role | Current authority |
|---|---|---|
| Claude | Lead | Plans, dispatches, reviews, and integrates |
| Codex | Worker | Executes only a Claude-assigned packet |
| Cline (GLM 5.2 or Kimi) | Worker | Executes only a Claude-assigned packet in VS Code |
| Lonewolf | Read-only bridge | Explains progress, decisions, learning, budget, and blockers |

Decision path: `Phuong -> Claude -> one worker -> Claude review -> Phuong approval`.

## Current task

- Status: complete
- Task ID: R2L-LESSON-CHECKPOINT
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (bug fix, protected "lesson completion logic" invariant)
- Root cause: in-progress lesson state is 100% client-side (localStorage/
  sessionStorage) with no server fallback, so a kid loses all progress if
  browser storage is wiped between visits (private/incognito mode, in-app
  WebView like Zalo's browser, OS storage eviction, device switch) even
  though the existing background/pagehide save logic is correct.
- Acceptance criteria: new lightweight `current_pack.web_session_checkpoint`
  KV field written only via `functions/api/read2lead-checkpoint-save.js` on
  existing pagehide/visibilitychange/freeze flush points (no new listeners,
  no per-keystroke writes); read back for free via
  `functions/api/read2lead-lesson.js`; client falls back to it when local
  storage is empty; checkpoint stripped on pack submit (all 3 write sites
  in submit-read2lead-lesson.js); fully isolated from uses_remaining/rank/
  XP/lượt logic; node --test passes; no unrelated refactor.
- Files owned: functions/api/read2lead-checkpoint-save.js (new),
  functions/api/read2lead-lesson.js, src/pages/read2lead/lesson.astro,
  functions/api/submit-read2lead-lesson.js,
  tests/read2lead-checkpoint-save.test.mjs (new), plus targeted test
  additions to existing submit/lesson-flow test files
- Stop condition: tests green, Claude review clean, founder_check.py
  --gate build passes, Phuong approves merge to main
- See plan: /home/felixbuilderhub/.claude/plans/composed-exploring-galaxy.md

## Previous task

- Status: complete
- Task ID: R2L-CLEAR-LESSONS-REFUND
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (bug fix, protected "lesson completion logic" invariant)
- Root cause: `DEFAULT_CLEAR_STATUSES` in `functions/api/_read2lead-clear-open-lessons.js`
  included `awaiting_review`, so the admin cleanup endpoint wiped freshly
  generated (lượt-already-spent) packs by default, not just stuck locks.
- Acceptance criteria: default clear only touches `generation_in_progress`;
  explicit clear of `awaiting_review` refunds `uses_remaining` (capped at
  `uses_total`); admin response reports refund count; node --test passes
  (existing buggy-behavior test corrected, new cases added); no unrelated
  refactor. All met.
- Files owned: functions/api/_read2lead-clear-open-lessons.js,
  functions/api/admin/codes/clear-open-lessons.js,
  tests/read2lead-clear-open-lessons.test.mjs
- Stop condition: tests green (709/709), Claude review clean,
  founder_check.py --gate build PASS, Phuong approved merge to main (2026-07-04) — done.
- Remediation of already-affected students (3 known codes + wider check):
  Phuong is handling manually herself, not part of this packet.

## Earlier task history

- Status: complete
- Task ID: R2L-PROGRESS-SAVE
- Owner: Claude
- Lane: product
- Acceptance criteria: visibilitychange and freeze listeners save lesson state on app background; node --test passes; no state shape changes
- Files owned: src/pages/read2lead/lesson.astro
- Stop condition: Three event listeners wired, tests pass, Phuong approves merge to main
