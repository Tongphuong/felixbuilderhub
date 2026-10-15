import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningBoards, starsEligible, STARS_CONFIG_KEY } from '../functions/lib/read2lead/learning-stars-board.mjs';
import { onRequestGet } from '../functions/api/read2lead-leaderboard.js';
const now = '2026-10-14T03:00:00Z', startsAt = '2026-10-11T17:00:00Z';
function entry(code, count, diamonds = 50, flags = {}) {
  return { code: 'R2L-' + code, account: { student_profile: { student_name: code }, ...flags }, state: { diamonds: 999999, avatar: { monster: { body: 'body-1' }, private: 'private-secret' }, learning_receipts: Array.from({ length: count }, (_, i) => ({ source: 'story:' + i, kind: 'story_questions', at: now, diamonds })) } };
}
test('ties use 1,1,3 and stable names; own row remains available outside visible leaders', () => {
  const rows = [entry('B', 3), entry('A', 3), entry('C', 2), entry('D', 1)];
  const result = buildLearningBoards(rows, { now, startsAt, ownCode: 'R2L-D', limit: 2 });
  assert.deepEqual(result.boards.reading.leaders.map(r => [r.display_name, r.rank]), [['A', 1], ['B', 1]]);
  assert.equal(result.boards.reading.own.rank, 4);
  assert.deepEqual(buildLearningBoards(rows, { now, startsAt }).boards.reading.leaders.map(r => r.rank), [1, 1, 3, 4]);
  const text = JSON.stringify(result); assert.doesNotMatch(text, /R2L-|private-secret|999999|masked_code|access_code/);
});
test('both boards and own position exclude bots, tests, shared, demo, disabled, expired, invalid and nameless records', () => {
  const flags = [{ is_bot: true }, { is_test: true }, { is_shared: true }, { is_demo: true }, { active: false }, { disabled: true }, { status: 'deactivated' }, { revoked_at: now }, { expires_at: 'bad' }, { expires_at: startsAt }, { student_profile: {} }];
  for (const flag of flags) {
    const row = entry('EXCLUDED', 999, 999, flag);
    assert.equal(starsEligible(row.account, row.state, now), false);
    const result = buildLearningBoards([row, entry('GOOD', 1)], { now, startsAt, ownCode: row.code });
    for (const board of Object.values(result.boards)) { assert.equal(board.leaders.length, 1); assert.equal(board.own, null); }
  }
  assert.equal(buildLearningBoards([{ ...entry('BAD', 1), code: 'config:fake' }], { now, startsAt }).boards.reading.leaders.length, 0);
});
test('zero and inactive boards have no filler participants, no prizes and no fabricated rank', () => {
  const rows = [entry('NEW', 0)];
  const active = buildLearningBoards(rows, { now, startsAt, ownCode: 'R2L-NEW' });
  assert.deepEqual(active.boards.reading.leaders, []); assert.equal(active.boards.reading.own.rank, null); assert.equal(active.boards.diamonds.own.total, 0);
  const inactive = buildLearningBoards([entry('A', 5)], { now }); assert.equal(inactive.active, false); assert.deepEqual(inactive.boards.reading.leaders, []);
  assert.doesNotMatch(JSON.stringify(active), /prize|reward|wallet/);
});
function fixture() {
  const date = new Date().toISOString(), code = 'R2L-REAL-STARS';
  const records = new Map([[STARS_CONFIG_KEY, { enabled: true, starts_at: new Date(Date.now() - 1000).toISOString() }], [code, { student_profile: { student_name: 'An', level: 'L0' } }], ['progress:' + code, { schema_version: 2, level_reset_version: 20260606, current_level: 'L0', diamonds: 0, learning_receipts: [{ source: 'story:sky', kind: 'story_questions', at: date, diamonds: 50 }] }], ['leaderboard-cache', { updated_at: date, leaders: [{ display_name: 'Cached bot', total: 999999 }] }]]);
  const kv = { async list() { return { keys: [...records.keys()].map(name => ({ name })) }; }, async get(key, options) { const value = records.get(key); return value === undefined ? null : options?.type === 'json' ? value : JSON.stringify(value); }, async put(key, value) { records.set(key, JSON.parse(value)); } };
  const call = () => onRequestGet({ request: new Request('https://fixture.test/api/read2lead-leaderboard?code=' + code), env: { READ2LEAD_CODES: kv } });
  return { records, kv, call, code };
}
test('real endpoint ignores stale bot cache, keeps L0, uses saved name fallback, and rechecks eligibility', async () => {
  const f = fixture(); f.records.set('R2L-POISON', { get progress() { throw Error('poison'); } });
  f.records.set(f.code, { student_profile: {} }); f.records.get('progress:' + f.code).student_name = 'An';
  const response = await f.call(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const result = await response.json(); assert.equal(result.boards.reading.leaders[0].display_name, 'An'); assert.equal(result.boards.diamonds.own.total, 50);
  f.records.get(f.code).is_bot = true;
  const changed = await (await f.call()).json(); assert.deepEqual(changed.boards.reading.leaders, []); assert.equal(changed.boards.reading.own, null);
  assert.equal(f.records.get('leaderboard-cache').leaders[0].display_name, 'Cached bot', 'historical cache left intact but never read');
});
test('storage outage returns retryable error instead of false empty success', async () => {
  const f = fixture(); f.kv.list = async () => { throw Error('offline'); };
  const response = await f.call(); assert.equal(response.status, 503); assert.equal((await response.json()).error, 'leaderboard_compute_failed');
});

test('failed account storage read is not reported as an empty successful week', async () => {
 const f=fixture(), get=f.kv.get;
 f.kv.get=async (key,options)=>{if(key.startsWith('progress:'))throw Error('storage offline');return get(key,options);};
 assert.equal((await f.call()).status,503);
});
