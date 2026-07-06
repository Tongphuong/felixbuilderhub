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

## Reuse before building — reuse what OTHER people built, not our own scaffold

Before writing a new capability from scratch for SpeakUp (conversation
guardrails/moderation, TTS client, audio session handling, an admin
homework-entry form, etc.), look for an existing **external, free/open-source**
solution in this order: (1) an open-source GitHub project to clone/fork,
(2) a free library or maintained package, (3) an existing plugin, connector,
or MCP server (e.g. Claude Design, Figma MCP). Only hand-roll it if none fit,
and record that search in CONTROL.md's **`- Reuse survey:`** field — since
2026-07-06 `founder_check.py --gate build` hard-blocks unless it lists ≥2
external candidates with verdicts (or `N/A — <reason>` for tasks that build
nothing new). See `_ops/AGENTS.md` rule 21. Applies to both Claude and Aider
workers. **This is about reusing what other people built — never a reason to
reuse our own existing page/layout/scaffold.** For UI: the approved design
defines the whole screen (full-screen vs. embedded, column count, chrome); "we
already have a page that's close" does not override it — build the screen the
design shows. (Expanded 2026-07-05 after Phase 7a; **corrected 2026-07-06 on
Phương's instruction** after an "extend our own live code" clause led to the
SpeakUp screens being built inside the marketing page instead of as the
full-screen, multi-column app the mocks show. See `_ops/AGENTS.md` rule 13.)

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
side-by-side against the mock's `.dc.html`. **Compare the whole screen, not
just the new widgets:** a stray site nav/title, the wrong container width, or a
single column where the design is multi-column all fail the check even when the
individual stems/buttons/cards look right — that is how these screens shipped
wedged inside the marketing page. Record the file path and verdict
in CONTROL.md's acceptance-criteria reconciliation. Passing `node --test`
and a clean code review do not establish this — added after Phases 2 and 8a
both shipped and were marked done with a real gap between the approved
design and the live page (mic-check panel left visible during Free Talking;
the entire Phase 7a visual redesign never implemented for the homework frame
screen), undetected because no session had rendered the page until Phương
found it by eye.

**Now enforced (2026-07-06):** record the render-vs-design check in
CONTROL.md's `- Design self-verification:` field, and how you handed the result
to Phương in the `- Founder handoff:` field — `founder_check.py --gate complete`
blocks on both being non-empty (a bare `none`/`n/a` fails). You verify against
the design yourself and present him a finished result; you never ask him to QA
the preview and find the bugs. See `_ops/AGENTS.md` rules 18–19.

**Verify on the DEPLOYED preview, and push before handoff (rule 20, added
2026-07-06).** Phương reviews `claude-speakup-v0.felixbuilderhub.pages.dev`,
which Cloudflare builds from `origin/claude/speakup-v0` — **not** your local
`wrangler pages dev` or a headless screenshot of your working tree. So: do your
self-verification against the deployed URL (push first, wait for the rebuild,
then screenshot), and record the SHA you verified in CONTROL.md's
`- Verified commit:` field. `founder_check.py --gate complete` now hard-blocks
if that SHA is not on `origin/claude/speakup-v0`, or if the review surface is
localhost. This exists because on 2026-07-06 the Free Talking rebuild
(`e68f168`) was verified locally but never pushed; the preview kept serving
`c90c8bf` and Phương reviewed the pre-fix screen.

## Scope reminder

V0 pilot is capped at 20 students, two modes: homework practice (feedback
against what Phuong actually taught) and time-restricted free talking (needs
a concrete guardrail mechanism, not just a system-prompt instruction). See
`.founder-os/products/speakup/PRODUCT.md` for the full current scope — it
supersedes anything from before 2026-07-04.
