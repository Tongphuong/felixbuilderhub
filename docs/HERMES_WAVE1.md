# Hermes Task: Wave 1 Frontend — ReadAloud Activity

> Read AGENT_LOG.md first for context. Read CLAUDE.md for architecture.
> Codex is doing the backend/Workers part in parallel (Tasks 0B, 0C, 1A, 1E, 1F, 1G).
> You do the frontend part: the ReadAloud component + lesson.astro wiring.

---

## Context

The lesson currently has 4 activities in order:
1. `listening_fill_blank` — "Nghe điền"
2. `listen_and_order` — "Xếp câu"
3. `reading_comprehension` — "Đọc hiểu"
4. `listen_and_speak` — "Nói lại" (student hears model audio, then records)

We're adding a 5th activity: **read_aloud** ("Đọc to"). The student sees each sentence on screen, reads it aloud WITHOUT hearing the model first, and Whisper scores the recording.

Also: rename `listen_and_speak` label from "Nói lại" to "Nói theo" (it's functionally Shadow — listen then repeat).

**After your work, lesson order:**
1. Nghe điền
2. Xếp câu
3. Đọc hiểu
4. Nói theo (was "Nói lại") — listen + speak + Whisper score
5. **Đọc to** (NEW) — read + speak + Whisper score, NO model audio

---

## Task 1C: Create ReadAloud.astro component

**New file:** `src/components/read2lead/v2/ReadAloud.astro`

**Reference:** Copy structure from `src/components/read2lead/v2/ListenAndSpeak.astro` in the same directory. It's a small shell — the actual rendering happens in lesson.astro JS.

**Content:**
```astro
---
import MicCheckPanel from './MicCheckPanel.astro';
---

<section class="r2l-activity r2l-minny-activity" data-activity-shell="read_aloud" hidden>
  <div class="r2l-activity-head">
    <p class="r2l-identity" data-activity-identity></p>
    <h2 data-activity-title></h2>
    <p data-activity-instructions></p>
  </div>
  <div class="r2l-minny-hero-wrap">
    <div class="r2l-minny-hero" data-minny-hero="read_aloud">
      <video class="r2l-minny-video hidden" data-minny-video
        poster="/assets/minny/minny_idle.png" autoplay loop muted playsinline aria-hidden="true"
      ></video>
      <img class="r2l-minny-fallback" data-minny-fallback
        src="/assets/minny/minny_idle.png" alt="Minny" width="160" height="160"
      />
    </div>
  </div>
  <MicCheckPanel />
  <div data-activity-body></div>
</section>
```

Key differences from ListenAndSpeak.astro:
- `data-activity-shell="read_aloud"` (not `listen_and_speak`)
- `data-minny-hero="read_aloud"` (not `listen_and_speak`)
- Everything else is identical

---

## Task 1B + 1D: Wire ReadAloud into lesson.astro

**File:** `src/pages/read2lead/lesson.astro`
**WARNING:** This file is ~5000 lines. It's PROTECTED (see AGENTS.md §1). Make targeted edits only.

### Edit 1 — Import + HTML (top of file)

Find the import for ListenAndSpeak (around line 8):
```javascript
import ListenAndSpeak from '../../components/read2lead/v2/ListenAndSpeak.astro';
```

Add after it:
```javascript
import ReadAloud from '../../components/read2lead/v2/ReadAloud.astro';
```

Find where `<ListenAndSpeak />` appears in the HTML template (around line 103). Add after it:
```html
<ReadAloud />
```

### Edit 2 — ACTIVITY_LABELS (line 916-921)

Find:
```javascript
  const ACTIVITY_LABELS = {
    listening_fill_blank: 'Nghe điền',
    listen_and_order: 'Xếp câu',
    reading_comprehension: 'Đọc hiểu',
    listen_and_speak: 'Nói lại',
  };
```

Replace with:
```javascript
  const ACTIVITY_LABELS = {
    listening_fill_blank: 'Nghe điền',
    listen_and_order: 'Xếp câu',
    reading_comprehension: 'Đọc hiểu',
    listen_and_speak: 'Nói theo',
    read_aloud: 'Đọc to',
  };
```

### Edit 3 — FRONTEND_ACTIVITY_ORDER (line 922-927)

Find:
```javascript
  const FRONTEND_ACTIVITY_ORDER = [
    'listening_fill_blank',
    'listen_and_order',
    'reading_comprehension',
    'listen_and_speak',
  ];
```

Replace with:
```javascript
  const FRONTEND_ACTIVITY_ORDER = [
    'listening_fill_blank',
    'listen_and_order',
    'reading_comprehension',
    'listen_and_speak',
    'read_aloud',
  ];
```

### Edit 4 — MINNY_COMMANDS (line 929-934)

Find:
```javascript
    listen_and_speak: 'Nghe rồi nói lại cho Minny nghe nhé!',
```

Replace with:
```javascript
    listen_and_speak: 'Nghe rồi nói theo cho Minny nghe nhé!',
    read_aloud: 'Con đọc to từng câu cho Minny nghe nhé!',
```

### Edit 5 — PARENT_GUIDE (line 947-968)

Find the `listen_and_speak` entry in PARENT_GUIDE. After its closing `},`, add:
```javascript
    read_aloud: {
      doing: (n, total) => `Phần ${n}/${total}: Đọc to — con đọc từng câu`,
      needs: 'Con đọc câu trên màn hình, rồi bấm Con nói',
      stuck: 'Con đọc chậm, rõ ràng — không cần nghe mẫu',
    },
```

### Edit 6 — ACTIVITY_EMOJI (around line 1069)

Find:
```javascript
    listen_and_speak: '🎙️',
```

Add after it:
```javascript
    read_aloud: '📖',
```

### Edit 7 — useLargeMinny (around line 3965)

Find:
```javascript
    const useLargeMinny = activity.type === 'listen_and_speak';
```

Replace with:
```javascript
    const useLargeMinny = activity.type === 'listen_and_speak' || activity.type === 'read_aloud';
```

### Edit 8 — renderAllActivitiesOnce (around line 3834)

Find the block that handles `listen_and_speak`:
```javascript
    } else if (activity.type === 'listen_and_speak') {
```

After its closing `}`, add:
```javascript
    } else if (activity.type === 'read_aloud') {
      renderReadAloudActivity(body, activity);
    }
```

### Edit 9 — New function: renderReadAloudActivity

Add this function near the existing `renderSpeakActivity` function (search for `function renderSpeakActivity` or the listen_and_speak rendering code around line 4765).

This is like the speak rendering but WITHOUT "Nghe" (listen) buttons. Each card has:
- Sentence text (English + Vietnamese)
- One record button: `🎤 Con nói`
- Feedback area (hidden until scored)

```javascript
  function renderReadAloudActivity(root, activity) {
    const heroScope = root.closest('[data-activity-shell="read_aloud"]');
    _r2lInitMinnyHero(heroScope);

    root.innerHTML = `
      <p class="mt-2 text-sm font-semibold text-gold">Con đọc to từng câu — không cần nghe mẫu.</p>
      <div class="mt-5 space-y-5">
        ${(activity.items || [])
          .map(
            (item, idx) => `
              <article class="r2l-minny-sentence-card" data-speak-card="${idx}" data-item-key="${escapeHtml(item.id || 'ra_' + idx)}" data-native-audio-url="${escapeHtml(item.audio_url || '')}">
                <p class="r2l-minny-sentence-en">${escapeHtml(item.text_en)}</p>
                ${item.text_vi ? '<p class="r2l-minny-sentence-vi">' + escapeHtml(item.text_vi) + '</p>' : ''}
                <div class="r2l-minny-speak-actions">
                  <button type="button" class="minny-btn minny-btn--record" data-speak-record="${idx}">🎤 Con nói</button>
                </div>
                <div class="mt-3 hidden rounded-md border border-cream/10 bg-navy-950/35 p-3 text-sm text-cream/80" data-speak-feedback></div>
              </article>
            `,
          )
          .join('')}
      </div>
    `;

    // Wire record buttons — no listen step needed for read_aloud
    root.querySelectorAll('[data-speak-record]').forEach((btn) => {
      const idx = Number(btn.dataset.speakRecord);
      const item = activity.items?.[idx] || {};
      const itemKey = item.id || 'ra_' + idx;
      const cardEl = root.querySelector('[data-speak-card="' + idx + '"]');

      // Mark as "heard" immediately (no listen step)
      btn.dataset.heard = 'true';
      _r2lInitSpeakRecorder(itemKey, cardEl, item?.text_en || '');

      btn.addEventListener('click', () => {
        const entry = _r2lRecorderState.perItem.get(itemKey);
        if (entry?.status === 'recording') {
          _r2lStopRecording(itemKey, cardEl);
        } else if (entry?.checkStatus !== 'uploading') {
          _r2lSetMinnyMood('listen', heroScope);
          _r2lStartRecording(itemKey, cardEl);
        }
      });
    });

    restoreReadAloudProgress(root, activity);
  }
```

### Edit 10 — Scoring + progress functions

**Option A (simpler):** Duplicate the listen_and_speak scoring functions for read_aloud. Search for `_r2lMergeSpeakActivityScores` — it stores results under `state.activityResults.listen_and_speak` and calls `completeActivity('listen_and_speak', ...)`. Create a parallel `_r2lMergeReadAloudScores` that does the same but with `'read_aloud'`.

**Option B (cleaner):** Refactor both into a generic function `_r2lMergeSpeakingScores(activityType, activity)` that takes the type as parameter. Then call it with `'listen_and_speak'` and `'read_aloud'` respectively.

Similarly for `restoreSpeakActivityProgress` → create `restoreReadAloudProgress`.

### Edit 11 — Mic gate extension

Find `_r2lApplyMicGate` (around line 1242). It currently only gates `listen_and_speak`:
```javascript
    const speakShell = qs('[data-activity-shell="listen_and_speak"]');
```

Extend to also gate `read_aloud`:
```javascript
    const speakShell = qs('[data-activity-shell="listen_and_speak"]');
    const readAloudShell = qs('[data-activity-shell="read_aloud"]');
    [speakShell, readAloudShell].filter(Boolean).forEach((shell) => {
```

And apply the same mic check logic to both shells.

### Edit 12 — Mic check mount

Find where `_r2lMountMicCheck` is called when showing listen_and_speak (search for `_r2lMountMicCheck`). Add the same call for read_aloud:
```javascript
    if (activity.type === 'listen_and_speak' || activity.type === 'read_aloud') {
      _r2lMountMicCheck(shell);
    }
```

---

## VERIFICATION

```bash
npx astro check
npx astro build
node --test
```

All must pass. Then start the dev server (`npx astro dev`) and manually test:
1. Load a lesson with a real access code
2. Complete activities A, B, C
3. Complete "Nói theo" (listen_and_speak) — verify label changed from "Nói lại"
4. A new activity "Đọc to" should appear — verify:
   - Each sentence shows text but NO "Nghe" button
   - Record button works
   - Whisper scoring gives feedback
5. Complete all activities, submit lesson

---

## COMMIT

Single commit: `feat: add ReadAloud activity (Phase 5) + rename listen_and_speak label to Nói theo`

Push to branch `hermes/wave1-read-aloud`. Do NOT push to main.

---

## REPORT BACK

1. Commit hash
2. Test output (pass count)
3. Screenshot of ReadAloud activity in dev server
4. Any issues encountered
