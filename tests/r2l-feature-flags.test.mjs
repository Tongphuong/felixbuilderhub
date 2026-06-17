import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isV21Enabled,
  isV21EnabledFromFlag,
  shouldRenderAsV21,
  shouldRenderAsV21FromFlag,
} from '../src/lib/r2l-feature-flags.ts';

// `import.meta.env` does not exist under plain `node --test`, so the runtime
// `isV21Enabled()` / `shouldRenderAsV21()` evaluate against an unset flag.
// The pure `*FromFlag` helpers carry the actual flag logic and are tested
// directly with explicit flag values.

test('isV21Enabled returns false when PUBLIC_R2L_V21 is unset', () => {
  assert.equal(isV21Enabled(), false);
  assert.equal(isV21EnabledFromFlag(undefined), false);
  assert.equal(isV21EnabledFromFlag(''), false);
  assert.equal(isV21EnabledFromFlag('0'), false);
});

test('isV21Enabled returns true when PUBLIC_R2L_V21 is "1"', () => {
  assert.equal(isV21EnabledFromFlag('1'), true);
});

test('shouldRenderAsV21 returns true only when flag is "1" AND lesson.schema_version === "2.1"', () => {
  assert.equal(shouldRenderAsV21FromFlag('1', { schema_version: '2.1' }), true);
  assert.equal(shouldRenderAsV21FromFlag('0', { schema_version: '2.1' }), false);
  assert.equal(shouldRenderAsV21FromFlag('', { schema_version: '2.1' }), false);
  assert.equal(shouldRenderAsV21FromFlag('1', { schema_version: '2.0' }), false);
  // Runtime wrapper: flag is unset under node, so never renders as V2.1.
  assert.equal(shouldRenderAsV21({ schema_version: '2.1' }), false);
});

test('shouldRenderAsV21 returns false for V2.0 packs even when flag is on', () => {
  assert.equal(shouldRenderAsV21FromFlag('1', { schema_version: 2 }), false);
  assert.equal(shouldRenderAsV21FromFlag('1', { schema_version: '2' }), false);
  assert.equal(shouldRenderAsV21FromFlag('1', {}), false);
  assert.equal(shouldRenderAsV21FromFlag('1', null), false);
});
