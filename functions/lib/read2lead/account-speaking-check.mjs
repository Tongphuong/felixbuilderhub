import { prepareSpeakingCheck, completeSpeakingCheck } from '../../api/read2lead-speaking-check.js';
import { canAccessPackForPractice, resolveAccessiblePack } from '../../api/_read2lead-pack-access.js';

const json = (error, status = 503) => Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
function permission(record, prepared) {
  if (!record) return null;
  const allowed = prepared.practiceMode ? canAccessPackForPractice(record, prepared.packId)
    : record.progress?.current_pack?.pack_id === prepared.packId;
  if (!allowed) return null;
  const source = resolveAccessiblePack(record, prepared.packId);
  // Saving a reading position does not replace its content or permission.
  const { web_session_checkpoint, ...pack } = source || {};
  return JSON.stringify({ pack: source ? pack : null, homework: record.homework ?? null });
}

/** Restricted metadata access for the existing provider/coach helpers.
 * Each operation is a fresh short transaction. No account/balance writes. */
export function createSpeakingMetadataStore({ run, accessCode, authorize }) {
  const observed = new Map();
  const typeOf = key => key === `flagged-words:${accessCode}` ? 'feedback'
    : /^azure-pa-secs:\d{4}-\d{2}$/.test(key) ? 'usage'
    : key === 'debug:speaking-errors' ? 'diagnostic' : null;
  const checked = async (key, work) => {
    const type = typeOf(key); if (!type) throw Error('speaking_metadata_key_refused');
    const response = await run(async env => {
      if (type === 'feedback' && !await authorize(env)) return json('speaking_permission_changed', 409);
      return work(env.READ2LEAD_CODES, type);
    });
    if (!response.ok) throw Error('speaking_metadata_unavailable');
    return response.json();
  };
  return {
    async get(key, options) {
      if (options?.type !== 'json') throw Error('speaking_metadata_type_refused');
      const result = await checked(key, async kv => Response.json({ raw: await kv.get(key) }));
      observed.set(key, result.raw);
      return result.raw === null ? null : JSON.parse(result.raw);
    },
    async put(key, value, options) {
      if (typeof value !== 'string') throw Error('speaking_metadata_value_refused');
      const result = await checked(key, async (kv, type) => {
        const current = await kv.get(key); let next = value;
        if (type === 'usage') {
          // Existing Azure helper writes used+seconds. Preserve both completed
          // calls if another increment landed after its read; never decrement.
          if (!observed.has(key)) return json('speaking_usage_read_required', 409);
          const before = Number(JSON.parse(observed.get(key) ?? '0')) || 0;
          const delta = JSON.parse(value) - before;
          const present = Number(JSON.parse(current ?? '0')) || 0;
          if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(present + delta)) return json('speaking_usage_invalid', 409);
          next = JSON.stringify(present + delta);
        } else if (observed.has(key) && current !== observed.get(key)) {
          // A detached old safety retraction must not replace a newer attempt.
          return json('speaking_metadata_changed', 409);
        }
        await kv.put(key, next, options);
        return Response.json({ raw: next });
      });
      observed.set(key, result.raw);
    },
  };
}

export async function accountSpeakingCheck({ request, infrastructure, run, scheduleBackground }) {
  // Coach feedback starts detached safety work. A real host must retain it
  // through its platform waitUntil, never silently fire-and-forget it here.
  if (infrastructure.OPENROUTER_API_KEY && typeof scheduleBackground !== 'function') {
    return json('speaking_background_host_required');
  }
  let parsedFormData;
  // Neither a slow upload nor a provider should hold the account save queue.
  // On parse failure the original preflight still selects its config/400 error.
  try { parsedFormData = await request.formData(); } catch {}
  let prepared;
  const initial = await run(async accountEnv => {
    const result = await prepareSpeakingCheck({ request, parsedFormData, env: { ...infrastructure, ...accountEnv } });
    if (result instanceof Response) return result;
    prepared = result;
    return new Response(null, { status: 204 });
  });
  if (initial.status !== 204) return initial;
  const pin = permission(prepared.codeData, prepared);
  const authorize = async env => {
    const current = await env.READ2LEAD_CODES.get(prepared.accessCode, { type: 'json' });
    return pin !== null && permission(current, prepared) === pin;
  };
  const metadata = createSpeakingMetadataStore({ run, accessCode: prepared.accessCode, authorize });
  const response = await completeSpeakingCheck({ request,
    env: { ...infrastructure, READ2LEAD_CODES: metadata },
    waitUntil: promise => scheduleBackground(Promise.resolve(promise)),
  }, prepared);
  const final = await run(async env => await authorize(env) ? new Response(null, { status: 204 }) : json('speaking_permission_changed', 409));
  return final.status === 204 ? response : final;
}
