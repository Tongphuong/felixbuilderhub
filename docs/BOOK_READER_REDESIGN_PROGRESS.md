# Book Reader Redesign — Progress Log

> **This file is the single source of truth for redesign progress.**
> Every phase session MUST start by reading this file and the spec, and MUST end by updating this file + committing.
> If Cline crashes mid-phase, the next session reads this file and resumes from the "TODO" line.

## Spec Reference
- **Spec:** `_ops/specs/Design planning discussion/handoff/handoff-to-cline.md`
- **Original spec:** `_ops/specs/Design planning discussion/handoff/original-spec.md`
- **Design HTML:** `_ops/specs/Design planning discussion/handoff/Book Reader.dc.html`
- **Screenshots:** `_ops/specs/Design planning discussion/handoff/screenshots/`

## Branch
`feat/book-reader-redesign` (created from `main`)

## Current Phase
**Phase 2 — Book Page Layout**

---

## Phase Status

| Phase | Status | Commit | Files Touched | Lines Changed |
|-------|--------|--------|---------------|---------------|
| 0 — Scaffold | ✅ Done | 83ccfb2 | docs/BOOK_READER_REDESIGN_PROGRESS.md | +230 |
| 1 — Progress Trail | ✅ Done | (pending) | lesson.astro | +259 -3 |
| 2 — Book Page Layout | 🔄 In Progress | — | — | — |
| 3 — Audio Gate Redesign | ⬜ Not Started | — | — | — |
| 4 — Guided Questions Mini-Game | ⬜ Not Started | — | — | — |
| 5 — Shadow Reading UI | ⬜ Not Started | — | — | — |
| 6 — Page Transitions & Celebration | ⬜ Not Started | — | — | — |
| 7 — Responsive Sweep | ⬜ Not Started | — | — | — |
| 8 — Final Verification & PR Prep | ⬜ Not Started | — | — | — |

---

## Codebase Map (reference for every phase)

| File | Role | Protection | Key Line Ranges |
|---|---|---|---|
| `src/pages/read2lead/lesson.astro` (6135 lines) | Book reader HTML, CSS, JS state machine | **PROTECTED** — Lonewolf spec required (we have it) | HTML: L76-125, CSS: L853-940, JS: L3407-4010, SFX: L947-1000 |
| `src/lib/read2lead-book-flow.mjs` (229 lines) | Question selection, shadow chunking, validation | Editable (pure logic) | Full file |
| `public/scripts/r2l-recorder.js` | Recording pipeline | **FROZEN** — do not touch | — |
| `public/scripts/r2l-mic-check.js` | Mic permission flow | **FROZEN** — do not touch | — |
| `public/scripts/read2lead-speaking-check.js` | Whisper STT scoring | **FROZEN** — do not touch | — |
| `src/styles/design-system.css` | Design tokens | Editable | L1-80 (tokens) |
| `src/styles/r2l-w2-dynamic.css` | XP/combo animation keyframes | Editable | — |
| `schemas/pack.schema.v2.json` | Pack data shape | **FROZEN** — cross-repo | — |
| `src/types/pack.d.ts` | TS types (auto-generated) | Read-only | — |

### Key data shape
- `lesson.book_images[]` — image URLs per page (3-24)
- `lesson.book_page_audio[]` — audio URLs per page (3-24)
- `lesson.story.paragraphs_en[]` — English text per page
- `lesson.story.sentences[]` — `{ text_en, text_vi, audio_url, paragraph_index }`
- `lesson.guided_listening[].questions[]` — `{ id, question_en, options_en, correct_index, sentence_index }`
- `lesson.book_attribution` — `{ title, creators, publisher, credit_text, source_url, license, image_credits }`

### Stage machine
`story → questions → shadow → next → (repeat for each page) → summary`

Driven by `state.bookReader` object:
- `pageIndex` — current page (0-based)
- `stage` — `'story'|'questions'|'shadow'|'next'|'summary'`
- `questionIndex` — current question within page
- `chunkIndex` — current shadow chunk within page
- `pages[]` — per-page state: `{ page_index, audio_completed, selected_questions, question_results, shadow_chunks }`

### Key JS functions in lesson.astro
- `isBookLesson()` (L1067) — detects book lesson
- `bookInitializeState()` (L3436) — builds page state from lesson data
- `w1InitBookReaderPhase()` (L3503) — mounts book reader
- `bookShowPage()` (L3540) — renders current page (image, text, counter, stage)
- `bookSetStage(stage)` (L3556) — toggles `[data-book-stage-container]` visibility
- `bookPlayPageAudio()` (L3590) — plays page audio
- `bookGoToNextStoryPage()` (L3625) — advances during story stage
- `bookRenderQuestion()` (~L3570) — renders current question
- `bookRenderShadowChunk()` (~L3900) — renders current shadow chunk
- `bookFinishReader()` (~L3980) — shows summary, submits lesson

### Design tokens (from design-system.css)
- `--navy-950: #10273a`, `--navy-900: #17354a`, `--navy-850: #1d3f58`
- `--gold: #c88f38`, `--gold-light: #f2cc7e`
- `--cream: #f5e6c8`, `--cream-muted: #d9c7a4`, `--cream-dim: #aa9673`
- `--success: #6fcf97`, `--danger: #f87171`
- Spacing: `--space-1` (0.25rem) through `--space-28` (7rem)
- Radius: `--radius-sm` (0.375rem) through `--radius-2xl` (1.5rem), `--radius-full`

---

## Universal Constraints (every phase must honour)

> You are editing the Read2Lead book reader for Vietnamese children ages 6–12.
>
> Hard rules — never violate:
> - The mic/recorder pipeline is **protected**. Do not touch `r2l-recorder.js`, `r2l-mic-check.js`, `read2lead-speaking-check.js`, or audio capture code.
> - The lesson completion flow (story → questions → shadow → next page) is **protected**. Don't change stage order or completion gating.
> - `main` branch = production. Work on `feat/book-reader-redesign` only.
> - **All kid-facing UI text in Vietnamese.** No English UI strings. English appears only as story content.
> - **Minimum 44px tap targets** on every interactive element.
> - **Use existing design tokens only** — `--gold`, `--navy-950`, `--cream`, etc. Do not invent new colors.
> - **Minny voice rules**: Minny says "Minny" and "con"; never uses red, "wrong", "sai", or FOMO language; max 1–2 sentences Vietnamese.
> - If unsure about file paths, behavior, or scope, **ask the user before guessing**.

---

## Phase Details

### Phase 0 — Scaffold & Progress Tracker (DONE)
**Goal:** Set up the safety net so no phase ever loses context.
- [x] Create feature branch `feat/book-reader-redesign` from `main`
- [x] Create PROGRESS.md (this file)
- [x] Commit `phase-0-scaffold` (83ccfb2)
- **Exit gate:** PROGRESS.md exists, branch created, commit made. ✅

---

### Phase 1 — Progress Trail (DONE)
**Spec ref:** `handoff-to-cline.md` TASK 1. **Screenshots:** `01-ipad-listen.png`, `03-progress-trail.png`
**Goal:** Replace `#book-reader-page-counter` badge with a horizontal progress trail.
**Files:** `lesson.astro` only — HTML (L76-80), CSS (after L940), JS (near L3550)
**Sub-steps:**
- [x] Add trail HTML container above `figure` (lesson title + "Trang X / N" + thin bar + trail nodes)
- [x] Add CSS: completed=gold star, active=Minny avatar+pulse+"đang đây" pill, upcoming=dashed+number, last=treasure, connecting line (dotted cream→solid gold gradient), responsive reflow
- [x] Add `bookRenderTrail()` JS — called from `bookShowPage()` — builds nodes from `state.lesson.book_images.length`
- [x] Wire click-to-review on completed nodes (read-only, no stage change)
- [x] Per-page labels from fallback "Trang {i+1}" (lesson.pages[i].title not in data shape — uses paragraphs_en)
**Constraints:** ≥44px nodes, existing tokens only, reflow for 5-8 pages, persistent during all stages.
**Exit gate:** Trail renders for 5/6/8 pages, visual matches screenshot, `node --test` passes (679/680 — 1 pre-existing admin test failure unrelated), protected files untouched, commit `phase-1-progress-trail`.
**Notes:** 259 insertions, 3 deletions. Minny avatar uses `/assets/minny/minny_idle.png`. Progress bar fill animates with gold gradient. Reduced-motion fallback disables pulse animation.

---

### Phase 2 — Book Page Layout (IN PROGRESS)
**Spec ref:** `handoff-to-cline.md` TASK 2. **Screenshot:** `01-ipad-listen.png`
**Goal:** Replace stacked figure with split storybook layout.
**Files:** `lesson.astro` — HTML (L81-86), CSS (L864-940), JS (karaoke in `bookShowPage`)
**Sub-steps:**
- [ ] 2-column grid ≥1024px (illustration left ~55%, text right ~45%), 1-column <640px
- [ ] Karaoke caption strip below illustration
- [ ] Helper chips: "Dịch tiếng Việt", "Từ khó", "Giúp con" (≥44px)
- [ ] Sentence highlight tracks audio playback
- [ ] Wire chips: toggle translations, vocab popover, re-play
**Constraints:** Text ≥18px phone / ≥22px tablet, don't break stage gating.
**Exit gate:** Side-by-side ≥1024px, stacked <640px, karaoke visible, chips wired, tests pass, commit `phase-2-book-layout`.

---

### Phase 3 — Audio Gate Redesign (NOT STARTED)
**Spec ref:** `handoff-to-cline.md` TASK 3. **Screenshots:** `01-ipad-listen.png`, `02-stage-states.png`
**Goal:** Replace bordered gate with big play button (IDLE/PLAYING/DONE).
**Files:** `lesson.astro` — HTML (L87-92), CSS (L905-914), JS (`bookPlayPageAudio` L3590+)
**Sub-steps:**
- [ ] 84px gold circle + state-driven content
- [ ] CSS: IDLE (play triangle), PLAYING (5 waveform bars + halo), DONE (checkmark)
- [ ] JS state tracking `bookAudioState`, pause/resume, auto-advance 800ms after `ended`
- [ ] `prefers-reduced-motion` fallback
**Constraints:** DO NOT change audio service, preserve must-listen rule.
**Exit gate:** 3 states distinct, can't skip, pause/resume works, tests pass, commit `phase-3-audio-gate`.

---

### Phase 4 — Guided Questions Mini-Game (NOT STARTED)
**Spec ref:** `handoff-to-cline.md` TASK 4. **Screenshot:** `02-stage-states.png`
**Goal:** Make 2 MCQ questions feel like a mini-game.
**Files:** `lesson.astro` — HTML (L93-100), CSS (new), JS (`bookRenderQuestion` ~L3570)
**Sub-steps:**
- [ ] Restyle question card (radius 24, navy gradient, 64px+ option cards)
- [ ] Correct state: green burst particles, Minny smile bob, XP/combo pills, auto-advance 1.2s
- [ ] Retry state: line-through + dashed border (NOT red), Minny wobble, hint card
- [ ] Shuffle options per render
- [ ] Minny voice: no "sai"/"wrong"/red, warm observational praise
**Constraints:** ≥44px targets, both correct → shadow stage.
**Exit gate:** Correct=green burst+XP, wrong=wobble+hint (no red), counter updates, tests pass, commit `phase-4-questions`.

---

### Phase 5 — Shadow Reading UI (NOT STARTED)
**Spec ref:** `handoff-to-cline.md` TASK 5. **Screenshot:** `02-stage-states.png`
**Goal:** Wrap protected recorder in friendly "press to talk" UI.
**Files:** `lesson.astro` — HTML (L101-111), CSS (new), JS (`bookRenderShadowChunk` ~L3900)
**Sub-steps:**
- [ ] 110px mic button (pink/red gradient) + "REC" pill
- [ ] Star-shaped level meter from recorder amplitude
- [ ] Live waveform (12-16 bars from real amplitude)
- [ ] 5 states: IDLE, COUNTDOWN, RECORDING, CHECKING, RESULT
- [ ] Result tiers: 80+ (2 stars, advance), 60-79 (1 star, try-again), <60 (try-again, no stars)
**Constraints:** DO NOT TOUCH `r2l-recorder.js`, `r2l-mic-check.js`, STT call. Only wrap UI.
**Exit gate:** 5 states render, level meter responds, try-again works, `git diff main -- public/scripts/r2l-*.js` empty, tests pass, commit `phase-5-shadow-ui`.

---

### Phase 6 — Page Transitions & Celebration (NOT STARTED)
**Spec ref:** `handoff-to-cline.md` TASK 6. **Screenshot:** `04-page-transition.png`
**Goal:** Replace `hidden` swaps with smooth transitions + celebration.
**Files:** `lesson.astro` — CSS (new keyframes), JS (`bookSetStage` L3560, next-page handler L3520)
**Sub-steps:**
- [ ] Stage→Stage: 250ms fade + 8px slide
- [ ] Page→Reward: celebration card ~1.5s (gold star, XP/coin pills, CTA, sparkles, level-up SFX)
- [ ] Reward→New Page: rotateY(-32deg) page-turn + slide-in (~600ms)
- [ ] `prefers-reduced-motion`: plain fade only
- [ ] CTA enables after reward; last page → "Hoàn thành →"
**Constraints:** Stage order unchanged, CSS animations preferred.
**Exit gate:** Smooth swaps, reward ~1.5s, page-turn visible, reduced-motion fallback, tests pass, commit `phase-6-transitions`.

---

### Phase 7 — Responsive Sweep (NOT STARTED)
**Spec ref:** `handoff-to-cline.md` RESPONSIVE SWEEP. **Screenshots:** `05-phone-view.png`, `06-laptop-view.png`
**Goal:** Verify phone (≤640px) and laptop (≥1280px).
**Files:** `lesson.astro` CSS only
**Sub-steps:**
- [ ] Phone: mini trail (24px nodes), illustration ~38vh, text 18px, bottom action bar + safe-area
- [ ] Laptop: 3-column (trail rail ~220px left, cinema center, action panel ~320px right), audio scrub overlay, keyboard shortcuts (Space/R/1-4/↵/M), hover states
- [ ] Test at 360, 390, 414, 768, 1024, 1280, 1440px — no horizontal scroll
**Exit gate:** No h-scroll at all breakpoints, phone bottom bar works, laptop shortcuts work, tests pass, commit `phase-7-responsive`.

---

### Phase 8 — Final Verification & PR Prep (NOT STARTED)
- [ ] Run `node --test` (hard gate) + `npx astro check` (advisory)
- [ ] Verify `git diff main -- public/scripts/r2l-*.js` is empty
- [ ] Verify PROGRESS.md fully filled
- [ ] Open PR `feat/book-reader-redesign` → `main` with spec link

---

## Session Resume Protocol

**Starting a new session (or after a crash):**
1. `read_file` this PROGRESS.md — know exactly where we are.
2. `read_file` the relevant task section of `handoff-to-cline.md` — re-anchor on spec.
3. `git log --oneline -5` — verify commit history matches PROGRESS.md.
4. Resume from the "TODO" line in the current phase.

**Ending a session:**
1. Update PROGRESS.md with what was done, files, line ranges, decisions.
2. `git add -A && git commit -m "phase-N-<name>"`.
3. Update the "Current Phase" pointer at the top.