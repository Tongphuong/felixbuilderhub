# V5 Track A — Speaking quality + feedback (kid học thật)

**Goal:** Kid đọc bài → ASR chấm chi tiết → kid hiểu sai chỗ nào → retry hiệu quả. KHÔNG cày qua lessons để farm xu.
**Owner:** Codex monolith · **Branch:** `codex/v5-track-a-speaking-quality` (off latest origin/main)
**Status:** READY — Phương ack 2026-06-16
**Estimated:** 8-12h Codex
**Principle:** GitHub-first, OSS reuse. NO scratch ASR. NO data/security focus.

---

## 1. 4 features

### F1. Phoneme/word-level feedback
- Server `read2lead-speaking-check.js` đã trả về word-by-word similarity. Client KHÔNG dùng đầy đủ.
- UI: highlight từ sai màu đỏ + tooltip "Con đọc 'monter', cần 'monster'"
- Toggle "Nghe lại từ này" → TTS từ đó (browser SpeechSynthesis fallback nếu R2 không có)

### F2. Intonation visual (waveform overlay)
- Use **wavesurfer.js** (BSD-3, ~50KB gz, lazy-loaded)
- Native voice waveform top + kid voice waveform bottom (cùng axis time)
- Kid thấy "rhythm gap" (em nói ngắn quá / dài quá / nghỉ chỗ sai)
- Required credit: 1 line in `/credits` page (kid không cần đọc)

### F3. Replay slow-down
- Use **howler.js** (MIT, ~8KB gz, đã có thể là dep) — variable rate playback
- Kid bấm `0.5x / 0.75x / 1.0x` → native audio play slower NO pitch shift (Howler default)
- Auto-replay sau retry attempt

### F4. Learning quality metrics
- Backend track per pack:
  - `first_try_pass_rate`: % bài qua lần đầu
  - `avg_retry_count`: trung bình retry/pack
  - `time_to_pass_ms`: ms từ start pack đến pass
  - `attention_score`: 100 - (% time without audio/speak event)
- Parent dashboard: 7-day rolling average + alert nếu kid `attention_score < 50` (có thể cày)
- Anti-cheat detection: flag pack nếu kid spent < 30s + score >= 50% (suspect button mashing)

---

## 2. Files allowed

### Server
- `functions/api/read2lead-speaking-check.js` — extend response với word-level diff (đã có data, expose thêm)
- `functions/api/submit-read2lead-lesson.js` — track per-pack metrics + write to state
- `functions/api/_read2lead-v2-state.js` — add `state.learning_metrics: { packs_history: [...], 7day_summary: {...} }`

### Client — Lesson
- `src/pages/read2lead/lesson.astro` — UI phoneme highlight + replay button + waveform mount target
- `src/scripts/r2l-feedback-visual.js` (NEW) — wavesurfer initialization, lazy import từ CDN
- `src/scripts/r2l-replay-control.js` (NEW) — howler.js variable rate playback

### Client — Parent
- `src/pages/phu-huynh/[code].astro` — add 7-day learning quality card + chart
- `src/lib/learning-metrics.ts` (NEW) — calc helpers (first-try rate, attention score)

### Tests
- `tests/read2lead-speaking-feedback.test.mjs` (NEW) — word-level response shape
- `tests/learning-metrics.test.mjs` (NEW) — calc correctness + edge cases
- `tests/anti-cheat-detection.test.mjs` (NEW) — suspect pack flagging

### Credits
- `/credits` page — add wavesurfer.js BSD-3 attribution line

### CẤM (NO touch)
- Recorder engine `src/scripts/r2l-recorder*.js`
- ASR backend Whisper integration (chỉ extend response shape)
- W2 quest/chest, W5/W6 cosmetic, leaderboard, mic engine
- Shop logic (Track B handle)

---

## 3. OSS dependencies (per research-outbox 2026-06-14)

| Lib | npm | License | Bundle | CF Workers compat | Credit |
|---|---|---|---|---|---|
| wavesurfer.js | `wavesurfer.js` | BSD-3 | ~50KB gz lazy | N/A (browser-only) | YES (1-line credits page) |
| howler.js | `howler` | MIT | ~8KB gz | N/A (browser-only) | NO |

**Bundle delta:** ~58KB gz total (within 150KB budget).
**No new server-side deps.** All client-only, lazy-loaded on lesson page enter.

---

## 4. State schema (additive)

```js
state.learning_metrics = {
  packs_history: [
    {
      pack_id: '...',
      started_at: ISO,
      passed_at: ISO,
      score: 0.78,
      retry_count: 2,
      attention_score: 87,
      time_to_pass_ms: 124000,
      suspect: false,
    }
  ],
  '7day_summary': {
    first_try_pass_rate: 0.62,
    avg_retry_count: 1.8,
    avg_attention_score: 81,
    suspect_count: 0,
    calculated_at: ISO,
  }
}
```

`schema_version` stays 2 (additive). Migration: missing `learning_metrics` → default empty object.

---

## 5. Pass criteria

- F1: wrong-word highlight visible + tap-to-replay works
- F2: dual-waveform render cho ≥3 sample stories without lag (mobile cheap Android)
- F3: 0.5x replay không pitch shift, kid bấm chuyển rate < 200ms latency
- F4: parent dashboard shows 7-day card + 1 sample pack flagged suspect
- Bundle delta < 150KB gz
- Lesson page mobile fps > 30 with waveform mounted
- Tests ≥18 new total
- Full suite stays green
- VN-only kid UI, parent UI VN
- `prefers-reduced-motion` honored (waveform static, no scroll animation)
- Visual screenshot per F1/F2/F3 trên 3 monster sample MUST be in PR description
- A11y: tooltip word feedback có aria-label

---

## 6. Decision gates (Codex default per em recommend)

| G | Question | Default |
|---|---|---|
| 1 | TTS từng từ — server-side R2 cache vs browser SpeechSynthesis | Browser (free, no R2 cost) |
| 2 | Wavesurfer plugins — minimal hay full timeline plugin? | Minimal (smaller) |
| 3 | Retry counter persist trong KV hay session-only? | KV (track across session) |
| 4 | Attention score formula — heuristic config trong code hay env var? | Code constant (simpler) |
| 5 | Suspect pack threshold (time < 30s + score >= 50%)? | Spec default |

---

## 7. Hard constraints

- GitHub-first reuse — wavesurfer + howler từ npm/CDN, NO scratch waveform/audio code
- No new dep beyond 2 libs above
- Tests green
- Commit msgs end `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- DO NOT --no-verify
- DO NOT touch CẤM files
- Branch push only — Verify-Claude audit → merge bundle

---

## 8. Out of scope (defer V5 Track B or later)

- Shadowing exercise (HIGH effort per research)
- Listen-and-produce activity
- Dictation (Deputy 2 đã ship separate)
- Pet/wings cosmetic (Track B)
- W7 effects/frame replacement (Track B)
- Mobile native app
- Multi-user collaboration
