import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gamesPage = readFileSync('src/pages/read2lead/games.astro', 'utf-8');

test('games hub is flag-gated and documents vocab API dependency', () => {
  assert.match(gamesPage, /isV3Enabled/);
  assert.match(gamesPage, /Nghe &amp; Chạm|Nghe & Chạm/);
  assert.match(gamesPage, /TODO.*pack_history/i);
});
