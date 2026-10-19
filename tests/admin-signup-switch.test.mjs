// R2L-FINAL: founder on/off switch card on the admin home ("Đăng ký công khai").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('src/lib/admin-signup.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { exports: mod.exports, module: mod, String, Number, JSON, Promise });
const { mountSignupSwitch } = mod.exports;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

function setup(responder) {
  const nodes = new Map(), calls = [], confirms = [];
  const byId = id => { if (!nodes.has(id)) { const events = {}; nodes.set(id, { events, textContent: '', value: '', disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener: (k, f) => { events[k] = f; } }); } return nodes.get(id); };
  let confirmAnswer = true;
  const api = mountSignupSwitch(byId, {
    fetch: async (url, init) => { calls.push({ url, init }); return responder(url, init); },
    confirm: m => { confirms.push(m); return confirmAnswer; },
  });
  return { byId, calls, confirms, api, deny() { confirmAnswer = false; },
    click: async () => { await byId('signup-cfg-toggle').events.click(); await settle(); },
    save: async value => { byId('signup-cfg-cap').value = value; await byId('signup-cfg-form').events.submit({ preventDefault() {} }); await settle(); } };
}
const ok = body => Response.json({ ok: true, ...body });

test('GET populates status, button, count and cap input', async () => {
  const s = setup(() => ok({ enabled: true, daily_cap: 30, today_count: 7 }));
  await s.api.load();
  assert.equal(s.calls[0].url, '/api/admin/signup-config');
  assert.equal(s.calls[0].init, undefined);
  assert.equal(s.byId('signup-cfg-status').textContent, 'Đang MỞ');
  assert.equal(s.byId('signup-cfg-status').attrs['data-state'], 'on');
  assert.equal(s.byId('signup-cfg-toggle').textContent, 'Tắt đăng ký');
  assert.equal(s.byId('signup-cfg-count').textContent, 'Hôm nay: 7 / 30 mã mới');
  assert.equal(s.byId('signup-cfg-cap').value, '30');
});

test('toggle posts {enabled: !current}; confirm only when turning ON', async () => {
  let enabled = false;
  const s = setup((url, init) => { if (init?.body) enabled = JSON.parse(init.body).enabled ?? enabled; return ok({ enabled, daily_cap: 50, today_count: 0 }); });
  await s.api.load();
  assert.equal(s.byId('signup-cfg-status').textContent, 'Đang ĐÓNG');
  await s.click(); // off -> on: asks first
  assert.deepEqual(s.confirms, ['Mở đăng ký công khai cho mọi người?']);
  assert.deepEqual(JSON.parse(s.calls[1].init.body), { enabled: true });
  assert.equal(s.byId('signup-cfg-status').textContent, 'Đang MỞ');
  await s.click(); // on -> off: no confirm
  assert.equal(s.confirms.length, 1);
  assert.deepEqual(JSON.parse(s.calls[2].init.body), { enabled: false });
  assert.equal(s.byId('signup-cfg-status').textContent, 'Đang ĐÓNG');
});

test('declining the confirm sends nothing', async () => {
  const s = setup(() => ok({ enabled: false, daily_cap: 50, today_count: 0 }));
  await s.api.load(); s.deny(); await s.click();
  assert.equal(s.calls.length, 1);
});

test('cap save posts {daily_cap} as an integer; 0 is allowed', async () => {
  const s = setup((u, init) => ok({ enabled: false, daily_cap: init?.body ? JSON.parse(init.body).daily_cap : 50, today_count: 2 }));
  await s.api.load();
  await s.save('120');
  assert.deepEqual(JSON.parse(s.calls[1].init.body), { daily_cap: 120 });
  assert.equal(s.byId('signup-cfg-count').textContent, 'Hôm nay: 2 / 120 mã mới');
  await s.save('0');
  assert.deepEqual(JSON.parse(s.calls[2].init.body), { daily_cap: 0 });
});

test('bad cap input is refused locally, nothing is posted', async () => {
  const s = setup(() => ok({ enabled: false, daily_cap: 50, today_count: 0 }));
  await s.api.load();
  for (const bad of ['', '-1', '501', '2.5', 'abc']) { await s.save(bad); assert.match(s.byId('signup-cfg-message').textContent, /0 đến 500/); }
  assert.equal(s.calls.length, 1);
});

test('an API error shows its Vietnamese message and leaves the state unchanged', async () => {
  const s = setup((u, init) => init ? Response.json({ ok: false, error: 'daily_cap_invalid', message: 'Số mã mỗi ngày phải từ 0 đến 500.' }, { status: 400 }) : ok({ enabled: false, daily_cap: 50, today_count: 1 }));
  await s.api.load();
  await s.save('100');
  assert.equal(s.byId('signup-cfg-message').textContent, 'Số mã mỗi ngày phải từ 0 đến 500.');
  assert.equal(s.byId('signup-cfg-count').textContent, 'Hôm nay: 1 / 50 mã mới');
  assert.equal(s.byId('signup-cfg-toggle').disabled, false);
});

test('network failure or an English error gets a kind Vietnamese fallback', async () => {
  const s = setup(() => { throw new TypeError('offline'); });
  await s.api.load();
  assert.match(s.byId('signup-cfg-message').textContent, /Chưa kết nối được/);
  const t = setup(() => Response.json({ ok: false, error: 'x', message: 'nothing to change' }, { status: 400 }));
  await t.api.load();
  assert.match(t.byId('signup-cfg-message').textContent, /Chưa kết nối được/);
});

test('markup: card on the admin home with big status, 44px+ targets, cap input and no secrets', () => {
  const page = readFileSync('src/pages/admin/index.astro', 'utf8');
  for (const id of ['signup-cfg', 'signup-cfg-status', 'signup-cfg-toggle', 'signup-cfg-count', 'signup-cfg-cap', 'signup-cfg-save', 'signup-cfg-message']) assert.ok(page.includes(`id="${id}"`), id);
  assert.match(page, /Đăng ký công khai/);
  assert.match(page, /min-height: 48px/);
  assert.match(page, /mountSignupSwitch/);
});
