# Minny character assets (Read2Lead / MSMW canon)

**Source of truth:** `D:/MSMW/marketing/seedance_minny/references/minny_ref_final.png`

## Current files

| File | Role | Status |
|---|---|---|
| `minny.png` | General reference sprite (imported 2026-06-08) | ✅ In repo |
| `minny_idle.png` | Speaking page — default pose | ✅ Placeholder (M0) |
| `minny_listen.png` | Kid is speaking / recording | ✅ Placeholder (M0) |
| `minny_celebrate.png` | Success / streak | ✅ Placeholder (M0) |
| `minny_encourage.png` | Retry / gentle nudge | ✅ Placeholder (M0) |

M0 placeholders are copies of `minny.png`. Felix may export distinct poses later.

## Usage (planned)

- `/read2lead/speaking` — Minny hero + mood states (M2)
- `/read2lead/lesson` — Minny feedback voice (W10 polish)

Load order: `minny_{mood}.png` → fallback `minny.png`.

See `docs/MINNY_M0_DESIGN_OUTCOME.md` §2 and `docs/MINNY_ROADMAP.md` §0.3.
