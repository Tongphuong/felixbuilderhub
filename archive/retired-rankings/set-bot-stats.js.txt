// POST /api/admin/codes/:code/set-bot-stats
// Set fixed rank / packs / coins for a single bot or test account.

import {
  buildAdminBotLeaderboardState,
  loadProgressState,
  publicProgressState,
} from '../../../_read2lead-v2-state.js';
import { applyBotStatsToCode } from '../_apply-bot-stats.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const code = String(params.code || '').trim().toUpperCase();
  if (!code) return json({ ok: false, error: 'code_required' }, 400);

  const record = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!record) return json({ ok: false, error: 'not_found' }, 404);
  if (!record.is_test && !record.is_bot) {
    return json({
      ok: false,
      error: 'bot_only',
      message: 'Chỉ mã test/bot mới được set stats ảo. Bật Test ON hoặc is_bot trước.',
    }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const rankLabelVi = String(body.rank_label_vi || '').trim();
  const completedPacks = Number(body.completed_packs);
  if (!rankLabelVi) {
    return json({ ok: false, error: 'rank_label_vi_required' }, 400);
  }
  if (!Number.isFinite(completedPacks) || completedPacks < 0) {
    return json({ ok: false, error: 'completed_packs_invalid' }, 400);
  }

  const result = await applyBotStatsToCode(env, code, {
    rank_label_vi: rankLabelVi,
    completed_packs: completedPacks,
    coins: body.coins,
    student_name: body.student_name,
  });

  if (!result.ok) {
    return json(result, result.error === 'not_found' ? 404 : 400);
  }

  return json(result);
}
