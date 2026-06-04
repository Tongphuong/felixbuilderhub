# Plan V5 — Dictation + Shadowing Missions + Inline Feedback (for Codex execution)

**Brain**: Claude (Phương — Felix)
**Executor**: Codex CLI
**Context**: Phương test V3+V4 production OK nhưng pivot V4 → V5. Bỏ V4 chunk listen+record trong Power Chunks card; thay bằng 2 mission activities mới + show feedback inline trên result page.

## Mục tiêu

1. **Bỏ V4 hiện tại** (🔊 + 🎤 buttons trong Power Chunks card). Power Chunks trở về plain glossary.
2. **Add 2 activities mới**:
   - 🎧 **Mission: Nghe và chép chính tả** (Dictation) — bé nghe MP3 1 câu → gõ lại câu → auto-grade
   - 🗣️ **Mission: Nghe và đọc theo** (Shadowing) — bé nghe MP3 câu mẫu → ghi âm đọc lại → tự nghe so sánh, không auto-grade
3. **Inline feedback** trên web result page (sau submit lesson) — thay vì bắt parent vào Felixar nhập mã. Hiển thị: Điểm tốt / Cần luyện / Level + "5 phút luyện thêm" box.

## Pedagogy backing

- **Dictation**: classic SLA technique kiểm tra listening + spelling at sentence level. Pinker, Krashen support.
- **Shadowing**: pronunciation + intonation drill. Used in BBC English-learning, Pimsleur.
- **Inline feedback**: reduce friction parent journey (web lesson → Felixar 2 clicks + re-enter code). Result page is moment of max attention.

## Non-goals (anti-scope)

- ❌ Đừng add voice retell full story activity (Phương said tạm không cần F1)
- ❌ Đừng add AI feedback per open_response (skip F2)
- ❌ Đừng remove `chunk_audio_urls` field từ review_context (giữ trong backend; chỉ frontend không render Power Chunks card)
- ❌ Đừng thay đổi PDF template cho 2 activities mới (V1 web-only, parent in giấy không có Dictation/Shadowing)
- ❌ Đừng touch model selection (Sonnet 4) — Phương quyết riêng
- ❌ Đừng đổi pass threshold 70% — chờ data 5+ student

---

## Phase M5.1 — Backend: schema + validator + sentence MP3 generation

### Files
- `D:/Read2lead/read2lead_v0_codex/api/prompt.py`
- `D:/Read2lead/read2lead_v0_codex/api/validator.py`
- `D:/Read2lead/read2lead_v0_codex/api/server.py`

### prompt.py

**1. Add field to SCHEMA block** (sau `chunk_in_context` block):

```json
"shadowing_sentences": [
  "Sentence using chunk 1 (8-15 words).",
  "Sentence using chunk 2 (8-15 words).",
  "Sentence using chunk 3 (8-15 words).",
  "... one sentence per chunk in power_chunks ..."
]
```

**Count = số chunks trong pack** (L1=4, L2=5, L3=6). Mỗi sentence chứa **1 chunk khác nhau** (không lặp chunk giữa sentences). Pairing: shadowing_sentences[i] uses power_chunks[i] một cách tự nhiên.

**2. Add Step 6d to WORKFLOW** (sau Step 6c best_line_challenge):

```
Step 6d: Build shadowing_sentences — EXACTLY N short natural English sentences,
where N = the level's power_chunks count (L1=4, L2=5, L3=6). One sentence per
chunk, in the SAME ORDER as power_chunks array. Each sentence must:
  - Use the corresponding power_chunk naturally (sentence[i] uses chunk[i]).
  - Be 8-15 words, smooth to read aloud (no overly complex word order).
  - Be DIFFERENT from sentences in story_text, chunk_in_context, and fill_in_the_blank.
  - Use everyday daily-life situations (school, hobby, family, routine).
  - Each chunk appears in exactly ONE sentence (no chunk repeats across
    shadowing_sentences).

These sentences will be (1) read aloud by AI voice for child to dictate,
and (2) shadowed by the child for pronunciation practice. So pick sentences
that are pronounceable and rewarding to imitate.

Example for L2 chunks {take a deep breath, feel a little nervous, try again slowly, hold the handlebars tightly, make a small mistake}:
  - "Before the math test, I take a deep breath."           ← uses chunk 1
  - "When I see a big dog, I feel a little nervous."        ← uses chunk 2
  - "If I drop my pen, I try again slowly."                 ← uses chunk 3
  - "On my new bike, I hold the handlebars tightly."        ← uses chunk 4
  - "Sometimes in art class, I make a small mistake."       ← uses chunk 5

GRAMMAR RULES (STRICT): apply the same subject + base form patterns as
fill_in_the_blank and chunk_in_context. Use "I" as subject preferred;
if other subject, pair with modal so chunk in base form stays grammatical.
Read every sentence aloud mentally — must sound natural to a native English ear.
```

**3. Add to Step 7 verify**:

```
- Verify shadowing_sentences length === power_chunks length (L1=4, L2=5, L3=6).
- Verify each sentence is 6-18 words, grammatical English.
- Verify pairing: sentence[i] contains chunk[i] (substring match accepting
  tense variants like "took" matching "take").
- Verify no chunk appears in more than one shadowing sentence.
```

### validator.py

Add to `required` list (sau `"best_line_challenge"`):

```python
"shadowing_sentences",
```

Add validation block (sau best_line_challenge validation):

```python
sentences = data.get("shadowing_sentences")
power_chunks_list = data.get("power_chunks") if isinstance(data.get("power_chunks"), list) else []
expected_sentence_count = len(power_chunks_list)

if not isinstance(sentences, list) or len(sentences) != expected_sentence_count:
    errors.append(
        f"shadowing_sentences must have {expected_sentence_count} items (= power_chunks count), "
        f"got {len(sentences) if isinstance(sentences, list) else 'non-list'}"
    )
elif expected_sentence_count > 0:
    chunks_used = []  # track which chunk index each sentence pairs with
    for idx, sentence in enumerate(sentences):
        if not isinstance(sentence, str) or not sentence.strip():
            errors.append(f"shadowing_sentences[{idx}] must be a non-empty string")
            chunks_used.append(None)
            continue
        word_count = len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", sentence))
        if word_count < 6 or word_count > 18:
            errors.append(f"shadowing_sentences[{idx}] should be 6-18 words, got {word_count}")

        # PAIRING CHECK: sentence[i] should contain chunk[i] (allow tense variants)
        expected_chunk = power_chunks_list[idx].get("chunk", "") if isinstance(power_chunks_list[idx], dict) else ""
        if expected_chunk and not chunk_in_story(expected_chunk, sentence):
            errors.append(
                f"shadowing_sentences[{idx}] should contain its paired chunk '{expected_chunk}'"
            )

        # Track which chunk this sentence actually uses (for uniqueness check)
        matched_chunk_idx = None
        for c_idx, c in enumerate(power_chunks_list):
            if isinstance(c, dict) and c.get("chunk") and chunk_in_story(c["chunk"], sentence):
                matched_chunk_idx = c_idx
                break
        chunks_used.append(matched_chunk_idx)

    # UNIQUENESS CHECK: each chunk should appear in at most 1 shadowing sentence
    seen = set()
    for idx, c_idx in enumerate(chunks_used):
        if c_idx is None:
            continue
        if c_idx in seen:
            errors.append(
                f"shadowing_sentences[{idx}] reuses a chunk already used in another shadowing sentence"
            )
        seen.add(c_idx)
```

Note: `chunk_in_story` đã exist trong validator.py — reuse cho tense variant matching.

### server.py

**1. Add helper sau `_generate_one_chunk_audio`**:

```python
def _generate_one_sentence_audio(sentence, tmp_dir, prefix, idx):
    """Worker: gen 1 sentence MP3 + upload R2. Returns (sentence, r2_url) or (sentence, None) on fail."""
    try:
        mp3_path = tmp_dir / f"{prefix}_sentence_{idx}.mp3"
        generate_story_audio(sentence, mp3_path, model=DEFAULT_MODEL, voice=DEFAULT_VOICE)
        url = upload_file(
            str(mp3_path),
            f"packs/{prefix}_sentence_{idx}.mp3",
            "audio/mpeg",
        )
        return sentence, url
    except Exception as e:
        print(f"[sentence_audio] Failed for '{sentence[:40]}': {e}")
        return sentence, None


def _generate_sentence_audios(sentences, tmp_dir, prefix):
    """Generate MP3 per shadowing sentence in PARALLEL.
    3 sentences ≈ ~10s total parallel. Failure of 1 doesn't break pack.
    """
    sentence_audio_urls = {}
    if not isinstance(sentences, list):
        return sentence_audio_urls
    futures = []
    for idx, sentence in enumerate(sentences):
        if not isinstance(sentence, str) or not sentence.strip():
            continue
        futures.append(
            _CHUNK_AUDIO_EXECUTOR.submit(
                _generate_one_sentence_audio, sentence.strip(), tmp_dir, prefix, idx
            )
        )
    for fut in futures:
        try:
            sentence_text, url = fut.result(timeout=60)
            if url:
                sentence_audio_urls[sentence_text] = url
        except Exception as e:
            print(f"[sentence_audio] Future failed: {e}")
    return sentence_audio_urls
```

**2. Trong `_run_generation_task` sau `chunk_audio_urls = _generate_chunk_audios(...)`**:

```python
sentence_audio_urls = _generate_sentence_audios(pack.get("shadowing_sentences"), tmp_dir, prefix)
```

**3. Add to `review_context` dict** (sau `chunk_audio_urls`):

```python
"shadowing_sentences": pack.get("shadowing_sentences"),
"sentence_audio_urls": sentence_audio_urls,
```

### Cost analysis M5.1

- N sentences × ~60 chars × $0.000015 = $0.0009-0.0054/pack TTS depending level
  - L1 (4 sentences): $0.0036
  - L2 (5 sentences): $0.0045
  - L3 (6 sentences): $0.0054
- N R2 uploads ≈ nominal
- Total extra: **~$0.004-0.006/pack** (negligible)
- Generation time: +~3-5s parallel (CHUNK_AUDIO_EXECUTOR max_workers=6, đủ cho L3)

---

## Phase M5.2 — Frontend: builder + grader (Dictation only auto-grade)

### File
- `D:/felixbuilderhub/functions/api/_read2lead-lesson.js`

### Builder

**REMOVE V4 chunk audio extension trong power_chunks**:

Đổi `title_vi` về plain glossary:
```js
title_vi: '📚 Power Chunks — Để tham khảo',
instruction_vi: 'Con xem lại các cụm câu đã học để chuẩn bị kể lại câu chuyện ở phần tiếp theo.',
```

Bỏ field `audio_url` trong power_chunks items map (giữ chunk_audio_urls trong context cho future use, chỉ không expose lên frontend).

**ADD 2 activities mới sau `chunk_in_context` block, TRƯỚC `best_line_challenge`**:

```js
const shadowSentences = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
const sentenceAudios = (context.sentence_audio_urls && typeof context.sentence_audio_urls === 'object') ? context.sentence_audio_urls : {};

if (shadowSentences.length) {
  activities.push({
    id: 'dictation',
    type: 'dictation',
    title_vi: '🎧 Mission: Nghe và chép chính tả',
    instruction_vi: 'Bấm 🔊 để nghe câu. Sau đó gõ lại CHÍNH XÁC câu con vừa nghe. Con có thể nghe nhiều lần. Viết hoa hay thường đều được, không cần chính xác dấu câu.',
    items: shadowSentences.map((sentence, index) => ({
      index,
      audio_url: sentenceAudios[sentence] || '',
    })),
  });

  activities.push({
    id: 'shadowing',
    type: 'shadowing',
    title_vi: '🗣️ Mission: Nghe và đọc theo (Shadowing)',
    instruction_vi: 'Bấm 🔊 nghe câu mẫu (có thể nghe nhiều lần). Sau đó bấm 🎤 đọc lại y hệt câu mẫu. Bấm ▶ nghe lại bản ghi của con để tự so sánh.',
    items: shadowSentences.map((sentence, index) => ({
      index,
      audio_url: sentenceAudios[sentence] || '',
    })),
  });
}
```

### Grader

Add to `gradeLessonSubmission` (sau `best_line` line):

```js
addSection('dictation', 'Chính tả', ...gradeDictation(context, answers.dictation));
```

**Note: KHÔNG grade shadowing** — production aural, save audio blob local only, parent self-judge khi bé nghe lại.

Add helper function (sau `gradeBestLine`):

```js
function gradeDictation(context, answerMap = {}) {
  const expected = Array.isArray(context.shadowing_sentences) ? context.shadowing_sentences : [];
  let correct = 0;
  expected.forEach((sentence, index) => {
    const actual = getIndexedAnswer(answerMap, index);
    if (normalizeText(actual) === normalizeText(sentence)) correct += 1;
  });
  return [correct, expected.length];
}
```

`normalizeText` đã exist — reuse (NFKD lowercase + strip punctuation + collapse whitespace).

**Grading note**: strict text match có thể quá khó với trẻ (typo). V1 dùng strict. Nếu user feedback drop rate > 50% trên dictation, relax sau bằng Levenshtein distance ≤ 3 chars.

---

## Phase M5.3 — Frontend UI: render branches + event delegation

### File
- `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

### Power Chunks: REMOVE V4 buttons

Tìm nhánh `if (activity.type === 'power_chunks')` trong `renderActivity()`. Revert về plain glossary card:

```js
if (activity.type === 'power_chunks') {
  return sectionWrap(title, `
    <div class="grid gap-3 md:grid-cols-2">
      ${activity.items.map((item) => `
        <div class="rounded-lg border border-cream-dim/20 bg-navy-900/75 p-4">
          <p class="font-semibold text-cream">${escapeHtml(item.chunk)}</p>
          <p class="mt-1 text-sm text-cream-muted">${escapeHtml(item.meaning)}</p>
          ${item.example ? `<p class="mt-2 text-sm italic text-cream-dim">${escapeHtml(item.example)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `);
}
```

(Bỏ `data-chunk-card`, `data-chunk-listen`, `data-chunk-record`, `data-chunk-playback`, status text, audio element.)

### Remove V4 JS state

Bỏ:
```js
const chunkRecordings = new Map();
let chunkListenAudio = null;
```

Bỏ event delegation handlers `data-chunk-listen` + `data-chunk-record` trong `activitiesEl.addEventListener('click', ...)`. Em sẽ replace bằng listeners mới cho dictation/shadowing dưới.

### Add Dictation render branch

Thêm trong `renderActivity()` sau nhánh `chunk_in_context`:

```js
if (activity.type === 'dictation') {
  return sectionWrap(title, activity.items.map((item) => `
    <div class="mb-4 rounded-lg border border-cream-dim/20 bg-navy-900/75 p-4">
      <p class="text-sm font-semibold text-gold-light">Câu ${item.index + 1}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        ${item.audio_url
          ? `<button type="button" data-sentence-listen="${escapeHtml(item.audio_url)}" class="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm font-semibold text-gold-light transition hover:bg-gold hover:text-navy-950" aria-label="Nghe câu">🔊 Nghe câu</button>`
          : '<span class="text-sm text-red-300">Câu này thiếu file nghe.</span>'}
      </div>
      <input type="text" data-answer-type="dictation" data-answer-index="${item.index}" autocomplete="off" autocapitalize="none" spellcheck="false" class="mt-3 w-full rounded-lg border border-cream-dim/30 bg-navy-950 px-4 py-3 text-base text-cream placeholder:text-cream-dim/70 focus:border-accent focus:outline-none" placeholder="Con gõ lại câu vừa nghe..." required />
    </div>
  `).join(''));
}
```

### Add Shadowing render branch

Thêm sau Dictation:

```js
if (activity.type === 'shadowing') {
  return sectionWrap(title, activity.items.map((item) => `
    <div class="mb-4 rounded-lg border border-cream-dim/20 bg-navy-900/75 p-4" data-shadow-card data-shadow-index="${item.index}">
      <p class="text-sm font-semibold text-gold-light">Câu ${item.index + 1}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        ${item.audio_url
          ? `<button type="button" data-sentence-listen="${escapeHtml(item.audio_url)}" class="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm font-semibold text-gold-light transition hover:bg-gold hover:text-navy-950" aria-label="Nghe câu mẫu">🔊 Nghe câu mẫu</button>`
          : ''}
        <button type="button" data-shadow-record class="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent transition hover:bg-accent hover:text-navy-950" aria-label="Ghi âm con đọc lại">🎤 Đọc theo</button>
        <span data-shadow-status class="text-xs text-cream-dim"></span>
      </div>
      <audio data-shadow-playback controls preload="none" class="mt-3 hidden w-full"></audio>
    </div>
  `).join(''));
}
```

### Update event delegation

Trong `activitiesEl.addEventListener('click', async (event) => {...})`, replace nội dung cũ V4 với:

```js
activitiesEl.addEventListener('click', async (event) => {
  // SENTENCE LISTEN (shared by Dictation + Shadowing)
  const listenBtn = event.target.closest('[data-sentence-listen]');
  if (listenBtn) {
    const url = listenBtn.getAttribute('data-sentence-listen');
    if (!url) return;
    try {
      if (sentenceListenAudio) {
        sentenceListenAudio.pause();
        sentenceListenAudio.currentTime = 0;
      }
      sentenceListenAudio = new Audio(url);
      await sentenceListenAudio.play();
    } catch (err) {
      console.warn('[sentence-listen] play failed:', err);
    }
    return;
  }

  // SHADOWING RECORD
  const recordBtn = event.target.closest('[data-shadow-record]');
  if (recordBtn) {
    const card = recordBtn.closest('[data-shadow-card]');
    if (!card) return;
    const idx = card.getAttribute('data-shadow-index');
    const status = card.querySelector('[data-shadow-status]');
    const playback = card.querySelector('[data-shadow-playback]');
    const existing = shadowRecordings.get(idx);

    if (existing?.mediaRecorder && existing.mediaRecorder.state === 'recording') {
      existing.mediaRecorder.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      });
      mediaRecorder.addEventListener('stop', () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const blobUrl = URL.createObjectURL(blob);
        const prev = shadowRecordings.get(idx);
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        shadowRecordings.set(idx, { mediaRecorder: null, chunks: [], stream: null, blobUrl });
        if (playback) {
          playback.src = blobUrl;
          playback.classList.remove('hidden');
        }
        if (status) status.textContent = '✅ Đã ghi âm — bấm ▶ nghe lại';
        recordBtn.textContent = '🎤 Đọc lại';
        stream.getTracks().forEach((track) => track.stop());
      });
      mediaRecorder.start();
      shadowRecordings.set(idx, { mediaRecorder, chunks, stream });
      recordBtn.textContent = '⏹ Dừng ghi';
      if (status) status.textContent = '🔴 Đang ghi âm...';
    } catch (err) {
      if (status) status.textContent = 'Không mở được micro. Cho phép quyền rồi thử lại.';
    }
  }
});

// State declarations (gần đầu script, gần currentStep declarations):
const shadowRecordings = new Map();
let sentenceListenAudio = null;
```

### Update collectAnswers

Add bucket `dictation`:

```js
function collectAnswers() {
  const answers = {
    matching: {},
    build_chunk: {},
    fill_blank: {},
    fix_chunk: {},
    chunk_in_context: {},
    dictation: {},     // NEW
    best_line: {},
    story_order: {},
    comprehension: {},
    open_response: {},
  };
  // ... rest unchanged
}
```

Shadowing không cần bucket (không submit, local only).

---

## Phase M5.4 — Inline feedback on result page

### File
- `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

### Add helper function (đầu `<script>`, gần escapeHtml)

```js
function levelRecommendationText(value) {
  return {
    easier: 'Nên chọn bài dễ hơn ở lần sau',
    stay: 'Giữ mức hiện tại',
    move_up: 'Có thể thử mức khó hơn',
  }[value] || 'Giữ mức hiện tại';
}
```

(Copy y nguyên từ `D:/felixbuilderhub/src/pages/read2lead/review.astro` line 150-156.)

### Update renderResult()

Tìm chỗ `resultCard.innerHTML = ` trong `renderResult()`. Sau Mission Complete Box và TRƯỚC Điểm % line, **insert** 2 blocks mới:

```js
const feedbackVi = result.review?.feedback_vi || {};
const miniVi = result.review?.mini_practice_vi || {};

const recommendationsHtml = `
  <div class="mt-6 grid gap-3 md:grid-cols-3">
    <div class="rounded-lg border border-cream-dim/20 bg-navy-900/70 p-4">
      <p class="text-xs uppercase tracking-wide text-cream-dim">Điểm tốt</p>
      <p class="mt-2 text-sm text-cream">${escapeHtml(feedbackVi.strength || 'Con đã hoàn thành bài đầy đủ.')}</p>
    </div>
    <div class="rounded-lg border border-cream-dim/20 bg-navy-900/70 p-4">
      <p class="text-xs uppercase tracking-wide text-cream-dim">Cần luyện</p>
      <p class="mt-2 text-sm text-cream">${escapeHtml(feedbackVi.practice || 'Con có thể nghe lại MP3 chậm hơn lần sau.')}</p>
    </div>
    <div class="rounded-lg border border-cream-dim/20 bg-navy-900/70 p-4">
      <p class="text-xs uppercase tracking-wide text-cream-dim">Level</p>
      <p class="mt-2 text-sm text-cream">${escapeHtml(levelRecommendationText(result.review?.level_recommendation))}</p>
    </div>
  </div>
`;

const miniPracticeHtml = (miniVi.read_again || miniVi.chunk_to_practice || miniVi.parent_question) ? `
  <div class="mt-4 rounded-lg border border-accent/30 bg-accent/10 p-4">
    <p class="font-semibold text-cream">5 phút luyện thêm</p>
    <ul class="mt-2 space-y-2 text-sm text-cream-muted">
      <li><strong class="text-cream">Đọc lại:</strong> ${escapeHtml(miniVi.read_again || 'Một câu trong truyện.')}</li>
      <li><strong class="text-cream">Cụm cần luyện:</strong> ${escapeHtml(miniVi.chunk_to_practice || 'Một cụm trong bài.')}</li>
      <li><strong class="text-cream">Bố mẹ hỏi:</strong> ${escapeHtml(miniVi.parent_question || 'Con kể lại chuyện gì xảy ra nhé?')}</li>
    </ul>
  </div>
` : '';
```

Inject vào template string sau Mission Complete Box (line bắt đầu với `${missionBox}`):

```js
resultCard.innerHTML = `
  <h2 class="${headingClass}">${headingText}</h2>
  ${missionBox}
  ${recommendationsHtml}
  ${miniPracticeHtml}
  <p class="mt-3 text-lg text-cream-muted">Điểm: <strong class="text-gold-light">${scorePercent}%</strong> · Đúng ${result.correct_count || 0}/${result.total_count || 0} phần được chấm</p>
  ...
```

**Note backend**: `buildWebReviewSummary` trong `_read2lead-lesson.js` đã populate `feedback_vi` + `mini_practice_vi` + `level_recommendation` cho cả pass + fail path. Không cần đụng backend.

---

## Verification end-to-end

### Test 1 — Pack content
1. Tạo pack mới sau Render deploy
2. Pack JSON phải có `shadowing_sentences` (3 items, 6-18 words mỗi câu, mỗi câu chứa ≥ 1 chunk)
3. Pack JSON phải có `sentence_audio_urls` dict 3 entries
4. Validation pass attempt 1 (hoặc 2) — Codex check Render logs `[task xxx] Validation failed` nếu có

### Test 2 — Web lesson Step 3
Mở /lesson Step 3:
1. Power Chunks card hiện plain glossary (KHÔNG còn 🔊 + 🎤 buttons V4)
2. Có section **🎧 Mission: Nghe và chép chính tả** với 3 câu × (🔊 Nghe câu + text input)
3. Có section **🗣️ Mission: Nghe và đọc theo** với 3 câu × (🔊 Nghe câu mẫu + 🎤 Đọc theo + audio playback)
4. Bấm 🔊 Nghe câu → audio play
5. Gõ câu vào input → khi submit, dictation grade

### Test 3 — Grading
1. Submit dictation 3/3 đúng → section Chính tả pass
2. Submit 1/3 sai → section fail nhưng total score tính
3. Shadowing không grade (không có section trong result)

### Test 4 — Inline feedback result page
1. Submit pass → result page hiện:
   - Mission Complete Box (existing M1)
   - **3 boxes mới**: Điểm tốt / Cần luyện / Level
   - **5 phút luyện thêm box**: Đọc lại / Cụm cần luyện / Bố mẹ hỏi
2. Submit fail < 70% → vẫn hiện 3 boxes + 5 phút box (data từ buildWebReviewSummary)

### Test 5 — Mobile 390px
1. Iframe section width fit
2. Buttons không tràn ngang
3. Text input dictation đủ rộng để gõ
4. Audio playback element controls visible

### Test 6 — Draft autosave
1. Gõ vài chữ dictation → refresh page → restore
2. Submit pass → clearDraft → reload → answers empty

---

## Effort estimate

| Phase | Effort | Risk |
|---|---|---|
| M5.1 Backend prompt + validator + server | 1.5h | **Medium** (validation regex + chunk_in_story call) |
| M5.2 Frontend builder + grader | 30 phút | Low |
| M5.3 Frontend UI 3 sections + remove V4 | 1h | Low |
| M5.4 Inline feedback boxes | 30 phút | Low |
| Build verify + push + Codex iteration | 30 phút | — |
| **Total** | **~4h** | |

## Files Codex sẽ touch (tổng cộng 5 file)

| File | Phase |
|---|---|
| `D:/Read2lead/read2lead_v0_codex/api/prompt.py` | M5.1 |
| `D:/Read2lead/read2lead_v0_codex/api/validator.py` | M5.1 |
| `D:/Read2lead/read2lead_v0_codex/api/server.py` | M5.1 |
| `D:/felixbuilderhub/functions/api/_read2lead-lesson.js` | M5.2 |
| `D:/felixbuilderhub/src/pages/read2lead/lesson.astro` | M5.3 + M5.4 |

## Commit message templates

**Backend (M5.1)**:
```
M5.1 backend: shadowing_sentences schema + parallel MP3 gen

Phương pivot V4: bỏ chunk listen+record trong Power Chunks card,
thay bằng 2 mission activities Dictation + Shadowing trên web.

Backend changes:
- prompt.py: schema field shadowing_sentences (3 sentences, 6-18 words,
  each contains ≥1 power_chunk). Step 6d workflow yêu cầu sentences
  DIFFERENT from story_text + chunk_in_context, pronounceable.
- validator.py: validate count, word range, chunk presence per sentence
  (reuse chunk_in_story for tense variants).
- server.py: _generate_sentence_audios parallel helper (reuse
  _CHUNK_AUDIO_EXECUTOR). Add shadowing_sentences + sentence_audio_urls
  to review_context dict.

Cost: +~$0.003/pack (3 sentence MP3 ~$0.0027 + R2 nominal).
Time: +~3-5s parallel.
```

**Frontend (M5.2 + M5.3 + M5.4)**:
```
M5 frontend: Dictation + Shadowing missions + inline feedback

Bỏ V4 chunk 🔊+🎤 trong Power Chunks (revert plain glossary).

2 activities mới trong Step 3:
- 🎧 Dictation: bé nghe MP3 câu → gõ lại câu → auto-grade text match
- 🗣️ Shadowing: bé nghe câu mẫu → ghi âm đọc lại → tự nghe so sánh
  (không grade, production aural local-only)

State mới: shadowRecordings Map, sentenceListenAudio. Event delegation
data-sentence-listen + data-shadow-record. MediaRecorder pattern y hệt
V4 chunk record.

gradeDictation: normalizeText (NFKD lowercase + strip punctuation +
collapse whitespace) so sánh input với expected sentence. Strict 100%
match V1; nếu user feedback drop rate cao → relax Levenshtein V2.

Inline feedback result page:
- 3 boxes Điểm tốt / Cần luyện / Level (từ review.feedback_vi đã có
  trong buildWebReviewSummary backend, không thay đổi backend)
- 5 phút luyện thêm box (Đọc lại / Cụm cần luyện / Bố mẹ hỏi từ
  review.mini_practice_vi)
- levelRecommendationText helper copy từ review.astro

Mục tiêu: parent + child thấy feedback NGAY sau submit, không cần
vào Felixar nhập mã (giảm friction 2 clicks + re-enter code).
```

---

## Paste-ready prompt cho Codex CLI

Anh mở Codex CLI trong `D:/felixbuilderhub` rồi paste:

```
Đọc file Note/plan_v5_dictation_shadowing_for_codex.md từ đầu đến cuối.

Execute theo đúng thứ tự:
1. M5.1 Backend (prompt.py + validator.py + server.py) — commit + push backend Python repo
2. M5.2 + M5.3 + M5.4 Frontend (_read2lead-lesson.js + lesson.astro) — commit + push frontend repo

Bắt buộc:
- Build verify (npm run build) trước commit frontend
- Commit messages dùng template trong plan file
- KHÔNG touch chunk_audio_urls field trong backend (giữ cho future use, chỉ remove ở frontend Power Chunks rendering)
- KHÔNG touch PDF template (V1 web-only cho 2 activities mới)
- KHÔNG add voice retell hoặc AI feedback per open_response

Nếu phát hiện spec không rõ chỗ nào, dừng lại hỏi tôi trước khi đoán.

Sau khi push xong, tôi sẽ verify production và Claude review code session sau.
```
