# MASTER EXECUTION SPEC — 2026-06-09

**Author**: Claude (spec + brain)
**Executor**: Cursor
**Scope**: 2 repos — backend cleanup + hub UX redesign
**Rule**: Execute phases in order. Each task = 1 commit. If stuck, file `STUCK.md` and skip to next task.

---

## Phase A — Backend Cleanup (repo: `D:\Read2lead\read2lead_v0_codex`)

Execute `_claude/CLEANUP_SPEC_2026-06-09.md` tasks 1–6 exactly as written. Summary:

| Task | What | Commit |
|---|---|---|
| A1 | Discard uncommitted changes + delete debug script | none (restore) |
| A2 | Rewrite CLAUDE.md for V2 reality | `Rewrite CLAUDE.md for V2 reality` |
| A3 | Fix CHANGELOG duplicate `[Unreleased]` | `Fix duplicate [Unreleased] section in CHANGELOG` |
| A4 | Archive PROGRESS_LOG sessions 001-025 | `Archive PROGRESS_LOG sessions 001-025` |
| A5 | Delete dead V0 artifacts | `Remove dead V0 artifacts` |
| A6 | Add validator floor comment | `Add validator floor policy comment` |

**Verification**: `git status` clean, `pytest tests/ -q` passes, `py_compile` passes.

**DO NOT**: commit repair_sentence_count_minimum, refactor server.py, lower validator bounds, start M1/W11.

---

## Phase B — Hub UX Redesign (repo: `D:\felixbuilderhub`)

Three sub-phases. Each sub-phase = deployable increment. DO NOT mix sub-phases.

---

### Phase B1 — Navigation foundation (est. 1 week)

**Goal**: Kid sees where they are, one clear CTA, no free-jump to unfinished parts.

#### B1.1 — Write regression tests FIRST

Before ANY code change, create `tests/lesson-ux-regression.test.mjs` with these tests against the CURRENT codebase:

```javascript
// Test 1: Step buttons reflect completion state
// Mock a lesson with 6 activities, mark types 0-2 as completed
// Assert: buttons 0-2 have data-done="true", buttons 3-5 have data-done="false"

// Test 2: Activity nav buttons disable correctly  
// At activity index 0: prev disabled, next enabled
// At activity index 5: prev enabled, next disabled

// Test 3: retell_summary (activity 6) is reachable
// Verify ensureSixActivities injects retell when pack has 5 activities
// Verify showActivity(5) does not throw and shell is visible
```

These tests protect against regression during B1.2–B1.4. Must pass before AND after each sub-task.

**Commit**: `Add UX regression tests before redesign`

#### B1.2 — Replace ProgressBar with mission chrome

**File**: `src/components/read2lead/v2/ProgressBar.astro`

Replace the current `%`-only sticky bar with mission chrome showing `n/6` + dots:

```html
<section class="sticky top-0 z-30 border-b border-cream/10 bg-navy-950/95 backdrop-blur">
  <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
    <a href="/read2lead/review" class="text-sm font-semibold text-cream/70 hover:text-cream">← Hồ sơ</a>
    <div class="flex items-center gap-2">
      <span id="progress-part-label" class="text-sm font-bold text-gold">Phần 1/6</span>
      <div id="progress-dots" class="flex gap-1.5" aria-label="Tiến trình">
        <span class="r2l-dot" data-dot="0"></span>
        <span class="r2l-dot" data-dot="1"></span>
        <span class="r2l-dot" data-dot="2"></span>
        <span class="r2l-dot" data-dot="3"></span>
        <span class="r2l-dot" data-dot="4"></span>
        <span class="r2l-dot" data-dot="5"></span>
      </div>
    </div>
    <button id="sfx-toggle" type="button" class="text-xs font-medium text-cream/60 hover:text-cream">Tắt âm</button>
  </div>
</section>
```

**CSS** (add to `lesson.astro` `<style is:global>`):

```css
.r2l-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: rgb(245 230 211 / 0.15);
  transition: background 300ms ease, transform 300ms ease;
}
.r2l-dot[data-state="done"] { background: rgb(74 222 128); }
.r2l-dot[data-state="active"] { background: rgb(212 166 78); transform: scale(1.3); }
.r2l-dot[data-state="locked"] { background: rgb(245 230 211 / 0.15); }
```

**JS** — update `updateProgress()` in `lesson.astro`:

```javascript
function updateProgress() {
  const activities = state.lesson?.activities || [];
  const total = activities.length || 6;
  const currentIndex = state.activityIndex;

  // Update part label
  qs('#progress-part-label').textContent = `Phần ${currentIndex + 1}/${total}`;

  // Update dots
  qsa('[data-dot]').forEach((dot, i) => {
    const type = activities[i]?.type;
    if (type && state.completedTypes.has(type)) {
      dot.dataset.state = 'done';
    } else if (i === currentIndex) {
      dot.dataset.state = 'active';
    } else {
      dot.dataset.state = 'locked';
    }
  });

  // Submit button
  qs('#submit-lesson').disabled = state.completedTypes.size < total;
  renderStepStates();
}
```

Remove the old `#progress-fill` / `#progress-label` / `%` references. Move `#sfx-toggle` into the mission chrome (remove the separate toggle div in lesson.astro line 32-41).

**Commit**: `Replace % progress bar with n/6 dots mission chrome`

#### B1.3 — Single CTA with dynamic label

Replace the dual `Quay lại` / `Tiếp theo` per-activity nav with one global CTA.

**Step 1**: Delete `renderActivityNav()` function and its call in `renderAllActivitiesOnce()`.

**Step 2**: Add a global CTA section after the activity shells (between the `</section>` of activity shells and the trivia section):

```html
<section id="global-cta" class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
  <button id="lesson-continue" class="r2l-primary w-full text-lg" type="button" disabled>
    Tiếp tục →
  </button>
</section>
```

**Step 3**: Add JS function `updateGlobalCta()`:

```javascript
function updateGlobalCta() {
  const btn = qs('#lesson-continue');
  if (!btn) return;
  const activities = state.lesson?.activities || [];
  const current = activities[state.activityIndex];
  const currentType = current?.type;
  const isCurrentDone = currentType && state.completedTypes.has(currentType);
  const isLast = state.activityIndex >= activities.length - 1;
  const allDone = state.completedTypes.size >= activities.length;

  // Dynamic label
  if (allDone) {
    btn.textContent = 'Hoàn thành nhiệm vụ 🎉';
    btn.disabled = false;
  } else if (isCurrentDone && !isLast) {
    const nextActivity = activities[state.activityIndex + 1];
    const nextLabel = ACTIVITY_LABELS[nextActivity?.type] || 'bài tiếp';
    btn.textContent = `Phần tiếp: ${nextLabel} →`;
    btn.disabled = false;
  } else {
    btn.textContent = 'Tiếp tục →';
    btn.disabled = !isCurrentDone;
  }
}
```

**Step 4**: Wire CTA click handler:

```javascript
qs('#lesson-continue')?.addEventListener('click', () => {
  const activities = state.lesson?.activities || [];
  const allDone = state.completedTypes.size >= activities.length;

  if (allDone) {
    // Trigger submit flow (same as current submit-lesson click)
    qs('#submit-lesson')?.click();
    return;
  }

  finalizeCurrentActivityIfReady();
  if (state.activityIndex < activities.length - 1) {
    showActivity(state.activityIndex + 1);
  }
});
```

**Step 5**: Call `updateGlobalCta()` at end of: `showActivity()`, `updateProgress()`, `completeActivity()`.

**Commit**: `Replace dual nav with single dynamic CTA`

#### B1.4 — Step rail: lock uncompleted, allow revisit completed

Modify `showActivity()` — the step buttons in `ActivityProgress.astro` become read-only dots. But allow tapping completed parts:

```javascript
// Inside showActivity(), replace the button.onclick assignment:
button.onclick = () => {
  const type = activities[buttonIndex]?.type;
  // Allow revisit completed only, or current
  if (buttonIndex === state.activityIndex) return;
  if (type && state.completedTypes.has(type)) {
    finalizeCurrentActivityIfReady();
    showActivity(buttonIndex);
  }
  // Else: do nothing (locked)
};
```

Add visual lock:
```css
.r2l-step[data-state="locked"] {
  opacity: 0.4;
  cursor: not-allowed;
}
```

Update `renderStepStates()` to set `data-state` to `done`/`active`/`locked`.

**Commit**: `Lock uncompleted steps, allow revisit completed`

#### B1.5 — Verify phase B1

```bash
cd D:\felixbuilderhub && node --test tests/lesson-ux-regression.test.mjs
cd D:\felixbuilderhub && node --test tests/lesson-v2-six-activity-flow.test.mjs
```

All tests must pass. If they don't, fix before proceeding to B2.

---

### Phase B2 — Story Dock (est. 1 week)

**Goal**: Story always accessible without leaving current task. Highlight current sentence.

#### B2.1 — Create StoryDock component

**File**: `src/components/read2lead/v2/StoryDock.astro`

```html
<section id="story-dock" class="r2l-story-dock" data-dock-state="collapsed">
  <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
    <div class="flex items-center justify-between gap-3 py-3">
      <div class="flex items-center gap-2">
        <span class="text-lg" aria-hidden="true">📖</span>
        <h2 id="dock-title" class="text-base font-bold text-cream"></h2>
      </div>
      <div class="flex gap-2">
        <button id="dock-toggle" class="r2l-secondary px-3 py-1.5 text-xs" type="button">Mở truyện ▼</button>
        <button id="dock-play-story" class="r2l-secondary px-3 py-1.5 text-xs" type="button">🔊 Cả truyện</button>
      </div>
    </div>
    <p id="dock-preview" class="pb-3 text-sm leading-6 text-cream/70 line-clamp-2"></p>
    <div id="dock-expanded" class="hidden border-t border-cream/10 py-4">
      <div id="dock-paragraphs" class="space-y-3 text-base leading-8 text-cream/85"></div>
      <div id="dock-sentences" class="mt-4 max-h-[280px] space-y-2 overflow-y-auto pr-1"></div>
    </div>
  </div>
</section>
```

**CSS**:

```css
.r2l-story-dock {
  border-bottom: 1px solid rgb(245 230 211 / 0.1);
  background: rgb(245 230 211 / 0.03);
  transition: max-height 300ms ease;
}
.r2l-story-dock [data-highlight="true"] {
  background: rgb(212 166 78 / 0.2);
  border-radius: 4px;
  padding: 0 4px;
}
```

#### B2.2 — Wire StoryDock into lesson.astro

**Replace** the current story section (lines 53-73 of lesson.astro — the grid with story paragraphs + tap-to-play sidebar) with the StoryDock component import + placement BEFORE the activity shells.

Keep the existing `#sentence-list` data/audio logic but move its rendering into the dock's `#dock-sentences` container.

**JS functions to add**:

```javascript
function initStoryDock(story) {
  qs('#dock-title').textContent = story.title || '';
  const firstParagraph = (story.paragraphs_en || [])[0] || '';
  qs('#dock-preview').textContent = firstParagraph.slice(0, 120) + (firstParagraph.length > 120 ? '…' : '');

  // Expanded content
  qs('#dock-paragraphs').innerHTML = (story.paragraphs_en || [])
    .map((p, i) => `<p data-paragraph-index="${i}">${escapeHtml(p)}</p>`)
    .join('');

  // Reuse existing sentence rendering into dock
  renderSentences(story.sentences || [], '#dock-sentences');

  // Toggle
  qs('#dock-toggle')?.addEventListener('click', toggleDock);
  qs('#dock-play-story')?.addEventListener('click', () => {
    playAudio(story.full_audio_url || '', qs('#dock-play-story'));
  });
  setStoryAudioButtonState(qs('#dock-play-story'), story.full_audio_url || '');
}

function toggleDock() {
  const dock = qs('#story-dock');
  const expanded = qs('#dock-expanded');
  const toggle = qs('#dock-toggle');
  if (dock.dataset.dockState === 'collapsed') {
    dock.dataset.dockState = 'expanded';
    expanded.classList.remove('hidden');
    toggle.textContent = 'Thu gọn ▲';
  } else {
    dock.dataset.dockState = 'collapsed';
    expanded.classList.add('hidden');
    toggle.textContent = 'Mở truyện ▼';
  }
}

function highlightDockSentence(sentenceText) {
  // Clear previous highlights
  qsa('#dock-paragraphs [data-highlight]').forEach(el => el.removeAttribute('data-highlight'));

  if (!sentenceText) return;
  qsa('#dock-paragraphs p').forEach(p => {
    const idx = p.textContent.indexOf(sentenceText);
    if (idx >= 0) {
      const before = p.textContent.slice(0, idx);
      const match = p.textContent.slice(idx, idx + sentenceText.length);
      const after = p.textContent.slice(idx + sentenceText.length);
      p.innerHTML = `${escapeHtml(before)}<mark data-highlight="true">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
    }
  });
}
```

**Auto-expand rules**: In `showActivity()`, add after `shell.hidden = false`:

```javascript
// Auto-expand dock for written response (part 4) and retell (part 6)
const autoExpandTypes = ['written_response', 'retell_summary'];
if (autoExpandTypes.includes(activity.type) && qs('#story-dock').dataset.dockState === 'collapsed') {
  toggleDock();
}
```

**Sentence highlight**: Each activity render function should call `highlightDockSentence(sentenceText)` when an item becomes active. For paginated items (future B3), this fires on each item switch.

**Commit**: `Add Story Dock component with expand/collapse and sentence highlight`

#### B2.3 — Remove old story grid

Delete the old `section.grid.gap-4.lg:grid-cols` that held story paragraphs + sidebar (lines 54-73 in current lesson.astro). The StoryDock replaces it entirely.

Verify: the old `#story-paragraphs` and `#sentence-list` IDs are now inside the dock, not orphaned.

**Commit**: `Remove old story grid (replaced by Story Dock)`

---

### Phase B3 — Loop Pack + Minny + Parent strip (est. 1 week)

**Goal**: Micro-dopamine per item, Minny as coach strip, parent knows what's happening.

#### B3.1 — Minny command strip

**File**: `src/components/read2lead/v2/MinnyCoachStrip.astro`

```html
<div id="minny-strip" class="flex items-center gap-3 rounded-md bg-cream/[0.04] px-4 py-2.5">
  <img
    id="minny-strip-avatar"
    src="/assets/minny/minny_idle.png"
    alt="Minny"
    width="48" height="48"
    class="flex-shrink-0"
  />
  <p id="minny-strip-bubble" class="text-sm font-medium text-cream/90"></p>
</div>
```

**JS API** — add to lesson.astro:

```javascript
const MINNY_COMMANDS = {
  listening_fill_blank: 'Con nghe rồi chọn cụm từ còn thiếu nhé!',
  listen_and_order: 'Con bấm từ theo đúng thứ tự câu nhé!',
  reading_comprehension: 'Con đọc truyện rồi chọn đáp án đúng!',
  written_response: 'Con viết 1–2 câu tiếng Anh nhé!',
  listen_and_speak: 'Nghe rồi nói lại cho Minny nghe nhé!',
  retell_summary: 'Con dùng gợi ý, kể lại truyện bằng tiếng Anh!',
};

const MINNY_CELEBRATE = [
  'Hay lắm! Minny thấy con giỏi rồi!',
  'Tuyệt vời! Câu tiếp nhé!',
  'Minny vui quá! Con làm đúng rồi!',
];

const MINNY_ENCOURAGE = [
  'Không sao — mình thử lại nhé!',
  'Gần đúng rồi! Con thử lần nữa!',
];

function setMinnyStrip(mood, text) {
  const avatar = qs('#minny-strip-avatar');
  const bubble = qs('#minny-strip-bubble');
  if (avatar) avatar.src = `/assets/minny/minny_${mood || 'idle'}.png`;
  if (bubble) bubble.textContent = text || '';
}

// Streak tracking within current part
let _itemStreak = 0;

function onItemCorrect() {
  _itemStreak++;
  if (_itemStreak >= 3) {
    setMinnyStrip('celebrate', `${_itemStreak} câu liên tiếp đúng! Giỏi quá!`);
  } else {
    setMinnyStrip('celebrate', MINNY_CELEBRATE[Math.floor(Math.random() * MINNY_CELEBRATE.length)]);
  }
  showReward({ mode: 'mini' });
}

function onItemWrong(questionId) {
  _itemStreak = 0;
  setMinnyStrip('encourage', MINNY_ENCOURAGE[Math.floor(Math.random() * MINNY_ENCOURAGE.length)]);
  playWrongSfx(questionId);
}
```

**Wire into showActivity()**: at the end, after `shell.hidden = false`:

```javascript
setMinnyStrip('idle', MINNY_COMMANDS[activity.type] || '');
_itemStreak = 0;
```

**Wire into each activity's correct/wrong handlers**: replace direct `playSfx`/`showReward` calls with `onItemCorrect()` / `onItemWrong(id)`.

**Place MinnyCoachStrip** between StoryDock and activity shells in lesson.astro markup. For parts 5-6 (listen_and_speak, retell_summary), use the existing large Minny hero (`data-minny-hero`) — the strip is hidden. For parts 1-4, strip is visible, large hero is hidden.

```javascript
// In showActivity(), toggle strip vs hero:
const useLargeMinny = ['listen_and_speak', 'retell_summary'].includes(activity.type);
qs('#minny-strip').hidden = useLargeMinny;
```

**Commit**: `Add MinnyCoachStrip with mood + bubble + streak counter`

#### B3.2 — Meso interstitial between parts

When `completeActivity(type)` fires AND there's a next part, show a 2-second interstitial before enabling CTA:

```javascript
function showMesoInterstitial(completedIndex, nextIndex) {
  const activities = state.lesson?.activities || [];
  const nextActivity = activities[nextIndex];
  if (!nextActivity) return;

  const nextLabel = ACTIVITY_LABELS[nextActivity.type] || 'bài tiếp';
  const partNum = completedIndex + 1;

  // Reuse RewardBurst or create simple overlay
  const burst = qs('#reward-burst');
  const title = qs('#reward-burst-title');
  const copy = qs('#reward-burst-copy');
  title.textContent = `Phần ${partNum} xong ⭐`;
  copy.textContent = `Tiếp: ${nextLabel}`;
  burst.dataset.tier = 'common';
  burst.dataset.mode = 'celebrate';
  burst.dataset.show = 'true';

  playSfx(SFX.activityComplete);

  // Don't auto-dismiss — wait for CTA click (user confirms readiness)
  // CTA label already updated by updateGlobalCta()
}
```

Call `showMesoInterstitial()` inside `completeActivity()` after `showReward()`.

**Commit**: `Add meso interstitial between activity parts`

#### B3.3 — Parent strip

**File**: `src/components/read2lead/v2/ParentStrip.astro`

```html
<details id="parent-strip" class="rounded-md border border-cream/10 bg-cream/[0.03]">
  <summary class="cursor-pointer px-4 py-2.5 text-xs font-semibold text-cream/50 hover:text-cream/70">
    Ba mẹ xem hướng dẫn ▼
  </summary>
  <div class="border-t border-cream/10 px-4 py-3 text-xs text-cream/60 space-y-1.5">
    <p id="parent-doing"><strong>Đang làm:</strong> <span></span></p>
    <p id="parent-needs"><strong>Con cần:</strong> <span></span></p>
    <p id="parent-stuck"><strong>Nếu kẹt:</strong> <span></span></p>
  </div>
</details>
```

**JS** — parent guidance templates per activity type:

```javascript
const PARENT_GUIDE = {
  listening_fill_blank: {
    doing: (n, total) => `Phần ${n}/${total}: Nghe điền — chọn cụm từ đúng`,
    needs: 'Bấm nút Nghe, rồi chọn 1 trong 3 đáp án',
    stuck: 'Bấm Nghe lại nếu chưa rõ',
  },
  listen_and_order: {
    doing: (n, total) => `Phần ${n}/${total}: Xếp câu — sắp xếp từ thành câu đúng`,
    needs: 'Bấm từng từ theo đúng thứ tự',
    stuck: 'Bấm Nghe câu gốc để nhớ lại',
  },
  reading_comprehension: {
    doing: (n, total) => `Phần ${n}/${total}: Đọc hiểu — chọn đáp án A/B/C`,
    needs: 'Đọc truyện ở trên, rồi chọn đáp án',
    stuck: 'Bấm "Mở truyện" để đọc lại',
  },
  written_response: {
    doing: (n, total) => `Phần ${n}/${total}: Viết — viết câu trả lời tiếng Anh`,
    needs: 'Viết 1–2 câu tiếng Anh vào ô trống',
    stuck: 'Con có thể viết ngắn, không cần hoàn hảo',
  },
  listen_and_speak: {
    doing: (n, total) => `Phần ${n}/${total}: Nói lại — nghe rồi đọc theo`,
    needs: 'Bấm Nghe, rồi bấm Thu âm và đọc to',
    stuck: 'Micro: Cài đặt → Safari/Chrome → Cho phép micro → felixbuilderhub.com',
  },
  retell_summary: {
    doing: (n, total) => `Phần ${n}/${total}: Kể truyện — kể lại bằng tiếng Anh`,
    needs: 'Dùng 4 gợi ý, kể bằng tiếng Anh 30–60 giây',
    stuck: 'Micro: Cài đặt → Safari/Chrome → Cho phép micro → felixbuilderhub.com',
  },
};

function updateParentStrip() {
  const activities = state.lesson?.activities || [];
  const activity = activities[state.activityIndex];
  if (!activity) return;
  const guide = PARENT_GUIDE[activity.type];
  if (!guide) return;
  const n = state.activityIndex + 1;
  const total = activities.length;
  qs('#parent-doing span').textContent = guide.doing(n, total);
  qs('#parent-needs span').textContent = guide.needs;
  qs('#parent-stuck span').textContent = guide.stuck;
}
```

Call `updateParentStrip()` at end of `showActivity()`.

Place ParentStrip right below mission chrome (ProgressBar), above StoryDock.

**Commit**: `Add parent guidance strip with per-activity help text`

#### B3.4 — Submit confirmation modal

Replace the direct submit with a confirmation modal when all parts done:

When kid clicks "Hoàn thành nhiệm vụ 🎉" CTA, show:

```html
<div id="submit-confirm-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div class="mx-4 max-w-sm rounded-xl bg-navy-900 border border-gold/30 p-6 text-center">
    <img src="/assets/minny/minny_celebrate.png" alt="Minny" width="80" height="80" class="mx-auto mb-3" />
    <p class="font-display text-xl font-bold text-gold">Con đã xong bài!</p>
    <p class="mt-2 text-sm text-cream/80">Lưu chiến công hôm nay?</p>
    <div class="mt-5 flex gap-3 justify-center">
      <button id="submit-confirm-yes" class="r2l-primary px-6" type="button">Lưu chiến công</button>
      <button id="submit-confirm-no" class="r2l-secondary px-4" type="button">Quay lại</button>
    </div>
  </div>
</div>
```

JS: `#submit-confirm-yes` triggers actual submit. `#submit-confirm-no` closes modal.

**Commit**: `Add submit confirmation modal with Minny celebrate`

#### B3.5 — Verify phase B3

```bash
cd D:\felixbuilderhub && node --test tests/
```

All tests pass. Visual check: load a lesson, verify strip shows per activity, CTA label changes, interstitial appears between parts.

---

## Phase B — DO NOT list

These are explicitly NOT for Cursor in this spec:

- [ ] Do NOT add item-level pagination (future W-UX2 — not this spec)
- [ ] Do NOT implement server-side Minny TTS voice
- [ ] Do NOT build `/read2lead/speaking` (M2 — separate spec)
- [ ] Do NOT add analytics/telemetry events (future W-UX4)
- [ ] Do NOT touch backend `server.py` or `prompt_v2.py`
- [ ] Do NOT introduce new npm dependencies (use existing Astro + vanilla JS)
- [ ] Do NOT rename existing CSS classes that hub tests assert against — add new classes alongside

---

## Minny voice rules (from M0 — enforce in all bubble text)

Source: `_claude/MINNY_M0_DESIGN_OUTCOME.md` §3.2

| Rule | Correct | Wrong |
|---|---|---|
| Xưng **Minny** / **con** | "Minny thấy con giỏi rồi!" | "Em làm tốt lắm!" |
| No red, no "sai" | "Mình thử lại nhé!" | "Sai rồi! Đáp án đúng là..." |
| Ngắn: 1–2 câu max | "Hay lắm! Câu tiếp!" | (paragraph) |
| VN primary | "Con bấm từ theo thứ tự" | "Click the words in order" |
| Celebrate effort | "Con nói rõ hơn lần trước!" | "Con được 85 điểm!" |
| Không % trực tiếp khi fail | "Gần đúng rồi! Thử lần nữa!" | "Con chỉ được 40%" |

All `MINNY_COMMANDS`, `MINNY_CELEBRATE`, `MINNY_ENCOURAGE` strings in B3.1 follow these rules. Do not deviate.

---

## Commit order summary

```
A1  (no commit — restore only)
A2  Rewrite CLAUDE.md for V2 reality
A3  Fix duplicate [Unreleased] section in CHANGELOG
A4  Archive PROGRESS_LOG sessions 001-025
A5  Remove dead V0 artifacts
A6  Add validator floor policy comment
B1.1  Add UX regression tests before redesign
B1.2  Replace % progress bar with n/6 dots mission chrome
B1.3  Replace dual nav with single dynamic CTA
B1.4  Lock uncompleted steps, allow revisit completed
B2.1  (no separate commit — part of B2.2)
B2.2  Add Story Dock component with expand/collapse and sentence highlight
B2.3  Remove old story grid (replaced by Story Dock)
B3.1  Add MinnyCoachStrip with mood + bubble + streak counter
B3.2  Add meso interstitial between activity parts
B3.3  Add parent guidance strip with per-activity help text
B3.4  Add submit confirmation modal with Minny celebrate
```

Total: 15 commits across 2 repos. Each deployable independently.

---

## Cross-repo verification (after all phases)

```bash
# Backend
cd D:\Read2lead\read2lead_v0_codex
git status   # clean
pytest tests/ -q   # all pass
python -m py_compile api/server.py api/prompt_v2.py api/generator_v2.py api/validator_v2.py

# Hub
cd D:\felixbuilderhub
git status   # clean
node --test tests/   # all pass
npx astro check      # no errors
```

---

*End of spec. Cursor: execute Phase A first, verify, then Phase B1 → B2 → B3. Do NOT parallelize phases.*
