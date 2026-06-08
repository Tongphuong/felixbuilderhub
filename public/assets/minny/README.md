# Minny character assets (Read2Lead / MSMW canon)

**Source of truth:** `D:/MSMW/marketing/seedance_minny/references/minny_ref_final.png`

## PNG sprites (required)

| File | Role | Status |
|---|---|---|
| `minny.png` | General reference sprite | ✅ In repo |
| `minny_idle.png` | Default pose — also used as video poster | ✅ Placeholder (M0) |
| `minny_listen.png` | Kid is speaking / recording | ✅ Placeholder (M0) |
| `minny_celebrate.png` | Success / good attempt | ✅ Placeholder (M0) |
| `minny_encourage.png` | Retry / gentle nudge | ✅ Placeholder (M0) |

M0 placeholders are copies of `minny.png`. Felix may export distinct poses later.

## Video loops (optional)

Felix can drop short loop clips here. The speaking page tries video first, then falls back to PNG.

| File | Mood | When shown |
|---|---|---|
| `minny_idle.mp4` / `.webm` | idle | Default hero loop |
| `minny_listen.mp4` / `.webm` | listen | Nghe Minny / recording |
| `minny_celebrate.mp4` / `.webm` | celebrate | Good feedback |
| `minny_encourage.mp4` / `.webm` | encourage | Retry / gentle nudge |

**Convention:** same basename as PNG (`minny_{mood}`). Prefer `.mp4` (H.264); `.webm` is tried if mp4 404s. Poster = matching PNG. Autoplay, loop, muted, `playsinline`.

## Usage

- `/read2lead/speaking` — Minny hero video/PNG + mood states
- `/read2lead/lesson` — Minny feedback voice (W10 polish)

Load order per mood: `{mood}.mp4` → `{mood}.webm` → `{mood}.png` → `minny.png`.

See `docs/MINNY_M0_DESIGN_OUTCOME.md` §2 and `docs/MINNY_ROADMAP.md` §0.3.
