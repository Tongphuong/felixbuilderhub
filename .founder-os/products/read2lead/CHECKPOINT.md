# Checkpoint — Read2Lead

- Last updated: 2026-07-04
- Branch: fix/clear-open-lessons-refund
- Commit: pending

## Status

- Code change complete: in progress (dispatched to aider-senior)
- Tests pass: pending
- Pushed: no
- Merged: no
- Phuong approval: plan approved 2026-07-04; merge approval pending

## What changed

Root cause found: the admin "clear stuck lessons" cleanup endpoint
(`functions/api/_read2lead-clear-open-lessons.js`) defaults to also clearing
`awaiting_review` packs — packs that already cost the student a lượt and
were just waiting to be opened, not actually stuck. This silently destroyed
already-generated packs for multiple students. Fix: narrow the default to
only `generation_in_progress` (the real stuck-lock state), keep
`awaiting_review` clearable only via explicit opt-in, and refund the lượt
when that explicit path is used. See plan:
/home/felixbuilderhub/.claude/plans/composed-exploring-galaxy.md

## Next action

- aider-senior implements the 3-file fix
- Claude reviews diff, runs node --test, runs founder_check.py --gate build
- Report to Phuong; on approval, restore 3 known affected codes
  (R2L-MINA-RV5Y, R2L-DANGNEMO-2UNF, R2L-HIEUENZO-3BVV) and request admin
  access for a 72-hour scan of other affected students
