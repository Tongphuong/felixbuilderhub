#!/usr/bin/env node
/**
 * R2L Season Honors — certificate PDF builder. READ-ONLY data plumbing:
 * reads real access-code + progress state from Cloudflare KV, shapes it into
 * the plain object scripts/report-card-template.mjs's renderCertificateHtml()
 * expects, renders one HTML file per (student, orientation), and prints each
 * to a single-page A4 PDF via the system's installed Chrome — no puppeteer/
 * playwright (see the packet: node_modules/@puppeteer is empty and
 * playwright-core is extraneous, both would die on the next `npm ci`).
 *
 * NEVER WRITES TO KV. Only scripts/grant-season-honors.mjs pays diamonds and
 * writes medals; this script only reads what it already wrote.
 *
 * Honors rank comes from the ALREADY-PAID medal on each student's live
 * progress state (state.medals[].kind === 'honors'), not from re-running
 * buildHonorsRanking()'s lifetime_rp ordering. This matters: the 2026-S1
 * podium was frozen with a founder-confirmed `--podium` override (app
 * leaderboard order — see grant-season-honors.mjs's PODIUM_OVERRIDE_BASIS_NOTE),
 * which does NOT match what buildHonorsRanking() would compute fresh. Reading
 * the medal is the only way to certificate the actual, real-money podium that
 * was paid, rather than a superseded ranking.
 *
 * Reuse-first: same makeRemoteKv()/resolveKvNamespaceId() adapter as every
 * other remote-KV script in this repo (scripts/_kv-remote.mjs), same
 * loadProgressState()/isAccessCodeKey() as season-census.mjs, same
 * honorsExclusionReason()/buildSeasonPronunciation()/maskCode() as
 * functions/api/_read2lead-honors.js, same SEASON_ID/SEASON_NAME_VI/
 * SEASON_EMOJI/HONORS constants as scripts/grant-season-honors.mjs (imported,
 * not duplicated — that file is owned by a different packet).
 *
 * Usage:
 *   node scripts/build-report-cards.mjs --namespace-id <id> --codes R2L-PHUPERCY-X567 --orientation landscape
 *   node scripts/build-report-cards.mjs --namespace-id <id> --codes CODE1,CODE2 --orientation portrait
 *   node scripts/build-report-cards.mjs --namespace-id <id> --all --orientation landscape   # EVERY real student — do not run casually
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/build-report-cards.mjs --codes CODE
 *
 * Output: <out-dir>/<Giay-Khen_Ascii-Name_Mua-He-2026[_Doc].pdf> plus a
 * cumulative <out-dir>/_index.csv (child name, masked code, parent_name,
 * filename). Default out-dir is OUTSIDE every git repo — real children's
 * names must never be committed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isAccessCodeKey, loadProgressState, RANK_TITLES } from '../functions/api/_read2lead-v2-state.js';
import { honorsExclusionReason, buildSeasonPronunciation, maskCode } from '../functions/api/_read2lead-honors.js';
import { SEASON_ID, SEASON_NAME_VI, SEASON_EMOJI } from './grant-season-honors.mjs';
import { SEASON_WINDOW } from './season-census.mjs';
import { makeRemoteKv, resolveKvNamespaceId as resolveKvNamespaceIdFor } from './_kv-remote.mjs';
import { renderCertificateHtml } from './report-card-template.mjs';

export const DEFAULT_OUT_DIR = '/home/felixbuilderhub/work/r2l-report-cards/2026-S1';
export const CHROME_BIN = '/usr/bin/google-chrome';
const PDF_MAX_BYTES = 500 * 1024;

export function resolveKvNamespaceId({ argv = process.argv, env = process.env } = {}) {
  return resolveKvNamespaceIdFor('READ2LEAD_KV_NAMESPACE_ID', { argv, env });
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** NFD-strip diacritics + explicit đ/Đ map (đ does not decompose under NFD) -> ASCII-safe filename segment. */
export function asciiFold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'Hoc-Sinh';
}

export function buildCertificateFilename(studentName, { orientation = 'landscape' } = {}) {
  const suffix = orientation === 'portrait' ? '_Doc' : '';
  return `Giay-Khen_${asciiFold(studentName)}_Mua-He-2026${suffix}.pdf`;
}

/**
 * Shape one {access_code, codeData, state} entry (same shape
 * scanSeasonEntries()/season-census.mjs produce) into the plain data object
 * renderCertificateHtml() expects. Exported and pure (no I/O) so it is
 * separately testable from the KV-reading/Chrome-shelling parts below.
 */
export function buildCertificateData({ codeData, state }) {
  const completedBooks = Array.isArray(codeData?.completed_books) ? codeData.completed_books.length : 0;
  const honorsMedal = (Array.isArray(state?.medals) ? state.medals : []).find(
    (medal) => medal?.kind === 'honors' && medal?.season_id === SEASON_ID,
  );
  const pronunciation = buildSeasonPronunciation({
    packHistory: state?.pack_history,
    fromIso: SEASON_WINDOW.from,
    toIso: SEASON_WINDOW.to,
  });

  return {
    studentName: state?.student_name || codeData?.student_profile?.student_name || '',
    seasonNameVi: SEASON_NAME_VI,
    seasonEmoji: SEASON_EMOJI,
    seasonFrom: SEASON_WINDOW.from,
    seasonTo: SEASON_WINDOW.to,
    honorsRank: Number.isFinite(Number(honorsMedal?.honors_rank)) ? Number(honorsMedal.honors_rank) : null,
    stats: {
      completedBooks,
      completedPacks: numberOrZero(state?.completed_packs),
      diamonds: numberOrZero(state?.diamonds),
      totalXp: numberOrZero(state?.total_xp),
      streakDays: numberOrZero(state?.streak_days),
      currentLevelLabel: RANK_TITLES[state?.current_level] || null,
    },
    pronunciation,
  };
}

/** Read one access-code record + its progress state. Read-only; never writes. */
async function readStudentEntry(env, accessCode) {
  const code = String(accessCode || '').trim().toUpperCase();
  if (!isAccessCodeKey(code)) {
    throw Object.assign(new Error(`not_an_access_code: ${code}`), { code: 'not_an_access_code' });
  }
  const codeData = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeData) {
    throw Object.assign(new Error(`code_not_found: ${code}`), { code: 'code_not_found' });
  }
  const state = await loadProgressState(env, code, codeData);
  return { access_code: code, codeData, state };
}

/** Print one rendered HTML string to a single-page A4 PDF via system Chrome. No new dependency. */
export function printHtmlToPdf(html, outPdfPath, { chromeBin = CHROME_BIN, execFileSyncFn = execFileSync } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'r2l-cert-'));
  const htmlPath = join(workDir, 'certificate.html');
  writeFileSync(htmlPath, html, 'utf8');
  try {
    execFileSyncFn(chromeBin, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${join(workDir, 'profile')}`,
      '--virtual-time-budget=10000',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outPdfPath}`,
      `file://${htmlPath}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Build + print certificates for the given access codes, one PDF per
 * (code, orientation). Returns index rows for _index.csv. READ-ONLY —
 * consumes an already-constructed `env` (see runCli) so tests can inject a
 * fake env instead of hitting real KV or Chrome.
 */
export async function buildReportCards({
  env,
  accessCodes,
  orientations = ['landscape'],
  outDir = DEFAULT_OUT_DIR,
  printFn = printHtmlToPdf,
  onSkip = (code, reason) => console.error(`SKIPPED ${code}: ${reason}`),
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const rows = [];

  for (const rawCode of accessCodes) {
    const accessCode = String(rawCode || '').trim().toUpperCase();
    let entry;
    try {
      // eslint-disable-next-line no-await-in-loop
      entry = await readStudentEntry(env, accessCode);
    } catch (error) {
      onSkip(accessCode, error.code || error.message);
      continue;
    }

    const reason = honorsExclusionReason(entry.codeData, entry.state);
    if (reason) {
      onSkip(accessCode, reason);
      continue;
    }

    const data = buildCertificateData(entry);
    if (!data.studentName) {
      onSkip(accessCode, 'no_name');
      continue;
    }

    for (const orientation of orientations) {
      const filename = buildCertificateFilename(data.studentName, { orientation });
      const outPath = join(outDir, filename);
      const html = renderCertificateHtml(data, { orientation });
      // eslint-disable-next-line no-await-in-loop
      await printFn(html, outPath);
      rows.push({
        student_name: data.studentName,
        masked_code: maskCode(accessCode),
        parent_name: entry.codeData?.parent_name || '',
        filename,
      });
    }
  }

  return rows;
}

/** Merge new rows into <outDir>/_index.csv, keyed by filename, and write it back. */
export function writeIndexCsv(outDir, newRows) {
  const path = join(outDir, '_index.csv');
  const header = 'student_name,masked_code,parent_name,filename';
  const existing = new Map();
  if (existsSync(path)) {
    const lines = readFileSync(path, 'utf8').split('\n').slice(1).filter(Boolean);
    for (const line of lines) {
      const cells = parseCsvLine(line);
      if (cells[3]) existing.set(cells[3], cells);
    }
  }
  for (const row of newRows) {
    existing.set(row.filename, [row.student_name, row.masked_code, row.parent_name, row.filename]);
  }
  const lines = [header, ...Array.from(existing.values()).map((cells) => cells.map(csvCell).join(','))];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function csvCell(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function parseArgs(argv) {
  const codesFlag = argv.indexOf('--codes');
  const codes = codesFlag !== -1 && argv[codesFlag + 1]
    ? argv[codesFlag + 1].split(',').map((c) => c.trim()).filter(Boolean)
    : [];
  const orientationFlag = argv.indexOf('--orientation');
  const orientationValue = orientationFlag !== -1 ? argv[orientationFlag + 1] : 'landscape';
  const orientations = orientationValue === 'both' ? ['landscape', 'portrait'] : [orientationValue];
  const outDirFlag = argv.indexOf('--out-dir');
  const outDir = outDirFlag !== -1 ? argv[outDirFlag + 1] : DEFAULT_OUT_DIR;
  return { codes, all: argv.includes('--all'), orientations, outDir };
}

export async function runCli({ argv = process.argv, env: procEnv = process.env } = {}) {
  const namespaceId = resolveKvNamespaceId({ argv, env: procEnv });
  if (!namespaceId) {
    return {
      ok: false,
      error: 'missing_namespace_id',
      message: 'Refusing to run: no KV namespace ID provided. Pass --namespace-id <id> or set READ2LEAD_KV_NAMESPACE_ID.',
    };
  }
  const { codes, all, orientations, outDir } = parseArgs(argv);
  if (!all && codes.length === 0) {
    return {
      ok: false,
      error: 'no_codes',
      message: 'Refusing to run: pass --codes CODE1,CODE2 or --all (every real student — do not run casually).',
    };
  }

  const cliEnv = { READ2LEAD_CODES: makeRemoteKv(namespaceId) };

  let accessCodes = codes;
  if (all) {
    const allKeys = [];
    let cursor;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await cliEnv.READ2LEAD_CODES.list(cursor ? { limit: 100, cursor } : { limit: 100 });
      for (const key of page.keys || []) if (isAccessCodeKey(key.name)) allKeys.push(key.name);
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    accessCodes = allKeys;
  }

  const rows = await buildReportCards({ env: cliEnv, accessCodes, orientations, outDir });
  const indexPath = writeIndexCsv(outDir, rows);
  return { ok: true, out_dir: outDir, index_path: indexPath, generated: rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((outcome) => {
    if (!outcome.ok) {
      console.error('FAILED:', outcome.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Wrote ${outcome.generated.length} PDF(s) to ${outcome.out_dir}`);
    for (const row of outcome.generated) console.log(`  ${row.filename}  (${row.masked_code})`);
    console.log(`Index: ${outcome.index_path}`);
    for (const row of outcome.generated) {
      const size = statSync(join(outcome.out_dir, row.filename)).size;
      if (size > PDF_MAX_BYTES) console.warn(`  WARNING: ${row.filename} is ${(size / 1024).toFixed(0)}KB, over the 500KB budget`);
    }
  }).catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
