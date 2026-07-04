import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/read2lead-checkpoint-save.js';

function createKv(records = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(records)) {
    store.set(key, JSON.stringify(value));
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
  };
}

function codeRecord(status, opts = {}) {
  const usesRemaining = opts.usesRemaining ?? 5;
  const usesTotal = opts.usesTotal ?? undefined;
  const record = {
    student_profile: { student_name: 'Bin', age: 8, level: 'L2', child_gender: 'boy' },
    progress: {
      current_level: 'L2',
      packs_created: 2,
      current_pack: {
        pack_id: 'pack-save-1',
        status,
        created_at: new Date().toISOString(),
      },
      review_history: [{ pack_id: 'old-pack', status: 'reviewed_pass_web_v2' }],
    },
    uses_remaining: usesRemaining,
  };
  if (usesTotal !== undefined) {
    record.uses_total = usesTotal;
  }
  return record;
}

test('valid save writes checkpoint and leaves other fields unchanged', async () => {
  const kv = createKv({
    'R2L-TEST-SAVE': codeRecord('awaiting_review', { usesRemaining: 5, usesTotal: 10 }),
  });
  const snapshot = { schema_version: 2, activity_index: 1, completed_types: ['listening_fill_blank'] };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-SAVE',
        pack_id: 'pack-save-1',
        snapshot,
      }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stored, true);

  const stored = JSON.parse(kv.store.get('R2L-TEST-SAVE'));
  const cp = stored.progress.current_pack.web_session_checkpoint;
  assert.ok(cp);
  assert.ok(cp.saved_at);
  assert.deepEqual(cp.snapshot, snapshot);

  // other fields untouched
  assert.equal(stored.uses_remaining, 5);
  assert.equal(stored.uses_total, 10);
  assert.equal(stored.progress.packs_created, 2);
  assert.equal(stored.progress.review_history.length, 1);
  assert.equal(stored.student_profile.student_name, 'Bin');
});

test('mismatched pack_id returns stored:false and does not write', async () => {
  const kv = createKv({
    'R2L-TEST-SAVE': codeRecord('awaiting_review', { usesRemaining: 5 }),
  });
  const beforeRaw = kv.store.get('R2L-TEST-SAVE');

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-SAVE',
        pack_id: 'different-pack-id',
        snapshot: { a: 1 },
      }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stored, false);
  assert.equal(kv.store.get('R2L-TEST-SAVE'), beforeRaw);
});

test('generation_in_progress status returns stored:false without write', async () => {
  const kv = createKv({
    'R2L-TEST-SAVE': codeRecord('generation_in_progress'),
  });
  const beforeRaw = kv.store.get('R2L-TEST-SAVE');

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-SAVE',
        pack_id: 'pack-save-1',
        snapshot: { a: 1 },
      }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stored, false);
  assert.equal(kv.store.get('R2L-TEST-SAVE'), beforeRaw);
});

test('reviewed_pass_web_v2 status returns stored:false without write', async () => {
  const kv = createKv({
    'R2L-TEST-SAVE': codeRecord('reviewed_pass_web_v2'),
  });
  const beforeRaw = kv.store.get('R2L-TEST-SAVE');

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-SAVE',
        pack_id: 'pack-save-1',
        snapshot: { a: 1 },
      }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stored, false);
  assert.equal(kv.store.get('R2L-TEST-SAVE'), beforeRaw);
});

test('missing access_code returns 400 missing_fields', async () => {
  const kv = createKv();
  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack_id: 'x', snapshot: {} }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'missing_fields');
});

test('missing pack_id returns 400 missing_fields', async () => {
  const kv = createKv();
  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'R2L-TEST-SAVE', snapshot: {} }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'missing_fields');
});

test('missing snapshot returns 400 missing_fields', async () => {
  const kv = createKv();
  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'R2L-TEST-SAVE', pack_id: 'pack-save-1' }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'missing_fields');
});

test('non-object snapshot returns 400 missing_fields', async () => {
  const kv = createKv();
  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'R2L-TEST-SAVE', pack_id: 'pack-save-1', snapshot: 'not-an-object' }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'missing_fields');
});

test('nonexistent code returns 404 code_not_found', async () => {
  const kv = createKv({});
  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'R2L-MISSING', pack_id: 'pack-save-1', snapshot: {} }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'code_not_found');
});

test('snapshot too large returns 413 snapshot_too_large', async () => {
  const kv = createKv({
    'R2L-TEST-SAVE': codeRecord('awaiting_review', { usesRemaining: 5 }),
  });
  const bigSnapshot = { data: 'x'.repeat(20000) };
  // Ensure the serialized length exceeds limit
  const serialized = JSON.stringify(bigSnapshot);
  assert.ok(serialized.length > 20000, 'snapshot must be >20000 chars for this test');
  const beforeRaw = kv.store.get('R2L-TEST-SAVE');

  const response = await onRequestPost({
    request: new Request('https://example.com/api/read2lead-checkpoint-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'R2L-TEST-SAVE', pack_id: 'pack-save-1', snapshot: bigSnapshot }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'snapshot_too_large');
  assert.equal(kv.store.get('R2L-TEST-SAVE'), beforeRaw);
});
