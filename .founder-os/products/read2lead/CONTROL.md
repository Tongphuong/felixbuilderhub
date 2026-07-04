# Control — Read2Lead

- Product: Read2Lead
- Current goal: Give kids a nearby, beatable rival on the ranking board instead of only Gold-tier bots that are out of reach for most of them
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
- Task ID: R2L-BOT-STATS-MANUAL
- Owner: Claude (spec + execute + review)
- Lane: admin tooling only (internal `/admin/codes` page; no kid/parent-facing
  surface, so the design-first mock rule doesn't apply)
- Problem: Phuong reported "no motivation for kids in the ranking." The
  Pilot/Ong bot-competitor system already exists (shipped commit 2ea625b) and
  is live in production, but both bots sit at Gold tier (39 and 19 completed
  packs) while 7 of 13 real kids have 0 completed packs — the bots are
  unreachable long-term targets, not a near-term rival for most kids. Phuong
  wants bots at "ALL ranks" but wants to set the exact rank/packs/coins
  herself rather than have Claude hardcode more preset numbers.
- Acceptance criteria: a new inline "Set bot stats" control appears in
  `src/pages/admin/codes.astro` for any code row where `is_test` or `is_bot`
  is true (rank_label_vi text input, completed_packs number input, coins
  number input, "Áp dụng" button with a confirm() guard, matching the
  existing `set-level` row-control pattern); it POSTs to the already-existing
  `/api/admin/codes/:code/set-bot-stats` endpoint (no backend changes) and
  refreshes the list on success; `tests/admin-set-bot-stats.test.mjs` covers
  the endpoint's reject/accept paths; `node --test tests/*.test.mjs` passes;
  no changes to `LEADERBOARD_BOT_PRESETS`, `apply-bot-presets.js`, or the
  existing "Sync bot (Pilot + Ong)" button; no unrelated refactor.
- Files owned: src/pages/admin/codes.astro,
  tests/admin-set-bot-stats.test.mjs (new)
- Stop condition: tests green (727/727), founder_check.py --gate build PASS,
  Phuong approved merge to main (2026-07-04) — done. She now creates/tunes
  bot accounts herself via the new control.

## Previous task

- Status: complete
- Task ID: R2L-PACK-BLOCK-CTA
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (UI/copy, touches the protected "block generation until
  previous pack is done" invariant — same class of code as R2L-CLEAR-LESSONS-REFUND)
- Problem: when a kid tried to generate a new pack while an old one was
  unfinished, the block message read negatively (red error box) and the
  only way back to the old pack was a raw text URL to `/ho-so?code=...`,
  which required login + scrolling to the bottom of the profile page to
  find the real resume button.
- Acceptance criteria: `functions/api/generate-read2lead-pack.js` returns a
  positive-voice message (final wording per Phuong: "Bài của con sắp xong
  rồi! Con cần hoàn thành bài cũ trước khi mở bài mới nhé!") plus a new
  `lesson_link` field (`/read2lead/lesson?code=...&pack_id=...`) for the
  `previous_pack_needs_review` case only; both live UI flows (`/read2lead`
  via `read2lead.astro`, `/read2lead/build` via `build.astro` +
  `r2l-builder.client.ts`) swap the red error framing for a friendly/accent
  card with a working "Đọc tiếp bài cũ 📖" button wired to `lesson_link` for
  that case only; genuine errors keep today's red framing unchanged;
  `node --test tests/*.test.mjs` passes; no unrelated refactor. All met.
- Files owned: functions/api/generate-read2lead-pack.js,
  src/pages/read2lead/build.astro, src/scripts/r2l-builder.client.ts,
  src/pages/read2lead.astro, tests/read2lead-generate-gate.test.mjs
- Stop condition: tests green, Claude review clean (caught and fixed 3 bugs
  in the aider-senior diff: a DOM overwrite that would have erased the
  message text, a leaked cosmetic-stage timer, missing anchor-element
  typing), founder_check.py --gate build PASS, Phuong approved merge to
  main (2026-07-04) — done.

## Earlier task history

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

- Status: complete
- Task ID: R2L-PROGRESS-SAVE
- Owner: Claude
- Lane: product
- Acceptance criteria: visibilitychange and freeze listeners save lesson state on app background; node --test passes; no state shape changes
- Files owned: src/pages/read2lead/lesson.astro
- Stop condition: Three event listeners wired, tests pass, Phuong approves merge to main
