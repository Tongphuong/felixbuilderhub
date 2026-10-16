import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningBoards, starsEligible, learningStarsResponse, resetLearningBoardsCache } from '../functions/lib/read2lead/learning-stars-board.mjs';
const now = '2026-10-14T03:00:00Z';
// Old receipts from last month: the retired weekly board would have ignored this child entirely.
const LAST_MONTH = '2026-09-02T03:00:00Z';
function entry(code, xp, diamonds = 50, flags = {}) {
  return { code: 'R2L-' + code, account: { student_profile: { student_name: code }, ...flags }, state: { total_xp: xp, diamonds, avatar: { monster: { body: 'body-1' }, private: 'private-secret' },
    learning_receipts: [{ source: 'story:old', kind: 'story_questions', at: LAST_MONTH, diamonds: 10 }] } };
}
test('ranks ALL students all-time: XP from total_xp, diamonds from balance; ties share rank; own row survives the limit', () => {
  const rows = [entry('B', 300, 10), entry('A', 300, 40), entry('C', 200, 40), entry('D', 100, 5)];
  const result = buildLearningBoards(rows, { now, ownCode: 'R2L-D', limit: 2 });
  assert.equal(result.version, 'r2l-ranks-v2');
  assert.deepEqual(result.boards.xp.leaders.map(r => [r.display_name, r.rank, r.total]), [['A', 1, 300], ['B', 1, 300]]);
  assert.equal(result.boards.xp.own.rank, 4); assert.equal(result.boards.xp.participants, 4);
  assert.deepEqual(buildLearningBoards(rows, { now }).boards.xp.leaders.map(r => r.rank), [1, 1, 3, 4]);
  assert.deepEqual(buildLearningBoards(rows, { now }).boards.diamonds.leaders.map(r => [r.display_name, r.rank]), [['A', 1], ['C', 1], ['B', 3], ['D', 4]]);
  const text = JSON.stringify(result); assert.doesNotMatch(text, /R2L-|private-secret|masked_code|access_code/);
});
test('KNOWN-BAD under the retired weekly board: a student whose only activity was last month still appears (no week window, no start date)', () => {
  const result = buildLearningBoards([entry('OLD', 500, 80)], { now, ownCode: 'R2L-OLD' });
  assert.deepEqual(result.boards.xp.leaders.map(r => [r.display_name, r.rank, r.total]), [['OLD', 1, 500]]);
  assert.deepEqual(result.boards.diamonds.leaders.map(r => r.total), [80]);
  assert.equal('active' in result, false); assert.equal('week' in result, false); assert.equal('starts_at' in result, false);
});
test('both boards and own position exclude bots, tests, shared, demo, disabled, expired, invalid and nameless records', () => {
  const flags = [{ is_bot: true }, { is_test: true }, { is_shared: true }, { is_demo: true }, { active: false }, { disabled: true }, { status: 'deactivated' }, { revoked_at: now }, { expires_at: 'bad' }, { expires_at: '2026-10-01T00:00:00Z' }, { student_profile: {} }];
  for (const flag of flags) {
    const row = entry('EXCLUDED', 999, 999, flag);
    assert.equal(starsEligible(row.account, row.state, now), false);
    const result = buildLearningBoards([row, entry('GOOD', 1, 1)], { now, ownCode: row.code });
    for (const board of Object.values(result.boards)) { assert.equal(board.leaders.length, 1); assert.equal(board.own, null); }
  }
  assert.equal(buildLearningBoards([{ ...entry('BAD', 1), code: 'config:fake' }], { now }).boards.xp.leaders.length, 0);
});
test('children with zero of a metric are absent from that board but keep an unranked own row', () => {
  const rows = [entry('NEW', 0, 0), entry('XPONLY', 40, 0), entry('A', 10, 10)];
  const result = buildLearningBoards(rows, { now, ownCode: 'R2L-NEW' });
  assert.deepEqual(result.boards.xp.leaders.map(r => r.display_name), ['XPONLY', 'A']);
  assert.deepEqual(result.boards.diamonds.leaders.map(r => r.display_name), ['A']);
  assert.equal(result.boards.xp.own.rank, null); assert.equal(result.boards.xp.own.total, 0);
  assert.doesNotMatch(JSON.stringify(result), /prize|reward|wallet/);
});
const T0 = new Date(now);
function fixture(extra = []) {
  resetLearningBoardsCache();
  const code = 'R2L-REAL-STARS', other = 'R2L-OTHER-STARS';
  const records = new Map([[code, { student_profile: { student_name: 'An', level: 'L0' } }], [other, { student_profile: { student_name: 'Binh' } }],
    ['progress:' + code, { schema_version: 2, level_reset_version: 20260606, current_level: 'L0', diamonds: 70, total_xp: 120 }],
    ['progress:' + other, { schema_version: 2, level_reset_version: 20260606, current_level: 'L0', diamonds: 30, total_xp: 400 }],
    ['leaderboard-cache', { updated_at: now, leaders: [{ display_name: 'Cached bot', total: 999999 }] }]]);
  for (const [name, account, progress] of extra) { records.set(name, account); records.set('progress:' + name, progress); }
  const counts = { list: 0, progressGets: 0 };
  const kv = { async list() { counts.list++; await Promise.resolve(); return { keys: [...records.keys()].map(name => ({ name })) }; }, async get(key, options) { if (key.startsWith('progress:')) counts.progressGets++; const value = records.get(key); return value === undefined ? null : options?.type === 'json' ? value : JSON.stringify(value); }, async put(key, value) { records.set(key, JSON.parse(value)); } };
  const call = (at = T0, query = '?code=' + code) => learningStarsResponse({ request: new Request('https://fixture.test/api/read2lead-leaderboard' + query), env: { READ2LEAD_CODES: kv }, now: at });
  return { records, kv, call, code, counts };
}
test('real endpoint serves both all-time boards with no config key, ignores stale bot cache, and rechecks eligibility', async () => {
  const f = fixture(); f.records.set('R2L-POISON', { get progress() { throw Error('poison'); } });
  const response = await f.call(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const result = await response.json(); assert.equal(result.version, 'r2l-ranks-v2');
  assert.deepEqual(result.boards.xp.leaders.map(r => [r.display_name, r.rank, r.total]), [['Binh', 1, 400], ['An', 2, 120]]);
  assert.deepEqual(result.boards.diamonds.leaders.map(r => [r.display_name, r.rank, r.total]), [['An', 1, 70], ['Binh', 2, 30]]);
  assert.equal(result.boards.xp.own.rank, 2); assert.equal(result.boards.xp.own.is_self, true);
  f.records.get(f.code).is_bot = true;
  const changed = await (await f.call(new Date(T0.getTime() + 61_000))).json(); assert.deepEqual(changed.boards.xp.leaders.map(r => r.display_name), ['Binh']); assert.equal(changed.boards.xp.own, null);
  assert.equal(f.records.get('leaderboard-cache').leaders[0].display_name, 'Cached bot', 'historical cache left intact but never read');
});
test('storage outage returns retryable error instead of false empty success', async () => {
  const f = fixture(); f.kv.list = async () => { throw Error('offline'); };
  const response = await f.call(); assert.equal(response.status, 503); assert.equal((await response.json()).error, 'leaderboard_compute_failed');
});
test('failed account storage read is not reported as an empty board', async () => {
  const f = fixture(), get = f.kv.get;
  f.kv.get = async (key, options) => { if (key.startsWith('progress:')) throw Error('storage offline'); return get(key, options); };
  assert.equal((await f.call()).status, 503);
});

const later = ms => new Date(T0.getTime() + ms);
const many = n => Array.from({ length: n }, (_, i) => [`R2L-KID-${String(i).padStart(3, '0')}`, { student_profile: { student_name: 'Kid' + i } }, { schema_version: 2, level_reset_version: 20260606, current_level: 'L0', diamonds: 5, total_xp: 500 + i }]);
test('(a) two calls within 60s trigger exactly ONE scan', async () => {
  const f = fixture();
  assert.equal((await f.call(later(0))).status, 200); const afterFirst = { ...f.counts };
  assert.equal(afterFirst.list, 1);
  assert.equal((await f.call(later(59_000))).status, 200);
  assert.deepEqual(f.counts, afterFirst, 'second call within the window touched no list/progress reads');
});
test('(b) a call after 60s rescans', async () => {
  const f = fixture(); await f.call(later(0)); await f.call(later(60_000));
  assert.equal(f.counts.list, 2);
});
test('(c) concurrent calls share one scan', async () => {
  const f = fixture();
  const responses = await Promise.all([f.call(later(0)), f.call(later(1)), f.call(later(2)), f.call(later(3))]);
  assert.deepEqual(responses.map(r => r.status), [200, 200, 200, 200]);
  assert.equal(f.counts.list, 1);
});
test('(d) own row is correct for a child outside the top N, served from cache; caller never sees codes', async () => {
  const f = fixture(many(60));
  const first = await (await f.call(later(0), '?limit=3&code=' + f.code)).json();
  const listAfterFirst = f.counts.list;
  const cached = await (await f.call(later(5_000), '?limit=3&code=' + f.code)).json();
  assert.equal(f.counts.list, listAfterFirst, 'served from cache');
  assert.equal(cached.boards.xp.leaders.length, 3);
  assert.equal(cached.boards.xp.own.rank, 62); assert.equal(cached.boards.xp.own.is_self, true); assert.equal(cached.boards.xp.own.display_name, 'An');
  assert.deepEqual(cached, first);
  const other = await (await f.call(later(6_000), '?limit=3&code=R2L-KID-000')).json();
  assert.equal(other.boards.xp.own.rank, 60); assert.equal(other.boards.xp.leaders.some(r => r.is_self), false);
  assert.equal(f.counts.list, listAfterFirst);
  assert.doesNotMatch(JSON.stringify(cached), /R2L-/);
  const anon = await (await f.call(later(7_000), '?limit=3')).json(); assert.equal(anon.boards.xp.own, null);
});
test('failed recompute serves the stale cache; with no cache it is the friendly 503', async () => {
  const f = fixture(); await f.call(later(0));
  f.kv.list = async () => { throw Error('offline'); };
  const stale = await f.call(later(61_000)); assert.equal(stale.status, 200);
  assert.equal((await stale.json()).boards.xp.leaders[0].display_name, 'Binh');
  const none = fixture(); none.kv.list = async () => { throw Error('offline'); };
  const failed = await none.call(later(0)); assert.equal(failed.status, 503); assert.equal((await failed.json()).error, 'leaderboard_compute_failed');
});
