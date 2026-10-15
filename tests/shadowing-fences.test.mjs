import { astroJavaScriptSource } from './helpers/astro-javascript-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Buffet finding 5e: structural fences guarding the shadow_practice Azure
// bypass (speakup-shadowing-v1-p2) from being silently reused or disabled by
// an unrelated future refactor. Pattern-copied from the existing
// "economy-fence" style greps (e.g. tests/gift-ux.test.mjs's coin-economy
// fence) -- read the raw source, assert on literal strings, no execution.

const speakingCheckSource = readFileSync('functions/api/read2lead-speaking-check.js', 'utf8');



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
