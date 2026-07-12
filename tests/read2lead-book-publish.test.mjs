import assert from 'node:assert/strict';
import test from 'node:test';

import { loadBookLevels } from '../functions/api/generate-read2lead-pack.js';
import { bandForPageCount, onRequestPost } from '../functions/api/publish-read2lead-book.js';

function validPack() {
  return {
    schema_version: 2,
    level: 'L1',
    book_slug: 'book_283570',
    book_images: ['a.jpg', 'b.jpg', 'c.jpg'],
    book_page_audio: ['a.mp3', 'b.mp3', 'c.mp3'],
    book_attribution: { title: 'Book' },
    story: { paragraphs_en: ['One.', 'Two.', 'Three.'] },
    activities: [
      { type: 'read_aloud' },
    ],
  };
}

function kv(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    values,
    async get(key, options) {
      const value = values.get(key);
      if (value == null) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
  };
}

function request(body, secret = 'shared') {
  return new Request('https://example.com/api/publish-read2lead-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Read2Lead-Secret': secret },
    body: JSON.stringify(body),
  });
}

test('book level loader defaults to legacy when no configuration exists', async () => {
  assert.deepEqual([...await loadBookLevels({ READ2LEAD_CODES: kv() })], []);
});

test('environment activation takes precedence over stored activation', async () => {
  const active = await loadBookLevels({ READ2LEAD_BOOK_LEVELS: 'L2', READ2LEAD_CODES: kv({ 'config:book_levels': ['L1'] }) });
  assert.deepEqual([...active], ['L2']);
});

test('publisher rejects unauthorized requests without writing', async () => {
  const store = kv();
  const response = await onRequestPost({ request: request({ pack: validPack(), level: 'L1' }, 'wrong'), env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store } });
  assert.equal(response.status, 401);
  assert.equal(store.values.size, 0);
});

test('publisher writes book and idempotent index then activates level', async () => {
  const store = kv({ 'book_index:L1': ['book_100'] });
  const env = { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store };
  // 7 pages lands this pack in the L1 band (SPEC_R2L_PAGE_BANDS.md) so the
  // seeded book_index:L1 list is the one exercised below.
  const pack = validPack();
  pack.book_images = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg', 'g.jpg'];
  pack.book_page_audio = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'e.mp3', 'f.mp3', 'g.mp3'];
  pack.story.paragraphs_en = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.'];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await onRequestPost({ request: request({ pack, level: 'L1', activate_level: true }), env });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(JSON.parse(store.values.get('book_index:L1')), ['book_100', 'book_283570']);
  assert.deepEqual(JSON.parse(store.values.get('config:book_levels')), ['L1']);
  assert.equal(JSON.parse(store.values.get('book:book_283570')).book_slug, 'book_283570');
});

test('publisher indexes by page-count band, independent of the pack level label', async () => {
  const store = kv();
  const pack = validPack(); // 3 images/paragraphs -> L0 band
  pack.level = 'L3'; // deliberately mismatched label; must not steer the index key
  const response = await onRequestPost({
    request: request({ pack, level: 'L3' }),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.level, 'L3'); // label kept for schema/activate_level purposes only
  assert.deepEqual(JSON.parse(store.values.get('book_index:L0')), ['book_283570']);
  assert.equal(store.values.has('book_index:L3'), false);
});

test('publisher rejects a pack whose image count and paragraph count disagree', async () => {
  const store = kv();
  const pack = validPack();
  pack.book_images = [...pack.book_images, 'extra.jpg'];
  pack.book_page_audio = [...pack.book_page_audio, 'extra.mp3'];
  const response = await onRequestPost({
    request: request({ pack, level: 'L1' }),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'page_count_mismatch');
  assert.equal(store.values.size, 0);
});

test('publisher rejects invalid activity selection before writing', async () => {
  const store = kv();
  const pack = validPack();
  pack.activities.pop();
  const response = await onRequestPost({ request: request({ pack, level: 'L1' }), env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store } });
  assert.equal(response.status, 400);
  assert.equal(store.values.size, 0);
});

test('bandForPageCount buckets by page count and rejects non-positive/non-finite input', () => {
  assert.equal(bandForPageCount(3), 'L0');
  assert.equal(bandForPageCount(6), 'L0');
  assert.equal(bandForPageCount(7), 'L1');
  assert.equal(bandForPageCount(9), 'L1');
  assert.equal(bandForPageCount(10), 'L2');
  assert.equal(bandForPageCount(12), 'L2');
  assert.equal(bandForPageCount(13), 'L3');
  assert.equal(bandForPageCount(15), 'L3');
  assert.equal(bandForPageCount(16), 'L4');
  assert.equal(bandForPageCount(24), 'L4');
  assert.equal(bandForPageCount(0), null);
  assert.equal(bandForPageCount(Number.NaN), null);
});

test('reindex_only requires the shared secret and leaves indexes untouched', async () => {
  const store = kv({ 'book_index:L0': ['book_1'] });
  const response = await onRequestPost({
    request: request({ reindex_only: true, indexes: { L0: [], L1: [], L2: [], L3: [], L4: [] } }, 'wrong'),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(store.values.get('book_index:L0')), ['book_1']);
});

test('reindex_only rejects a payload missing one of the five band keys', async () => {
  const store = kv();
  const response = await onRequestPost({
    request: request({ reindex_only: true, indexes: { L0: [], L1: [], L2: [], L3: [] } }),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 400);
  assert.equal(store.values.size, 0);
});

test('reindex_only rejects a payload with a malformed slug', async () => {
  const store = kv();
  const response = await onRequestPost({
    request: request({ reindex_only: true, indexes: { L0: ['not-a-slug'], L1: [], L2: [], L3: [], L4: [] } }),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 400);
  assert.equal(store.values.size, 0);
});

test('reindex_only rejects overlapping slugs across bands', async () => {
  const store = kv();
  const response = await onRequestPost({
    request: request({
      reindex_only: true,
      indexes: { L0: ['book_1'], L1: ['book_1'], L2: [], L3: [], L4: [] },
    }),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 400);
  assert.equal(store.values.size, 0);
});

test('reindex_only overwrites all five band indexes and echoes counts', async () => {
  const store = kv({ 'book_index:L0': ['stale_1'], 'book_index:L2': ['stale_2'] });
  const indexes = {
    L0: ['book_1', 'book_2'],
    L1: ['book_3'],
    L2: [],
    L3: ['book_4', 'book_5', 'book_6'],
    L4: ['book_7'],
  };
  const response = await onRequestPost({
    request: request({ reindex_only: true, indexes }),
    env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.counts, { L0: 2, L1: 1, L2: 0, L3: 3, L4: 1 });
  assert.deepEqual(JSON.parse(store.values.get('book_index:L0')), indexes.L0);
  assert.deepEqual(JSON.parse(store.values.get('book_index:L1')), indexes.L1);
  assert.deepEqual(JSON.parse(store.values.get('book_index:L2')), indexes.L2);
  assert.deepEqual(JSON.parse(store.values.get('book_index:L3')), indexes.L3);
  assert.deepEqual(JSON.parse(store.values.get('book_index:L4')), indexes.L4);
});
