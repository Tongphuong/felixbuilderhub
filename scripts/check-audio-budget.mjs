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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stats = getAudioStats();
  for (const e of stats.entries) {
    console.log(`${e.name.padEnd(30)} ${(e.bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`---`);
  console.log(`Total: ${(stats.total / 1024).toFixed(1)} KB / Budget: ${(stats.budget / 1024).toFixed(0)} KB`);
  process.exit(stats.overBudget ? 1 : 0);
}
