import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestGet as publicGet,
  buildPublicHonorsPayload,
} from '../functions/api/read2lead-honors.js';
import {
  onRequestGet as adminGet,
  onRequestPost as adminPost,
} from '../functions/api/admin/read2lead-honors.js';

const HONORS_KV_KEY = 'honors:2026-S1';

/** Minimal in-memory KV mock — same get/put contract used throughout the
 * repo's tests (e.g. tests/grant-season-honors.test.mjs's makeMockKv). */
function makeMockKv(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, options) {
      const raw = store.get(key);
      if (raw == null) return null;
      return options?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    __store: store,
  };
}

/**
 * A realistic frozen snapshot in the exact shape
 * scripts/grant-season-honors.mjs's buildHonorsSnapshot() produces (podium
 * override path — Percy/Hoang/Hieuenzo, matching PODIUM_OVERRIDE_BASIS_NOTE),
 * already paid (diamonds_before/after/paid_at set on podium rows). Prizes
 * are the real, founder-approved, already-paid amounts from HONORS_PRIZES.
 *
 * honor_roll is deliberately still in the OLD all-time lifetime_rp order
 * (Hoang first) to exercise Trap 2 — the public shaper must not surface
 * that contradiction.
 */
function makeFrozenSnapshot({ published = false } = {}) {
  return {
    season_id: '2026-S1',
    season_name_vi: 'Amazing Summer',
    emoji: '🌞',
    window: { from: '2026-07-01', to: '2026-08-31' },
    basis: 'app_leaderboard_order',
    basis_label_vi: 'Thứ hạng trên bảng xếp hạng',
    basis_note: 'Founder-confirmed 2026-09-03 against the app\'s displayed leaderboard order.',
    frozen_at: '2026-09-01T10:00:00.000Z',
    published,
    podium: [
      {
        access_code: 'R2L-PHUPERCY-X567',
        masked_code: 'R2L-***X567',
        student_name: 'Percy',
        lifetime_rp: 4800,
        completed_packs: 38,
        completed_books: 11,
        pronunciation_percent: 91,
        pronunciation_sample_count: 18,
        tiebreak_confidence: 'full',
        rank: 1,
        prize_diamonds: 10000,
        paid_at: '2026-09-01T10:05:00.000Z',
        diamonds_before: 1200,
        diamonds_after: 11200,
      },
      {
        access_code: 'R2L-HOANG-A111',
        masked_code: 'R2L-***A111',
        student_name: 'Hoang',
        lifetime_rp: 5000,
        completed_packs: 40,
        completed_books: 12,
        pronunciation_percent: 88,
        pronunciation_sample_count: 20,
        tiebreak_confidence: 'full',
        rank: 2,
        prize_diamonds: 5000,
        paid_at: '2026-09-01T10:05:00.000Z',
        diamonds_before: 900,
        diamonds_after: 5900,
      },
      {
        access_code: 'R2L-HIEUE-C333',
        masked_code: 'R2L-***C333',
        student_name: 'Hieuenzo',
        lifetime_rp: 4700,
        completed_packs: 35,
        completed_books: 10,
        pronunciation_percent: 85,
        pronunciation_sample_count: 15,
        tiebreak_confidence: 'full',
        rank: 3,
        prize_diamonds: 2000,
        paid_at: '2026-09-01T10:05:00.000Z',
        diamonds_before: 500,
        diamonds_after: 2500,
      },
    ],
    honor_roll: [
      { access_code: 'R2L-HOANG-A111', masked_code: 'R2L-***A111', student_name: 'Hoang', lifetime_rp: 5000, completed_packs: 40, completed_books: 12, pronunciation_percent: 88, pronunciation_sample_count: 20, tiebreak_confidence: 'full', rank: 1 },
      { access_code: 'R2L-PHUPERCY-X567', masked_code: 'R2L-***X567', student_name: 'Percy', lifetime_rp: 4800, completed_packs: 38, completed_books: 11, pronunciation_percent: 91, pronunciation_sample_count: 18, tiebreak_confidence: 'full', rank: 2 },
      { access_code: 'R2L-HIEUE-C333', masked_code: 'R2L-***C333', student_name: 'Hieuenzo', lifetime_rp: 4700, completed_packs: 35, completed_books: 10, pronunciation_percent: 85, pronunciation_sample_count: 15, tiebreak_confidence: 'full', rank: 3 },
      { access_code: 'R2L-ANHTU-D444', masked_code: 'R2L-***D444', student_name: 'Anh Tú', lifetime_rp: 3000, completed_packs: 20, completed_books: 6, pronunciation_percent: 75, pronunciation_sample_count: 10, tiebreak_confidence: 'full', rank: 4 },
      { access_code: 'R2L-BAOCH-E555', masked_code: 'R2L-***E555', student_name: 'Bảo Châu', lifetime_rp: 2900, completed_packs: 18, completed_books: 5, pronunciation_percent: 70, pronunciation_sample_count: 8, tiebreak_confidence: 'partial', rank: 5 },
    ],
    excluded: [
      { masked_code: 'R2L-***9999', reason: 'is_bot' },
      { masked_code: 'R2L-***8888', reason: 'is_test' },
    ],
    participants_count: 5,
  };
}

function makeContext({ env, url = 'https://felixbuilderhub.com/api/read2lead-honors', method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return { request: new Request(url, init), env };
}

// --- Trap 1: no credential/internal-field leak, via an explicit allow-list ---

test('BAD-allowlist: the public payload never contains the raw access_code, "access_code" key, excluded[], or payment-internal fields', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  const serialized = JSON.stringify(payload);

  assert.ok(!serialized.includes('R2L-PHUPERCY-X567'), 'raw access_code leaked into the public payload');
  assert.ok(!serialized.includes('access_code'), '"access_code" key leaked');
  assert.ok(!serialized.includes('excluded'), 'excluded[] leaked (internal bot/test list)');
  assert.ok(!serialized.includes('diamonds_after'), 'diamonds_after leaked');
  assert.ok(!serialized.includes('diamonds_before'), 'diamonds_before leaked');
  assert.ok(!serialized.includes('paid_at'), 'paid_at leaked');
  assert.ok(!serialized.includes('lifetime_rp'), 'lifetime_rp leaked');
  assert.ok(!serialized.includes('tiebreak_confidence'), 'tiebreak_confidence leaked');
  assert.ok(!serialized.includes('pronunciation_percent'), 'pronunciation_percent leaked (per-child skill data, private-certificate only)');
  assert.ok(!serialized.includes('pronunciation_sample_count'), 'pronunciation_sample_count leaked');
});

// Buffet finding (pre-publish blocker): the UI stopped *rendering*
// pronunciation_percent, but the wire payload still carried it — a test
// that only inspected the DOM would never have caught that gap. This test
// asserts on the serialized JSON string itself, not on any rendered markup,
// so a future field re-added to the allow-list fails here even if no page
// ever displays it.
test('BAD-wire-leak: serialized public payload contains neither the key nor the value of pronunciation_percent, for every podium and honor_roll row', () => {
  const snapshot = makeFrozenSnapshot({ published: true });
  // Every row in the fixture already carries pronunciation_percent (91/88/85
  // on podium, 88/91/85/75/70 on honor_roll). 91 is a distinctive value that
  // appears nowhere else in the fixture (not a rank, prize, count, or year),
  // so its presence in the serialized payload can only mean the field leaked.
  const payload = buildPublicHonorsPayload(snapshot);
  const serialized = JSON.stringify(payload);

  assert.ok(!serialized.includes('pronunciation_percent'), 'pronunciation_percent key leaked into the wire payload');
  assert.ok(!serialized.includes('91'), 'the distinctive pronunciation_percent value (91) leaked into the wire payload');
});

test('BAD-allowlist-2: an unexpected extra field on a snapshot row does NOT reach the public payload (proves the shaper is an allow-list, not a strip-list)', () => {
  const snapshot = makeFrozenSnapshot({ published: true });
  snapshot.podium[0].secret_note = 'internal only, should never leak';
  snapshot.honor_roll[0].secret_note = 'internal only, should never leak';

  const payload = buildPublicHonorsPayload(snapshot);
  const serialized = JSON.stringify(payload);

  assert.ok(!serialized.includes('secret_note'), 'an unlisted field leaked through — shaper is not a true allow-list');
});

// --- Trap 2: honor_roll must not contradict the paid podium ---

test('BAD-honorroll-rank: no honor_roll row carries a rank key', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  for (const row of payload.honor_roll) {
    assert.equal('rank' in row, false, `honor_roll row for ${row.student_name} still carries rank`);
  }
});

test('BAD-honorroll-order: honor_roll is alphabetical by student_name (locale-aware), NOT the frozen lifetime_rp order', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  const names = payload.honor_roll.map((row) => row.student_name);

  // The frozen snapshot's honor_roll[0] is Hoang (highest lifetime_rp) —
  // asserting the public order is NOT that proves the re-sort actually ran.
  assert.notEqual(payload.honor_roll[0].student_name, 'Hoang');

  const expectedAlphabetical = [...names].sort((a, b) => a.localeCompare(b, 'vi'));
  assert.deepEqual(names, expectedAlphabetical);
});

test('podium keeps the frozen founder-confirmed order (Percy 1, Hoang 2, Hieuenzo 3) untouched', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  assert.deepEqual(
    payload.podium.map((row) => [row.student_name, row.rank, row.prize_diamonds]),
    [['Percy', 1, 10000], ['Hoang', 2, 5000], ['Hieuenzo', 3, 2000]],
  );
});

// --- Public payload shape / field allow-list contents ---

test('public podium row contains exactly the allow-listed fields', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  assert.deepEqual(Object.keys(payload.podium[0]).sort(), [
    'completed_books', 'completed_packs', 'masked_code', 'prize_diamonds',
    'rank', 'student_name',
  ].sort());
});

test('public honor_roll row contains exactly the allow-listed fields (no rank, no prize_diamonds)', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  assert.deepEqual(Object.keys(payload.honor_roll[0]).sort(), [
    'completed_books', 'completed_packs', 'masked_code', 'student_name',
  ].sort());
});

test('published payload top-level shape', () => {
  const payload = buildPublicHonorsPayload(makeFrozenSnapshot({ published: true }));
  assert.equal(payload.ok, true);
  assert.equal(payload.published, true);
  assert.deepEqual(payload.season, { id: '2026-S1', name_vi: 'Amazing Summer', emoji: '🌞', window: { from: '2026-07-01', to: '2026-08-31' } });
  assert.equal(payload.frozen_at, '2026-09-01T10:00:00.000Z');
  assert.equal(payload.participants_count, 5);
  assert.equal(payload.podium.length, 3);
  assert.equal(payload.honor_roll.length, 5);
});

// --- "not announced yet" degrade path (BAD inputs the shaper must not choke on) ---

test('unpublished, missing, and malformed snapshots all degrade to {ok:true, published:false}', () => {
  assert.deepEqual(buildPublicHonorsPayload(makeFrozenSnapshot({ published: false })), { ok: true, published: false });
  assert.deepEqual(buildPublicHonorsPayload(null), { ok: true, published: false });
  assert.deepEqual(buildPublicHonorsPayload(undefined), { ok: true, published: false });
  assert.deepEqual(buildPublicHonorsPayload({ published: true, podium: 'not-an-array', honor_roll: [] }), { ok: true, published: false });
  assert.deepEqual(buildPublicHonorsPayload({ published: true, podium: [], honor_roll: null }), { ok: true, published: false });
});

// --- Public endpoint integration (mocked KV, HTTP status/never-error contract) ---

test('GET public endpoint: missing KV key -> HTTP 200 {ok:true, published:false}, never 404/500', async () => {
  const env = { READ2LEAD_CODES: makeMockKv({}) };
  const res = await publicGet(makeContext({ env }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, published: false });
});

test('GET public endpoint: unpublished snapshot -> HTTP 200 {ok:true, published:false}', async () => {
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: makeFrozenSnapshot({ published: false }) }) };
  const res = await publicGet(makeContext({ env }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, published: false });
});

test('GET public endpoint: published snapshot -> HTTP 200 with the shaped public payload, no credentials in the raw body text', async () => {
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: makeFrozenSnapshot({ published: true }) }) };
  const res = await publicGet(makeContext({ env }));
  assert.equal(res.status, 200);
  const bodyText = await res.text();
  assert.ok(!bodyText.includes('R2L-PHUPERCY-X567'));
  const body = JSON.parse(bodyText);
  assert.equal(body.published, true);
  assert.equal(body.podium[0].student_name, 'Percy');
});

test('GET public endpoint: missing KV binding -> HTTP 200 {ok:true, published:false}, never 500', async () => {
  const env = {};
  const res = await publicGet(makeContext({ env }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, published: false });
});

test('GET public endpoint: rate-limited IP gets 429, not the honors payload', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = {
    READ2LEAD_CODES: makeMockKv({
      [HONORS_KV_KEY]: makeFrozenSnapshot({ published: true }),
      'rl:1.2.3.4': { count: 8, first_at: now, blocked_until: now + 300 },
    }),
  };
  const request = new Request('https://felixbuilderhub.com/api/read2lead-honors', {
    headers: { 'CF-Connecting-IP': '1.2.3.4' },
  });
  const res = await publicGet({ request, env });
  assert.equal(res.status, 429);
});

// --- Admin endpoint ---

test('admin GET: no snapshot frozen yet -> {ok:false, error:"honors_not_frozen"}, 4xx', async () => {
  const env = { READ2LEAD_CODES: makeMockKv({}) };
  const res = await adminGet({ request: new Request('https://example.com/api/admin/read2lead-honors'), env });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
  const body = await res.json();
  assert.deepEqual(body, { ok: false, error: 'honors_not_frozen' });
});

test('admin GET: returns the FULL snapshot untouched, including access_code and excluded', async () => {
  const snapshot = makeFrozenSnapshot({ published: false });
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: snapshot }) };
  const res = await adminGet({ request: new Request('https://example.com/api/admin/read2lead-honors'), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.honors, snapshot);
  assert.equal(body.honors.podium[0].access_code, 'R2L-PHUPERCY-X567');
  assert.equal(body.honors.excluded.length, 2);
});

test('BAD-publish-mutation: POST publish flips ONLY `published` — every other field is byte-identical to before', async () => {
  const before = makeFrozenSnapshot({ published: false });
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: before }) };

  const res = await adminPost(makeContext({
    env,
    url: 'https://example.com/api/admin/read2lead-honors',
    method: 'POST',
    body: { action: 'publish' },
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.honors.published, true);

  const { published: _beforePublished, ...beforeRest } = before;
  const { published: _afterPublished, ...afterRest } = body.honors;
  assert.deepEqual(afterRest, beforeRest);

  // And it actually persisted to KV, not just the response.
  const stored = await env.READ2LEAD_CODES.get(HONORS_KV_KEY, { type: 'json' });
  assert.equal(stored.published, true);
});

test('POST unpublish flips it back, same byte-identical-elsewhere guarantee', async () => {
  const before = makeFrozenSnapshot({ published: true });
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: before }) };

  const res = await adminPost(makeContext({
    env,
    url: 'https://example.com/api/admin/read2lead-honors',
    method: 'POST',
    body: { action: 'unpublish' },
  }));
  const body = await res.json();
  assert.equal(body.honors.published, false);
  const { published: _b, ...beforeRest } = before;
  const { published: _a, ...afterRest } = body.honors;
  assert.deepEqual(afterRest, beforeRest);
});

test('POST with an invalid action is refused (400) and does not touch KV', async () => {
  const before = makeFrozenSnapshot({ published: false });
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: before }) };

  const res = await adminPost(makeContext({
    env,
    url: 'https://example.com/api/admin/read2lead-honors',
    method: 'POST',
    body: { action: 'delete_everything' },
  }));
  assert.equal(res.status, 400);
  const stored = await env.READ2LEAD_CODES.get(HONORS_KV_KEY, { type: 'json' });
  assert.deepEqual(stored, before);
});

test('POST publish with no snapshot frozen yet -> {ok:false, error:"honors_not_frozen"}, 4xx, no write', async () => {
  const env = { READ2LEAD_CODES: makeMockKv({}) };
  const res = await adminPost(makeContext({
    env,
    url: 'https://example.com/api/admin/read2lead-honors',
    method: 'POST',
    body: { action: 'publish' },
  }));
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
  const body = await res.json();
  assert.deepEqual(body, { ok: false, error: 'honors_not_frozen' });
  assert.equal(await env.READ2LEAD_CODES.get(HONORS_KV_KEY, { type: 'json' }), null);
});

test('POST with invalid JSON body -> 400 invalid_json', async () => {
  const env = { READ2LEAD_CODES: makeMockKv({ [HONORS_KV_KEY]: makeFrozenSnapshot({ published: false }) }) };
  const request = new Request('https://example.com/api/admin/read2lead-honors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  const res = await adminPost({ request, env });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_json');
});
