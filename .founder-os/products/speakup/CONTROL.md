# Control — SpeakUp

- Product: SpeakUp
- Current goal: Get an architecture roadmap from Fable 5 for the V0 pilot (homework practice + free talking), then dispatch phases to Aider
- Latest staging URL: none
- Active workers: 0
- Last updated: 2026-07-04

## Operating team

| Agent | Role | Current authority |
|---|---|---|
| Fable 5 | Roadmap architect (this product only) | Produces the phased build roadmap. No repo access, no code, no dispatch authority — output is reviewed and turned into tasks by Claude. |
| Claude | Lead + Reviewer | Plans, turns Fable 5's roadmap into dispatch packets, reviews every diff, integrates after Phuong's approval |
| Aider Senior (DeepSeek V4 Pro) | Senior worker | Features, multi-file changes, complex logic via `aider-senior` |
| Aider Junior (DeepSeek V4 Flash) | Junior worker | Renames, simple edits, tests via `aider-junior` |
| Lonewolf | Read-only bridge | Explains progress, decisions, learning, budget, and blockers |

Decision path: `Phuong -> Fable 5 (roadmap) -> Claude (dispatch + review) -> Aider (execute) -> Claude review -> Phuong approval`.
Aider workers never own the same file simultaneously. Lonewolf never edits,
assigns, commits, merges, deploys, or spends.

## Hard rules for this product (added 2026-07-04, per Phuong)

1. **Founder OS is mandatory from the first task, no exceptions.** Before any
   code change: check this file for an active task, run
   `founder_check.py --repo felixbuilderhub --product speakup --gate build`
   before committing. See `.claude/rules/speakup.md`.
2. **Reuse before building.** Before writing any new capability from scratch
   (conversation guardrails, TTS client, audio session handling, admin
   homework-entry form, etc.), search for an existing open-source library,
   package, or forkable project. Only hand-roll it if nothing suitable
   exists, and note that search briefly in the spec for that phase.

## Current task

- Status: none
- Task ID: none
- Owner: none
- Lane: none
- Acceptance criteria: none
- Files owned: none
- Stop condition: none
- Started: none
- Cost spent: USD 0

## File ownership

| Path or area | Owner | State |
|---|---|---|
| none | none | none |

## Daily update

- Visible result: SpeakUp V0 scope reconciled (20 students, two modes) and hard rules (Founder OS mandatory, reuse-before-build) recorded
- Completed: PRODUCT.md/IDEAS.md/EVIDENCE.md updated to current scope; scoped rule file added; architecture prompt prepared for Fable 5
- Cost today: USD 0
- Problem: none
- Next: Phuong sends the prepared prompt to Fable 5; Claude turns the returned roadmap into dispatch packets
- Need Phuong: confirm "Founder approved" in PRODUCT.md when ready to move past prototype
