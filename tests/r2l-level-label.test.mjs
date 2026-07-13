// What level does the PARENT actually see in "Truyện đã đọc"?
//
// A parent's screenshot showed "Cấp 4" against an L0 child. Two different things are both
// called "level": the shelf the child draws from (their lane) and the book's own StoryWeaver
// difficulty tag. The tag was winning, riding into review_history, and coming out on the
// parent's list.
//
// The first attempt at this fix stopped at the generated pack and never followed the value to
// its destination — so it did not actually fix what the parent sees (caught in review). This
// test walks the whole chain: the stored pack -> the REAL submit endpoint -> the REAL library
// list the parent reads. Reuse: node:test (the repo's runner) + the existing book-pack fixture
// helpers, driving the production handlers rather than mocking them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as submitLesson } from '../functions/api/submit-read2lead-lesson.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';
import { listCompletedStories } from '../functions/api/_read2lead-library.js';
import { makeStoredBookPack, makeBookReaderState } from './helpers/book-pack-fixture.mjs';

const ACCESS_CODE = 'R2L-LEVEL-LABEL';
const PACK_ID = 'book-pack-level';

// The real shape of the bug: a beginner (L0 lane) drew a book whose StoryWeaver tag says L4.
const CHILD_LANE = 'L0';
const BOOK_STORYWEAVER_TAG = 'L4';

function makeFixture() {
  const book = makeStoredBookPack('book_42', {
    level: BOOK_STORYWEAVER_TAG,
    pages: 2,
    sentencesPerPage: 2,
    questionsPerPage: 2,
  });
  const codeData = {
    completed_books: [],
    student_profile: { student_name: 'Minh', level: CHILD_LANE },
    progress: {
      current_pack: {
        pack_id: PACK_ID,
        status: 'ready',
        schema_version: 2,
        level: CHILD_LANE,                // the shelf the child drew from
        book_level: BOOK_STORYWEAVER_TAG, // the book's own tag: kept, but never shown as the level
        review_context: book,             // the raw book record — carries the StoryWeaver tag
      },
    },
  };
  const progressState = {
    schema_version: 2,
    access_code: ACCESS_CODE,
    student_name: 'Minh',
    current_level: CHILD_LANE,
    initial_level: CHILD_LANE,
    unlocked_levels: [CHILD_LANE],
    coins: 0,
    total_xp: 0,
    xp_in_level: 0,
    completed_packs: 0,
    level_progress: { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 },
    streak_days: 0,
    review_history: [],
  };
  const store = new Map([
    [ACCESS_CODE, structuredClone(codeData)],
    [progressKey(ACCESS_CODE), structuredClone(progressState)],
  ]);
  return {
    book,
    store,
    env: {
      RNG: () => 0,
      READ2LEAD_CODES: {
        async get(key) {
          const value = store.get(key);
          return value == null ? null : structuredClone(value);
        },
        async put(key, value) {
          store.set(key, typeof value === 'string' ? JSON.parse(value) : structuredClone(value));
        },
      },
    },
  };
}

test('the level the parent reads is the child\'s lane, not the book\'s StoryWeaver tag', async () => {
  const fixture = makeFixture();
  const reader = makeBookReaderState(fixture.book, { version: 3 });

  const response = await submitLesson({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
      body: JSON.stringify({
        access_code: ACCESS_CODE,
        pack_id: PACK_ID,
        answers: { book_flow_version: 3, book_reader: reader, activity_results: [] },
      }),
    }),
    env: fixture.env,
  });
  const payload = await response.json();
  assert.equal(payload.ok, true, JSON.stringify(payload));

  // 1. What got written into the child's history.
  const saved = fixture.store.get(ACCESS_CODE);
  const history = saved.progress.review_history;
  assert.ok(history?.length, 'the completed book must be recorded');
  assert.equal(
    history[0].level,
    CHILD_LANE,
    'review_history took the book\'s StoryWeaver tag — that is what printed "Cấp 4"',
  );

  // 2. What the parent's "Truyện đã đọc" list actually renders from it.
  const [story] = listCompletedStories(history);
  assert.equal(story.level, CHILD_LANE, 'the parent must see the child\'s own level');
  assert.notEqual(story.level, BOOK_STORYWEAVER_TAG);
});
