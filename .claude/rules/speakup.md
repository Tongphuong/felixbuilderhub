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
2. Run `founder_check.py --repo felixbuilderhub --product speakup --gate build`
   before committing.
3. Never set "Founder approved: yes" in `PRODUCT.md` yourself — that gate is
   Phuong's alone.

## Reuse before building

Before writing a new capability from scratch for SpeakUp (conversation
guardrails/moderation, TTS client, audio session handling, an admin
homework-entry form, etc.), search for an existing open-source library,
maintained package, or forkable project that already solves it. Only
hand-roll it if nothing suitable exists, and note that search — what you
looked at and why it didn't fit — briefly in the spec or `EVIDENCE.md` entry
for that phase. This applies to both Claude and Aider workers.

## Scope reminder

V0 pilot is capped at 20 students, two modes: homework practice (feedback
against what Phuong actually taught) and time-restricted free talking (needs
a concrete guardrail mechanism, not just a system-prompt instruction). See
`.founder-os/products/speakup/PRODUCT.md` for the full current scope — it
supersedes anything from before 2026-07-04.
