import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { vietnamDateKey } from './_read2lead-v2-state.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const accessCode = (data.access_code || '').toString().trim().toUpperCase();
  const packId = (data.pack_id || '').toString().trim();
  const snapshot = data.snapshot;

  if (!accessCode || !packId || !snapshot || typeof snapshot !== 'object') {
    return json({ ok: false, error: 'missing_fields' }, 400);
  }

  let serialized;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    return json({ ok: false, error: 'invalid_snapshot' }, 400);
  }
  if (serialized.length > 20000) {
    return json({ ok: false, error: 'snapshot_too_large' }, 413);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found' }, 404);
  }

  const currentPack = codeData.progress?.current_pack;
  if (!currentPack || currentPack.pack_id !== packId || currentPack.status !== 'awaiting_review') {
    return json({ ok: true, stored: false });
  }

  const updated = {
    ...codeData,
    progress: {
      ...codeData.progress,
      current_pack: {
        ...currentPack,
        web_session_checkpoint: {
          saved_at: new Date().toISOString(),
          snapshot,
        },
      },
    },
  };
  await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updated));

  // Best-effort drop-off analytics. Records the kid's latest position so we can
  // later see WHERE kids stop (page/stage/chunk) without touching the protected
  // lesson flow. Must never affect the checkpoint save above.
  await recordDropoff(env, accessCode, packId, snapshot);

  return json({ ok: true, stored: true });
}

// Compact, aggregatable snapshot of where the kid currently is in the lesson.
function buildDropoffRecord(snapshot, accessCode, packId) {
  const br = snapshot && typeof snapshot.book_reader === 'object' ? snapshot.book_reader : null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    code: accessCode,
    pack: packId,
    ts: new Date().toISOString(),
    phase: typeof snapshot?.w1_phase === 'string' ? snapshot.w1_phase : null,
    stage: br && typeof br.stage === 'string' ? br.stage : null,
    page: num(br?.pageIndex),
    pages_total: br && Array.isArray(br.pages) ? br.pages.length : null,
    question_index: num(br?.questionIndex),
    chunk_index: num(br?.chunkIndex),
    activity_index: num(snapshot?.activity_index),
  };
}

async function recordDropoff(env, accessCode, packId, snapshot) {
  try {
    const record = buildDropoffRecord(snapshot, accessCode, packId);
    const day = vietnamDateKey(record.ts); // YYYY-MM-DD in Vietnam time (UTC+7)
    // One key per (day, code, pack): overwritten on each save so it holds the
    // last-seen position that day. Survives pack completion (separate key) and
    // self-expires after 60 days to keep the namespace tidy.
    const key = `dropoff:${day}:${accessCode}:${packId}`;
    await env.READ2LEAD_CODES.put(key, JSON.stringify(record), {
      expirationTtl: 60 * 24 * 60 * 60,
    });
  } catch {
    // analytics is best-effort — swallow everything
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
