#!/usr/bin/env node
/**
 * Apply heuristic rarity tagging to monster-parts.json.
 *
 * Aligned with W4 inferRarityFromPartId expectation:
 * - horn-large + antenna-large → EPIC (10 parts: 2 types × 5 colors)
 * - horn-small + antenna-small → RARE
 * - body shape F variants → EPIC (dramatic)
 * - body shape E variants → RARE
 * - eye + mouth specials → RARE
 * - All else → common
 *
 * Phương can override these tags after reviewing thumbnails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../public/assets/monsters/monster-parts.json');

function classify(id) {
  const lower = id.toLowerCase();

  // EPIC patterns (~5% — most prized)
  if (lower.includes('horn-large') || lower.includes('antenna-large')) return 'epic';
  if (lower.match(/body-[a-z]*f$|body-darkf|body-redf/)) return 'epic';
  if (lower.match(/mouthj|mouthh/)) return 'epic'; // unusual mouths

  // RARE patterns (~15-20%)
  if (lower.includes('horn-small') || lower.includes('antenna-small')) return 'rare';
  if (lower.match(/body-[a-z]*e$|body-darke|body-rede/)) return 'rare';
  if (lower.match(/eyes-?large|eye-?cyclone|eye-?multi|eye-?spiral/)) return 'rare';
  if (lower.match(/mouth-?(fang|teeth|sharp|tongue)/)) return 'rare';
  if (lower.match(/arm-?(claw|tentacle|spike|dark)/)) return 'rare';

  return 'common';
}

function main() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);

  const counts = { common: 0, rare: 0, epic: 0 };
  const changes = [];

  for (const [slot, entries] of Object.entries(manifest)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry?.id) continue;
      const before = entry.rarity || 'common';
      const after = classify(entry.id);
      entry.rarity = after;
      counts[after] = (counts[after] || 0) + 1;
      if (before !== after) {
        changes.push({ id: entry.id, before, after });
      }
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Total: common=${counts.common} rare=${counts.rare} epic=${counts.epic}`);
  console.log(`Changes: ${changes.length}`);
}

main();
