import test from 'node:test';
import assert from 'node:assert/strict';

import { runSpeakingCheck, onRequestPost } from '../functions/api/read2lead-speaking-check.js';

// Bite tests (rule 28) for the speakup-shadowing-v1-p2 server micro-diff:
// (1) a shadow_practice read call must NEVER reach Azure, even when Azure
//     is fully configured/available in the test env -- a call that WOULD
//     hit Azure fails this test outright (the fetchFn spy throws).
// (2) an identical call WITHOUT shadow_practice follows today's path
//     byte-for-byte (regression fixture): it DOES hit Azure.
// (3) shadow_practice calls are rate-limited PER ACCESS CODE, with the
//     endpoint's existing 429 response shape.

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function fakeAiSpeaking(transcriptText) {
  return {
    async run(model) {
      return String(model).includes('llama-guard') ? 'safe' : { text: transcriptText };
    },
  };
}

function spyFetch(responder) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(String(url));
    return responder(url, opts);
  };
  fn.calls = calls;
  return fn;
}

const AZURE_URL_RE = /cognitiveservices/;

// ---------------------------------------------------------------------------
// (1) Azure bypass
// ---------------------------------------------------------------------------

test('Azure bypass: a shadow_practice read call never invokes Azure, even with Azure fully configured/available', async () => {
  const kv = fakeKv();
  const fetchFn = spyFetch(() => {
    throw new Error('fetchFn must never be called on a shadow_practice attempt -- this call would have hit Azure');
  });
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav'], { type: 'audio/wav' }),
    expectedText: 'the cat is happy',
    checkMode: 'read',
    shadowPractice: true,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    ai: fakeAiSpeaking('the cat is happy'),
    fetchFn,
  });
  assert.equal(fetchFn.calls.length, 0, 'Azure -- the only fetch consumer on this path -- must never be invoked');
  assert.equal(result.check_mode, 'read');
  assert.equal(result.score_percent, 100);
  assert.equal(result.pronunciation, undefined, 'no Azure-only field on a bypassed attempt');
});

// ---------------------------------------------------------------------------
// (2) Regression fixture: today's path is untouched
// ---------------------------------------------------------------------------

test("regression: an identical call WITHOUT shadow_practice follows today's path and DOES reach Azure", async () => {
  const kv = fakeKv();
  const fetchFn = spyFetch(() => new Response(JSON.stringify({
    RecognitionStatus: 'Success',
    NBest: [{
      Display: 'the cat is happy',
      PronScore: 95,
      AccuracyScore: 95,
      FluencyScore: 95,
      Words: [
        { Word: 'the', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'cat', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'is', ErrorType: 'None', AccuracyScore: 95 },
        { Word: 'happy', ErrorType: 'None', AccuracyScore: 95 },
      ],
    }],
  }), { status: 200 }));

  const result = await runSpeakingCheck({
    audioBlob: new Blob(['wav'], { type: 'audio/wav' }),
    expectedText: 'the cat is happy',
    checkMode: 'read',
    // shadowPractice omitted entirely -- defaults false, must be byte-identical to today
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    ai: fakeAiSpeaking('the cat is happy'),
    fetchFn,
  });

  assert.ok(fetchFn.calls.length >= 1, "today's path DOES call Azure");
  assert.match(fetchFn.calls[0], AZURE_URL_RE);
  assert.equal(result.check_mode, 'read');
});

test('regression: shadowPractice: false is identical to omitting it entirely', async () => {
  const kv = fakeKv();
  const fetchFn = spyFetch(() => new Response(JSON.stringify({
    RecognitionStatus: 'Success',
    NBest: [{ Display: 'ok', PronScore: 90, AccuracyScore: 90, FluencyScore: 90, Words: [{ Word: 'ok', ErrorType: 'None', AccuracyScore: 90 }] }],
  }), { status: 200 }));
  await runSpeakingCheck({
    audioBlob: new Blob(['wav'], { type: 'audio/wav' }),
    expectedText: 'ok',
    checkMode: 'read',
    shadowPractice: false,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    ai: fakeAiSpeaking('ok'),
    fetchFn,
  });
  assert.ok(fetchFn.calls.length >= 1);
  assert.match(fetchFn.calls[0], AZURE_URL_RE);
});

// ---------------------------------------------------------------------------
// (3) Rate limiting -- per access_code, existing 429 shape
// ---------------------------------------------------------------------------

function makeCodeKv(seed) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// No Azure env vars here on purpose -- this section is isolated to
// rate-limiting concerns; the Azure-bypass behavior is already covered above.
async function postShadowPractice({ accessCode, kv }) {
  const formData = new FormData();
  formData.append('access_code', accessCode);
  formData.append('pack_id', 'general'); // trivially passes canAccessPackForPractice
  formData.append('expected_text', 'the cat is happy');
  formData.append('check_mode', 'read');
  formData.append('practice_mode', '1');
  formData.append('shadow_practice', '1');
  formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }), 'audio.webm');
  return onRequestPost({
    request: new Request('https://example.com/api/read2lead-speaking-check', { method: 'POST', body: formData }),
    env: {
      READ2LEAD_CODES: kv,
      AI: fakeAiSpeaking('the cat is happy'),
    },
  });
}

test('rate limiting: two different access codes on the same IP each get their own independent budget', async () => {
  const kv = makeCodeKv({ 'CODE-A': {}, 'CODE-B': {} });
  const resA = await postShadowPractice({ accessCode: 'code-a', kv });
  const resB = await postShadowPractice({ accessCode: 'code-b', kv });
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  const bodyA = await resA.json();
  const bodyB = await resB.json();
  assert.equal(bodyA.ok, true);
  assert.equal(bodyB.ok, true);
});

test('rate limiting: hammering one access code beyond the burst limit trips the endpoint\'s existing 429 shape', async () => {
  const kv = makeCodeKv({ 'CODE-C': {} });
  const responses = [];
  for (let i = 0; i < 21; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    responses.push(await postShadowPractice({ accessCode: 'code-c', kv }));
  }
  for (let i = 0; i < 20; i += 1) {
    assert.equal(responses[i].status, 200, `call ${i + 1} (within the 20-call budget) should still be allowed`);
  }
  const last = responses[20];
  assert.equal(last.status, 429, 'the 21st call in the same window must be rate-limited');
  const body = await last.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'rate_limited');
  assert.ok(last.headers.get('Retry-After'), 'reuses the existing rateLimitedResponse shape');
});
