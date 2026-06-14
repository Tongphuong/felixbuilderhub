import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ceremonySource = readFileSync(
  'src/components/read2lead/v4/EquipCeremony.astro',
  'utf8',
);
const audioSource = readFileSync('src/lib/r2l-w6-audio.ts', 'utf8');

test('ceremony accepts all current and future rarity props', () => {
  assert.match(
    ceremonySource,
    /rarity\?: 'common' \| 'rare' \| 'epic' \| 'legendary'/,
  );
});

test('common rarity keeps the three-second baseline', () => {
  assert.match(
    ceremonySource,
    /\.r2l-equip-ceremony\s*{[\s\S]*?--r2l-ceremony-duration:\s*3s;/,
  );
  assert.match(ceremonySource, /rarity = 'common'/);
});

test('rare rarity shortens the ceremony to two seconds', () => {
  assert.match(
    ceremonySource,
    /\[data-rarity='rare'\]\s*{[\s\S]*?--r2l-ceremony-duration:\s*2s;/,
  );
});

test('epic rarity extends the ceremony to four seconds', () => {
  assert.match(
    ceremonySource,
    /\[data-rarity='epic'\]\s*{[\s\S]*?--r2l-ceremony-duration:\s*4s;/,
  );
});

test('legendary rarity falls back to the three-second baseline', () => {
  assert.doesNotMatch(
    ceremonySource,
    /\[data-rarity='legendary'\]\s*{[\s\S]*?--r2l-ceremony-duration:/,
  );
});

test('ceremony animation consumes the rarity duration variable', () => {
  assert.match(
    ceremonySource,
    /animation:\s*r2l-ceremony-flash var\(--r2l-ceremony-duration\) ease-out both;/,
  );
});

test('rare ceremony maps to the quiet Kenney coin clink', () => {
  assert.match(
    audioSource,
    /rare:\s*{[\s\S]*?path: '\/audio\/kenney\/coin-clink\.mp3'[\s\S]*?volume: 0\.35/,
  );
});

test('epic ceremony maps to an extended Kenney quest complete stinger', () => {
  assert.match(
    audioSource,
    /epic:\s*{[\s\S]*?path: '\/audio\/kenney\/quest-complete\.mp3'[\s\S]*?tailDelayMs: 260/,
  );
});

test('common and legendary ceremonies stay silent', () => {
  assert.doesNotMatch(audioSource, /common:\s*{/);
  assert.doesNotMatch(audioSource, /legendary:\s*{/);
  assert.match(audioSource, /if \(!config \|\| isMuted\(\)\) return;/);
});

test('stinger audio is fetched lazily when the ceremony opens', () => {
  assert.match(audioSource, /const promise = import\('howler'\)/);
  assert.match(audioSource, /preload: false/);
  assert.match(ceremonySource, /new MutationObserver\(playWhenOpen\)/);
  assert.match(ceremonySource, /playTierStinger\(/);
});
