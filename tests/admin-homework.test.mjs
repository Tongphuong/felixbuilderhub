import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/admin/classes/[id]/homework.js';
import {
  validateHomeworkInput,
  validateHomeworkTasksInput,
  validateTask,
  parseHomeworkLines,
  parseFrameStems,
  deriveAnchorWords,
  normalizeWordList,
  validateEnglishText,
  buildHomeworkRecord,
  validatePhotoRef,
  normalizeHomeworkRecord,
  normalizeTeacherLine,
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

const VALID_PHOTO = {
  id: 'hp_abc123def456',
  r2_key: 'homework/class1/hp_abc123def456.jpg',
  content_type: 'image/jpeg',
  size: 250000,
};

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

function oneClassStore(studentCodes) {
  return classStoreRecord([
    {
      id: 'class-1',
      name: 'Test Class',
      student_codes: studentCodes,
      positive_presets: [],
      needs_work_presets: [],
      attendance_by_date: {},
    },
  ]);
}

function findTask(homework, type) {
  return (homework.tasks || []).find((t) => t.type === type);
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
// Endpoint tests — OLD payload shape (sentences_text/frame_text), now saved
// as schema v3 with tasks[]. Backward compatible per contract §4.
// ---------------------------------------------------------------------------
test('class-level save (old payload shape) writes a v3 record onto every roster member', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1', 'CODE2']),
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
  assert.ok(json.results.every((r) => r.ok));

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.ok(code1.homework);
  assert.equal(code1.homework.schema_version, 3);
  const readTask1 = findTask(code1.homework, 'read');
  const readTask2 = findTask(code2.homework, 'read');
  assert.equal(readTask1.items.length, 2);
  assert.equal(readTask2.items.length, 2);
  assert.equal(code1.homework.note_vi, 'Luyện nói');
});

test('re-saving (old shape) replaces active set and prepends old to history (capped at 5)', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1']),
    CODE1: codeRecord(),
  });

  await postHomework(kv, 'class-1', { sentences_text: 'First', frame_text: '', note_vi: 'v1' });
  await postHomework(kv, 'class-1', { sentences_text: 'Second', frame_text: '', note_vi: 'v2' });

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const hw = code1.homework;
  assert.equal(findTask(hw, 'read').items[0].text_en, 'Second');
  assert.equal(hw.history.length, 1);
  assert.equal(findTask(hw.history[0], 'read').items[0].text_en, 'First');
  assert.equal(hw.history[0].note_vi, 'v1');
  // history should not contain nested history
  assert.equal(hw.history[0].history, undefined);
});

test('per-student save updates only that student', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1', 'CODE2']),
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
    [CLASS_STORE_KEY]: oneClassStore(['CODE1', 'CODE2']),
    CODE1: codeRecord(),
    CODE2: codeRecord(),
  });

  await postHomework(kv, 'class-1', { sentences_text: 'Override', frame_text: '', codes: ['CODE1'] });
  await postHomework(kv, 'class-1', { sentences_text: 'Class-wide', frame_text: '' });

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.equal(findTask(code1.homework, 'read').items[0].text_en, 'Class-wide');
  assert.equal(findTask(code2.homework, 'read').items[0].text_en, 'Class-wide');
});

test('validation (old shape): >12 sentence lines rejected', () => {
  const lines = Array.from({ length: 13 }, (_, i) => `Line ${i + 1}`).join('\n');
  const result = validateHomeworkInput({ sentences_text: lines, frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('12'));
});

test('validation (old shape): >8 frame lines rejected', () => {
  const lines = Array.from({ length: 9 }, (_, i) => `Frame ___ ${i + 1}`).join('\n');
  const result = validateHomeworkInput({ sentences_text: '', frame_text: lines, frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('8'));
});

test('validation (old shape): frame line with no ___ blank rejected with Vietnamese message', () => {
  const result = validateHomeworkInput({ sentences_text: '', frame_text: 'No blank here', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('___'));
});

test('validation (old shape): empty lines are ignored and do not count toward limits', () => {
  const text = 'Line1\n\n\nLine2';
  const result = validateHomeworkInput({ sentences_text: text, frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, true);
  assert.equal(findTask({ tasks: result.value.tasks }, 'read').items.length, 2);
});

test('validation (old shape): both sentences_text and frame_text empty → rejected', () => {
  const result = validateHomeworkInput({ sentences_text: '', frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('ít nhất'));
});

test('round-trip / no-clobber: other fields survive untouched', async () => {
  const original = codeRecord({ uses_remaining: 7 });
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1']),
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
    [CLASS_STORE_KEY]: oneClassStore(['CODE1', 'CODE2']),
    CODE1: codeRecord(),
    // CODE2 missing
  });

  const { json } = await postHomework(kv, 'class-1', { sentences_text: 'Hi', frame_text: '' });

  assert.equal(json.updated_count, 1);
  assert.equal(json.failed_count, 1);
  const okResult = json.results.find((r) => r.code === 'CODE1');
  const failResult = json.results.find((r) => r.code === 'CODE2');
  assert.ok(okResult.ok);
  assert.equal(failResult.ok, false);
  assert.equal(failResult.error, 'code_not_found');
});

test('class not found → 404', async () => {
  const kv = createKv({ [CLASS_STORE_KEY]: classStoreRecord([]) });
  const { response, json } = await postHomework(kv, 'nonexistent', { sentences_text: 'Hi', frame_text: '' });
  assert.equal(response.status, 404);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'class_not_found');
});

test('invalid JSON body → 400', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1']),
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

test('validatePhotoRef: null and undefined are valid (no photo)', () => {
  assert.deepEqual(validatePhotoRef(null, 'class1'), { ok: true, value: null });
  assert.deepEqual(validatePhotoRef(undefined, 'class1'), { ok: true, value: null });
});

test('validatePhotoRef: valid descriptor round-trips', () => {
  const res = validatePhotoRef(VALID_PHOTO, 'class1');
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, VALID_PHOTO);
});

test('validatePhotoRef: bad id, HEIC type, oversize, wrong-class key all rejected', () => {
  assert.equal(validatePhotoRef({ ...VALID_PHOTO, id: 'hp_TOOSHORT' }, 'class1').ok, false);
  const heic = validatePhotoRef({ ...VALID_PHOTO, content_type: 'image/heic' }, 'class1');
  assert.equal(heic.ok, false);
  assert.match(heic.error_vi, /JPEG/);
  const big = validatePhotoRef({ ...VALID_PHOTO, size: 9 * 1024 * 1024 }, 'class1');
  assert.equal(big.ok, false);
  assert.match(big.error_vi, /8MB/);
  assert.equal(validatePhotoRef(VALID_PHOTO, 'other-class').ok, false);
});

test('normalizeHomeworkRecord: v1 record gains photo:null + tasks[], v2 photo passes through, null stays null', () => {
  const v1 = { schema_version: 1, sentences: [{ id: 's1', text_en: 'Hi.' }], frame: null, note_vi: '', history: [] };
  const normalized = normalizeHomeworkRecord(v1);
  assert.equal(normalized.photo, null);
  assert.deepEqual(normalized.sentences, v1.sentences);
  assert.equal(normalized.tasks.length, 1);
  assert.equal(normalized.tasks[0].type, 'read');
  assert.equal(normalized.tasks[0].items[0].text_en, 'Hi.');
  const v2 = { schema_version: 2, sentences: [], frame: null, photo: VALID_PHOTO, history: [] };
  assert.deepEqual(normalizeHomeworkRecord(v2).photo, VALID_PHOTO);
  assert.equal(normalizeHomeworkRecord(null), null);
  assert.equal(normalizeHomeworkRecord(undefined), null);
});

test('normalizeHomeworkRecord: v3 record passes through tasks[] unchanged (idempotent)', () => {
  const v3 = {
    schema_version: 3,
    note_vi: '',
    photo: null,
    tasks: [{ id: 't1', type: 'read', items: [{ id: 's1', text_en: 'Hi.' }] }],
    history: [],
  };
  const normalized = normalizeHomeworkRecord(v3);
  assert.deepEqual(normalized.tasks, v3.tasks);
});

test('validateHomeworkInput carries photo into value; buildHomeworkRecord emits schema v3 with photo + read task', () => {
  const validation = validateHomeworkInput({
    sentences_text: 'I like cats.',
    frame_text: '',
    frame_duration_s: 60,
    note_vi: '',
    photo: VALID_PHOTO,
    class_id: 'class1',
  });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.value.photo, VALID_PHOTO);
  const record = buildHomeworkRecord(validation.value, null);
  assert.equal(record.schema_version, 3);
  assert.deepEqual(record.photo, VALID_PHOTO);
  assert.equal(findTask(record, 'read').items[0].text_en, 'I like cats.');
});

test('validateHomeworkInput with invalid photo fails validation', () => {
  const validation = validateHomeworkInput({
    sentences_text: 'I like cats.',
    frame_text: '',
    frame_duration_s: 60,
    note_vi: '',
    photo: { ...VALID_PHOTO, content_type: 'image/heic' },
    class_id: 'class1',
  });
  assert.equal(validation.ok, false);
});

test('buildHomeworkRecord without photo emits photo:null and preserves v1 history record untouched', () => {
  const prev = { schema_version: 1, sentences: [{ id: 's1', text_en: 'Old.' }], frame: null, note_vi: '', history: [] };
  const validation = validateHomeworkInput({
    sentences_text: 'New sentence.',
    frame_text: '',
    frame_duration_s: 60,
    note_vi: '',
  });
  assert.equal(validation.ok, true);
  const record = buildHomeworkRecord(validation.value, prev);
  assert.equal(record.schema_version, 3);
  assert.equal(record.photo, null);
  assert.equal(record.history.length, 1);
  assert.equal(record.history[0].schema_version, 1);
});

test('endpoint: photo descriptor persists to every roster code (one object, N references)', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      { id: 'class1', name: 'Test Class', student_codes: ['CODE1', 'CODE2'], positive_presets: [], needs_work_presets: [], attendance_by_date: {} },
    ]),
    CODE1: codeRecord(),
    CODE2: codeRecord(),
  });

  const { response, json } = await postHomework(kv, 'class1', {
    sentences_text: 'I like cats.',
    frame_text: '',
    frame_duration_s: 60,
    note_vi: '',
    photo: VALID_PHOTO,
  });

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.updated_count, 2);
  assert.equal(json.failed_count, 0);

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.equal(code1.homework.schema_version, 3);
  assert.deepEqual(code1.homework.photo, VALID_PHOTO);
  assert.equal(code2.homework.schema_version, 3);
  assert.deepEqual(code2.homework.photo, VALID_PHOTO);
});

test('endpoint: invalid photo (r2_key from another class) → 400 validation_failed, no KV writes', async () => {
  const invalidPhoto = { ...VALID_PHOTO, r2_key: 'homework/other-class/hp_abc123def456.jpg' };

  const kv = createKv({
    [CLASS_STORE_KEY]: classStoreRecord([
      { id: 'class1', name: 'Test Class', student_codes: ['CODE1', 'CODE2'], positive_presets: [], needs_work_presets: [], attendance_by_date: {} },
    ]),
    CODE1: codeRecord(),
    CODE2: codeRecord(),
  });

  const { response, json } = await postHomework(kv, 'class1', {
    sentences_text: 'I like cats.',
    frame_text: '',
    frame_duration_s: 60,
    note_vi: '',
    photo: invalidPhoto,
  });

  assert.equal(response.status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'validation_failed');

  const code1 = JSON.parse(kv.store.get('CODE1'));
  const code2 = JSON.parse(kv.store.get('CODE2'));
  assert.equal(code1.homework, undefined);
  assert.equal(code2.homework, undefined);
});

test('teacher input normalization: curly quotes/apostrophes/dashes become plain in sentences', () => {
  const r = parseHomeworkLines('It’s sunny today.\n“Great job” - said Minny');
  assert.equal(r.ok, true);
  assert.equal(r.lines[0].text_en, "It's sunny today.");
  assert.equal(r.lines[1].text_en, '"Great job" - said Minny');
});

test('sentences: colon title passes; underscore line gets the frame-box hint; foreign char is named', () => {
  assert.equal(parseHomeworkLines('Stage 4: MY TRIP STORY!').ok, true);
  const underscore = parseHomeworkLines('Last summer, I went to ________ .');
  assert.equal(underscore.ok, false);
  assert.match(underscore.error_vi, /Khung thuyết trình/);
  const viet = parseHomeworkLines('Bé đọc to');
  assert.equal(viet.ok, false);
  assert.match(viet.error_vi, /"é"/);
});

test('frame: long underscore runs and 2-underscore blanks normalize to ___; Stage-4 stems all pass', () => {
  const short = parseFrameStems('I went to __ .');
  assert.equal(short.ok, true);
  assert.equal(short.stems[0].text_en, 'I went to ___ .');
  const stage4 = parseFrameStems([
    '“Last summer, I went to ________ .”',
    '“The weather was ________ .”',
    '“I saw ________ . It was ________ !”',
    '“I ________ with my ________ .”',
    '“I felt ________ because ________ .”',
    '“It was the best trip because ________ !”',
  ].join('\n'));
  assert.equal(stage4.ok, true);
  assert.equal(stage4.stems.length, 6);
  assert.equal(stage4.stems[0].text_en, '"Last summer, I went to ___ ."');
  assert.deepEqual(stage4.stems[0].anchor_words, ['last', 'summer', 'i', 'went', 'to']);
});

test('frame: a line with no blank at all still gets the missing-blank error', () => {
  const r = parseFrameStems('I like my trip.');
  assert.equal(r.ok, false);
  assert.match(r.error_vi, /chỗ trống/);
});

test('photo-only homework (old shape) validates and compiles to a zero-anchor picture task carrying the duration', () => {
  const validation = validateHomeworkInput({
    sentences_text: '',
    frame_text: '',
    frame_duration_s: 90,
    note_vi: 'Xem ảnh và thuyết trình nhé',
    photo: VALID_PHOTO,
    class_id: 'class1',
  });
  assert.equal(validation.ok, true);
  const record = buildHomeworkRecord(validation.value, null);
  assert.deepEqual(record.photo, VALID_PHOTO);
  assert.equal(record.tasks.length, 1);
  assert.equal(record.tasks[0].type, 'picture');
  assert.deepEqual(record.tasks[0].anchors, []);
  assert.equal(record.tasks[0].duration_s, 90);
});

test('empty homework without photo still rejected; text-only homework (old shape) produces no picture task', () => {
  const empty = validateHomeworkInput({ sentences_text: '', frame_text: '', frame_duration_s: 60, note_vi: '' });
  assert.equal(empty.ok, false);
  assert.match(empty.error_vi, /ảnh bài tập/);
  const withText = validateHomeworkInput({
    sentences_text: 'I like cats.',
    frame_text: '',
    frame_duration_s: 60,
    note_vi: '',
    photo: VALID_PHOTO,
    class_id: 'class1',
  });
  assert.equal(withText.ok, true);
  const record = buildHomeworkRecord(withText.value, null);
  assert.equal(findTask(record, 'picture'), undefined, 'a photo alongside real text must not also synthesize a picture task');
});

// ---------------------------------------------------------------------------
// Schema v3 — charset '/' fix + URL/contact fence (Elon corrections,
// 2026-07-13, applied after a real-lesson probe against Phương's content).
// ---------------------------------------------------------------------------

test('charset: "/" is allowed in read sentences and frame stems (real lesson text, previously silently rejected)', () => {
  const sentence = parseHomeworkLines('He/She is kind when helping.');
  assert.equal(sentence.ok, true);
  assert.equal(sentence.lines[0].text_en, 'He/She is kind when helping.');

  const stem = parseFrameStems('Yes/No, my friend is ___ because ___.');
  assert.equal(stem.ok, true);
  assert.equal(stem.stems[0].text_en, 'Yes/No, my friend is ___ because ___.');
});

test('deriveAnchorWords: "/" splits into separate anchor words, not one concatenated token', () => {
  assert.deepEqual(deriveAnchorWords('He/She is kind when ___.'), ['he', 'she', 'is', 'kind', 'when']);
  assert.deepEqual(deriveAnchorWords('Yes/No, my friend is ___ because ___.'), ['yes', 'no', 'my', 'friend', 'is', 'because']);
});

test('validateEnglishText: URL/www/domain/email all rejected; slash sentences accepted', () => {
  assert.equal(validateEnglishText('Visit http://evil.example.com now.').ok, false);
  assert.equal(validateEnglishText('Visit http://evil.example.com now.').reason, 'url');
  assert.equal(validateEnglishText('Go to www.badsite.vn').ok, false);
  assert.equal(validateEnglishText('Check out cool-site.com today.').ok, false);
  assert.equal(validateEnglishText('Email me at kid@example.com').ok, false);

  assert.equal(validateEnglishText('He/She is kind when helping.').ok, true);
  assert.equal(validateEnglishText('Yes/No, my friend is ___ because ___.', { allowUnderscore: true }).ok, true);
});

test('parseHomeworkLines / parseFrameStems reject a URL with the link error, not a charset error', () => {
  const s = parseHomeworkLines('Visit http://evil.example.com now.');
  assert.equal(s.ok, false);
  assert.match(s.error_vi, /đường link/);
  const f = parseFrameStems('Go to www.badsite.vn for ___.');
  assert.equal(f.ok, false);
  assert.match(f.error_vi, /đường link/);
});

test('validateEnglishText: still rejects genuinely unsupported characters (no loosening beyond "/")', () => {
  const angle = validateEnglishText('I like <b>cats</b>.');
  assert.equal(angle.ok, false);
  assert.equal(angle.reason, 'charset');
  const emoji = validateEnglishText('I like cats 🐱');
  assert.equal(emoji.ok, false);
  assert.equal(emoji.reason, 'charset');
});

// ---------------------------------------------------------------------------
// Schema v3 — validateHomeworkTasksInput (NEW payload shape) + validateTask
// per type, every rejection path.
// ---------------------------------------------------------------------------

test('validateHomeworkTasksInput: happy path with a read task', () => {
  const result = validateHomeworkTasksInput({
    tasks: [{ id: 't1', type: 'read', items: [{ id: 's1', text_en: 'I have two cats.' }] }],
    note_vi: 'Luyện đọc',
    photo: null,
    class_id: 'class1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.tasks.length, 1);
  assert.equal(result.value.tasks[0].type, 'read');
  assert.equal(result.value.tasks[0].items[0].text_en, 'I have two cats.');
  assert.equal(result.value.note_vi, 'Luyện đọc');
});

test('validateHomeworkTasksInput: >8 tasks rejected', () => {
  const tasks = Array.from({ length: 9 }, (_, i) => ({ type: 'read', items: [{ text_en: `Line ${i}` }] }));
  const result = validateHomeworkTasksInput({ tasks, photo: null, class_id: 'class1' });
  assert.equal(result.ok, false);
  assert.ok(result.error_vi.includes('8'));
});

test('validateHomeworkTasksInput: 0 tasks + no photo rejected with the shared empty-homework message', () => {
  const result = validateHomeworkTasksInput({ tasks: [], photo: null, class_id: 'class1' });
  assert.equal(result.ok, false);
  assert.match(result.error_vi, /ít nhất/);
});

test('validateHomeworkTasksInput: 0 tasks + a photo is allowed (bare-photo payload)', () => {
  const result = validateHomeworkTasksInput({ tasks: [], photo: VALID_PHOTO, class_id: 'class1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.tasks, []);
  assert.deepEqual(result.value.photo, VALID_PHOTO);
});

test('validateHomeworkTasksInput: rejects the whole submission on the first invalid task (all-or-nothing)', () => {
  const result = validateHomeworkTasksInput({
    tasks: [
      { type: 'read', items: [{ text_en: 'Good one.' }] },
      { type: 'read', items: [] },
    ],
    photo: null,
    class_id: 'class1',
  });
  assert.equal(result.ok, false);
  assert.match(result.error_vi, /Nhiệm vụ 2/);
});

test('validateTask: unknown type rejected', () => {
  const result = validateTask({ type: 'bogus' }, 0, {});
  assert.equal(result.ok, false);
});

test('validateTask: not an object rejected', () => {
  assert.equal(validateTask(null, 0, {}).ok, false);
  assert.equal(validateTask('read', 0, {}).ok, false);
  assert.equal(validateTask(['x'], 0, {}).ok, false);
});

// -- read --
test('validateTask(read): 1..12 items enforced; over-length item rejected', () => {
  assert.equal(validateTask({ type: 'read', items: [] }, 0, {}).ok, false);
  const tooMany = Array.from({ length: 13 }, (_, i) => ({ text_en: `Item ${i}` }));
  assert.equal(validateTask({ type: 'read', items: tooMany }, 0, {}).ok, false);
  const long = validateTask({ type: 'read', items: [{ text_en: 'x'.repeat(201) }] }, 0, {});
  assert.equal(long.ok, false);
});

test('validateTask(read): accepts plain-string items (extractor draft shape) and assigns positional ids', () => {
  const result = validateTask({ type: 'read', items: ['I have two cats.', 'She runs fast.'] }, 0, {});
  assert.equal(result.ok, true);
  assert.equal(result.value.items[0].id, 's1');
  assert.equal(result.value.items[1].id, 's2');
  assert.equal(result.value.items[0].text_en, 'I have two cats.');
});

test('validateTask(read): trusts a caller-supplied id when well-formed', () => {
  const result = validateTask({ id: 'my-task', type: 'read', items: [{ id: 'custom-1', text_en: 'Hi.' }] }, 0, {});
  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'my-task');
  assert.equal(result.value.items[0].id, 'custom-1');
});

// -- present --
test('validateTask(present): requires ___ blank; derives anchor_words; accepts plain-string stems (draft shape)', () => {
  const missingBlank = validateTask({ type: 'present', stems: ['I like cats.'] }, 0, {});
  assert.equal(missingBlank.ok, false);
  assert.match(missingBlank.error_vi, /chỗ trống/);

  const ok = validateTask({ type: 'present', stems: ['Last summer, I went to ___.'], duration_s: 45 }, 0, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.stems[0].id, 'f1');
  assert.deepEqual(ok.value.stems[0].anchor_words, ['last', 'summer', 'i', 'went', 'to']);
  assert.equal(ok.value.duration_s, 45);
});

test('validateTask(present): 1..8 stems enforced; duration_s clamps to 10..300', () => {
  assert.equal(validateTask({ type: 'present', stems: [] }, 0, {}).ok, false);
  const tooMany = Array.from({ length: 9 }, () => 'I like ___.');
  assert.equal(validateTask({ type: 'present', stems: tooMany }, 0, {}).ok, false);
  const clampedLow = validateTask({ type: 'present', stems: ['I like ___.'], duration_s: 1 }, 0, {});
  assert.equal(clampedLow.value.duration_s, 10);
  const clampedHigh = validateTask({ type: 'present', stems: ['I like ___.'], duration_s: 9999 }, 0, {});
  assert.equal(clampedHigh.value.duration_s, 300);
});

// -- story --
test('validateTask(story): prompt_en required and validated; must_use normalized; use_photo/duration handled', () => {
  const noPrompt = validateTask({ type: 'story' }, 0, {});
  assert.equal(noPrompt.ok, false);

  const ok = validateTask({
    type: 'story',
    prompt_en: 'Tell the story of your best friend.',
    prompt_vi: 'Con kể câu chuyện về người bạn thân nhé.',
    must_use: ['Because', 'FRIEND', 'happy happy', 'friend!'],
    duration_s: 90,
    use_photo: true,
  }, 0, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.type, 'story');
  assert.equal(ok.value.prompt_vi, 'Con kể câu chuyện về người bạn thân nhé.');
  // lowercase, alphanumeric-only, deduped, multi-word entries split
  assert.deepEqual(ok.value.must_use, ['because', 'friend', 'happy']);
  assert.equal(ok.value.duration_s, 90);
  assert.equal(ok.value.use_photo, true);
});

test('validateTask(story): must_use caps at 12 words, anchors-style task caps at 15', () => {
  const tooManyMustUse = validateTask({
    type: 'story',
    prompt_en: 'Tell a story.',
    must_use: Array.from({ length: 13 }, (_, i) => `word${i}`),
  }, 0, {});
  assert.equal(tooManyMustUse.ok, false);

  const tooManyAnchors = validateTask({
    type: 'picture',
    anchors: Array.from({ length: 16 }, (_, i) => `word${i}`),
  }, 0, { photo: VALID_PHOTO });
  assert.equal(tooManyAnchors.ok, false);
});

// -- build --
test('validateTask(build): 2..4 columns, 2..8 options each, sentences_required clamps to 1..5', () => {
  const oneColumn = validateTask({ type: 'build', columns: [{ label_en: 'We', options: ['play', 'run'] }] }, 0, {});
  assert.equal(oneColumn.ok, false);

  const oneOption = validateTask({
    type: 'build',
    columns: [
      { label_en: 'We', options: ['play'] },
      { label_en: 'At', options: ['school', 'home'] },
    ],
  }, 0, {});
  assert.equal(oneOption.ok, false);

  const ok = validateTask({
    type: 'build',
    columns: [
      { label_en: 'We…', options: ['play football', 'draw pictures', 'eat snacks'] },
      { label_en: 'At…', options: ['school', 'the park', 'my house'] },
    ],
    sentences_required: 99,
  }, 0, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.columns.length, 2);
  assert.equal(ok.value.columns[0].id, 'c1');
  assert.equal(ok.value.sentences_required, 5, 'clamped to the 1..5 max');
});

test('validateTask(build): 8 options in a column is accepted (vocab-card sheets need the full bank); 9 is rejected with the 2-8 Vietnamese error copy', () => {
  const eightOptions = validateTask({
    type: 'build',
    columns: [
      { label_en: 'It tastes...', options: ['sweet', 'sour', 'salty', 'spicy', 'bitter', 'fresh', 'crunchy', 'juicy'] },
      { label_en: 'and...', options: ['sweet', 'sour', 'salty', 'spicy', 'bitter', 'fresh', 'crunchy', 'juicy'] },
    ],
  }, 0, {});
  assert.equal(eightOptions.ok, true);
  assert.equal(eightOptions.value.columns[0].options.length, 8);

  const nineOptions = validateTask({
    type: 'build',
    columns: [
      { label_en: 'We…', options: ['play', 'run'] },
      { label_en: 'It tastes...', options: ['sweet', 'sour', 'salty', 'spicy', 'bitter', 'fresh', 'crunchy', 'juicy', 'tangy'] },
    ],
  }, 0, {});
  assert.equal(nineOptions.ok, false);
  assert.match(nineOptions.error_vi, /cần 2-8 lựa chọn/);
});

// -- picture --
test('validateTask(picture): requires a bound photo; anchors normalized; hidden-from-kid data stays server-side shape only', () => {
  const noPhoto = validateTask({ type: 'picture', anchors: ['dog'] }, 0, { photo: null });
  assert.equal(noPhoto.ok, false);

  const ok = validateTask({ type: 'picture', anchors: ['Dog', 'PARK', 'dog'], duration_s: 45 }, 0, { photo: VALID_PHOTO });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.anchors, ['dog', 'park']);
  assert.equal(ok.value.duration_s, 45);
});

test('validateTask(picture): zero anchors is a valid task shape (legacy-equivalent grading, opt-in coverage otherwise)', () => {
  const ok = validateTask({ type: 'picture', anchors: [] }, 0, { photo: VALID_PHOTO });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.anchors, []);
});

// -- qa --
test('validateTask(qa): question_en + stem required per card; stem accepts a plain string (draft shape)', () => {
  const ok = validateTask({
    type: 'qa',
    cards: [{ question_en: 'Is your friend funny?', stem: 'Yes/No, my friend is ___ because ___.' }],
  }, 0, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.cards[0].id, 'q1');
  assert.equal(ok.value.cards[0].question_en, 'Is your friend funny?');
  assert.equal(ok.value.cards[0].stem.text_en, 'Yes/No, my friend is ___ because ___.');
  assert.deepEqual(ok.value.cards[0].stem.anchor_words, ['yes', 'no', 'my', 'friend', 'is', 'because']);
});

test('validateTask(qa): 1..8 cards enforced; missing blank in stem rejected', () => {
  assert.equal(validateTask({ type: 'qa', cards: [] }, 0, {}).ok, false);
  const noBlank = validateTask({ type: 'qa', cards: [{ question_en: 'Is it fun?', stem: 'Yes, it is fun.' }] }, 0, {});
  assert.equal(noBlank.ok, false);
  assert.match(noBlank.error_vi, /chỗ trống/);
});

// -- normalizeWordList / URL fence on word lists --
test('normalizeWordList: multi-word entries split, dedupe, lowercase, cap count', () => {
  const result = normalizeWordList(['ice cream', 'Cream', 'HAPPY!'], 12);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, ['ice', 'cream', 'happy']);
});

test('normalizeWordList: a URL-looking raw token is rejected even inside a must_use/anchors list', () => {
  const result = normalizeWordList(['friend', 'visit www.badsite.com'], 12);
  assert.equal(result.ok, false);
  assert.match(result.error_vi, /đường link/);
});

test('validateHomeworkTasksInput: end-to-end with every task type in one payload', () => {
  const tasks = [
    { type: 'read', items: ['I have two cats.'] },
    { type: 'present', stems: ['Last summer, I went to ___.'], duration_s: 60 },
    { type: 'story', prompt_en: 'Tell the story of your best friend.', must_use: ['because', 'friend'], duration_s: 90 },
    {
      type: 'build',
      columns: [
        { label_en: 'We…', options: ['play football', 'draw pictures'] },
        { label_en: 'At…', options: ['school', 'the park'] },
      ],
      sentences_required: 2,
    },
    { type: 'picture', anchors: ['dog', 'park'], duration_s: 60 },
    { type: 'qa', cards: [{ question_en: 'Is your friend funny?', stem: 'Yes/No, my friend is ___ because ___.' }] },
  ];
  const result = validateHomeworkTasksInput({ tasks, note_vi: '', photo: VALID_PHOTO, class_id: 'class1' });
  assert.equal(result.ok, true);
  assert.equal(result.value.tasks.length, 6);
  assert.deepEqual(result.value.tasks.map((t) => t.type), ['read', 'present', 'story', 'build', 'picture', 'qa']);
});

test('endpoint: NEW tasks[] payload shape saves as schema v3', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1']),
    CODE1: codeRecord(),
  });

  const { response, json } = await postHomework(kv, 'class-1', {
    tasks: [{ type: 'read', items: ['Hello there.'] }],
    note_vi: 'Bài mới',
  });

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  const code1 = JSON.parse(kv.store.get('CODE1'));
  assert.equal(code1.homework.schema_version, 3);
  assert.equal(findTask(code1.homework, 'read').items[0].text_en, 'Hello there.');
  assert.equal(code1.homework.note_vi, 'Bài mới');
});

test('endpoint: NEW tasks[] payload with an invalid task → 400 validation_failed, no KV writes', async () => {
  const kv = createKv({
    [CLASS_STORE_KEY]: oneClassStore(['CODE1']),
    CODE1: codeRecord(),
  });

  const { response, json } = await postHomework(kv, 'class-1', {
    tasks: [{ type: 'picture', anchors: [] }], // no photo bound -> invalid
  });

  assert.equal(response.status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'validation_failed');
  const code1 = JSON.parse(kv.store.get('CODE1'));
  assert.equal(code1.homework, undefined);
});

// --- Buffet red-team fix (2026-07-13): URL fence TLD allowlist was incomplete ---
// The old fence listed only com|net|org|io|vn|co|xyz|ru|cn, so "Go to evil.app
// today." validated and reached the kid's screen and TTS. Now matches domain
// SHAPE, not a TLD list.
test('URL fence: rejects domains outside the old TLD allowlist (Buffet repro)', () => {
  for (const bad of ['Go to evil.app today.', 'Visit my.info now.', 'See cool.dev here.', 'Try open.ai please.']) {
    const r = validateHomeworkTasksInput({
      tasks: [{ type: 'read', items: [{ text_en: bad }] }],
      photo: null, class_id: 'c1',
    });
    assert.equal(r.ok, false, `should reject: ${bad}`);
  }
});

test('URL fence: still rejects the classic forms', () => {
  for (const bad of ['Visit http://evil.example.com now.', 'Go to www.badsite.vn', 'Mail me at a@b.com']) {
    const r = validateHomeworkTasksInput({
      tasks: [{ type: 'read', items: [{ text_en: bad }] }],
      photo: null, class_id: 'c1',
    });
    assert.equal(r.ok, false, `should reject: ${bad}`);
  }
});

// The fence must not become so broad it eats ordinary teacher English. The
// abbreviation cases are the ones at risk from a domain-SHAPE rule: they all
// have a 1-letter or space-separated tail, so none of them match.
test('URL fence: does NOT reject ordinary teacher English (read items)', () => {
  const good = [
    'I have two cats.',
    'I wake up at 7 a.m. every day.',
    'We eat lunch at 12 p.m.',
    'My name is Nam.',
    'We play games (football, chess) at school.',
    'Pi is about 3.14 you know.',
  ];
  for (const text of good) {
    const r = validateHomeworkTasksInput({
      tasks: [{ type: 'read', items: [{ text_en: text }] }],
      photo: null, class_id: 'c1',
    });
    assert.equal(r.ok, true, `should ACCEPT: ${text} — got ${r.ok ? '' : r.error_vi}`);
  }
});

// Phương's real lesson patterns — slashes AND ___ blanks — live in qa stems,
// where the blank is legal. (A ___ in a plain read item is correctly rejected:
// blanks belong in a frame, not a sentence to read aloud.)
test('URL fence + charset: real "He/She" / "Yes/No" qa stems validate', () => {
  const r = validateHomeworkTasksInput({
    tasks: [{
      type: 'qa',
      cards: [
        { question_en: 'Is your friend kind?', stem: 'He/She is kind when ___.' },
        { question_en: 'Is your friend funny?', stem: 'Yes/No, my friend is ___ because ___.' },
      ],
      duration_s: 30,
    }],
    photo: null, class_id: 'c1',
  });
  assert.equal(r.ok, true, r.ok ? '' : r.error_vi);
  assert.equal(r.value.tasks[0].cards.length, 2);
});
