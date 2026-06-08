# W10 — Speaking Check (Whisper) Spec

**Wave:** W10  
**Status:** Ready to implement  
**Estimated cost per attempt:** ~$0.001 (Groq whisper-large-v3, 30s audio)

---

## Goal

Student records themselves reading a passage aloud → backend transcribes with Whisper → fuzzy word match against expected text → return score + words missed.  
No AI feedback generation needed — use Vietnamese template messages (saves cost, faster).

---

## Architecture decision

**Entirely in Cloudflare Worker** — no Render backend needed.  
CF Worker `read2lead-speaking-check.js` → calls Groq Whisper API directly → returns result.  
Audio is I/O bound; CF Worker paid plan (30s timeout) handles it fine.

New env var needed: `GROQ_API_KEY` (add to Cloudflare dashboard + wrangler secrets).

---

## 1. New file: `functions/api/read2lead-speaking-check.js`

### Request

```
POST /api/read2lead-speaking-check
Content-Type: multipart/form-data

Fields:
  audio          Blob    WebM/OGG/MP4 audio recording (≤ 5MB, ≤ 60s)
  access_code    string  Student access code (e.g. R2L-HOANG-A89Z)
  pack_id        string  Current pack ID
  expected_text  string  Plain text the student was supposed to read (story excerpt or chunk list)
```

### Response (success)

```json
{
  "ok": true,
  "transcript": "the boy run fast in the park",
  "score_percent": 78,
  "correct_count": 7,
  "total_count": 9,
  "words_missed": ["ran", "quickly"],
  "words_close": ["fast"],
  "feedback_vi": "Giỏi lắm! Con đọc được hầu hết các từ rồi!"
}
```

### Response (error)

```json
{
  "ok": false,
  "error": "transcription_failed",
  "message": "Không nghe được rõ. Con thử đọc to hơn nhé!"
}
```

---

## 2. Logic

### Step 1 — Validate

- `access_code` exists in KV (same pattern as other endpoints)
- `pack_id` matches `current_pack.pack_id`
- Audio size ≤ 5MB; reject early with message if too large
- Rate limit: reuse `checkCodeRateLimit` from `_rate-limit.js`
- Honeypot: check `data.website` field

### Step 2 — Transcribe via Groq

```js
const formData = new FormData();
formData.append('file', audioBlob, 'audio.webm');
formData.append('model', 'whisper-large-v3');
formData.append('language', 'en');
formData.append('response_format', 'json');

const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
  body: formData,
});
```

If Groq fails (non-200), return `transcription_failed` error. Do NOT fallback to OpenAI — just ask student to retry.

### Step 3 — Fuzzy word match

```js
function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z]/g, '');
}

function wordSimilarity(a, b) {
  // Jaro-Winkler or simple: count matching chars / max length
  // Return 0.0–1.0
}

const SIMILARITY_THRESHOLD = 0.75;
const SKIP_WORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at']);
```

**Matching algorithm:**
1. Tokenize `expected_text` into words, filter out `SKIP_WORDS`
2. Tokenize `transcript` into words
3. For each expected word, find best match in transcript (greedy left-to-right)
4. If similarity ≥ 0.75 → `correct`; 0.5–0.75 → `close`; < 0.5 → `missed`
5. `correct_count` = correct + close (close counts as correct for score)
6. `score_percent` = round(correct_count / total_count × 100)

### Step 4 — Template feedback (Vietnamese)

```js
function feedbackVi(scorePercent) {
  if (scorePercent >= 90) return 'Tuyệt vời! Con đọc cực kỳ rõ ràng!';
  if (scorePercent >= 70) return 'Giỏi lắm! Con đọc được hầu hết các từ rồi!';
  if (scorePercent >= 50) return 'Cố lên! Con đang tiến bộ rất tốt!';
  return 'Không sao, thử lại nào! Đọc to hơn một chút nhé!';
}
```

No Claude/AI call for feedback — template is sufficient and saves cost.

---

## 3. Frontend changes

### Where to add

Lesson flow page — after the student reads a passage (story excerpt or chunk practice section), show a recording widget.

File to edit: `src/pages/read2lead/lesson.astro` (or wherever the lesson flow lives).

### Recording widget behavior

```
[🎤 Đọc to] button
  → click → start MediaRecorder (WebM preferred, MP4 fallback for iOS)
  → show recording indicator + 30s countdown
  → click again OR timeout → stop recording
  → POST to /api/read2lead-speaking-check
  → show result card:
     ✅ words correct (green)
     ⚠️  words close (yellow)  
     ❌ words missed (shown but with gentle framing: "Luyện thêm: ...")
     feedback_vi message
     [Thử lại] button (does NOT block lesson progress)
```

**Critical UX rule:** Speaking check is **optional bonus** — never block lesson completion. Student can skip or retry. Score from speaking does contribute to `activity_results` if attempted.

### Activity result shape to include in submit payload

```json
{
  "type": "speaking",
  "attempted": true,
  "correct_count": 7,
  "total_count": 9,
  "wrong_count": 2,
  "score_percent": 78
}
```

The existing `scoreActivityResults()` in `submit-read2lead-lesson.js` handles this automatically — no changes needed there.

---

## 4. Pack schema — no changes needed

Speaking activity always uses `story.text` as `expected_text`.  
No pack generator changes required for W10.

If pack has `activities` with `type: "speaking"`, it uses that activity's text. Otherwise, frontend uses `story.text` by default.

---

## 5. New env var

Add to Cloudflare Pages dashboard (Settings → Environment Variables):
```
GROQ_API_KEY = <get from console.groq.com>
```

Also add to local `.dev.vars` for development.

---

## 6. Tests to write: `tests/read2lead-speaking.test.mjs`

```js
// Mock Groq API responses
test('exact match → 100%')
test('mispronounced words within threshold → counted correct')
test('completely wrong words → counted missed')
test('skip words (the, a, is) not penalized')
test('empty transcript → transcription_failed error')
test('audio too large → 413 rejected before calling Groq')
test('invalid access_code → 404')
test('score_percent thresholds → correct feedback_vi string')
```

---

## 7. Files to create/edit

| File | Action |
|---|---|
| `functions/api/read2lead-speaking-check.js` | **Create** — new endpoint |
| `src/pages/read2lead/lesson.astro` (or equivalent) | **Edit** — add recording widget |
| `tests/read2lead-speaking.test.mjs` | **Create** — unit tests |
| `.dev.vars` | **Edit** — add `GROQ_API_KEY=...` |
| `SESSION_HANDOFF.md` | **Update** after implementation |
| `PROGRESS_LOG.md` | **Append** after implementation |

---

## 8. What NOT to build in W10

- No AI-generated feedback (template only)
- No storing audio recordings
- No phoneme-level breakdown (too complex, too expensive)
- No mandatory pass/fail for speaking (always optional)
- No changes to pack generator
- No changes to `submit-read2lead-lesson.js`

---

## Verify checklist (Cursor chạy trước khi báo done)

- [ ] `node --test tests/read2lead-speaking.test.mjs` — all pass
- [ ] `node --test` (full suite, 87+ tests) — no regression
- [ ] Manual test: record audio in browser → result shows in UI
- [ ] Manual test: skip speaking → lesson still submittable
- [ ] `curl` health-v2 → tts_voice nova still present
