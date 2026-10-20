// Bite tests (rule 28) for the Release-3 contract fields of scripts/design/fidelity.mjs:
//   locate, locate_cols, primary.none, sun_also_<w>, mask, never_red, pending_founder (and: founder_wording / unbound / notes are ignored).
// Each field is fed a known-BAD page and must fail the NAMED check with the specific message; a known-GOOD page must pass it.
// Reuse survey: nothing external fits (these test our own harness fields); the page-serving pattern follows design-fidelity.test.mjs.
// No Chrome: FAILS loudly locally, skips only when CI is set (same as design-fidelity.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runFidelity, findChrome, InfraError } from '../scripts/design/fidelity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOTO = path.join(root, 'scripts', 'design', 'drivers', 'goto-path.mjs');

let chromeMissing = null;
try { findChrome(); } catch (e) { chromeMissing = e; }
const skipNoChrome = t => {
  if (!chromeMissing) return false;
  if (process.env.CI) { t.skip('no Chrome binary found and CI is set: ' + chromeMissing.message); return true; }
  throw chromeMissing;
};

const SUN = '#FFC83D';
const BLOCK = 'display:block;height:80px;margin:0;';
// #a / .bb carry NO data-design: the contract's `locate` must find them.
function html(extra = '', box = '#2a9d4a') {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><body style="margin:0;background:#fff;font:18px sans-serif;color:#17324D">
<div id="a" style="${BLOCK}">Xin chào</div><div class="bb" style="${BLOCK}">Đọc truyện</div>
<div id="swatch" style="position:absolute;left:10px;top:400px;width:100px;height:50px;background:${box}"></div>${extra}</body></html>`;
}
const sunA = (attrs = '', text = 'Mở') => `<a href="#" role="button" ${attrs} style="display:block;height:64px;line-height:64px;background:${SUN};text-align:center">${text}</a>`;
const inCard = inner => html(`<section id="card" style="padding:8px">${inner}</section>`);
const PAGES = {
  ok: html(),
  dup: html(`<div class="bb" style="${BLOCK}">Đọc truyện 2</div>`),
  hidden: html('<div id="gone" style="display:none">x</div>'),
  cols2: html('<div style="display:flex"><div class="col" style="flex:1;height:40px">a</div><div class="col" style="flex:1;height:40px">b</div></div>'),
  'sun-none': html(sunA('', 'Mở')),
  'no-sun': html('<button type="button" style="height:56px;background:#fff">Chọn</button>'),
  'sun-also-ok': html(sunA('data-design="t.p"') + `<a href="#home-code" data-design="t.j" style="display:block;height:56px;background:${SUN}">Nhập mã</a>`),
  'sun-also-button': html(sunA('data-design="t.p"') + `<button type="button" data-design="t.j" style="display:block;height:56px;width:100%;background:${SUN}">Nhập mã</button>`),
  'sun-also-offpage': html(sunA('data-design="t.p"') + `<a href="/other" data-design="t.j" style="display:block;height:56px;background:${SUN}">Nhập mã</a>`),
  'sun-extra-unlisted': html(sunA('data-design="t.p"') + `<a href="#x" style="display:block;height:56px;background:${SUN}">Nhập mã</a>`),
  'mask-diff': html('', '#d33'),
  'red-text': inCard('<p style="margin:0;color:#FF7A3D">Sai rồi</p>'),
  'red-bg': inCard('<div style="height:40px;background:#E0362C">Sai rồi</div>'),
  'red-border': inCard('<div style="height:40px;border:3px solid #FF7A3D">Sai rồi</div>'),
  'red-in-image': inCard('<svg width="60" height="60"><circle cx="30" cy="30" r="28" fill="#E0362C" stroke="#FF7A3D" stroke-width="4"/></svg><p style="margin:0;color:#17324D">Minny</p>'),
  'red-clean': inCard('<p style="margin:0;color:#17324D;border:2px solid #17324D">Gần đúng rồi</p>'),
  low: html('<div style="height:900px"></div><div data-design="t.low" style="height:60px;width:200px">x</div>'),
  'details-closed': html('<details><summary style="height:48px">Chi tiết</summary><div style="border:2px solid #17324D;width:120px;padding:4px"><button style="width:300px;height:48px;font-family:inherit">Nút tràn</button></div></details>'),
  'details-open': html('<details open><summary style="height:48px">Chi tiết</summary><div style="border:2px solid #17324D;width:120px;padding:4px"><button style="width:300px;height:48px;font-family:inherit">Nút tràn</button></div></details>'),
  'sun-nested': html(`<a href="#x" data-design="t.j" style="display:block;background:${SUN};height:60px"><button type="button" style="background:${SUN};height:40px">Con</button></a>`),
  wrap: html('<main id="w"><div class="x1" style="height:30px">1</div><div class="x2" style="height:30px">2</div><div class="x3" style="height:30px">3</div></main>'),
  'red-before': inCard('<style>#card .b::before{content:"";display:block;width:12px;height:12px;background:#FF7A3D}</style><div class="b" style="height:30px">x</div>'),
  'red-after-text': inCard('<style>#card .a::after{content:"!";color:#E0362C}</style><div class="a">x</div>'),
  'red-shadow': inCard('<div style="height:30px;box-shadow:0 0 0 3px #FF7A3D">x</div>'),
  'red-outline': inCard('<div style="height:30px;outline:2px solid #E0362C">x</div>'),
  'red-textfill': inCard('<p style="margin:0;color:#17324D;-webkit-text-fill-color:#FF7A3D">x</p>'),
  'red-decoration': inCard('<p style="margin:0;color:#17324D;text-decoration:underline;text-decoration-color:#E0362C">x</p>'),
  contents: html('<section style="display:contents;overflow:auto"><p style="margin:0">Chữ hiện ra</p></section>'),
  clipzero: html('<div style="width:0;height:0;overflow:hidden"><p style="margin:0">Chữ bị cắt</p></div>'),
  overlap: html('<div id="ov" style="position:relative;height:0"><p style="position:absolute;top:-150px;left:16px;margin:0">Chồng chữ</p></div>'),
  'ts-script': html('<div data-design="t.ts" style="height:70px;width:300px">x</div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async></script>'),
  'ts-iframe': html('<div data-design="t.ts" style="height:70px;width:300px"><iframe style="width:300px;height:65px;border:0"></iframe></div>'),
  'ts-empty': html('<div data-design="t.ts" style="height:70px;width:300px">x</div>'),
};

const BASE = {
  release: 3, mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 }, capture: 'viewport',
  built: { path: '/ok', state: 'bite' },
  order: ['t.a', 't.b'], texts: [],
  locate: { 't.a': '#a', 't.b': '.bb' },
  diff_ceiling: { 390: 1 },
  // ignored by the harness (must not break a run)
  founder_wording: 'approved by Phương 2026-10-20', unbound: { 'Về nhà': 'protected' }, notes: 'ignored',
};
const at = p => ({ built: { path: '/' + p, state: 'bite' } });
const PRIMARY = { id: 't.p', text: 'Mở', min_height: { 390: 64 } };
const CASES = {
  'locate-good': {},
  'locate-missing': { locate: { 't.a': '#does-not-exist', 't.b': '.bb' } },
  'locate-dup': at('dup'),
  'locate-invisible': { locate: { 't.a': '#a', 't.b': '#gone' }, ...at('hidden') },
  'locate-unneeded-id-may-be-absent': { locate: { 't.a': '#a', 't.b': '.bb', 'x.unused': '#nope' } },
  'locate-feeds-min-size': { min_size: { 't.a': [500, 500] } },
  'locate-feeds-region': { regions: [{ id: 't.a', mock_box: { 390: [0, 0, 390, 80] }, ceiling: 1, min_own_pixels: 0 }] },
  'locate-region-missing-selector': { locate: { 't.a': '#a', 't.b': '.bb', 'r.x': '#nope' }, regions: [{ id: 'r.x', mock_box: { 390: [0, 0, 390, 80] }, ceiling: 1, min_own_pixels: 0 }] },
  'cols-good': { locate_cols: { 390: ['.col'] }, layout: { 390: { columns: 2 } }, ...at('cols2') },
  'cols-wrong': { locate_cols: { 390: ['.col'] }, layout: { 390: { columns: 3 } }, ...at('cols2') },
  'primary-none-good': { primary: { none: true, note: 'x' }, ...at('no-sun') },
  'primary-none-bad': { primary: { none: true }, ...at('sun-none') },
  'sun-also-good': { primary: PRIMARY, sun_also_390: ['t.j'], ...at('sun-also-ok') },
  'sun-also-button': { primary: PRIMARY, sun_also_390: ['t.j'], ...at('sun-also-button') },
  'sun-also-offpage': { primary: PRIMARY, sun_also_390: ['t.j'], ...at('sun-also-offpage') },
  'sun-also-unlisted': { primary: PRIMARY, ...at('sun-extra-unlisted') },
  'mask-covers-diff': { mask: { 390: [[10, 400, 100, 50]] }, diff_ceiling: { 390: 0 }, ...at('mask-diff') },
  'mask-absent-diff-fails': { diff_ceiling: { 390: 0 }, ...at('mask-diff') },
  'never-red-missing-id': { never_red: ['n.nothing'] },
  'fold-unlisted': { order: ['t.a', 't.b', 't.low'], ...at('low') },
  'fold-listed': { order: ['t.a', 't.b', 't.low'], allow_below_fold: ['t.low'], ...at('low') },
  'sun-also-nested-button': { primary: { none: true }, sun_also_390: ['t.j'], ...at('sun-nested') },
  'locate-body': { locate: { 't.a': 'body', 't.b': '.bb' } },
  'locate-wrapper': { order: ['t.a', 't.b', 't.c', 't.d'], locate: { 't.a': '#w', 't.b': '.x1', 't.c': '.x2', 't.d': '.x3' }, ...at('wrap') },
  'text-in-display-contents': { texts: ['Chữ hiện ra'], ...at('contents') },
  'text-in-zero-clip': { texts: ['Chữ bị cắt'], ...at('clipzero') },
  'overlap-unlisted': at('overlap'),
  'overlap-listed': { overflow_allow: ['#ov'], ...at('overlap') },
  'layout-details-closed': at('details-closed'),
  'layout-details-open': at('details-open'),
  'ts-script-ok': { turnstile: 't.ts', ...at('ts-script') },
  'ts-iframe-ok': { turnstile: 't.ts', ...at('ts-iframe') },
  'ts-empty-bad': { turnstile: 't.ts', ...at('ts-empty') },
  'ts-missing-container': { turnstile: 't.ts', ...at('ok') },
};
for (const k of ['red-text', 'red-bg', 'red-border', 'red-in-image', 'red-clean', 'red-before', 'red-after-text', 'red-shadow', 'red-outline', 'red-textfill', 'red-decoration']) {
  CASES['never-' + k] = { locate: { 't.a': '#a', 't.b': '.bb', 'n.card': '#card' }, never_red: ['n.card'], ...at(k) };
}

function startServer() {
  const server = http.createServer((req, res) => {
    const body = PAGES[req.url.split('?')[0].slice(1)];
    if (!body) { res.writeHead(404).end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}
const writeAll = (dir, contracts) => { fs.mkdirSync(dir, { recursive: true }); for (const [id, c] of Object.entries(contracts)) fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ ...BASE, ...c, id })); };
function writeDesign(tmp) {
  const design = path.join(tmp, 'design');
  fs.mkdirSync(path.join(design, 'mocks'), { recursive: true });
  fs.writeFileSync(path.join(design, 'mocks', 'm.html'), PAGES.ok);
  return design;
}

test('R3 fields: known-good pass, known-bad fail the NAMED check with the specific message', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-r3-'));
  const { server, base } = await startServer();
  try {
    const contracts = path.join(tmp, 'contracts');
    writeAll(contracts, CASES);
    const report = await runFidelity({ design: writeDesign(tmp), contracts, base, out: path.join(tmp, 'out'), composites: 'fail', 'state-driver': GOTO, concurrency: 6 });
    const c = (id, name) => { const x = report.results.find(r => r.contract === id).checks.find(k => k.name === name); assert.ok(x, `${id}: no "${name}" check ran`); return x; };

    await t.test('locate: ids resolve by selector (no data-design in the page), and feed order', () => {
      assert.equal(c('locate-good', 'locate').pass, true);
      assert.match(c('locate-good', 'locate').detail, /2 ids resolved/);
      assert.equal(c('locate-good', 'order').pass, true);
    });
    await t.test('locate BITE: a selector pointing at a missing id fails (0 matches)', () => {
      assert.equal(c('locate-missing', 'locate').pass, false);
      assert.match(c('locate-missing', 'locate').detail, /locate "t\.a" \(#does-not-exist\): 0 visible matches, need exactly 1/);
      assert.equal(c('locate-missing', 'order').pass, false);
    });
    await t.test('locate BITE: a selector matching 2 visible elements fails', () => {
      assert.match(c('locate-dup', 'locate').detail, /locate "t\.b" \(\.bb\): 2 visible matches, need exactly 1/);
    });
    await t.test('locate BITE: a selector matching only a hidden element fails', () => {
      assert.match(c('locate-invisible', 'locate').detail, /locate "t\.b" \(#gone\): 0 visible matches \(1 in the DOM\)/);
    });
    await t.test('locate: an id the contract does not need may be absent', () => {
      assert.equal(c('locate-unneeded-id-may-be-absent', 'locate').pass, true);
    });
    await t.test('locate feeds min_size and regions (they see the located element)', () => {
      assert.match(c('locate-feeds-min-size', 'order').detail, /too small: t\.a is \d+x80px \(min 500x500/);
      assert.equal(c('locate-feeds-region', 'region:t.a').pass, true);
      assert.equal(c('locate-region-missing-selector', 'locate').pass, false);
      assert.match(c('locate-region-missing-selector', 'region:r.x').detail, /no visible built element/);
    });
    await t.test('locate_cols: counted as layout columns; a wrong count fails', () => {
      assert.equal(c('cols-good', 'columns').pass, true);
      assert.equal(c('cols-wrong', 'columns').pass, false);
      assert.match(c('cols-wrong', 'columns').detail, /expected 3, found 2/);
    });
    await t.test('primary.none: a page with no sun control passes; BITE: a page with one sun button fails', () => {
      assert.equal(c('primary-none-good', 'primary').pass, true, c('primary-none-good', 'primary').detail);
      assert.equal(c('primary-none-bad', 'primary').pass, false);
      assert.match(c('primary-none-bad', 'primary').detail, /primary\.none: expected NO sun-filled clickable control in this state, found 1: "Mở"/);
    });
    await t.test('sun_also: an in-page anchor is allowed; BITE: a sun <button> or an off-page link listed there fails; an unlisted second sun still fails', () => {
      assert.equal(c('sun-also-good', 'primary').pass, true, c('sun-also-good', 'primary').detail);
      assert.match(c('sun-also-button', 'primary').detail, /sun_also "t\.j" is not an in-page anchor \(a\[href\^="#"\]\): <button>/);
      assert.match(c('sun-also-offpage', 'primary').detail, /sun_also "t\.j" is not an in-page anchor.*<a href="\/other">/);
      assert.match(c('sun-also-unlisted', 'primary').detail, /exactly 1 sun-filled clickable control, found 2/);
    });
    await t.test('mask: a difference inside the box is ignored by the pixel diff; BITE: the same difference without the mask fails', () => {
      assert.equal(c('mask-covers-diff', 'pixel-diff').pass, true, c('mask-covers-diff', 'pixel-diff').detail);
      assert.equal(c('mask-absent-diff-fails', 'pixel-diff').pass, false);
    });
    await t.test('never_red: coral/red text, background or border FAILS; red inside an svg image and clean text pass', () => {
      assert.match(c('never-red-text', 'never-red').detail, /never_red "n\.card": p "Sai rồi" uses text colour #FF7A3D/);
      assert.match(c('never-red-bg', 'never-red').detail, /uses background #E0362C/);
      assert.match(c('never-red-border', 'never-red').detail, /uses border #FF7A3D/);
      assert.equal(c('never-red-in-image', 'never-red').pass, true, c('never-red-in-image', 'never-red').detail);
      assert.equal(c('never-red-clean', 'never-red').pass, true, c('never-red-clean', 'never-red').detail);
      assert.match(c('never-red-missing-id', 'never-red').detail, /never_red "n\.nothing": no visible element/);
    });
    await t.test('allow_below_fold: a listed id may sit below the fold; BITE: the same id unlisted still fails "pushed below the fold"', () => {
      assert.match(c('fold-unlisted', 'order').detail, /pushed below the fold: t\.low/);
      assert.equal(c('fold-listed', 'order').pass, true, c('fold-listed', 'order').detail);
    });
    await t.test('layout-sanity skips the body of a CLOSED <details>; BITE: the same overflowing control in an OPEN one still fails', () => {
      assert.equal(c('layout-details-closed', 'layout-sanity').pass, true, c('layout-details-closed', 'layout-sanity').detail);
      assert.match(c('layout-details-open', 'layout-sanity').detail, /escape button/);
    });
    await t.test('never_red also reads ::before/::after, box-shadow, outline, text-fill and text-decoration colours (one case each)', () => {
      const table = { 'red-before': /::before uses background #FF7A3D/, 'red-after-text': /::after uses text colour #E0362C/, 'red-shadow': /uses box-shadow #FF7A3D/, 'red-outline': /uses outline #E0362C/, 'red-textfill': /uses text fill #FF7A3D/, 'red-decoration': /uses text decoration #E0362C/ };
      for (const [k, re] of Object.entries(table)) assert.match(c('never-' + k, 'never-red').detail, re, k);
    });
    await t.test('W1 a sun control NESTED in a sun_also anchor still fails primary.none; W2 locate refuses body and a catch-all wrapper', () => {
      assert.match(c('sun-also-nested-button', 'primary').detail, /primary\.none: expected NO sun-filled clickable control in this state, found 1: "Con"/);
      assert.match(c('locate-body', 'locate').detail, /locate "t\.a" \(body\): resolves to <body>, the whole page/);
      assert.match(c('locate-wrapper', 'locate').detail, /locate "t\.a" \(#w\): is an ancestor of 3 other located elements/);
    });
    await t.test('text inside a display:contents box with overflow set is visible (it has no box to clip); BITE: text in a real zero-size overflow box is still hidden', () => {
      assert.equal(c('text-in-display-contents', 'texts').pass, true, c('text-in-display-contents', 'texts').detail);
      assert.match(c('text-in-zero-clip', 'texts').detail, /missing VISIBLE text: "Chữ bị cắt"/);
    });
    await t.test('overflow_allow also covers the text-overlap check; BITE: the same overlap NOT listed still fails', () => {
      assert.match(c('overlap-unlisted', 'layout-sanity').detail, /overlap .*Chồng chữ/);
      assert.equal(c('overlap-listed', 'layout-sanity').pass, true, c('overlap-listed', 'layout-sanity').detail);
    });
    await t.test('turnstile: container + script tag (offline) or iframe passes; BITE: a missing container, or one with neither, fails', () => {
      assert.equal(c('ts-script-ok', 'turnstile').pass, true, c('ts-script-ok', 'turnstile').detail);
      assert.equal(c('ts-iframe-ok', 'turnstile').pass, true, c('ts-iframe-ok', 'turnstile').detail);
      assert.match(c('ts-missing-container', 'turnstile').detail, /no element with data-design="t\.ts" \(the widget container is missing\)/);
      assert.match(c('ts-empty-bad', 'turnstile').detail, /holds no iframe and the Turnstile api script tag is not in the page/);
    });
    await t.test('founder_wording / unbound / notes are ignored (the good contract runs with them present)', () => {
      assert.equal(c('locate-good', 'order').pass, true);
    });
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('R3 mask BITE: a mask over 5% of the capture is an infrastructure error, not a verdict', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-r3-mask-'));
  const { server, base } = await startServer();
  try {
    const contracts = path.join(tmp, 'contracts');
    writeAll(contracts, { 'mask-too-big': { mask: { 390: [[0, 0, 390, 300]] } } }); // 43% of 390x700
    await assert.rejects(runFidelity({ design: writeDesign(tmp), contracts, base, out: path.join(tmp, 'out'), 'state-driver': GOTO }), e => e instanceof InfraError && /mask covers 4\d\.\d% of the capture \(max 5%\)/.test(e.message));
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('R3 BITE: a contract still carrying pending_founder is refused (infra error); malformed R3 fields are refused', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-r3-pending-'));
  try {
    const run = async extra => {
      fs.rmSync(path.join(tmp, 'c'), { recursive: true, force: true });
      writeAll(path.join(tmp, 'c'), { x: extra });
      return runFidelity({ design: tmp, contracts: path.join(tmp, 'c'), base: 'http://127.0.0.1:1', out: path.join(tmp, 'o'), 'state-driver': GOTO });
    };
    await assert.rejects(run({ pending_founder: 'wording X', if_founder_declines: 'Y' }), e => e instanceof InfraError && /still carries "pending_founder"/.test(e.message));
    await assert.rejects(run({ allow_below_fold: 'story.primary' }), e => e instanceof InfraError && /allow_below_fold must be a list of non-empty strings/.test(e.message));
    await assert.rejects(run({ sun_also_1280: ['a'] }), e => e instanceof InfraError && /"sun_also_1280" is for a width with no mock/.test(e.message));
    await assert.rejects(run({ mask: { 390: [[1, 2, 3]] } }), e => e instanceof InfraError && /mask\.390 must be a list of \[x, y, w, h\]/.test(e.message));
    await assert.rejects(run({ locate: { 'a.b': '' } }), e => e instanceof InfraError && /locate\.a\.b must be a CSS selector/.test(e.message));
    await assert.rejects(run({ locate_cols: { 1280: ['.x'] } }), e => e instanceof InfraError && /locate_cols\.1280" is for a width with no mock/.test(e.message));
    await assert.rejects(run({ primary: { none: true, id: 'x' } }), e => e instanceof InfraError && /primary\.none cannot also name/.test(e.message));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
