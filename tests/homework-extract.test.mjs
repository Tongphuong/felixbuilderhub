import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestPost,
  stripLessonHtml,
  parseDraftReply,
  callExtractLLM,
  draftFromPhoto,
  EXTRACT_MODEL,
  WORKERS_AI_EXTRACT_MODEL,
  EXTRACT_SYSTEM_PROMPT,
} from '../functions/api/admin/classes/[id]/homework-extract.js';

// ---------------------------------------------------------------------------
// EXTRACT_SYSTEM_PROMPT — Lead-authored (Elon), VERBATIM string. Only its
// build-shape option-cap wording is asserted here (speakup-cardsheet-build,
// 2026-07-15: raised alongside validateBuildTask's 2-8 cap), not the whole
// string — the wording itself is Elon's call, not a test-owned contract.
// ---------------------------------------------------------------------------

test('EXTRACT_SYSTEM_PROMPT: build-shape option cap reads 2 to 8, not the old 2 to 6', () => {
  assert.match(EXTRACT_SYSTEM_PROMPT, /2 to 8 options each/);
  assert.doesNotMatch(EXTRACT_SYSTEM_PROMPT, /2 to 6 options each/);
});

// ---------------------------------------------------------------------------
// stripLessonHtml — HTML stripping, whitespace collapse, 20k cap.
// ---------------------------------------------------------------------------

test('stripLessonHtml: strips tags, decodes common entities, collapses whitespace', () => {
  const html = '<div class="card"><h2>Stage 4</h2><p>I&nbsp;have&nbsp;two&nbsp;cats.</p>\n\n<p>He &amp; she are friends.</p></div>';
  const result = stripLessonHtml(html);
  assert.equal(result, 'Stage 4 I have two cats. He & she are friends.');
});

test('stripLessonHtml: strips script/style content entirely, not just the tags', () => {
  const html = '<style>.x{color:red}</style><p>Hello</p><script>alert(1)</script>';
  const result = stripLessonHtml(html);
  assert.equal(result, 'Hello');
});

test('stripLessonHtml: caps at 20,000 characters', () => {
  const huge = '<p>' + 'a'.repeat(30000) + '</p>';
  const result = stripLessonHtml(huge);
  assert.equal(result.length, 20000);
});

test('stripLessonHtml: non-string/empty input never throws', () => {
  assert.equal(stripLessonHtml(null), '');
  assert.equal(stripLessonHtml(undefined), '');
  assert.equal(stripLessonHtml(''), '');
  assert.doesNotThrow(() => stripLessonHtml(42));
});

// ---------------------------------------------------------------------------
// parseDraftReply — fence-stripped JSON parse, never throws.
// ---------------------------------------------------------------------------

test('parseDraftReply: plain JSON object parses', () => {
  const parsed = parseDraftReply('{"tasks":[{"type":"read","items":["Hi."]}]}');
  assert.deepEqual(parsed, { tasks: [{ type: 'read', items: ['Hi.'] }] });
});

test('parseDraftReply: strips a ```json fence before parsing', () => {
  const parsed = parseDraftReply('```json\n{"tasks":[]}\n```');
  assert.deepEqual(parsed, { tasks: [] });
});

test('parseDraftReply: malformed JSON -> null, never throws', () => {
  assert.equal(parseDraftReply('not json at all'), null);
  assert.equal(parseDraftReply('{"tasks": [}'), null);
});

test('parseDraftReply: non-string, array, or null input -> null', () => {
  assert.equal(parseDraftReply(null), null);
  assert.equal(parseDraftReply(undefined), null);
  assert.equal(parseDraftReply(42), null);
  assert.equal(parseDraftReply('[1,2,3]'), null);
});

// ---------------------------------------------------------------------------
// callExtractLLM — OpenRouter primary (one attempt, no retry), Workers AI
// fallback. Never throws; returns the raw reply string or null.
// ---------------------------------------------------------------------------

function openRouterReply(contentObj) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(contentObj) } }] }), { status: 200 });
}

test('callExtractLLM: no OPENROUTER_API_KEY and no env.AI -> null, never throws', async () => {
  const result = await callExtractLLM({ env: {}, lessonText: 'Some lesson.', fetchFn: async () => { throw new Error('must not be called'); } });
  assert.equal(result, null);
});

test('callExtractLLM: happy path returns the raw OpenRouter content string', async () => {
  let capturedBody = null;
  const result = await callExtractLLM({
    env: { OPENROUTER_API_KEY: 'k' },
    lessonText: 'I have two cats.',
    fetchFn: async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return openRouterReply({ tasks: [{ type: 'read', items: ['I have two cats.'] }] });
    },
  });
  assert.equal(result, JSON.stringify({ tasks: [{ type: 'read', items: ['I have two cats.'] }] }));
  assert.equal(capturedBody.model, EXTRACT_MODEL);
  assert.equal(capturedBody.response_format.type, 'json_object');
  assert.equal(capturedBody.messages[0].role, 'system');
  assert.equal(capturedBody.messages[0].content, EXTRACT_SYSTEM_PROMPT);
  assert.equal(capturedBody.messages[1].content, 'I have two cats.');
});

test('callExtractLLM: OpenRouter non-2xx falls through to the Workers AI fallback', async () => {
  const result = await callExtractLLM({
    env: { OPENROUTER_API_KEY: 'k', AI: { run: async () => ({ response: '{"tasks":[]}' }) } },
    lessonText: 'lesson',
    fetchFn: async () => new Response('server error', { status: 500 }),
  });
  assert.equal(result, '{"tasks":[]}');
});

test('callExtractLLM: OpenRouter timeout/network throw falls through to the Workers AI fallback, never throws itself', async () => {
  await assert.doesNotReject(async () => {
    const result = await callExtractLLM({
      env: { OPENROUTER_API_KEY: 'k', AI: { run: async () => ({ response: '{"tasks":[]}' }) } },
      lessonText: 'lesson',
      fetchFn: async () => { const err = new Error('aborted'); err.name = 'TimeoutError'; throw err; },
    });
    assert.equal(result, '{"tasks":[]}');
  });
});

test('callExtractLLM: both OpenRouter and Workers AI fail -> null, never throws', async () => {
  const result = await callExtractLLM({
    env: { OPENROUTER_API_KEY: 'k', AI: { run: async () => { throw new Error('workers ai down'); } } },
    lessonText: 'lesson',
    fetchFn: async () => { throw new Error('network down'); },
  });
  assert.equal(result, null);
});

test('callExtractLLM: Workers AI fallback used directly when there is no OPENROUTER_API_KEY at all', async () => {
  let ranModel = null;
  const result = await callExtractLLM({
    env: { AI: { run: async (model) => { ranModel = model; return { response: '{"tasks":[{"type":"read","items":["Hi."]}]}' }; } } },
    lessonText: 'lesson',
    fetchFn: async () => { throw new Error('OpenRouter must not be called without a key'); },
  });
  assert.equal(ranModel, WORKERS_AI_EXTRACT_MODEL);
  assert.equal(result, '{"tasks":[{"type":"read","items":["Hi."]}]}');
});

// ---------------------------------------------------------------------------
// draftFromPhoto — reuses homework-photo-extract.js's vision path unchanged.
// ---------------------------------------------------------------------------

test('draftFromPhoto: missing R2L_MEDIA or AI binding -> null', async () => {
  assert.equal(await draftFromPhoto({ env: {}, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' }), null);
  assert.equal(await draftFromPhoto({ env: { R2L_MEDIA: {} }, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' }), null);
});

test('draftFromPhoto: r2Key not matching the classId-scoped pattern -> null (no R2 fetch attempted)', async () => {
  const env = {
    R2L_MEDIA: { get: async () => { throw new Error('must not be called for a bad key'); } },
    AI: { run: async () => { throw new Error('must not be called for a bad key'); } },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/other-class/hp_abc123def456.jpg' });
  assert.equal(result, null);
});

test('draftFromPhoto: R2 object not found -> null', async () => {
  const env = { R2L_MEDIA: { get: async () => null }, AI: { run: async () => { throw new Error('must not be called'); } } };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.equal(result, null);
});

test('draftFromPhoto: happy path converts the vision model reply into a read task', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: { run: async () => ({ response: JSON.stringify({ frame_lines: [], sentence_lines: ['I have two cats.'] }) }) },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.ok(result);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].type, 'read');
  assert.equal(result.tasks[0].items[0].text_en, 'I have two cats.');
});

test('draftFromPhoto: vision model finds nothing readable -> null', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: { run: async () => ({ response: JSON.stringify({ frame_lines: [], sentence_lines: [] }) }) },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// draftFromPhoto + OpenAI vision primary path (speakup-vision-upgrade
// packet, founder-ratified 2026-07-15): proves the wiring routes through
// homework-photo-extract.js's extractWithOpenAI when a key is configured,
// and falls back to the CF model (drained) exactly as onRequestPost does.
// ---------------------------------------------------------------------------

test('draftFromPhoto: OPENAI_API_KEY present -> uses OpenAI vision, never calls env.AI', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"frame_lines":[],"sentence_lines":["I have two cats."]}' } }],
  }), { status: 200 });
  try {
    const env = {
      R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4), httpMetadata: { contentType: 'image/jpeg' } }) },
      OPENAI_API_KEY: 'sk-test',
      AI: { run: async () => { throw new Error('CF vision must not be called when OpenAI succeeds'); } },
    };
    const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
    assert.ok(result);
    assert.equal(result.tasks[0].items[0].text_en, 'I have two cats.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('draftFromPhoto: OpenAI non-OK falls back to CF vision cleanly (bodyUsed drained)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedResponse;
  globalThis.fetch = async () => {
    capturedResponse = new Response('server error', { status: 500 });
    return capturedResponse;
  };
  try {
    const env = {
      R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4), httpMetadata: { contentType: 'image/jpeg' } }) },
      OPENAI_API_KEY: 'sk-test',
      AI: { run: async () => ({ response: JSON.stringify({ frame_lines: [], sentence_lines: ['Fallback sentence.'] }) }) },
    };
    const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
    assert.ok(result);
    assert.equal(result.tasks[0].items[0].text_en, 'Fallback sentence.');
    assert.equal(capturedResponse.bodyUsed, true, 'non-OK OpenAI response must be drained before falling back to CF');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('draftFromPhoto: no OpenAI key -> CF model direct, fetch never called', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error('must not be called without an OpenAI key'); };
  try {
    const env = {
      R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4), httpMetadata: { contentType: 'image/jpeg' } }) },
      AI: { run: async () => ({ response: JSON.stringify({ frame_lines: [], sentence_lines: ['I have two cats.'] }) }) },
    };
    const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
    assert.ok(result);
    assert.equal(result.tasks[0].items[0].text_en, 'I have two cats.');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Buffet review (2026-07-15 revision, blocking finding): the guard
// cross-product cell where env.AI is ABSENT but an OpenAI key IS set was
// unguarded and untested — every test above kept AI present. These three
// cover exactly that cell, on the LIVE route.
// ---------------------------------------------------------------------------

test('draftFromPhoto: OPENAI key set + env.AI ABSENT -> OpenAI is still attempted, draft returned', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"frame_lines":[],"sentence_lines":["No CF binding needed."]}' } }],
    }), { status: 200 });
  };
  try {
    const env = {
      R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4), httpMetadata: { contentType: 'image/jpeg' } }) },
      OPENAI_API_KEY: 'sk-test',
      // env.AI intentionally absent -- this is the cell Buffet's review
      // found unguarded: the old `!env?.AI` early-return silently dropped
      // out here before OpenAI was ever attempted.
    };
    const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
    assert.ok(fetchCalled, 'OpenAI must be attempted when a key is set, even with no CF binding');
    assert.ok(result);
    assert.equal(result.tasks[0].items[0].text_en, 'No CF binding needed.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('draftFromPhoto: key set + env.AI absent + OpenAI fails -> clean null, never throws (no CF binding to fall back to)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('server error', { status: 500 });
  try {
    const env = {
      R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4), httpMetadata: { contentType: 'image/jpeg' } }) },
      OPENAI_API_KEY: 'sk-test',
      // env.AI intentionally absent -- the explicit `if (!env.AI) return
      // null;` guard before the CF-fallback call must degrade cleanly here
      // rather than throwing when env.AI.run is reached on an undefined AI.
    };
    await assert.doesNotReject(async () => {
      const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
      assert.equal(result, null);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('draftFromPhoto: no key AND no env.AI -> null before ever touching R2 (early-return guard, no R2 fetch attempted)', async () => {
  const env = {
    R2L_MEDIA: { get: async () => { throw new Error('must not be called — guard should short-circuit before R2'); } },
    // no OPENAI_API_KEY / READ2LEAD_OPENAI_API_KEY, no AI binding
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// build_columns (grading-honesty packet, 2026-07-14): a slide photo of a
// mix-and-match grid — VISION_PROMPT's third array, assembled through the
// REAL validateTask/validateBuildTask (schema v1 rules), same posture as
// every other draft task.
// ---------------------------------------------------------------------------

test('draftFromPhoto: build_columns alone (no frame/sentence lines) produces a build task', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          frame_lines: [],
          sentence_lines: [],
          build_columns: [
            { label_en: 'We...', options: ['play football', 'draw pictures'] },
            { label_en: 'At...', options: ['school', 'the park'] },
          ],
        }),
      }),
    },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.ok(result);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].type, 'build');
  assert.equal(result.tasks[0].columns.length, 2);
  assert.equal(result.tasks[0].columns[0].label_en, 'We...');
  assert.deepEqual(result.tasks[0].columns[0].options, ['play football', 'draw pictures']);
});

test('draftFromPhoto: build_columns alongside sentence_lines produces BOTH a read task and a build task', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          frame_lines: [],
          sentence_lines: ['I have two cats.'],
          build_columns: [
            { label_en: 'We...', options: ['play football', 'draw pictures'] },
            { label_en: 'At...', options: ['school', 'the park'] },
          ],
        }),
      }),
    },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.ok(result);
  assert.deepEqual(result.tasks.map((t) => t.type), ['read', 'build']);
});

test('draftFromPhoto: an invalid build_columns shape (1 column — below the 2-column minimum) is dropped, not defaulted', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          frame_lines: [],
          sentence_lines: [],
          build_columns: [{ label_en: 'We...', options: ['play football', 'draw pictures'] }],
        }),
      }),
    },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.equal(result, null, 'invalid build task AND no other tasks -> null, not an empty-but-truthy draft');
});

test('draftFromPhoto: build_columns absent entirely -> unchanged legacy-only behaviour', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: { run: async () => ({ response: JSON.stringify({ frame_lines: [], sentence_lines: ['I have two cats.'] }) }) },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].type, 'read');
});

// speakup-cardsheet-build (2026-07-15): the second build_columns pattern —
// vocabulary cards (e.g. Phương's "Flavour Words" sheet: 8 highlighted
// words) plus a fill-in-the-blank speaking line. One column per blank, up to
// the raised 8-option cap, must round-trip through the REAL validateTask the
// same as the mix-and-match pattern.
test('draftFromPhoto: card-sheet pattern (3 columns x 8 options each) round-trips into a valid build task', async () => {
  const flavourWords = ['sweet', 'sour', 'salty', 'spicy', 'bitter', 'fresh', 'crunchy', 'juicy'];
  const foodNouns = ['cake', 'chips', 'lemons', 'chilli', 'coffee', 'fried chicken', 'vegetables', 'noodles'];
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          frame_lines: [],
          sentence_lines: [],
          build_columns: [
            { label_en: 'My favourite food is...', options: foodNouns },
            { label_en: 'It tastes...', options: flavourWords },
            { label_en: 'and...', options: flavourWords },
          ],
        }),
      }),
    },
  };
  const result = await draftFromPhoto({ env, classId: 'class1', r2Key: 'homework/class1/hp_abc123def456.jpg' });
  assert.ok(result);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].type, 'build');
  assert.equal(result.tasks[0].columns.length, 3);
  assert.equal(result.tasks[0].columns[0].label_en, 'My favourite food is...');
  assert.deepEqual(result.tasks[0].columns[0].options, foodNouns);
  assert.equal(result.tasks[0].columns[1].options.length, 8);
  assert.deepEqual(result.tasks[0].columns[2].options, flavourWords);
});

// ---------------------------------------------------------------------------
// onRequestPost — end-to-end. ANY failure -> {ok:true, draft:null}, NEVER a
// teacher-facing error, NEVER a 500 (except genuinely malformed request JSON,
// which stays the ordinary 400 invalid_json every admin endpoint uses).
// ---------------------------------------------------------------------------

async function postExtract(body, env = {}, classId = 'class1') {
  const request = new Request(`https://example.com/api/admin/classes/${classId}/homework-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await onRequestPost({ request, env, params: { id: classId } });
  const json = await response.json();
  return { response, json };
}

test('onRequestPost: invalid request JSON -> 400 invalid_json (the one non-draft-null failure)', async () => {
  const request = new Request('https://example.com/api/admin/classes/class1/homework-extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  const response = await onRequestPost({ request, env: {}, params: { id: 'class1' } });
  const json = await response.json();
  assert.equal(response.status, 400);
  assert.equal(json.error, 'invalid_json');
});

test('onRequestPost: neither lesson_text nor r2_key -> ok:true, draft:null (nothing to extract, never an error)', async () => {
  const { response, json } = await postExtract({});
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true, draft: null });
});

test('onRequestPost: no OPENROUTER_API_KEY and no AI binding -> ok:true, draft:null, no 500', async () => {
  const { response, json } = await postExtract({ lesson_text: 'I have two cats.' }, {});
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true, draft: null });
});

test('onRequestPost: malformed LLM JSON reply -> ok:true, draft:null', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 });
  try {
    const { response, json } = await postExtract({ lesson_text: 'I have two cats.' }, { OPENROUTER_API_KEY: 'k' });
    assert.equal(response.status, 200);
    assert.deepEqual(json, { ok: true, draft: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: HTML lesson_text is stripped before reaching the model, and capped at 20,000 chars', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUserContent = null;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    capturedUserContent = body.messages[1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ type: 'read', items: ['Hi.'] }] }) } }] } ), { status: 200 });
  };
  try {
    const html = '<div><p>I&nbsp;have&nbsp;two&nbsp;cats.</p></div>' + '<p>'.repeat(1) + 'x'.repeat(25000);
    const { json } = await postExtract({ lesson_text: html }, { OPENROUTER_API_KEY: 'k' });
    assert.ok(capturedUserContent.startsWith('I have two cats.'));
    assert.ok(capturedUserContent.length <= 20000);
    assert.equal(json.ok, true);
    assert.equal(json.draft.tasks[0].type, 'read');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: invalid tasks in the draft are dropped, valid ones kept — never an unvalidated draft', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          tasks: [
            { type: 'read', items: ['I have two cats.'] }, // valid
            { type: 'read', items: [] }, // invalid: 0 items
            { type: 'picture', anchors: ['dog'] }, // invalid: no photo bound at draft time
            { type: 'present', stems: ['Yes/No, my friend is ___ because ___.'] }, // valid, and proves '/' isn't dropped
          ],
        }),
      },
    }],
  }), { status: 200 });
  try {
    const { json } = await postExtract({ lesson_text: 'A pasted lesson.' }, { OPENROUTER_API_KEY: 'k' });
    assert.equal(json.ok, true);
    assert.ok(json.draft);
    assert.equal(json.draft.tasks.length, 2);
    assert.deepEqual(json.draft.tasks.map((t) => t.type), ['read', 'present']);
    assert.equal(json.draft.tasks[1].stems[0].text_en, 'Yes/No, my friend is ___ because ___.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: every task invalid after validation -> draft:null (not an empty tasks array)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ tasks: [{ type: 'read', items: [] }] }) } }],
  }), { status: 200 });
  try {
    const { json } = await postExtract({ lesson_text: 'A pasted lesson.' }, { OPENROUTER_API_KEY: 'k' });
    assert.deepEqual(json, { ok: true, draft: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: note_vi from the draft is trimmed and capped at 300 chars', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ tasks: [{ type: 'read', items: ['Hi.'] }], note_vi: '  Luyện nói nhé con  ' }) } }],
  }), { status: 200 });
  try {
    const { json } = await postExtract({ lesson_text: 'A pasted lesson.' }, { OPENROUTER_API_KEY: 'k' });
    assert.equal(json.draft.note_vi, 'Luyện nói nhé con');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onRequestPost: r2_key path returns a draft built from the vision model, ignoring lesson_text if both are sent', async () => {
  const env = {
    R2L_MEDIA: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    AI: { run: async () => ({ response: JSON.stringify({ frame_lines: [], sentence_lines: ['I have two cats.'] }) }) },
  };
  const { json } = await postExtract({ r2_key: 'homework/class1/hp_abc123def456.jpg', lesson_text: 'ignored' }, env);
  assert.equal(json.ok, true);
  assert.equal(json.draft.tasks[0].type, 'read');
  assert.equal(json.draft.tasks[0].items[0].text_en, 'I have two cats.');
});

test('onRequestPost: an unexpected throw anywhere in the flow still returns 200 with draft:null, never a 500', async () => {
  const env = {
    R2L_MEDIA: { get: async () => { throw new Error('boom'); } },
    AI: {},
  };
  const { response, json } = await postExtract({ r2_key: 'homework/class1/hp_abc123def456.jpg' }, env);
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true, draft: null });
});

// ---------------------------------------------------------------------------
// Zero LLM on the kid path is asserted in tests/minny-speaking.test.mjs. This
// file's own "no fetch" guarantee is the inverse: the extractor's fetch is
// gated behind a genuine attempt (lesson_text or r2_key present) and never
// fires for an empty/malformed request.
// ---------------------------------------------------------------------------

test('onRequestPost: no fetch is attempted when there is nothing to extract', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not be called'); };
  try {
    await postExtract({ lesson_text: '   ' });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
