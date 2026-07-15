import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestPost as uploadPhoto,
  onRequestGet as previewPhoto,
  makeHomeworkPhotoId,
  validatePhotoFile,
} from '../functions/api/admin/classes/[id]/homework-photo.js';
import { onRequestGet as kidPhoto } from '../functions/api/speakup-homework-photo.js';
import {
  onRequestPost as extractPhoto,
  parseVisionReply,
  buildDraft,
  extractWithOpenAI,
  OPENAI_VISION_MODEL,
  VISION_PROMPT,
} from '../functions/api/admin/classes/[id]/homework-photo-extract.js';

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

test('parseVisionReply: plain JSON, fenced JSON, prose-wrapped JSON, garbage', () => {
  assert.deepEqual(parseVisionReply('{"frame_lines":["I went to ___."],"sentence_lines":[]}').frame_lines, ['I went to ___.']);
  assert.deepEqual(parseVisionReply('Here you go:\n```json\n{"frame_lines":[],"sentence_lines":["I like cats."]}\n```').sentence_lines, ['I like cats.']);
  assert.equal(parseVisionReply('I could not read the image, sorry.'), null);
  assert.equal(parseVisionReply('{broken json'), null);
});

test('buildDraft: normalizes curly quotes and long blanks, drops invalid lines, caps counts', () => {
  const draft = buildDraft({
    frame_lines: ['“Last summer, I went to ________ .”', 'no blank in this line', '“I saw ________ there.”'],
    sentence_lines: ['It’s sunny today.', 'Câu tiếng Việt bị loại'],
  });
  assert.equal(draft.frame_text, '"Last summer, I went to ___ ."\n"I saw ___ there."');
  assert.equal(draft.sentences_text, "It's sunny today.");
  assert.equal(buildDraft({ frame_lines: [], sentence_lines: [] }), null);
  assert.equal(buildDraft(null), null);
});

test('extract endpoint: happy path returns sanity-passed draft via mocked env.AI', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  let seenModel = null;
  const env = {
    R2L_MEDIA: {
      ...r2,
      async get(key) {
        const stored = r2.objects.get(key);
        if (!stored) return null;
        return { arrayBuffer: async () => new TextEncoder().encode('jpeg-bytes').buffer };
      },
    },
    AI: {
      async run(model) {
        seenModel = model;
        return { response: '{"frame_lines":["“I went to ________ .”"],"sentence_lines":[]}' };
      },
    },
  };
  const response = await extractPhoto({
    request: new Request('https://example.com/api/admin/classes/class1/homework-photo-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r2_key: 'homework/class1/hp_abc123def456.jpg' }),
    }),
    env,
    params: { id: 'class1' },
  });
  assert.equal(response.status, 200);
  const bodyJson = await response.json();
  assert.equal(bodyJson.ok, true);
  assert.equal(bodyJson.draft.frame_text, '"I went to ___ ."');
  assert.equal(seenModel, '@cf/meta/llama-3.2-11b-vision-instruct');
});

test('extract endpoint: model garbage or thrown error → ok:true draft:null; foreign key → 404', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'x', { httpMetadata: { contentType: 'image/jpeg' } });
  const baseEnv = {
    R2L_MEDIA: {
      async get(key) {
        if (!r2.objects.has(key)) return null;
        return { arrayBuffer: async () => new ArrayBuffer(4) };
      },
    },
  };
  const req = (key, classId = 'class1') => new Request(`https://example.com/api/admin/classes/${classId}/homework-photo-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ r2_key: key }),
  });

  const garbage = await extractPhoto({
    request: req('homework/class1/hp_abc123def456.jpg'),
    env: { ...baseEnv, AI: { async run() { return { response: 'unreadable' }; } } },
    params: { id: 'class1' },
  });
  const garbageJson = await garbage.json();
  assert.equal(garbageJson.draft, null);
  assert.equal(garbageJson.draft_source, null, 'no reader produced a usable draft -> draft_source null too');

  const thrown = await extractPhoto({
    request: req('homework/class1/hp_abc123def456.jpg'),
    env: { ...baseEnv, AI: { async run() { throw new Error('boom'); } } },
    params: { id: 'class1' },
  });
  const thrownJson = await thrown.json();
  assert.equal(thrownJson.ok, true);
  assert.equal(thrownJson.draft, null);

  const foreign = await extractPhoto({
    request: req('homework/class1/hp_abc123def456.jpg', 'class2'),
    env: { ...baseEnv, AI: { async run() { return { response: '{}' }; } } },
    params: { id: 'class2' },
  });
  assert.equal(foreign.status, 404);
});

// ---------------------------------------------------------------------------
// extractWithOpenAI — PRIMARY vision path, gpt-4o-mini (speakup-vision-
// upgrade packet, founder-ratified 2026-07-15). fetchFn is injectable, same
// pattern as read2lead-speaking-check.js's transcribeWithOpenAI and
// _homework-feedback.js's generateHomeworkFeedback.
// ---------------------------------------------------------------------------

test('extractWithOpenAI: happy path JSON round-trip via mocked fetch, correct request shape', async () => {
  let capturedUrl = null;
  let capturedInit = null;
  const result = await extractWithOpenAI({
    imageBuffer: new TextEncoder().encode('jpeg-bytes').buffer,
    contentType: 'image/jpeg',
    apiKey: 'sk-test',
    fetchFn: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"frame_lines":[],"sentence_lines":["I have two cats."],"build_columns":[]}' } }],
      }), { status: 200 });
    },
  });
  assert.deepEqual(result, { frame_lines: [], sentence_lines: ['I have two cats.'], build_columns: [] });
  assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(capturedInit.headers.Authorization, 'Bearer sk-test');
  assert.ok(capturedInit.signal instanceof AbortSignal, 'must send an AbortSignal.timeout signal');
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, OPENAI_VISION_MODEL);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, VISION_PROMPT, 'system prompt is shared verbatim with the CF fallback model');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content[0].type, 'image_url');
  assert.match(body.messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('extractWithOpenAI: non-OK response is drained before falling back (bodyUsed guard, Workers 6-connection-cap leak pattern)', async () => {
  let capturedResponse;
  const result = await extractWithOpenAI({
    imageBuffer: new ArrayBuffer(4),
    contentType: 'image/jpeg',
    apiKey: 'sk-test',
    fetchFn: async () => {
      capturedResponse = new Response('rate limited', { status: 429 });
      return capturedResponse;
    },
  });
  assert.equal(result, null);
  assert.ok(capturedResponse, 'sanity: fetchFn was called');
  assert.equal(capturedResponse.bodyUsed, true, 'a non-OK response must have its body read before being discarded, or the connection leaks toward the isolate-kill cap');
});

test('extractWithOpenAI: OK response but unparseable model reply -> null (outer body already drained by res.json())', async () => {
  let capturedResponse;
  const result = await extractWithOpenAI({
    imageBuffer: new ArrayBuffer(4),
    contentType: 'image/jpeg',
    apiKey: 'sk-test',
    fetchFn: async () => {
      capturedResponse = new Response(JSON.stringify({ choices: [{ message: { content: 'I could not read the image, sorry.' } }] }), { status: 200 });
      return capturedResponse;
    },
  });
  assert.equal(result, null);
  assert.equal(capturedResponse.bodyUsed, true);
});

test('extractWithOpenAI: fetch throw (timeout/network) -> null, never throws', async () => {
  await assert.doesNotReject(async () => {
    const result = await extractWithOpenAI({
      imageBuffer: new ArrayBuffer(4),
      contentType: 'image/jpeg',
      apiKey: 'sk-test',
      fetchFn: async () => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      },
    });
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// onRequestPost fallback chain: no key -> CF direct; OpenAI success -> CF
// never called; OpenAI failure -> drained + CF fallback used; neither
// available -> no_ai_binding (early return preserved).
// ---------------------------------------------------------------------------

function r2WithBuffer(r2) {
  return {
    ...r2,
    async get(key) {
      const stored = r2.objects.get(key);
      if (!stored) return null;
      return { arrayBuffer: async () => new TextEncoder().encode('jpeg-bytes').buffer, httpMetadata: { contentType: 'image/jpeg' } };
    },
  };
}

function extractRequest(r2Key, classId = 'class1') {
  return new Request(`https://example.com/api/admin/classes/${classId}/homework-photo-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ r2_key: r2Key }),
  });
}

test('extract endpoint: OPENAI_API_KEY present -> uses OpenAI vision, never calls env.AI', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"frame_lines":["I went to ___."],"sentence_lines":[]}' } }],
  }), { status: 200 });
  try {
    const env = {
      R2L_MEDIA: r2WithBuffer(r2),
      OPENAI_API_KEY: 'sk-test',
      AI: { run: async () => { throw new Error('CF vision must not be called when OpenAI succeeds'); } },
    };
    const response = await extractPhoto({
      request: extractRequest('homework/class1/hp_abc123def456.jpg'),
      env,
      params: { id: 'class1' },
    });
    const bodyJson = await response.json();
    assert.equal(bodyJson.ok, true);
    assert.equal(bodyJson.draft.frame_text, 'I went to ___.');
    assert.equal(bodyJson.draft_source, 'openai');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract endpoint: OpenAI non-OK response falls back to CF vision model cleanly (bodyUsed drained)', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const originalFetch = globalThis.fetch;
  let capturedResponse;
  globalThis.fetch = async () => {
    capturedResponse = new Response('server error', { status: 500 });
    return capturedResponse;
  };
  try {
    const env = {
      R2L_MEDIA: r2WithBuffer(r2),
      OPENAI_API_KEY: 'sk-test',
      AI: { run: async () => ({ response: '{"frame_lines":["I saw ___ there."],"sentence_lines":[]}' }) },
    };
    const response = await extractPhoto({
      request: extractRequest('homework/class1/hp_abc123def456.jpg'),
      env,
      params: { id: 'class1' },
    });
    const bodyJson = await response.json();
    assert.equal(bodyJson.ok, true);
    assert.equal(bodyJson.draft.frame_text, 'I saw ___ there.');
    assert.equal(bodyJson.draft_source, 'workers-ai');
    assert.equal(capturedResponse.bodyUsed, true, 'non-OK OpenAI response must be drained before falling back to CF');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract endpoint: OpenAI timeout falls back to CF vision model', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  };
  try {
    const env = {
      R2L_MEDIA: r2WithBuffer(r2),
      OPENAI_API_KEY: 'sk-test',
      AI: { run: async () => ({ response: '{"frame_lines":[],"sentence_lines":["Fallback sentence."]}' }) },
    };
    const response = await extractPhoto({
      request: extractRequest('homework/class1/hp_abc123def456.jpg'),
      env,
      params: { id: 'class1' },
    });
    const bodyJson = await response.json();
    assert.equal(bodyJson.ok, true);
    assert.equal(bodyJson.draft.sentences_text, 'Fallback sentence.');
    assert.equal(bodyJson.draft_source, 'workers-ai');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract endpoint: no OpenAI key -> CF model direct, fetch never called', async () => {
  const r2 = createR2();
  await r2.put('homework/class1/hp_abc123def456.jpg', 'jpeg-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error('must not be called without an OpenAI key'); };
  try {
    const env = {
      R2L_MEDIA: r2WithBuffer(r2),
      AI: { run: async () => ({ response: '{"frame_lines":[],"sentence_lines":["Hi there."]}' }) },
    };
    const response = await extractPhoto({
      request: extractRequest('homework/class1/hp_abc123def456.jpg'),
      env,
      params: { id: 'class1' },
    });
    const bodyJson = await response.json();
    assert.equal(bodyJson.ok, true);
    assert.equal(bodyJson.draft.sentences_text, 'Hi there.');
    assert.equal(bodyJson.draft_source, 'workers-ai');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract endpoint: no OpenAI key AND no AI binding -> no_ai_binding (early return preserved, before R2 fetch)', async () => {
  const response = await extractPhoto({
    request: extractRequest('homework/class1/hp_abc123def456.jpg'),
    env: { R2L_MEDIA: { get: async () => { throw new Error('must not be reached — no_ai_binding short-circuits before R2 fetch'); } } },
    params: { id: 'class1' },
  });
  const bodyJson = await response.json();
  assert.deepEqual(bodyJson, { ok: true, draft: null, reason: 'no_ai_binding' });
});
