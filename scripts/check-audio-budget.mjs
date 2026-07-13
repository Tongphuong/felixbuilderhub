import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AUDIO_DIR = path.resolve(__dirname, '../public/audio/kenney');
const BUDGET_BYTES = 200 * 1024; // 200 KB

// Injectable, per _ops/AGENTS.md rule 28a: a verifier that hardcodes what it inspects
// cannot be fed a known-bad input, and so cannot be trusted. The half of this script
// that actually gates anything — `process.exit(overBudget ? 1 : 0)` — had NO test at
// all: tests/audio-budget.test.mjs calls getAudioStats() and asserts on its return
// value, never running the script or checking an exit code. Buffet hardcoded
// `process.exit(0)` here and that test still passed 3/3 while the gate reported
// success unconditionally.
export function getAudioStats(dir = process.env.AUDIO_DIR || DEFAULT_AUDIO_DIR) {
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3'));
  const sizes = entries.map((name) => {
    const stat = fs.statSync(path.join(dir, name));
    return { name, bytes: stat.size };
  });
  const total = sizes.reduce((sum, e) => sum + e.bytes, 0);
  return { entries: sizes, total, budget: BUDGET_BYTES, overBudget: total > BUDGET_BYTES };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stats = getAudioStats(process.argv[2] || undefined);
  for (const e of stats.entries) {
    console.log(`${e.name.padEnd(30)} ${(e.bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`---`);
  console.log(`Total: ${(stats.total / 1024).toFixed(1)} KB / Budget: ${(stats.budget / 1024).toFixed(0)} KB`);
  process.exit(stats.overBudget ? 1 : 0);
}
