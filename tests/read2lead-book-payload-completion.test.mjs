import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildV2LessonPayload,
  isValidBookPack,
} from '../functions/api/read2lead-lesson.js';
import { onRequestPost } from '../functions/api/submit-read2lead-lesson.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

const ACCESS_CODE = 'R2L-BOOK-COMPLETE';
const PACK_ID = 'book-pack-id';

function bookContext() {
  return {
    schema_version: 2,
    book_slug: 'book_123',
    book_images: [
      'https://pub-test.r2.dev/books/book_123/2.jpg',
      'https://pub-test.r2.dev/books/book_123/3.jpg',
      'https://pub-test.r2.dev/books/book_123/4.jpg',
    ],
    book_page_audio: [
      'https://pub-test.r2.dev/books/book_123/2.mp3',
      'https://pub-test.r2.dev/books/book_123/3.mp3',
      'https://pub-test.r2.dev/books/book_123/4.mp3',
    ],
    book_attribution: {
      title: 'Book',
      creators: ['Author'],
      publisher: 'Publisher',
      credit_text: 'Full credit',
      source_url: 'https://storyweaver.org.in/stories/123-book',
      image_credits: [{ page_index: 0, credit_text: 'Image' }],
      license: {
        name: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
      },
    },
    level: 'L1',
    topic: 'Book',
    story: {
      title: 'Book',
      paragraphs_en: ['One.', 'Two.', 'Three.'],
      sentences: [
        {
          text_en: 'One.',
          paragraph_index: 0,
          audio_url: 'https://pub-test.r2.dev/books/book_123/s_000.mp3',
        },
      ],
    },
    guided_listening: [{ paragraph_index: 0, questions: [{ id: 'q1' }, { id: 'q2' }] }],
    activities: [
      { type: 'listening_fill_blank', items: [{ id: 'a1' }] },
      { type: 'listen_and_order', items: [{ id: 'b1' }] },
      {
        type: 'read_aloud',
        items: [
          {
            id: 'ra_0',
            text_en: 'One.',
            audio_url: 'https://pub-test.r2.dev/books/book_123/s_000.mp3',
          },
        ],
      },
    ],
  };
}

function results({ readScore = 100, skipped = false } = {}) {
  return [
    {
      type: 'guided_listening',
      attempted: true,
      correct_count: 2,
      total_count: 2,
      wrong_count: 0,
    },
    {
      type: 'listening_fill_blank',
      attempted: true,
      correct_count: 1,
      total_count: 1,
      wrong_count: 0,
    },
    {
      type: 'listen_and_order',
      attempted: true,
      correct_count: 1,
      total_count: 1,
      wrong_count: 0,
    },
    {
      type: 'read_aloud',
      attempted: true,
      correct_count: skipped ? 0 : 1,
      total_count: 1,
      wrong_count: skipped ? 1 : 0,
      score_percent: skipped ? 0 : readScore,
      ...(skipped ? { skipped_due_to_mic: true } : {}),
    },
  ];
}

function makeFixture(existingCompleted = []) {
  const codeData = {
    completed_books: existingCompleted,
    student_profile: { student_name: 'Minh', level: 'L1' },
    progress: {
      current_pack: {
        pack_id: PACK_ID,
        status: 'ready',
        schema_version: 2,
        review_context: bookContext(),
      },
    },
  };
  const progressState = {
    schema_version: 2,
    access_code: ACCESS_CODE,
    student_name: 'Minh',
    current_level: 'L1',
    initial_level: 'L1',
    unlocked_levels: ['L1'],
    coins: 0,
    total_xp: 0,
    xp_in_level: 0,
    completed_packs: 0,
    level_progress: { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 },
    streak_days: 0,
  };
  const store = new Map([
    [ACCESS_CODE, structuredClone(codeData)],
    [progressKey(ACCESS_CODE), structuredClone(progressState)],
  ]);
  return {
    store,
    env: {
      RNG: () => 0,
      READ2LEAD_CODES: {
        async get(key) {
          const value = store.get(key);
          return value == null ? null : structuredClone(value);
        },
        async put(key, value) {
          store.set(
            key,
            typeof value === 'string' ? JSON.parse(value) : structuredClone(value),
          );
        },
      },
    },
  };
}

async function submit(activityResults, fixture) {
  return onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
      body: JSON.stringify({
        access_code: ACCESS_CODE,
        pack_id: PACK_ID,
        answers: { activity_results: activityResults },
      }),
    }),
    env: fixture.env,
  });
}

test('valid book payload passes all book fields and keeps exactly A/B/D', () => {
  const context = bookContext();
  const lesson = buildV2LessonPayload({
    accessCode: ACCESS_CODE,
    codeData: {},
    pack: { pack_id: PACK_ID, status: 'ready' },
    v2Pack: context,
    env: { R2L_AUDIO_HOST: 'https://audio.felixbuilderhub.com' },
  });
  assert.equal(isValidBookPack(context), true);
  assert.equal(lesson.book_slug, 'book_123');
  assert.equal(lesson.book_images.length, 3);
  assert.equal(lesson.book_page_audio.length, 3);
  assert.deepEqual(lesson.book_attribution, context.book_attribution);
  assert.deepEqual(
    lesson.activities.map((activity) => activity.type),
    ['listening_fill_blank', 'listen_and_order', 'read_aloud'],
  );
  assert.match(lesson.book_page_audio[0], /^https:\/\/audio\.felixbuilderhub\.com/);
  assert.match(lesson.activities[2].items[0].audio_url, /^https:\/\/audio\.felixbuilderhub\.com/);
});

test('mismatched page arrays do not expose book mode fields', () => {
  const context = bookContext();
  context.book_page_audio.pop();
  const lesson = buildV2LessonPayload({
    accessCode: ACCESS_CODE,
    codeData: {},
    pack: { pack_id: PACK_ID, status: 'ready' },
    v2Pack: context,
    env: {},
  });
  assert.equal(isValidBookPack(context), false);
  assert.equal('book_slug' in lesson, false);
});

test('rewarded completion appends the book slug idempotently', async () => {
  const fixture = makeFixture(['book_999', 'book_123']);
  const response = await submit(results(), fixture);
  const payload = await response.json();
  assert.equal(payload.passed, true);
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_999', 'book_123']);
});

test('failed submission does not mark the book complete', async () => {
  const fixture = makeFixture([]);
  const response = await submit(results({ readScore: 49 }), fixture);
  const payload = await response.json();
  assert.equal(payload.passed, false);
  assert.equal(payload.next_pack_unlocked, false);
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, []);
});

test('explicit mic skip marks the book complete without rewards', async () => {
  const fixture = makeFixture([]);
  const response = await submit(results({ skipped: true }), fixture);
  const payload = await response.json();
  assert.equal(payload.completed_without_reward, true);
  assert.deepEqual(payload.rewards_earned, { coins: 0, xp: 0 });
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_123']);
});
