import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearOpenLessonsFromKv,
  shouldClearOpenPack,
} from '../functions/api/_read2lead-clear-open-lessons.js';
import { onRequestPost as clearOpenLessonsAdmin } from '../functions/api/admin/codes/clear-open-lessons.js';
import { onRequestPatch as patchCode } from '../functions/api/admin/codes/[code].js';

const CODE_A = 'R2L-TEST-AAAA';
const CODE_B = 'R2L-TEST-BBBB';

function createKv(records = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(records)) {
    store.set(key, JSON.stringify(value));
  }
  return {
    store,
    keys: [],
    async list({ cursor } = {}) {
      const names = [...store.keys()].filter((k) => !k.startsWith('task:')).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = names.slice(start, start + 100);
      return {
        keys: slice.map((name) => ({ name })),
        list_complete: start + 100 >= names.length,
        cursor: start + 100 >= names.length ? undefined : String(start + 100),
      };
    },
    async get(key, opts = {}) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function codeRecord(status, opts = {}) {
  const usesRemaining = opts.usesRemaining !== undefined ? opts.usesRemaining : 5;
  const usesTotal = opts.usesTotal !== undefined ? opts.usesTotal : undefined;
  const record = {
    student_profile: { student_name: 'Bin', age: 8, level: 'L2', child_gender: 'boy' },
    progress: {
      current_level: 'L2',
      packs_created: 2,
      current_pack: {
        pack_id: 'pack-1',
        status,
        task_id: 'task-abc',
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

test('shouldClearOpenPack matches unfinished statuses only', () => {
  assert.equal(shouldClearOpenPack({ status: 'generation_in_progress' }, ['generation_in_progress']), true);
  assert.equal(shouldClearOpenPack({ status: 'awaiting_review' }, ['awaiting_review']), true);
  assert.equal(shouldClearOpenPack({ status: 'reviewed_pass_web_v2' }, ['awaiting_review']), false);
});

test('clearOpenLessonsFromKv clears locks but preserves progress:{code}', async () => {
  const kv = createKv({
    [CODE_A]: codeRecord('generation_in_progress'),
    [CODE_B]: codeRecord('awaiting_review'),
    [`progress:${CODE_A}`]: { schema_version: 2, lifetime_rp: 42, rank_points: 42, level_progress: { L2: 3 } },
    [`progress:${CODE_B}`]: { schema_version: 2, lifetime_rp: 18, rank_points: 18, level_progress: { L2: 1 } },
    'task:task-abc': { status: 'pending' },
  });

  const result = await clearOpenLessonsFromKv(kv, {});

  assert.equal(result.cleared_count, 1);
  assert.equal(result.refunded_use_count, 0);
  assert.equal(JSON.parse(kv.store.get(CODE_A)).progress.current_pack, null);
  // CODE_B must NOT be cleared
  assert.notEqual(JSON.parse(kv.store.get(CODE_B)).progress.current_pack, null);
  assert.equal(JSON.parse(kv.store.get(CODE_B)).progress.current_pack.status, 'awaiting_review');
  assert.equal(kv.store.has(`progress:${CODE_A}`), true);
  assert.equal(kv.store.has(`progress:${CODE_B}`), true);
  assert.equal(JSON.parse(kv.store.get(`progress:${CODE_A}`)).lifetime_rp, 42);
  assert.equal(kv.store.has('task:task-abc'), false);
  // skipped entry
  const skippedEntry = result.skipped_with_other_status.find(s => s.code === CODE_B);
  assert.ok(skippedEntry);
  assert.equal(skippedEntry.status, 'awaiting_review');
});

test('admin clear-open-lessons supports dry_run', async () => {
  const kv = createKv({ [CODE_A]: codeRecord('generation_in_progress') });
  const response = await clearOpenLessonsAdmin({
    request: new Request('https://example.com/api/admin/codes/clear-open-lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.dry_run, true);
  assert.equal(body.cleared_count, 1);
  assert.notEqual(JSON.parse(kv.store.get(CODE_A)).progress.current_pack, null);
});

test('default call does not clear awaiting_review pack', async () => {
  const kv = createKv({ [CODE_B]: codeRecord('awaiting_review') });
  const result = await clearOpenLessonsFromKv(kv, {});
  assert.equal(result.cleared_count, 0);
  assert.equal(result.refunded_use_count, 0);
  const record = JSON.parse(kv.store.get(CODE_B));
  assert.equal(record.progress.current_pack.status, 'awaiting_review');
  assert.equal(record.uses_remaining, 5);
  const skippedEntry = result.skipped_with_other_status.find(s => s.code === CODE_B);
  assert.ok(skippedEntry);
  assert.equal(skippedEntry.status, 'awaiting_review');
});

test('explicit awaiting_review clears and refunds luot', async () => {
  const kv = createKv({
    [CODE_B]: codeRecord('awaiting_review', { usesRemaining: 5, usesTotal: 10 }),
    'task:task-abc': { status: 'pending' },
  });
  const result = await clearOpenLessonsFromKv(kv, { statuses: ['awaiting_review'] });
  assert.equal(result.cleared_count, 1);
  assert.equal(result.refunded_use_count, 1);
  const entry = result.cleared[0];
  assert.equal(entry.refunded_use, true);
  const record = JSON.parse(kv.store.get(CODE_B));
  assert.equal(record.uses_remaining, 6);
  assert.equal(record.progress.current_pack, null);
  assert.equal(kv.store.has('task:task-abc'), false);
});

test('explicit awaiting_review refund capped at uses_total', async () => {
  const kv = createKv({
    [CODE_B]: codeRecord('awaiting_review', { usesRemaining: 10, usesTotal: 10 }),
    'task:task-abc': { status: 'pending' },
  });
  const result = await clearOpenLessonsFromKv(kv, { statuses: ['awaiting_review'] });
  assert.equal(result.cleared_count, 1);
  assert.equal(result.refunded_use_count, 1);
  const record = JSON.parse(kv.store.get(CODE_B));
  assert.equal(record.uses_remaining, 10);
  assert.equal(record.progress.current_pack, null);
});

test('dryRun awaiting_review reports refund but does not write', async () => {
  const kv = createKv({
    [CODE_B]: codeRecord('awaiting_review', { usesRemaining: 5, usesTotal: 10 }),
    'task:task-abc': { status: 'pending' },
  });
  const beforeRecord = JSON.parse(kv.store.get(CODE_B));
  const result = await clearOpenLessonsFromKv(kv, { statuses: ['awaiting_review'], dryRun: true });
  assert.equal(result.cleared_count, 1);
  assert.equal(result.refunded_use_count, 1);
  const entry = result.cleared[0];
  assert.equal(entry.refunded_use, true);
  const afterRecord = JSON.parse(kv.store.get(CODE_B));
  assert.equal(afterRecord.uses_remaining, beforeRecord.uses_remaining);
  assert.notEqual(afterRecord.progress.current_pack, null);
  assert.equal(kv.store.has('task:task-abc'), true);
});

test('generation_in_progress clear does not refund luot', async () => {
  const kv = createKv({
    [CODE_A]: codeRecord('generation_in_progress'),
    'task:task-abc': { status: 'pending' },
  });
  const result = await clearOpenLessonsFromKv(kv, {});
  assert.equal(result.cleared_count, 1);
  assert.equal(result.refunded_use_count, 0);
  const entry = result.cleared[0];
  assert.equal(entry.refunded_use, false);
  const record = JSON.parse(kv.store.get(CODE_A));
  assert.equal(record.uses_remaining, 5);
  assert.equal(record.progress.current_pack, null);
});

test('PATCH admin code clear_current_pack nulls current_pack only', async () => {
  const kv = createKv({
    [CODE_A]: codeRecord('awaiting_review'),
    'task:task-abc': { status: 'done' },
  });
  const response = await patchCode({
    request: new Request(`https://example.com/api/admin/codes/${CODE_A}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_current_pack: true }),
    }),
    env: { READ2LEAD_CODES: kv },
    params: { code: CODE_A },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.record.progress.current_pack, null);
  assert.equal(kv.store.has('task:task-abc'), false);
});
