// Design lock (R2L-ISLAND, spec "Design Lock" item 1): the approved handoff is frozen.
// Recomputes sha256 of every file under _design/read2lead-dao-phieu-luu and compares with
// MANIFEST.sha256: a changed, added or removed file FAILS. Fast (hashing ~5 MB).
// The BITE test below proves each failure mode on a scratch copy (rule 28).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCKED = path.join(root, '_design', 'read2lead-dao-phieu-luu');

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}
const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function verifyLock(dir) {
  const mp = path.join(dir, 'MANIFEST.sha256');
  if (!fs.existsSync(mp)) return ['MANIFEST.sha256 is missing'];
  const want = new Map();
  for (const line of fs.readFileSync(mp, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!m) return ['malformed manifest line: ' + line];
    want.set(m[2], m[1]);
  }
  const problems = [];
  if (want.size === 0) problems.push('manifest is empty');
  const have = walk(dir).filter(f => f !== 'MANIFEST.sha256');
  for (const f of have) {
    if (!want.has(f)) problems.push('ADDED (not in manifest): ' + f);
    else if (sha(path.join(dir, f)) !== want.get(f)) problems.push('CHANGED: ' + f);
  }
  for (const f of want.keys()) if (!have.includes(f)) problems.push('REMOVED: ' + f);
  return problems;
}

test('locked design matches MANIFEST.sha256 exactly', () => {
  assert.deepEqual(verifyLock(LOCKED), []);
});

test('manifest covers the whole handoff (94 files incl. mocks, screenshots, fonts)', () => {
  const text = fs.readFileSync(path.join(LOCKED, 'MANIFEST.sha256'), 'utf8');
  assert.equal(text.trim().split('\n').length, 94);
  for (const must of ['design-system/tokens.css', 'design-system/tokens.json', 'design-system/r2l.css', 'mocks/01-home-390.html', 'mocks/_index.tsv', 'README.md'])
    assert.ok(text.includes('  ' + must), must);
});

test('BITE: a changed, added or removed file is caught', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-lock-'));
  try {
    fs.cpSync(LOCKED, tmp, { recursive: true });
    assert.deepEqual(verifyLock(tmp), [], 'pristine copy must verify');
    const f = path.join(tmp, 'mocks', '01-home-390.html');
    const orig = fs.readFileSync(f);
    fs.appendFileSync(f, ' ');
    assert.deepEqual(verifyLock(tmp), ['CHANGED: mocks/01-home-390.html']);
    fs.writeFileSync(f, orig);
    fs.writeFileSync(path.join(tmp, 'extra.txt'), 'x');
    assert.deepEqual(verifyLock(tmp), ['ADDED (not in manifest): extra.txt']);
    fs.rmSync(path.join(tmp, 'extra.txt'));
    fs.rmSync(path.join(tmp, 'README.md'));
    assert.deepEqual(verifyLock(tmp), ['REMOVED: README.md']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('_design/ is outside src/ and public/, so Astro/Vite never builds or serves it', () => {
  assert.ok(!LOCKED.startsWith(path.join(root, 'src')) && !LOCKED.startsWith(path.join(root, 'public')));
  const dist = path.join(root, 'dist');
  if (fs.existsSync(dist)) assert.ok(!fs.existsSync(path.join(dist, '_design')), 'dist/ must not contain _design');
});
