# Control — Read2Lead

- Product: Read2Lead
- Current goal: Stop kids losing finished packs — auto-save the lesson the moment the last exercise is done (remove the "Lưu chiến công" click funnel)
- Latest staging URL: none yet (preview URL recorded after first push of claude/r2l-auto-save)
- Active workers: 1 (Claude Lead, direct edit — protected file)
- Last updated: 2026-07-08

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
- Started: 2026-07-08
- Completed: 2026-07-08 (awaiting Phuong review + merge approval)
- Task ID: R2L-AUTO-SAVE-COMPLETION
- Owner: Claude Lead (spec + execute + review; `lesson.astro` is PROTECTED —
  Claude edits directly per `~/.claude/hooks/aider-dispatch-protected.json`)
- Lane: product (protected "lesson completion logic" invariant — dedicated
  approved spec: `_ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md`, plan approved
  by Phuong 2026-07-08)
- Problem: ~90% of kids finish all 5 exercises but never save the pack. The
  finish path requires clicking "Hoàn thành nhiệm vụ 🎉" → confirming a modal
  ("Lưu chiến công") → waiting for a network POST. Kids close the tab after
  the last exercise; the pack stays `awaiting_review` forever.
- Approach: auto-submit the moment the last activity completes (mirror the
  existing book-lesson `bookFinishReader()` pattern), delete the confirm
  modal, keep "Gửi lại" retry on failure, and auto-retry the saved pending
  payload on next page load. Client-only; server endpoint already idempotent.
- Acceptance criteria: standard 5-activity lesson auto-submits with zero
  clicks after the last activity (celebration burst not cut off — 1700ms
  delay, 500ms on mic-skip); `#submit-confirm-modal` removed; `#lesson-continue`
  all-done branch calls `submitLesson()` directly as manual fallback;
  `updateGlobalCta()` shows saving/fallback states; pending submit auto-retries
  on load with the saved payload; resumed all-done sessions auto-submit;
  failed-pass and offline paths show toast + "Gửi lại" and re-enable manual
  save; book/W1 flows unchanged, no double-fire (`submitInFlight` +
  `_r2lAutoSubmitArmed`); `tests/lesson-ux-regression.test.mjs` modal test
  rewritten; `node --test` passes; no unrelated refactor.
- Files owned: src/pages/read2lead/lesson.astro,
  tests/lesson-ux-regression.test.mjs,
  functions/api/submit-read2lead-lesson.js (added via P0 addendum, see below),
  tests/read2lead-legacy-client-submit.test.mjs (new),
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no checkpoint-to-finalize server rescue (rejected Option B);
  no reward/scoring semantic changes.
- P0 addendum (2026-07-08, spec addendum in
  _ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md): live e2e exposed that since
  1502dd6 (2026-06-27) the submit endpoint expected a read_aloud result the
  standard-lesson client never sends — every standard-pack submit failed
  ("Chưa đạt 50%") with the score deflated by phantom read_aloud zeros and
  the XP penalty applied. This, not only the click funnel, is the dominant
  cause of "kids finish but never save". Smallest stabilizing fix under the
  AGENTS.md P0 exception: filter read_aloud out of the ensured activities
  for NON-book submit contexts (books keep their dedicated isBookFlowV2
  path). Also: raw network TypeError no longer leaks English "Failed to
  fetch" into kid-facing text.
- Stop condition: tests green, build clean, live e2e on deployed preview
  (zero-click auto-save observed via Playwright), founder_check gates PASS,
  Phuong approves merge to main.
- Cost ceiling: USD 0 metered — Claude Lead direct on Max plan (protected
  file, no Aider dispatch); actual cost: USD 0.
- Reuse survey: (1) in-repo book-lesson auto-submit pattern
  (`bookFinishReader()`, lesson.astro:6192) — adopted as the model for the
  trigger; (2) `navigator.sendBeacon` checkpoint rescue promoted to
  server-side finalization (external pattern: beacon-based analytics
  saves) — rejected: checkpoint payload lacks submit-shape data, server
  double-reward risk; (3) localStorage pending-queue libraries (e.g.
  workbox-background-sync) — rejected: existing hand-rolled
  savePendingSubmit/loadPendingSubmit already shipped and sufficient, a
  service-worker dependency is overkill for one endpoint.
- Design self-verification: no Claude Design mock exists for this task (flow
  change reusing the existing completion card/toast/CTA components). Rendered
  and driven end-to-end by the building agent at 1280px: (a) full flow on
  `wrangler pages dev dist` + seeded KV at the exact pushed commit — zero-click
  auto-save after last activity, offline failure state, reload auto-resend,
  completion card; screenshots `_ops/r2l-autosave-offline-retry-1280.png`
  (CTA fallback "Lưu chiến công 💾" + "Gửi lại") and
  `_ops/r2l-autosave-completion-1280.png` ("Nhiệm vụ xong!" card, CTA gone);
  (b) deployed preview at 94d6602 — new code markers confirmed in served
  bundle (auto-submit scheduler, new hint copy, no submit-confirm-modal),
  standard-lesson fixture rendered via route interception (zero writes to real
  KV), part 1 completed through the deployed UI with quest path updating;
  screenshot `_ops/r2l-autosave-preview-deployed-1280.png`. Verdict: match.
  Named boundary: the deployed W1 story-gate full run needs per-page audio a
  synthetic pack lacks, and all real awaiting_review packs belong to real kids
  (must not be consumed) — W1 shares the same completeActivity → auto-submit
  funnel verified above.
- Founder handoff: plain-language result + 3 screenshots above + this entry.
  Specific asks for Phuong: (1) approve merge of claude/r2l-auto-save to main
  — this both removes the save funnel AND unblocks all kids stuck failing
  standard packs since 27/6; (2) optional 2-line copy refresh on
  read2lead.astro (lines 224/246 still say "bấm lưu chiến công" — protected
  positioning copy, left untouched); (3) after merge, consider telling
  affected kids their old packs will now save when reopened (auto-resume
  submits on lesson load). No QA hunting requested — flow self-verified.
- Verified commit: 94d6602 (tip of origin/claude/r2l-auto-save; preview
  https://claude-r2l-auto-save.felixbuilderhub.pages.dev)

## Acceptance criteria reconciliation

- Zero-click auto-submit after last activity (1700ms / 500ms mic-skip):
  PASS — live e2e on wrangler+KV; hint "Minny đang tự động lưu chiến công
  của con..." then completion card with no clicks.
- `#submit-confirm-modal` removed: PASS — deleted, regression test asserts
  absence; deployed bundle grep = 0 occurrences.
- `#lesson-continue` all-done branch calls submitLesson directly (manual
  fallback): PASS — code + test regex + observed enabled fallback state.
- `updateGlobalCta()` saving/fallback states: PASS — observed "Minny đang
  lưu chiến công..." (disabled) and "Lưu chiến công 💾" (enabled after
  simulated offline failure).
- Pending submit auto-retries on load with saved payload: PASS — simulated
  offline → reload → auto-resend → completion card; pending key cleared.
- Resumed all-done session auto-submits: PASS — observed three times,
  including localStorage-wiped + server-checkpoint fallback restore.
- Failed-pass / offline show toast + "Gửi lại" + re-enabled manual save:
  PASS — both branches observed live (failed-pass observed pre-server-fix,
  offline via injected fetch failure).
- Book/W1 flows unchanged, no double-fire: PASS for book (isBookLesson
  guards + book tests green; book packs route via isBookFlowV2 — new test);
  W1 SKIPPED for full live drive (deployed W1 story gate needs per-page
  audio the synthetic pack lacks; real packs belong to real kids) — W1 uses
  the same completeActivity funnel the trigger lives in.
- `tests/lesson-ux-regression.test.mjs` modal test rewritten: PASS.
- `node --test` passes: PASS — 730/730 (3 new legacy-client submit tests).
- No unrelated refactor: PASS — P0 server fix added under the AGENTS.md P0
  exception with a dated spec addendum (documented above), not silent scope
  creep.

## Previous task

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
