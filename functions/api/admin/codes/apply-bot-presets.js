// POST /api/admin/codes/apply-bot-presets
// Apply fixed leaderboard stats to virtual bot accounts (Pilot, Ong, ...).

import { LEADERBOARD_BOT_PRESETS } from '../../_read2lead-v2-state.js';
import { applyBotStatsToCode, resolveBotPreset } from './_apply-bot-stats.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requested = Array.isArray(body.presets) && body.presets.length
    ? body.presets.map((key) => resolveBotPreset(key)).filter(Boolean)
    : Object.keys(LEADERBOARD_BOT_PRESETS).map((key) => resolveBotPreset(key));

  if (!requested.length) {
    return json({ ok: false, error: 'no_presets', message: 'Không có preset bot hợp lệ.' }, 400);
  }

  const results = [];
  for (const preset of requested) {
    results.push(await applyBotStatsToCode(env, preset.code, preset));
  }

  const failed = results.filter((row) => !row.ok);
  if (failed.length === results.length) {
    return json({ ok: false, error: 'all_failed', results }, 404);
  }

  return json({
    ok: true,
    applied: results.filter((row) => row.ok).length,
    results,
  });
}
