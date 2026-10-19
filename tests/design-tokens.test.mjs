// Token + font guards (R2L-ISLAND, spec "Design Lock" item 2).
//  - src/styles/r2l-tokens.css: every --r2l-* token of the locked design-system/tokens.css declared
//    EXACTLY ONCE, in a top-level :root (not in @media/@supports/any other block), identical value.
//  - No other declaration of a design token anywhere in shipped source (src/**, public/**) or the
//    built dist CSS/HTML (an override would silently re-skin the design).
//  - public/fonts/r2l/*.woff2 byte-identical to design-system/fonts/*.woff2.
// SKIP rule: a guard may skip ("not yet present") ONLY until the first screen lands. It FAILS when
// DESIGN_TOKENS_REQUIRED=1 or as soon as any data-design attribute exists under src/. A target that
// exists but is wrong always FAILS. The BITE tests prove each of these on scratch trees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCustomProps, tokenProblems, fontProblems, shippedProblems, guardsRequired } from '../scripts/design/lib/token-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = path.join(root, '_design', 'read2lead-dao-phieu-luu', 'design-system');
const DESIGN_CSS = fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8');
const BUILT_TOKENS = path.join(root, 'src', 'styles', 'r2l-tokens.css');
const BUILT_FONTS = path.join(root, 'public', 'fonts', 'r2l');

// Decision shared by the real tests and the bite tests: 'skip' only when allowed.
function decide(rootDir, targetExists, env) {
  if (targetExists) return 'check';
  return guardsRequired(rootDir, env) ? 'fail-missing' : 'skip';
}

test('r2l-tokens.css carries every design token exactly once, in :root, with an identical value', t => {
  const d = decide(root, fs.existsSync(BUILT_TOKENS), process.env);
  if (d === 'skip') return t.skip('src/styles/r2l-tokens.css not yet present (no data-design in src/ yet)');
  assert.notEqual(d, 'fail-missing', 'src/styles/r2l-tokens.css is REQUIRED now (DESIGN_TOKENS_REQUIRED=1 or a data-design attribute exists in src/) but is missing');
  assert.deepEqual(tokenProblems(DESIGN_CSS, fs.readFileSync(BUILT_TOKENS, 'utf8')), []);
});

test('no shipped source or built CSS redeclares a design token', () => {
  assert.deepEqual(shippedProblems(root, DESIGN_CSS), []);
});

test('public/fonts/r2l/*.woff2 are byte-identical to the design fonts', t => {
  const d = decide(root, fs.existsSync(BUILT_FONTS), process.env);
  if (d === 'skip') return t.skip('public/fonts/r2l not yet present (no data-design in src/ yet)');
  assert.notEqual(d, 'fail-missing', 'public/fonts/r2l is REQUIRED now but is missing');
  assert.deepEqual(fontProblems(path.join(DESIGN, 'fonts'), BUILT_FONTS), []);
});

// ------------------------------- bite tests -------------------------------
const types = ps => ps.map(p => p.split(/[ :]/)[0] + ' ' + p.split(/[ :]/)[1]);

test('BITE token parser: sees the ~54 design tokens, each once', () => {
  const ds = parseCustomProps(DESIGN_CSS);
  assert.ok(ds.length >= 50);
  assert.equal(new Set(ds.map(d => d.name)).size, ds.length, 'design tokens are unique');
  assert.ok(ds.every(d => d.context.length === 1 && d.context[0] === ':root'));
});

test('BITE tokens: identical copy passes; missing / changed / duplicated / @media / non-:root all FAIL', () => {
  assert.deepEqual(tokenProblems(DESIGN_CSS, DESIGN_CSS), []);
  assert.deepEqual(tokenProblems(DESIGN_CSS, DESIGN_CSS.replace(/--r2l-ink: #17324D;/, '')), ['MISSING --r2l-ink']);
  assert.deepEqual(types(tokenProblems(DESIGN_CSS, DESIGN_CSS.replace('--r2l-sun: #FFC83D;', '--r2l-sun: #FFC83E;'))), ['DIFFERENT --r2l-sun']);
  // whitespace/comment differences are not differences
  assert.deepEqual(tokenProblems(DESIGN_CSS, DESIGN_CSS.replace('--r2l-sun: #FFC83D;', '--r2l-sun:   #FFC83D ; /* x */')), []);
  // declared twice (a later override)
  const dup = DESIGN_CSS + '\n:root{--r2l-sun:#FFC83D;}';
  assert.ok(tokenProblems(DESIGN_CSS, dup).some(p => p.startsWith('DECLARED 2x --r2l-sun')));
  // an override hidden in a media query, in a class, in a compound selector
  for (const wrap of ['@media (max-width:400px){:root{--r2l-sun:#000}}', '.dark{--r2l-sun:#FFC83D}', '@supports (display:grid){:root{--r2l-sun:#FFC83D}}']) {
    const ps = tokenProblems(DESIGN_CSS, DESIGN_CSS + '\n' + wrap);
    assert.ok(ps.some(p => p.startsWith('WRONG CONTEXT --r2l-sun')), wrap + ' => ' + ps.join('|'));
  }
  // the design token moved into a media query entirely
  const moved = DESIGN_CSS.replace(':root {', '@media (min-width:1px){:root {').replace(/\}\s*$/, '}}');
  assert.ok(tokenProblems(DESIGN_CSS, moved).some(p => p.startsWith('WRONG CONTEXT')));
});

test('BITE fonts: identical copies pass; a changed byte and a missing file FAIL', () => {
  const fontsDir = path.join(DESIGN, 'fonts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-fonts-'));
  try {
    for (const f of fs.readdirSync(fontsDir).filter(x => x.endsWith('.woff2'))) fs.copyFileSync(path.join(fontsDir, f), path.join(tmp, f));
    assert.deepEqual(fontProblems(fontsDir, tmp), []);
    const f = path.join(tmp, 'Nunito-latin.woff2');
    const buf = fs.readFileSync(f); buf[100] ^= 0xff; fs.writeFileSync(f, buf);
    assert.deepEqual(fontProblems(fontsDir, tmp), ['DIFFERENT bytes Nunito-latin.woff2']);
    fs.rmSync(f);
    assert.deepEqual(fontProblems(fontsDir, tmp), ['MISSING font Nunito-latin.woff2']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

function scratch(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-ship-'));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); }
  return tmp;
}

test('BITE shipped CSS: an override in src (css, astro style, inline style, setProperty) or dist FAILS; var() uses and the bundled :root copy pass', () => {
  const ok = scratch({
    'src/styles/r2l-tokens.css': DESIGN_CSS,
    'src/styles/other.css': '.a{color:var(--r2l-ink);background:var(--r2l-sun, #fff)}',
    'src/components/A.astro': '<div style="color: var(--r2l-ink)"></div><style>.b{border:1px solid var(--r2l-ink)}</style>',
    'dist/_astro/x.css': ':root{--r2l-ink:#17324d;--r2l-sun:#ffc83d}.a{color:var(--r2l-ink)}',
  });
  const bad = (rel, text) => { const d = scratch({ 'src/styles/r2l-tokens.css': DESIGN_CSS, [rel]: text }); try { return shippedProblems(d, DESIGN_CSS); } finally { fs.rmSync(d, { recursive: true, force: true }); } };
  try {
    assert.deepEqual(shippedProblems(ok, DESIGN_CSS), []);
    assert.ok(bad('src/styles/over.css', ':root{--r2l-sun:#000}')[0].startsWith('OVERRIDE --r2l-sun'));
    assert.ok(bad('src/components/B.astro', '<style>.x{--r2l-sun: #111}</style>')[0].startsWith('OVERRIDE --r2l-sun'));
    assert.ok(bad('src/pages/c.astro', '<div style="--r2l-sky:#000"></div>')[0].startsWith('OVERRIDE --r2l-sky'));
    assert.ok(bad('src/scripts/d.mjs', "document.documentElement.style.setProperty('--r2l-ink', '#fff')")[0].startsWith('OVERRIDE --r2l-ink'));
    assert.ok(bad('dist/_astro/y.css', '@media (max-width:500px){:root{--r2l-sun:#000}}')[0].startsWith('DIST --r2l-sun declared inside'));
    assert.ok(bad('dist/_astro/y.css', ':root{--r2l-sun:#000}')[0].startsWith('DIST --r2l-sun has value'));
    assert.ok(bad('dist/_astro/y.css', ':root{--r2l-sun:#ffc83d}.x{--r2l-sun:#ffc83d}').some(p => p.includes('declared inside')));
    assert.ok(bad('dist/index.html', '<style>:root{--r2l-ink:#000}</style>')[0].startsWith('DIST --r2l-ink has value'));
  } finally { fs.rmSync(ok, { recursive: true, force: true }); }
});

test('BITE skip expiry: guards may skip only while no screen exists; DESIGN_TOKENS_REQUIRED=1 or any data-design in src/ makes a missing file FAIL', () => {
  const none = scratch({ 'src/a.astro': '<div class="x"></div>' });
  const marked = scratch({ 'src/pages/read2lead/index.astro': '<section data-design="home.hero"></section>' });
  try {
    assert.equal(decide(none, false, {}), 'skip');
    assert.equal(decide(none, false, { DESIGN_TOKENS_REQUIRED: '1' }), 'fail-missing');
    assert.equal(decide(marked, false, {}), 'fail-missing');
    assert.equal(decide(marked, true, {}), 'check');
    assert.equal(guardsRequired(none, {}), false);
  } finally { for (const d of [none, marked]) fs.rmSync(d, { recursive: true, force: true }); }
});
