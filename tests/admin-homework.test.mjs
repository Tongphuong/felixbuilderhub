import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/admin/classes/[id]/homework.js';
import {
  validateHomeworkInput,
  parseHomeworkLines,
  parseFrameStems,
  buildHomeworkRecord,
} from '../functions/api/_homework.js';

// ---------------------------------------------------------------------------
// KV mock (same pattern as read2lead-clear-open-lessons.test.mjs)
// ---------------------------------------------------------------------------
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
    async delete(key) {
      store.delete(key);
    },
  };
}

const CLASS_STORE_KEY = 'admin:classes:v1';

function classStoreRecord(classes) {
  return { schema_version: 1, classes, updated_at: new Date().toISOString() };
}

function codeRecord(overrides = {}) {
  return {
    student_profile: { student_name: 'Minh', age: 8, level: 'L2', child_gender: 'boy' },
    progress: {
      current_level: 'L2',
      packs_created: 2,
      current_pack: {
        pack_id: 'pack-1',
        status: 'awaiting_review',
        task_id: 'task-abc',
        created_at: new Date().toISOString(),
      },
      review_history: [{ pack_id: 'old-pack', status: 'reviewed_pass_web_v2' }],
    },
    uses_remaining: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function postHomework(kv, classId, body) {
  const env = { READ2LEAD_CODES: kv };
  const request = new Request(`https://example.com/api/admin/classes/${classId}/homework`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await onRequestPost({ request, env, params: { id: classId } });
  const json = await response.json();
  return { response, json };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test('class-level save writes homework onto every roster member', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1', 'CODE2'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: codeRecord(),
    CODE2: codeRecord(),
  });

  const { response, json } = await postHomework(kv, 'class-1', {
    sentences_text: 'Hello\nHow are you?',
    frame_text: '',
    note_vi: 'Luyện nói',
  });

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.updated_count, 2);
  assert.equal(json.failed_count, 0);
  assert.equal(json.results.length, 2);
  assert.ok(json.results.every(r => r.ok));

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.ok(code1.homework);
  assert.ok(code2.homework);
  assert.equal(code1.homework.sentences.length, 2);
  assert.equal(code2.homework.sentences.length, 2);
  assert.equal(code1.homework.note_vi, 'Luyện nói');
});

test('re-saving replaces active set and prepends old to history (capped at 5)', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: codeRecord(),
  });

  // first save
  await postHomework(kv, 'class-1', { sentences_text: 'First', frame_text: '', note_vi: 'v1' });
  // second save
  await postHomework(kv, 'class-1', { sentences_text: 'Second', frame_text: '', note_vi: 'v2' });

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const hw = code1.homework;
  assert.equal(hw.sentences[0].text_en, 'Second');
  assert.equal(hw.history.length, 1);
  assert.equal(hw.history[0].sentences[0].text_en, 'First');
  assert.equal(hw.history[0].note_vi, 'v1');
  // history should not contain nested history
  assert.equal(hw.history[0].history, undefined);
});

test('per-student save updates only that student', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1', 'CODE2'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: codeRecord(),
    CODE2: codeRecord(),
  });

  const { json } = await postHomework(kv, 'class-1', {
    sentences_text: 'Only one',
    frame_text: '',
    codes: ['CODE1'],
  });

  assert.equal(json.updated_count, 1);
  assert.equal(json.failed_count, 0);
  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.ok(code1.homework);
  assert.equal(code2.homework, undefined);
});

test('subsequent class-level save after per-student override replaces that student too', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1', 'CODE2'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: codeRecord(),
    CODE2: codeRecord(),
  });

  // per-student override
  await postHomework(kv, 'class-1', { sentences_text: 'Override', frame_text: '', codes: ['CODE1'] });
  // class-level save
  await postHomework(kv, 'class-1', { sentences_text: 'Class-wide', frame_text: '' });

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.equal(code1.homework.sentences[0].text_en, 'Class-wide');
  assert.equal(code2.homework.sentences[0].text_en, 'Class-wide');
});

test('validation: >12 sentence lines rejected', () => {
  const lines = Array.from({ length: 13 }, (_, i) => `Line ${i + 1}`).join('\n');
  const result = validateHomeworkInput({ sentences_text: lines, frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('12'));
});

test('validation: >8 frame lines rejected', () => {
  const lines = Array.from({ length: 9 }, (_, i) => `Frame ___ ${i + 1}`).join('\n');
  const result = validateHomeworkInput({ sentences_text: '', frame_text: lines, frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('8'));
});

test('validation: frame line with no ___ blank rejected with Vietnamese message', () => {
  const result = validateHomeworkInput({ sentences_text: '', frame_text: 'No blank here', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('___'));
});

test('validation: empty lines are ignored and do not count toward limits', () => {
  const text = 'Line1\n\n\nLine2';
  const result = validateHomeworkInput({ sentences_text: text, frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, true);
  assert.equal(result.value.sentences.length, 2);
});

test('validation: both sentences_text and frame_text empty → rejected', () => {
  const result = validateHomeworkInput({ sentences_text: '', frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('ít nhất'));
});

test('round-trip / no-clobber: other fields survive untouched', async () => {
  const original = codeRecord({ uses_remaining: 7 });
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: original,
  });

  await postHomework(kv, 'class-1', { sentences_text: 'Hello', frame_text: '', note_vi: 'test' });

  const updated = JSON.parse(kv.store.get('CODE1'));
  assert.ok(updated.homework);
  assert.equal(updated.uses_remaining, 7);
  assert.equal(updated.student_profile.student_name, 'Minh');
  assert.equal(updated.progress.current_level, 'L2');
  assert.equal(updated.progress.packs_created, 2);
  assert.equal(updated.progress.current_pack.pack_id, 'pack-1');
});

test('missing/revoked code in roster → reported as code_not_found, does not abort processing', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1', 'CODE2'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: codeRecord(),
    // CODE2 missing
  });

  const { json } = await postHomework(kv, 'class-1', { sentences_text: 'Hi', frame_text: '' });

  assert.equal(json.updated_count, 1);
  assert.equal(json.failed_count, 1);
  const okResult = json.results.find(r => r.code === 'CODE1');
  const failResult = json.results.find(r => r.code === 'CODE2');
  assert.ok(okResult.ok);
  assert.equal(failResult.ok, false);
  assert.equal(failResult.error, 'code_not_found');
});

test('class not found → 404', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([]),
  });
  const { response, json } = await postHomework(kv, 'nonexistent', { sentences_text: 'Hi', frame_text: '' });
  assert.equal(response.status, 404);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'class_not_found');
});

test('invalid JSON body → 400', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      {
        id: 'class-1',
        name: 'Test Class',
        student_codes: ['CODE1'],
        positive_presets: [],
        needs_work_presets: [],
        attendance_by_date: {},
      },
    ]),
    CODE1: codeRecord(),
  });
  const env = { READ2LEAD_CODES: kv };
  const request = new Request('https://example.com/api/admin/classes/class-1/homework', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  const response = await onRequestPost({ request, env, params: { id: 'class-1' } });
  const json = await response.json();
  assert.equal(response.status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'invalid_json');
});
