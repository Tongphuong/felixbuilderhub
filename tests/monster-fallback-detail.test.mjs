import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsFallbackMonster } from '../src/lib/monster-fallback.ts';

const manifest = JSON.parse(readFileSync(new URL('../src/data/monster-parts.json', import.meta.url), 'utf8'));
const hasPart = (slot, id) => (manifest[slot] || []).some((p) => p.id === id);

// The EXACT config a free-companion child saves on /read2lead/companion.
const SAVED = {
  body: 'png-default-body-whitec', eyes: 'png-default-eye-blue', mouth: 'png-default-moutha',
  arms: 'png-default-arm-whitea', detail: '', effects: '', frame: '', hat: '', pet: '', wings: '', color: 'mint',
};

// The pre-fix decision, verbatim from monster-avatar.ts (detail was a REQUIRED slot).
const CORE_OLD = ['body', 'eyes', 'mouth', 'arms', 'detail'];
const oldNeedsFallback = (config) => CORE_OLD.some((s) => config[s] === 'default' || !hasPart(s, config[s]));

test('KNOWN-BAD: the exact saved companion config drew the whole-monster fallback before the fix', () => {
  for (const slot of ['body', 'eyes', 'mouth', 'arms']) assert.ok(hasPart(slot, SAVED[slot]), `fixture ${slot} must be a real part`);
  assert.equal(oldNeedsFallback(SAVED), true, 'old code: empty detail forced the green-blob fallback');
  assert.equal(needsFallbackMonster(SAVED, hasPart), false, 'new code draws the real monster');
});

test('cross product: each required slot missing/unknown/default x detail empty/valid/unknown', () => {
  const validDetail = manifest.detail.find((p) => p.id)?.id;
  assert.ok(validDetail);
  const details = { empty: '', valid: validDetail, unknown: 'no-such-detail', missing: undefined };
  const bad = { missing: undefined, empty: '', unknown: 'no-such-part', default: 'default' };
  for (const [dName, detail] of Object.entries(details)) {
    // all required slots fine -> real monster regardless of detail
    assert.equal(needsFallbackMonster({ ...SAVED, detail }, hasPart), false, `good core + detail ${dName}`);
    for (const slot of ['body', 'eyes', 'mouth', 'arms']) {
      for (const [bName, value] of Object.entries(bad)) {
        assert.equal(needsFallbackMonster({ ...SAVED, detail, [slot]: value }, hasPart), true, `${slot} ${bName} + detail ${dName}`);
      }
    }
  }
});

test('optional cosmetic slots (effects/frame/hat/pet/wings) never trigger the fallback', () => {
  for (const slot of ['effects', 'frame', 'hat', 'pet', 'wings']) {
    for (const value of ['', undefined, 'no-such-part']) {
      assert.equal(needsFallbackMonster({ ...SAVED, [slot]: value }, hasPart), false, `${slot}=${value}`);
    }
  }
});

test('no manifest -> fallback; small (leaderboard) path shares the same decision', () => {
  assert.equal(needsFallbackMonster(SAVED, hasPart, false), true);
  const src = readFileSync(new URL('../src/lib/monster-avatar.ts', import.meta.url), 'utf8');
  assert.match(src, /needsFallbackMonster\(/);
  assert.equal((src.match(/renderFallbackMonster\(stack, config\)/g) || []).length, 1, 'single fallback call site for all sizes');
});
