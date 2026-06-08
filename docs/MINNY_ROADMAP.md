# Minny Learning Companion — Roadmap (Phase 5)

**Doc type**: PRD (product vision) + design brief — no code in this doc.
**Date**: 2026-06-08 (revised 2026-06-08 — speaking page + MSMW canon)
**Author**: Cursor (from Felix design session brief)
**Executor**: Codex / Cursor (per sub-phase after Felix approves design)
**Audience**: Felix (PM), Claude (spec), Codex (build). Read after `V2_PIVOT_ROADMAP.md`.
**Status**: **M0 complete** — Felix sign-off §8 in `MINNY_M0_DESIGN_OUTCOME.md`; next **M1** (recommended) or M2.

**Canonical path (Claude + Codex)**: `D:\Read2lead\read2lead_v0_codex\_claude\MINNY_ROADMAP.md`  
**Hub mirror**: `D:\felixbuilderhub\docs\MINNY_ROADMAP.md` (synced copy for hub-first workflows)

### Phase status

| Phase | Status | Notes |
|---|---|---|
| **M0** Design session | ✅ Complete | `MINNY_M0_DESIGN_OUTCOME.md` — Felix sign-off pending |
| **M1** MVP memory | ⬜ Not started | Post-lesson `minny_memory` ingest |
| **M2** Presentation practice | ⬜ Not started | Ship `/read2lead/speaking` — Minny primary UI |
| **M3** Felix assistant | ⬜ Not started | Coach brief; align W13 if resumed |

### Table of contents

1. [TL;DR & canon](#0-tldr) — MSMW character, brand loop, speaking page, assets
2. [Vision & role](#1-vision--role)
3. [Data Minny remembers](#2-data-minny-remembers-per-student)
4. [User flows](#3-user-flows)
5. [Placeholders & wave dependencies](#4-relationship-to-existing-placeholders--waves)
6. [Phased delivery M0–M3](#5-phased-delivery)
7. [Dependencies](#6-dependencies)
8. [Open design questions](#7-open-design-questions-for-m0-session)
9. [Success metrics](#8-success-metrics-pilot)
10. [Doc cross-links](#9-doc-cross-links)
11. [Next actions](#10-next-actions)

---

## 0. TL;DR

**Minny** là bạn học cá nhân (learning companion) — biết mọi thứ về từng học sinh, nhớ từng bài đọc Read2Lead, sở thích, điểm nói, và lịch luyện thuyết trình. Minny hỗ trợ **Felix (coach)** chứ không thay Felix; học sinh luyện nói/thuyết trình với Minny trước, rồi mang kỹ năng vào lớp coaching thật.

**English label**: Minny Learning Companion — persistent student memory + speaking practice + coach assistant.

**Placement in roadmap**: **Phase 5** (post W1–W13 hoàn thiện). Không chặn pilot W11; chạy song song sau khi Felix chốt design session.

### 0.1 Canon — Minny is NOT a new mascot

Minny **không phải** mascot generic mới cho Read2Lead. Minny là **nhân vật đã có** trong thế giới truyện MSMW của Felix:

| Field | Value |
|---|---|
| Story (EN) | **The Lost Toy Brick City** |
| Story (VI) | **Thành Phố Gạch Màu** |
| Template | Toy Brick City v4 (20 trang, MSMW active workflow) |
| Story ID | `toy_brick_city_v4` |
| Role in story | Robot bạn đồng hành — bé giải cứu thành phố gạch cùng Minny; thông điệp: *học không bỏ rơi bạn bè* |
| Hub MSMW page | `felixbuilderhub/src/pages/msmw.astro` — hook: *"Bé giải cứu thành phố cùng robot Minny"* |
| MSMW style canon | `MSMW/templates/STYLE_GUIDE_VN.md` Rule 7 — cast = child + mascot (Minny cho Toy Brick City) |
| Visual canon | Robot đỏ nhỏ, tròn, màn hình mặt đen bóng, mắt amber — xem `MSMW/marketing/seedance_minny/` |

Read2Lead đã dùng **giọng Minny** trong lesson UI (`lesson.astro`, W10 feedback). Phase 5 mở rộng: memory + **Luyện nói riêng** + coach brief — cùng một nhân vật, không tạo “Minny 2”.

### 0.2 Brand continuity — MSMW ↔ Read2Lead ↔ Coaching

```
MSMW (Felix gift storybook)          Read2Lead (daily learning)           Felix Coaching (live class)
────────────────────────────         ────────────────────────────         ─────────────────────────────
Lost Toy Brick City                  Minny companion voice + memory       Felix coach brief từ Minny
Bé là hero, Minny là robot bạn       Bài đọc → Minny nhớ → luyện nói     Con áp dụng kỹ năng đã luyện
Quà cá nhân hoá (ảnh con)            /hoc-sinh → /read2lead/speaking      Buổi coaching thật (Zoom/lớp)
```

**English**: One character threads three products — story world (MSMW), practice companion (Read2Lead), and coach handoff (Felix class). Parents who bought Toy Brick City should recognize the same Minny when kid opens Read2Lead.

### 0.4 Speaking practice page — Minny is the primary UI character

**Canonical route**: `/read2lead/speaking?code={access_code}` (hub page, ships in **M2**).

Minny is **not** a decorative icon on this page. She is the **primary UI character** — hero, guide, and conversation partner for every speaking session:

| UI role | Behavior |
|---|---|
| **Hero** | Minny sprite + greeting dominate the page header; kid avatar (W5) stays secondary |
| **Guide** | Minny proposes practice modes, explains next step, celebrates retries |
| **Conversation partner** | Kid practices presentation/speaking **with** Minny (listen → respond → encourage) |

**Entry**: `/hoc-sinh` tile **Luyện nói riêng** (`Sắp ra mắt` today) → links to `/read2lead/speaking` when M2 ships.

**Personalization**: Minny reads `minny_memory` (Read2Lead lessons, `packs_history`, W10 scores, intake preferences) to tailor prompts — e.g. *"Tuần trước con đọc về dinosaurs — hôm nay kể lại 1 phút nhé?"*

**Handoff**: After practice, kid returns to **Felix coaching class** (`/coaching`) to apply skills live; Felix sees M3 coach brief, not raw chat.

### 0.3 Assets — reference imported, mood sprites pending

Felix **đã lưu ảnh thiết kế Minny** (approved character reference). Import một phần — 2026-06-08.

| Layer | Path (convention) | Status |
|---|---|---|
| **MSMW source of truth** | `D:\MSMW\marketing\seedance_minny\references\minny_ref_final.png` (~1.7 MB) | ✅ **Imported** (Felix local; MSMW folder not git) |
| **MSMW marketing docs** | `D:\MSMW\marketing\seedance_minny\` (prompts, storyboard, QA) | ✅ In repo |
| **Hub deploy (runtime)** | `D:\felixbuilderhub\public\assets\minny\minny.png` (~228 KB) | ✅ Committed hub `b0e08b4` (2026-06-08) |
| **Hub asset README** | `D:\felixbuilderhub\public\assets\minny\README.md` | ✅ Sprite conventions + mood set plan |
| **Suggested sprite set** | `minny_idle.png`, `minny_listen.png`, `minny_celebrate.png`, `minny_encourage.png` | ✅ **Placeholder** (copies of `minny.png`); distinct art optional later |
| **Story thumb (existing)** | `felixbuilderhub/public/msmw/thumb-toy-brick.jpg` | Referenced in `msmw.astro`; separate from Minny character sheet |

**W5 avatar dependency (partial unblock)**: W5 vẫn **blocked** cho *kid avatar presets* (5 SVG + gender pick). Nhưng **Minny character art đã sẵn** từ MSMW — M2 **Luyện nói riêng** và polish lesson Minny face **không cần chờ** full W5 kid-avatar pack. W8 shop items = cosmetics cho *kid avatar*, không phải Minny.

**M0 action**: Mood sprites shipped as placeholders (same art as `minny.png`). Felix may export distinct poses later without blocking M2.

---

## 1. Vision & role

### 1.1 Companion, not replacement

| Vai trò | Tiếng Việt | English |
|---|---|---|
| Với học sinh | Bạn đồng hành ấm áp, nhớ tên, sở thích, truyện đã đọc; khích lệ luyện nói không áp lực | Warm peer who remembers context and encourages practice |
| Với Felix | Trợ lý tóm tắt — Felix thấy snapshot trước buổi coaching, không phải đọc từng log | Coach prep assistant — briefing, not full surveillance |
| Với phụ huynh | Minh bạch theo consent — chỉ thấy phần Felix cho phép trên dashboard | Transparent, consent-gated parent view |

### 1.2 Core goals (Felix brief)

1. **Minny knows everything about each student** — longitudinal memory per `access_code` / kid profile.
2. **Stores info from each reading lesson** — topic, story, activity outcomes, preferences, personalization signals.
3. **Acts as assistant for Felix** — pre-session brief, practice gaps, suggested coaching focus.
4. **Presentation / speaking practice loop** — practice with Minny → apply in real coaching class.

### 1.3 Product principles (inherit V2 + Minny-specific)

- Giữ tone V2: không “sai/đỏ”, không FOMO, không leaderboard áp lực.
- Minny **không chấm điểm high-stakes** cho lớp Felix — luyện tập an toàn; Felix chấm trong coaching.
- Memory phục vụ **cá nhân hoá** (bài đọc, chủ đề, nhịp nói), không phục vụ quảng cáo hay bán dữ liệu.
- Whisper/W10 feedback trong bài vẫn là **in-lesson**; Minny practice là **ngoài bài** (xem §5.2).

---

## 2. Data Minny remembers (per student)

Stored under existing KV identity (`progress:{access_code}`) **plus** new `minny_memory` namespace or nested object — **exact schema = design session output**.

### 2.1 Reading & lesson memory

| Field group | Examples | Source |
|---|---|---|
| Per-lesson snapshot | `pack_id`, `topic`, `story.title`, `level`, `completed_at` | `submit-read2lead-lesson`, `packs_history` |
| Activity signals | MCQ accuracy bands, listen_and_speak Whisper scores (W10), open-question themes | Lesson telemetry |
| Preferences | Topics kid picks at intake, gender/pronoun, interests tags, pace (sessions/week) | Intake form + behavior |
| Personalization | Story hooks that resonated, vocabulary friction words, self-rate “Khó” items | Derived summaries |

### 2.2 Speaking & presentation practice history

| Field group | Examples | Source |
|---|---|---|
| Practice sessions | Date, duration, mode (read-aloud / free talk / presentation script) | Minny practice UI |
| Prompts used | Felix-assigned deck vs kid-chosen topic | Coach config |
| Scores & feedback | Whisper %, Minny encouragement lines, retry count | W10 pipeline reuse |
| Presentation artifacts | Optional transcript summary, “ready for class” self-flag | Kid + Minny |

### 2.3 Coach-facing rollup (Felix assistant)

| Artifact | Purpose |
|---|---|
| **Pre-session brief** | 5-bullet: last 3 stories, speaking trend, 1 suggested focus |
| **Practice gap flags** | e.g. “chưa luyện presentation tuần này” |
| **Parent-safe excerpt** | Subset for `/hoc-sinh` if parent consent allows |

---

## 3. User flows

### 3.1 Flow A — Personalized reading (Read2Lead → Minny remembers)

```
Phụ huynh tạo bài → Con làm 5 nhiệm vụ trên /read2lead/lesson
        ↓
KV cập nhật packs_history + W10 speaking scores
        ↓
Minny memory job (async): tóm tắt bài + cập nhật sở thích
        ↓
Lần sau: gợi ý chủ đề / lời chào Minny nhắc truyện trước
```

**English**: Every completed lesson feeds Minny's long-term student model; next touchpoints feel continuous.

### 3.2 Flow B — Presentation practice with Minny → apply in coaching class

```
/hoc-sinh → tile "Luyện nói riêng" (Minny icon)
        ↓
/read2lead/speaking?code= — Minny hero + guide (primary UI character)
        ↓
Minny loads minny_memory → gợi ý mode cá nhân (kể truyện / script / thuyết trình 1 phút)
        ↓
Thu âm → Whisper (reuse W10) → Minny phản hồi ấm, không điểm đỏ
        ↓
Lưu session vào presentation_practice_history
        ↓
Felix dashboard (M3): brief trước buổi coaching — "con đã luyện X, thử Y trong lớp"
        ↓
/coaching — buổi học thật: con áp dụng kỹ năng; Felix dùng brief, không đọc raw audio
```

**English**: Safe rehearsal loop on `/read2lead/speaking` with Minny as face of the experience; coach sees synthesis; student applies live in Felix coaching class.

### 3.3 Flow C — Felix assistant (async, not live bot in class)

- **Not in scope MVP**: Minny live trong Zoom/coaching call.
- **In scope**: Felix mở admin hoặc coach view → đọc brief, gợi ý câu hỏi mở, nhắc bài đọc liên quan.
- Future: Telegram/email digest cho Felix (align W13 email digest nếu mở rộng).

---

## 4. Relationship to existing placeholders & waves

| Existing item | Location / wave | How Minny relates |
|---|---|---|
| **Luyện nói riêng** | `/hoc-sinh` tile — `Sắp ra mắt` → **`/read2lead/speaking`** | **Discovery entry** for Flow B; **Minny là nhân vật chính** trên speaking page (hero, guide, conversation partner) — MSMW canon, không mascot generic |
| **Speaking practice page** | `/read2lead/speaking` (M2) | **Primary surface** for Flow B — Minny-led UX; uses `minny_memory` for personalized prompts |
| **Felix Coaching** | `/coaching` | **Apply loop** — kid practices with Minny first, then uses skills in live coaching class |
| **W10 Whisper** | In-lesson `listen_and_speak` + open bonus | **Reuse scoring pipeline** (`read2lead-speaking-check.js`); Minny practice = same API, different UX shell |
| **W5 Avatar** | Preset SVG + header (kid) | **Partially unblocked for Minny only** — Felix design images ready (`§0.3`); kid avatar presets vẫn chờ W5 SVG. Minny ≠ kid avatar — hai layer riêng |
| **W8 Avatar shop** | Kid cosmetics | **Out of scope for Minny** — shop = kid hat/shirt/pet; Minny stays fixed MSMW character |
| **W13 Multi-child** | Deferred parent dashboard | Minny memory is **per access_code**; W13 multi-child = parent sees multiple kids' Minny rollups |
| **W6 Story portfolio** | `/hoc-sinh` truyện đã học | Minny references same `storyProgress` for “kể lại truyện cũ” prompts |
| **W9 Weekly growth** | Profile 6-column chart | Speaking practice minutes could join growth chart later (optional M3+) |

**Dependency order (soft)**:

```
W10 ✅ → M1 memory can ingest speaking scores
W6 ✅ → M2 prompts can reference story portfolio
W5 kid avatars (blocked) → does NOT block Minny sprites (Felix art ready — §0.3)
W8 kid shop (blocked) → independent of Minny companion face
W13 (deferred) → M3 Felix dashboard may share parent shell
```

---

## 5. Phased delivery

> Sub-phases **M0–M3**. Each needs Felix approval before Codex execution spec (same pattern as `V2_WAVE_N_SPEC.md`).

### M0 — Design session ✅

**Goal**: Lock scope, privacy, UX wireframes, data contract sketch.

**Outcome doc**: `_claude/MINNY_M0_DESIGN_OUTCOME.md` (hub mirror: `felixbuilderhub/docs/MINNY_M0_DESIGN_OUTCOME.md`)

**Delivered**:
- MSMW visual canon + mood sprite placeholders in hub `public/assets/minny/`
- Persona + voice guidelines (§3)
- Wireframe `/read2lead/speaking` (§5)
- `minny_memory` JSON sketch (§6)
- Privacy & consent matrix — Q1–Q9 defaults (§4)
- Felix sign-off checklist (§8)

---

### M1 — MVP memory (ingest only)

**Goal**: After each lesson submit, Minny memory updates; kid sees 1 personalized line on next `/hoc-sinh` visit.

**Scope**:
- Extend KV or nested `minny_memory` on progress record
- Worker: post-submit summarizer (rules-based first; LLM optional)
- Hub: single “Minny nhớ” card on profile — last story + encouragement
- Tests: memory round-trip per `access_code`

**Out of scope**: New practice UI, Felix dashboard.

---

### M2 — Presentation practice MVP

**Goal**: Ship **Luyện nói riêng** — at least one practice mode with record → Whisper → save history.

**Scope**:
- Activate `/hoc-sinh` tile → link `/read2lead/speaking?code=` (remove `Sắp ra mắt`)
- New page `src/pages/read2lead/speaking.astro` — Minny as **primary UI character** (hero + guide + conversation partner)
- Load `minny_memory` for personalized mode/prompt suggestions
- 1 practice mode (recommend: **kể lại truyện gần nhất** from W6 portfolio)
- Reuse W10 API; Minny copy layer (no red X)
- Append `presentation_practice_history[]`
- Kid-visible: “Đã luyện hôm nay” streak optional (ethical — no crying owl)

**Out of scope**: Full presentation deck builder, multi-mode library.

---

### M3 — Felix assistant integration

**Goal**: Felix sees coach brief before session; optional parent-safe excerpt.

**Scope**:
- Coach view (admin-gated or Felix-only route) — per-student brief
- Aggregates M1 memory + M2 practice history + W9 weekly trend
- Export: copy brief / future Telegram hook
- Align with W13 if parent multi-child dashboard resumes

**Out of scope**: Auto-scheduling coaching, Minny in live video.

---

## 6. Dependencies

| Dependency | Owner | Blocks |
|---|---|---|
| W10 Whisper API stable | Hub ✅ `24ed49f` | M2 scoring |
| `packs_history` + story portfolio | Hub W6 ✅ | M1/M2 prompts |
| GROQ_API_KEY on Cloudflare | Felix ops | M2 live |
| Minny sprite / voice copy | Felix + MSMW refs | M0/M2 UX quality — **reference imported**; mood sprites (`idle`, `listen`, `celebrate`, `encourage`) still pending |
| W5 kid avatar SVGs | Felix assets | Blocks kid header avatar only — **not** Minny companion sprites |
| W13 parent shell | Deferred | M3 parent-facing slice |
| LLM summarizer budget | Felix decision | M1 if rules-based insufficient |

---

## 7. Open design questions (for M0 session)

| # | Question | Options |
|---|---|---|
| Q1 | **Privacy / retention** | How long is raw audio kept? Transcript only? Delete after 30d? |
| Q2 | **Parent consent** | Opt-in at code creation? Checkbox on intake form? Kid under 13 VN context? |
| Q3 | **What Felix sees** | Brief only vs full practice log vs audio replay link |
| Q4 | **What parent sees on `/hoc-sinh`** | Nothing new vs “con đã luyện nói 3 lần tuần này” aggregate |
| Q5 | **Minny vs kid avatar (W5)** | **Resolved (canon)**: separate — Minny = fixed MSMW robot; kid = W5 preset avatar. Same warm storybook palette, different characters |
| Q6 | **Route** | **Resolved (canon)**: `/read2lead/speaking?code=` — aligns with `/read2lead/lesson`, `/read2lead/review`; `/hoc-sinh` tile = discovery only |
| Q7 | **LLM for memory** | Rules + templates first vs Sonnet summary per lesson (~$) |
| Q8 | **Coaching class handoff** | Kid self-reports “sẵn sàng” vs Felix assigns practice homework |
| Q9 | **Multi-child (W13)** | One Minny memory per code — parent switches code vs unified family view |

---

## 8. Success metrics (pilot)

| Metric | Target (first 8 weeks post-M2) |
|---|---|
| Practice uptake | ≥30% coaching students use Luyện nói riêng ≥1×/week |
| Lesson → memory | 100% completed lessons produce Minny card update |
| Felix utility | Felix rates brief “useful” ≥4/5 in 5 consecutive sessions |
| Safety | Zero parent complaints re: hidden recording; consent documented |

---

## 9. Doc cross-links

| Doc | Role |
|---|---|
| `V2_PIVOT_ROADMAP.md` §10 | W1–W13 master waves — Minny = Phase 5 after hoàn thiện |
| `SESSION_HANDOFF.md` | Active session NEXT — includes M0 scheduling |
| `PROGRESS_LOG.md` | Append-only status when M0/M1 start |
| Hub `src/pages/hoc-sinh/index.astro` | Luyện nói riêng tile — M2 discovery entry → `/read2lead/speaking` |
| Hub `src/pages/read2lead/speaking.astro` | **M2 target** — Minny primary UI character (not built yet) |
| Hub `src/pages/coaching.astro` | Felix coaching — apply loop after Minny practice |
| Hub `functions/api/read2lead-speaking-check.js` | W10 — M2 reuse |
| Hub `src/pages/msmw.astro` | MSMW story catalog — Toy Brick City + Minny hook |
| `MSMW/marketing/seedance_minny/` | Minny visual canon, prompts, reference image convention |
| `felixbuilderhub/public/assets/minny/minny.png` | Hub runtime reference sprite (`b0e08b4`) |
| `felixbuilderhub/public/assets/minny/README.md` | Mood sprite plan + usage |
| `felixbuilderhub/docs/MINNY_ROADMAP.md` | Hub mirror of this file (Codex hub-first) |
| `felixbuilderhub/README.md` | Sister-repo pointer to this file |

---

## 10. Next actions

1. **Felix signs off** `MINNY_M0_DESIGN_OUTCOME.md` §8 (privacy defaults, wireframe).
2. **Write `MINNY_M1_SPEC.md`** when Felix says go M1 (recommended before M2).
3. **W11 trivia reveal** remains independent — can ship in parallel.

---

## Glossary

| Term | Meaning |
|---|---|
| Minny | MSMW *Lost Toy Brick City* robot mascot → Read2Lead learning companion (memory + practice shell) |
| Lost Toy Brick City | MSMW story `toy_brick_city_v4` — Minny's origin story |
| Brand loop | MSMW story → Read2Lead practice → Felix coaching class |
| M0–M3 | Minny sub-phases (design → memory → practice → Felix assistant) |
| Luyện nói riêng | Speaking practice — `/hoc-sinh` tile today (`Sắp ra mắt`); M2 ships `/read2lead/speaking` with Minny as primary character |
| `/read2lead/speaking` | Canonical speaking practice page — Minny hero, guide, conversation partner |
| Coach brief | Felix-facing summary — not full student chat log |
| Memory ingest | Post-lesson job writing `minny_memory` |
