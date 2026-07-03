# Control — Read2Lead

- Product: Read2Lead
- Current goal: Fix lesson progress loss on mobile app interruption
- Latest staging URL: none
- Active workers: 0
- Last updated: 2026-07-03

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
- Task ID: R2L-PROGRESS-SAVE
- Owner: Claude
- Lane: product
- Acceptance criteria: visibilitychange and freeze listeners save lesson state on app background; node --test passes; no state shape changes
- Files owned: src/pages/read2lead/lesson.astro
- Stop condition: Three event listeners wired, tests pass, Phuong approves merge to main
