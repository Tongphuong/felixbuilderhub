import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as checkpointSave } from '../functions/api/read2lead-checkpoint-save.js';
import { onRequestGet as dropoffReport } from '../functions/api/read2lead-dropoff.js';

function createKv(records = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(records)) {
    store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return {
    store,
    async get(key, opts = {}) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async list({ prefix = '', cursor } = {}) {
      void cursor;
      const keys = [...store.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: null };
    },
  };
}

function codeRecord(status = 'awaiting_review', packId = 'book_1') {
  return {
    student_profile: { student_name: 'Bin', age: 8, level: 'L2', child_gender: 'boy' },
    progress: {
      current_level: 'L2',
      current_pack: { pack_id: packId, status, created_at: new Date().toISOString() },
      review_history: [],
    },
    uses_remaining: 5,
  };
}

function dropoffKeys(kv) {
  return [...kv.store.keys()].filter((k) => k.startsWith('dropoff:'));
}

test('checkpoint save also writes a drop-off record with the kid position', async () => {
  const kv = createKv({ 'R2L-DROP-1': codeRecord('awaiting_review', 'book_1') });
  const snapshot = {
    schema_version: 2,
    activity_index: 0,
    w1_phase: 'book_reader',
    book_reader: {
      pageIndex: 3,
      stage: 'shadow',
      questionIndex: 1,
      chunkIndex: 2,
      pages: [0, 1, 2, 3, 4, 5, 6, 7],
    },
  };

  const res = await checkpointSave({
    request: new Request('https://x/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'R2L-DROP-1', pack_id: 'book_1', snapshot }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await res.json();
  assert.equal(body.stored, true);

  const keys = dropoffKeys(kv);
  assert.equal(keys.length, 1);
  const rec = JSON.parse(kv.store.get(keys[0]));
  assert.equal(rec.code, 'R2L-DROP-1');
  assert.equal(rec.pack, 'book_1');
  assert.equal(rec.phase, 'book_reader');
  assert.equal(rec.stage, 'shadow');
  assert.equal(rec.page, 3);
  assert.equal(rec.pages_total, 8);
  assert.equal(rec.chunk_index, 2);
  assert.ok(rec.ts);
});

test('drop-off write is best-effort: missing book_reader still saves, with null position', async () => {
  const kv = createKv({ 'R2L-DROP-2': codeRecord('awaiting_review', 'book_2') });
  const res = await checkpointSave({
    request: new Request('https://x/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-DROP-2',
        pack_id: 'book_2',
        snapshot: { schema_version: 2, activity_index: 1 },
      }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  assert.equal((await res.json()).stored, true);

  const keys = dropoffKeys(kv);
  assert.equal(keys.length, 1);
  const rec = JSON.parse(kv.store.get(keys[0]));
  assert.equal(rec.page, null);
  assert.equal(rec.stage, null);
  assert.equal(rec.activity_index, 1);
});

test('drop-off report requires the admin secret', async () => {
  const kv = createKv();
  const res = await dropoffReport({
    request: new Request('https://x/api/read2lead-dropoff'),
    env: { READ2LEAD_CODES: kv, READ2LEAD_BACKEND_SECRET: 's3cret' },
  });
  assert.equal(res.status, 401);
});

test('drop-off report buckets abandoned, excludes completed and still-active', async () => {
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
  const fresh = new Date().toISOString();
  const kv = createKv({
    // abandoned: two kids stuck at shadow, one at questions
    'dropoff:2026-07-10:R2L-A:book_1': { code: 'R2L-A', pack: 'book_1', ts: old, phase: 'book_reader', stage: 'shadow', page: 2, pages_total: 8, chunk_index: 1 },
    'dropoff:2026-07-10:R2L-B:book_1': { code: 'R2L-B', pack: 'book_1', ts: old, phase: 'book_reader', stage: 'shadow', page: 5, pages_total: 8, chunk_index: 0 },
    'dropoff:2026-07-10:R2L-C:book_2': { code: 'R2L-C', pack: 'book_2', ts: old, phase: 'book_reader', stage: 'questions', page: 1, pages_total: 4, question_index: 0 },
    // completed pack -> excluded
    'dropoff:2026-07-10:R2L-D:book_done': { code: 'R2L-D', pack: 'book_done', ts: old, phase: 'book_reader', stage: 'shadow', page: 7, pages_total: 8 },
    'progress:R2L-D': { completed_pack_ids: ['book_done'] },
    // fresh save -> still active, excluded by stale_minutes
    'dropoff:2026-07-10:R2L-E:book_3': { code: 'R2L-E', pack: 'book_3', ts: fresh, phase: 'book_reader', stage: 'story', page: 0, pages_total: 6 },
  });

  const res = await dropoffReport({
    request: new Request('https://x/api/read2lead-dropoff', {
      headers: { 'X-Read2Lead-Secret': 's3cret' },
    }),
    env: { READ2LEAD_CODES: kv, READ2LEAD_BACKEND_SECRET: 's3cret' },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.total_records, 5);
  assert.equal(body.abandoned_count, 3); // A, B, C (D completed, E too fresh)

  const shadow = body.by_stage.find((b) => b.key === 'book_reader/shadow');
  assert.equal(shadow.count, 2);
  const questions = body.by_stage.find((b) => b.key === 'book_reader/questions');
  assert.equal(questions.count, 1);
  assert.ok(!body.by_stage.some((b) => b.key === 'book_reader/story')); // fresh excluded
});
