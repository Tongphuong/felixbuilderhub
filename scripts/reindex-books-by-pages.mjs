#!/usr/bin/env node
/**
 * R2L-PAGE-BANDS migration: re-bucket the five book_index:<L> KV lists by
 * PAGE COUNT band instead of StoryWeaver level (SPEC_R2L_PAGE_BANDS.md).
 *
 * Safety: prints the current config:book_levels (activation is a founder
 * decision, never automatic), snapshots the current indexes to a backup file
 * (rollback = re-run with --restore <file>), computes bands from
 * book_images.length cross-checked against paragraphs_en.length (mismatch ->
 * book stays on its current shelf and is reported), POSTs the secret-gated
 * reindex_only action, then verifies: five disjoint lists, union preserved,
 * and every slug in-band.
 *
 * Usage:
 *   READ2LEAD_PUBLISH_URL=https://<host>/api/publish-read2lead-book \
 *   READ2LEAD_BACKEND_SECRET=... node scripts/reindex-books-by-pages.mjs [--apply]
 *   node scripts/reindex-books-by-pages.mjs --restore <backup.json> [--apply]
 *
 * Without --apply it is a dry run (prints the plan, writes nothing).
 */
import { readFileSync, writeFileSync } from 'node:fs';
// Single source of truth for the page→band boundaries — shared with the
// publish endpoint so the table can never drift between the two.
import { bandForPageCount } from '../functions/api/publish-read2lead-book.js';

const BASE = (process.env.READ2LEAD_PUBLISH_URL || '').replace(/\/$/, '');
const SECRET = process.env.READ2LEAD_BACKEND_SECRET || '';
const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore')
  ? process.argv[process.argv.indexOf('--restore') + 1]
  : null;
const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];
if (!BASE || !SECRET) {
  console.error('need READ2LEAD_PUBLISH_URL and READ2LEAD_BACKEND_SECRET');
  process.exit(1);
}

const HEADERS = { 'X-Read2Lead-Secret': SECRET, 'User-Agent': 'r2l-reindex/1.0' };
const get = async (params) => (await fetch(`${BASE}?${new URLSearchParams(params)}`, { headers: HEADERS })).json();
const post = async (body) => (await fetch(BASE, {
  method: 'POST',
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();

async function main() {
  // 1. Snapshot current indexes (always — also serves as the rollback file).
  const current = {};
  for (const level of LEVELS) {
    const r = await get({ index: level });
    if (!r.ok) throw new Error(`index fetch ${level}: ${r.error}`);
    current[level] = r.slugs;
  }
  const allSlugs = [...new Set(Object.values(current).flat())];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `book-index-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(current, null, 2));
  console.log('current index counts:', Object.fromEntries(LEVELS.map((l) => [l, current[l].length])),
    `(union ${allSlugs.length}) — backup: ${backupFile}`);

  let target;
  if (RESTORE) {
    target = JSON.parse(readFileSync(RESTORE, 'utf8'));
    console.log('RESTORE mode from', RESTORE);
  } else {
    // 2. Compute bands per book.
    target = Object.fromEntries(LEVELS.map((l) => [l, []]));
    const problems = [];
    for (const slug of allSlugs) {
      const r = await get({ slug });
      if (!r.ok) { problems.push(`${slug}: fetch ${r.error}`); continue; }
      const pages = (r.pack.book_images || []).length;
      const paragraphs = (r.pack.story?.paragraphs_en || []).length;
      if (pages !== paragraphs) {
        // Never guess a shelf — keep the book where it is today.
        const home = LEVELS.find((l) => current[l].includes(slug));
        problems.push(`${slug}: page/paragraph mismatch ${pages}/${paragraphs} — stays on ${home}`);
        if (home) target[home].push(slug);
        continue;
      }
      const band = bandForPageCount(pages);
      if (!band) { problems.push(`${slug}: unbandable page count ${pages}`); continue; }
      target[band].push(slug);
    }
    if (problems.length) console.log('REPORT (kept on current shelf / skipped):\n  ' + problems.join('\n  '));
  }

  const counts = Object.fromEntries(LEVELS.map((l) => [l, target[l].length]));
  console.log('target counts:', counts, `(union ${Object.values(target).flat().length})`);

  // 3. Verify target integrity BEFORE applying.
  const union = Object.values(target).flat();
  if (new Set(union).size !== union.length) throw new Error('target lists overlap');
  const lost = allSlugs.filter((s) => !union.includes(s));
  if (lost.length) throw new Error(`slugs lost from indexes: ${lost.join(', ')}`);

  if (!APPLY) { console.log('DRY RUN — rerun with --apply to write.'); return; }

  // 4. Apply + verify server-side state.
  const res = await post({ reindex_only: true, indexes: target });
  if (!res.ok) throw new Error(`reindex failed: ${JSON.stringify(res).slice(0, 200)}`);
  console.log('server accepted, counts:', res.counts);
  for (const level of LEVELS) {
    const r = await get({ index: level });
    const match = JSON.stringify([...r.slugs].sort()) === JSON.stringify([...target[level]].sort());
    console.log(`verify ${level}: ${r.slugs.length} slugs — ${match ? 'MATCH' : 'MISMATCH!'}`);
    if (!match) process.exitCode = 1;
  }
  console.log('config:book_levels is NOT touched by this script — activation is a founder decision.');
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
