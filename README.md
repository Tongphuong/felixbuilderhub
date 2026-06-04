# felixbuilderhub.com

Astro 5 web hub for Felix's three EdTech products: **Read2Lead** (automated
English reading-pack generator), **MSMW** (My Story, My World — personalized
storybook PDF), and **Coaching** + **Sharing** Telegram lead flows.

Lives at https://felixbuilderhub.com. Built and deployed via Cloudflare
Pages auto-build from `main`.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Astro 5.18, Tailwind CSS, plain JS (no TypeScript yet) |
| Edge runtime | Cloudflare Pages Functions (Workers) |
| State | Cloudflare KV (`READ2LEAD_CODES` namespace) |
| Auth | `ADMIN_PASSWORD` middleware on `/admin/*` |
| Lead delivery | Telegram bot (coaching, MSMW, sharing-subscribe) |

## Pages (11)

| Route | Purpose |
|---|---|
| `/` | Landing — Felix portfolio + 3-product cards |
| `/read2lead` | Read2Lead product page + parent intake form |
| `/read2lead/lesson` | Kid-facing interactive lesson runner (story → 5 cluster activities → submit) |
| `/read2lead/review` | Felix-facing review dashboard for student progress (a.k.a. Felixar) |
| `/read2lead/leaderboard` | Class leaderboard view |
| `/msmw` | MSMW storybook product page + lead form |
| `/coaching` | 1-on-1 coaching page + lead form |
| `/space` | Felix's personal/blog space |
| `/admin/codes` | Admin: create/edit/delete student access codes (password-gated) |
| `/privacy` | Privacy policy |
| `/404` | Not-found |

## Edge API (17 functions)

Helpers (underscore prefix, not directly callable):
- `_middleware.js` — admin auth gate for `/admin/*`
- `api/_rate-limit.js` — per-IP rate limit helpers
- `api/_read2lead-lesson.js` — buildActivities + grader logic shared by lesson/submit/grade-slot

Read2Lead automation:
- `POST /api/generate-read2lead-pack` — accept parent form, forward to Render backend
- `GET  /api/check-generation-status` — poll backend task state
- `POST /api/task-state` — backend → hub callback (updates KV)
- `GET  /api/read2lead-lesson` — fetch lesson payload by code+pack_id
- `GET  /api/read2lead-progress` — fetch student progress
- `GET  /api/read2lead-leaderboard` — class leaderboard
- `POST /api/submit-read2lead-lesson` — final grade + persist result
- `POST /api/grade-slot` — inline per-slot grading during lesson
- `POST /api/review-read2lead-speaking` — voice review (Whisper TBD)

Admin:
- `GET/POST /api/admin/codes` — list + create access codes
- `GET/PATCH/DELETE /api/admin/codes/[code]` — single-code ops

Lead bots (Telegram delivery):
- `POST /api/coaching-booking`
- `POST /api/msmw-lead`
- `POST /api/sharing-subscribe`

## Env bindings

See [docs/ENV.md](docs/ENV.md) for the full reference (KV namespaces,
secrets, per-endpoint usage matrix).

## Local dev

```sh
npm install
npm run dev
```

Astro dev server runs at http://localhost:4321. Cloudflare Functions
NOT executed locally — for full E2E test, deploy to a Cloudflare Pages
preview branch.

## Deploy

Push to `main` → Cloudflare Pages auto-builds + deploys to
https://felixbuilderhub.com within ~2 minutes. Preview deploys are
created for other branches automatically.

## Sister repos

- **Read2Lead backend** (Python on Render): `D:/Read2lead/read2lead_v0_codex/`
  — generates pack JSON + PDF + MP3, calls back to hub via
  `READ2LEAD_BACKEND_URL` + `READ2LEAD_BACKEND_SECRET`
- **MSMW PDF generator** (Python on local Windows): `D:/MSMW/` — manual
  workflow triggered after Telegram lead

## Conventions

- Files >800 lines are flagged for future split (see god-file list in
  Phase γ roadmap, internal docs)
- Pack JSON schema additive-only (never breaking)
- Submit payload keys frozen (`fill_blank`, `story_cloze`, `dictation`,
  `best_line`, etc.) — backward compat required for old packs in KV
- Hub-first deploy rule: when changing pack schema, hub frontend adds
  graceful skip BEFORE R2L backend emits new field

## Brand

| Token | Hex | Use |
|---|---|---|
| `navy-950` | #0a0e1a | Page background |
| `cream` | #f5e6d3 | Body text |
| `gold` | #d4a64e | Headings + accents |
| `accent` | #4ade80 | CTA buttons + success |

Defined in [tailwind.config.mjs](tailwind.config.mjs). Avoid hardcoded
hex; reference via Tailwind class.
