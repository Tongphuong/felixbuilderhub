# Plan: Read2Lead Mission Mode V3 — for Codex execution

**Brain**: Claude (Phương — Felix)
**Executor**: Codex CLI
**Context**: Read2Lead V2 đã ship (4-step lesson, 14 inputs, chunk_in_context). Codex research Raz-Kids → đề xuất reframe "worksheet" thành "mission". Plan này filter từ research thành 3 phase actionable.

## Mục tiêu

Giảm cảm giác "bài tập textbook" của activities hiện tại, tăng cảm giác "mission" theo logic Raz-Kids:
- Mỗi step có rõ vai trò (không phải checklist random)
- Visible reward sau mỗi section pass
- Học sinh hiểu: "làm xong cái này → mở được bài tiếp theo"

**Non-goals** (KHÔNG làm trong V3):
- Star Zone / avatar / rocket UI (over-engineer)
- Reading Room / Level Up / Assignment portal (Read2Lead không cần)
- Teacher report dashboard (Felix = teacher, hiện đã có Felixar dashboard)
- Voice recording AI (đã có ở Felixar review flow, không phải mục tiêu V3)

---

## Phase M1 — Mission framing + Complete Box (frontend only, ~1h)

### M1.1 — Rename activity labels theo mission language

**File**: `D:/felixbuilderhub/functions/api/_read2lead-lesson.js`

Đổi `title_vi` của các activities trong `buildActivities`:

| Trước | Sau |
|---|---|
| `'Đọc câu chuyện'` | `'🎯 Nhiệm vụ 1: Đọc câu chuyện'` |
| `'Nối cụm câu với nghĩa'` | `'🔗 Nhiệm vụ: Nối cụm câu'` |
| `'Điền cụm câu vào chỗ trống'` | `'✏️ Nhiệm vụ: Điền cụm câu'` |
| `'Dùng cụm câu trong tình huống mới'` | `'🌍 Nhiệm vụ: Dùng trong đời thật'` |
| `'Câu hỏi sau khi đọc'` | `'🔍 Quick Check: Con hiểu chuyện chưa?'` |
| `'Con tự trả lời'` | `'💭 Use It About You'` |
| `'Thư viện cụm câu'` | `'📚 Power Chunks — Để tham khảo'` |

**Lưu ý**: Emoji chỉ ở label (heading), không trong instruction.

### M1.2 — Mission Complete Box ở result page

**File**: `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

Trong `renderResult()`, sau heading "Con được 1 sao!", thêm checklist box:

```html
<div class="mt-6 rounded-lg border border-accent/30 bg-accent/10 p-5">
  <p class="font-display text-lg font-bold text-cream">Mission Complete ✨</p>
  <ul class="mt-3 space-y-2 text-cream-muted">
    <li>✅ Con đã nghe câu chuyện</li>
    <li>✅ Con đã đọc to câu chuyện</li>
    <li>✅ Con đã làm bài luyện tập (${score_percent}%)</li>
    <li>${passed ? '⭐' : '⚠️'} ${passed ? 'Con được +1 sao!' : 'Bài tiếp theo mở khi con đạt 70%+'}</li>
  </ul>
</div>
```

Đặt sau heading, trước feedback box hiện tại. Chỉ render khi `passed === true`.
Nếu `passed === false`: thay box bằng "Mission In Progress" với 4 mục: 3 đã ✓ + 1 ⏳.

### M1.3 — Step indicator dùng emoji + label rõ

**File**: `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

Đổi 3 nút step indicator (line 51-55):
- `1 · Nghe` → `🎧 Bước 1: Nghe`
- `2 · Đọc` → `📖 Bước 2: Đọc`
- `3 · Làm bài` → `🎯 Bước 3: Mission`

### M1.4 — Mỗi section trong result có icon ✓/✗

**File**: `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

Trong `renderResult()`, mỗi `section` card đã có border xanh/đỏ. Thêm icon to trước title:

```html
<p class="font-semibold ${section.passed ? 'text-green-300' : 'text-red-300'}">
  ${section.passed ? '✅' : '🔄'} ${escapeHtml(section.title)}
</p>
```

`🔄` = "thử lại" (không phải ❌ negative).

### Verification M1

1. `npm run build` pass
2. Tạo pack test, mở /lesson, scroll đến cuối Step 3
3. Submit pass 100% → result page hiện Mission Complete Box với 4 ✅
4. Submit fail < 70% → Mission In Progress box (3 ✅ + 1 ⏳)
5. Mobile 390px width → emoji + label không bị tràn

### Commit message M1

```
M1: Mission framing + Complete Box for web lesson

Reframe lesson activities từ "bài tập" sang "mission" theo Raz-Kids
progress loop research:
- Rename activity titles dùng emoji + "Nhiệm vụ" language
- Step indicator emoji-led
- Mission Complete Box ở result page (4-item checklist)
- Section icons ✅/🔄 cho clarity (không dùng ❌ negative)
```

---

## Phase M3 — Chunk Hunt highlight (frontend only, ~30 phút)

**Lý do làm M3 trước M2**: M3 chỉ frontend, low risk. M2 đụng Python validation, ship sau khi M1+M3 verified.

### M3.1 — Highlight power_chunks trong story Step 2

**File**: `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

Trong `renderLesson()`, đoạn render `stepReadBody`:

```js
// Thay vì plain escapeHtml(item.text), highlight chunks
const chunks = (lesson.activities.find(a => a.id === 'power_chunks')?.items || [])
  .map(c => c.chunk).filter(Boolean);

function highlightChunks(text, chunkList) {
  let html = escapeHtml(text);
  // Sort chunks by length desc để match phrase dài trước
  const sorted = chunkList.slice().sort((a, b) => b.length - a.length);
  sorted.forEach(chunk => {
    const escaped = escapeHtml(chunk);
    // Case-insensitive replace, preserve original casing
    const regex = new RegExp(`(${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(regex, '<mark class="bg-gold/30 text-cream rounded px-1">$1</mark>');
  });
  return html;
}

stepReadBody.innerHTML = storyActivity.items
  .map(item => `<p class="mb-6 text-xl leading-relaxed text-cream md:text-2xl md:leading-loose">${highlightChunks(item.text, chunks)}</p>`)
  .join('');
```

**Lưu ý**:
- Dùng `<mark>` semantic tag, override style Tailwind
- Case-insensitive match nhưng chunks ở base form ("take a deep breath") có thể không match inflected ("took a deep breath") trong story. Acceptable cho V1 — chỉ exact phrase match.
- Phương án tốt hơn nếu cần (V2): server-side use validator's `chunk_in_story()` function để match tense variants. Skip cho V1.

### M3.2 — Click chunk highlight → tooltip meaning

**File**: `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

Sau `stepReadBody.innerHTML = ...`, attach click listeners:

```js
// Build chunk → meaning lookup từ power_chunks activity
const chunkMeanings = {};
(lesson.activities.find(a => a.id === 'power_chunks')?.items || [])
  .forEach(c => { if (c.chunk) chunkMeanings[c.chunk.toLowerCase()] = c.meaning || ''; });

stepReadBody.querySelectorAll('mark').forEach(el => {
  el.style.cursor = 'pointer';
  el.title = chunkMeanings[el.textContent.toLowerCase().trim()] || '';
  // Optional: click → show meaning in floating tooltip (skip cho V1, dùng native title)
});
```

V1: dùng native `title` attribute (hover tooltip). V2 optional: custom tooltip nice hơn.

### Verification M3

1. Tạo pack có 5 chunks
2. Mở /lesson → Step 2 → confirm các chunks trong story có background gold
3. Hover chunk → tooltip hiện meaning
4. Mobile: tap chunk → native tooltip (iOS Safari có long-press)

### Commit message M3

```
M3: Chunk Hunt — highlight power chunks in story

Step 2 "Đọc" giờ highlight các power_chunks bằng background gold
khi xuất hiện trong story_text. Hover/long-press → tooltip meaning.

Reading aid for transfer learning: học sinh nhìn thấy ngay chunk
nào là target vocabulary mà không cần scroll xuống Power Chunks
glossary. Match case-insensitive, exact phrase (không match tense
variants — acceptable cho V1).
```

---

## Phase M2 — Best Line Challenge activity (full stack, ~2h)

**Mục tiêu**: Activity mới — học sinh đọc 3 versions của 1 câu, pick câu English natural nhất. Test khả năng nhận diện grammar/syntax đúng (đặc biệt good cho chunks dễ bị broken như "feel a little nervous" vs "I nervous feel little").

**Format Raz-Kids style**:
```
Which sentence sounds natural?
○ I feel nervous a little.
○ I feel a little nervous.   ← correct
○ I nervous feel little.
```

### M2.1 — Backend prompt schema

**File**: `D:/Read2lead/read2lead_v0_codex/api/prompt.py`

Thêm field vào SCHEMA section (sau `chunk_in_context`):

```json
"best_line_challenge": [
  {
    "options": [
      "I feel a little nervous.",
      "I nervous feel little.",
      "I feel nervous a little."
    ],
    "correct_index": 0
  },
  { ... },
  { ... }
]
```

3 items (1 per chunk core selection). Mỗi item có 3 options + index correct.

Thêm vào `answer_key`:
```json
"best_line_challenge": [0, 0, 0]  // array of correct indices
```

Thêm vào "WORKFLOW" Step 6c (sau Step 6b chunk_in_context):

```
Step 6c: Build best_line_challenge — 3 items, mỗi item:
  - Pick 1 power_chunk
  - Write 3 sentence variations using that chunk:
    1. Natural English (correct word order)
    2. Word-order error common to Vietnamese L1 learners (e.g. adjective placement)
    3. Different word-order error
  - Mark correct_index = position of natural version (0, 1, or 2 — randomize)
  - All 3 options must use the SAME chunk words, just different order/grammar
  
  Example for chunk "feel a little nervous":
    options: ["I nervous feel a little.", "I feel a little nervous.", "I a little feel nervous."]
    correct_index: 1

GRAMMAR RULE: variations should test ACTUAL common errors Vietnamese
learners make (word order, missing articles, wrong preposition placement),
NOT random scrambles or nonsense.
```

Thêm vào Step 7 re-check:
```
- Verify best_line_challenge has exactly 3 items, each with 3 options and a correct_index 0-2.
- Verify the correct option in each item uses the chunk in natural English.
```

### M2.2 — Backend validator

**File**: `D:/Read2lead/read2lead_v0_codex/api/validator.py`

Thêm vào `required` list:
```python
"best_line_challenge",
```

Thêm validation block (sau chunk_in_context block):

```python
challenge_items = data.get("best_line_challenge")
if not isinstance(challenge_items, list) or len(challenge_items) != 3:
    errors.append("best_line_challenge must be a list of exactly 3 items")
else:
    for idx, item in enumerate(challenge_items):
        if not isinstance(item, dict):
            errors.append(f"best_line_challenge[{idx}] must be an object")
            continue
        options = item.get("options")
        if not isinstance(options, list) or len(options) != 3:
            errors.append(f"best_line_challenge[{idx}].options must be a list of 3 strings")
        elif not all(isinstance(o, str) and o.strip() for o in options):
            errors.append(f"best_line_challenge[{idx}].options must all be non-empty strings")
        correct_idx = item.get("correct_index")
        if not isinstance(correct_idx, int) or correct_idx not in (0, 1, 2):
            errors.append(f"best_line_challenge[{idx}].correct_index must be int 0-2")

    answer_list = data["answer_key"].get("best_line_challenge") if isinstance(data.get("answer_key"), dict) else None
    if not isinstance(answer_list, list) or len(answer_list) != 3:
        errors.append("answer_key.best_line_challenge must be a list of 3 indices")
    elif not all(isinstance(a, int) and a in (0, 1, 2) for a in answer_list):
        errors.append("answer_key.best_line_challenge must be ints 0-2")
```

### M2.3 — Backend server.py pass-through

**File**: `D:/Read2lead/read2lead_v0_codex/api/server.py`

Thêm `"best_line_challenge": pack.get("best_line_challenge")` vào cả 2 chỗ `review_context` dict (sau `"chunk_in_context"`).

### M2.4 — PDF template

**File**: `D:/Read2lead/read2lead_v0_codex/templates/read2lead_reading_pack_template.html`

Thêm activity G "Best Line Challenge" trong practice-grid section (sau F. Chunk in New Context):

```html
<div class="activity">
  <h3>G. Best Line Challenge</h3>
  <p>Circle the line that sounds most natural.</p>
  <p class="vi">Khoanh tròn câu nghe tự nhiên nhất.</p>
  <ol>
    {{best_line_challenge_html}}
  </ol>
</div>
```

**File**: `D:/Read2lead/read2lead_v0_codex/scripts/render_reading_pack.py`

Thêm helper:
```python
def render_best_line_challenge(items):
    if not items:
        return ""
    lines = []
    for item in items:
        opts = item.get("options", [])
        opt_html = "".join(f"<li>○ {escape(str(o))}</li>" for o in opts)
        lines.append(f"<li><ul style='list-style:none;padding-left:0'>{opt_html}</ul></li>")
    return "\n".join(lines)
```

Thêm placeholder trong `render_html` values dict:
```python
"best_line_challenge_html": render_best_line_challenge(data.get("best_line_challenge", []) or []),
```

Thêm vào `render_answer_key`:
```python
challenge_answers = answer_key.get("best_line_challenge", [])
# Convert indices to letters (0=A, 1=B, 2=C) for parent readability
challenge_letters = ", ".join(chr(65 + i) for i in challenge_answers if isinstance(i, int) and 0 <= i <= 2)
# Add line in key-card:
f"<p><strong>G. Best Line Challenge:</strong> {escape(challenge_letters)}</p>",
```

### M2.5 — Frontend builder + grader

**File**: `D:/felixbuilderhub/functions/api/_read2lead-lesson.js`

Trong `buildActivities`, thêm sau chunk_in_context block:

```js
const challengeItems = Array.isArray(context.best_line_challenge) ? context.best_line_challenge : [];
if (challengeItems.length) {
  activities.push({
    id: 'best_line',
    type: 'best_line',
    title_vi: '🎯 Best Line Challenge',
    instruction_vi: 'Mỗi câu hỏi có 3 cách viết. Con chọn cách nghe tự nhiên nhất trong tiếng Anh.',
    items: challengeItems.map((item, index) => ({
      index,
      options: Array.isArray(item.options) ? item.options : [],
    })),
  });
}
```

Trong `gradeLessonSubmission`, thêm grader:

```js
addSection('best_line', 'Best Line', ...gradeBestLine(context, answers.best_line));

function gradeBestLine(context, answerMap = {}) {
  const expected = Array.isArray(context.answer_key?.best_line_challenge) ? context.answer_key.best_line_challenge : [];
  let correct = 0;
  expected.forEach((expectedIdx, index) => {
    const actual = getIndexedAnswer(answerMap, index);
    if (String(actual) === String(expectedIdx)) correct += 1;
  });
  return [correct, expected.length];
}
```

### M2.6 — Frontend render UI

**File**: `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

Trong `renderActivity()`, thêm nhánh sau chunk_in_context:

```js
if (activity.type === 'best_line') {
  return sectionWrap(title, activity.items.map((item) => `
    <fieldset class="mb-4 rounded-lg border border-cream-dim/20 bg-navy-900/75 p-4">
      <legend class="text-sm font-semibold text-gold-light px-2">Câu ${item.index + 1}</legend>
      <p class="text-sm text-cream-dim mb-3">Câu nào nghe tự nhiên nhất?</p>
      ${item.options.map((option, optIdx) => `
        <label class="flex items-start gap-3 py-2 cursor-pointer">
          <input type="radio" name="best_line_${item.index}" value="${optIdx}" data-answer-type="best_line" data-answer-index="${item.index}" required class="mt-1 accent-accent" />
          <span class="text-base text-cream">${escapeHtml(option)}</span>
        </label>
      `).join('')}
    </fieldset>
  `).join(''));
}
```

Update `collectAnswers()` để add bucket:
```js
const answers = {
  matching: {},
  fill_blank: {},
  chunk_in_context: {},
  best_line: {},  // NEW
  story_order: {},
  comprehension: {},
  open_response: {},
};
```

`collectAnswers` đã loop tất cả `[data-answer-type]` nên radio input sẽ được pick up tự nhiên.

### Verification M2

1. Tạo pack mới sau khi Render deploy
2. Pack JSON phải có field `best_line_challenge` (3 items, 3 options each)
3. PDF section 3 phải có activity G
4. Web /lesson Step 3 phải có Best Line section với 3 fieldset radio
5. Submit pass → grader count đúng

### Commit messages M2

Backend:
```
M2 backend: best_line_challenge activity

Activity mới: học sinh đọc 3 versions của 1 câu, pick câu tự nhiên
nhất. Test khả năng nhận diện word order / grammar correct.

3 items per pack, 1 chunk reused per item. GPT prompt yêu cầu
variations test common L1 Vietnamese errors (word order, article,
preposition), không random scramble.

PDF section 3 thêm activity G. Answer key dùng letter (A/B/C)
cho parent dễ chấm.
```

Frontend:
```
M2 frontend: best_line_challenge UI + grader

Render radio fieldset thay vì dropdown (3 options là multiple choice
classic, radio fits pattern hơn).

Grade by index match: answers.best_line[i] === answer_key.best_line_challenge[i]
```

---

## Verification end-to-end (sau cả 3 phase)

### Test 1 — Pack content
- Tạo pack mới
- JSON có field `best_line_challenge` valid (M2)
- PDF có 7 activities A-G (M2)

### Test 2 — Web lesson UX
- Mở /lesson trên mobile + desktop
- Step indicator hiển thị emoji + Bước X (M1)
- Step 2 story có chunks highlighted (M3)
- Step 3 có Best Line section với radio (M2)
- Submit pass → Mission Complete Box (M1)
- Mỗi section card có icon ✅/🔄 (M1)

### Test 3 — Grading correctness
- Submit best_line đúng cả 3 → section pass
- Submit best_line sai 1 → section fail nhưng total score tính
- Verify pass threshold 70% với 14 inputs (M1+M2 → 14+3=17 inputs total)

---

## Effort estimate

| Phase | Effort | Risk |
|---|---|---|
| M1 | ~1h | Low (frontend only, no schema change) |
| M3 | ~30 phút | Low (frontend, no backend) |
| M2 | ~2h | **Medium** (đụng Python prompt + validator + PDF + frontend) |

Total: **~3.5h** end-to-end.

Recommend Codex ship M1+M3 trước (1 PR), test xong → M2 (separate PR).

---

## Files Codex sẽ touch

**M1** (1 file):
- `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`
- `D:/felixbuilderhub/functions/api/_read2lead-lesson.js`

**M3** (1 file):
- `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

**M2** (6 files):
- `D:/Read2lead/read2lead_v0_codex/api/prompt.py`
- `D:/Read2lead/read2lead_v0_codex/api/validator.py`
- `D:/Read2lead/read2lead_v0_codex/api/server.py`
- `D:/Read2lead/read2lead_v0_codex/scripts/render_reading_pack.py`
- `D:/Read2lead/read2lead_v0_codex/templates/read2lead_reading_pack_template.html`
- `D:/felixbuilderhub/functions/api/_read2lead-lesson.js`
- `D:/felixbuilderhub/src/pages/read2lead/lesson.astro`

---

## What NOT to do (anti-scope)

❌ Đừng add Star Zone / avatar / rocket — over-engineer
❌ Đừng add Reading Room / Level Up portal — không phù hợp Read2Lead
❌ Đừng add real-time voice tutor — quá phức tạp V1
❌ Đừng touch backend Anthropic model selection — Phương sẽ quyết riêng (đang dùng Sonnet 4)
❌ Đừng touch task-state.js / check-generation-status.js — vừa migrate state, đừng break
❌ Đừng đổi pass threshold 70% — chờ data 5+ student trước khi tune
