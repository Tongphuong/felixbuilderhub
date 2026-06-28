import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestPost,
  parseBookLevels,
  selectUnreadBook,
} from '../functions/api/generate-read2lead-pack.js';

const ACCESS_CODE = 'R2L-BOOK-1234';

function storedBook(slug, title) {
  return {
    schema_version: 2,
    student_name: 'Student',
    level: 'L1',
    topic: title,
    book_slug: slug,
    book_images: ['https://audio.example/1.jpg', 'https://audio.example/2.jpg', 'https://audio.example/3.jpg'],
    book_page_audio: ['https://audio.example/1.mp3', 'https://audio.example/2.mp3', 'https://audio.example/3.mp3'],
    story: {
      title,
      paragraphs_en: ['One.', 'Two.', 'Three.'],
      sentences: [],
    },
    activities: [
      { type: 'listening_fill_blank', items: [] },
      { type: 'listen_and_order', items: [] },
      { type: 'read_aloud', items: [] },
    ],
  };
}

function codeData({ completed = [], currentBook = '' } = {}) {
  return {
    uses_remaining: 3,
    is_test: true,
    completed_books: completed,
    student_profile: {
      student_name: 'Minh',
      age: 9,
      level: 'L1',
      child_gender: 'boy',
    },
    progress: {
      current_level: 'L1',
      packs_created: 2,
      current_pack: currentBook
        ? {
            pack_id: 'previous-pack',
            status: 'reviewed_pass_web_v2',
            schema_version: 2,
            review_context: storedBook(currentBook, 'Previous'),
          }
        : null,
    },
  };
}

function makeKv(initial) {
  const store = new Map(
    Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]),
  );
  const puts = [];
  return {
    store,
    puts,
    kv: {
      async get(key) {
        const value = store.get(key);
        return value == null ? null : structuredClone(value);
      },
      async put(key, value) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
        store.set(key, parsed);
        puts.push([key, structuredClone(parsed)]);
      },
    },
  };
}

async function generate(env) {
  return onRequestPost({
    request: new Request('https://example.com/api/generate-read2lead-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
      body: JSON.stringify({ access_code: ACCESS_CODE }),
    }),
    env,
  });
}

test('READ2LEAD_BOOK_LEVELS defaults off and accepts only StoryWeaver levels', () => {
  assert.deepEqual([...parseBookLevels(undefined)], []);
  assert.deepEqual([...parseBookLevels(' l1, L2,invalid,L5,L2 ')], ['L1', 'L2']);
});

test('unread selection excludes completed/current books and is deterministic', () => {
  const selected = selectUnreadBook(
    ['book_1', 'book_2', 'book_3', 'book_3', 'invalid'],
    ['book_1'],
    'book_2',
    () => 0.9,
  );
  assert.equal(selected, 'book_3');
  assert.equal(selectUnreadBook(['book_1'], ['book_1'], '', () => 0), null);
});

test('active L1 assigns an unread book immediately without backend fetch', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData({ completed: ['book_1'], currentBook: 'book_2' }),
    'book_index:L1': ['book_1', 'book_2', 'book_3'],
    'book:book_3': storedBook('book_3', 'Fresh Book'),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('backend fetch must not run for book assignment');
  };
  try {
    const response = await generate({
      READ2LEAD_CODES: fixture.kv,
      READ2LEAD_BOOK_LEVELS: 'L1',
      RNG: () => 0,
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'done');
    assert.equal(payload.story_title, 'Fresh Book');
    const saved = fixture.store.get(ACCESS_CODE);
    assert.equal(saved.uses_remaining, 2);
    assert.equal(saved.progress.packs_created, 3);
    assert.equal(saved.progress.current_pack.review_context.book_slug, 'book_3');
    assert.deepEqual(saved.completed_books, ['book_1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('all books read clears assignment lock and does not decrement uses', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData({ completed: ['book_1'], currentBook: 'book_2' }),
    'book_index:L1': ['book_1', 'book_2'],
  });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: 'L1',
  });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'book_pool_exhausted');
  assert.match(payload.message, /đã đọc hết truyện/);
  const saved = fixture.store.get(ACCESS_CODE);
  assert.equal(saved.uses_remaining, 3);
  assert.equal(saved.progress.current_pack, null);
});

test('inactive levels preserve backend configuration fallback before locking', async () => {
  const fixture = makeKv({ [ACCESS_CODE]: codeData() });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: '',
  });
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.error, 'backend_not_configured');
  assert.equal(fixture.puts.length, 0);
});
