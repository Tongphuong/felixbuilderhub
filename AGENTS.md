# AGENTS.md — felixbuilderhub (hub) repo rules

> **Canonical multi-agent rules live in `_ops/LEAD.md` and `_ops/AGENTS.md`**
> (at `/home/felixbuilderhub/work/repos/_ops/`). Read them first every session.
> This file only contains hub-specific zones and invariants.
> **Note for agents:** All `_ops/` paths are relative to `/home/felixbuilderhub/work/repos/`. cd there first.

---

## 0. Read order before any task

1. `_ops/LEAD.md` — Claude Lead entry point
2. `_ops/AGENT_LOG.md` — last 10 lines for session context
3. `_ops/AGENTS.md` — canonical roles and behavior rules
4. `_ops/PRODUCT_CONTEXT.md` and `_ops/DESIGN_SYSTEM.md`
5. `CLAUDE.md` — hub architecture, folder map, key files
6. This file — hub-specific zones and invariants
7. The assigned spec and SpeakUp `CONTROL.md`, `CHECKPOINT.md`, and `BUDGET.md`

---

## 1. Hub-specific protected invariants

1. **Minny voice (M0):** Minny says "Minny"/"con"; no red/"wrong"/FOMO language; 1-2 sentences; Vietnamese primary for encouragement; praise effort not rank. Any Minny copy must follow this.
2. **R2L positioning:** lesson/hero copy stays **functional** (exercises, vocabulary, self-study). No USP/personalization hype/anti-competitor copy.
3. **Lesson completion logic** in `src/pages/read2lead/lesson.astro` (activity-complete → CTA enable → submit). Do not refactor casually.
4. **The mic flow** (`public/scripts/r2l-mic-check.js`, `public/scripts/r2l-recorder.js`, the warmup countdown, `_r2lStartRecording`). Hard-won. Change only to a spec.
5. **Backend contract:** the pack JSON shape the hub reads from backend. Do not rename fields the lesson renderer depends on.

Touching any of these requires a Claude-reviewed written spec and Phuong's
explicit approval. Aider workers may not expand into these files.

---

## 2. Zone matrix

| Zone | Owner | Notes |
|---|---|---|
| `src/pages/read2lead/lesson.astro` | Approved spec owner only | Protected completion logic |
| `public/scripts/r2l-*.js` | Approved spec owner only | Protected mic/recorder flow |
| `src/pages/` (other pages) | Claude-assigned Aider worker | Standard frontend work |
| `src/components/` | Claude-assigned Aider worker | UI components |
| `src/styles/` | Claude-assigned Aider worker | CSS |
| `functions/` | Claude-assigned Aider worker | CF Worker API endpoints |
| `public/assets/` | Claude-assigned Aider worker | Static assets |

The active spec or product `CONTROL.md` must name one owner and exact files. A
zone being eligible for both workers never permits simultaneous ownership.

---

## 3. Test requirements

```bash
npx astro check
node --test
```

Both must pass before push. No `--no-verify`, no skipping.
