import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestPost,
  parseBookLevels,
  selectUnreadBook,
  bandForLevel,
} from '../functions/api/generate-read2lead-pack.js';
import { makeStoredBookPack, makeBrokenBookPack } from './helpers/book-pack-fixture.mjs';

const ACCESS_CODE = 'R2L-BOOK-1234';
const PROGRESS_KEY = `progress:${ACCESS_CODE}`;

function progressAtL1() {
  return {
    schema_version: 2,
    level_reset_version: 20260606,
    current_level: 'L1',
    initial_level: 'L0',
    unlocked_levels: ['L0', 'L1'],
    xp_in_level: 0,
    total_xp: 100,
    level_progress: { L0: 5, L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 },
    completed_packs: 5,
    completed_pack_ids: [],
    coins: 0,
    streak_days: 0,
  };
}

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
      { type: 'read_aloud', items: [] },
    ],
  };
}

// NOTE: this is a REAL student code (is_test: false). These tests assert credit
// metering (uses_remaining 3 → 2 on a successful generate), and test codes are exempt
// from metering entirely — see isUnlimitedCode() — so an is_test fixture would make
// every metering assertion below pass vacuously. The test-code exemption has its own
// coverage in tests/read2lead-test-code-unlimited.test.mjs.
function codeData({ completed = [], currentBook = '' } = {}) {
  return {
    uses_remaining: 3,
    is_test: false,
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
    [PROGRESS_KEY]: progressAtL1(),
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
    [PROGRESS_KEY]: progressAtL1(),
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

test('a broken book is skipped, a healthy one assigned, and the broken slug quarantined', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData(),
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1', 'book_2'],
    'book:book_1': makeBrokenBookPack('order_unreconstructable', 'book_1', { level: 'L1' }),
    'book:book_2': makeStoredBookPack('book_2', { level: 'L1', title: 'Good Book' }),
  });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: 'L1',
    RNG: () => 0, // always try the first unread book first
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const saved = fixture.store.get(ACCESS_CODE);
  assert.equal(saved.progress.current_pack.review_context.book_slug, 'book_2');
  assert.equal(saved.uses_remaining, 2);
  const quarantine = fixture.store.get('book_quarantine:L1');
  assert.ok(quarantine && quarantine.book_1, 'book_1 should be quarantined');
  assert.ok(quarantine.book_1.reasons.includes('order_unreconstructable'));
  assert.equal(quarantine.book_2, undefined, 'the healthy book must not be quarantined');
});

test('an already-quarantined book is skipped without even reading its record', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData(),
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1', 'book_2'],
    'book:book_1': makeBrokenBookPack('order_unreconstructable', 'book_1', { level: 'L1' }),
    'book:book_2': makeStoredBookPack('book_2', { level: 'L1', title: 'Good Book' }),
    'book_quarantine:L1': { book_1: { at: '2026-07-01T00:00:00.000Z', reasons: ['order_unreconstructable'] } },
  });
  const gets = [];
  const spiedKv = {
    ...fixture.kv,
    async get(key, opts) {
      gets.push(key);
      return fixture.kv.get(key, opts);
    },
  };
  const response = await generate({
    READ2LEAD_CODES: spiedKv,
    READ2LEAD_BOOK_LEVELS: 'L1',
    RNG: () => 0,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const saved = fixture.store.get(ACCESS_CODE);
  assert.equal(saved.progress.current_pack.review_context.book_slug, 'book_2');
  assert.ok(!gets.includes('book:book_1'), 'a quarantined book must not be re-read');
});

test('a pool of only cosmetically-flawed books still assigns one (does not strand)', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData(),
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1', 'book_2'],
    'book:book_1': makeBrokenBookPack('html_entity', 'book_1', { level: 'L1' }),
    'book:book_2': makeBrokenBookPack('doubled_word', 'book_2', { level: 'L1' }),
  });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: 'L1',
    RNG: () => 0,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const saved = fixture.store.get(ACCESS_CODE);
  assert.ok(['book_1', 'book_2'].includes(saved.progress.current_pack.review_context.book_slug));
  assert.equal(saved.uses_remaining, 2);
  // Cosmetic-only books are finishable, so they are never quarantined.
  assert.equal(fixture.store.get('book_quarantine:L1'), undefined);
});

test('a pool whose only unread books are already quarantined reports needs_repair, not exhausted', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData(),
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1', 'book_2'],
    'book:book_1': makeStoredBookPack('book_1', { level: 'L1' }),
    'book:book_2': makeStoredBookPack('book_2', { level: 'L1' }),
    'book_quarantine:L1': {
      book_1: { at: '2026-07-01T00:00:00.000Z', reasons: ['page_audio_empty'] },
      book_2: { at: '2026-07-01T00:00:00.000Z', reasons: ['order_unreconstructable'] },
    },
  });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: 'L1',
    RNG: () => 0,
  });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'book_pool_needs_repair');
  const saved = fixture.store.get(ACCESS_CODE);
  assert.equal(saved.uses_remaining, 3);
});

test('a book served under the wrong slug is rejected as unfinishable', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData(),
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1', 'book_2'],
    // book:book_1's record carries the wrong internal slug — must be skipped.
    'book:book_1': makeStoredBookPack('book_9', { level: 'L1' }),
    'book:book_2': makeStoredBookPack('book_2', { level: 'L1', title: 'Good Book' }),
  });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: 'L1',
    RNG: () => 0,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  const saved = fixture.store.get(ACCESS_CODE);
  assert.equal(saved.progress.current_pack.review_context.book_slug, 'book_2');
  const quarantine = fixture.store.get('book_quarantine:L1');
  assert.ok(quarantine.book_1.reasons.includes('slug_mismatch'));
});

test('a pool of only unfinishable books returns needs_repair without stranding', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: codeData(),
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1', 'book_2'],
    'book:book_1': makeBrokenBookPack('order_unreconstructable', 'book_1', { level: 'L1' }),
    'book:book_2': makeBrokenBookPack('page_audio_empty', 'book_2', { level: 'L1' }),
  });
  const response = await generate({
    READ2LEAD_CODES: fixture.kv,
    READ2LEAD_BOOK_LEVELS: 'L1',
    RNG: () => 0,
  });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error, 'book_pool_needs_repair');
  const saved = fixture.store.get(ACCESS_CODE);
  assert.equal(saved.uses_remaining, 3, 'a repair-needed pool must not burn a use');
  assert.equal(saved.progress.current_pack, null, 'the generation lock is cleared');
  const quarantine = fixture.store.get('book_quarantine:L1');
  assert.ok(quarantine.book_1 && quarantine.book_2, 'both unfinishable books quarantined');
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

// --- R2L-PAGE-BANDS: a kid at each level gets a book from their page band ---

test('bandForLevel normalizes untrusted levels and clamps L5', () => {
  assert.equal(bandForLevel('L0'), 'L0');
  assert.equal(bandForLevel('L4'), 'L4');
  assert.equal(bandForLevel('L5'), 'L4');
  assert.equal(bandForLevel(' l2 '), 'L2');
  assert.equal(bandForLevel(''), 'L1');
  assert.equal(bandForLevel(undefined), 'L1');
  assert.equal(bandForLevel('garbage'), 'L1');
});

// For every kid level (including the L5 clamp and a lowercase profile value),
// the book sits ONLY under book_index:<band>; assignment must find it there
// and the assigned pack's page count must be inside the band.
const BAND_CASES = [
  ['L0', 'L0', 5],
  ['L1', 'L1', 8],
  ['L2', 'L2', 11],
  ['L3', 'L3', 14],
  ['L4', 'L4', 18],
  ['L5', 'L4', 20],
  // A malformed stored level (e.g. lowercase from an old admin edit) is
  // sanitized by normalizeProgressState's safeLevel to START_LEVEL (L0), so
  // the kid safely draws from the easiest shelf instead of crashing.
  ['l2', 'L0', 5],
];

for (const [kidLevel, band, pages] of BAND_CASES) {
  test(`kid at ${JSON.stringify(kidLevel)} draws from band ${band} (${pages}-page book)`, async () => {
    const pack = makeStoredBookPack('book_42', { pages, sentencesPerPage: 2, questionsPerPage: 2 });
    const fixture = makeKv({
      [ACCESS_CODE]: codeData({}),
      [PROGRESS_KEY]: {
        ...progressAtL1(),
        current_level: kidLevel,
        unlocked_levels: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'],
      },
      [`book_index:${band}`]: ['book_42'],
      'book:book_42': pack,
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('backend fetch must not run'); };
    try {
      const response = await generate({
        READ2LEAD_CODES: fixture.kv,
        READ2LEAD_BOOK_LEVELS: 'L0,L1,L2,L3,L4',
        RNG: () => 0,
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      const assigned = fixture.store.get(ACCESS_CODE).progress.current_pack.review_context;
      assert.equal(assigned.book_slug, 'book_42');
      assert.equal((assigned.book_images || []).length, pages);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
