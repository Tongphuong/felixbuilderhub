# Checkpoint — Read2Lead

- Last updated: 2026-07-04
- Branch: merged to main (branch deleted)
- Commit: 0393669

## Status

- Code change complete: yes
- Tests pass: yes (709/709, full `tests/` suite)
- Pushed: yes
- Merged: yes (fast-forwarded main to 0393669)
- Phuong approval: yes (2026-07-04) — approved merge/deploy; declined the
  offered remediation help ("no need, I'll do it manually" / "no need for
  the check")

## What changed

Root cause: the admin "clear stuck lessons" cleanup endpoint
(`functions/api/_read2lead-clear-open-lessons.js`) defaulted to also
clearing `awaiting_review` packs — packs that already cost the student a
lượt and were just waiting to be opened, not actually stuck. Any call to
that endpoint without an explicit `statuses` filter silently destroyed
already-generated, already-paid-for packs with no refund.

Fix (implemented by aider-senior, reviewed by Claude):

- `DEFAULT_CLEAR_STATUSES` narrowed to `['generation_in_progress']` only —
  the real stuck-lock state, where no lượt has been spent yet.
- New `ALLOWED_CLEAR_STATUSES` (unchanged set) still lets an admin
  explicitly opt into clearing an `awaiting_review` pack on purpose.
- New `REFUND_ON_CLEAR_STATUSES` (`['awaiting_review']`) — clearing one of
  these now refunds `uses_remaining` by 1, capped at `uses_total`, reported
  in both dry-run and real calls via `refunded_use` per entry and
  `refunded_use_count` in the response.
- `functions/api/admin/codes/clear-open-lessons.js` response message now
  reports the refund count.
- `tests/read2lead-clear-open-lessons.test.mjs`: corrected the one test that
  asserted the old buggy default behavior, added 5 new cases (default skips
  awaiting_review, explicit clear + refund, refund capped at uses_total,
  dry-run reports without writing, generation_in_progress never refunds).

Verification: `node --test tests/*.test.mjs` → 709/709 pass.
`founder_check.py --repo felixbuilderhub --product read2lead --gate build` →
PASS.

## Next action

- None — task closed. Merged and pushed to `main` (Cloudflare Pages
  auto-deploys). Phuong is handling remediation for the 3 known affected
  codes and any wider check herself; no further Claude action needed on
  this task.
