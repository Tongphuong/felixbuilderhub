import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { onRequestPost as submit } from '../functions/api/submit-read2lead-lesson.js';
import { onRequestPost as buy } from '../functions/api/read2lead-shop-buy.js';
import { onRequestPost as redeem } from '../functions/api/read2lead-gifts-redeem.js';
import { onRequestPatch as refund } from '../functions/api/admin/gifts/redemptions/[id].js';
import { GIFT_STORE_KEY } from '../functions/api/admin/_gifts.js';

const CODE = 'SYNTHETIC-ACCOUNT-A', OTHER = 'SYNTHETIC-ACCOUNT-B';
const PART = 'png-default-detail-blue-horn-small', QUEUE = 'admin:gift-redemptions:v1';
const ok = () => Response.json({ ok: true });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ progressInCodes = false } = {}) {
  const db = new DatabaseSync(':memory:');
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  let now = Date.now();
  const create = () => createAccountTransactionRunner({ db, transaction, now: () => now, progressInCodes });
  const run = create();
  const put = (namespace, key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(namespace, key, JSON.stringify(value));
  const get = (namespace, key) => {
    const row = db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(namespace, key);
    return row ? JSON.parse(row.value) : null;
  };
  const progressNS = progressInCodes ? 'codes' : 'progress';
  for (const code of [CODE, OTHER]) {
    put('codes', code, { is_test: false, uses_remaining: 4,
      student_profile: { student_name: 'Synthetic only', age: 8, level: 'L1', child_gender: 'boy' },
      progress: { current_level: 'L1', packs_created: 1, review_history: [], current_pack: {
        pack_id: 'pack-' + code, schema_version: 2, status: 'awaiting_review',
        story: { title: 'Synthetic lesson', paragraphs_en: ['Once upon a time.'] },
        activities: [
          { type: 'listening_fill_blank', items: [{ blank_word: 'time', sentence: 'Once upon a time.' }] },
          { type: 'listen_and_order', items: [{ tokens: ['Once', 'upon', 'a', 'time'] }] },
          { type: 'reading_comprehension', questions: [{ correct_index: 0, options_en: ['A', 'B', 'C'] }] },
          { type: 'listen_and_speak', items: [{ text_en: 'Once upon a time.' }] },
        ], web_attempts: [],
      } } });
    put(progressNS, 'progress:' + code, { schema_version: 2, level_reset_version: 20260606,
      current_level: 'L1', initial_level: 'L1', rank_points: 0, diamonds: 2000, total_xp: 0, unlocked_parts: [], redemptions: [] });
  }
  put('codes', GIFT_STORE_KEY, { schema_version: 1, gifts: [{ id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000, limit_total: 1, redeemed_count: 0, cost_vnd: 5000, active: true }] });
  put('codes', QUEUE, { entries: [] });
  const snapshot = () => ({ rows: db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(r => ({ ...r })), revision: db.prepare('SELECT revision FROM read2lead_account_revision').get().revision });
  return { db, run, create, put, get, snapshot, progressNS, clock: ms => { now += ms; },
    progress: (code = CODE) => get(progressNS, 'progress:' + code) };
}
function context(env, body, { method = 'POST', id } = {}) {
  return { env, params: { id }, waitUntil() { throw Error('background_work_not_supported_in_test'); },
    request: new Request('https://synthetic.test/api/action', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
const call = (f, handler, body, options) => f.run(env => handler(context(env, body, options)));
const submission = { access_code: CODE, pack_id: 'pack-' + CODE, answers: { activity_results:
  ['listening_fill_blank', 'listen_and_order', 'reading_comprehension', 'listen_and_speak', 'read_aloud'].map(type => ({ type, attempted: true, correct_count: 2, total_count: 2, wrong_count: 0, score_percent: 100 })) } };

for (const progressInCodes of [false, true]) test(`original shop + lesson retain both outcomes and replay once (shared namespace=${progressInCodes})`, async () => {
  const f = fixture({ progressInCodes });
  try {
    const [purchase, lesson] = await Promise.all([call(f, buy, { code: CODE, part_id: PART }), call(f, submit, submission)]);
    const bought = await purchase.json(), learned = await lesson.json();
    assert.equal(purchase.status, 200, JSON.stringify(bought)); assert.equal(lesson.status, 200, JSON.stringify(learned));
    assert.equal(bought.reward.price, 0); assert.equal(learned.passed, true);
    const saved = f.progress();
    assert.equal(saved.diamonds, 2000 + learned.rewards_earned.diamonds);
    (assert.ok(saved.avatar.monster.detail === PART)); assert.ok(saved.completed_pack_ids.includes(submission.pack_id));
    const before = { diamonds: saved.diamonds, xp: saved.total_xp };
    const again = await call(f, submit, submission); assert.equal((await again.json()).already_completed, true);
    assert.deepEqual({ diamonds: f.progress().diamonds, xp: f.progress().total_xp }, before);
  } finally { f.db.close(); }
});

test('known-bad original uncoordinated KV loses an actual shop or lesson update', async t => {
  const f = fixture();
  try {
    const gate = deferred(); let writes = 0;
    const kv = namespace => ({
      async get(key, options) { const row = f.db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(namespace, key); return row ? options?.type === 'json' ? JSON.parse(row.value) : row.value : null; },
      async put(key, value) {
        if (namespace === 'progress' && key === 'progress:' + CODE) { if (++writes === 2) gate.resolve(); await gate.promise; }
        f.db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(namespace, key, value);
      },
    });
    const env = { READ2LEAD_CODES: kv('codes'), READ2LEAD_PROGRESS: kv('progress') };
    const [purchase, lesson] = await Promise.all([buy(context(env, { code: CODE, part_id: PART })), submit(context(env, submission))]);
    assert.equal(purchase.status, 200); assert.equal(lesson.status, 200);
    const result = await lesson.json(), saved = f.progress();
    const preserved = saved.diamonds === 2000 + result.rewards_earned.diamonds && (saved.avatar.monster.detail === PART) && saved.completed_pack_ids.includes(submission.pack_id);
    assert.equal(preserved, false, 'control must detect actual legacy lost update');
    t.diagnostic(JSON.stringify({ expectedDiamonds: 2000 + result.rewards_earned.diamonds, actualDiamonds: saved.diamonds,
      purchaseRetained: (saved.avatar.monster.detail === PART), completionRetained: saved.completed_pack_ids.includes(submission.pack_id) }));
  } finally { f.db.close(); }
});

function failKey(f, namespace, key) {
  f.db.exec('CREATE TEMP TABLE fail_account_write(namespace TEXT,key TEXT);');
  f.db.prepare('INSERT INTO fail_account_write VALUES(?,?)').run(namespace, key);
  f.db.exec(`CREATE TEMP TRIGGER fail_account_row BEFORE INSERT ON read2lead_account_kv
    WHEN EXISTS(SELECT 1 FROM fail_account_write WHERE namespace=NEW.namespace AND key=NEW.key)
    BEGIN SELECT RAISE(ABORT,'injected save failure'); END;`);
}
for (const operation of ['redeem', 'refund']) for (const key of [QUEUE, 'progress:' + CODE, GIFT_STORE_KEY]) {
  test(`${operation} failure at ${key} rolls back every record; retry/replay remains safe`, async () => {
    const f = fixture();
    try {
      let id;
      if (operation === 'refund') {
        const result = await call(f, redeem, { code: CODE, gift_id: 'sticker' });
        assert.equal(result.status, 200); id = (await result.json()).redemption.id;
      }
      const before = f.snapshot(); failKey(f, key.startsWith('progress:') ? 'progress' : 'codes', key);
      const perform = () => operation === 'redeem' ? call(f, redeem, { code: CODE, gift_id: 'sticker' }) : call(f, refund, { status: 'rejected' }, { method: 'PATCH', id });
      const failed = await perform(); assert.equal(failed.status, 503); assert.deepEqual(f.snapshot(), before);
      f.db.exec('DROP TRIGGER fail_account_row');
      const success = await perform(); assert.equal(success.status, 200);
      assert.equal(f.progress().diamonds, operation === 'redeem' ? 1000 : 2000);
      assert.equal(f.get('codes', GIFT_STORE_KEY).gifts[0].redeemed_count, operation === 'redeem' ? 1 : 0);
      assert.equal(f.get('codes', QUEUE).entries.length, 1);
      const balance = f.progress().diamonds;
      const repeated = await perform(); assert.equal(repeated.status, operation === 'redeem' ? 400 : 200);
      assert.equal(f.progress().diamonds, balance); assert.equal(f.progress().redemptions.length, 1);
      assert.equal(f.get('codes', GIFT_STORE_KEY).gifts[0].redeemed_count, operation === 'redeem' ? 1 : 0);
    } finally { f.db.close(); }
  });
}

test('two original accounts cannot spend the same one-gift cap', async () => {
  const f = fixture();
  try {
    const results = await Promise.all([CODE, OTHER].map(code => call(f, redeem, { code, gift_id: 'sticker' })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    assert.equal(f.progress().diamonds + f.progress(OTHER).diamonds, 3000);
    assert.equal(f.get('codes', GIFT_STORE_KEY).gifts[0].redeemed_count, 1); assert.equal(f.get('codes', QUEUE).entries.length, 1);
  } finally { f.db.close(); }
});

test('original refund and shop save together without losing refund, item or cap restoration', async () => {
  const f = fixture();
  try {
    const redemption = await call(f, redeem, { code: CODE, gift_id: 'sticker' });
    const id = (await redemption.json()).redemption.id;
    const results = await Promise.all([call(f, refund, { status: 'rejected' }, { method: 'PATCH', id }), call(f, buy, { code: CODE, part_id: PART })]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal(f.progress().diamonds, 2000); (assert.ok(f.progress().avatar.monster.detail === PART));
    assert.equal(f.progress().redemptions[0].status, 'rejected');
    assert.equal(f.get('codes', GIFT_STORE_KEY).gifts[0].redeemed_count, 0);
  } finally { f.db.close(); }
});

test('separate runner instances reject stale reads/writes and allow explicit fresh retry', async () => {
  const f = fixture(), entered = deferred(), release = deferred(), second = f.create();
  try {
    const stale = f.run(async env => {
      const state = await env.READ2LEAD_PROGRESS.get('progress:' + CODE, 'json'); entered.resolve(); await release.promise;
      await env.READ2LEAD_PROGRESS.put('progress:' + CODE, JSON.stringify({ ...state, diamonds: state.diamonds + 10 })); return ok();
    });
    await entered.promise;
    assert.equal((await second(env => buy(context(env, { code: CODE, part_id: PART })))).status, 200);
    release.resolve(); assert.equal((await stale).status, 409); assert.equal(f.progress().diamonds, 2000);
    const retry = await f.run(async env => {
      const state = await env.READ2LEAD_PROGRESS.get('progress:' + CODE, 'json');
      await env.READ2LEAD_PROGRESS.put('progress:' + CODE, JSON.stringify({ ...state, diamonds: state.diamonds + 10 })); return ok();
    });
    assert.equal(retry.status, 200); assert.equal(f.progress().diamonds, 2010); (assert.ok(f.progress().avatar.monster.detail === PART));
  } finally { f.db.close(); }
});

test('caught 5xx and thrown failures roll back, while intentional 4xx anti-abuse writes persist', async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    for (const throws of [true, false]) {
      const result = await f.run(async env => { await env.READ2LEAD_CODES.put('temporary', 'bad'); if (throws) throw Error('failure'); return new Response('failed', { status: 500 }); });
      assert.ok(result.status >= 500); assert.deepEqual(f.snapshot(), before);
    }
    assert.equal((await f.run(async env => { await env.READ2LEAD_CODES.put('anti-abuse', '1'); return new Response('', { status: 429 }); })).status, 429);
    assert.equal(f.get('codes', 'anti-abuse'), 1);
  } finally { f.db.close(); }
});

test('namespace separation, pending list/delete, pagination, Unicode, metadata and expiry survive reopen', async () => {
  const f = fixture();
  try {
    let cursor;
    const result = await f.run(async env => {
      for (const name of ['a', 'b', '\uE000', '😀']) await env.READ2LEAD_CODES.put('z:' + name, JSON.stringify(name), { metadata: { name } });
      await env.READ2LEAD_CODES.put('z:temporary', '1', { expirationTtl: 2 });
      await env.READ2LEAD_CODES.delete('z:b');
      await env.READ2LEAD_PROGRESS.put('z:a', '999');
      assert.equal(await env.READ2LEAD_CODES.get('z:a', 'json'), 'a');
      assert.equal(await env.READ2LEAD_PROGRESS.get('z:a', 'json'), 999);
      const first = await env.READ2LEAD_CODES.list({ prefix: 'z:', limit: 2 }); cursor = first.cursor;
      assert.deepEqual(first.keys.map(k => k.name), ['z:a', 'z:temporary']); assert.equal(first.list_complete, false);
      assert.deepEqual((await env.READ2LEAD_CODES.getWithMetadata('z:a', 'json')).metadata, { name: 'a' }); return ok();
    });
    assert.equal(result.status, 200); f.clock(3000);
    assert.equal((await f.create()(async env => {
      assert.equal(await env.READ2LEAD_CODES.get('z:temporary'), null);
      const next = await env.READ2LEAD_CODES.list({ prefix: 'z:', cursor, limit: 2 });
      assert.deepEqual(next.keys.map(k => k.name), ['z:\uE000', 'z:😀']); assert.equal(next.list_complete, true); return ok();
    })).status, 200);
  } finally { f.db.close(); }
});

test('retained handles and swallowed invalid storage operations cannot write after commit', async () => {
  const f = fixture(); let captured;
  try {
    assert.equal((await f.run(async env => { captured = env.READ2LEAD_CODES; return ok(); })).status, 200);
    const before = f.snapshot();
    await assert.rejects(captured.put('late', '1'), /closed/); await assert.rejects(captured.get(CODE), /closed/);
    assert.equal((await f.run(async env => {
      await env.READ2LEAD_CODES.put('partial', '1');
      try { await env.READ2LEAD_CODES.put('bad', {}); } catch {}
      return ok();
    })).status, 503);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.db.close(); }
});
