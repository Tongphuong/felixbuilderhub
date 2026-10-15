import test from 'node:test';
import assert from 'node:assert/strict';
import { fenceLegacyAccountBindings } from '../functions/lib/read2lead/account-legacy-fence.mjs';
import { onRequestGet as progress } from '../functions/api/read2lead-progress.js';
import { onRequestPost as resetLevels } from '../functions/api/admin/codes/reset-levels.js';

const CODE = 'R2L-FENCE-TEST-A';
const OTHER = 'R2L-FENCE-TEST-B';
const fenced = /legacy_account_fenced/;
function storage(entries = []) {
  const data = new Map(entries), calls = [];
  const kv = {
    async get(key, options) {
      assert.equal(this, kv); calls.push(['get', key, options]);
      if (Array.isArray(key)) return new Map(await Promise.all(key.map(async k => [k, await kv.get(k, options)])));
      const value = data.get(key) ?? null;
      return options?.type === 'json' && value !== null ? JSON.parse(value) : value;
    },
    async getWithMetadata(key, options) {
      assert.equal(this, kv); calls.push(['getWithMetadata', key, options]);
      if (Array.isArray(key)) return new Map(key.map(k => [k, { value: data.get(k) ?? null, metadata: { kept: true } }]));
      return { value: data.get(key) ?? null, metadata: { kept: true }, cacheStatus: null };
    },
    async put(key, value, options) { assert.equal(this, kv); calls.push(['put', key, value, options]); data.set(key, value); },
    async delete(key) { assert.equal(this, kv); calls.push(['delete', key]); data.delete(key); },
    async list(options) {
      assert.equal(this, kv); calls.push(['list', options]);
      return { keys: [...data.keys()].filter(k => !options?.prefix || k.startsWith(options.prefix)).map(name => ({ name, metadata: { kept: true } })), list_complete: true, cursor: '' };
    },
    unsafeRawMethod() { throw Error('must not be exposed'); },
  };
  return { kv, data, calls };
}
const inventory = () => ({ codes: [CODE], progress: ['progress:' + CODE] });
function setup(mode = 'fallback') {
  const codeStore = storage([[CODE, '{"secret":"synthetic"}'], ['progress:' + CODE, '{"diamonds":2000}'], ['public:key', 'value']]);
  const progressStore = mode === 'separate' ? storage([['progress:' + CODE, '{"diamonds":2000}'], ['public:progress', 'p']]) : codeStore;
  const env = { READ2LEAD_CODES: codeStore.kv, AI: { marker: 'preserved' }, ...(mode === 'fallback' ? {} : { READ2LEAD_PROGRESS: progressStore.kv }) };
  return { codeStore, progressStore, env: fenceLegacyAccountBindings(env, inventory()) };
}

for (const mode of ['fallback', 'alias', 'separate']) test(`protected operations cannot reach old storage (${mode})`, async () => {
  const f = setup(mode);
  const before = [...f.codeStore.data];
  for (const [kv, key, raw] of [[f.env.READ2LEAD_CODES, CODE, f.codeStore], [f.env.READ2LEAD_PROGRESS || f.env.READ2LEAD_CODES, 'progress:' + CODE, f.progressStore]]) {
    for (const attempt of [() => kv.get(key), () => kv.getWithMetadata(key), () => kv.put(key, 'replaced'), () => kv.delete(key), () => kv.get(['public:key', key]), () => kv.getWithMetadata(['public:key', key])]) {
      const calls = raw.calls.length;
      await assert.rejects(attempt, fenced);
      assert.equal(raw.calls.length, calls, 'protected call reached raw binding');
    }
    await assert.rejects(() => kv.list(), fenced);
  }
  assert.deepEqual([...f.codeStore.data], before);
  assert.equal(f.env.AI.marker, 'preserved');
  if (mode === 'alias') assert.equal(f.env.READ2LEAD_CODES, f.env.READ2LEAD_PROGRESS);
  if (mode === 'fallback') assert.equal(f.env.READ2LEAD_PROGRESS, undefined);
});

test('unprotected values/options/receiver/metadata and pagination are preserved', async () => {
  const f = setup(); const kv = f.env.READ2LEAD_CODES;
  const options = { expirationTtl: 60, metadata: { hello: 'world' } };
  await kv.put('public:new', 'new', options);
  assert.equal(f.codeStore.calls.at(-1)[3], options);
  assert.equal(await kv.get('public:new'), 'new');
  assert.deepEqual(await kv.getWithMetadata('public:new'), { value: 'new', metadata: { kept: true }, cacheStatus: null });
  assert.deepEqual(await kv.get(['public:new', 'missing']), new Map([['public:new', 'new'], ['missing', null]]));
  const page = await kv.list({ prefix: 'public:' });
  assert.deepEqual(page, { keys: [{ name: 'public:key', metadata: { kept: true } }, { name: 'public:new', metadata: { kept: true } }], list_complete: true, cursor: '' });
  await kv.delete('public:new'); assert.equal(await kv.get('public:new'), null);
  assert.equal(kv.unsafeRawMethod, undefined); assert.equal(Object.getPrototypeOf(kv), null);
  assert.equal(Object.isFrozen(kv), true); assert.equal(Object.isFrozen(f.env), true);
});

test('protected inventory is copied and captured methods stay fenced after caller mutation', async () => {
  const raw = storage(); const owned = inventory();
  const env = fenceLegacyAccountBindings({ READ2LEAD_CODES: raw.kv }, owned);
  const savedPut = env.READ2LEAD_CODES.put;
  owned.codes.length = 0; owned.progress.length = 0;
  await assert.rejects(() => savedPut(CODE, 'stale background save'), fenced);
  await assert.rejects(() => savedPut('progress:' + CODE, 'stale progress'), fenced);
  assert.equal(raw.calls.length, 0);
});

test('separate namespaces do not fence unrelated same-name keys', async () => {
  const f = setup('separate');
  await f.env.READ2LEAD_PROGRESS.put(CODE, 'different namespace');
  await f.env.READ2LEAD_CODES.put('progress:' + CODE, 'not in this inventory namespace');
  assert.equal(f.progressStore.data.get(CODE), 'different namespace');
});

test('invalid inventory cannot silently disable protection', () => {
  const raw = storage();
  for (const bad of [null, {}, { codes: [], progress: [] }, { codes: [''], progress: [] }, { codes: ['x'], progress: [], extra: true }, { codes: ['\ud800'], progress: [] }, { codes: ['x'.repeat(513)], progress: [] }])
    assert.throws(() => fenceLegacyAccountBindings({ READ2LEAD_CODES: raw.kv }, bad), /invalid_legacy_account_fence/);
  assert.throws(() => fenceLegacyAccountBindings({}, inventory()), /invalid_legacy_account_fence/);
});

test('bulk reads copy keys before native async work; invalid coercible key never leaks', async () => {
  const raw = storage([['safe', 'ok']]); let resume;
  raw.kv.get = async keys => { await new Promise(r => { resume = r; }); return [...keys]; };
  const env = fenceLegacyAccountBindings({ READ2LEAD_CODES: raw.kv }, inventory());
  const keys = ['safe']; const pending = env.READ2LEAD_CODES.get(keys); keys[0] = CODE; resume();
  assert.deepEqual(await pending, ['safe']);
  await assert.rejects(() => env.READ2LEAD_CODES.get({ toString: () => CODE }), /invalid_legacy_account_fence/);
});

test('original progress handler cannot read or reconcile the protected account on either origin', async () => {
  const f = setup(); const before = [...f.codeStore.data];
  for (const origin of ['https://example.test', 'https://example.pages.dev']) {
    await assert.rejects(() => progress({ env: f.env, request: new Request(origin + '/api/read2lead-progress?code=' + CODE) }), fenced);
  }
  assert.deepEqual([...f.codeStore.data], before);
  assert.equal(f.codeStore.calls.some(call => call[1] === CODE), false);
});

test('original bulk teacher reset is refused before exposing a page containing the protected account', async () => {
  const f = setup(); const before = [...f.codeStore.data];
  await assert.rejects(() => resetLevels({ env: f.env }), fenced);
  assert.deepEqual([...f.codeStore.data], before);
  assert.deepEqual(f.codeStore.calls.map(call => call[0]), ['list']);
});

test('original bulk teacher reset still works on an unprotected account-only page', async () => {
  const raw = storage([[OTHER, JSON.stringify({ uses_remaining: 7, student_profile: { level: 'L2' }, progress: {} })]]);
  const env = fenceLegacyAccountBindings({ READ2LEAD_CODES: raw.kv }, inventory());
  const result = await resetLevels({ env });
  assert.equal(result.status, 200); assert.equal((await result.json()).reset, 1);
  assert.equal(JSON.parse(raw.data.get(OTHER)).student_profile.level, 'L0');
  assert.ok(raw.data.has('progress:' + OTHER));
});

test('list pagination is preserved and a protected later page is refused', async () => {
  const raw = storage(); const pages = [
    { keys: [], list_complete: false, cursor: 'next' },
    { keys: [{ name: CODE }], list_complete: true, cursor: '' },
  ];
  raw.kv.list = async options => options?.cursor === 'next' ? pages[1] : pages[0];
  const kv = fenceLegacyAccountBindings({ READ2LEAD_CODES: raw.kv }, inventory()).READ2LEAD_CODES;
  const page = await kv.list(); assert.equal(page, pages[0]);
  await assert.rejects(() => kv.list({ cursor: page.cursor }), fenced);
});

test('malformed list pages and invalid write keys fail closed', async () => {
  for (const page of [null, {}, { keys: null }, { keys: [{}] }]) {
    const raw = storage(); raw.kv.list = async () => page;
    const kv = fenceLegacyAccountBindings({ READ2LEAD_CODES: raw.kv }, inventory()).READ2LEAD_CODES;
    await assert.rejects(() => kv.list(), /invalid_legacy_account_fence/);
    await assert.rejects(() => kv.put([CODE], 'bad'), /invalid_legacy_account_fence/);
    assert.equal(raw.calls.length, 0);
  }
});
