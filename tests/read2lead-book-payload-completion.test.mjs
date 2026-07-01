import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildV2LessonPayload,
  isValidBookPack,
} from '../functions/api/read2lead-lesson.js';
import { onRequestPost } from '../functions/api/submit-read2lead-lesson.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';
import {
  buildBookShadowChunks,
  selectBookQuestions,
  validateBookFlowSubmission,
} from '../src/lib/read2lead-book-flow.mjs';

const ACCESS_CODE = 'R2L-BOOK-COMPLETE';
const PACK_ID = 'book-pack-id';

function bookContext() {
  const sentences = ['One small cat.', 'Two red kites.', 'Three tall trees.'].map(
    (text_en, paragraph_index) => ({
      text_en,
      paragraph_index,
      audio_url: `https://pub-test.r2.dev/books/book_123/s_00${paragraph_index}.mp3`,
    }),
  );
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
      paragraphs_en: sentences.map((sentence) => sentence.text_en),
      sentences,
    },
    guided_listening: sentences.map((_, paragraph_index) => ({
      paragraph_index,
      questions: [0, 1].map((questionIndex) => ({
        id: `p${paragraph_index}_q${questionIndex}`,
        sentence_index: paragraph_index,
        question_en: questionIndex === 0 ? 'What is here?' : 'How many?',
        options_en: ['One', 'Two', 'Three'],
        correct_index: paragraph_index,
      })),
    })),
    activities: [
      {
        type: 'read_aloud',
        items: sentences.map((sentence, index) => ({
          id: `ra_${index}`,
          text_en: sentence.text_en,
          audio_url: sentence.audio_url,
        })),
      },
    ],
  };
}

function bookReader({ score = 70, skip = null, technical = false } = {}) {
  const context = bookContext();
  return {
    pages: context.story.paragraphs_en.map((_, pageIndex) => ({
      page_index: pageIndex,
      audio_completed: true,
      question_results: selectBookQuestions(
        context.guided_listening,
        context.story.sentences,
        pageIndex,
      ).map((question) => ({ question_id: question.id, correct: true })),
      shadow_chunks: buildBookShadowChunks(context.story.sentences, pageIndex).map((chunk) => ({
        chunk_id: chunk.chunk_id,
        sentence_indexes: chunk.sentence_indexes,
        attempts: skip === pageIndex && !technical ? 3 : (technical && skip === pageIndex ? 0 : 1),
        status: skip === pageIndex ? 'skipped' : 'passed',
        score_percent: skip === pageIndex ? 49 : score,
        technical_failures: technical && skip === pageIndex ? 2 : 0,
        ...(technical && skip === pageIndex ? { technical_skip: true } : {}),
      })),
    })),
  };
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
          store.set(key, typeof value === 'string' ? JSON.parse(value) : structuredClone(value));
        },
      },
    },
  };
}

async function submit(bookReaderState, fixture) {
  return onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
      body: JSON.stringify({
        access_code: ACCESS_CODE,
        pack_id: PACK_ID,
        answers: {
          book_flow_version: 2,
          book_reader: bookReaderState,
          activity_results: [],
        },
      }),
    }),
    env: fixture.env,
  });
}

test('valid read-aloud-only book payload passes all book fields', () => {
  const context = bookContext();
  const lesson = buildV2LessonPayload({
    accessCode: ACCESS_CODE,
    codeData: { student_profile: { student_name: 'Minh' } },
    pack: { pack_id: PACK_ID, status: 'ready' },
    v2Pack: context,
    env: { R2L_AUDIO_HOST: 'https://audio.felixbuilderhub.com' },
  });
  assert.equal(isValidBookPack(context), true);
  assert.equal(lesson.student_name, 'Minh');
  assert.equal(lesson.book_slug, 'book_123');
  assert.equal(lesson.book_images.length, 3);
  assert.equal(lesson.book_page_audio.length, 3);
  assert.deepEqual(lesson.book_attribution, context.book_attribution);
  assert.deepEqual(
    lesson.activities.map((activity) => activity.type),
    ['read_aloud'],
  );
  assert.match(lesson.book_page_audio[0], /^https:\/\/audio\.felixbuilderhub\.com/);
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

test('all passed chunks reward completion and append the book slug idempotently', async () => {
  const fixture = makeFixture(['book_999', 'book_123']);
  const response = await submit(bookReader(), fixture);
  const payload = await response.json();
  assert.equal(payload.passed, true);
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_999', 'book_123']);
});

test('server rejects unheard pages and a passed chunk scored at 49', async () => {
  const unheardFixture = makeFixture([]);
  const unheard = bookReader();
  unheard.pages[1].audio_completed = false;
  const unheardResponse = await submit(unheard, unheardFixture);
  assert.equal(unheardResponse.status, 400);
  assert.deepEqual(unheardFixture.store.get(ACCESS_CODE).completed_books, []);

  const lowFixture = makeFixture([]);
  const low = bookReader();
  low.pages[0].shadow_chunks[0].score_percent = 49;
  const lowResponse = await submit(low, lowFixture);
  assert.equal(lowResponse.status, 400);
});

test('a single sentence over 24 words remains a valid indivisible shadow chunk', () => {
  const context = bookContext();
  const longSentence = Array.from({ length: 25 }, (_, index) => 'word' + (index + 1)).join(' ');
  context.story.sentences[1].text_en = longSentence;
  context.story.paragraphs_en[1] = longSentence;

  const reader = {
    pages: context.story.paragraphs_en.map((_, pageIndex) => ({
      page_index: pageIndex,
      audio_completed: true,
      question_results: selectBookQuestions(
        context.guided_listening,
        context.story.sentences,
        pageIndex,
      ).map((question) => ({ question_id: question.id, correct: true })),
      shadow_chunks: buildBookShadowChunks(context.story.sentences, pageIndex).map((chunk) => ({
        chunk_id: chunk.chunk_id,
        sentence_indexes: chunk.sentence_indexes,
        attempts: 1,
        status: 'passed',
        score_percent: 100,
        technical_failures: 0,
      })),
    })),
  };

  assert.equal(buildBookShadowChunks(context.story.sentences, 1)[0].word_count, 25);
  assert.deepEqual(validateBookFlowSubmission(reader, context), {
    ok: true,
    errors: [],
    summary: {
      pages_heard: 3,
      questions_answered: 6,
      chunks_passed: 3,
      chunks_skipped: 0,
      average_pronunciation_score: 100,
    },
    skipped: false,
  });
});

test('three low scores complete the book without rewards', async () => {
  const fixture = makeFixture([]);
  const response = await submit(bookReader({ skip: 1 }), fixture);
  const payload = await response.json();
  assert.equal(payload.completed_without_reward, true);
  assert.deepEqual(payload.rewards_earned, { coins: 0, xp: 0 });
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_123']);
});

test('two technical failures allow explicit no-reward completion without pronunciation attempts', async () => {
  const fixture = makeFixture([]);
  const response = await submit(bookReader({ skip: 2, technical: true }), fixture);
  const payload = await response.json();
  assert.equal(payload.completed_without_reward, true);
  assert.deepEqual(payload.rewards_earned, { coins: 0, xp: 0 });
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_123']);
});
