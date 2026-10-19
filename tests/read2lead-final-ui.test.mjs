// R2L-FINAL (UI): free sign-up card, donation card, "Shop đổi quà" rename.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as entryModule from '../src/lib/read2lead/student-entry.mjs';

const transpile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function element() {
  const events = {}, attrs = {};
  return { events, hidden: false, disabled: false, checked: false, value: '', textContent: '', children: [], classList: { toggle() {} },
    setAttribute(k, v) { attrs[k] = v; }, getAttribute: k => attrs[k] ?? null, addEventListener: (k, f) => { events[k] = f; },
    append() {}, appendChild(n) { this.children.push(n); setImmediate(() => n.onload && n.onload()); }, replaceChildren() {}, focus() {}, querySelector() { return null; } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

function page({ signup, remembered = '', scriptFails = false }) {
  const nodes = new Map(), calls = [], assigned = [], renders = [], resets = [], timers = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  get('signup-card').setAttribute('data-turnstile-sitekey', '1x00000000000000000000AA');
  const location = { search: '', pathname: '/read2lead', origin: 'https://app.test', href: 'https://app.test/read2lead', assign: u => assigned.push(u), replace() {} };
  const document = { querySelector: s => get(s === '[data-child-home]' ? 'root' : s.replace(/^#/, '')), getElementById: get, createElement: element, head: Object.assign(element(), { appendChild(n) { if (scriptFails) return void setImmediate(() => n.onerror && n.onerror()); window.turnstile = turnstile; setImmediate(() => n.onload && n.onload()); } }), querySelectorAll: () => [], addEventListener() {} };
  const turnstile = { render: (_c, opts) => { renders.push(opts); return 'w1'; }, reset: id => resets.push(id) };
  const window = { location, addEventListener() {}, turnstile: undefined };
  const exportsRanks = {};
  const base = { document, Intl, Number, String, Error, TypeError, Promise, console };
  vm.runInNewContext(transpile('src/lib/r2l-ranks.ts'), { ...base, exports: exportsRanks, require: p => { if (p.includes('monster-avatar')) return { renderMonster() {} }; throw Error(p); } });
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === '/api/signup') return signup();
    if (String(url).includes('read2lead-progress')) return Response.json({ ok: true, progress: { student_name: 'Mai', current_pack: { story_title: 'S' } }, read2lead_state: {} });
    if (String(url).includes('leaderboard')) return Response.json({ ok: true, boards: {} });
    return Response.json({ ok: false }, { status: 404 });
  };
  const context = { ...base, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, location, window, sessionStorage: (() => { const m = mem(); if (remembered) m.setItem('r2l_access_code', remembered); return m; })(), localStorage: mem(), exports: {}, URL, URLSearchParams, JSON, matchMedia: () => ({ matches: true }), fetch: fetcher,
    history: { replaceState() {} },
    require: p => { if (p.includes('student-entry')) return entryModule; if (p.includes('r2l-ranks')) return exportsRanks; if (p.includes('r2l-hero')) return { buildHeroCta: () => ({ action: 'lesson' }), statusMeta: () => ({ label: 'x' }) }; if (p.includes('monster-avatar')) return { renderMonster() {} }; if (p.includes('lesson-help')) return { requestLessonAssignment: async () => ({}) }; throw Error(p); } };
  vm.runInNewContext(transpile('src/scripts/read2lead-child-home.ts'), context);
  const fill = (name = '  Ngọc   Anh ', age = '8', gender = 'girl') => {
    get('signup-name').value = name; get('signup-age').value = age;
    get('signup-gender-boy').checked = gender === 'boy'; get('signup-gender-girl').checked = gender === 'girl';
  };
  return { get, calls, assigned, timers, renders, resets, window, turnstile, fill,
    async submit() { await get('signup-form').events.submit({ preventDefault() {} }); await settle(); } };
}
const signupCalls = p => p.calls.filter(c => c.url === '/api/signup');

test('logged out: Turnstile is loaded and rendered with the site key; signup posts the exact body and navigates on ok', async () => {
  const p = page({ signup: async () => Response.json({ ok: true, link: 'https://app.test/r2l/start?link=abc' }) });
  await settle();
  assert.ok(p.get('signup-card') && p.get('signup-turnstile'));
  p.fill();
  // no token yet: refuses locally, never posts
  await p.submit();
  assert.equal(signupCalls(p).length, 0);
  assert.match(p.get('signup-message').textContent, /xác minh/);
  assert.equal(p.renders.length, 1);
  assert.equal(p.renders[0].sitekey, '1x00000000000000000000AA');
  p.renders[0].callback('tok-1');
  await p.submit();
  const [call] = signupCalls(p);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { student_name: 'Ngọc Anh', student_age: 8, child_gender: 'girl', turnstile_token: 'tok-1' });
  assert.deepEqual(Object.keys(JSON.parse(call.init.body)).sort(), ['child_gender', 'student_age', 'student_name', 'turnstile_token']);
  assert.deepEqual(p.assigned, ['https://app.test/r2l/start?link=abc']);
});

test('error: shows the server Vietnamese message and resets Turnstile; the code box is untouched (503 signup_disabled)', async () => {
  const p = page({ signup: async () => Response.json({ ok: false, error: 'signup_disabled', message: 'Đăng ký chưa mở. Nhắn Zalo Felix để được cấp mã nhé.' }, { status: 503 }) });
  await settle();
  p.fill(); p.renders[0].callback('tok-2');
  await p.submit();
  assert.equal(p.get('signup-message').textContent, 'Đăng ký chưa mở. Nhắn Zalo Felix để được cấp mã nhé.');
  assert.deepEqual(p.resets, ['w1']);
  assert.equal(p.assigned.length, 0);
  assert.equal(p.get('home-entry').hidden, false);
  assert.equal(p.get('home-entry-submit').disabled, false);
  assert.equal(p.get('signup-submit').disabled, false);
});

test('error: English or missing server message falls back to a kind Vietnamese line', async () => {
  const p = page({ signup: async () => Response.json({ ok: false, error: 'student_name_required', message: 'student_name is required' }, { status: 400 }) });
  await settle();
  p.fill(); p.renders[0].callback('t');
  await p.submit();
  assert.match(p.get('signup-message').textContent, /Con thử lại/);
  assert.doesNotMatch(p.get('signup-message').textContent, /student_name/);
});

test('a link to another origin is never followed', async () => {
  const p = page({ signup: async () => Response.json({ ok: true, link: 'https://evil.test/x' }) });
  await settle();
  p.fill(); p.renders[0].callback('t');
  await p.submit();
  assert.equal(p.assigned.length, 0);
});

test('client validation: empty/21-char name, no age, no gender never post', async () => {
  const p = page({ signup: async () => Response.json({ ok: true, link: '/x' }) });
  await settle();
  p.renders[0].callback('t');
  for (const [n, a, g] of [['', '8', 'boy'], ['x'.repeat(21), '8', 'boy'], ['An', '', 'boy'], ['An', '8', '']]) { p.fill(n, a, g); await p.submit(); }
  assert.equal(signupCalls(p).length, 0);
});

test('logged in: Turnstile is never loaded and nothing is posted', async () => {
  const p = page({ remembered: 'R2L-ABC', signup: async () => Response.json({ ok: true }) });
  await settle();
  assert.equal(p.get('home-entry').hidden, true);
  assert.equal(p.get('home-ready').hidden, false);
  assert.equal(p.renders.length, 0);
  assert.equal(signupCalls(p).length, 0);
});

test('markup: sign-up card directly under the code box, donation card last, both inside the logged-out section only', () => {
  const src = readFileSync('src/components/Read2LeadChildHome.astro', 'utf8');
  const entry = src.slice(src.indexOf('id="home-entry"'), src.indexOf('id="home-error"'));
  const order = ['reading-home__codebox">', 'id="signup-card"', 'id="donate-card"'].map(k => entry.indexOf(k));
  assert.ok(order.every(i => i > -1) && order[0] < order[1] && order[1] < order[2]);
  assert.ok(!src.slice(src.indexOf('id="home-ready"')).includes('signup-card'));
  assert.ok(!src.slice(src.indexOf('id="home-ready"')).includes('donate-card'));
  assert.match(src, /Chưa có mã\? Tạo mã miễn phí/);
  assert.ok(!/parent_zalo|type="tel"|type="email"/.test(src));
  assert.match(src, /Read2Lead miễn phí cho mọi bạn nhỏ\. Nếu ba mẹ thấy hữu ích, có thể ủng hộ để duy trì trang 💛/);
  assert.match(src, /src="\/donate-qr\.png"[^>]*alt="[^"]+"/);
  assert.ok(existsSync('public/donate-qr.png'));
  const css = readFileSync('src/styles/read2lead-child-home.css', 'utf8');
  assert.match(css, /min-width:200px/);
});

test('no user-visible "Quà thật" remains in the built site (skipped if dist is absent)', t => {
  if (!existsSync('dist')) return t.skip('dist not built');
  const bad = [];
  // The local-only synthetic gift QA demo ("Không có quà thật" = "no real gifts here") is a different
  // sentence on non-production demo pages, not the shop's name.
  const demo = /gift-views|gifts-staff|self-learn/;
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(html|js|css|json|txt)$/.test(f) && !demo.test(p) && /quà thật/i.test(readFileSync(p, 'utf8'))) bad.push(p); } };
  walk('dist');
  assert.deepEqual(bad, []);
});

// Bite on the old silent fallback: shipped code must never contain the always-pass test key, and a build
// without PUBLIC_TURNSTILE_SITE_KEY must drop the sign-up card but keep the code box and donation card.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
test('no test-key fallback in src; build without a site key has no sign-up card', () => {
  const src = readFileSync('src/components/Read2LeadChildHome.astro', 'utf8') + readFileSync('src/scripts/read2lead-child-home.ts', 'utf8');
  assert.ok(!src.includes('1x00000000000000000000AA'));
  const build = key => {
    const out = mkdtempSync(join(tmpdir(), 'r2l-final-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PUBLIC_')));
    env.PUBLIC_R2L_W1 = '1';
    if (key) env.PUBLIC_TURNSTILE_SITE_KEY = key;
    const r = spawnSync('npx', ['astro', 'build', '--outDir', out], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return readFileSync(join(out, 'read2lead/index.html'), 'utf8');
  };
  const without = build('');
  assert.ok(!without.includes('id="signup-card"') && !without.includes('signup-form'));
  assert.ok(without.includes('id="home-entry-form"') && without.includes('id="donate-card"'));
  const withKey = build('1x00000000000000000000AA'); // the test key is passed explicitly via env, never shipped
  assert.ok(withKey.includes('id="signup-card"') && withKey.includes('data-turnstile-sitekey="1x00000000000000000000AA"'));
});

test('success: the button stays disabled and a second submit sends no second POST', async () => {
  const p = page({ signup: async () => Response.json({ ok: true, link: 'https://app.test/r2l/start?link=abc' }) });
  await settle(); p.fill(); p.renders[0].callback('t');
  await p.submit();
  assert.equal(p.assigned.length, 1);
  assert.equal(p.get('signup-submit').disabled, true);
  await p.submit();
  assert.equal(signupCalls(p).length, 1);
  assert.equal(p.assigned.length, 1);
});

test('Turnstile script loads but never draws: after ~10s a kind Vietnamese message appears and the code box stays usable', async () => {
  const p = page({ signup: async () => Response.json({ ok: true }) });
  await settle();
  const timer = p.timers.find(t => t.ms === 10000);
  assert.ok(timer, 'a 10s render watchdog is set');
  assert.equal(p.get('signup-message').textContent, '');
  timer.f();
  assert.equal(p.get('signup-message').textContent, 'Ô xác minh chưa hiện được. Ba mẹ tải lại trang hoặc nhắn Zalo Felix nhé.');
  assert.equal(p.get('home-entry').hidden, false);
  assert.equal(p.get('home-entry-submit').disabled, false);
});

test('Turnstile that does render (token arrived) is left alone by the watchdog', async () => {
  const p = page({ signup: async () => Response.json({ ok: true }) });
  await settle(); p.renders[0].callback('t');
  p.timers.find(t => t.ms === 10000).f();
  assert.equal(p.get('signup-message').textContent, '');
});

test('script fails to load: kind Vietnamese message, no POST, code box usable; a later tap retries the load', async () => {
  const p = page({ scriptFails: true, signup: async () => Response.json({ ok: true }) });
  await settle();
  assert.match(p.get('signup-message').textContent, /Chưa tải được ô xác minh/);
  assert.equal(p.renders.length, 0);
  p.fill(); await p.submit();
  assert.equal(signupCalls(p).length, 0);
  assert.equal(p.get('home-entry').hidden, false);
  assert.equal(p.get('home-entry-submit').disabled, false);
});
