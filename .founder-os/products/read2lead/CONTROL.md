# Control — Read2Lead

- Product: Read2Lead
- Current goal: Make the "finish your old pack first" block feel encouraging and give kids a one-tap button straight into the unfinished pack
- Latest staging URL: none
- Active workers: 1 (aider-senior)
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

- Status: active
- Task ID: R2L-PACK-BLOCK-CTA
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (UI/copy, touches the protected "block generation until
  previous pack is done" invariant — same class of code as R2L-CLEAR-LESSONS-REFUND)
- Problem: when a kid tries to generate a new pack while an old one is
  unfinished, the block message reads negatively (red error box) and the
  only way back to the old pack is a raw text URL to `/ho-so?code=...`,
  which requires login + scrolling to the bottom of the profile page to
  find the real resume button.
- Acceptance criteria: `functions/api/generate-read2lead-pack.js` returns a
  positive-voice message (keeps the substring `"Con cần hoàn thành bài đang
  mở trên web"` so `tests/read2lead-generate-gate.test.mjs` stays green) plus
  a new `lesson_link` field (`/read2lead/lesson?code=...&pack_id=...`) for
  the `previous_pack_needs_review` case only; both live UI flows
  (`/read2lead` via `read2lead.astro`, `/read2lead/build` via
  `build.astro` + `r2l-builder.client.ts`) swap the red error framing for a
  friendly/accent card with a working "Đọc tiếp bài cũ 📖" button wired to
  `lesson_link` for that case only; genuine errors keep today's red framing
  unchanged; `node --test tests/*.test.mjs` passes; no unrelated refactor.
- Files owned: functions/api/generate-read2lead-pack.js,
  src/pages/read2lead/build.astro, src/scripts/r2l-builder.client.ts,
  src/pages/read2lead.astro
- Stop condition: tests green, Claude 5-lens review clean, founder_check.py
  --gate build passes, manual walkthrough of both entry points confirms the
  button deep-links straight into the unfinished pack, Phuong approves
  merge to main.

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
