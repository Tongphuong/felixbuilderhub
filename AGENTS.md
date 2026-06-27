# AGENTS.md — felixbuilderhub (hub) repo rules

> **Canonical multi-agent rules live in `_ops/AGENTS.md`** (at /home/felixbuilderhub/work/repos/_ops/).
> Read that FIRST every session. This file only contains hub-specific zones + invariants.
> **Note for agents:** All `_ops/` paths are relative to `/home/felixbuilderhub/work/repos/`. cd there first.

---

## 0. Read order before any task

1. `_ops/AGENTS.md` — role + behavior rules (canonical)
2. `_ops/PERMISSIONS.md` — what you can / cannot do
3. `CLAUDE.md` — hub architecture, folder map, key files
4. This file — hub-specific zones + invariants
5. Your spec (`_ops/specs/SPEC_*.md`)

---

## 1. Hub-specific protected invariants — DO NOT touch without a Claude spec

1. **Minny voice (M0):** Minny says "Minny"/"con"; no red/"wrong"/FOMO language; 1-2 sentences; Vietnamese primary for encouragement; praise effort not rank. Any Minny copy must follow this.
2. **R2L positioning:** lesson/hero copy stays **functional** (exercises, vocabulary, self-study). No USP/personalization hype/anti-competitor copy.
3. **Lesson completion logic** in `src/pages/read2lead/lesson.astro` (activity-complete → CTA enable → submit). Do not refactor casually.
4. **The mic flow** (`public/scripts/r2l-mic-check.js`, `public/scripts/r2l-recorder.js`, the warmup countdown, `_r2lStartRecording`). Hard-won. Change only to a spec.
5. **Backend contract:** the pack JSON shape the hub reads from backend. Do not rename fields the lesson renderer depends on.

Touching any of these requires a Claude-written spec — no exceptions.

---

## 2. Zone matrix

| Zone | Owner | Notes |
|---|---|---|
| `src/pages/read2lead/lesson.astro` | Claude spec only | Protected completion logic |
| `public/scripts/r2l-*.js` | Claude spec only | Protected mic/recorder flow |
| `src/pages/` (other pages) | Hermes Frontend | Standard frontend work |
| `src/components/` | Hermes Frontend | UI components |
| `src/styles/` | Hermes Frontend | CSS |
| `functions/` | Hermes Frontend | CF Worker API endpoints |
| `public/assets/` | Hermes Frontend | Static assets |

---

## 3. Test requirements

```bash
npx astro check
node --test
```

Both must pass before push. No `--no-verify`, no skipping.
