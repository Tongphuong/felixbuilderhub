import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestPost as uploadPhoto,
  onRequestGet as previewPhoto,
  makeHomeworkPhotoId,
  validatePhotoFile,
} from '../functions/api/admin/classes/[id]/homework-photo.js';
import { onRequestGet as kidPhoto } from '../functions/api/speakup-homework-photo.js';

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

function createR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, body, opts = {}) {
      objects.set(key, { body, contentType: opts.httpMetadata?.contentType });
    },
    async get(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        body: stored.body,
        httpMetadata: { contentType: stored.contentType },
        httpEtag: '"etag-' + key + '"',
      };
    },
  };
}

const CLASS_STORE_KEY = 'admin:classes:v1';

function classStore() {
  return {
    schema_version: 1,
    classes: [{ id: 'class1', name: 'Lớp 1', student_codes: ['R2L-A-1111'], positive_presets: [], needs_work_presets: [] }],
    updated_at: new Date().toISOString(),
  };
}

function uploadRequest(file, classId = 'class1') {
  const form = new FormData();
  if (file) form.append('photo', file, 'photo.jpg');
  return new Request(`https://example.com/api/admin/classes/${classId}/homework-photo`, {
    method: 'POST',
    body: form,
  });
}

test('makeHomeworkPhotoId shape', () => {
  const id = makeHomeworkPhotoId();
  assert.match(id, /^hp_[a-z0-9]{12}$/);
});

test('validatePhotoFile: HEIC rejected with dedicated error, others per allow-list', () => {
  assert.equal(validatePhotoFile(new Blob(['x'], { type: 'image/heic' })).error, 'photo_heic');
  assert.equal(validatePhotoFile(new Blob(['x'], { type: 'image/gif' })).error, 'photo_type_invalid');
  assert.equal(validatePhotoFile(new Blob([], { type: 'image/jpeg' })).error, 'photo_empty');
  assert.equal(validatePhotoFile(new Blob(['x'], { type: 'image/jpeg' })).ok, true);
});

test('upload stores object under class-scoped key and returns descriptor', async () => {
  const kv = createKv({ [CLASS_STORE_KEY]: classStore() });
  const r2 = createR2();
  const response = await uploadPhoto({
    request: uploadRequest(new Blob(['jpeg-bytes'], { type: 'image/jpeg' })),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
    params: { id: 'class1' },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.photo.id, /^hp_[a-z0-9]{12}$/);
  assert.equal(body.photo.r2_key, `homework/class1/${body.photo.id}.jpg`);
  assert.equal(body.photo.content_type, 'image/jpeg');
  assert.ok(r2.objects.has(body.photo.r2_key));
});

test('upload to unknown class → 404, nothing written to R2', async () => {
  const kv = createKv({ [CLASS_STORE_KEY]: classStore() });
  const r2 = createR2();
  const response = await uploadPhoto({
    request: uploadRequest(new Blob(['x'], { type: 'image/jpeg' }), 'ghost'),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
    params: { id: 'ghost' },
  });
  assert.equal(response.status, 404);
  assert.equal(r2.objects.size, 0);
});

test('oversize upload → 413 with Vietnamese message', async () => {
  const kv = createKv({ [CLASS_STORE_KEY]: classStore() });
  const r2 = createR2();
  const big = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/jpeg' });
  const response = await uploadPhoto({
    request: uploadRequest(big),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
    params: { id: 'class1' },
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).message, /8MB/);
  assert.equal(r2.objects.size, 0);
});

test('missing R2 binding → 500 config_error', async () => {
  const response = await uploadPhoto({
    request: uploadRequest(new Blob(['x'], { type: 'image/jpeg' })),
    env: { READ2LEAD_CODES: createKv({ [CLASS_STORE_KEY]: classStore() }) },
    params: { id: 'class1' },
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'config_error');
});

test('preview GET streams a valid key and rejects foreign/malformed keys', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const env = { R2L_MEDIA: r2 };

  const ok = await previewPhoto({
    request: new Request('https://example.com/api/admin/classes/class1/homework-photo?key=homework/class1/hp_abc123def456.jpg'),
    env,
    params: { id: 'class1' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'image/jpeg');

  const foreign = await previewPhoto({
    request: new Request('https://example.com/api/admin/classes/class2/homework-photo?key=homework/class1/hp_abc123def456.jpg'),
    env,
    params: { id: 'class2' },
  });
  assert.equal(foreign.status, 404);

  const traversal = await previewPhoto({
    request: new Request('https://example.com/api/admin/classes/class1/homework-photo?key=portfolio/R2L-A-1111/vp_abc123def456.mp4'),
    env,
    params: { id: 'class1' },
  });
  assert.equal(traversal.status, 404);
});

function kidCodeRecord(withPhoto = true) {
  return {
    student_profile: { name: 'Linh' },
    homework: {
      schema_version: 2,
      note_vi: '',
      sentences: [{ id: 's1', text_en: 'Hi.', hint_vi: null }],
      frame: null,
      photo: withPhoto
        ? { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 }
        : null,
      history: [],
    },
  };
}

function kidRequest(code, id) {
  return new Request(`https://example.com/api/speakup-homework-photo?code=${code}&id=${id}`);
}

test('kid photo: valid code + current photo id streams the image with private caching', async () => {
  const kv = createKv({ 'R2L-A-1111': kidCodeRecord() });
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const response = await kidPhoto({
    request: kidRequest('R2L-A-1111', 'hp_abc123def456'),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.match(response.headers.get('Cache-Control'), /private/);
  assert.ok(response.headers.get('ETag'));
});

test('kid photo: 304 on matching If-None-Match', async () => {
  const kv = createKv({ 'R2L-A-1111': kidCodeRecord() });
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const env = { READ2LEAD_CODES: kv, R2L_MEDIA: r2 };
  const first = await kidPhoto({ request: kidRequest('R2L-A-1111', 'hp_abc123def456'), env });
  const etag = first.headers.get('ETag');
  const second = await kidPhoto({
    request: new Request(`https://example.com/api/speakup-homework-photo?code=R2L-A-1111&id=hp_abc123def456`, {
      headers: { 'If-None-Match': etag },
    }),
    env,
  });
  assert.equal(second.status, 304);
});

test('kid photo: wrong code → 4xx JSON, never the image', async () => {
  const kv = createKv({ 'R2L-A-1111': kidCodeRecord() });
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const response = await kidPhoto({
    request: kidRequest('R2L-GHOST-9999', 'hp_abc123def456'),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'code_not_found');
});

test('kid photo: id not on the CURRENT homework (e.g. old/foreign photo) → 404', async () => {
  const kv = createKv({ 'R2L-A-1111': kidCodeRecord() });
  const r2 = createR2();
  await r2.put('homework/class1/hp_zzz999zzz999.jpg', 'old-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const response = await kidPhoto({
    request: kidRequest('R2L-A-1111', 'hp_zzz999zzz999'),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: r2 },
  });
  assert.equal(response.status, 404);
});

test('kid photo: v1 homework (no photo field) → 404, no crash', async () => {
  const record = kidCodeRecord(false);
  record.homework.schema_version = 1;
  delete record.homework.photo;
  const kv = createKv({ 'R2L-A-1111': record });
  const response = await kidPhoto({
    request: kidRequest('R2L-A-1111', 'hp_abc123def456'),
    env: { READ2LEAD_CODES: kv, R2L_MEDIA: createR2() },
  });
  assert.equal(response.status, 404);
});
