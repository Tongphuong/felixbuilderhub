# V4 W2 — Audio asset budget CI test (1 Cursor agent)

**Owner:** Cursor · **Branch:** `cursor-N/w2-audio-budget` (off `origin/v4-w2`)
**Status:** READY — Z5 đã ship 8 audio files. Cần lock budget để future audio additions không vỡ bundle.

---

## 1. Goal

CI test verify tổng size `public/audio/kenney/*.mp3` ≤ 200KB (Z5 spec §10). Fail test nếu ai add audio file mới vượt budget.

## 2. Files allowed

- `tests/audio-budget.test.mjs` (NEW)
- `scripts/check-audio-budget.mjs` (NEW — reusable script anyone can run)

Cấm sửa file khác.

## 3. Implementation

### `scripts/check-audio-budget.mjs`

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.resolve(__dirname, '../public/audio/kenney');
const BUDGET_BYTES = 200 * 1024;  // 200 KB

export function getAudioStats() {
  const entries = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  const sizes = entries.map(name => {
    const stat = fs.statSync(path.join(AUDIO_DIR, name));
    return { name, bytes: stat.size };
  });
  const total = sizes.reduce((sum, e) => sum + e.bytes, 0);
  return { entries: sizes, total, budget: BUDGET_BYTES, overBudget: total > BUDGET_BYTES };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stats = getAudioStats();
  for (const e of stats.entries) {
    console.log(`${e.name.padEnd(30)} ${(e.bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`---`);
  console.log(`Total: ${(stats.total / 1024).toFixed(1)} KB / Budget: ${(stats.budget / 1024).toFixed(0)} KB`);
  process.exit(stats.overBudget ? 1 : 0);
}
```

### `tests/audio-budget.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { getAudioStats } from '../scripts/check-audio-budget.mjs';

test('audio kenney directory total size ≤ 200KB', () => {
  const stats = getAudioStats();
  assert.ok(
    !stats.overBudget,
    `Audio budget exceeded: ${stats.total} bytes (limit ${stats.budget}). Files: ${stats.entries.map(e => `${e.name}=${e.bytes}`).join(', ')}`,
  );
});

test('every audio file is non-empty', () => {
  const stats = getAudioStats();
  for (const e of stats.entries) {
    assert.ok(e.bytes > 0, `Empty audio file: ${e.name}`);
  }
});

test('expected audio files present (8 Kenney sounds from Z5)', () => {
  const stats = getAudioStats();
  const names = new Set(stats.entries.map(e => e.name));
  const expected = ['chest-shake.mp3', 'chest-crack.mp3', 'chest-burst.mp3', 'coin-clink.mp3', 'quest-complete.mp3', 'combo-tick.mp3', 'near-miss.mp3', 'daily-chest-claim.mp3'];
  for (const exp of expected) {
    assert.ok(names.has(exp), `Missing expected audio: ${exp}`);
  }
});
```

## 4. Done when

1. Script + test created.
2. `node --test tests/audio-budget.test.mjs` xanh.
3. `node scripts/check-audio-budget.mjs` exit 0, prints summary.
4. `node --test` toàn bộ xanh.
5. Branch pushed.
6. AGENT_LOG START + DONE với commit hash.

## 5. Constraints

- KHÔNG sửa audio file.
- KHÔNG thêm dep.
- Script file < 60 dòng, test file < 40 dòng.

## 6. Report

Per AGENTS.md §4 + paste `node scripts/check-audio-budget.mjs` output.
