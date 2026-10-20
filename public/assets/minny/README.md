# Minny character assets (Read2Lead / MSMW canon)

## R2L-ISLAND release 3 (2026-10-20): Minny is flat vector now

The locked design (`_design/read2lead-dao-phieu-luu/assets/minny/`) draws Minny as flat vector in 6 poses, copied byte-identical into `vector/`
(`minny-face`, `minny-face-talk`, `minny-face-sleep`, `minny-idle`, `minny-listen`, `minny-cheer`). New UI points at `vector/*.svg`.
Every PNG below and in `../r2l/minny/` was re-rendered from those SVGs at the SAME file name and pixel size, so pages and the protected
`lesson.astro` pick up the flat art with no code change:

| File | Pose |
|---|---|
| `minny.png`, `minny_full.png`, `minny_idle.png`, `minny_encourage.png` (288x512, opaque) | minny-idle on a sky + hill ground |
| `minny_listen.png` (288x512) | minny-listen |
| `minny_celebrate.png` (288x512) | minny-cheer |
| `minny_bust.png` (400x400, transparent) | minny-idle, upper body |
| `minny_face.png` (400x400, transparent) | minny-face (without the sky square) |
| `../r2l/minny/idle.png` | minny-idle |
| `../r2l/minny/clap.png`, `dance.png` | minny-cheer |
| `../r2l/minny/smile.png` | minny-face |
| `../r2l/minny/wink.png` | minny-face-talk |
| `../r2l/minny/thinking.png` | minny-listen |

The `minny_*.mp4` loops below are the OLD 3D art and were NOT replaced (no flat video exists).

**Older source of truth (3D art, retired):** `D:/MSMW/marketing/seedance_minny/references/minny_ref_final.png`

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
