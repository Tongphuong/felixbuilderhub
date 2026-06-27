# FELIXBUILDERHUB — SESSION ENTRY POINT

Read this file first. Every session. No exceptions.

---

## 🚨 FIRST: cd to the repos root

All project files and `_ops/` docs are under `/home/felixbuilderhub/work/repos/`. Before reading anything else:

```bash
cd /home/felixbuilderhub/work/repos/
```

Then `_ops/` resolves to `_ops/AGENTS.md`, and `hub/` resolves to `hub/CLAUDE.md` etc.

---

## What this project is

**felixbuilderhub** is the monorepo for Felix's English coaching products. It contains:
- **Frontend** (Astro): Read2Lead interactive lessons, Speak with Minny (upcoming), portfolio + lead-gen
- **Backend** (`backend/`): Python API on Render that generates reading packs (LLM → validate → TTS → R2)
- **Unified profile** at `/ho-so` (kid + parent views)

**Users:** Vietnamese children (6-12) + their non-tech parents. Premium families with MacBooks + 5G.

---

## Tech stack

- **Astro 5** — static site generator with islands
- **Tailwind CSS** — utility-first styling
- **Cloudflare Pages** — hosting, auto-deploys from `main`
- **Cloudflare Workers (Functions)** — API endpoints in `functions/`
- **Cloudflare KV** — pack storage, progress state
- **Cloudflare D1** — student profile database (upcoming)

---

## Folder map

```text
felixbuilderhub/
├── CLAUDE.md                ← you are here
├── AGENTS.md                ← hub-specific rules + invariants
├── src/
│   ├── pages/               ← Astro pages (routes)
│   │   ├── read2lead/
│   │   │   └── lesson.astro ← PROTECTED: lesson completion logic
│   │   ├── ho-so/           ← unified student profile (kid + parent)
│   │   └── index.astro      ← homepage
│   ├── components/          ← reusable Astro/HTML components
│   ├── layouts/             ← page layouts
│   └── styles/              ← global + component CSS
├── public/
│   ├── scripts/             ← client-side JS
│   │   ├── r2l-recorder.js  ← PROTECTED: recording flow
│   │   ├── r2l-mic-check.js ← PROTECTED: mic permission flow
│   │   └── read2lead-speaking-check.js ← Whisper scoring
│   ├── assets/              ← images, SVG, monsters, eggs
│   └── audio/               ← sound effects (Kenney)
├── functions/               ← CF Worker API endpoints
├── schemas/                 ← KV data schemas
├── backend/                 ← Python API (Read2Lead pack generator, deployed on Render)
│   ├── api/                 ← Flask server + LLM pipeline + repair chain
│   ├── schemas/             ← pack.schema.v2.json (source of truth)
│   └── tests/               ← pytest suite
├── docs/
├── tests/                   ← frontend test suite
└── README.md
```

---

## Key files to know

| File | What it does |
|---|---|
| `src/pages/read2lead/lesson.astro` | Main lesson page — renders pack activities, handles completion flow |
| `public/scripts/r2l-recorder.js` | R2LRecorder class — on-device silence detection, WAV fallback, device memory |
| `public/scripts/r2l-mic-check.js` | Mic permission + warmup countdown |
| `public/scripts/read2lead-speaking-check.js` | Whisper STT + `scoreTranscript()` pronunciation scoring |
| `functions/api/generate-pack-v2.js` | CF Worker: triggers backend pack generation |
| `functions/api/read2lead-speaking-check.js` | CF Worker: proxies Whisper STT requests |

---

## Key systems (live — no separate doc, read this)

### Graded rewards (shipped 2026-06-22, commit 4502d3f)
Replaces binary pass/fail. Function `gradeRewards(scorePercent)` in `functions/api/_read2lead-v2-state.js`.

| Grade | Threshold | XP | Coins |
|---|---|---|---|
| S | ≥ 85% | 20 | 25 |
| A | ≥ 70% | 20 | 15 |
| B | ≥ 50% | 10 | 8 |
| F | < 50% | 0 | 0 |

### Badge system (shipped 2026-06-22, commit 4502d3f)
9 badges with emoji, exported as `BADGE_DEFINITIONS` from `_read2lead-v2-state.js`. Logic in `refreshBadges()` / `badgeUnlocked()`. Leaderboard renders unlocked badges as pill chips.

| ID | Emoji | Trigger |
|---|---|---|
| first_story | 📖 | completed_packs ≥ 1 |
| steady_three | 🎯 | completed_packs ≥ 3 |
| pack_10 | 🏆 | completed_packs ≥ 10 |
| streak_3 | 🔥 | streak_days ≥ 3 |
| streak_5 | 🐝 | streak_days ≥ 5 |
| streak_7 | 🌟 | streak_days ≥ 7 |
| coin_saver | 💰 | coins ≥ 100 |
| level_climber | 📈 | unlocked more than 1 level |
| brave_voice | 🎙️ | voice_attempts ≥ 1 |

---

## What's shipped

| Feature | Status |
|---------|--------|
| Nghe điền (listening_fill_blank) | Live |
| Xếp câu (listen_and_order) | Live |
| Đọc hiểu (reading_comprehension) | Live |
| Nói theo / Shadow (listen_and_speak) | Live — renamed from "Nói lại" |
| Đọc to / Read Aloud (read_aloud) | Backend merged. Frontend on `hermes/wave1-read-aloud` — pending Claude review + Phương QA |
| Guided Listening | Live — Wh- comprehension, 2 questions/sentence |
| Graded rewards + Badges | Live |

## Coming next

**Wave 2: SpeakUp** — AI voice companion on `/read2lead/speaking.astro`.
- Voice loop: Whisper STT → DeepSeek Flash → Edge TTS
- 5-minute sessions, conversation transcript, session summaries
- **No spec yet** — Claude needs to write the spec.

---

## How to work in a new session

0. `cd /home/felixbuilderhub/work/repos/` — if you haven't already
1. Read `CLAUDE.md` (this file)
2. Read `_ops/AGENT_LOG.md` (last 10 entries — session context)
3. Read `_ops/AGENTS.md` — team roles + rules
4. Read your task spec from Claude
5. Execute
6. Report in standard format (see _ops/AGENTS.md §4)

---

## Non-negotiable rules

1. Big tap targets (44px+), instant feedback, no dead ends
2. No English error strings shown to kids — Vietnamese UI text
3. Lesson completion flow is protected — spec required for changes
4. Mic/recorder pipeline is protected — spec required for changes
5. `node --test` **must pass** before push (hard gate). `npx astro check` is advisory — baseline has 395 pre-existing errors in files untouched by current work.
6. Pushing `main` = production deploy. Real kids are using this.

---

## Key references

| Doc | Purpose |
|---|---|
| Documented inline in this file (see "Upcoming redesign" section) | Approved roadmap for 4-phase redesign + Speak with Minny |
| `_ops/AGENTS.md` | Team roles, rules, permissions |
| `docs/ENV.md` | Environment variables and setup |
| `design_handoff/brand-spec.md` | Brand guidelines |
| `schemas/SCHEMA.md` | KV data structure documentation |
