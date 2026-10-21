// Bite tests (rule 28) for LAYOUT-ONLY contracts of scripts/design/fidelity.mjs (R2L-MAINT-1 D4): a screen with no design mock is checked for
// order, texts, no_overlap, contained, horizontal scroll, reduced motion and contrast, at every width the contract lists.
// Each check is fed a known-BAD page and must fail the NAMED check with the specific message; the matching known-GOOD page must pass it.
// The headline fixture reproduces the R3 live defect (step 3 "Kể qua tranh"): a reader root with a FIXED height whose content spills under the
// help box and the credits that follow it. Fixed height must FAIL no_overlap and contained; the same page with an auto-height root must PASS.
// Reuse survey: nothing external fits (these test our own harness fields); the page-serving pattern follows design-fidelity-r3.test.mjs.
// No Chrome: FAILS loudly locally, skips only when CI is set (same as design-fidelity.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runFidelity, findChrome, InfraError, validateContract } from '../scripts/design/fidelity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOTO = path.join(root, 'scripts', 'design', 'drivers', 'goto-path.mjs');

let chromeMissing = null;
try { findChrome(); } catch (e) { chromeMissing = e; }
const skipNoChrome = t => {
  if (!chromeMissing) return false;
  if (process.env.CI) { t.skip('no Chrome binary found and CI is set: ' + chromeMissing.message); return true; }
  throw chromeMissing;
};

const li = n => Array.from({ length: n }, (_, i) => `<li style="height:40px;margin:0">Ý ${i + 1}</li>`).join('');
// board 200px + five 40px rows = 400px of content; the help box and the credits FOLLOW the root in the DOM, like the real reader's.
const page = (rootStyle, extra = '', body = '') => `<!doctype html><html lang="vi"><meta charset="utf-8"><body style="margin:0;background:#fff;font:18px sans-serif;color:#17324D">
<main id="root" style="${rootStyle}"><section id="board" style="height:200px;background:#ffe8a8">Bảng tranh</section><ul id="rows" style="margin:0;padding:0;list-style:none">${li(5)}</ul>${body}</main>
<details id="help" style="height:60px;background:#dff"><summary>Truyện này hơi khó</summary></details><footer id="credits" style="height:48px">Bản quyền</footer>${extra}</body></html>`;
const PAGES = {
  // the R3 defect: fixed-height root, content spills under #help and #credits
  defect: page('height:300px;display:block'),
  // the fix: the root grows with its content
  fixed: page('height:auto'),
  // a root that clips (overflow:hidden) is NOT overlapping, but its content is cut off: only `contained` sees it
  clipped: page('height:300px;overflow:hidden'),
  // two siblings sharing exactly one edge do not overlap; a 2px strip of shared area does
  touching: `<!doctype html><body style="margin:0;font:18px sans-serif"><div id="a" style="height:100px;width:200px">A one</div><div id="b" style="height:100px;width:200px">B two</div></body>`,
  strip: `<!doctype html><body style="margin:0;font:18px sans-serif"><div id="a" style="height:100px;width:200px">A one</div><div id="b" style="height:100px;width:200px;margin-top:-2px;position:relative">B two</div></body>`,
  hscroll: `<!doctype html><body style="margin:0;font:18px sans-serif"><div id="a" style="height:60px;width:1800px">Rộng quá</div></body>`,
  motion: `<!doctype html><body style="margin:0;font:18px sans-serif"><style>@keyframes spin{to{transform:rotate(360deg)}}.s{animation:spin 1s linear infinite;display:inline-block}</style><div id="a" style="height:60px"><span class="s">Xoay</span></div></body>`,
  lowcontrast: `<!doctype html><body style="margin:0;background:#fff;font:18px sans-serif"><div id="a" style="height:60px;color:#c8c8c8">Chữ nhạt quá</div></body>`,
  absent: `<!doctype html><body style="margin:0;font:18px sans-serif"><div id="a" style="height:60px">Có mặt</div></body>`,
  order: `<!doctype html><body style="margin:0;font:18px sans-serif"><div id="b" style="height:60px">Hai</div><div id="a" style="height:60px">Một</div></body>`,
};
const BASE = {
  release: 'maint-1', layout_only: true, widths: [390, 768], built: { path: '/fixed', state: 'bite' },
  locate: { 'l.root': '#root', 'l.board': '#board', 'l.rows': '#rows', 'l.help': '#help', 'l.credits': '#credits', 'l.row1': '#rows li:first-child' },
  locate_wrappers: ['l.root'],
  order: ['l.board', 'l.rows', 'l.credits'], // DOM order (the help box sits between the rows and the credits visually AND in the DOM here)
  texts: ['Bảng tranh', 'Ý 5', 'Bản quyền'],
  no_overlap: [['l.rows', 'l.help', 'l.credits'], ['l.board', 'l.help']],
  contained: ['l.root'],
  founder_wording: 'ignored',
};
const at = (p, extra = {}) => ({ built: { path: '/' + p, state: 'bite' }, ...extra });
const small = (p, locate, extra = {}) => ({ built: { path: '/' + p, state: 'bite' }, locate, order: [], texts: [], no_overlap: undefined, contained: undefined, locate_wrappers: undefined, widths: [390], ...extra });
const CASES = {
  'defect': at('defect'),
  'fixed': at('fixed'),
  'clipped': at('clipped'),
  // the same defect, but the contract names the spilled rows only: no_overlap alone must catch it
  'defect-overlap-only': at('defect', { contained: undefined, order: ['l.board'] }),
  // ... and `contained` alone must catch a clipped box (nothing overlaps)
  'clipped-contained-only': at('clipped', { no_overlap: undefined }),
  'touching': small('touching', { 'l.a': '#a', 'l.b': '#b' }, { order: ['l.a', 'l.b'], texts: ['A one'], no_overlap: [['l.a', 'l.b']] }),
  'strip': small('strip', { 'l.a': '#a', 'l.b': '#b' }, { order: ['l.a', 'l.b'], texts: ['A one'], no_overlap: [['l.a', 'l.b']] }),
  'hscroll': small('hscroll', { 'l.a': '#a' }, { order: ['l.a'], texts: ['Rộng quá'] }),
  'motion': small('motion', { 'l.a': '#a' }, { order: ['l.a'], texts: ['Xoay'] }),
  'lowcontrast': small('lowcontrast', { 'l.a': '#a' }, { order: ['l.a'], texts: ['Chữ nhạt quá'] }),
  'absent-id': small('absent', { 'l.a': '#a', 'l.x': '#not-there' }, { order: ['l.a'], texts: ['Có mặt'], no_overlap: [['l.a', 'l.x']] }),
  'absent-optional': small('absent', { 'l.a': '#a', 'l.x': '#not-there' }, { order: ['l.a'], texts: ['Có mặt'], no_overlap: [['l.a', 'l.x']], optional: { 'l.x': 'this state may not show it' } }),
  'absent-contained': small('absent', { 'l.a': '#a', 'l.x': '#not-there' }, { order: ['l.a'], texts: ['Có mặt'], contained: ['l.x'] }),
  'wrong-order': small('order', { 'l.a': '#a', 'l.b': '#b' }, { order: ['l.a', 'l.b'], texts: ['Một'] }),
  'missing-text': at('fixed', { texts: ['Bảng tranh', 'Câu này không có trên trang'] }),
  // wrapper rule: without locate_wrappers the root (an ancestor of the other located ids) is refused by `locate`
  'wrapper-unlisted': at('fixed', { locate_wrappers: undefined }),
  // per-width heights and `widths` are honoured: only the listed width runs
  'one-width': at('fixed', { widths: [360] }),
};

function startServer() {
  const server = http.createServer((req, res) => {
    const body = PAGES[req.url.split('?')[0].slice(1)];
    if (!body) { res.writeHead(404).end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}
const writeAll = (dir, contracts) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, c] of Object.entries(contracts)) fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ ...BASE, ...c, id }));
};

test('layout-only contracts: known-good pass, known-bad fail the NAMED check with the specific message', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-layout-only-'));
  const { server, base } = await startServer();
  try {
    const contracts = path.join(tmp, 'contracts');
    writeAll(contracts, CASES);
    const report = await runFidelity({ design: tmp, contracts, base, out: path.join(tmp, 'out'), composites: 'fail', 'state-driver': GOTO, concurrency: 6 });
    const rows = id => report.results.filter(r => r.contract === id);
    const c = (id, name, w = 390) => { const r = rows(id).find(x => x.width === w); assert.ok(r, `${id}@${w}: no result`); const x = r.checks.find(k => k.name === name); assert.ok(x, `${id}@${w}: no "${name}" check ran (have ${r.checks.map(k => k.name).join(', ')})`); return x; };

    await t.test('the R3 defect page (fixed-height root, content spills under the help box and credits) FAILS no_overlap AND contained, naming both', () => {
      assert.equal(c('defect', 'no-overlap').pass, false);
      assert.match(c('defect', 'no-overlap').detail, /no_overlap: "l\.rows" \(y 200-400\) overlaps "l\.help" \(y 300-360\) by 390x60px/);
      assert.match(c('defect', 'no-overlap').detail, /no_overlap: "l\.rows" \(y 200-400\) overlaps "l\.credits"/);
      assert.equal(c('defect', 'contained').pass, false);
      assert.match(c('defect', 'contained').detail, /contained "l\.root": content is 400px tall in a 300px box \(overflows by 100px\)/);
    });
    await t.test('the same page with an auto-height root PASSES every check', () => {
      for (const w of [390, 768]) for (const r of rows('fixed').filter(x => x.width === w)) assert.deepEqual(r.checks.filter(k => !k.pass), [], `fixed@${w}`);
      assert.match(c('fixed', 'no-overlap').detail, /2 group\(s\), \d+ box pairs\/boxes checked, no shared area/);
      assert.match(c('fixed', 'contained').detail, /1 box\(es\) hold their content/);
    });
    await t.test('no_overlap alone catches the spill (contained not listed); contained alone catches a clipped box (nothing overlaps)', () => {
      assert.equal(c('defect-overlap-only', 'no-overlap').pass, false);
      assert.ok(!rows('defect-overlap-only')[0].checks.some(k => k.name === 'contained' && !k.pass), 'contained is not listed, so it must pass');
      assert.equal(c('clipped-contained-only', 'contained').pass, false);
      assert.match(c('clipped-contained-only', 'contained').detail, /contained "l\.root": content is 400px tall in a 300px box/);
    });
    await t.test('boxes that only SHARE AN EDGE pass; a 2px strip of shared area fails (1px^2 is the threshold)', () => {
      assert.equal(c('touching', 'no-overlap').pass, true, c('touching', 'no-overlap').detail);
      assert.equal(c('strip', 'no-overlap').pass, false);
      assert.match(c('strip', 'no-overlap').detail, /no_overlap: "l\.a" \(y 0-100\) overlaps "l\.b" \(y 98-198\) by 200x2px/);
    });
    await t.test('horizontal scroll at the contract width FAILS, naming the width', () => {
      assert.equal(c('hscroll', 'no-h-scroll@390').pass, false);
      assert.match(c('hscroll', 'no-h-scroll@390').detail, /content 1800px wide in a 390px viewport/);
      assert.equal(c('fixed', 'no-h-scroll@390').pass, true);
    });
    await t.test('reduced motion: an animation that ignores prefers-reduced-motion FAILS', () => {
      assert.equal(c('motion', 'reduced-motion').pass, false);
      assert.match(c('motion', 'reduced-motion').detail, /spin/);
    });
    await t.test('contrast: light grey text on white FAILS the 4.5:1 sweep; the dark-ink pages pass', () => {
      assert.equal(c('lowcontrast', 'contrast>=4.5').pass, false);
      assert.match(c('lowcontrast', 'contrast>=4.5').detail, /"Chữ nhạt quá" 1\.\d+:1/);
      assert.equal(c('fixed', 'contrast>=4.5').pass, true, c('fixed', 'contrast>=4.5').detail);
    });
    await t.test('an id with no visible element FAILS no_overlap / contained, unless it is declared optional', () => {
      assert.match(c('absent-id', 'no-overlap').detail, /no_overlap "l\.x": no visible element/);
      assert.equal(c('absent-optional', 'no-overlap').pass, true, c('absent-optional', 'no-overlap').detail);
      assert.match(c('absent-contained', 'contained').detail, /contained "l\.x": no visible element/);
    });
    await t.test('order and texts are the same checks as a normal contract (reused)', () => {
      assert.match(c('wrong-order', 'order').detail, /DOM order: l\.b comes before l\.a|vertical order: l\.b/);
      assert.match(c('missing-text', 'texts').detail, /missing VISIBLE text: "Câu này không có trên trang"/);
    });
    await t.test('a wrapper id is refused by `locate` unless the contract declares it in locate_wrappers', () => {
      assert.equal(c('wrapper-unlisted', 'locate').pass, false);
      assert.match(c('wrapper-unlisted', 'locate').detail, /locate "l\.root" \(#root\): is an ancestor of \d+ other located elements/);
      assert.equal(c('fixed', 'locate').pass, true, c('fixed', 'locate').detail);
    });
    await t.test('`widths` decides which widths run (only 360 here) and there is no pixel-diff check at all', () => {
      assert.deepEqual(rows('one-width').map(r => r.width), [360]);
      assert.deepEqual(rows('fixed').map(r => r.width).sort(), [390, 768]);
      for (const r of report.results) assert.ok(!r.checks.some(k => k.name === 'pixel-diff'), 'a layout-only contract has no pixel comparison');
    });
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('layout-only BITE: contracts the harness must REFUSE (infra error, never a pass)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-layout-only-refuse-'));
  try {
    const run = async (contract, id = 'x') => {
      fs.rmSync(path.join(tmp, 'c'), { recursive: true, force: true });
      fs.mkdirSync(path.join(tmp, 'c'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'c', id + '.json'), JSON.stringify({ id, ...contract }));
      return runFidelity({ design: tmp, contracts: path.join(tmp, 'c'), base: 'http://127.0.0.1:1', out: path.join(tmp, 'o'), 'state-driver': GOTO });
    };
    const good = { release: 'maint-1', layout_only: true, built: { path: '/x', state: 'bite' }, locate: { 'l.a': '#a' }, order: ['l.a'] };
    await assert.rejects(run({ ...good, diff_ceiling: { 390: 0.5 } }), e => e instanceof InfraError && /a layout_only contract has no mock, so it may not carry "diff_ceiling"/.test(e.message));
    await assert.rejects(run({ ...good, mock: { 390: 'mocks/m.html' } }), e => e instanceof InfraError && /may not carry "mock"/.test(e.message));
    await assert.rejects(run({ ...good, reference: { 390: 'a.png' }, regions: [] }), e => e instanceof InfraError && /may not carry "reference", "regions"/.test(e.message));
    await assert.rejects(run({ release: 3, built: { path: '/x', state: 'bite' }, order: ['a'], diff_ceiling: { 390: 1 } }), e => e instanceof InfraError && /a normal contract needs a "mock" listing at least one width \(a screen with no mock must say "layout_only": true\)/.test(e.message));
    await assert.rejects(run({ release: 3, mock: { 390: 'm.html' }, viewport: { 390: 700 }, diff_ceiling: { 390: 1 }, no_overlap: [['a', 'b']] }), e => e instanceof InfraError && /"no_overlap" is only checked for "layout_only": true contracts/.test(e.message));
    await assert.rejects(run({ ...good, layout_only: 'yes' }), e => e instanceof InfraError && /layout_only must be true/.test(e.message));
    await assert.rejects(run({ ...good, order: [] }), e => e instanceof InfraError && /checks nothing/.test(e.message));
    await assert.rejects(run({ ...good, no_overlap: [['only-one']] }), e => e instanceof InfraError && /every no_overlap group needs at least 2 ids/.test(e.message));
    await assert.rejects(run({ ...good, no_overlap: 'a,b' }), e => e instanceof InfraError && /no_overlap must be a list of id groups/.test(e.message));
    await assert.rejects(run({ ...good, widths: [390.5] }), e => e instanceof InfraError && /widths must be a non-empty list of integer pixel widths/.test(e.message));
    await assert.rejects(run({ ...good, order_999: ['l.a'] }), e => e instanceof InfraError && /"order_999" is for a width not in "widths"/.test(e.message));
    await assert.rejects(run({ ...good, locate_wrappers: ['l.zzz'] }), e => e instanceof InfraError && /locate_wrappers lists "l\.zzz", which is not a key of "locate"/.test(e.message));
    await assert.rejects(run({ ...good, locate_wrappers: ['l.a'] }), e => e instanceof InfraError && /a locate_wrappers id may not also be in "order"/.test(e.message));
    await assert.rejects(run({ ...good, built: undefined }), e => e instanceof InfraError && /needs built\.state/.test(e.message));
    await assert.rejects(run({ ...good, pending_founder: 'wording' }), e => e instanceof InfraError && /still carries "pending_founder"/.test(e.message));
    assert.doesNotThrow(() => validateContract({ id: 'ok', ...good }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
