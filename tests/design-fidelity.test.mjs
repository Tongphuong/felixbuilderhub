// Bite tests (rule 28) for the fidelity harness scripts/design/fidelity.mjs.
// A harness that cannot fail looks exactly like a harness with nothing to complain about,
// so every check below is fed a known-BAD page and must flag THAT check by name; a known-GOOD
// page must pass everything (positive control).
//
// Fast part (default): a synthetic mock + ~16 built-page variants served from a local http
// server, all in ONE browser launch. Real-design part: the real home mock rendered against
// itself must give a pixel diff of exactly 0.
// Opt-in part (DESIGN_BITE_NAVY=1): TODAY's navy home, served by scripts/r2l-release/rehearse.mjs,
// must FAIL the real home-first-visit contract on contract checks AND the diff ceiling.
// Needs Chrome (CHROME_PATH or a standard install). No Chrome = FAIL, not skip (rule 28b),
// unless DESIGN_NO_BROWSER=1 is set explicitly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFidelity, findChrome } from '../scripts/design/fidelity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_DESIGN = path.join(root, '_design', 'read2lead-dao-phieu-luu');
const NO_BROWSER = process.env.DESIGN_NO_BROWSER === '1';

// ---- synthetic page factory ---------------------------------------------------------
// opts: marks (bool), dropFoot, swap, dupPrimary, noPrimary, primaryH, wide, lowContrast,
//       smallTap, anim ('bad'|'safe'), shift
function page(o = {}) {
  const d = (id) => (o.marks === false ? '' : ` data-design="${id}"`);
  const top = `<header${d('t.top')} style="height:60px;padding:16px">Xin chào</header>`;
  const hero = `<main${d('t.hero')} style="height:200px;padding:16px;${o.shift ? 'margin-top:' + o.shift + 'px;' : ''}${o.lowContrast ? 'color:#aaa;background:#fff;' : ''}">Đọc truyện nào</main>`;
  const primary = o.noPrimary ? '' : `<a href="#"${d('t.primary')} style="display:block;height:${o.primaryH || 64}px;line-height:${o.primaryH || 64}px;background:#FFC83D;text-align:center">Mở truyện</a>`
    + (o.dupPrimary ? `<a href="#"${d('t.primary')} style="display:block;height:64px;line-height:64px;background:#FFC83D;text-align:center">Mở truyện</a>` : '');
  const foot = o.dropFoot ? '' : `<footer${d('t.foot')} style="height:60px;padding:16px">Dành cho ba mẹ</footer>`;
  const seq = o.swap ? [top, foot, hero, primary] : [top, hero, primary, foot];
  const cols = o.cols ? `<div style="display:flex"><div${o.marks === false ? '' : ' data-design-col'} style="flex:1">a</div>${o.cols > 1 ? `<div data-design-col style="flex:1">b</div>` : ''}</div>` : '';
  const extra = (o.wide ? '<div style="width:900px;height:10px;background:red"></div>' : '')
    + (o.smallTap ? '<a href="#" style="display:block;height:30px">nhỏ xíu</a>' : '')
    + (o.anim === 'bad' ? '<div style="width:10px;height:10px;background:#000;animation:spin 1s linear infinite"></div>' : '')
    + (o.anim === 'safe' ? '<div class="s" style="width:10px;height:10px;background:#000"></div>' : '');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>body{margin:0;background:#9BDDFF;font:700 18px/1.3 sans-serif;color:#17324D}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:no-preference){.s{animation:spin 1s linear infinite}}</style>
<body>${seq.join('')}${cols}${extra}</body></html>`;
}

const VARIANTS = {
  ok: {},
  'missing-text': { dropFoot: true },
  'wrong-order': { swap: true },
  'two-primary': { dupPrimary: true },
  'no-primary': { noPrimary: true },
  'short-primary': { primaryH: 40 },
  'wrong-columns': { cols: 1 },
  overflow: { wide: true },
  'low-contrast': { lowContrast: true },
  'small-tap': { smallTap: true },
  'anim-running': { anim: 'bad' },
  'anim-safe': { anim: 'safe' },
  'right-columns': { cols: 2 },
  perturbed: { shift: 8 },
  'unmarked-copy-of-mock': { marks: false },
};

// EXACT set of checks that must FAIL per variant; everything else must PASS.
// (Tiny additions stay under the 0.1% diff ceiling on purpose: each variant isolates its own check.)
const EXPECT_FAIL = {
  ok: [],
  'missing-text': ['texts', 'order', 'pixel-diff'],
  'wrong-order': ['order', 'pixel-diff'],
  'two-primary': ['primary', 'pixel-diff'],
  'no-primary': ['order', 'texts', 'primary', 'pixel-diff'],
  'short-primary': ['primary', 'tap>=48px', 'pixel-diff'],
  'wrong-columns': ['columns'],
  overflow: ['no-h-scroll@360/390/768/1024/1280', 'pixel-diff'],
  'low-contrast': ['contrast>=4.5', 'pixel-diff'],
  'small-tap': ['tap>=48px'],
  'anim-running': ['reduced-motion'],
  'anim-safe': [], // motion wrapped in no-preference: the reduced-motion check must PASS
  'right-columns': [],
  perturbed: ['pixel-diff'],
};

let fixture;
function buildFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-fid-'));
  const design = path.join(tmp, 'design');
  const contracts = path.join(tmp, 'contracts');
  fs.mkdirSync(path.join(design, 'mocks'), { recursive: true });
  fs.mkdirSync(contracts);
  fs.writeFileSync(path.join(design, 'mocks', 'm.html'), page({ marks: false }));
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].slice(1);
    const o = VARIANTS[name];
    if (!o) { res.writeHead(404).end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(o));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    for (const name of Object.keys(VARIANTS)) {
      const expectedCols = name === 'wrong-columns' ? 2 : name === 'right-columns' ? 2 : null;
      fs.writeFileSync(path.join(contracts, name + '.json'), JSON.stringify({
        id: name, release: 0,
        mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 },
        built: { path: '/' + name, state: 'first-visit' },
        order: ['t.top', 't.hero', 't.primary', 't.foot'],
        texts: ['Xin chào', 'Đọc truyện nào', 'Mở truyện', 'Dành cho ba mẹ'],
        primary: { id: 't.primary', text: 'Mở truyện', min_height: { 390: 64 } },
        ...(expectedCols ? { layout: { 390: { columns: expectedCols } } } : {}),
        diff_ceiling: { 390: 0.001 },
      }));
    }
    // a contract whose state the default driver cannot reach
    fs.writeFileSync(path.join(contracts, 'unreachable-state.json'), JSON.stringify({
      id: 'unreachable-state', release: 0, mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 },
      built: { path: '/ok', state: 'reward' }, order: [], texts: [], diff_ceiling: { 390: 0.5 },
    }));
    resolve({ tmp, design, contracts, server, base: 'http://127.0.0.1:' + server.address().port });
  }));
}

function failedChecks(r) { return r.checks.filter(c => !c.pass).map(c => c.name); }

test('fixture: harness verdicts on known-good and known-bad pages', async t => {
  if (NO_BROWSER) return t.skip('DESIGN_NO_BROWSER=1');
  findChrome(); // throws (test FAILS) when there is no browser
  fixture = await buildFixture();
  const out = path.join(fixture.tmp, 'out');
  const report = await runFidelity({ design: fixture.design, contracts: fixture.contracts, base: fixture.base, out, composites: 'fail' });
  const by = Object.fromEntries(report.results.map(r => [r.contract, r]));

  for (const [name, expected] of Object.entries(EXPECT_FAIL)) {
    await t.test(name, () => {
      const got = failedChecks(by[name]).sort();
      assert.deepEqual(got, [...expected].sort(), `${name}: ${JSON.stringify(by[name].checks.filter(c => !c.pass))}`);
    });
  }
  await t.test('(ii) mock rendered against itself: diff exactly 0 and every check PASSes', () => {
    // "ok" is the mock plus data-design marks: identical pixels.
    assert.equal(by.ok.diff.pixels, 0);
    assert.equal(by['unmarked-copy-of-mock'].diff.pixels, 0);
  });
  await t.test('(iii) a required text removed => the TEXT check fails and names the string', () => {
    const c = by['missing-text'].checks.find(x => x.name === 'texts');
    assert.equal(c.pass, false);
    assert.match(c.detail, /Dành cho ba mẹ/);
  });
  await t.test('unmarked page (no data-design attributes) fails order+primary even with identical pixels', () => {
    assert.deepEqual(failedChecks(by['unmarked-copy-of-mock']).sort(), ['order', 'primary']);
  });
  await t.test('a state the driver cannot reach FAILs (never silently passes)', () => {
    assert.deepEqual(failedChecks(by['unreachable-state']), ['state-driver']);
    assert.match(by['unreachable-state'].checks[0].detail, /not implemented/);
  });
  await t.test('a failing contract writes a composite, report.json and report.md; exit verdict is false', () => {
    assert.equal(report.ok, false);
    for (const f of ['report.json', 'report.md', 'missing-text-390.png']) assert.ok(fs.existsSync(path.join(out, f)), f);
    assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /FAIL missing-text @ 390px/);
  });
  await new Promise(r => fixture.server.close(r));
  fs.rmSync(fixture.tmp, { recursive: true, force: true });
});

test('(ii) REAL design: the real home mock rendered against itself gives a pixel diff of exactly 0', async t => {
  if (NO_BROWSER) return t.skip('DESIGN_NO_BROWSER=1');
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
      assert.equal(r.checks.find(c => c.name === 'pixel-diff').pass, true);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('(i) REAL navy home FAILS the real home-first-visit contract (opt-in: DESIGN_BITE_NAVY=1)', async t => {
  if (process.env.DESIGN_BITE_NAVY !== '1') return t.skip('set DESIGN_BITE_NAVY=1 (needs a dist/ build + ~/work/r2l-releases/v105-20261019; run via scripts/design/bite-navy.sh)');
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
      const f = failedChecks(r);
      assert.ok(f.includes('order'), `${r.width}: contract order must fail, got ${f}`);
      assert.ok(f.includes('primary'), `${r.width}: primary must fail`);
      assert.ok(f.includes('pixel-diff'), `${r.width}: diff ceiling must fail`);
    }
  } finally { proc.kill('SIGTERM'); }
});
