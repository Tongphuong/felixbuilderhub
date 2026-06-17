/** Safe bulk clear of unfinished Read2Lead packs on access-code KV records.
 *
 * Touches ONLY `{ACCESS_CODE}` → `progress.current_pack`.
 * Never reads or writes `progress:{ACCESS_CODE}` (rank / XP / level_progress).
 */

export const DEFAULT_CLEAR_STATUSES = ['generation_in_progress', 'awaiting_review'];

export function normalizeClearStatuses(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_CLEAR_STATUSES];
  const allowed = new Set(DEFAULT_CLEAR_STATUSES);
  const picked = raw
    .map((s) => String(s || '').trim())
    .filter((s) => allowed.has(s));
  return picked.length ? picked : [...DEFAULT_CLEAR_STATUSES];
}

export function shouldClearOpenPack(pack, statuses) {
  if (!pack || typeof pack !== 'object') return false;
  const status = String(pack.status || '').trim();
  return Boolean(status) && statuses.includes(status);
}

function isAccessCodeKey(name) {
  const key = String(name || '').trim();
  if (!key || key.startsWith('task:') || key.startsWith('progress:')) return false;
  return key.startsWith('R2L-');
}

export async function clearOpenLessonsFromKv(kv, options = {}) {
  const statuses = normalizeClearStatuses(options.statuses);
  const dryRun = Boolean(options.dryRun);
  const onlyCodes = Array.isArray(options.onlyCodes)
    ? options.onlyCodes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
    : null;

  let cursor;
  let scanned = 0;
  const cleared = [];
  const skipped = [];

  do {
    const page = await kv.list({ limit: 100, cursor });
    cursor = page.list_complete ? undefined : page.cursor;

    for (const key of page.keys) {
      if (!isAccessCodeKey(key.name)) continue;
      if (onlyCodes && !onlyCodes.includes(key.name)) continue;

      scanned += 1;
      const record = await kv.get(key.name, { type: 'json' });
      const currentPack = record?.progress?.current_pack;
      if (!currentPack) continue;

      if (!shouldClearOpenPack(currentPack, statuses)) {
        skipped.push({
          code: key.name,
          status: currentPack.status || null,
        });
        continue;
      }

      const taskId = currentPack.task_id || currentPack.generation_task_id || null;
      const entry = {
        code: key.name,
        previous_status: currentPack.status,
        pack_id: currentPack.pack_id || null,
        task_id: taskId,
      };

      if (!dryRun) {
        const updated = {
          ...record,
          progress: {
            ...record.progress,
            current_pack: null,
          },
        };
        await kv.put(key.name, JSON.stringify(updated));
        if (taskId) {
          try {
            await kv.delete(`task:${taskId}`);
          } catch {
            // Non-fatal — task KV may already be expired.
          }
        }
      }

      cleared.push(entry);
    }
  } while (cursor);

  return {
    dry_run: dryRun,
    statuses,
    scanned,
    cleared_count: cleared.length,
    cleared,
    skipped_with_other_status: skipped,
  };
}
