# Checkpoint — Read2Lead

- Updated: 2026-09-17T13:24:22+00:00
- Branch: main
- Commit: 5963370
- Worktree: M .founder-os/products/read2lead/BUDGET.md;  M .founder-os/products/read2lead/CHECKPOINT.md;  M .founder-os/products/read2lead/CONTROL.md;  M .founder-os/products/read2lead/EVIDENCE.md;  M .founder-os/products/read2lead/PRODUCT.md;  M AGENTS.md;  M AGENT_LOG.md;  M CLAUDE.md;  M docs/ENV.md; ?? .claude/worktrees/; ?? .playwright-mcp/; ?? design_handoff_logo/; ?? design_handoff_r2l_student_home/; ?? ft-wrapup.png
- Done: P0-CONTROLS setup/reconciliation complete; designated continuation codex/r2l-self-learn at 5963370. Controls report _ops/specs/read2lead-self-learn/P0_CONTROLS.md; no application behavior or CI/hook edits.
- Tests: 61 governance regressions, 112 full bite checks, actual hook docs-allow/source-deny and collision controls PASS; build/complete gates PASS. Application baseline unchanged/red, not rerun.
- Blocker: P0 remains open: tracker/L0/static/CI repairs; deployed separation, current budget and server protection unverified. USD0; no release authority.
- Next: R2L-P0-CONTROLS-TRACKER: deterministic-clock test-only repair in hub-codex-r2l-self-learn; no new worktree, push or deploy.

## Previous checkpoints — preserved verbatim

# Checkpoint — Read2Lead

- Updated: 2026-09-17T13:08:50+00:00
- Branch: main
- Commit: 5963370
- Worktree: M .founder-os/products/read2lead/CHECKPOINT.md;  M .founder-os/products/read2lead/CONTROL.md;  M AGENTS.md;  M AGENT_LOG.md;  M CLAUDE.md;  M docs/ENV.md; ?? .claude/worktrees/; ?? .playwright-mcp/; ?? design_handoff_logo/; ?? design_handoff_r2l_student_home/; ?? ft-wrapup.png
- Done: R2L-P0-VERIFY complete as offline measurement only; report _ops/specs/read2lead-self-learn/P0_VERIFY.md. No application changes, installs, live data, spend or deployment; original work preserved.
- Tests: Runner 12 PASS; discovery/build/types PASS; hub 2149 pass/1 fail; standalone backend 206 PASS; hub/backend 205 pass/1 fail; Astro 1278 errors/107 hints; source/dirty/synthetic restore and corruption controls PASS; complete gate PASS.
- Blocker: Baseline not green; stale checkpoint and gift races reproduced. Deployed resource separation and actual-runtime transactional proof unverified. Evidence /home/felixbuilderhub/r2l-p0-verify-20260917-skTXaI/
- Next: R2L-P0-CONTROLS: reconcile ownership and select isolated integration base; scope exact baseline/CI remediation. P0 remains open; no redesign or deploy.

## Previous checkpoints — preserved verbatim

# Current checkpoint — 2026-09-17

Codex completed R2L-P0-BASELINE (read-only audit); no active app implementation. Resume from
`_ops/outbox/READ2LEAD_START_HERE.md`, STATUS and DECISIONS.
Governance local install verified: branch codex/r2l-solo-governance, bb72860.
Hub main remains 5963370; original dirty CONTROL/log/ENV preserved.
No application source changes, production requests, deployment or spending.
P0_BASELINE has seven evidenced sections; 2,216 preservation comparisons PASS.
Next: separately bounded R2L-P0-VERIFY; network denial/app suites/storage restore unrun.
Exact dirty inventory, tests, artifacts and risks are in STATUS.

## Historical checkpoint — preserved

# Checkpoint — Read2Lead

- Last updated: 2026-07-09
- Branch: merged to main (feature branch `claude/r2l-next-page-scroll`)
- Commit: 69ac4da

## Status

- Code change complete: yes
- Tests pass: yes (739/739, full `node --test tests/*.test.mjs`)
- Astro build: clean (26 pages)
- Founder gates: build PASS, complete PASS
- Pushed: yes (feature branch + main)
- Merged: yes (fast-forward main 375370d → 69ac4da)
- Deployed: yes — live on felixbuilderhub.com (Cloudflare Pages auto-deploy)
- Felix approval: yes ("push to prod and check there", 2026-07-09)

## What changed

Book-reader page-turn UX bug: when a kid finished a page (listen, answer the
2 questions, record) and tapped "Trang tiếp →", they tapped it from the
bottom of the previous page. The next page's content swapped in place with no
scroll reset, so the new page opened scrolled to the bottom and the kid had
to scroll up to see the story image/title and start.

Fix (one line + comment in `src/pages/read2lead/lesson.astro`): at the end of
`bookShowPage()` — the single choke point every page change funnels through
(forward "Trang tiếp →", back, progress-trail jump, story-page next) — call
`qs('#w1-book-reader-phase')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`.
It does NOT fire on within-page steps (listen → questions → record), which go
through `bookSetStage()`, so the reading flow inside a page is undisturbed.
Reuses the exact smooth-scroll pattern already in this file (lesson.astro:4193,
:4995) — zero new dependency.

## Verification

- Live on prod (felixbuilderhub.com, 69ac4da): exact scroll-reset line served
  in the lesson page (`scrollIntoView` count 5→6, marker confirmed via curl +
  Playwright DOM read), zero console errors/warnings on load, and the exact
  `scrollIntoView({block:'start'})` call moves the viewport to the reader top
  when exercised against the live `#w1-book-reader-phase` element.
- NOT driven end-to-end: a full real book-reader page-turn (reaching the
  "Trang tiếp →" button needs a seeded book pack + a mic to complete a page,
  neither reproducible in the sandbox).

## Next action

- None required — shipped and verified to the extent the sandbox allows.
- Suggested (not a blocker): Felix taps through one real lesson on a device
  to confirm the feel of the mic-gated page-turn.
