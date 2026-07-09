// Guard: the ESM helper modules that lesson.astro inlines into *classic*
// <script is:inline> blocks must survive the de-export transform with ZERO
// top-level `export` left, and must parse as classic scripts.
//
// This is the test that was missing when commit ff48675 added
// `export const BOOK_READER_SCROLL_ANCHOR_ID` to read2lead-book-flow.mjs: the
// old inline regex only stripped `export function`, so the `export const` leaked
// into a classic script, the browser threw "Unexpected token 'export'", and every
// book/comic reading pack rendered blank. Keep this green.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { stripInlineExports } from '../src/lib/inline-esm.mjs';

// The exact set of modules lesson.astro imports `?raw` and inlines as classic
// scripts (see src/pages/read2lead/lesson.astro).
const INLINED_HELPERS = [
  '../src/lib/read2lead-dictation.ts',
  '../src/lib/read2lead-book-flow.mjs',
];

function readHelper(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

for (const relPath of INLINED_HELPERS) {
  test(`${relPath}: no top-level export survives inlining`, () => {
    const inlined = stripInlineExports(readHelper(relPath));
    const leaked = inlined
      .split('\n')
      .filter((line) => /^export\b/.test(line));
    assert.deepEqual(
      leaked,
      [],
      `these lines still start with \`export\` after stripInlineExports and would throw `
        + `"Unexpected token 'export'" in a classic <script>:\n${leaked.join('\n')}`,
    );
  });

  test(`${relPath}: inlined output parses as a classic script`, () => {
    let inlined = stripInlineExports(readHelper(relPath));
    // read2lead-dictation.ts carries TS type annotations; strip the ones the
    // browser never sees (Astro/Vite transpiles .ts before inlining). For the
    // .mjs there is nothing to strip. We only need to prove the export handling
    // is correct, so drop simple `: Type` return/param annotations heuristically
    // is overkill — instead just assert the .mjs (pure JS) parses, and for .ts
    // assert only the export-stripping invariant above.
    if (relPath.endsWith('.mjs')) {
      assert.doesNotThrow(
        () => new Function(inlined),
        'inlined helper must be valid classic-script JavaScript',
      );
    }
  });
}

test('stripInlineExports strips export const, let, class and async function', () => {
  const src = [
    'export function a() {}',
    'export async function b() {}',
    'export const c = 1;',
    'export let d = 2;',
    'export var e = 3;',
    'export class F {}',
  ].join('\n');
  const out = stripInlineExports(src);
  assert.equal(/^export\b/m.test(out), false);
  assert.match(out, /^function a\(\) \{\}$/m);
  assert.match(out, /^async function b\(\) \{\}$/m);
  assert.match(out, /^const c = 1;$/m);
  assert.match(out, /^class F \{\}$/m);
});

test('stripInlineExports leaves re-exports and default exports untouched', () => {
  // These can't be trivially inlined; they should error loudly, not silently
  // half-transform. So the stripper must NOT touch them.
  const src = 'export { a };\nexport default b;';
  assert.equal(stripInlineExports(src), src);
});
