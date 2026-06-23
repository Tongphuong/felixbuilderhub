# FELIXBUILDERHUB — SESSION ENTRY POINT

Read this file first. Every session. No exceptions.

---

## What this project is

**felixbuilderhub** is the frontend website for Felix's English coaching products. It hosts:
- **Read2Lead** interactive lessons at `/read2lead/lesson`
- **Speak with Minny** AI voice companion (upcoming) at `/speak-with-minny`
- Portfolio and lead-gen pages for the coaching business

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
│   │   ├── hoc-sinh/        ← kid dashboard
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
├── design_handoff/          ← brand spec + component reference
├── docs/
│   ├── ENV.md               ← environment setup
│   └── reference_design_system.md
├── tests/                   ← test suite
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

## Upcoming redesign (see MASTER_PLAN.md)

The approved master plan at `_ops/specs/MASTER_PLAN.md` describes:

**Read2Lead** — new 4-phase lesson flow:
1. **Guided Listening** — paragraph-by-paragraph Q&A (new component)
2. **Activities A/B/C** — existing components, minor wiring changes
3. **Shadow** — all story sentences, Whisper scored (new component, replaces Activity E)
4. **Read Aloud** — no audio model, Whisper scored (new component)

**Speak with Minny** — AI voice companion:
- Voice loop: Whisper STT → DeepSeek Flash → Edge TTS
- New page at `/speak-with-minny`
- 5-minute sessions, conversation transcript, session summaries

---

## How to work in a new session

1. Read `CLAUDE.md` (this file)
2. Read `_ops/AGENTS.md` — team roles + rules
3. Read your task spec
4. Execute
5. Report in standard format (see AGENTS.md §4)

---

## Non-negotiable rules

1. Big tap targets (44px+), instant feedback, no dead ends
2. No English error strings shown to kids — Vietnamese UI text
3. Lesson completion flow is protected — spec required for changes
4. Mic/recorder pipeline is protected — spec required for changes
5. All tests must pass before push (`npx astro check && node --test`)
6. Pushing `main` = production deploy. Real kids are using this.

---

## Key references

| Doc | Purpose |
|---|---|
| `_ops/specs/MASTER_PLAN.md` | Approved roadmap for 4-phase redesign + Speak with Minny |
| `_ops/AGENTS.md` | Team roles, rules, permissions |
| `docs/ENV.md` | Environment variables and setup |
| `design_handoff/brand-spec.md` | Brand guidelines |
| `schemas/SCHEMA.md` | KV data structure documentation |
