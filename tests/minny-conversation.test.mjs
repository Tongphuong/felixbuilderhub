// tests/minny-conversation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickStarterTopic,
  buildSystemPrompt,
  parseModelReply,
  coerceReply,
  sessionCapsExceeded,
  nextSession,
  LEVEL_REGISTER,
  STARTER_TOPICS,
} from '../functions/api/_minny-convo.js';

import { onRequestPost } from '../functions/api/minny-conversation.js';

// ---------------------------------------------------------------------------
// Helper: create an in-memory KV mock that mirrors Cloudflare KV behaviour
// ---------------------------------------------------------------------------
function createFakeKv() {
  const store = new Map();
  return {
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts?.type === 'json') {
        return JSON.parse(raw);
      }
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

test('pickStarterTopic L1 indices 0 and 1 return two different L1 topics', () => {
  const t0 = pickStarterTopic('L1', 0);
  const t1 = pickStarterTopic('L1', 1);
  assert.notEqual(t0, t1);
  // both should be from the L1 topic list
  const l1Topics = STARTER_TOPICS.L1;
  assert.ok(l1Topics.includes(t0));
  assert.ok(l1Topics.includes(t1));
});

test('pickStarterTopic L1 index 2 wraps back to index 0', () => {
  const t0 = pickStarterTopic('L1', 0);
  const t2 = pickStarterTopic('L1', 2);
  assert.equal(t0, t2);
});

test('pickStarterTopic unknown level falls back to L3', () => {
  const t = pickStarterTopic('L9', 0);
  const l3Topics = STARTER_TOPICS.L3;
  assert.ok(l3Topics.includes(t));
});

test('buildSystemPrompt includes level register and starter topic', () => {
  const prompt = buildSystemPrompt('L1', 'their favorite color');
  assert.ok(prompt.includes(LEVEL_REGISTER.L1));
  assert.ok(prompt.includes('their favorite color'));
});

test('buildSystemPrompt unknown level falls back to L3 register', () => {
  const prompt = buildSystemPrompt('L9', 'x');
  assert.ok(prompt.includes(LEVEL_REGISTER.L3));
  assert.ok(prompt.includes('x'));
});

test('turn primary brain calls DeepSeek via OpenRouter with strict JSON mode', async () => {
  // The OpenAI credit was retired 2026-07-08; the primary conversation call
  // must hit OpenRouter with the pinned DeepSeek model and JSON mode, gated
  // on OPENROUTER_API_KEY, and never touch api.openai.com.
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  const originalFetch = globalThis.fetch;
  const env = {
    READ2LEAD_CODES: fakeKv,
    OPENROUTER_API_KEY: 'or-test-key',
    AI: { run: async () => 'safe' },
  };
  const calls = [];
  try {
    globalThis.fetch = async (url, opts) => {
      calls.push({
        url: String(url),
        body: opts?.body ? JSON.parse(opts.body) : null,
        auth: opts?.headers?.Authorization || null,
      });
      if (String(url).includes('chat/completions')) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Nice! Do you have a dog?', mood: 'idle' }) } }] }),
        };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-mp3').buffer };
    };

    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', {
        method: 'POST',
        body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
      }),
      env,
    });
    const startData = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', {
        method: 'POST',
        body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: startData.session_id, transcript: 'I like dogs' }),
      }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.equal(turnData.reply_en, 'Nice! Do you have a dog?');

    const llmCall = calls.find(c => c.url.includes('chat/completions'));
    assert.ok(llmCall, 'primary LLM call happened');
    assert.match(llmCall.url, /openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.equal(llmCall.body.model, 'deepseek/deepseek-v4-pro');
    assert.deepEqual(llmCall.body.response_format, { type: 'json_object' });
    assert.equal(llmCall.body.max_tokens, 150);
    assert.equal(llmCall.body.temperature, 0.8);
    assert.equal(llmCall.auth, 'Bearer or-test-key');
    assert.ok(calls.every(c => !c.url.includes('api.openai.com')), 'no OpenAI call anywhere in the turn');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildSystemPrompt persona is the red robot, never a koala', () => {
  // Minny is a red robot (the design mock's koala was a stand-in) — the
  // persona line must never regress or Minny tells kids she is a koala.
  const prompt = buildSystemPrompt('L3', 'their favorite food');
  assert.match(prompt, /red robot/);
  assert.doesNotMatch(prompt, /koala/i);
});

test('parseModelReply valid JSON returns object', () => {
  const result = parseModelReply('{"reply_en":"Hi there!","mood":"celebrate"}');
  assert.deepEqual(result, { reply_en: 'Hi there!', mood: 'celebrate' });
});

test('parseModelReply non-JSON returns null', () => {
  const result = parseModelReply('not json at all');
  assert.equal(result, null);
});

test('parseModelReply empty reply_en returns null', () => {
  const result = parseModelReply('{"reply_en":"","mood":"idle"}');
  assert.equal(result, null);
});

test('parseModelReply invalid mood returns null', () => {
  const result = parseModelReply('{"reply_en":"hi","mood":"angry"}');
  assert.equal(result, null);
});

test('parseModelReply markdown-fenced JSON still parses', () => {
  const result = parseModelReply('```json\n{"reply_en":"Hi!","mood":"idle"}\n```');
  assert.deepEqual(result, { reply_en: 'Hi!', mood: 'idle' });
});

test('coerceReply salvages JSON wrapped in prose', () => {
  const result = coerceReply('Sure thing! {"reply_en":"That sounds so fun!","mood":"celebrate"} Hope you like it.');
  assert.deepEqual(result, { reply_en: 'That sounds so fun!', mood: 'celebrate' });
});

test('coerceReply salvages loose JSON with a missing/invalid mood (defaults to idle)', () => {
  const result = coerceReply('{"reply_en":"Yay, cats!","mood":"happy"}');
  assert.deepEqual(result, { reply_en: 'Yay, cats!', mood: 'idle' });
});

test('coerceReply salvages a plain-prose reply with a speaker label', () => {
  const result = coerceReply('Minny: That sounds like a lot of fun!');
  assert.deepEqual(result, { reply_en: 'That sounds like a lot of fun!', mood: 'idle' });
});

test('coerceReply returns null on empty / non-string input', () => {
  assert.equal(coerceReply(''), null);
  assert.equal(coerceReply('   '), null);
  assert.equal(coerceReply(null), null);
  assert.equal(coerceReply(42), null);
});

test('coerceReply caps an over-long prose reply at a sentence boundary', () => {
  const long = 'This is fun. ' + 'x'.repeat(300);
  const result = coerceReply(long);
  assert.ok(result.reply_en.length <= 220);
});

test('coerceReply still finds valid JSON located after a long (>2000 char) preamble', () => {
  // Regression guard: a chatty fallback may ramble for thousands of chars
  // before emitting its JSON. The salvage must still find it, not deliver the
  // ramble as Minny's reply. (Caught by review of an earlier input-slice fix.)
  const ramble = 'Sure, I can help with that. '.repeat(90); // ~2500 chars
  const raw = ramble + '{"reply_en":"Wow, a puppy! What is its name?","mood":"celebrate"}';
  const result = coerceReply(raw);
  assert.deepEqual(result, { reply_en: 'Wow, a puppy! What is its name?', mood: 'celebrate' });
});

test('sessionCapsExceeded turn cap exceeded returns true', () => {
  const now = Date.now();
  const session = { turns: 12, started_at: now };
  assert.equal(sessionCapsExceeded(session, now), true);
});

test('sessionCapsExceeded time cap exceeded returns true', () => {
  const now = Date.now();
  const session = { turns: 0, started_at: now - 6 * 60 * 1000 }; // 6 minutes ago
  assert.equal(sessionCapsExceeded(session, now), true);
});

test('sessionCapsExceeded within both caps returns false', () => {
  const now = Date.now();
  const session = { turns: 5, started_at: now };
  assert.equal(sessionCapsExceeded(session, now), false);
});

test('nextSession increments turns and appends history without mutation', () => {
  const original = { turns: 2, history: [{ a: 1 }, { b: 2 }] };
  const newEntry = { c: 3 };
  const result = nextSession(original, newEntry);
  assert.equal(result.turns, 3);
  assert.deepEqual(result.history, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  // original unchanged
  assert.equal(original.turns, 2);
  assert.deepEqual(original.history, [{ a: 1 }, { b: 2 }]);
});

test('nextSession drops oldest entry when history length would exceed 6', () => {
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push({ idx: i });
  }
  const original = { turns: 6, history };
  const newEntry = { idx: 6 };
  const result = nextSession(original, newEntry);
  assert.equal(result.history.length, 6);
  // oldest (idx 0) dropped, newest (idx 6) appended
  assert.deepEqual(result.history[0], { idx: 1 });
  assert.deepEqual(result.history[5], { idx: 6 });
});

// ---------------------------------------------------------------------------
// Endpoint tests (with fake KV, no real network)
// ---------------------------------------------------------------------------

test('action start with a real (non-test) code succeeds — Phase 8b gate removed', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-REAL', JSON.stringify({ is_test: false, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };
  const request = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'R2L-REAL' }),
  });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.session_id === 'string');
  assert.equal(body.turns_left, 12);
  assert.equal(body.seconds_left, 300);
});

test('action start with test code returns ok and session data', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };
  const request = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
  });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.session_id === 'string');
  assert.equal(body.turns_left, 12);
  assert.equal(body.seconds_left, 300);
  assert.ok(body.greeting);
  assert.ok(typeof body.greeting.text_en === 'string');
  assert.ok(typeof body.greeting.subtitle_vi === 'string');
});

test('action start with unknown code returns error code_not_found', async () => {
  const fakeKv = createFakeKv();
  // no seed
  const env = { READ2LEAD_CODES: fakeKv };
  const request = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'UNKNOWN' }),
  });
  const response = await onRequestPost({ request, env });
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'code_not_found');
});

test('action turn with garbage session_id returns ended gracefully', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };
  const request = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: 'garbage', transcript: 'hi' }),
  });
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.ended, true);
});

test('turn with a code that does not own the session ends gracefully (session binding)', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  await fakeKv.put('R2L-REAL', JSON.stringify({ is_test: false, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };

  // start with one code to get a session_id
  const startReq = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
  });
  const startResp = await onRequestPost({ request: startReq, env });
  const startBody = await startResp.json();
  const sessionId = startBody.session_id;

  // now turn with a different code — the session must not be usable
  const turnReq = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'turn', access_code: 'R2L-REAL', session_id: sessionId, transcript: 'hi' }),
  });
  const turnResp = await onRequestPost({ request: turnReq, env });
  assert.equal(turnResp.status, 200);
  const turnBody = await turnResp.json();
  assert.equal(turnBody.ok, true);
  assert.equal(turnBody.ended, true);
});

test('full flow with test code: turn decrements turns_left and uses canned redirect', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };

  // start
  const startReq = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
  });
  const startResp = await onRequestPost({ request: startReq, env });
  const startBody = await startResp.json();
  const sessionId = startBody.session_id;
  assert.equal(startBody.turns_left, 12);

  // first turn
  const turn1Req = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: sessionId, transcript: 'I like dogs' }),
  });
  const turn1Resp = await onRequestPost({ request: turn1Req, env });
  const turn1Body = await turn1Resp.json();
  assert.equal(turn1Body.ok, true);
  assert.ok(typeof turn1Body.reply_en === 'string' && turn1Body.reply_en.length > 0);
  assert.equal(turn1Body.mood, 'idle');
  assert.equal(turn1Body.turns_left, 11);

  // second turn
  const turn2Req = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: sessionId, transcript: 'I like cats' }),
  });
  const turn2Resp = await onRequestPost({ request: turn2Req, env });
  const turn2Body = await turn2Resp.json();
  assert.equal(turn2Body.turns_left, 10);
});

test('repeated canned-redirect turns (LLM unavailable the whole session) still consume the normal turn cap, not an early wrap-up', async () => {
  // No OPENAI_API_KEY / env.AI configured, so every turn falls through to the
  // canned-redirect path. A provider outage must not cut the session short --
  // only the real 12-turn/5-min caps (or, later, real Phase 6 safety flags)
  // should end a session early.
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };

  const startReq = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
  });
  const startResp = await onRequestPost({ request: startReq, env });
  const startBody = await startResp.json();
  const sessionId = startBody.session_id;

  for (let i = 1; i <= 4; i++) {
    const turnReq = new Request('https://example.com/api/minny-conversation', {
      method: 'POST',
      body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: sessionId, transcript: `turn ${i}` }),
    });
    const turnResp = await onRequestPost({ request: turnReq, env });
    const turnBody = await turnResp.json();
    assert.equal(turnBody.ok, true);
    assert.equal(turnBody.ended, undefined); // never ends early on technical failures alone
    assert.ok(typeof turnBody.reply_en === 'string' && turnBody.reply_en.length > 0);
    assert.equal(turnBody.turns_left, 12 - i);
  }
});

test('fallback hardening: DeepSeek fails but the llama fallback prose-JSON is salvaged into a real reply (not a canned redirect)', async () => {
  // Reproduces the live preview symptom: OpenRouter blips on a turn, the llama
  // fallback answers but wraps its JSON in prose. Before hardening that became a
  // canned redirect; now it must be salvaged into the real reply.
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  const originalFetch = globalThis.fetch;
  let openRouterCalls = 0;
  let llamaInput = null;
  const env = {
    READ2LEAD_CODES: fakeKv,
    OPENROUTER_API_KEY: 'or-key',
    AI: {
      run: async (model, input) => {
        if (String(model).includes('llama-guard')) return 'safe';
        if (String(model).includes('llama-3.3')) {
          llamaInput = input;
          return 'Okay! {"reply_en":"A white and black cat sounds so pretty!","mood":"celebrate"} :)';
        }
        throw new Error('no tts in test'); // TTS optional, safely absent
      },
    },
  };
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        openRouterCalls++;
        return { ok: false, status: 429, json: async () => ({}) }; // DeepSeek throttled both attempts
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }) }),
      env,
    });
    const startData = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: startData.session_id, transcript: 'They are white and black' }) }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.equal(turnData.reply_en, 'A white and black cat sounds so pretty!');
    assert.equal(turnData.mood, 'celebrate');
    assert.equal(openRouterCalls, 2, 'DeepSeek was retried once before falling back');
    assert.equal(llamaInput?.max_tokens, 150, 'llama fallback request carries the max_tokens cap');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ML guard flag on the concurrent guard||TTS path returns a canned redirect, never the flagged model reply', async () => {
  // Guards the safety invariant of the guard/TTS parallelization: the LLM
  // returns a clean-shaped reply (deterministic gate passes), but Llama Guard
  // flags it. The kid must get a canned redirect, and the flagged model words
  // must NOT leak into the response even though TTS ran concurrently.
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  const originalFetch = globalThis.fetch;
  const MODEL_REPLY = 'That sounds like a really fun day!';
  const env = {
    READ2LEAD_CODES: fakeKv,
    OPENROUTER_API_KEY: 'or-key',
    AI: {
      run: async (model) => {
        if (String(model).includes('llama-guard')) return 'unsafe\nS1'; // ML backstop flags it
        return new TextEncoder().encode('audio').buffer; // TTS ran concurrently
      },
    },
  };
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: MODEL_REPLY, mood: 'celebrate' }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }) }),
      env,
    });
    const startData = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: startData.session_id, transcript: 'We went to the park' }) }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.notEqual(turnData.reply_en, MODEL_REPLY, 'the flagged model reply must never reach the kid');
    assert.equal(turnData.mood, 'idle', 'a canned redirect is delivered instead');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('daily cap of 3 sessions per code enforced', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };

  const startSession = async () => {
    const req = new Request('https://example.com/api/minny-conversation', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
    });
    return onRequestPost({ request: req, env });
  };

  // first three starts should succeed
  for (let i = 0; i < 3; i++) {
    const resp = await startSession();
    const body = await resp.json();
    assert.equal(body.ok, true);
  }

  // fourth start should be rejected
  const resp4 = await startSession();
  const body4 = await resp4.json();
  assert.equal(body4.ok, false);
  assert.equal(body4.error, 'daily_cap');
});

test('turn without transcript returns error transcript_missing', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };

  // start
  const startReq = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
  });
  const startResp = await onRequestPost({ request: startReq, env });
  const startBody = await startResp.json();
  const sessionId = startBody.session_id;

  // turn without transcript
  const turnReq = new Request('https://example.com/api/minny-conversation', {
    method: 'POST',
    body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id: sessionId }),
  });
  const turnResp = await onRequestPost({ request: turnReq, env });
  const turnBody = await turnResp.json();
  assert.equal(turnBody.ok, false);
  assert.equal(turnBody.error, 'transcript_missing');
});

test('audio_b64 is embedded in start/turn responses when TTS succeeds, and safely absent when it does not', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const originalFetch = globalThis.fetch;
  const env = { READ2LEAD_CODES: fakeKv, OPENAI_API_KEY: 'test-key' };

  try {
    // TTS failure first, on a clean/empty cache -- must never throw, and the
    // response must simply omit audio_b64 rather than fail the whole request.
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    const failReq = new Request('http://x/api/minny-conversation', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
    });
    const failResp = await onRequestPost({ request: failReq, env });
    const failData = await failResp.json();
    assert.equal(failData.ok, true);
    assert.equal(failData.greeting.audio_b64, undefined);

    // Now TTS succeeds. getOrSynthesize caches by (text, voice) -- this also
    // exercises the cache-write path for a greeting not yet cached above.
    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('fake-mp3-bytes').buffer,
    });

    const startReq = new Request('http://x/api/minny-conversation', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }),
    });
    const startResp = await onRequestPost({ request: startReq, env });
    const startData = await startResp.json();
    assert.equal(startData.ok, true);
    assert.ok(startData.greeting.audio_b64, 'greeting should carry synthesized audio');
    assert.equal(startData.greeting.content_type, 'audio/mpeg');

    const turnReq = new Request('http://x/api/minny-conversation', {
      method: 'POST',
      body: JSON.stringify({
        action: 'turn',
        access_code: 'R2L-TEST',
        session_id: startData.session_id,
        transcript: 'I like dogs',
      }),
    });
    const turnResp = await onRequestPost({ request: turnReq, env });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.ok(turnData.audio_b64, 'turn reply should carry synthesized audio');
    assert.equal(turnData.content_type, 'audio/mpeg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
