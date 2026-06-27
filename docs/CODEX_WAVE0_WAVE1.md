# Codex Task: Wave 0 + Wave 1 (Backend/Workers)

> Paste this to Codex. Read AGENT_LOG.md first for context on what Claude did this session.

---

## READ ORDER

1. `CLAUDE.md` — project architecture
2. `AGENTS.md` — rules
3. `AGENT_LOG.md` — what just happened (Jun 27 session)
4. This file — your tasks

---

## WAVE 0: Housekeeping

### Task 0B: Sync root schema

**What:** Copy `backend/schemas/pack.schema.v2.json` to `schemas/pack.schema.v2.json` (overwrite).

**Why:** Root schema is stale — missing `guided_listening`, wrong `activities.minItems` (5 should be 4), wrong `listen_and_speak.items.maxItems` (5 should be 35), `reading_comprehension.required` includes Vietnamese fields the backend doesn't generate.

**Command:**
```bash
cp backend/schemas/pack.schema.v2.json schemas/pack.schema.v2.json
```

**Verify:**
```bash
node --test
```
All 634 tests must still pass.

**Commit:** `fix: sync root schema with backend schema — add guided_listening, fix activity constraints`

---

### Task 0C: Fix CLAUDE.md dead reference

**What:** In `CLAUDE.md`, there are 2 references to `_ops/specs/MASTER_PLAN.md`. This file does not exist. The `_ops/` directory does not exist.

**Find these lines (around line 108 and line 148):**
```
_ops/specs/MASTER_PLAN.md
```

**Replace with:**
```
documented inline in this file (see "Upcoming redesign" section)
```

There are exactly 2 occurrences. Search with `grep -n "MASTER_PLAN" CLAUDE.md` to find them.

**Commit:** `fix: remove dead MASTER_PLAN.md references from CLAUDE.md`

---

## WAVE 1: ReadAloud Activity (Codex parts only)

### Context

The lesson currently has 4 activities: A (listening_fill_blank), B (listen_and_order), C (reading_comprehension), E (listen_and_speak). There's a function `ensureSixActivities()` in `functions/api/_read2lead-lesson-activities.js` that injects a `read_aloud` stub after listen_and_speak — but the stub has NO items. The frontend (lesson.astro) has NO read_aloud handling.

Your job: make the backend/Workers side ready. Hermes will handle the frontend (lesson.astro + component).

---

### Task 1A: Populate read_aloud items from story sentences

**File:** `functions/api/_read2lead-lesson-activities.js`

**Step 1 — Update the constant (line 5-10):**

Find:
```javascript
export const READ_ALOUD_ACTIVITY = {
  type: 'read_aloud',
  title_vi: 'Đọc to',
  identity_vi: 'Con đọc to từng câu cho Minny nghe nhé!',
  instructions_vi: 'Con đọc từng câu trong truyện, Minny sẽ chấm điểm.',
};
```

Replace with:
```javascript
export const READ_ALOUD_ACTIVITY = {
  type: 'read_aloud',
  title_vi: 'Đọc to',
  identity_vi: 'Con đọc to từng câu cho Minny nghe nhé!',
  instructions_vi: 'Con đọc từng câu trong truyện, Minny sẽ chấm điểm.',
  scoring_mode: 'whisper_stt',
};
```

**Step 2 — Populate items inside `ensureSixActivities` function:**

Find this line (around line 35):
```javascript
  const readAloud = { ...READ_ALOUD_ACTIVITY };
```

Add IMMEDIATELY AFTER that line:
```javascript
  if (lessonContext?.story?.sentences?.length) {
    readAloud.items = lessonContext.story.sentences.map((sentence, i) => ({
      id: `ra_${i}`,
      text_en: sentence.text_en || '',
      text_vi: sentence.text_vi || '',
      tip_vi: 'Con đọc to, rõ ràng nhé!',
      audio_url: sentence.audio_url || '',
    }));
  }
```

**Verify:** Read the full function after your edit. The `lessonContext` parameter is already declared on line 17. The story sentences come from the pack data passed by `read2lead-lesson.js`.

---

### Task 1E: Update submission endpoint

**File:** `functions/api/submit-read2lead-lesson.js`

**Step 1 — Find `ACTIVE_LESSON_ACTIVITY_TYPES` (around line 133):**

It looks like:
```javascript
const ACTIVE_LESSON_ACTIVITY_TYPES = new Set([
  'listening_fill_blank',
  'listen_and_order',
  'reading_comprehension',
  'listen_and_speak',
]);
```

Add `'read_aloud'` to the set:
```javascript
const ACTIVE_LESSON_ACTIVITY_TYPES = new Set([
  'listening_fill_blank',
  'listen_and_order',
  'reading_comprehension',
  'listen_and_speak',
  'read_aloud',
]);
```

**Step 2 — Find `SPEAKING_ACTIVITY_TYPES` (around line 139):**

It looks like:
```javascript
const SPEAKING_ACTIVITY_TYPES = new Set(['listen_and_speak']);
```

Add `'read_aloud'`:
```javascript
const SPEAKING_ACTIVITY_TYPES = new Set(['listen_and_speak', 'read_aloud']);
```

**Step 3 — Find `hasSpeakActivity` (around line 316):**

Search for `hasSpeakActivity`. It checks if any activity result has type `listen_and_speak`. Extend it:

```javascript
const hasSpeakActivity = activityResults.some(
  (r) => r?.type === 'listen_and_speak' || r?.type === 'read_aloud',
);
```

If it uses `SPEAKING_ACTIVITY_TYPES.has()` instead, that's already covered by Step 2.

---

### Task 1F: Update both schemas to allow read_aloud

**File 1:** `backend/schemas/pack.schema.v2.json`
**File 2:** `schemas/pack.schema.v2.json` (after Task 0B sync, they're identical)

**Step 1 — Change `activities.maxItems`:**

Find:
```json
"maxItems": 5,
```
(in the `activities` property definition)

Change to:
```json
"maxItems": 6,
```

**Step 2 — Add `read_aloud` to `oneOf`:**

Find the `oneOf` array inside `activities.items`. It has references like:
```json
{ "$ref": "#/definitions/listening_fill_blank" },
{ "$ref": "#/definitions/listen_and_order" },
{ "$ref": "#/definitions/reading_comprehension" },
{ "$ref": "#/definitions/listen_and_speak" }
```

Add at the end:
```json
{ "$ref": "#/definitions/read_aloud" }
```

**Step 3 — Add `read_aloud` definition:**

Find the `listen_and_speak` definition in the `definitions` section. Copy it entirely. In the copy:
- Change `"listen_and_speak"` key to `"read_aloud"`
- Change `"type": { "const": "listen_and_speak" }` to `"type": { "const": "read_aloud" }`

Add this new definition after the `listen_and_speak` definition.

**IMPORTANT:** Do this in BOTH schema files. After Task 0B they're identical, so the same edits apply to both.

---

### Task 1G: Write tests

**File:** `tests/read2lead-lesson-activities.test.mjs`

Add these tests at the end of the file:

```javascript
test('ensureSixActivities populates read_aloud items from story sentences', () => {
  const activities = [
    { type: 'listening_fill_blank', items: [] },
    { type: 'listen_and_order', items: [] },
    { type: 'reading_comprehension', items: [] },
    { type: 'listen_and_speak', items: [] },
  ];
  const lessonContext = {
    story: {
      sentences: [
        { text_en: 'The cat sat.', text_vi: 'Con mèo ngồi.', audio_url: 'https://audio.test/1.mp3' },
        { text_en: 'It was happy.', text_vi: 'Nó vui.', audio_url: 'https://audio.test/2.mp3' },
      ],
    },
  };
  const result = ensureSixActivities(activities, lessonContext);
  const ra = result.find((a) => a.type === 'read_aloud');
  assert.ok(ra, 'read_aloud activity should exist');
  assert.equal(ra.items.length, 2, 'should have 2 items from story');
  assert.equal(ra.items[0].text_en, 'The cat sat.');
  assert.equal(ra.items[0].id, 'ra_0');
  assert.equal(ra.scoring_mode, 'whisper_stt');
});

test('ensureSixActivities does not duplicate read_aloud', () => {
  const activities = [
    { type: 'listening_fill_blank', items: [] },
    { type: 'listen_and_speak', items: [] },
    { type: 'read_aloud', items: [{ id: 'existing' }] },
  ];
  const result = ensureSixActivities(activities);
  const raCount = result.filter((a) => a.type === 'read_aloud').length;
  assert.equal(raCount, 1, 'should not inject duplicate read_aloud');
});
```

**IMPORTANT:** You'll need to import `ensureSixActivities` at the top. Check how the existing tests in the file import it. If they don't import it yet, add:
```javascript
import { ensureSixActivities } from '../functions/api/_read2lead-lesson-activities.js';
```

---

## VERIFICATION

After all tasks, run:
```bash
npx astro check
node --test
```

All tests must pass (634+ existing + your new ones).

---

## COMMIT ORDER

1. `fix: sync root schema with backend schema` (Task 0B)
2. `fix: remove dead MASTER_PLAN.md references` (Task 0C)
3. `feat: populate read_aloud items from story sentences + update scoring types` (Tasks 1A + 1E + 1F + 1G combined)

Push to branch `codex/wave1-read-aloud`. Do NOT push to main.

---

## REPORT BACK

When done, report:
1. Commit hashes for each commit
2. Test output (pass count)
3. Any issues encountered
