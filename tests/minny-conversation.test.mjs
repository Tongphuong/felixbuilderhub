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
  gateReplyForLevel,
  isBeginnerLevel,
  LEVEL_REGISTER,
  STARTER_TOPICS,
  TOPIC_SEEDS,
  DEBATE_TOPICS,
  GAMES,
} from '../functions/api/_minny-convo.js';

import { findPhrase, fillPhrase } from '../functions/api/_minny-phrases.js';
import { isVietnamese, isLowContent, matchesExpected, nextRepairStep } from '../functions/api/_minny-repair.js';
import { wordSimilarity } from '../functions/api/read2lead-speaking-check.js';

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
    assert.ok(turnData.timing && typeof turnData.timing.llm_ms === 'number', 'response carries per-stage latency timing');
    assert.equal(turnData.timing.llm_source, 'openrouter');

    const llmCall = calls.find(c => c.url.includes('chat/completions'));
    assert.ok(llmCall, 'primary LLM call happened');
    assert.match(llmCall.url, /openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.equal(llmCall.body.model, 'meta-llama/llama-3.3-70b-instruct');
    assert.deepEqual(llmCall.body.provider, { sort: 'throughput', require_parameters: true });
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
  // Fixture must be a NORMAL code: since 2026-07-11 is_test codes are exempt
  // from the daily cap (that exemption has its own tests below).
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: false, progress: { current_level: 'L2' } }));

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

test('merged voice turn: multipart audio upload is transcribed server-side and returns transcript + reply in one request', async () => {
  // Step C — the client now uploads audio straight to /api/minny-conversation
  // (no separate STT call). The endpoint must transcribe (Workers AI Whisper),
  // then run the normal brain/guardrail/TTS pipeline, and return the transcript
  // alongside the reply so the client can render the kid's chip.
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  const originalFetch = globalThis.fetch;
  const env = {
    READ2LEAD_CODES: fakeKv,
    OPENROUTER_API_KEY: 'or-key',
    AI: {
      run: async (model) => {
        if (String(model).includes('whisper')) return { text: 'I have a red ball' };
        if (String(model).includes('llama-guard')) return 'safe';
        return new TextEncoder().encode('audio').buffer; // TTS
      },
    },
  };
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'A red ball is so fun!', mood: 'celebrate' }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }) }),
      env,
    });
    const { session_id } = await startResp.json();

    const form = new FormData();
    form.append('access_code', 'R2L-TEST');
    form.append('action', 'turn');
    form.append('session_id', session_id);
    form.append('audio', new File([new Uint8Array([1, 2, 3, 4])], 'turn.webm', { type: 'audio/webm' }));
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: form }),
      env,
    });
    const data = await turnResp.json();
    assert.equal(data.ok, true);
    assert.equal(data.transcript, 'I have a red ball', 'server transcribed the uploaded audio and echoed it back');
    assert.equal(data.reply_en, 'A red ball is so fun!');
    assert.ok(data.timing && typeof data.timing.stt_ms === 'number', 'timing includes server-side STT duration');
  } finally {
    globalThis.fetch = originalFetch;
  }
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

// ---------------------------------------------------------------------------
// Two-phase turn audio (2026-07-10): when TTS is still running once the guard
// clears, the reply goes out text-first (audio_pending) and the audio lands in
// KV via waitUntil, fetchable through action:'audio'.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// AI mock where the guard answers fast and Aura-2 is deliberately slow —
// forces the deferred-audio path deterministically.
function slowTtsAi({ ttsDelayMs = 120, guardVerdict = 'safe' } = {}) {
  return {
    async run(model) {
      if (String(model).includes('llama-guard')) return guardVerdict;
      if (String(model).includes('aura')) {
        await sleep(ttsDelayMs);
        return 'fake-aura-mp3-bytes';
      }
      // conversation fallback model — unused in these tests (OpenRouter mock answers)
      return JSON.stringify({ reply_en: 'Fallback!', mood: 'idle' });
    },
  };
}

function openRouterFetchMock(replyEn) {
  return async (url) => {
    if (String(url).includes('chat/completions')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: replyEn, mood: 'idle' }) } }] }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
  };
}

test('slow TTS -> turn returns text-first with audio_pending, audio fetchable via action:audio after waitUntil', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  await fakeKv.put('R2L-OTHER', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const originalFetch = globalThis.fetch;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-test-key', AI: slowTtsAi() };
  const waits = [];
  const waitUntil = (p) => waits.push(p);

  try {
    globalThis.fetch = openRouterFetchMock('Two cats! How lucky!');
    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }) }),
      env,
      waitUntil,
    });
    const { session_id } = await startResp.json();

    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id, transcript: 'I have two cats' }) }),
      env,
      waitUntil,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.equal(turnData.reply_en, 'Two cats! How lucky!');
    assert.equal(turnData.audio_b64, undefined, 'no inline audio while TTS is still running');
    assert.equal(turnData.audio_pending, true);
    assert.equal(turnData.audio_turn, 1);
    assert.equal(turnData.timing.tts_ms, null, 'tts_ms unknown at response time when deferred');
    assert.ok(waits.length >= 1, 'background TTS handed to waitUntil');

    // Poll before the audio exists -> ready:false, never an error.
    const earlyResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'audio', access_code: 'R2L-TEST', session_id, turn: 1 }) }),
      env,
    });
    const earlyData = await earlyResp.json();
    assert.equal(earlyData.ok, true);
    assert.equal(earlyData.ready, false);

    await Promise.all(waits);

    const audioResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'audio', access_code: 'R2L-TEST', session_id, turn: 1 }) }),
      env,
    });
    const audioData = await audioResp.json();
    assert.equal(audioData.ok, true);
    assert.equal(audioData.ready, true);
    assert.ok(audioData.audio_b64, 'deferred audio is fetchable once stored');
    assert.equal(audioData.content_type, 'audio/mpeg');

    // Owner check: another valid code must not be able to read this audio.
    const crossResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'audio', access_code: 'R2L-OTHER', session_id, turn: 1 }) }),
      env,
    });
    const crossData = await crossResp.json();
    assert.equal(crossData.ready, false, 'audio record is owner-checked against the access code');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guard flag with slow TTS -> canned redirect served, deferred audio never stored', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  const storedKeys = [];
  const origPut = fakeKv.put.bind(fakeKv);
  fakeKv.put = async (key, value, opts) => { storedKeys.push(key); return origPut(key, value, opts); };

  const originalFetch = globalThis.fetch;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-test-key', AI: slowTtsAi({ guardVerdict: 'unsafe\nS1' }) };
  const waits = [];

  try {
    globalThis.fetch = openRouterFetchMock('A reply the ML guard will flag');
    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }) }),
      env,
      waitUntil: (p) => waits.push(p),
    });
    const { session_id } = await startResp.json();

    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id, transcript: 'hello' }) }),
      env,
      waitUntil: (p) => waits.push(p),
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.notEqual(turnData.reply_en, 'A reply the ML guard will flag', 'flagged reply never surfaces');

    // The flag path returns before waitUntil is ever reached for this turn, so
    // nothing should have been scheduled at all — and even after the dangling
    // TTS promise (ttsDelayMs 120) has had ample time to finish, no
    // convo-audio record may exist.
    assert.equal(waits.length, 0, 'flagged turn never schedules background audio storage');
    await sleep(400);
    assert.ok(!storedKeys.some((k) => k.startsWith('convo-audio:')), 'no convo-audio record for a flagged reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('no waitUntil in context (plain node) -> deferred audio still lands in KV via the fire-and-forget fallback', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));

  const originalFetch = globalThis.fetch;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-test-key', AI: slowTtsAi({ ttsDelayMs: 120 }) };

  try {
    globalThis.fetch = openRouterFetchMock('No waitUntil here!');
    const startResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TEST' }) }),
      env,
    });
    const { session_id } = await startResp.json();

    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-TEST', session_id, transcript: 'hello there' }) }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.audio_pending, true);

    // No waitUntil was provided — the fallback lets the promise run to
    // completion on its own. Give it time to pass ttsDelayMs, then fetch.
    await sleep(400);
    const audioResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'audio', access_code: 'R2L-TEST', session_id, turn: 1 }) }),
      env,
    });
    const audioData = await audioResp.json();
    assert.equal(audioData.ready, true, 'audio stored even without a waitUntil in context');
    assert.ok(audioData.audio_b64);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Test-code cap bypass (2026-07-11): is_test codes get unlimited daily
// sessions and never touch the daily/global counters; normal codes keep
// every cap exactly as before.
// ---------------------------------------------------------------------------

test('is_test code starts a 4th+ session same day and never touches the daily/global counters', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TESTKID', JSON.stringify({ is_test: true, progress: { current_level: 'L2' } }));
  const putKeys = [];
  const origPut = fakeKv.put.bind(fakeKv);
  fakeKv.put = async (key, value, opts) => { putKeys.push(key); return origPut(key, value, opts); };

  const env = { READ2LEAD_CODES: fakeKv };
  for (let i = 0; i < 5; i++) {
    const resp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TESTKID' }) }),
      env,
    });
    assert.equal(resp.status, 200, `start #${i + 1} succeeds for a test code`);
    const body = await resp.json();
    assert.equal(body.ok, true);
  }
  assert.ok(!putKeys.some((k) => k.startsWith('convo-daily:')), 'test-code sessions never write the daily counter');
  assert.ok(!putKeys.some((k) => k.startsWith('convo-global:')), 'test-code sessions never write the global counter');
});

test('normal code still blocks at 3 sessions/day and still increments both counters', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-NORMALKID', JSON.stringify({ is_test: false, progress: { current_level: 'L2' } }));

  const env = { READ2LEAD_CODES: fakeKv };
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 3; i++) {
    const resp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-NORMALKID' }) }),
      env,
    });
    assert.equal(resp.status, 200, `start #${i + 1} within the cap succeeds`);
  }
  assert.equal(await fakeKv.get(`convo-daily:R2L-NORMALKID:${today}`, { type: 'json' }), 3, 'daily counter incremented');
  assert.equal(await fakeKv.get(`convo-global:${today}`, { type: 'json' }), 3, 'global counter incremented');

  const fourth = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-NORMALKID' }) }),
    env,
  });
  assert.equal(fourth.status, 429, '4th start blocked');
  const fourthBody = await fourth.json();
  assert.equal(fourthBody.error, 'daily_cap');
});

test('is_test code still starts fine when the global cap is exhausted (never consumes, never blocked by it)', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TESTKID', JSON.stringify({ is_test: true }));
  const today = new Date().toISOString().slice(0, 10);
  await fakeKv.put(`convo-global:${today}`, JSON.stringify(60));

  const env = { READ2LEAD_CODES: fakeKv };
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-TESTKID' }) }),
    env,
  });
  assert.equal(resp.status, 200);
  assert.equal(await fakeKv.get(`convo-global:${today}`, { type: 'json' }), 60, 'global counter untouched by the test code');
});

test('action audio validates its inputs and unknown records return ready:false', async () => {
  const fakeKv = createFakeKv();
  await fakeKv.put('R2L-TEST', JSON.stringify({ is_test: true }));
  const env = { READ2LEAD_CODES: fakeKv };

  const badResp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'audio', access_code: 'R2L-TEST', session_id: 'sid', turn: 'nope' }) }),
    env,
  });
  assert.equal(badResp.status, 400);

  const missingResp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'audio', access_code: 'R2L-TEST', session_id: 'sid', turn: 3 }) }),
    env,
  });
  const missingData = await missingResp.json();
  assert.equal(missingData.ok, true);
  assert.equal(missingData.ready, false);
});

// ---------------------------------------------------------------------------
// V1.1 (2026-07-11): free-talk brain -- level-branched buildSystemPrompt,
// options/expected/hint parsing + level gating, topic/game session start,
// the repair ladder, and the Whisper prompt bias.
// ---------------------------------------------------------------------------

test('buildSystemPrompt L1-L2 appends ANSWER-SUPPORT rules and the options/expected JSON tail', () => {
  const prompt = buildSystemPrompt('L1', 'their favorite color');
  assert.match(prompt, /ANSWER-SUPPORT/);
  assert.match(prompt, /"options"/);
  assert.match(prompt, /"expected"/);
  assert.doesNotMatch(prompt, /"hint"/);
});

test('buildSystemPrompt L3+ without a topic falls back to starterTopic as the label, no seed list, hint tail', () => {
  const prompt = buildSystemPrompt('L3', 'their favorite food');
  assert.match(prompt, /Today's talk is about their favorite food/);
  assert.doesNotMatch(prompt, /Weave these words/);
  assert.match(prompt, /"hint"/);
  assert.doesNotMatch(prompt, /ANSWER-SUPPORT/);
});

test('buildSystemPrompt L3+ with a valid topic includes the topic label and its seed words', () => {
  const prompt = buildSystemPrompt('L4', 'x', { topic: 'animals_pets' });
  assert.match(prompt, /Today's talk is about animals and pets/);
  assert.match(prompt, /Weave these words in naturally when they fit: dog, cat, fish/);
});

test('buildSystemPrompt unknown topic key falls back to starterTopic, same as no topic', () => {
  const prompt = buildSystemPrompt('L3', 'starter fallback topic', { topic: 'not_a_real_topic' });
  assert.match(prompt, /Today's talk is about starter fallback topic/);
  assert.doesNotMatch(prompt, /Weave these words/);
});

test('buildSystemPrompt appends the matching game protocol only at L4/L5 with a valid game id', () => {
  const debateTopic = DEBATE_TOPICS[2];
  const promptL4 = buildSystemPrompt('L4', 'x', { topic: 'sports', game: 'debate', debateTopic });
  assert.match(promptL4, /GAME: Friendly debate/);
  assert.ok(promptL4.includes(debateTopic));

  const promptL3 = buildSystemPrompt('L3', 'x', { topic: 'sports', game: 'debate', debateTopic });
  assert.doesNotMatch(promptL3, /GAME:/, 'game protocol never appended below L4');

  const promptNoGame = buildSystemPrompt('L5', 'x', { topic: 'sports' });
  assert.doesNotMatch(promptNoGame, /GAME:/);

  const promptBadGame = buildSystemPrompt('L4', 'x', { topic: 'sports', game: 'made_up_game' });
  assert.doesNotMatch(promptBadGame, /GAME:/, 'unrecognized game id is ignored, not appended');
});

test('buildSystemPrompt debate protocol falls back to the first allowlist topic when debateTopic is not on the allowlist', () => {
  const prompt = buildSystemPrompt('L5', 'x', { game: 'debate', debateTopic: 'a topic the kid invented' });
  assert.ok(prompt.includes(DEBATE_TOPICS[0]));
  assert.doesNotMatch(prompt, /a topic the kid invented/);
});

test('buildSystemPrompt build_a_story and would_you_rather protocols append verbatim', () => {
  const story = buildSystemPrompt('L4', 'x', { game: 'build_a_story' });
  assert.match(story, /GAME: Build a story together/);
  const wyr = buildSystemPrompt('L5', 'x', { game: 'would_you_rather' });
  assert.match(wyr, /GAME: Would You Rather/);
});

// --- parseModelReply optional fields ---------------------------------------

test('parseModelReply accepts valid options/expected and lowercases expected', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['DOG', 'A Cat'] });
  const result = parseModelReply(raw);
  assert.deepEqual(result.options, ['Dogs!', 'Cats!']);
  assert.deepEqual(result.expected, ['dog', 'a cat']);
});

test('parseModelReply accepts a valid hint string', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', hint: 'fetch' });
  const result = parseModelReply(raw);
  assert.equal(result.hint, 'fetch');
});

test('parseModelReply drops options with too many entries, keeps required fields', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['a', 'b', 'c', 'd'] });
  const result = parseModelReply(raw);
  assert.equal(result.options, undefined);
  assert.equal(result.reply_en, 'Hi');
});

test('parseModelReply drops a lone (1-element) options array -- the prompt mandates 2-3 choices (SHOULD-FIX 6)', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['Only one!'] });
  const result = parseModelReply(raw);
  assert.equal(result.options, undefined);
  assert.equal(result.reply_en, 'Hi', 'the reply still parses without options');
});

test('parseModelReply accepts a valid 2-element options array', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['A dog!', 'A cat!'] });
  assert.deepEqual(parseModelReply(raw).options, ['A dog!', 'A cat!']);
});

test('parseModelReply drops an options entry over 30 chars', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: ['x'.repeat(31)] });
  assert.equal(parseModelReply(raw).options, undefined);
});

test('parseModelReply drops empty expected array and an expected entry over 40 chars', () => {
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', expected: [] })).expected, undefined);
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', expected: ['x'.repeat(41)] })).expected, undefined);
});

test('parseModelReply drops a hint over 80 chars or a non-string hint', () => {
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', hint: 'x'.repeat(81) })).hint, undefined);
  assert.equal(parseModelReply(JSON.stringify({ reply_en: 'Hi', mood: 'idle', hint: 42 })).hint, undefined);
});

test('parseModelReply drops invalid optional fields independently -- a valid hint survives an invalid options value', () => {
  const raw = JSON.stringify({ reply_en: 'Hi', mood: 'idle', options: 'not-an-array', hint: 'fetch' });
  const result = parseModelReply(raw);
  assert.equal(result.options, undefined);
  assert.equal(result.hint, 'fetch');
});

// --- gateReplyForLevel (single source of truth for level gating) ----------

test('gateReplyForLevel strips hint and keeps options/expected at L1/L2', () => {
  const parsed = { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'], hint: 'x' };
  const result = gateReplyForLevel(parsed, 'L1');
  assert.deepEqual(result, { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'] });
  // input not mutated
  assert.ok('hint' in parsed);
});

test('gateReplyForLevel strips options/expected and keeps hint at L3+', () => {
  const parsed = { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'], hint: 'x' };
  const result = gateReplyForLevel(parsed, 'L4');
  assert.deepEqual(result, { reply_en: 'hi', mood: 'idle', hint: 'x' });
});

test('isBeginnerLevel is true only for L1/L2, unknown levels normalize to L3 (not beginner)', () => {
  assert.equal(isBeginnerLevel('L1'), true);
  assert.equal(isBeginnerLevel('L2'), true);
  assert.equal(isBeginnerLevel('L3'), false);
  assert.equal(isBeginnerLevel('L5'), false);
  assert.equal(isBeginnerLevel('L9'), false);
});

// --- fillPhrase --------------------------------------------------------

test('fillPhrase fills known placeholders in both text_en and subtitle_vi without mutating the source phrase', () => {
  const phrase = findPhrase('repair_choices');
  const filled = fillPhrase(phrase, { a: 'A dog!', b: 'A cat!' });
  assert.ok(filled.text_en.includes('A dog!') && filled.text_en.includes('A cat!'));
  assert.ok(filled.subtitle_vi.includes('A dog!') && filled.subtitle_vi.includes('A cat!'));
  assert.doesNotMatch(filled.text_en, /\{a\}|\{b\}/);
  // source phrase constant untouched
  assert.match(findPhrase('repair_choices').text_en, /\{a\}/);
});

test('fillPhrase leaves an unfilled placeholder intact when no matching var is given', () => {
  const filled = fillPhrase(findPhrase('repair_model'), {});
  assert.match(filled.text_en, /\{model\}/);
});

// --- repair-ladder pure helpers (_minny-repair.js) --------------------------

test('isVietnamese detects diacritics and is false for plain English', () => {
  assert.equal(isVietnamese('con rất thích đi học'), true);
  assert.equal(isVietnamese('I like dogs'), false);
});

test('isLowContent: fewer than 2 words or fewer than 6 chars is low-content', () => {
  assert.equal(isLowContent('hi'), true);
  assert.equal(isLowContent('dog'), true);
  assert.equal(isLowContent('I like dogs'), false);
});

test('matchesExpected: direct phrase match and per-word fuzzy match both count; unrelated speech does not', () => {
  assert.equal(matchesExpected('i like dogs', ['dog', 'i like dogs'], wordSimilarity), true);
  assert.equal(matchesExpected('i lik dogz', ['i like dogs'], wordSimilarity), true, 'garbled-but-near transcript still resolves');
  assert.equal(matchesExpected('banana', ['dog', 'cat'], wordSimilarity), false);
});

test('nextRepairStep L1-L2 ladder: step1 rephrase -> step2 choices (from last_options) -> step3 move_on + reset', () => {
  const base = { last_options: ['A dog!', 'A cat!'], last_expected: ['dog', 'cat'] };
  const step1 = nextRepairStep({ ...base, repair: { step: 0, active: false } }, 'L1');
  assert.equal(step1.phraseId, 'repair_rephrase');
  assert.deepEqual(step1.repair, { step: 1, active: true });

  const step2 = nextRepairStep({ ...base, repair: step1.repair }, 'L1');
  assert.equal(step2.phraseId, 'repair_choices');
  assert.deepEqual(step2.vars, { a: 'A dog!', b: 'A cat!' });
  assert.deepEqual(step2.repair, { step: 2, active: true });

  const step3 = nextRepairStep({ ...base, repair: step2.repair }, 'L1');
  assert.equal(step3.phraseId, 'repair_move_on');
  assert.deepEqual(step3.repair, { step: 0, active: false }, 'ladder resets after max 2 repair turns -- normal LLM turn resumes next');
});

test('nextRepairStep L1-L2 step2 falls back to repair_model when fewer than 2 last_options are on record', () => {
  const step = nextRepairStep({ repair: { step: 1, active: true }, last_options: ['only one'], last_expected: ['dog'] }, 'L2');
  assert.equal(step.phraseId, 'repair_model');
  assert.deepEqual(step.vars, { model: 'dog' });
});

test('nextRepairStep L3+ ladder SKIPS the two-choice step: step2 is repair_model, never repair_choices', () => {
  const step = nextRepairStep({ repair: { step: 1, active: true }, last_hint: 'fetch' }, 'L4');
  assert.equal(step.phraseId, 'repair_model');
  assert.notEqual(step.phraseId, 'repair_choices');
  assert.equal(step.vars.model, 'I like fetch');
});

test('nextRepairStep Vietnamese trigger at L1-L2 models the first expected variant and consumes repair step 1', () => {
  const step = nextRepairStep({ repair: { step: 2, active: true }, last_expected: ['dog', 'cat'] }, 'L2', { vietnamese: true });
  assert.equal(step.phraseId, 'vn_nudge');
  assert.equal(step.vars.model, 'dog');
  assert.deepEqual(step.repair, { step: 1, active: true });
});

test('nextRepairStep Vietnamese trigger at L3+ models the last hint only when it is a single word, else falls back', () => {
  const withWordHint = nextRepairStep({ last_hint: 'fetch' }, 'L4', { vietnamese: true });
  assert.equal(withWordHint.vars.model, 'fetch');

  const withQuestionHint = nextRepairStep({ last_hint: 'What does Bun eat?' }, 'L4', { vietnamese: true });
  assert.equal(withQuestionHint.vars.model, 'i like it');
});

// --- start: topic/game validation -------------------------------------

function seedCode(fakeKv, code, level, extra = {}) {
  return fakeKv.put(code, JSON.stringify({ is_test: true, progress: { current_level: level }, ...extra }));
}

test('start (L3+): invalid topic value is rejected with 400 bad_request', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L3', 'L3');
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L3', topic: 'not_a_real_topic' }) }),
    env: { READ2LEAD_CODES: fakeKv },
  });
  assert.equal(resp.status, 400);
  assert.equal((await resp.json()).error, 'bad_request');
});

test('start (L3+): a valid TOPIC_SEEDS key is accepted and stored on the session', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L3', 'L3');
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L3', topic: 'sports' }) }),
    env: { READ2LEAD_CODES: fakeKv },
  });
  const body = await resp.json();
  assert.equal(body.ok, true);
  const stored = await fakeKv.get(`convo-session:${body.session_id}`, { type: 'json' });
  assert.equal(stored.topic, 'sports');
});

test('start (L3+): topic "minny_choice" always resolves to a real TOPIC_SEEDS key', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L3', 'L3');
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const resp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L3', topic: 'minny_choice' }) }),
      env: { READ2LEAD_CODES: fakeKv },
    });
    const body = await resp.json();
    const stored = await fakeKv.get(`convo-session:${body.session_id}`, { type: 'json' });
    assert.ok(Object.keys(TOPIC_SEEDS).includes(stored.topic));
    seen.add(stored.topic);
  }
  assert.ok(seen.size > 1, 'minny_choice actually varies across many draws');
});

test('start: game is rejected below L4 (400) even with a valid game id', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L3', 'L3');
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L3', game: 'debate' }) }),
    env: { READ2LEAD_CODES: fakeKv },
  });
  assert.equal(resp.status, 400);
});

test('start: unknown game id at L4/L5 is rejected with 400', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L4', 'L4');
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L4', game: 'made_up_game' }) }),
    env: { READ2LEAD_CODES: fakeKv },
  });
  assert.equal(resp.status, 400);
});

test('start: game "debate" at L4/L5 always assigns a debate_topic from the allowlist, never client-set', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L5', 'L5');
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const resp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L5', game: 'debate' }) }),
      env: { READ2LEAD_CODES: fakeKv },
    });
    const body = await resp.json();
    const stored = await fakeKv.get(`convo-session:${body.session_id}`, { type: 'json' });
    assert.equal(stored.game, 'debate');
    assert.ok(DEBATE_TOPICS.includes(stored.debate_topic));
    seen.add(stored.debate_topic);
  }
  assert.ok(seen.size > 1, 'debate topic actually varies across many draws');
});

test('start: L1/L2 codes ignore topic/game silently -- no 400 even for values that would be rejected at L3+, nothing stored', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L1', 'L1');
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L1', topic: 'not_a_real_topic', game: 'not_a_real_game' }) }),
    env: { READ2LEAD_CODES: fakeKv },
  });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  const stored = await fakeKv.get(`convo-session:${body.session_id}`, { type: 'json' });
  assert.equal(stored.topic, null);
  assert.equal(stored.game, null);
  assert.equal(stored.debate_topic, null);
});

// --- turn: guardrail screens the whole kid-visible surface -----------------

function openRouterJsonMock(replyObj) {
  return async (url) => {
    if (String(url).includes('chat/completions')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(replyObj) } }] }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
  };
}

test('turn: a banned word hidden in options[1] is caught by the guardrail (L1-L2) -- never reaches the kid', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = openRouterJsonMock({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['A dog!', 'You bastard!'], expected: ['dog', 'cat'] });
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hello' }) }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.notEqual(turnData.reply_en, 'Do you like dogs or cats?', 'the flagged reply never reaches the kid');
    assert.equal(turnData.options, undefined, 'a flagged turn falls to the canned redirect, no options carried');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('turn: a banned word hidden in the hint is caught by the guardrail (L3+) -- never reaches the kid', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L4', 'L4');
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = openRouterJsonMock({ reply_en: 'That sounds fun!', mood: 'idle', hint: 'you bastard' });
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L4' }) }), env });
    const { session_id } = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L4', session_id, transcript: 'we played outside' }) }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.notEqual(turnData.reply_en, 'That sounds fun!');
    assert.equal(turnData.hint, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('turn: response carries options/expected at L1-L2 and hint at L3+, never both, even if the model emits the wrong-level field', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  await seedCode(fakeKv, 'R2L-L4', 'L4');
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    // L2 model reply carries a (level-inappropriate) hint too -- must be gated out.
    globalThis.fetch = openRouterJsonMock({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'], hint: 'oops' });
    const start2 = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id: sid2 } = await start2.json();
    const turn2 = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id: sid2, transcript: 'hi' }) }), env });
    const data2 = await turn2.json();
    assert.deepEqual(data2.options, ['Dogs!', 'Cats!']);
    assert.deepEqual(data2.expected, ['dog', 'cat']);
    assert.equal(data2.hint, undefined);

    // L4 model reply carries options/expected too -- must be gated out.
    globalThis.fetch = openRouterJsonMock({ reply_en: 'Tell me more!', mood: 'idle', hint: 'fetch', options: ['a', 'b'], expected: ['a'] });
    const start4 = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L4' }) }), env });
    const { session_id: sid4 } = await start4.json();
    const turn4 = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L4', session_id: sid4, transcript: 'we played outside' }) }), env });
    const data4 = await turn4.json();
    assert.equal(data4.hint, 'fetch');
    assert.equal(data4.options, undefined);
    assert.equal(data4.expected, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- repair ladder, wired through the endpoint end-to-end -------------------

test('endpoint: a low-content reply after an options turn triggers the repair ladder without calling the LLM again', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  let openRouterCalls = 0;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        openRouterCalls++;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'dogs', 'cat', 'cats'] }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();

    const turn1 = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hi' }) }), env });
    const data1 = await turn1.json();
    assert.equal(openRouterCalls, 1);
    assert.deepEqual(data1.expected, ['dog', 'dogs', 'cat', 'cats']);

    // Stall: very short / unclear transcript that doesn't match "dog"/"cat".
    const turn2 = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'um' }) }), env });
    const data2 = await turn2.json();
    assert.equal(openRouterCalls, 1, 'the repair turn never calls the LLM');
    assert.equal(data2.reply_en, findPhrase('repair_rephrase').text_en);
    assert.deepEqual(data2.options, ['Dogs!', 'Cats!'], 'the same options are re-sent so the client can re-render them');
    assert.equal(data2.turns_left, 10, 'a repair turn still consumes the normal turn cap');

    const stored = await fakeKv.get(`convo-session:${session_id}`, { type: 'json' });
    assert.equal(stored.flags, 0, 'a repair turn never increments flags');
    assert.equal(stored.strikes, 0, 'a repair turn never increments strikes');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint: repair ladder progresses step1 -> step2 -> move_on across three consecutive stalls, then a normal LLM turn resumes', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  let openRouterCalls = 0;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        openRouterCalls++;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'] }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();
    await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hi' }) }), env });
    assert.equal(openRouterCalls, 1);

    const stall = () => onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'um' }) }), env }).then((r) => r.json());

    const s1 = await stall();
    assert.equal(s1.reply_en, findPhrase('repair_rephrase').text_en);
    const s2 = await stall();
    assert.equal(s2.reply_en, fillPhrase(findPhrase('repair_choices'), { a: 'Dogs!', b: 'Cats!' }).text_en);
    const s3 = await stall();
    assert.equal(s3.reply_en, findPhrase('repair_move_on').text_en);
    assert.equal(openRouterCalls, 1, 'none of the three repair turns called the LLM');

    // Repair reset -- the NEXT turn is a normal LLM turn again.
    const resumed = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'I like dogs' }) }), env }).then((r) => r.json());
    assert.equal(openRouterCalls, 2, 'repair resumed a normal LLM turn');
    assert.equal(resumed.reply_en, 'Do you like dogs or cats?');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint: a Vietnamese transcript triggers vn_nudge before any LLM call, at any level', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L4', 'L4');
  let openRouterCalls = 0;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async () => 'audio' } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) openRouterCalls++;
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L4' }) }), env });
    const { session_id } = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L4', session_id, transcript: 'con rất thích đi học' }) }),
      env,
    });
    const data = await turnResp.json();
    assert.equal(openRouterCalls, 0, 'Vietnamese heuristic fires before any LLM spend');
    assert.equal(data.reply_en, fillPhrase(findPhrase('vn_nudge'), { model: 'i like it' }).text_en);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Whisper prompt bias (Task 5) -------------------------------------------

test('Whisper prompt bias: L1-L2 sends the last turn\'s expected variants as initial_prompt to Workers AI', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  const whisperInputs = [];
  const env = {
    READ2LEAD_CODES: fakeKv,
    OPENROUTER_API_KEY: 'or-key',
    AI: {
      run: async (model, input) => {
        if (String(model).includes('whisper')) { whisperInputs.push(input); return { text: 'i like dogs' }; }
        if (String(model).includes('llama-guard')) return 'safe';
        return 'audio';
      },
    },
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = openRouterJsonMock({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'] });
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();

    // Turn 1 (JSON transcript, no STT) establishes last_expected.
    await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hi' }) }), env });
    assert.equal(whisperInputs.length, 0, 'no audio uploaded yet, so no whisper call yet');

    // Turn 2: audio upload -- Whisper should now be biased with last_expected.
    const form = new FormData();
    form.append('access_code', 'R2L-L2');
    form.append('action', 'turn');
    form.append('session_id', session_id);
    form.append('audio', new File([new Uint8Array([1, 2, 3])], 'turn.webm', { type: 'audio/webm' }));
    await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: form }), env });

    assert.equal(whisperInputs.length, 1);
    assert.equal(whisperInputs[0].initial_prompt, 'dog, cat');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Whisper prompt bias: L3+ sends the chosen topic\'s seed words; no topic means no prompt at all', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L4', 'L4');
  await seedCode(fakeKv, 'R2L-L4-NOTOPIC', 'L4');
  const whisperInputs = [];
  const env = {
    READ2LEAD_CODES: fakeKv,
    OPENROUTER_API_KEY: 'or-key',
    AI: {
      run: async (model, input) => {
        if (String(model).includes('whisper')) { whisperInputs.push(input); return { text: 'we played fetch' }; }
        if (String(model).includes('llama-guard')) return 'safe';
        return 'audio';
      },
    },
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve({ ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer });

    const uploadTurn = async (code, sessionId) => {
      const form = new FormData();
      form.append('access_code', code);
      form.append('action', 'turn');
      form.append('session_id', sessionId);
      form.append('audio', new File([new Uint8Array([1, 2, 3])], 'turn.webm', { type: 'audio/webm' }));
      return onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: form }), env });
    };

    const startWithTopic = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L4', topic: 'animals_pets' }) }), env });
    const { session_id: sidTopic } = await startWithTopic.json();
    await uploadTurn('R2L-L4', sidTopic);
    assert.equal(whisperInputs.at(-1).initial_prompt, TOPIC_SEEDS.animals_pets.seeds.join(', '));

    const startNoTopic = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L4-NOTOPIC' }) }), env });
    const { session_id: sidNoTopic } = await startNoTopic.json();
    await uploadTurn('R2L-L4-NOTOPIC', sidNoTopic);
    assert.equal(whisperInputs.at(-1).initial_prompt, undefined, 'no topic -> no prompt bias at all');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// V1.1 review fixes (Elon, second pass, 2026-07-11):
//   MUST-FIX 1: R2L's L0 (START_LEVEL, most pilot kids) must map onto the
//     L1 chips branch everywhere, not fall back to L3+.
//   MUST-FIX 2: repair_move_on must clear stale last_options/last_expected/
//     last_hint so the ladder doesn't re-trigger against an abandoned
//     question, and must not re-serve that question's chips.
//   SHOULD-FIX 3: matchesExpected must be word-boundary aware ("cat" must
//     not match inside "catapult").
//   MUST-FIX 4: expected[] must be screened by the guardrail surface scan
//     too (it is both client-visible in the turn response and later SPOKEN
//     via TTS by the repair ladder's {model} fill).
// ---------------------------------------------------------------------------

test('buildSystemPrompt L0 gets the L1 branch (ANSWER-SUPPORT block), not the L3+ hint branch', () => {
  const prompt = buildSystemPrompt('L0', 'their favorite color');
  assert.match(prompt, /ANSWER-SUPPORT/);
  assert.match(prompt, /"options"/);
  assert.doesNotMatch(prompt, /"hint"/);
});

test('gateReplyForLevel keeps options/expected (and strips hint) at L0', () => {
  const parsed = { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'], hint: 'x' };
  const result = gateReplyForLevel(parsed, 'L0');
  assert.deepEqual(result, { reply_en: 'hi', mood: 'idle', options: ['a', 'b'], expected: ['a'] });
});

test('isBeginnerLevel is true for L0 (R2L START_LEVEL)', () => {
  assert.equal(isBeginnerLevel('L0'), true);
});

test('start: L0 codes ignore topic/game silently, same as L1/L2 -- no 400, nothing stored', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L0', 'L0');
  const resp = await onRequestPost({
    request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L0', topic: 'not_a_real_topic', game: 'not_a_real_game' }) }),
    env: { READ2LEAD_CODES: fakeKv },
  });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  const stored = await fakeKv.get(`convo-session:${body.session_id}`, { type: 'json' });
  assert.equal(stored.topic, null);
  assert.equal(stored.game, null);
  assert.equal(stored.debate_topic, null);
});

test('nextRepairStep treats L0 as beginner: step2 is repair_choices (not the L3+ repair_model path)', () => {
  const step = nextRepairStep({ repair: { step: 1, active: true }, last_options: ['A dog!', 'A cat!'], last_expected: ['dog', 'cat'] }, 'L0');
  assert.equal(step.phraseId, 'repair_choices');
  assert.deepEqual(step.vars, { a: 'A dog!', b: 'A cat!' });
});

test('matchesExpected is word-boundary aware: "cat" must not match inside "catapult"', () => {
  assert.equal(matchesExpected('i like catapult', ['cat'], wordSimilarity), false);
});

test('endpoint: after stall -> stall -> move_on, the abandoned question\'s chips are cleared -- a later low-content turn reaches the LLM, not the ladder', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  let openRouterCalls = 0;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        openRouterCalls++;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'] }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();
    await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hi' }) }), env });
    assert.equal(openRouterCalls, 1);

    const stall = () => onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'um' }) }), env }).then((r) => r.json());

    await stall(); // step 1: repair_rephrase
    await stall(); // step 2: repair_choices
    const moveOn = await stall(); // step 3: repair_move_on
    assert.equal(moveOn.reply_en, findPhrase('repair_move_on').text_en);
    assert.equal(moveOn.options, undefined, 'move_on must not re-serve the abandoned question\'s chips');
    assert.equal(moveOn.expected, undefined);
    assert.equal(openRouterCalls, 1, 'none of the three repair turns called the LLM');

    const stored = await fakeKv.get(`convo-session:${session_id}`, { type: 'json' });
    assert.equal(stored.last_options, null, 'move_on clears the abandoned question\'s options');
    assert.equal(stored.last_expected, null, 'move_on clears the abandoned question\'s expected variants');
    assert.equal(stored.last_hint, null);

    // The kid's next low-content turn must NOT re-trigger the ladder (there
    // is no last_expected left to stall against) -- it reaches the LLM.
    const nextTurn = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'um' }) }), env }).then((r) => r.json());
    assert.equal(openRouterCalls, 2, 'post-move_on low-content turn reaches the LLM path, not the ladder');
    assert.equal(nextTurn.reply_en, 'Do you like dogs or cats?');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('turn: a banned word hidden in expected[1] is caught by the guardrail -- canned redirect served, nothing persisted to last_expected', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key', AI: { run: async (model) => (String(model).includes('llama-guard') ? 'safe' : 'audio') } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = openRouterJsonMock({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['A dog!', 'A cat!'], expected: ['dog', 'you bastard'] });
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();
    const turnResp = await onRequestPost({
      request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hello' }) }),
      env,
    });
    const turnData = await turnResp.json();
    assert.equal(turnData.ok, true);
    assert.notEqual(turnData.reply_en, 'Do you like dogs or cats?', 'the flagged reply never reaches the kid');
    assert.equal(turnData.expected, undefined, 'flagged expected[] never rides the response');
    assert.equal(turnData.options, undefined);

    const stored = await fakeKv.get(`convo-session:${session_id}`, { type: 'json' });
    assert.equal(stored.last_expected, null, 'the flag path never reaches the success-path session update, so last_expected stays unset');
    assert.equal(stored.last_options, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// V1.1 review fixes, third pass (Elon/Buffet, 2026-07-11):
//   MUST-FIX 5: EVERY path that abandons the current question (not just
//     repair_move_on) must clear last_options/last_expected/last_hint and
//     reset repair -- handleGuardrailFlag's single-flag redirect branch, and
//     the !parsed LLM-parse-failure redirect path. Both pose a brand-new
//     canned question; the kid's genuine answer to THAT question must not
//     be compared against the abandoned chips.
// ---------------------------------------------------------------------------

test('endpoint: after a guardrail-flagged model reply, the redirect\'s new question is not compared against the abandoned chips', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  let openRouterCalls = 0;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key' };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        openRouterCalls++;
        if (openRouterCalls === 1) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'] }) } }] }) };
        }
        if (openRouterCalls === 2) {
          // Clean-shaped reply that the deterministic word-list gate flags.
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'You are a bastard, kid.', mood: 'idle' }) } }] }) };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Tell me more!', mood: 'idle' }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();
    await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hi' }) }), env });

    const flaggedTurn = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'I really like dogs so much' }) }), env }).then((r) => r.json());
    assert.notEqual(flaggedTurn.reply_en, 'You are a bastard, kid.', 'flagged reply never reaches the kid');

    const stored = await fakeKv.get(`convo-session:${session_id}`, { type: 'json' });
    assert.equal(stored.last_expected, null, 'the redirect abandons the old question -- stale chips cleared');
    assert.equal(stored.last_options, null);
    assert.deepEqual(stored.repair, { step: 0, active: false });

    // The kid's genuine (here: low-content) answer to the redirect's NEW
    // question must reach the LLM, not the repair ladder (no last_expected
    // left to stall against).
    const nextTurn = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'um' }) }), env }).then((r) => r.json());
    assert.equal(openRouterCalls, 3, 'the low-content answer reached the LLM, not the repair ladder');
    assert.equal(nextTurn.reply_en, 'Tell me more!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint: after an LLM parse-failure redirect, the new canned question is not compared against the abandoned chips', async () => {
  const fakeKv = createFakeKv();
  await seedCode(fakeKv, 'R2L-L2', 'L2');
  let openRouterCalls = 0;
  const env = { READ2LEAD_CODES: fakeKv, OPENROUTER_API_KEY: 'or-key' };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        openRouterCalls++;
        if (openRouterCalls === 1) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Do you like dogs or cats?', mood: 'idle', options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'] }) } }] }) };
        }
        if (openRouterCalls <= 3) {
          return { ok: false, status: 500, json: async () => ({}) }; // both retry attempts fail -> parsed stays null
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply_en: 'Tell me more!', mood: 'idle' }) } }] }) };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
    };
    const startResp = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'start', access_code: 'R2L-L2' }) }), env });
    const { session_id } = await startResp.json();
    await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'hi' }) }), env });

    const failedTurn = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'I really like dogs so much' }) }), env }).then((r) => r.json());
    assert.equal(failedTurn.ok, true);
    assert.equal(failedTurn.options, undefined, 'a parse-failure redirect never carries options');

    const stored = await fakeKv.get(`convo-session:${session_id}`, { type: 'json' });
    assert.equal(stored.last_expected, null, 'the redirect abandons the old question -- stale chips cleared');
    assert.equal(stored.last_options, null);
    assert.deepEqual(stored.repair, { step: 0, active: false });

    const nextTurn = await onRequestPost({ request: new Request('http://x/api/minny-conversation', { method: 'POST', body: JSON.stringify({ action: 'turn', access_code: 'R2L-L2', session_id, transcript: 'um' }) }), env }).then((r) => r.json());
    assert.equal(openRouterCalls, 4, 'the low-content answer reached the LLM, not the repair ladder');
    assert.equal(nextTurn.reply_en, 'Tell me more!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
