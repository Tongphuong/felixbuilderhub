#!/usr/bin/env node
/**
 * Delete dormant self-serve signup codes — R2L-OPEN-ACCESS's Phase-3 hardening
 * (SPEC_R2L_OPEN_ACCESS.md §4, acceptance criterion 5).
 *
 * A "dormant" code is one that never turned into an actual reader:
 *   - record.origin === 'self_serve'  (never admin-created, never touched)
 *   - record.issued_at is more than 30 days old
 *   - record.progress.packs_created === 0 (embedded on the code record itself —
 *     never generated even one pack)
 *   - no `progress:<CODE>` KV key exists (the separate v2 state record used by
 *     loadProgressState/saveProgressState — never initialized, so the kid never
 *     opened a lesson)
 *
 * A self-serve code that has EITHER a pack generated OR a v2 progress state is
 * never touched, at any age. Admin-created codes (no `origin` field at all) are
 * never touched, regardless of age or activity.
 *
 * Safety:
 *   - DRY RUN IS THE DEFAULT. Nothing is deleted unless --apply is passed.
 *   - This deletes real KV records — the live --apply run happens only on
 *     Phương's explicit OK, logged in _ops/AGENT_LOG.md (mcp-infra-use.md:
 *     a KV write/delete to live student data is Elon-gated, not run by a worker).
 *   - Mark (this packet's author) built and unit-tested this with MOCKED KV
 *     ONLY (tests/cleanup-dormant-codes.test.mjs) and did not run it against
 *     any real KV namespace.
 *   - The dry-run output doubles as the weekly watcher named in the spec's
 *     Tradeoff Watch (rule 29): a self-serve code that never opens a lesson.
 *
 * Reuse-first: follows scripts/convert-coins-to-diamonds.mjs's established
 * convention exactly — same --namespace-id/READ2LEAD_KV_NAMESPACE_ID
 * resolution (no hardcoded default), same `wrangler kv` adapter shape, same
 * dry-run-default CLI contract — and reuses the product's own
 * isAccessCodeKey()/progressKey() helpers instead of hand-parsing KV keys.
 *
 * Usage:
 *   node scripts/cleanup-dormant-codes.mjs --namespace-id <id>            # dry run (default)
 *   node scripts/cleanup-dormant-codes.mjs --namespace-id <id> --apply    # live deletes
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/cleanup-dormant-codes.mjs --apply
 *
 * The KV namespace ID is REQUIRED, explicitly, via --namespace-id or the env
 * var — there is no hardcoded default (see convert-coins-to-diamonds.mjs for
 * why: a hardcoded ID is exactly the kind of thing that silently survives a
 * copy-paste into the wrong environment).
 */
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isAccessCodeKey, progressKey } from '../functions/api/_read2lead-v2-state.js';

const DORMANT_DAYS = 30;

/**
 * Resolve the KV namespace ID from --namespace-id or READ2LEAD_KV_NAMESPACE_ID
 * only — no hardcoded fallback. Returns null (never throws) so callers can
 * decide how to report the refusal.
 */
export function resolveKvNamespaceId({ argv = process.argv, env = process.env } = {}) {
  const flagIndex = argv.indexOf('--namespace-id');
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  return env.READ2LEAD_KV_NAMESPACE_ID || null;
}

function wrangler(args) {
  const cmd = ['npx', 'wrangler@latest', ...args].join(' ');
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

function kvGet(namespaceId, key) {
  try {
    const raw = wrangler([
      'kv', 'key', 'get', JSON.stringify(key),
      '--namespace-id', namespaceId,
      '--remote',
    ]).trim();
    if (!raw || raw === 'Value not found') return null;
    return JSON.parse(raw);
  } catch (error) {
    const message = String(error.stderr || error.stdout || error.message || '');
    if (message.includes('not found') || message.includes('404')) return null;
    throw error;
  }
}

function kvDelete(namespaceId, key) {
  wrangler([
    'kv', 'key', 'delete', JSON.stringify(key),
    '--namespace-id', namespaceId,
    '--remote',
    '--force',
  ]);
}

function kvListAllKeys(namespaceId) {
  const raw = wrangler(['kv', 'key', 'list', '--namespace-id', namespaceId, '--remote']);
  return JSON.parse(raw).map((entry) => entry.name);
}

/** Real Cloudflare KV, driven through `wrangler kv` (mirrors convert-coins-to-diamonds.mjs). */
function makeRemoteKv(namespaceId) {
  return {
    async get(key, options) {
      const value = kvGet(namespaceId, key);
      if (value == null) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async delete(key) {
      kvDelete(namespaceId, key);
    },
    async list() {
      return { keys: kvListAllKeys(namespaceId).map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}

function daysAgoISO(days, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Scan for dormant self-serve codes without deleting anything. Exported
 * separately from the delete step so the dry-run report and the --apply
 * pass always see and act on the exact same list.
 *
 * @param {{READ2LEAD_CODES: {list: Function, get: Function}}} env
 * @param {{now?: Date}} [options]
 */
export async function findDormantCodes(env, { now = new Date() } = {}) {
  const kv = env?.READ2LEAD_CODES;
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');

  const cutoff = daysAgoISO(DORMANT_DAYS, now);
  let cursor;
  let scanned = 0;
  let selfServeScanned = 0;
  const dormant = [];

  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await kv.list(cursor ? { cursor } : {});
    for (const entry of page.keys || []) {
      const code = entry.name;
      if (!isAccessCodeKey(code)) continue;
      scanned += 1;

      // eslint-disable-next-line no-await-in-loop
      const record = await kv.get(code, { type: 'json' });
      if (!record) continue;
      if (record.origin !== 'self_serve') continue; // never admin-created
      selfServeScanned += 1;

      if (!record.issued_at || record.issued_at > cutoff) continue; // not dormant yet

      const packsCreated = record.progress?.packs_created || 0;
      if (packsCreated !== 0) continue; // generated at least one pack — a real reader

      // eslint-disable-next-line no-await-in-loop
      const progressState = await kv.get(progressKey(code), { type: 'json' });
      if (progressState) continue; // v2 state exists — the kid opened a lesson

      dormant.push({
        code,
        issued_at: record.issued_at,
        student_name: record.student_profile?.student_name || record.progress?.student_name || '',
      });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  return { scanned, self_serve_scanned: selfServeScanned, dormant };
}

/**
 * @param {{READ2LEAD_CODES: {list: Function, get: Function, delete: Function}}} env
 * @param {{apply?: boolean, now?: Date}} [options]
 */
export async function cleanupDormantCodes(env, { apply = false, now = new Date() } = {}) {
  const { scanned, self_serve_scanned: selfServeScanned, dormant } = await findDormantCodes(env, { now });

  if (apply) {
    const kv = env.READ2LEAD_CODES;
    for (const item of dormant) {
      // eslint-disable-next-line no-await-in-loop
      await kv.delete(item.code);
    }
  }

  return {
    apply,
    scanned,
    self_serve_scanned: selfServeScanned,
    dormant_count: dormant.length,
    dormant,
  };
}

/**
 * CLI entry point, split out from main() so the namespace-ID refusal is
 * testable without touching real wrangler or process.exit.
 */
export async function runCli({ argv = process.argv, env = process.env } = {}) {
  const namespaceId = resolveKvNamespaceId({ argv, env });
  if (!namespaceId) {
    return {
      ok: false,
      error: 'missing_namespace_id',
      message: 'Refusing to run: no KV namespace ID provided. Pass --namespace-id <id> or set READ2LEAD_KV_NAMESPACE_ID.',
    };
  }
  const apply = argv.includes('--apply');
  const cliEnv = { READ2LEAD_CODES: makeRemoteKv(namespaceId) };
  const result = await cleanupDormantCodes(cliEnv, { apply });
  return { ok: true, namespace_id: namespaceId, result };
}

async function main() {
  const outcome = await runCli();
  if (!outcome.ok) {
    console.error('FAILED:', outcome.message);
    process.exitCode = 1;
    return;
  }
  const { result } = outcome;

  console.log(result.apply ? 'LIVE RUN — deletes applied.' : 'DRY RUN — nothing deleted. Pass --apply to delete for real.');
  console.log(`Namespace: ${outcome.namespace_id}`);
  console.log(`Scanned ${result.scanned} access-code records (${result.self_serve_scanned} self-serve).`);
  console.log(`Dormant self-serve codes (>${DORMANT_DAYS}d old, never used): ${result.dormant_count}`);
  for (const row of result.dormant) {
    console.log(`  ${row.code} (${row.student_name || 'no name'}), issued ${row.issued_at}`);
  }
  if (!result.dormant_count) {
    console.log('Nothing dormant — every scanned self-serve code is either recent or already in use.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
