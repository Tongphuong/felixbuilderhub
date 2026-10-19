// Token + font guards (R2L-ISLAND, spec "Design Lock" item 2).
//  - src/styles/r2l-tokens.css must declare every --r2l-* custom property of the locked
//    design-system/tokens.css with an IDENTICAL value (whitespace-normalised only).
//  - public/fonts/r2l/*.woff2 must be byte-identical to design-system/fonts/*.woff2.
// SKIP rule: a check skips ONLY when its target is absent ("not yet present" - Steve builds
// those files in parallel). A target that exists but is wrong FAILS. The BITE tests prove it
// on scratch copies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = path.join(root, '_design', 'read2lead-dao-phieu-luu', 'design-system');
const BUILT_TOKENS = path.join(root, 'src', 'styles', 'r2l-tokens.css');
const BUILT_FONTS = path.join(root, 'public', 'fonts', 'r2l');

function declarations(css) {
  const out = new Map(); // name -> [values in order]
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--r2l-[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const v = m[2].replace(/\s+/g, ' ').trim();
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(v);
  }
  return out;
}

export function tokenProblems(designCss, builtCss) {
  const want = declarations(designCss);
  const have = declarations(builtCss);
  const problems = [];
  if (want.size === 0) problems.push('design tokens.css declares no --r2l-* properties (parser broken?)');
  for (const [name, values] of want) {
    const got = have.get(name);
    if (!got) { problems.push(`MISSING ${name}`); continue; }
    for (const v of values) if (!got.includes(v)) problems.push(`DIFFERENT ${name}: design "${v}" vs built "${got.join('" / "')}"`);
  }
  return problems;
}

export function fontProblems(designFontsDir, builtFontsDir) {
  const names = fs.readdirSync(designFontsDir).filter(f => f.endsWith('.woff2'));
  const problems = [];
  if (!names.length) problems.push('design has no woff2 fonts (wrong dir?)');
  for (const n of names) {
    const b = path.join(builtFontsDir, n);
    if (!fs.existsSync(b)) problems.push(`MISSING font ${n}`);
    else if (!fs.readFileSync(b).equals(fs.readFileSync(path.join(designFontsDir, n)))) problems.push(`DIFFERENT bytes ${n}`);
  }
  return problems;
}

test('r2l-tokens.css carries every design token with an identical value', t => {
  if (!fs.existsSync(BUILT_TOKENS)) return t.skip('src/styles/r2l-tokens.css not yet present');
  assert.deepEqual(tokenProblems(fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8'), fs.readFileSync(BUILT_TOKENS, 'utf8')), []);
});

test('public/fonts/r2l/*.woff2 are byte-identical to the design fonts', t => {
  if (!fs.existsSync(BUILT_FONTS)) return t.skip('public/fonts/r2l not yet present');
  assert.deepEqual(fontProblems(path.join(DESIGN, 'fonts'), BUILT_FONTS), []);
});

test('BITE: token guard catches a missing token and a changed value, passes an identical copy', () => {
  const design = fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8');
  assert.ok(declarations(design).size >= 50, 'parser should see the ~54 design tokens');
  assert.deepEqual(tokenProblems(design, design), []);
  assert.deepEqual(tokenProblems(design, design.replace('--r2l-sun: #FFC83D;', '--r2l-sun: #FFC83E;')).map(p => p.split(':')[0]), ['DIFFERENT --r2l-sun']);
  assert.deepEqual(tokenProblems(design, design.replace(/--r2l-ink: #17324D;/, '')), ['MISSING --r2l-ink']);
  // whitespace/comment differences are NOT differences
  assert.deepEqual(tokenProblems(design, design.replace('--r2l-sun: #FFC83D;', '--r2l-sun:   #FFC83D ; /* x */')), []);
});

test('BITE: font guard catches a missing file and a changed byte, passes identical copies', () => {
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

test('BITE: a present-but-wrong built tokens file FAILS (never skips)', () => {
  // Same decision logic as the real test, run against a scratch "built" file.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-tok-'));
  try {
    const p = path.join(tmp, 'r2l-tokens.css');
    fs.writeFileSync(p, ':root{--r2l-ink:#000;}');
    assert.ok(fs.existsSync(p));
    assert.ok(tokenProblems(fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8'), fs.readFileSync(p, 'utf8')).length > 40);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
