import { parseMinnyConversationRequest, prepareMinnyConversation, completeMinnyConversation } from '../../api/minny-conversation.js';

const json = (error, status = 503) => Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
const leaseSeconds = 180;

/** Existing conversation behavior, with short atomic account operations and a
 * fenced per-session turn reservation. This does not enable real accounts. */
export async function accountConversation({ request, infrastructure, run, scheduleBackground }) {
  const parsedConversation = await parseMinnyConversationRequest(request);
  if (parsedConversation instanceof Response) return parsedConversation;
  if (String(parsedConversation.body?.action || '').trim().toLowerCase() !== 'audio' && typeof scheduleBackground !== 'function') {
    return json('conversation_background_host_required');
  }
  let prepared, sessionKey, leaseKey, expectedRaw;
  const token = crypto.randomUUID();
  const initial = await run(async accountEnv => {
    const result = await prepareMinnyConversation({ request, parsedConversation, env: { ...infrastructure, ...accountEnv } });
    if (result instanceof Response) return result;
    prepared = result;
    sessionKey = `convo-session:${prepared.sessionId}`;
    leaseKey = `convo-inflight:${prepared.sessionId}`;
    const kv = accountEnv.READ2LEAD_CODES;
    if (await kv.get(leaseKey)) return json('conversation_busy', 409);
    expectedRaw = await kv.get(sessionKey);
    await kv.put(leaseKey, JSON.stringify({ token, code: prepared.accessCode }), { expirationTtl: leaseSeconds });
    return new Response(null, { status: 204 });
  });
  if (initial.status !== 204) return initial;

  const observed = new Map(); let failedSessionWrite = false, committedTurn = null;
  const ownsLease = async kv => {
    const lease = await kv.get(leaseKey, { type: 'json' });
    return lease?.token === token && lease.code === prepared.accessCode;
  };
  const kind = key => key === sessionKey ? 'session'
    : /^tts:[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]{64}$/.test(key) ? 'cache'
    : ['debug:convo-flags', 'debug:convo-timing'].includes(key) ? 'diagnostic'
    : committedTurn !== null && key === `convo-audio:${prepared.sessionId}:${committedTurn}` ? 'audio' : null;
  const checked = async (key, operation) => {
    const type = kind(key); if (!type) throw Error('conversation_metadata_key_refused');
    const response = await run(async env => {
      const kv = env.READ2LEAD_CODES;
      if (!await kv.get(prepared.accessCode)) return json('conversation_account_changed', 409);
      if (type === 'session' && (!await ownsLease(kv) || await kv.get(sessionKey) !== expectedRaw)) return json('conversation_changed', 409);
      if (type === 'audio' && failedSessionWrite) return json('conversation_changed', 409);
      return operation(kv, type);
    });
    if (!response.ok) {
      if (type === 'session') failedSessionWrite = true;
      throw Error('conversation_metadata_unavailable');
    }
    return response.json();
  };
  const store = {
    async get(key, options) {
      if (options?.type !== 'json') throw Error('conversation_metadata_type_refused');
      const result = await checked(key, async kv => Response.json({ raw: await kv.get(key) }));
      observed.set(key, result.raw);
      return result.raw === null ? null : JSON.parse(result.raw);
    },
    async put(key, value, options) {
      if (typeof value !== 'string') throw Error('conversation_metadata_value_refused');
      const result = await checked(key, async (kv, type) => {
        if ((type === 'session' || type === 'audio') && JSON.parse(value)?.code !== prepared.accessCode) return json('conversation_owner_changed', 409);
        if (type === 'diagnostic' && observed.has(key) && await kv.get(key) !== observed.get(key)) return json('conversation_metadata_changed', 409);
        await kv.put(key, value, options);
        return Response.json({ raw: value, type });
      });
      observed.set(key, result.raw);
      if (result.type === 'session') { expectedRaw = value; committedTurn = JSON.parse(value).turns; }
    },
    async delete(key) {
      if (key !== sessionKey) throw Error('conversation_metadata_key_refused');
      await checked(key, async kv => { await kv.delete(key); return Response.json({ deleted: true }); });
      expectedRaw = null;
    },
  };
  let response;
  try {
    response = await completeMinnyConversation({ request, env: { ...infrastructure, READ2LEAD_CODES: store },
      waitUntil: promise => scheduleBackground(Promise.resolve(promise).catch(() => {})),
    }, prepared);
  } catch { response = json('conversation_unavailable'); }
  const final = await run(async env => {
    const kv = env.READ2LEAD_CODES, owned = await ownsLease(kv);
    const valid = !failedSessionWrite && owned && Boolean(await kv.get(prepared.accessCode)) && await kv.get(sessionKey) === expectedRaw;
    if (owned) await kv.delete(leaseKey);
    return valid ? new Response(null, { status: 204 }) : json('conversation_changed', 409);
  });
  return final.status === 204 ? response : final;
}
