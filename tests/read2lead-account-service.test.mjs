import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService, matchAccountRoute } from '../functions/lib/read2lead/account-service.mjs';
import { ACCOUNT_ROUTES } from '../functions/lib/read2lead/account-routes.mjs';

const CODE = 'R2L-SYNTHETIC-ACCOUNT-A', PASSWORD = 'synthetic-admin-only', TOKEN = 'a'.repeat(32);
const PART = 'png-default-detail-blue-horn-small', GIFT = 'config:gifts:v1', QUEUE = 'admin:gift-redemptions:v1';
function fixture({ adminPassword = PASSWORD, progressInCodes = false } = {}) {
  const db = new DatabaseSync(':memory:'); let originalBindingCalls = 0;
  const forbidden = { async get() { originalBindingCalls++; throw Error('old KV must not be reached'); }, async put() { originalBindingCalls++; throw Error('old KV must not be reached'); } };
  const transaction = work => { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const service = createRead2LeadAccountService({ db, transaction, progressInCodes, infrastructure: {
    ADMIN_PASSWORD: adminPassword, READ2LEAD_CODES: forbidden, READ2LEAD_PROGRESS: forbidden,
    AI: { run() { throw Error('provider must not be called'); } },
  } });
  const put = (ns, key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL)').run(ns, key, JSON.stringify(value));
  const get = (ns, key) => JSON.parse(db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(ns, key).value);
  const progressNS = progressInCodes ? 'codes' : 'progress';
  put('codes', CODE, { is_test: false, uses_remaining: 5, student_profile: { student_name: 'Synthetic Reader', age: 8, child_gender: 'boy', level: 'L1' },
    progress: { current_level: 'L1', current_pack: null, review_history: [], packs_created: 0 } });
  put(progressNS, 'progress:' + CODE, { schema_version: 2, level_reset_version: 20260606, current_level: 'L1', initial_level: 'L1', rank_points: 0, diamonds: 2000, total_xp: 0, redemptions: [], unlocked_parts: [] });
  put('codes', GIFT, { schema_version: 1, gifts: [{ id: 'sticker', name_vi: 'Sticker', emoji: 'x', price_diamonds: 1000, limit_total: 1, redeemed_count: 0, cost_vnd: 5000, active: true }] });
  put('codes', QUEUE, { entries: [] });
  put('codes', 'r2l_link:' + TOKEN, { access_code: CODE, expires_at: '2099-01-01', revoked: false, uses: 0, max_uses: 10 });
  const snapshot = () => db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(row => ({ ...row }));
  return { db, service, get, snapshot, progress: () => get(progressNS, 'progress:' + CODE), originalCalls: () => originalBindingCalls };
}
const basic = password => 'Basic ' + btoa('founder:' + password);
function request(route, { method, body, password, headers = {} } = {}) {
  return new Request('https://synthetic.test' + route, { method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...headers, ...(password === undefined ? {} : { Authorization: basic(password) }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

for (const progressInCodes of [false, true]) test(`routed child purchase + authenticated founder refund retain both changes (shared namespace=${progressInCodes})`, async () => {
  const f = fixture({ progressInCodes });
  try {
    const redeem = await f.service(request('/api/read2lead-gifts-redeem', { body: { code: CODE, gift_id: 'sticker' } }));
    assert.equal(redeem.status, 200); const id = (await redeem.json()).redemption.id;
    const [refund, bought] = await Promise.all([
      f.service(request('/api/admin/gifts/redemptions/' + id, { method: 'PATCH', password: PASSWORD, body: { status: 'rejected' } })),
      f.service(request('/api/read2lead-shop-buy', { body: { code: CODE, part_id: PART } })),
    ]);
    assert.equal(refund.status, 200); assert.equal(bought.status, 200);
    assert.equal(f.progress().diamonds, 2000); (assert.ok(f.progress().avatar.monster.detail === PART));
    assert.equal(f.progress().redemptions[0].status, 'rejected'); assert.equal(f.get('codes', GIFT).gifts[0].redeemed_count, 0);
    assert.equal(f.get('codes', QUEUE).entries[0].status, 'rejected');
    const again = await f.service(request('/api/admin/gifts/redemptions/' + id, { method: 'PATCH', password: PASSWORD, body: { status: 'rejected' } }));
    assert.equal(again.status, 200); assert.equal(f.progress().diamonds, 2000); assert.equal(f.originalCalls(), 0);
  } finally { f.db.close(); }
});

test('original admin password/config gate applies before any refund or account-route details', async () => {
  for (const adminPassword of [PASSWORD, undefined]) {
    // Explicit undefined is tested by passing an empty configured password.
    const f = fixture({ adminPassword: adminPassword || '' });
    try {
      const before = f.snapshot();
      for (const route of ['/api/admin/gifts/redemptions/missing', '/api/admin/codes', '/api/admin/not-a-route']) {
        for (const password of [undefined, 'wrong']) {
          const response = await f.service(request(route, { password }));
          assert.equal(response.status, adminPassword ? 401 : 503);
          if (adminPassword) assert.match(response.headers.get('WWW-Authenticate'), /Basic/);
          assert.deepEqual(f.snapshot(), before); assert.equal(f.originalCalls(), 0);
        }
      }
    } finally { f.db.close(); }
  }
});

test('ordinary home link, progress and admin list use the same saved account', async () => {
  const f = fixture();
  try {
    const home = await f.service(request('/api/r2l-link?token=' + TOKEN));
    assert.equal(home.status, 200); assert.equal((await home.json()).access_code, CODE);
    const progress = await f.service(request('/api/read2lead-progress?code=' + CODE));
    assert.equal(progress.status, 200); const payload = await progress.json();
    assert.equal(payload.ok, true); assert.ok(JSON.stringify(payload).includes('Synthetic Reader'));
    const list = await f.service(request('/api/admin/codes', { password: PASSWORD }));
    assert.equal(list.status, 200); assert.ok(JSON.stringify(await list.json()).includes(CODE));
    assert.equal(f.originalCalls(), 0);
  } finally { f.db.close(); }
});

test('static route wins, invalid encoded parameters fail, and wrong methods cannot reach a handler', async () => {
  assert.equal(matchAccountRoute('/api/admin/codes/reset-levels').route.pattern, '/api/admin/codes/reset-levels');
  assert.equal(matchAccountRoute('/api/admin/codes/clear-open-lessons').route.pattern, '/api/admin/codes/clear-open-lessons');
  assert.equal(matchAccountRoute('/api/admin/codes/R2L%2DSYNTHETIC%2DACCOUNT%2DA').params.code, CODE);
  const f = fixture();
  try {
    const before = f.snapshot();
    const wrong = await f.service(request('/api/admin/codes/reset-levels', { method: 'PATCH', password: PASSWORD, body: {} }));
    assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('Allow'), 'POST');
    for (const value of ['A%2FB', 'A%5CB', '%00', '%ZZ']) {
      const invalid = await f.service(request('/api/admin/codes/' + value, { method: 'PATCH', password: PASSWORD, body: {} }));
      assert.equal(invalid.status, 400);
    }
    assert.equal((await f.service(request('/api/unknown-account-writer', { body: {} }))).status, 404);
    assert.deepEqual(f.snapshot(), before); assert.equal(f.originalCalls(), 0);
  } finally { f.db.close(); }
});

test('every explicitly pending route refuses before storage/provider access; retired reward writer stays removed', async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    for (const route of ACCOUNT_ROUTES.filter(row => row.state === 'pending')) {
      const url = route.pattern.replace(/\[[a-z_]+\]/g, 'synthetic');
      const method = route.methods[0] === '*' ? 'POST' : route.methods[0];
      const response = await f.service(request(url, { method, password: PASSWORD, ...(method === 'GET' ? {} : { body: {} }) }));
      assert.equal(response.status, 503, url); assert.equal((await response.json()).error, 'account_route_not_integrated');
    }
    const retired = await f.service(request('/api/read2lead-progress-update', { body: { access_code: CODE, pack_id: 'forged', rewards_earned: { diamonds: 2000000 } } }));
    assert.equal(retired.status, 410); assert.deepEqual(f.snapshot(), before); assert.equal(f.originalCalls(), 0);
  } finally { f.db.close(); }
});

test('HEAD preserves original read route status/headers without a response body', async () => {
  const f = fixture();
  try {
    const response = await f.service(request('/api/read2lead-progress?code=' + CODE, { method: 'HEAD' }));
    assert.equal(response.status, 200); assert.equal(await response.text(), ''); assert.match(response.headers.get('Content-Type'), /json/);
  } finally { f.db.close(); }
});

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function files(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
function dependencies(file, visited = new Set()) {
  if (visited.has(file)) return visited;
  visited.add(file);
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    if (!match[1].startsWith('.')) continue;
    const next = path.resolve(path.dirname(file), match[1]);
    if (fs.existsSync(next) && /\.(?:js|mjs|ts)$/.test(next)) dependencies(next, visited);
  }
  return visited;
}
test('route matrix covers every existing transitive account-storage entry point and validates admitted exports', () => {
  const declared = new Map(ACCOUNT_ROUTES.map(row => [row.file, row]));
  assert.equal(declared.size, ACCOUNT_ROUTES.length);
  assert.equal(new Set(ACCOUNT_ROUTES.map(row => row.pattern)).size, ACCOUNT_ROUTES.length);
  let count = 0;
  for (const file of files(path.join(repo, 'functions/api')).filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+onRequest(\w*)\s*\(/g)].map(m => m[1].toUpperCase() || '*');
    if (!methods.length) continue;
    const deps = [...dependencies(file)];
    if (!deps.some(dep => /\bREAD2LEAD_(?:CODES|PROGRESS)\b/.test(fs.readFileSync(dep, 'utf8')))) continue;
    count++;
    const relative = path.relative(repo, file), row = declared.get(relative);
    assert.ok(row, 'unclassified account entry point: ' + relative);
    assert.deepEqual([...row.methods].sort(), methods.sort(), relative);
    if (row.state === 'transactional') {
      const externalRead = row.execution === 'external-read';
      if (externalRead) assert.ok(['/api/signup', '/api/admin/classes/[id]/homework-extract',
        '/api/admin/classes/[id]/homework-photo-extract'].includes(row.pattern), 'unreviewed external route');
      for (const dep of deps) {
        const code = fs.readFileSync(dep, 'utf8');
        assert.doesNotMatch(code, /\bwaitUntil\b/, 'background dependency needs integration: ' + dep);
        if (!externalRead) assert.doesNotMatch(code, /\b(?:AI|ai)\.run\s*\(/, 'AI dependency needs integration: ' + dep);
        const guardedAssignment = row.execution === 'catalogue-only' && row.pattern === '/api/generate-read2lead-pack'
          && dep === path.join(repo, 'functions/api/generate-read2lead-pack.js');
        if (!guardedAssignment && !externalRead) assert.doesNotMatch(code, /\bfetch\s*\(/, 'external dependency needs explicit integration: ' + dep);
      }
      for (const method of row.methods) assert.equal(typeof row.handlers['onRequest' + method[0] + method.slice(1).toLowerCase()], 'function', relative);
    } else assert.ok(row.reason.length > 30);
  }
  // Standalone context/practice logging and the two bot-injection endpoints no longer touch account storage.
  assert.ok(count >= 61, 'source scan must not silently stop finding known routes');
  for (const pattern of ['/api/minny-conversation', '/api/minny-practice-log', '/api/minny-speaking-context']) {
    assert.equal(ACCOUNT_ROUTES.find(row => row.pattern === pattern)?.state, 'retired', pattern);
  }
});
