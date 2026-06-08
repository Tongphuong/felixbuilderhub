> **Hub mirror** — synced from canonical source:
> `D:\Read2lead\read2lead_v0_codex\_claude\MINNY_M0_DESIGN_OUTCOME.md`.
> Edit the Read2Lead copy first; re-sync when M0/M1 docs change.

# Minny M0 — Design Session Outcome

**Session**: M0 design lock  
**Date**: 2026-06-08  
**Status**: ✅ **Complete** — pending Felix sign-off on §4 decisions  
**Canonical path**: `D:\Read2lead\read2lead_v0_codex\_claude\MINNY_M0_DESIGN_OUTCOME.md`  
**Hub mirror**: `D:\felixbuilderhub\docs\MINNY_M0_DESIGN_OUTCOME.md`  
**Parent roadmap**: `MINNY_ROADMAP.md`  
**Executor next**: M1 (memory ingest) **then** M2 (speaking page) — see §10

---

## 1. M0 goal — achieved

| Output | Section | Status |
|---|---|---|
| MSMW visual canon confirmed | §2 | ✅ `minny_ref_final.png` + hub `minny.png` |
| Mood sprite convention | §2 | ✅ Placeholder sprites (same art until Felix exports variants) |
| Persona + voice guidelines | §3 | ✅ |
| Wireframe `/read2lead/speaking` | §5 | ✅ |
| `minny_memory` JSON sketch | §6 | ✅ |
| Privacy & consent matrix | §4 | ✅ M0 defaults — Felix confirms |
| Q1–Q9 resolved | §4 | ✅ Q5/Q6 pre-resolved; Q1–Q4, Q7–Q9 locked with defaults |

**No production code in M0** — M1/M2 specs derive from this doc.

---

## 2. Visual canon & sprites

### 2.1 Character (MSMW canon)

| Field | Value |
|---|---|
| Origin | MSMW *The Lost Toy Brick City* / *Thành Phố Gạch Màu* (`toy_brick_city_v4`) |
| Look | Robot đỏ nhỏ, tròn, màn hình mặt đen bóng, mắt amber |
| Role on speaking page | **Primary UI character** — hero, guide, conversation partner |
| Kid avatar (W5) | Secondary — header corner only; does not replace Minny |

**Felix approved reference**: `MSMW/marketing/seedance_minny/references/minny_ref_final.png`  
**Hub runtime**: `felixbuilderhub/public/assets/minny/minny.png`

### 2.2 Mood sprites (M0 convention)

Until Felix exports distinct poses, **all moods use the same sprite** (`minny.png` copied to mood filenames). CSS may apply subtle scale/glow per state.

| File | UI state | Visual intent (future art) |
|---|---|---|
| `minny_idle.png` | Default / waiting | Neutral smile, eyes amber |
| `minny_listen.png` | Kid recording | Head tilt, “listening” eyes |
| `minny_celebrate.png` | Pass / streak | Small bounce, sparkle |
| `minny_encourage.png` | Retry / gentle nudge | Warm nod, no sad face |

**M2 rule**: Pages load mood file first; fallback chain → `minny_{mood}.png` → `minny.png`.

---

## 3. Persona & voice

### 3.1 Who Minny is

- **Với học sinh**: Bạn robot từ *Thành Phố Gạch Màu* — nhớ truyện con đọc, không chấm điểm đỏ, khích lệ luyện nói như luyện cùng bạn.
- **Với Felix**: Trợ lý tóm tắt — brief 5 bullet, không thay coach trong lớp.
- **Với phụ huynh**: Chỉ thấy aggregate an toàn trên `/hoc-sinh` (§4.3).

### 3.2 Voice rules (align W10 + lesson.astro)

| Rule | Example |
|---|---|
| Luôn xưng **Minny** / **con** (không “em bạn”) | *"Minny nhớ con vừa đọc về dinosaurs!"* |
| **Không** điểm đỏ, không “sai”, không FOMO | *"Chưa đủ 75% — mình thử lại nhé!"* |
| Ngắn, 1–2 câu / lượt phản hồi | Tránh paragraph dài |
| VN primary; EN chỉ khi luyện câu tiếng Anh | Story title EN ok |
| Tone MSMW: ấm, hơi vui, **không** omniscient lạnh | Giống sidekick Rule 6 STYLE_GUIDE_VN |
| Celebrate effort, not rank | *"Con nói rõ hơn lần trước!"* |

### 3.3 Copy templates (M2)

**Greeting (có memory)**:
> Chào {student_name}! Tuần trước con đọc "{story_title}" — hôm nay kể lại 1 phút cho Minny nghe nhé?

**Greeting (chưa có bài)**:
> Chào {student_name}! Minny sẵn sàng luyện nói cùng con. Con chọn kể về điều con thích nhé!

**After pass**:
> Hay lắm! Con mang kỹ năng này vào lớp Felix nhé — Minny đã lưu lại rồi.

**After retry**:
> Không sao — Minny nghe thấy con cố gắng rồi. Thử lại một lần nữa?

---

## 4. Privacy, consent & visibility (Q1–Q9)

### 4.1 Decision table

| # | Question | **M0 decision** | Felix override |
|---|---|---|---|
| Q1 | Raw audio retention | **Transcript + score only**; raw audio deleted within **24h** after Whisper | ☐ |
| Q2 | Parent consent | **Implicit** via Felix issuing access code + Zalo onboarding copy; explicit checkbox on intake **optional M3+** | ☐ |
| Q3 | What Felix sees | **Coach brief only** (5 bullets + trend); no audio replay link in MVP | ☐ |
| Q4 | What parent sees | **Aggregate on `/hoc-sinh`**: *"Con luyện nói 3 lần tuần này"* + last practice date; no transcript | ☐ |
| Q5 | Minny vs kid avatar | **Resolved**: fixed Minny MSMW; kid = W5 later | — |
| Q6 | Route | **Resolved**: `/read2lead/speaking?code=` | — |
| Q7 | LLM for memory | **Rules + templates first** (M1); LLM summary per lesson **optional** if templates feel flat | ☐ |
| Q8 | Class handoff | **Kid self-report**: nút *"Con sẵn sàng cho lớp Felix"* sau practice; sets `ready_for_class_at` | ☐ |
| Q9 | Multi-child | **One `minny_memory` per access_code**; parent switches code on `/hoc-sinh` (W13 deferred) | ☐ |

### 4.2 Consent matrix

| Data | Kid sees | Parent `/hoc-sinh` | Felix coach brief |
|---|---|---|---|
| Lesson topic + story title | ✅ | ✅ (portfolio) | ✅ |
| MCQ / lesson score % | ✅ | ✅ aggregate | ✅ trend |
| W10 in-lesson speaking % | ✅ | ❌ detail | ✅ band (high/med/low) |
| Practice session count / week | ✅ | ✅ aggregate | ✅ |
| Practice transcript | ✅ same session | ❌ | ❌ MVP |
| Raw audio | ❌ after 24h | ❌ | ❌ |
| `ready_for_class` flag | ✅ | ✅ | ✅ |

### 4.3 Parent onboarding line (Zalo / intake)

> Bài luyện nói với Minny được lưu dạng tóm tắt để Felix hỗ trợ con trong lớp. Felix không chia sẻ bản ghi âm với bên thứ ba.

---

## 5. Wireframe — `/read2lead/speaking`

**Route**: `/read2lead/speaking?code={ACCESS_CODE}`  
**Auth**: Same as lesson — valid `READ2LEAD_CODES` KV entry.

**Hub focus — student SPEAKS (output), not read-back.** Sentence-by-sentence read-along stays in Read2Lead lesson W10 only; Minny hub does not duplicate that flow.

### 5.1 Layout (mobile-first)

```
┌─────────────────────────────────────────┐
│ [← Hồ sơ]              [Cấp 1 · 12 xu]  │  ← kid stats strip (reuse r2l state)
├─────────────────────────────────────────┤
│         [ minny_idle.png  large ]       │
│  "Chào Linh! Hôm nay mình luyện nói     │  ← personalized greeting
│   về The Lost Puppy nhé?"               │
├─────────────────────────────────────────┤
│  [ Kể lại truyện ] [ Minny hỏi — con    │  ← two mode tabs (output only)
│    trả lời ]                            │
├─────────────────────────────────────────┤
│  MODE A — Kể lại truyện                 │
│  📖 "The Lost Puppy"                     │
│  Prompt VN + EN (speechSynthesis)       │
│  [ 🔊 Nghe Minny ]                      │
│  [ 🎤 Kể cho Minny nghe ]  (30–60s)     │
│  → optional step 2: "Kể thêm"           │
├─────────────────────────────────────────┤
│  MODE B — Minny hỏi — con trả lời       │
│  Questions from lesson activities       │
│  [ 🔊 Nghe Minny ]  [ 🎤 Trả lời ]      │
│  open check_mode — relevance/effort     │
├─────────────────────────────────────────┤
│  (after record)                         │
│  [ minny_listen.png ]  timer            │
│  (after feedback)                       │
│  [ minny_celebrate | minny_encourage ]  │
│  encouragement only (no red X)          │
│  [ Luyện lại ]  [ Câu tiếp theo ]       │
└─────────────────────────────────────────┘
```

**API**: `GET /api/minny-speaking-context` returns `modes[]` — each mode has `id`, `title_vi`, `subtitle_vi`, `steps[]` with `check_mode: open`.

### 5.2 States

| State | Minny sprite | Primary CTA |
|---|---|---|
| `idle` | `minny_idle` | Bắt đầu luyện |
| `recording` | `minny_listen` | Dừng |
| `scoring` | `minny_listen` | (disabled) |
| `pass` | `minny_celebrate` | Sẵn sàng lớp Felix |
| `retry` | `minny_encourage` | Luyện lại |

### 5.3 Entry points

| From | Link |
|---|---|
| `/hoc-sinh` tile | `/read2lead/speaking?code=` (M2: remove `Sắp ra mắt`) |
| Post-lesson (future) | Optional CTA on lesson complete screen |

### 5.4 Out of scope M2 MVP

- Sentence-by-sentence read-back in hub (W10 in-lesson only)
- Multi-mode library (free talk, deck upload)
- Live Minny TTS voice
- Parent transcript view
- Felix admin UI (M3)

---

## 6. `minny_memory` schema sketch

**Storage**: Nested on existing code KV record `READ2LEAD_CODES/{code}`:

```json
{
  "progress": { "...existing..." },
  "minny_memory": {
    "schema_version": 1,
    "updated_at": "2026-06-08T10:00:00Z",
    "student_display_name": "Linh",
    "preferences": {
      "topics": ["dinosaurs", "school"],
      "pace_hint": "steady"
    },
    "lessons": [
      {
        "pack_id": "pack_abc",
        "story_title": "The Lost Puppy",
        "topic": "animals",
        "level": "L1",
        "completed_at": "2026-06-07T15:30:00Z",
        "score_percent": 88,
        "speaking_band": "high",
        "friction_words": ["because"],
        "minny_note_vi": "Con thích truyện về động vật."
      }
    ],
    "presentation_practice_history": [
      {
        "session_id": "pp_001",
        "mode": "retell_latest_story",
        "pack_id": "pack_abc",
        "started_at": "2026-06-08T09:00:00Z",
        "duration_sec": 62,
        "score_percent": 76,
        "passed": true,
        "ready_for_class_at": "2026-06-08T09:02:00Z",
        "transcript_excerpt": "The puppy was lost..."
      }
    ],
    "rollup": {
      "last_story_pack_id": "pack_abc",
      "last_practice_at": "2026-06-08T09:02:00Z",
      "practices_this_week": 2,
      "speaking_trend": "improving"
    }
  }
}
```

### 6.1 M1 ingest triggers

| Event | Updates |
|---|---|
| `submit-read2lead-lesson` pass | Append `lessons[]`, refresh `rollup`, rules-based `minny_note_vi` |
| W10 scores in lesson | Set `speaking_band` on lesson snapshot |
| M2 practice complete | Append `presentation_practice_history[]`, `rollup` |

### 6.2 M1 hub surface

Single card on `/hoc-sinh` (below hero):

> **Minny nhớ** — *"Tuần trước con đọc The Lost Puppy. Con thử kể lại với Minny nhé!"* → link speaking page.

---

## 7. API reuse (M2)

| Need | Existing |
|---|---|
| Whisper score | `POST /api/read2lead-speaking-check` |
| Student state | `GET /api/read2lead-progress` |
| Save practice | **New** `POST /api/minny-practice-submit` (M2 spec) |
| Load memory | Extend `read2lead-progress` response with `minny_memory` public slice |

**Public slice** (parent/kid safe): `rollup`, last `minny_note_vi`, practice counts — no transcript.

---

## 8. Felix sign-off checklist

- [ ] §4 privacy defaults acceptable (Q1–Q4, Q7–Q9)
- [ ] §3 voice tone matches Felix coaching brand
- [ ] §5 wireframe ok for M2 build
- [ ] §6 schema sufficient for M1
- [ ] Mood sprites: ok with placeholder copies until distinct art
- [ ] **Go M1** or **Go M2** (recommend: **M1 first** — memory before speaking UI)

---

## 9. Doc cross-links

| Doc | Role |
|---|---|
| `MINNY_ROADMAP.md` | Phase 5 master |
| `MINNY_M0_DESIGN_OUTCOME.md` | This file — M0 lock |
| `MINNY_M1_SPEC.md` | **Next write** when Felix says go M1 |
| `MINNY_M2_SPEC.md` | **Next write** when Felix says go M2 |
| `SESSION_HANDOFF.md` | Active NEXT pointer |

---

## 10. Recommended build order

```
M0 ✅ (this doc)
  ↓
M1 — memory ingest + "Minny nhớ" card (~1 session)
  ↓
M2 — /read2lead/speaking MVP, 1 mode (~2 sessions)
  ↓
M3 — Felix coach brief
```

**Rationale**: Speaking page personalization needs `minny_memory`; ship ingest first so M2 launch is not empty.

---

## Glossary

| Term | Meaning |
|---|---|
| `ready_for_class_at` | Kid tapped "Con sẵn sàng lớp Felix" after practice |
| `speaking_band` | `high` / `med` / `low` derived from W10 % — no raw score on parent view |
| Coach brief | Felix-only 5-bullet summary (M3) |
