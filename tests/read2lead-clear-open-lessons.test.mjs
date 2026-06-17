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

function codeRecord(status) {
  return {
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
    uses_remaining: 5,
  };
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

  assert.equal(result.cleared_count, 2);
  assert.equal(JSON.parse(kv.store.get(CODE_A)).progress.current_pack, null);
  assert.equal(JSON.parse(kv.store.get(CODE_B)).progress.current_pack, null);
  assert.equal(kv.store.has(`progress:${CODE_A}`), true);
  assert.equal(kv.store.has(`progress:${CODE_B}`), true);
  assert.equal(JSON.parse(kv.store.get(`progress:${CODE_A}`)).lifetime_rp, 42);
  assert.equal(kv.store.has('task:task-abc'), false);
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
