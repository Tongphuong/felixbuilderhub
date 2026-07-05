---
description: "Hard rules for the SpeakUp product — Founder OS mandatory, reuse-before-build"
globs:
  - ".founder-os/products/speakup/**"
  - "src/pages/speak-up.astro"
  - "src/pages/read2lead/speaking.astro"
  - "functions/api/minny-*"
  - "functions/api/read2lead-speaking-check.js"
---

## Founder OS is mandatory for SpeakUp, from the first task

No exceptions, including "simple" fixes. Before any code change on this
product:

1. Read `.founder-os/products/speakup/CONTROL.md` for the current task.
2. Run `founder_check.py --repo . --product speakup --gate build` (run from
   inside this repo's root — a bare repo name like `felixbuilderhub` here
   resolves relative to your current directory and will double the path if
   you're already inside it) before committing.
3. Never set "Founder approved: yes" in `PRODUCT.md` yourself — that gate is
   Phuong's alone.

## Reuse before building

Before writing a new capability from scratch for SpeakUp (conversation
guardrails/moderation, TTS client, audio session handling, an admin
homework-entry form, etc.), check in this order: (1) an open-source GitHub
project to clone/fork, (2) a free library or maintained package, (3) an
existing plugin, connector, or MCP server that already solves it (e.g.
Claude Design, Figma MCP, other integrations), (4) extend an already-proven
system already running. Only hand-roll it if none of these fit, and note
that search — what was checked and why it didn't fit — briefly in the spec
or `EVIDENCE.md` entry for that phase. This applies to both Claude and
Aider workers. (Expanded 2026-07-05 after Phase 7a built a custom design
workflow before checking whether Claude Design already covered it.)

## Acceptance-criteria reconciliation and cost ceilings (added 2026-07-05)

Per `_ops/AGENTS.md` rules 14-15, applying from here forward (not retroactive
to Phases 1-3):

- Before marking any SpeakUp phase "done" in CONTROL.md, re-open that phase's
  section in `_ops/specs/SPEC_SPEAKUP_V0.md` and check its acceptance-criteria
  bullets one by one. Record PASS / SKIPPED (one-line reason) / N/A for each
  — `node --test` passing is not the same claim as "the spec's criteria are
  met." A skipped test or file must be a visible line, not a silent gap.
  Write this into CONTROL.md's `## Acceptance criteria reconciliation`
  section, then run `founder_check.py --repo . --product speakup --gate
  complete` (from inside this repo's root) before setting `Status:
  complete`.
- Every CONTROL.md "Current task" entry for this product must state a cost
  ceiling at dispatch time (the `Cost ceiling` field), separate from the
  actual-spend figure recorded at completion — `founder_check.py --gate
  build` now enforces this field is non-empty.

## Visual verification against Claude Design mocks (added 2026-07-06)

Per `_ops/AGENTS.md` rule 18. Any speaking.astro screen whose acceptance
criteria reference a Phase 7a/7b (or later) Claude Design mock is not done
until you have actually rendered it — a local `wrangler pages dev` + seeded
KV code, or the Cloudflare preview — and taken a screenshot to compare
side-by-side against the mock's `.dc.html`. Record the file path and verdict
in CONTROL.md's acceptance-criteria reconciliation. Passing `node --test`
and a clean code review do not establish this — added after Phases 2 and 8a
both shipped and were marked done with a real gap between the approved
design and the live page (mic-check panel left visible during Free Talking;
the entire Phase 7a visual redesign never implemented for the homework frame
screen), undetected because no session had rendered the page until Phương
found it by eye.

## Scope reminder

V0 pilot is capped at 20 students, two modes: homework practice (feedback
against what Phuong actually taught) and time-restricted free talking (needs
a concrete guardrail mechanism, not just a system-prompt instruction). See
`.founder-os/products/speakup/PRODUCT.md` for the full current scope — it
supersedes anything from before 2026-07-04.
