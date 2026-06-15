# Plan: Read2Lead Lesson UX/UI Redesign — for Claude review

**Doc type**: UX redesign plan + phased implementation spec  
**Date**: 2026-06-08  
**Author**: Cursor (from Felix design sessions)  
**Reviewer**: Claude (Phương — Felix)  
**Executor**: Codex / Cursor (post-approval)  
**Audience**: Felix (PM), Claude (review + spec hardening), Codex (build)  
**Status**: 🟡 **Draft — awaiting Claude review**

**Related docs**:
- `docs/MINNY_ROADMAP.md` + `docs/MINNY_M0_DESIGN_OUTCOME.md` — Minny persona, voice rules
- `docs/archive/plan_mission_mode_v3_for_codex.md` — earlier mission framing (partially superseded)
- Hub implementation: `src/pages/read2lead/lesson.astro` (~2.7k lines)
- Backend packs: 5 activities from Read2Lead API; hub injects 6th (`retell_summary`)

---

## 0. TL;DR (for reviewer)

Felix lesson V2 **works technically** (6 activities, Whisper scoring, Minny shell) but UX is still **“coaching website”**, not **“kid mission app”**. Kids and no-tech parents struggle with dual navigation, weak micro-feedback, and Minny as decoration.

**Proposed fix (not a Monkey clone):**
1. **Story Dock** — story always visible (collapsed/expanded), never hidden; sentence highlight per task
2. **Single primary CTA** — “Tiếp tục →” (retire dual step-bar + per-activity next confusion)
3. **Progress `n/6` + dots** — not % alone
4. **Loop Pack** — micro-reward per item + gated continue + part-complete anticipation
5. **Pagination** for high-item activities (1, 2, 5) — one objective per screen
6. **Minny state machine** — bubble = one action command, not wallpaper

**Felix constraint (non-negotiable):** Children **must re-read the story** during activities. **Do not hide story** behind drawer-only UX — causes back-and-forth friction worse than today.

---

## 1. Problem statement

### 1.1 User-reported / observed issues

| Issue | Symptom | Root cause (technical) |
|-------|---------|------------------------|
| Step 6 unreachable | “Tiếp theo” dead after part 5 | Nav `disabled` baked at render when `activities.length === 5`; fixed in `ceb16ec` but architecture fragile |
| Step 6 recording stuck | “Con kể” never enables | Retell gated on TTS `onend`; fixed in `ceb16ec` — pattern risk remains |
| Minny “does nothing” | Static image after speak | Hero separated from feedback; no bubble TTS; no per-action state |
| Parent confusion | “Con làm gì / xong chưa?” | `%` progress, 6 step buttons + Quay lại/Tiếp theo, “Lưu chiến công” at page bottom |
| Story re-read friction | (if we hid story) tap back repeatedly | Krashen input needs visible story — **hiding is wrong tradeoff** |

### 1.2 Audit scores (self-assessed, pre-redesign)

| Audience | “Nhìn vào biết làm” | “Muốn làm tiếp” (dopamine) |
|----------|---------------------|----------------------------|
| Child 7–10 | ~55% | ~40% |
| No-tech parent | ~75% | N/A |
| Felix coach (pedagogy) | OK sequence | Drop-off telemetry missing |

**Conclusion:** Navigation + story access fixes are **necessary not sufficient**. Need **Loop Pack** for tight action→reward→continue.

---

## 2. Goals & non-goals

### 2.1 Goals

| ID | Goal | Measure |
|----|------|---------|
| G1 | Child knows **one next action** per screen | Usability test: 8/10 kids correct without parent help |
| G2 | Parent understands **part n/6** in 3 seconds | Parent strip + `n/6` dots |
| G3 | Story re-readable **without leaving task** | Story Dock expand < 1 tap; no route change |
| G4 | Micro dopamine every item (not only end of part) | Item ✓ + sfx + Minny flash < 400ms after success |
| G5 | Minny feels like **coach**, not mascot | Bubble command + state on listen/celebrate/encourage |
| G6 | Preserve Felix coaching brand | No star shop / avatar grind / FOMO |

### 2.2 Non-goals

- Full Raz-Kids portal clone (Reading Room, Level Up planet, Star Zone economy)
- Full Monkey Junior visual clone (bright candy UI, M-Speak reimplementation)
- Replacing Whisper / pack schema / 6-activity pedagogy order
- Standalone `/read2lead/speaking` hub expansion (deferred per v0 decision)
- Server-side Minny TTS voice (phase later; v1 uses `speechSynthesis` + sfx)
- Teacher dashboard changes (Felixar separate)

---

## 3. Design principles

1. **Story-first input (Krashen)** — dock, don’t delete  
2. **One screen — one job** — paginate items in parts 1, 2, 5  
3. **One primary CTA** — “Tiếp tục”; secondary = Nghe / Nói only where needed  
4. **No red scores** — ✓ / gentle retry / encourage (align Minny M0)  
5. **Vietnamese command, English practice** — Minny bubble VN; task content EN  
6. **Coaching, not casino** — celebrate effort; no leaderboard pressure in-lesson  

---

## 4. Reference patterns (what to steal, what to skip)

### 4.1 Raz-Kids / Kids A-Z

| Steal | Skip |
|-------|------|
| Fixed 3-icon task mental model (adapt to 6 parts with icons) | Space theme / rocket avatar |
| Green check per sub-task | Assignment portal complexity |
| Linear unlock feel | Intermediate vs primary portal split |

### 4.2 Monkey Junior

| Steal | Skip |
|-------|------|
| One PLAY path; short sessions | Locked curriculum replacing parent-chosen stories |
| Multisensory feedback (sound + motion) | Full game variety per 30 screens |
| M-Speak-style **immediate** pronunciation feedback | Proprietary scoring UI clone |
| AI coach character reacting during task | Super-app course picker |

### 4.3 Felix-specific

- Personalized **generated story** (not library picker) → Story Dock + highlight **current sentence** is the differentiator  
- Felix human coach downstream → lesson ends with **portfolio submit**, not infinite play  

---

## 5. Information architecture (target)

### 5.1 Page regions (mobile)

```
┌─────────────────────────────────────────┐
│ A. Mission chrome                        │
│    ← Hồ sơ    Phần 3/6  ●●●○○○          │
│    [optional parent strip — collapsed]   │
├─────────────────────────────────────────┤
│ B. Story Dock (always present)           │
│    📖 Title    [Mở truyện ▼] [🔊 Cả truyện]│
│    2-line preview OR expanded paragraphs │
│    + tap-to-play sentences when expanded │
│    + highlight: current task sentence    │
├─────────────────────────────────────────┤
│ C. Minny command strip                   │
│    [avatar sm]  "Con chọn từ còn thiếu"  │
├─────────────────────────────────────────┤
│ D. Task panel (ONE item when paginated)  │
│    Câu 2/5 · mechanic UI                 │
├─────────────────────────────────────────┤
│ E. Primary CTA                           │
│    [ Tiếp tục → ]  (disabled until done) │
└─────────────────────────────────────────┘
```

**Desktop:** B = left column (dock expandable); C+D+E = right column. Same state machine.

### 5.2 Navigation model change

| Current | Target |
|---------|--------|
| 6 step buttons (free jump) | **Step rail read-only** OR dots only; jump only to **completed** parts |
| Quay lại + Tiếp theo per activity | **Single Tiếp tục** at bottom (global within lesson shell) |
| “Lưu chiến công” separate section | **Auto-prompt submit** after part 6 OR one “Hoàn thành nhiệm vụ” replacing separate hint |

### 5.3 Story Dock — detailed spec

**Default (collapsed):**
- Story title (1 line)
- First ~120 chars of `paragraphs_en[0]` or current paragraph
- Buttons: `Mở truyện ▼`, `🔊 Nghe cả truyện`
- If task has `source_sentence` / `text_en` / order sentence → **highlight that substring** in dock preview (scroll into view when expanded)

**Expanded (~45% viewport height on mobile):**
- Full `paragraphs_en`
- Existing sentence tap-to-play list (reuse `#sentence-list` data)
- `Thu gọn ▲` — returns to collapsed **without** resetting task state

**Explicitly NOT:**
- Full-screen modal that hides task (unless user chooses on tiny screens — optional phase 2)
- Removing story from DOM when `showActivity(index)` changes

---

## 6. Six activities — kid-facing labels & UX

| # | Type | Kid label | Icon | Pagination | Minny command (example) |
|---|------|-----------|------|------------|-------------------------|
| 1 | `listening_fill_blank` | **Điền từ** | 🔊➕ | 1 item/screen | “Con nghe và chọn từ còn thiếu” |
| 2 | `listen_and_order` | **Xếp câu** | 🧩 | 1 item/screen | “Con bấm từ rồi bấm vào ô” |
| 3 | `reading_comprehension` | **Đọc hiểu** | 📖 | 1 Q/screen (preferred) | “Con chọn đáp án đúng” |
| 4 | `written_response` | **Viết** | ✏️ | 1 Q/screen | “Con viết 1–2 câu tiếng Anh” |
| 5 | `listen_and_speak` | **Nói lại** | 🎤 | 1 item/screen | “Nghe rồi nói lại câu này” |
| 6 | `retell_summary` | **Kể truyện** | 🗣️ | single screen | “Dùng 4 gợi ý, kể bằng tiếng Anh” |

**Part 4 scaffold (written):** optional 3 hint chips from question (`Ai?` / `Làm gì?` / `Kết quả?`) — map from `question_vi` heuristics; not required for W-UX2.

**Part 6 scaffold (shipped `47c8332`):** keep `guide_questions_vi`; add **checklist UI** “Ý 1/4 …” during record prep.

---

## 7. Loop Pack (dopamine — required with W-UX1)

Without this, redesign improves clarity but **not** engagement.

### 7.1 Micro-loop (per item)

```
User succeeds on item
  → 0–300ms: item card ✓ animation + short sfx (existing tier sfx OK)
  → Minny: celebrate flash 0.5s (small avatar)
  → Bubble text: "Hay! Câu tiếp!" (VN)
  → Enable / pulse "Tiếp tục"
```

### 7.2 Meso-loop (per part)

```
Last item in part complete
  → 1.5s interstitial: "Phần 3 xong ⭐"
  → Preview: "Tiếp: Nói lại với Minny" (+ icon)
  → Auto-advance OR single tap Tiếp tục (Felix to choose — see OQ2)
```

### 7.3 Macro-loop (lesson complete)

```
Part 6 complete
  → Existing reward burst + trivia reveal (keep)
  → Replace cold "Lưu chiến công" with "Hoàn thành nhiệm vụ 🎉"
  → Submit + completion card (existing)
```

### 7.4 Failure loop (no red X)

```
Wrong answer (attempt < max)
  → soft boop sfx + Minny encourage
  → bubble: "Thử lại nhé!" — same screen, no shame copy

Mic permission fail
  → Parent strip expands: "Cấp quyền micro trong Safari/Chrome"
  → Link to static help anchor (no external doc required in v1)
```

---

## 8. Minny component spec

### 8.1 States

| State | Visual | When |
|-------|--------|------|
| `idle` | `minny_idle` | Waiting for input |
| `listen` | `minny_listen` | Playing audio / recording |
| `celebrate` | `minny_celebrate` | Item pass / score ≥ 70% |
| `encourage` | `minny_encourage` | Retry / mic error |

### 8.2 Sizes

| Context | Size | Placement |
|---------|------|-----------|
| Parts 1–4 | Small (48–64px) | Command strip beside bubble |
| Parts 5–6 | Large (96–128px) | Above Nghe / Nói buttons |

### 8.3 Bubble rules (from M0, enforced in UI)

- Max 2 short sentences Vietnamese  
- Always **imperative** (“Con bấm…”, “Con nghe…”)  
- Never show raw `%` to child on fail  
- `feedback_vi` from API → bubble after score, not buried in card footer  

### 8.4 Technical debt to address

- Extract Minny hero + bubble from `lesson.astro` → `MinnyCoachStrip.astro` (or shared partial)  
- Single `_r2lSetMinnyMood` + `_r2lSetMinnyBubble(text, { speak?: boolean })`  

---

## 9. Parent strip (no-tech)

Collapsed by default; chevron “Ba mẹ xem hướng dẫn”.

| Field | Example |
|-------|---------|
| Đang làm | “Phần 3/6: Đọc hiểu — chọn đáp án A/B/C” |
| Con cần | “Bấm một đáp án, rồi Tiếp tục” |
| Nếu kẹt | “Micro: Cài đặt → Safari → Micro → Bật cho felixbuilderhub.com” |

Updates on `showActivity` + pagination index change.

---

## 10. Phased implementation

### W-UX1 — Foundation (target: 1 week, hub only)

**Ship:**
- Story Dock (collapsed default, expand/collapse, keep full story + sentence audio)
- Mission chrome: `n/6` + dots (replace or supplement `%` in sticky bar)
- Single **Tiếp tục** CTA; sync with `updateActivityNavButtons` logic
- Loop Pack micro: item ✓ + sfx + bubble “Câu tiếp!” + gate Tiếp tục
- Step rail: disable future steps; allow revisit completed only
- Parent strip (static templates per activity type)

**Files (primary):**
- `src/pages/read2lead/lesson.astro` — refactor regions A–E
- `src/components/read2lead/v2/StoryDock.astro` (new)
- `src/components/read2lead/v2/MissionChrome.astro` (new)
- `src/components/read2lead/v2/ParentStrip.astro` (new)
- `src/components/read2lead/v2/ProgressBar.astro` — dots + `n/6`
- `tests/lesson-v2-six-activity-flow.test.mjs` — update string asserts

**Do NOT in W-UX1:**
- Full pagination (W-UX2)
- New Minny video assets
- Analytics pipeline (stub events OK)

### W-UX2 — Pagination + highlight (2 weeks)

- Parts 1, 2, 5: one item per view; state preserved in existing Maps
- Story Dock: highlight `currentSentenceText` from active item
- Part 3–4: optional 1-Q-per-screen
- Meso-loop interstitial between parts

### W-UX3 — Visual polish (2 weeks)

- Icon set for 6 parts in chrome
- Motion: ✓ checkmark, button pulse, dock expand animation
- Tap-to-place default for order (mobile); drag optional desktop

### W-UX4 — Telemetry (1 week)

Events (Cloudflare / existing analytics hook):
- `lesson_part_view` `{ part, index, pack_id }`
- `lesson_item_complete` `{ part, item_index }`
- `lesson_mic_error` `{ part, error_name }`
- `lesson_submit`

Enables Felix to validate dopamine + drop-off hypotheses.

### W-UX5 — Audio quality (later)

- Server TTS for Minny VN commands (optional)
- Pre-generated `guide_questions_vi` audio per pack

---

## 11. Technical constraints & compatibility

| Constraint | Implication |
|------------|-------------|
| `lesson.astro` monolith | Extract components incrementally; avoid second full rewrite |
| 5-activity packs from API | Keep `ensureSixActivities` + client `ensureLessonActivities` |
| `renderAllActivitiesOnce` | Pagination = show/hide items inside shell OR re-render single-item view — prefer **stateful pager** without destroying recorder state |
| iOS Safari mic | Keep `heardInstruction` unlock on Nghe click (not TTS onend) |
| `speechSynthesis` | Bubble speak is best-effort; don’t gate UX on it |
| Submit API | Still expects 6 `activity_results` types after completion |

---

## 12. Success metrics

| Metric | Baseline (estimate) | Target post W-UX2 |
|--------|---------------------|-------------------|
| Lesson completion rate | unknown — **need W-UX4** | +15% relative |
| Drop-off at part 5→6 | observed support tickets | near zero |
| Time on part 6 first attempt | — | < 3 min median |
| Parent “how to help” messages | qualitative | decrease |
| Child task comprehension (n=10 pilot) | ~55% | ≥80% |

---

## 13. Self-critique summary (5 rounds — incorporated)

1. **Monkey clone wrong** → coaching + story dock, not candy app  
2. **Pagination alone boring** → Loop Pack + mechanic differentiation per part  
3. **Minny everywhere noisy** → small strip 1–4, large 5–6  
4. **Hiding story breaks Krashen** → **Story Dock** (Felix feedback integrated)  
5. **Less friction ≠ loop** → gate Tiếp tục + meso preview between parts  

**Honest verdict:** W-UX1 alone → ~65% understand, ~45% dopamine. W-UX1+2+Loop Pack → ~80% / ~70%. Not Raz-level without W-UX3 motion + audio.

---

## 14. Open questions for Claude reviewer

| ID | Question | Options | Felix preference |
|----|----------|---------|------------------|
| OQ1 | Step rail: tap to revisit completed parts? | A) Yes B) No, linear only | TBD |
| OQ2 | Meso interstitial after each part | A) Auto 1.5s B) Require tap | TBD |
| OQ3 | Part 3–4 pagination in W-UX2 | A) 1Q/screen B) scroll 5Q | A preferred |
| OQ4 | Submit after part 6 | A) Auto B) Confirm modal for parent | B safer |
| OQ5 | Story Dock expanded default on part 6 only? | A) Yes B) Always collapsed | TBD |
| OQ6 | Extract lesson.astro now vs after W-UX1 | A) Extract in W-UX1 B) After | A if reviewer agrees |

---

## 15. Review checklist (for Claude)

Please review and return:

- [ ] **Pedagogy**: Story Dock + pagination still supports re-reading without cognitive overload?  
- [ ] **Child UX**: Is “one bubble command + one CTA” sufficient for ages 7–10?  
- [ ] **Parent UX**: Parent strip copy clear for Vietnamese no-tech parents?  
- [ ] **Dopamine**: Is Loop Pack complete or missing a hook?  
- [ ] **Scope**: Is W-UX1 shippable in 1 week or undersized?  
- [ ] **Minny**: Alignment with `MINNY_M0_DESIGN_OUTCOME.md` voice rules?  
- [ ] **Risks**: `lesson.astro` refactor regression — suggest test additions?  
- [ ] **Conflicts**: Any contradiction with deferred `/read2lead/speaking` hub?  
- [ ] **Answer OQ1–OQ6** with recommendation + rationale  

**Review output format requested:**
1. Approve / approve with changes / reject  
2. Priority-ordered change list (P0/P1/P2)  
3. Answers to OQ1–OQ6  
4. Optional: wireframe deltas (ASCII ok)  

---

## 16. Appendix — current shipped fixes (context)

| Commit | Change |
|--------|--------|
| `c15014b` | Inject `retell_summary` when pack has 5 activities |
| `47c8332` | Guided retell questions (`_read2lead-retell-guide.js`) |
| `ceb16ec` | Nav refresh + retell mic unlock on Nghe |

These are **bugfix layer**; this plan is **structural UX layer** on top.

---

## 17. Appendix — key file map

```
felixbuilderhub/
  src/pages/read2lead/lesson.astro          # monolith — primary touchpoint
  src/components/read2lead/v2/
    ActivityProgress.astro                  # 6 step buttons → refactor target
    ProgressBar.astro                       # % only today
    ListenAndSpeak.astro / RetellSummary.astro
  functions/api/
    read2lead-lesson.js                     # ensureSixActivities
    _read2lead-lesson-activities.js
    _read2lead-retell-guide.js
    read2lead-speaking-check.js
  tests/lesson-v2-six-activity-flow.test.mjs
```

---

*End of plan — version 1.0 draft for Claude review.*
