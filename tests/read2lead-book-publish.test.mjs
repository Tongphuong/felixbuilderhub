import assert from 'node:assert/strict';
import test from 'node:test';

import { loadBookLevels } from '../functions/api/generate-read2lead-pack.js';
import { onRequestPost } from '../functions/api/publish-read2lead-book.js';

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
      { type: 'listening_fill_blank' },
      { type: 'listen_and_order' },
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await onRequestPost({ request: request({ pack: validPack(), level: 'L1', activate_level: true }), env });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(JSON.parse(store.values.get('book_index:L1')), ['book_100', 'book_283570']);
  assert.deepEqual(JSON.parse(store.values.get('config:book_levels')), ['L1']);
  assert.equal(JSON.parse(store.values.get('book:book_283570')).book_slug, 'book_283570');
});

test('publisher rejects invalid activity selection before writing', async () => {
  const store = kv();
  const pack = validPack();
  pack.activities.pop();
  const response = await onRequestPost({ request: request({ pack, level: 'L1' }), env: { READ2LEAD_BACKEND_SECRET: 'shared', READ2LEAD_CODES: store } });
  assert.equal(response.status, 400);
  assert.equal(store.values.size, 0);
});
