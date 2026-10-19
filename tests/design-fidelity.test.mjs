// Bite tests (rule 28) for the fidelity harness scripts/design/fidelity.mjs.
// A harness that cannot fail looks exactly like a harness with nothing to complain about,
// so every check below is fed a known-BAD page and must flag THAT check by name; known-GOOD
// pages must pass everything (positive controls).
//
// Fast part (default): a synthetic mock + ~50 built-page variants served from a local http server
// in ONE browser launch, plus a second launch for the state-verification driver. Real-design part:
// the real home mock rendered against itself must give a pixel diff of exactly 0.
// Opt-in part (DESIGN_BITE_NAVY=1, scripts/design/bite-navy.sh): TODAY's navy home, served by
// scripts/r2l-release/rehearse.mjs, must FAIL the real home-first-visit contract.
// No Chrome: the test FAILS loudly, except when CI is set (then it skips with an explicit message).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { runFidelity, findChrome, InfraError, effectiveAnchors } from '../scripts/design/fidelity.mjs';
import { sampleBackdrop } from '../scripts/design/lib/text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_DESIGN = path.join(root, '_design', 'read2lead-dao-phieu-luu');
const FONTS_DIR = path.join(REAL_DESIGN, 'design-system', 'fonts');
const GOTO = path.join(root, 'scripts', 'design', 'drivers', 'goto-path.mjs');

let chromeMissing = null;
try { findChrome(); } catch (e) { chromeMissing = e; }
const skipNoChrome = t => {
  if (!chromeMissing) return false;
  if (process.env.CI) { t.skip('no Chrome binary found and CI is set: ' + chromeMissing.message); return true; }
  throw chromeMissing; // locally: FAIL loudly (rule 28b)
};

// ---- synthetic page factory ---------------------------------------------------------
const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
function page(o = {}) {
  const mk = id => (o.marks === false ? '' : ` data-design="${id}"`);
  const fontLink = o.fontsHref ? `<link rel="stylesheet" href="${o.fontsHref}">` : '';
  const top = o.topSmall
    ? `<header style="height:60px;padding:16px"><p${mk('t.top')} style="margin:0;width:150px;height:20px">Xin chào</p></header>`
    : `<header${mk('t.top')} style="height:60px;padding:16px"><p style="margin:0">Xin chào</p></header>`;
  const heroStyle = `height:${o.heroH || 200}px;padding:16px;${o.shift ? 'margin-top:' + o.shift + 'px;' : ''}${o.lowContrast ? 'color:#aaa;background:#fff;' : ''}${o.gradient === 'low' ? 'background:linear-gradient(#fff,#fff);color:#ccc;' : ''}${o.gradient === 'ok' ? 'background:linear-gradient(#17324D,#17324D);color:#fff;' : ''}`;
  const spacer = o.push ? `<div style="height:${o.push}px"></div>` : '';
  const hero = `${spacer}<main${mk('t.hero')} style="${heroStyle}">${o.heroBlank ? '' : o.heroRed ? '<div style="height:150px;background:#d33"></div>' : `<h2 style="margin:0${o.wrongFont ? ';font-family:Arial' : ''}">Đọc truyện nào</h2>`}</main>`;
  const pStyle = `display:block;height:${o.primaryH || 64}px;line-height:${o.primaryH || 64}px;background:#FFC83D;text-align:center`;
  const primary = o.noPrimary ? '' : `<a href="#" role="button"${mk('t.primary')} style="${pStyle}">Mở truyện</a>`
    + (o.dupPrimary ? `<a href="#" role="button"${mk('t.primary')} style="${pStyle}">Mở truyện</a>` : '');
  const footInner = {
    alt: `<img alt="Dành cho ba mẹ" width="1" height="1" src="${IMG}">`,
    tiny: '<p style="margin:0;font-size:8px">Dành cho ba mẹ</p>',
    clipzero: '<div style="width:0;height:0;overflow:hidden"><p style="margin:0">Dành cho ba mẹ</p></div>',
    same: '<p style="margin:0;color:#9BDDFF">Dành cho ba mẹ</p>',
    offscreen: '<p style="margin:0;position:absolute;left:-9999px">Dành cho ba mẹ</p>',
    opacity0: '<p style="margin:0;opacity:0">Dành cho ba mẹ</p>',
    clippath: '<p style="margin:0;clip-path:inset(100%)">Dành cho ba mẹ</p>',
    indent: '<p style="margin:0;width:100px;overflow:hidden;white-space:nowrap;text-indent:-9999px">Dành cho ba mẹ</p>',
  }[o.footMode] || '<p style="margin:0">Dành cho ba mẹ</p>';
  const foot = o.dropFoot ? '' : `<footer${mk('t.foot')} style="height:60px;padding:16px"${o.footMode === 'alt' ? ' aria-label="Dành cho ba mẹ"' : ''}>${footInner}</footer>`;
  const seq = o.swap ? [top, foot, hero, primary] : [top, hero, primary, foot];
  const cols = o.cols ? `<div style="display:flex"><div${o.marks === false ? '' : ' data-design-col'} style="flex:1">a</div>${o.cols > 1 ? `<div data-design-col style="flex:1">b</div>` : ''}</div>` : '';
  const extra = (o.sunButton ? '<a href="#" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center">Thêm</a>' : '')
    + (o.sunGradient ? '<a href="#" style="display:block;width:20px;height:48px;background:linear-gradient(#FFC83D,#FFC83D)">g</a>' : '')
    + (o.sunOnclick ? '<div onclick="void 0" style="width:20px;height:48px;background:#FFC83D">o</div>' : '')
    + (o.sunCursor ? '<div style="width:20px;height:48px;background:#FFC83D;cursor:pointer">c</div>' : '')
    + (o.sunBar ? '<div style="width:20px;height:10px;background:#FFC83D"></div>' : '')
    + (o.wide ? '<div style="width:900px;height:10px;background:red"></div>' : '')
    + (o.smallTap ? '<a href="#" style="display:block;height:30px">nhỏ xíu</a>' : '')
    + (o.anim === 'bad' ? '<div style="width:10px;height:10px;background:#000;animation:spin 1s linear infinite"></div>' : '')
    + (o.anim === 'safe' ? '<div class="s" style="width:10px;height:10px;background:#000"></div>' : '')
    + (o.animZero ? '<div style="width:10px;height:10px;background:#000;animation:fade 0s both"></div>' : '')
    + (o.raf ? '<div id="m" style="width:10px;height:10px;background:#000"></div><script>let x=0;const d=document.getElementById("m");(function f(){x=(x+3)%120;d.style.marginLeft=x+"px";requestAnimationFrame(f)})()</script>' : '')
    + (o.svgLow ? '<svg width="200" height="40" style="display:block"><rect width="200" height="40" fill="#fff"/><text x="4" y="28" fill="#ddd" font-size="20">Sáng chói</text></svg>' : '')
    + (o.belowFar ? '<div style="height:600px"></div><div style="height:300px;background:#d33"></div><i data-design="t.below" style="display:block;height:1px"></i>' : '')
    + (o.below === 'big' ? '<div style="height:600px;background:#d33"></div>' : '')
    + (o.below === 'small' ? '<div style="height:100px;background:#d33"></div>' : '')
    + (o.fakeMarks ? ['t.top', 't.hero', 't.primary', 't.foot'].map(id => `<i data-design="${id}" style="display:block;height:1px"></i>`).join('') : '');
  const stillCss = o.stillBad ? '.still main{padding:40px !important}' : '';
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width">${fontLink}
<style>body{margin:0;background:#9BDDFF;font:700 18px/1.3 'Nunito',sans-serif;color:#17324D}
h2,a[role=button]{font-family:'Baloo 2',sans-serif}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:no-preference){.s{animation:spin 1s linear infinite}}${stillCss}</style>
<body>${seq.join('')}${cols}${extra}</body></html>`;
}

// name -> [factory options, expectation]. Expectation: array = EXACT set of failing checks;
// {must, may} = `must` all fail, nothing outside must+may fails.
const V = {
  ok: [{}, []],
  'missing-text': [{ dropFoot: true }, ['texts', 'order', 'geometry', 'pixel-diff']],
  'wrong-order': [{ swap: true }, ['order', 'geometry', 'pixel-diff']],
  'two-primary': [{ dupPrimary: true }, { must: ['primary'], may: ['pixel-diff', 'geometry'] }],
  'no-primary': [{ noPrimary: true }, ['order', 'texts', 'primary', 'geometry', 'pixel-diff']],
  'short-primary': [{ primaryH: 40 }, { must: ['primary', 'tap>=48px'], may: ['pixel-diff', 'geometry'] }],
  'wrong-columns': [{ cols: 1 }, ['columns']],
  'right-columns': [{ cols: 2 }, []],
  overflow: [{ wide: true }, { must: ['no-h-scroll@360/390/768/1024/1280'], may: ['pixel-diff'] }],
  'low-contrast': [{ lowContrast: true }, ['contrast>=4.5', 'pixel-diff']],
  'small-tap': [{ smallTap: true }, ['tap>=48px']],
  'anim-running': [{ anim: 'bad' }, ['reduced-motion']],
  'anim-safe': [{ anim: 'safe' }, []],
  perturbed: [{ shift: 8 }, ['pixel-diff']],
  // --- sun rule: every clickable thing counts, non-interactive sun fills do not
  'two-sun-buttons': [{ sunButton: true }, ['primary', 'pixel-diff']],
  'sun-gradient-link': [{ sunGradient: true }, { must: ['primary'], may: ['pixel-diff'] }],
  'sun-onclick-div': [{ sunOnclick: true }, { must: ['primary'], may: ['pixel-diff'] }],
  'sun-cursor-div': [{ sunCursor: true }, { must: ['primary'], may: ['pixel-diff'] }],
  'sun-button-plus-sun-bar': [{ sunBar: true }, []],
  // --- blocker 1: below the fold
  'below-fold-huge': [{ below: 'big' }, ['height', 'pixel-diff']],
  'below-fold-small': [{ below: 'small' }, ['pixel-diff']], // height ok (<= 120px), but the extra area is DIFFED
  // --- blocker 2: text must be VISIBLE text nodes
  'text-alt-only': [{ footMode: 'alt' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-tiny-font': [{ footMode: 'tiny' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-clipped-zero': [{ footMode: 'clipzero' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-same-colour': [{ footMode: 'same' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-offscreen': [{ footMode: 'offscreen' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-opacity-0': [{ footMode: 'opacity0' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-clip-path': [{ footMode: 'clippath' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-indent-away': [{ footMode: 'indent' }, { must: ['texts'], may: ['pixel-diff'] }],
  // --- blocker 3: contrast cannot be skipped
  'gradient-low-contrast': [{ gradient: 'low' }, { must: ['contrast>=4.5'], may: ['pixel-diff'] }],
  'gradient-good-contrast': [{ gradient: 'ok' }, { must: [], may: ['pixel-diff'] }],
  'svg-low-contrast': [{ svgLow: true }, { must: ['contrast>=4.5'], may: ['pixel-diff'] }],
  // --- major 7: reduced motion
  'raf-motion': [{ raf: true }, { must: ['reduced-motion'], may: ['pixel-diff', 'still-twin'] }],
  'zero-duration-fade-allowed': [{ animZero: true }, { must: [], may: ['pixel-diff'] }],
  'still-twin-differs': [{ stillBad: true }, ['still-twin']],
  // --- major 10: geometry vs the mock
  'fake-1px-marks': [{ marks: false, fakeMarks: true }, { must: ['order', 'geometry', 'primary'], may: ['pixel-diff'] }],
  'section-far-off': [{ shift: 60 }, { must: ['geometry'], may: ['pixel-diff'] }],
  'section-wrong-height': [{ heroH: 100 }, { must: ['geometry'], may: ['pixel-diff'] }],
  'section-slightly-off': [{ shift: 8 }, ['pixel-diff']],
  // --- major 11: fonts
  'wrong-heading-font': [{ wrongFont: true }, { must: ['fonts'], may: ['pixel-diff'] }],
  'unmarked-copy-of-mock': [{ marks: false }, ['order', 'primary', 'geometry']],
};
V['below-far'] = [{ belowFar: true }, { must: ['height', 'order'], may: ['pixel-diff'] }];
V['below-far-viewport'] = [{ belowFar: true }, []]; // contract capture:viewport: the same page passes
V['pushed-below-fold'] = [{ push: 700 }, { must: ['order', 'primary', 'geometry'], may: ['pixel-diff', 'texts'] }]; // build pushes the content off the screen
V['viewport-mock-below-fold'] = [{}, []]; // the MOCK itself has primary/footer below the fold (viewport 300): fine
V['region-ok'] = [{}, []];
V['region-empty'] = [{ heroBlank: true }, { must: ['region:t.hero'], may: ['texts', 'pixel-diff', 'geometry'] }];
V['region-wrong'] = [{ heroRed: true }, { must: ['region:t.hero'], may: ['texts', 'pixel-diff', 'geometry'] }];
V['region-no-element'] = [{ marks: false }, { must: ['region:t.hero'], may: ['order', 'primary', 'geometry'] }];
V['small-order-default'] = [{ topSmall: true }, ['order']];
V['small-order-override'] = [{ topSmall: true }, []];
V['no-fonts'] = [{ noFontLink: true }, { must: ['fonts'], may: ['pixel-diff'] }];

const ANCHORS = { 't.top': 'Xin chào', 't.hero': 'Đọc truyện nào', 't.primary': 'Mở truyện', 't.foot': 'Dành cho ba mẹ' };
const BASE_CONTRACT = {
  release: 0, mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 },
  order: ['t.top', 't.hero', 't.primary', 't.foot'],
  texts: ['Xin chào', 'Đọc truyện nào', 'Mở truyện', 'Dành cho ba mẹ'],
  primary: { id: 't.primary', text: 'Mở truyện', min_height: { 390: 64 } },
  anchors: ANCHORS,
  diff_ceiling: { 390: 0.001 },
};

const failed = r => r.checks.filter(c => !c.pass).map(c => c.name);
const expectSet = exp => (Array.isArray(exp) ? { must: exp, may: [] } : exp);

function startServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/fonts.css') { res.writeHead(200, { 'content-type': 'text/css' }).end(fs.readFileSync(path.join(FONTS_DIR, 'fonts.css'))); return; }
    if (url.endsWith('.woff2') && fs.existsSync(path.join(FONTS_DIR, path.basename(url)))) { res.writeHead(200, { 'content-type': 'font/woff2' }).end(fs.readFileSync(path.join(FONTS_DIR, path.basename(url)))); return; }
    const name = url.slice(1);
    const html = (b) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><body style="font:18px sans-serif">${b}`);
    if (name === 'home-ok') return html('<h1>Chào <span>Minh</span>!</h1><a href="#">Mở truyện</a>');
    if (name === 'home-wrong-state') return html('<h1>Chào <span>Minh</span>!</h1><a href="#">Đọc tiếp</a>');
    if (name === 'home-anon') return html('<h1>Chào mừng</h1><a href="#">Mở truyện</a>');
    const v = V[name];
    if (!v) { res.writeHead(404).end('nope'); return; }
    const o = { ...v[0], fontsHref: v[0].noFontLink ? null : '/fonts.css' };
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(o));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}

function writeFixtureDesign(tmp) {
  const design = path.join(tmp, 'design');
  fs.mkdirSync(path.join(design, 'mocks'), { recursive: true });
  fs.writeFileSync(path.join(design, 'mocks', 'm.html'), page({ marks: false, fontsHref: 'file://' + path.join(FONTS_DIR, 'fonts.css') }));
  return design;
}

test('fixture: harness verdicts on known-good and known-bad pages', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-fid-'));
  const { server, base } = await startServer();
  try {
    const design = writeFixtureDesign(tmp);
    const contracts = path.join(tmp, 'contracts');
    fs.mkdirSync(contracts);
    const wr = (id, extra) => fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({ ...BASE_CONTRACT, id, built: { path: '/' + (extra.__path || id), state: 'first-visit' }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== '__path')) }));
    for (const name of Object.keys(V)) {
      const cols = name === 'wrong-columns' || name === 'right-columns' ? { layout: { 390: { columns: 2 } } } : {};
      const extra = { ...cols };
      if (name.startsWith('region-')) extra.regions = [{ id: 't.hero', mock_box: { 390: [0, 92, 390, 232] }, ceiling: 0.05 }];
      if (name === 'below-far-viewport' || name === 'pushed-below-fold' || name === 'viewport-mock-below-fold') extra.capture = 'viewport';
      if (name === 'viewport-mock-below-fold') extra.viewport = { 390: 300 };
      if (name === 'below-far') { extra.order = ['t.top', 't.hero', 't.primary', 't.foot', 't.below']; extra.anchors_exempt = { 't.below': 'marker below the fold' }; }
      if (name.startsWith('small-order')) { extra.anchors = { 't.hero': 'Đọc truyện nào', 't.primary': 'Mở truyện', 't.foot': 'Dành cho ba mẹ' }; extra.anchors_exempt = { 't.top': 'small label inside the header card' }; }
      if (name === 'small-order-override') extra.min_size = { 't.top': [100, 16] };
      wr(name, extra);
    }
    wr('no-anchors', { __path: 'ok', anchors: undefined });
    const A3 = { 't.top': 'Xin chào', 't.hero': 'Đọc truyện nào', 't.primary': 'Mở truyện' };
    wr('exempt-ok', { __path: 'ok', anchors: A3, anchors_exempt: { 't.foot': 'plain text row, no card' } });
    wr('exempt-no-reason', { __path: 'ok', anchors: A3, anchors_exempt: { 't.foot': '  ' } });
    wr('neither-anchored-nor-exempt', { __path: 'ok', anchors: A3 });
    wr('all-exempt', { __path: 'ok', anchors: undefined, anchors_exempt: Object.fromEntries(['t.top', 't.hero', 't.primary', 't.foot'].map(id => [id, 'full-screen background, text resolves to the page'])) });
    // per-width: base anchors say the hero is at the mock's box; the 390 override REMOVES it (null) and exempts it
    wr('width-null-removal', { __path: 'ok', anchors: { ...ANCHORS, 't.hero': 'Không có chữ này' }, anchors_390: { 't.hero': null }, anchors_exempt_390: { 't.hero': 'no card at this width' } });
    wr('width-override-text', { __path: 'ok', anchors: { ...ANCHORS, 't.hero': 'Không có chữ này' }, anchors_390: { 't.hero': 'Đọc truyện nào' } });
    wr('width-no-override-bad-anchor', { __path: 'ok', anchors: { ...ANCHORS, 't.hero': 'Không có chữ này' } });
    wr('partial-anchors', { __path: 'ok', anchors: { 't.top': 'Xin chào' } });
    const report = await runFidelity({ design, contracts, base, out: path.join(tmp, 'out'), composites: 'fail', 'state-driver': GOTO, 'require-anchors': true, concurrency: 10 });
    const by = Object.fromEntries(report.results.map(r => [r.contract, r]));

    for (const [name, [, exp]] of Object.entries(V)) {
      await t.test(name, () => {
        const { must, may } = expectSet(exp);
        const got = failed(by[name]);
        for (const m of must) assert.ok(got.includes(m), `${name}: "${m}" must FAIL but did not. checks: ${JSON.stringify(by[name].checks.map(c => [c.name, c.pass, c.detail]))}`);
        const extra = got.filter(g => !must.includes(g) && !may.includes(g));
        assert.deepEqual(extra, [], `${name}: unexpected failing checks. ${JSON.stringify(by[name].checks.filter(c => !c.pass))}`);
        if (Array.isArray(exp)) assert.deepEqual([...got].sort(), [...exp].sort(), name);
      });
    }
    await t.test('(ii) mock against itself: ok page has exactly 0 differing pixels and everything passes', () => {
      assert.equal(by.ok.diff.pixels, 0);
      assert.deepEqual(failed(by.ok), []);
    });
    await t.test('(iii) required text removed => the TEXT check fails and names the string', () => {
      const c = by['missing-text'].checks.find(x => x.name === 'texts');
      assert.equal(c.pass, false);
      assert.match(c.detail, /Dành cho ba mẹ/);
    });
    await t.test('B1 below the fold: height check fails when built is >10%/120px taller; a smaller overshoot is still counted by the diff', () => {
      assert.match(by['below-fold-huge'].checks.find(c => c.name === 'height').detail, /built page 1\d{3}px vs mock 700px/);
      assert.equal(by['below-fold-small'].checks.find(c => c.name === 'height').pass, true);
      assert.ok(by['below-fold-small'].diff.fraction > 0.05, 'the extra 100px must be inside the diff area');
    });
    await t.test('B3 gradient backdrop is measured by pixel sampling, not skipped', () => {
      const g = by['gradient-good-contrast'].checks.find(c => c.name === 'contrast>=4.5');
      assert.equal(g.pass, true);
      assert.match(g.detail, /[1-9]\d* via pixel sampling/);
      assert.match(by['gradient-low-contrast'].checks.find(c => c.name === 'contrast>=4.5').detail, /Đọc truyện nào/);
      assert.match(by['svg-low-contrast'].checks.find(c => c.name === 'contrast>=4.5').detail, /Sáng chói.*svg/);
    });
    await t.test('M7 behavioural motion: a requestAnimationFrame mover is caught by the two-sample check', () => {
      assert.match(by['raf-motion'].checks.find(c => c.name === 'reduced-motion').detail, /pixels still changing between samples/);
    });
    await t.test('M10 --require-anchors: a contract with no anchors, or an order id without one, FAILS', () => {
      assert.deepEqual(failed(by['no-anchors']), ['anchors-present']);
      assert.match(by['no-anchors'].checks.find(c => c.name === 'anchors-present').detail, /neither anchored nor exempt: t\.top/);
      assert.deepEqual(failed(by['partial-anchors']), ['anchors-present']);
      assert.match(by['partial-anchors'].checks.find(c => c.name === 'anchors-present').detail, /t\.hero/);
    });
    await t.test('anchors_exempt: an exempt id passes; no reason fails; neither anchored nor exempt fails; all-exempt is allowed and reported pixel-only', () => {
      assert.deepEqual(failed(by['exempt-ok']), []);
      assert.match(by['exempt-ok'].checks.find(c => c.name === 'anchors-present').detail, /3 anchored, 1 exempt/);
      assert.deepEqual(failed(by['exempt-no-reason']), ['anchors-present']);
      assert.match(by['exempt-no-reason'].checks.find(c => c.name === 'anchors-present').detail, /exempt without a reason: t\.foot/);
      assert.deepEqual(failed(by['neither-anchored-nor-exempt']), ['anchors-present']);
      assert.match(by['neither-anchored-nor-exempt'].checks.find(c => c.name === 'anchors-present').detail, /neither anchored nor exempt: t\.foot/);
      assert.deepEqual(failed(by['all-exempt']), []);
      assert.ok(by['all-exempt'].warnings.some(w => /geometry: pixel-only/.test(w)));
      assert.ok(by['exempt-ok'].anchorBoxes['t.hero'].h > 0);
      const md = fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8');
      assert.match(md, /Geometry NOT checked \(anchors_exempt, as in force at this width\):\n- t\.foot: plain text row, no card/);
      assert.match(md, /WARN geometry: pixel-only/);
      assert.match(md, /Anchored mock boxes \(x, y, w, h\):\n- t\.top: 0, 0, 390, 92/);
    });
    await t.test('per-width anchors: null removal and override take effect; an unresolvable base anchor still fails', () => {
      assert.deepEqual(failed(by['width-null-removal']), []);
      assert.deepEqual(failed(by['width-override-text']), []);
      assert.deepEqual(failed(by['width-no-override-bad-anchor']), ['geometry']);
      assert.match(by['width-no-override-bad-anchor'].checks.find(c => c.name === 'geometry').detail, /not found in the MOCK/);
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /- t\.hero: no card at this width/);
    });
    await t.test('capture:viewport: content below the fold does not fail height; without it the same page does', () => {
      assert.deepEqual(failed(by['below-far-viewport']), []);
      assert.equal(by['below-far-viewport'].checks.some(c => c.name === 'height'), false, 'no height check in viewport capture');
      assert.ok(failed(by['below-far']).includes('height'));
      assert.match(by['below-far'].checks.find(c => c.name === 'order').detail, /t\.below is 390x1px/);
      assert.equal(by['below-far-viewport'].diff.mockHeight, 700);
      assert.equal(by['below-far-viewport'].diff.builtHeight, 700);
    });
    await t.test('viewport skip direction: a build that PUSHES an on-screen section below the fold fails; a section the mock itself has below the fold may be there', () => {
      assert.match(by['pushed-below-fold'].checks.find(c => c.name === 'order').detail, /pushed below the fold: t\.hero.*the mock shows it on screen/);
      assert.match(by['pushed-below-fold'].checks.find(c => c.name === 'primary').detail, /primary pushed below the fold/);
      assert.match(by['pushed-below-fold'].checks.find(c => c.name === 'geometry').detail, /t\.hero: pushed below the fold/);
      assert.deepEqual(failed(by['viewport-mock-below-fold']), []);
    });
    await t.test('regions: a correct region passes; an EMPTY and a WRONG one fail; a missing element fails; reported in report.md', () => {
      assert.equal(by['region-ok'].checks.find(c => c.name === 'region:t.hero').pass, true);
      assert.match(by['region-empty'].checks.find(c => c.name === 'region:t.hero').detail, /region empty/);
      assert.match(by['region-wrong'].checks.find(c => c.name === 'region:t.hero').detail, /% differing/);
      assert.match(by['region-no-element'].checks.find(c => c.name === 'region:t.hero').detail, /no visible built element/);
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /Regions:\n- FAIL t\.hero/);
      assert.ok(fs.existsSync(path.join(tmp, 'out', 'region-empty-390.png')));
    });
    await t.test('min_size: a small labelled element fails the default 40x24 but passes with a per-id override', () => {
      assert.match(by['small-order-default'].checks.find(c => c.name === 'order').detail, /t\.top is 150x20px \(min 40x24/);
      assert.equal(by['small-order-override'].checks.find(c => c.name === 'order').pass, true);
    });
    await t.test('a failing contract writes a composite, report.json and report.md; verdict is false', () => {
      assert.equal(report.ok, false);
      for (const f of ['report.json', 'report.md', 'missing-text-390.png']) assert.ok(fs.existsSync(path.join(tmp, 'out', f)), f);
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /FAIL missing-text @ 390px/);
    });
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('M8 state verification (default driver): wrong state, anonymous, unreachable states FAIL as state-driver; the right state passes', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-state-'));
  const { server, base } = await startServer();
  try {
    const design = writeFixtureDesign(tmp);
    const contracts = path.join(tmp, 'contracts');
    fs.mkdirSync(contracts);
    const mk = (id, p, state, label) => fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({
      id, release: 0, mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 }, built: { path: p, state },
      order: [], texts: [], primary: { id: 'x', text: label, min_height: { 390: 1 } }, diff_ceiling: { 390: 1 },
    }));
    mk('state-ok', '/home-ok', 'first-visit', 'Mở truyện');
    mk('state-wrong', '/home-wrong-state', 'first-visit', 'Mở truyện');
    mk('state-anon', '/home-anon', 'first-visit', 'Mở truyện');
    mk('state-mid-on-first-visit-page', '/home-ok', 'mid-story', 'Đọc tiếp');
    mk('state-reward', '/home-ok', 'reward', 'Xong hôm nay');
    mk('state-rank-up', '/home-ok', 'rank-up', 'x');
    const report = await runFidelity({ design, contracts, base, out: path.join(tmp, 'out'), composites: 'fail', greetingWaitMs: 400, concurrency: 6 });
    const sd = id => report.results.find(r => r.contract === id).checks.find(c => c.name === 'state-driver');
    assert.equal(sd('state-ok').pass, true);
    assert.equal(sd('state-wrong').pass, false); assert.match(sd('state-wrong').detail, /wrong state: expected a visible "Mở truyện"/);
    assert.equal(sd('state-anon').pass, false); assert.match(sd('state-anon').detail, /not logged in/);
    assert.equal(sd('state-mid-on-first-visit-page').pass, false); assert.match(sd('state-mid-on-first-visit-page').detail, /wrong state/);
    assert.equal(sd('state-reward').pass, false); assert.match(sd('state-reward').detail, /not implemented/);
    assert.equal(sd('state-rank-up').pass, false); assert.match(sd('state-rank-up').detail, /not implemented/);
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('m14 a contract whose width-keyed fields disagree with its mocks is rejected (exit-2 class error)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-width-'));
  try {
    const good = { ...BASE_CONTRACT, id: 'w', built: { path: '/', state: 'first-visit' } };
    const run = async c => { fs.rmSync(path.join(tmp, 'c'), { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'c')); fs.writeFileSync(path.join(tmp, 'c', 'w.json'), JSON.stringify(c)); return runFidelity({ design: REAL_DESIGN, contracts: path.join(tmp, 'c'), base: 'http://x.invalid', out: path.join(tmp, 'o') }); };
    await assert.rejects(run({ ...good, viewport: { 390: 700, 1280: 800 } }), e => e instanceof InfraError && /"viewport" widths/.test(e.message));
    await assert.rejects(run({ ...good, diff_ceiling: {} }), e => e instanceof InfraError && /"diff_ceiling" widths/.test(e.message));
    await assert.rejects(run({ ...good, reference: { 1280: 'x.png' } }), e => e instanceof InfraError && /"reference" widths/.test(e.message));
    await assert.rejects(run({ ...good, anchors_exempt: { 't.top': 'also exempt' } }), e => e instanceof InfraError && /BOTH anchors and anchors_exempt at 390px: t\.top/.test(e.message));
    await assert.rejects(run({ ...good, anchors_390: { 't.foot': 'x' }, anchors_exempt: { 't.foot': 'r' } }), e => e instanceof InfraError && /BOTH anchors and anchors_exempt at 390px: t\.foot/.test(e.message));
    await assert.rejects(run({ ...good, anchors_exempt_390: { 't.top': 'r' } }), e => e instanceof InfraError && /BOTH .* at 390px: t\.top/.test(e.message));
    await assert.rejects(run({ ...good, anchors_1280: { 't.top': 'x' } }), e => e instanceof InfraError && /"anchors_1280" is for a width with no mock/.test(e.message));
    await assert.rejects(run({ ...good, anchors_exempt_1280: {} }), e => e instanceof InfraError && /"anchors_exempt_1280" is for a width with no mock/.test(e.message));
    await assert.rejects(run({ ...good, texts_1280: ['x'] }), e => e instanceof InfraError && /texts_1280/.test(e.message));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('per-width anchors: override replaces, null removes, exemptions override; both-at-one-width is a contract error', () => {
  const c = { anchors: { a: 'A', b: 'B' }, anchors_exempt: { x: 'why' }, anchors_390: { a: 'A390', b: null }, anchors_exempt_390: { b: 'moved to exempt at 390', x: null } };
  assert.deepEqual(effectiveAnchors(c, 390), { anchors: { a: 'A390' }, exempt: { b: 'moved to exempt at 390' } });
  assert.deepEqual(effectiveAnchors(c, 1280), { anchors: { a: 'A', b: 'B' }, exempt: { x: 'why' } });
});

test('region/crop helpers: uniform crops are "empty", resize keeps content, identical crops diff 0', async () => {
  const { compareRegion, stddev, cropPng } = await import('../scripts/design/lib/regions.mjs');
  const mk = (w, h, f) => { const p = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(f(x, y), (y * w + x) * 4); return PNG.sync.write(p); };
  const checker = mk(40, 40, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  const blank = mk(40, 40, () => [200, 200, 200, 255]);
  assert.ok(stddev(cropPng(checker, { x: 0, y: 0, w: 40, h: 40 })) > 100);
  assert.ok(stddev(cropPng(blank, { x: 0, y: 0, w: 40, h: 40 })) < 1);
  const box = { x: 0, y: 0, w: 40, h: 40 };
  assert.equal(compareRegion(checker, checker, box, box, 0.01).pass, true);
  const empty = compareRegion(checker, blank, box, box, 0.5);
  assert.equal(empty.pass, false); assert.match(empty.problems.join('|'), /region empty/);
  // built element twice as big as the mock box: resized back before diffing
  const big = mk(80, 80, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.equal(compareRegion(checker, big, box, { x: 0, y: 0, w: 80, h: 80 }, 0.05).pass, true);
});

test('r2l driver sample data: values come from the mocks, shapes are preserved', async () => {
  const { SAMPLE, sampleProgress, sampleBoards, sampleSession } = await import('../scripts/design/drivers/r2l.mjs');
  const fmt = n => new Intl.NumberFormat('vi-VN').format(n);
  const mock1280 = fs.readFileSync(path.join(REAL_DESIGN, 'mocks', '01-home-1280.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  for (const row of [...SAMPLE.leaderboard.xp, ...SAMPLE.leaderboard.diamonds]) { assert.ok(mock1280.includes(row.display_name), row.display_name); assert.ok(mock1280.includes(fmt(row.total)), fmt(row.total)); }
  assert.ok(mock1280.includes('Chào ' + SAMPLE.child.name));
  assert.ok(mock1280.includes(SAMPLE.story.title));
  const rew = fs.readFileSync(path.join(REAL_DESIGN, 'mocks', '04-reward-390.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  assert.ok(rew.includes('+' + SAMPLE.reward.diamonds) && rew.includes('+' + SAMPLE.reward.xp));
  // shape preservation: unknown keys survive, only values change
  const p = sampleProgress({ ok: true, extra: 1, progress: { foo: 'bar', current_pack: { x: 1 } }, read2lead_state: { keep: 1, diamonds: 270, rank_ladder: { label_vi: 'Đồng', tier_color: '#f00' } } }, 'first-visit');
  assert.equal(p.extra, 1); assert.equal(p.progress.foo, 'bar'); assert.equal(p.read2lead_state.keep, 1);
  assert.equal(p.read2lead_state.diamonds, 55); assert.equal(p.progress.student_name, 'Minh'); assert.equal(p.read2lead_state.rank_ladder.tier_color, '#f00'); assert.equal(p.read2lead_state.rank_ladder.stars, 2);
  // the pack and session are REAL (from the API); only the title/level VALUES are replaced, and nothing is fabricated
  assert.equal(p.progress.current_pack.x, 1); assert.equal(p.progress.current_pack.story_title, 'The Sky Is Blue!'); assert.equal(p.progress.current_pack.level, 'L1');
  const real = sampleProgress({ progress: { current_pack: { story_session: { stage: 'read', complete: false } } }, read2lead_state: {} }, 'mid-story');
  assert.deepEqual(real.progress.current_pack.story_session, { stage: 'read', complete: false });
  assert.equal(sampleProgress({ progress: {}, read2lead_state: {} }, 'mid-story').progress.current_pack ?? null, null, 'no pack is invented');
  assert.equal(sampleProgress({ progress: { current_pack: { story_title: 'x' } }, read2lead_state: {} }, 'no-story').progress.current_pack, null, 'no-story is the one fabricated state');
  const av = { monster: { body: 'x' } };
  const b = sampleBoards({ ok: true, boards: { xp: { leaders: [], participants: 0, own: { rank: 3, display_name: 'Linh' } }, diamonds: { leaders: [{ rank: 1, display_name: 'An', total: 1, avatar: av, is_self: false }] } } });
  assert.deepEqual(b.boards.xp.leaders.map(r => [r.rank, r.display_name, r.total]), [[1, 'Hoang', 1080], [2, 'Hieuenzo', 900], [3, 'Percy', 890]]);
  assert.equal(b.boards.xp.leaders[0].avatar, av, 'avatar shape borrowed from a real row');
  assert.equal(b.boards.diamonds.leaders[0].total, 39444); assert.equal(b.boards.xp.own.rank, null);
  const sess = sampleSession({ ok: true, view: { session: { id: 's', awarded: { diamonds: 5, xp: 1 }, pictureRetell: { status: 'complete', award: { diamonds: 200 } } } } });
  assert.deepEqual([sess.view.session.awarded.diamonds, sess.view.session.awarded.xp, sess.view.session.pictureRetell.award.diamonds], [35, 20, 0]);
});

test('data-binding expectations: the alternate sample expects its own values and the mock values must be gone', async () => {
  const { SAMPLE, loadSample, bindingExpectations } = await import('../scripts/design/drivers/r2l.mjs');
  const alt = loadSample(path.join(root, 'scripts', 'design', 'fixtures', 'mock-sample-alt.json'));
  // every alternate value really differs from the mock's (otherwise the bite proves nothing)
  assert.notEqual(alt.child.name, SAMPLE.child.name); assert.notEqual(alt.child.diamonds, SAMPLE.child.diamonds); assert.notEqual(alt.child.streak_days, SAMPLE.child.streak_days);
  assert.notEqual(alt.reward.diamonds, SAMPLE.reward.diamonds); assert.notEqual(alt.reward.xp, SAMPLE.reward.xp);
  for (const kind of ['xp', 'diamonds']) alt.leaderboard[kind].forEach((r, i) => { assert.notEqual(r.total, SAMPLE.leaderboard[kind][i].total); });
  const home = bindingExpectations(alt, 'first-visit', SAMPLE);
  assert.ok(home.expect.includes('Chào Bảo!') && home.expect.includes('187') && home.expect.includes('9 ngày') && home.expect.includes('Red Apples Fall') && home.expect.includes('2.310') && home.expect.includes('52.718'));
  assert.ok(home.absent.includes('Chào Minh!') && home.absent.includes('55') && home.absent.includes('1.080') && home.absent.includes('39.444'));
  const rw = bindingExpectations(alt, 'reward', SAMPLE);
  assert.deepEqual(rw.expect, ['+47', '+28']); assert.deepEqual(rw.absent, ['+35', '+20']);
  assert.deepEqual(bindingExpectations(SAMPLE, 'reward').absent, [], 'no absent list against itself');
});

test('data-binding check: a page that binds the values passes; one that hard-codes the mock values FAILS (rule 28)', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-bind-'));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const name = u.searchParams.get('name'), dia = u.searchParams.get('dia');
    const body = u.pathname === '/bound' ? `<h1>Chào ${name}!</h1><p>${dia}</p>` : '<h1>Chào Minh!</h1><p>55</p>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><body style="font:20px sans-serif">${body}`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const design = writeFixtureDesign(tmp);
    fs.writeFileSync(path.join(tmp, 'driver.mjs'), `export default async (page, c, base) => { await page.goto(base + c.built.path); return { dataBinding: { expect: ['Chào Bảo!', '187'], absent: ['Chào Minh!', '55'] } }; };\n`);
    const contracts = path.join(tmp, 'c'); fs.mkdirSync(contracts);
    const mk = (id, p) => fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({ ...BASE_CONTRACT, id, anchors: undefined, built: { path: p, state: 'first-visit' } }));
    mk('bound', '/bound?name=Bảo&dia=187'); mk('hardcoded', '/hard?name=Bảo&dia=187');
    const base = 'http://127.0.0.1:' + server.address().port;
    const bo = await runFidelity({ design, contracts, base, out: path.join(tmp, 'o1'), 'state-driver': path.join(tmp, 'driver.mjs'), 'binding-only': true });
    const by = Object.fromEntries(bo.results.map(r => [r.contract, r]));
    assert.deepEqual(by.bound.checks.map(c => [c.name, c.pass]), [['state-driver', true], ['data-binding', true]]);
    assert.equal(by.hardcoded.checks.find(c => c.name === 'data-binding').pass, false);
    assert.match(by.hardcoded.checks.find(c => c.name === 'data-binding').detail, /does not show: "Chào Bảo!", "187"; still shows the OLD value \(hard-coded\?\): "Chào Minh!", "55"/);
    assert.equal(by.bound.checks.length, 2, 'binding-only skips every other check');
    // also part of a normal full run
    const full = await runFidelity({ design, contracts, base, out: path.join(tmp, 'o2'), only: 'hardcoded', 'state-driver': path.join(tmp, 'driver.mjs') });
    assert.ok(full.results[0].checks.some(c => c.name === 'data-binding' && !c.pass));
    // a driver that gives no expectations cannot silently pass --binding-only
    fs.writeFileSync(path.join(tmp, 'plain.mjs'), `export default async (page, c, base) => { await page.goto(base + c.built.path); };\n`);
    const none = await runFidelity({ design, contracts, base, out: path.join(tmp, 'o3'), only: 'bound', 'state-driver': path.join(tmp, 'plain.mjs'), 'binding-only': true });
    assert.match(none.results[0].checks.find(c => c.name === 'data-binding').detail, /provided no dataBinding/);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('region edge energy: a blank box inside the backdrop rays FAILS clearly, a different-but-real subject passes', async () => {
  const { compareRegion, edgeEnergy, cropPng, EDGE_MIN_RATIO } = await import('../scripts/design/lib/regions.mjs');
  const W = 150;
  // backdrop: green with lighter diagonal rays (non-zero stddev, some edges), like the rank-up burst
  const rays = (x, y) => (((x + y) >> 4) % 3 === 0 ? [46, 139, 78, 255] : [35, 122, 65, 255]);
  const disc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  const subject = (x, y, cx = 75, cy = 75) => {
    if (disc(x, y, cx - 18, cy - 10, 8) || disc(x, y, cx + 18, cy - 10, 8)) return [20, 40, 60, 255]; // eyes
    if (Math.abs(x - cx) < 14 && y > cy + 12 && y < cy + 20) return [200, 40, 60, 255]; // mouth
    if (Math.abs(x - cx) < 40 && Math.abs(y - cy) < 36) return [235, 235, 235, 255]; // body
    return null;
  };
  const mk = f => { const p = new PNG({ width: W, height: W }); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) p.data.set(f(x, y), (y * W + x) * 4); return PNG.sync.write(p); };
  const mock = mk((x, y) => subject(x, y) || rays(x, y));
  const blank = mk((x, y) => rays(x, y));                       // the monster box emptied: only rays remain
  const other = mk((x, y) => subject(x, y, 80, 70) || rays(x, y)); // a different real subject, a little off
  const box = { x: 0, y: 0, w: W, h: W };
  const em = edgeEnergy(cropPng(mock, box)), eb = edgeEnergy(cropPng(blank, box)), eo = edgeEnergy(cropPng(other, box));
  assert.ok(eb / em < 0.5 * EDGE_MIN_RATIO + 0.2, `blank ratio ${(eb / em).toFixed(2)}`);
  assert.ok(eo / em > 0.8, `real-other ratio ${(eo / em).toFixed(2)}`);
  const rBlank = compareRegion(mock, blank, box, box, 1.0);
  assert.equal(rBlank.pass, false); assert.match(rBlank.problems.join('|'), /region empty: built crop has only \d+% of the mock's edge energy/);
  assert.ok(rBlank.builtSd > 4, 'the blank box is NOT uniform (rays), so the stddev check alone would pass it');
  assert.equal(compareRegion(mock, other, box, box, 1.0).pass, true);
});

test('pixel sampler: dominant background wins over heavy glyph pixels', () => {
  const png = new PNG({ width: 20, height: 10 });
  for (let i = 0; i < 200; i++) { const dark = i % 20 < 12; png.data.set(dark ? [0, 0, 0, 255] : [250, 250, 250, 255], i * 4); }
  // 60% of the pixels are glyph-coloured (black); the background is white, and must still be picked
  const bg = sampleBackdrop(PNG.sync.read(PNG.sync.write(png)), { x: 0, y: 0, w: 20, h: 10 }, [0, 0, 0]);
  assert.ok(bg[0] > 240);
  assert.equal(sampleBackdrop(PNG.sync.read(PNG.sync.write(png)), { x: 100, y: 100, w: 5, h: 5 }, [0, 0, 0]), null);
});

test('(ii) REAL design: the real home mock rendered against itself gives a pixel diff of exactly 0', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-self-'));
  try {
    fs.mkdirSync(path.join(tmp, 'c'));
    fs.writeFileSync(path.join(tmp, 'c', 'self.json'), JSON.stringify({
      id: 'home-self', release: 0,
      mock: { 390: 'mocks/01-home-390.html', 1280: 'mocks/01-home-1280.html' },
      viewport: { 390: 1600, 1280: 1000 }, built: { path: '/', state: 'first-visit' },
      order: [], texts: [], diff_ceiling: { 390: 0.0001, 1280: 0.0001 },
    }));
    const report = await runFidelity({
      design: REAL_DESIGN, contracts: path.join(tmp, 'c'), base: 'http://unused.invalid', out: path.join(tmp, 'out'),
      'state-driver': path.join(root, 'scripts', 'design', 'drivers', 'mock-self.mjs'),
    });
    for (const r of report.results) {
      assert.equal(r.diff.pixels, 0, `${r.width}px mock-vs-mock must be identical`);
      for (const n of ['pixel-diff', 'height', 'fonts', 'texts', 'contrast>=4.5', 'reduced-motion', 'still-twin'].filter(n => r.checks.some(c => c.name === n)))
        assert.equal(r.checks.find(c => c.name === n).pass, true, `${r.width}px ${n}: ${r.checks.find(c => c.name === n).detail}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('(i) REAL navy home FAILS the real home-first-visit contract (opt-in: DESIGN_BITE_NAVY=1)', async t => {
  if (process.env.DESIGN_BITE_NAVY !== '1') return t.skip('set DESIGN_BITE_NAVY=1 (needs a dist/ build + ~/work/r2l-releases/v105-20261019); run scripts/design/bite-navy.sh');
  if (skipNoChrome(t)) return;
  const contracts = process.env.DESIGN_CONTRACTS || path.resolve(root, '..', '..', '..', '..', '_ops', 'specs', 'design-contracts', 'r2l-island');
  const candidate = process.env.R2L_CANDIDATE || path.join(os.homedir(), 'work', 'r2l-releases', 'v105-20261019');
  const proc = spawn('node', [path.join(root, 'scripts', 'r2l-release', 'rehearse.mjs'), '--candidate', candidate, '--repo', root, '--serve'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const info = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stdout.on('data', d => { buf += d; const m = /"url":\s*"([^"]+)"/.exec(buf); if (m && buf.includes('}')) resolve(JSON.parse(buf)); });
      proc.on('exit', c => reject(new Error('rehearse exited ' + c)));
      setTimeout(() => reject(new Error('rehearse did not start')), 60000);
    });
    const out = process.env.DESIGN_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'design-navy-'));
    const report = await runFidelity({ design: REAL_DESIGN, contracts, base: info.url, out, only: 'home-first-visit', token: 'b'.repeat(32) });
    assert.equal(report.ok, false);
    for (const r of report.results) {
      const f = failed(r);
      assert.ok(f.includes('order'), `${r.width}: contract order must fail, got ${f}`);
      assert.ok(f.includes('primary'), `${r.width}: primary must fail`);
      assert.ok(f.includes('pixel-diff'), `${r.width}: diff ceiling must fail`);
      assert.ok(!f.includes('state-driver'), `${r.width}: the navy home IS the first-visit state; the state check must pass, got ${f}`);
    }
  } finally { proc.kill('SIGTERM'); }
});
