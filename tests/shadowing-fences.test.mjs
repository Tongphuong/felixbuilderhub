import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Buffet finding 5e: structural fences guarding the shadow_practice Azure
// bypass (speakup-shadowing-v1-p2) from being silently reused or disabled by
// an unrelated future refactor. Pattern-copied from the existing
// "economy-fence" style greps (e.g. tests/gift-ux.test.mjs's coin-economy
// fence) -- read the raw source, assert on literal strings, no execution.

const speakUpSource = readFileSync('src/pages/speak-up.astro', 'utf8');
const speakingCheckSource = readFileSync('functions/api/read2lead-speaking-check.js', 'utf8');

test('speak-up.astro (homework/fix-it practice requests) never emits shadow_practice', () => {
  // speak-up.astro's fix-it/practice request builders share the same
  // multipart request shape the Shadowing page uses to reach this endpoint.
  // If a future refactor ever merged those builders with Shadowing's, this
  // string appearing here would mean a homework/fix-it attempt silently
  // stopped reaching Azure Pronunciation Assessment -- the bug this test
  // exists to catch before it ships.
  assert.doesNotMatch(speakUpSource, /shadow_practice/, 'speak-up.astro must never send shadow_practice -- that would silently disable Azure PA for homework/fix-it attempts');
});

test('read2lead-speaking-check.js still gates the Azure bypass on !shadowPractice', () => {
  // Belt for the gate itself: if this clause is ever removed (accidentally
  // "simplified" away in a future edit), shadow_practice would stop
  // bypassing Azure -- or worse, some other path could start bypassing it
  // unconditionally. Either way, this fence must fail loudly.
  assert.match(
    speakingCheckSource,
    /checkMode === 'read' && env && azureSpeechConfigured\(env\) && isWav && !shadowPractice/,
    'the Azure read-mode gate must still be conditioned on !shadowPractice',
  );
});
