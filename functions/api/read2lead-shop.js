import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import {
  equipItem,
  loadProgressState,
  publicProgressState,
  publicShopCatalog,
  purchaseItem,
  saveAvatarMonster,
  saveProgressState,
  unequipSlot,
} from './_read2lead-v2-state.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh cua hang.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Khong doc duoc yeu cau cua hang.' }, 400);
  }

  const accessCode = String(body.access_code || body.code || '').trim().toUpperCase();
  const action = String(body.action || '').trim().toLowerCase();
  if (!accessCode) {
    return json({ ok: false, error: 'missing_fields', message: 'Thieu ma hoc sinh.' }, 400);
  }
  if (!['list', 'buy', 'equip', 'unequip', 'avatar'].includes(action)) {
    return json({ ok: false, error: 'invalid_action', message: 'Hanh dong cua hang khong hop le.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return rateLimitedResponse(rateLimit.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  const state = await loadProgressState(env, accessCode, codeData);

  if (action === 'list') {
    return json({
      ok: true,
      catalog: publicShopCatalog(),
      read2lead_state: publicProgressState(state),
    });
  }

  let result;
  if (action === 'buy') {
    result = purchaseItem(state, body.item_id);
  } else if (action === 'equip') {
    result = equipItem(state, body.item_id);
  } else if (action === 'avatar') {
    if (!body.monster || typeof body.monster !== 'object') {
      return json({ ok: false, error: 'invalid_monster', message: 'Du lieu quai khong hop le.' }, 400);
    }
    result = saveAvatarMonster(state, body.monster, accessCode);
  } else {
    result = unequipSlot(state, body.slot);
  }

  if (!result.ok) {
    const messages = {
      item_not_found: 'Khong tim thay vat pham nay.',
      insufficient_coins: 'Chua du xu. Con hoc them de tich luy nhe!',
      not_owned: 'Con chua so huu vat pham nay.',
      invalid_slot: 'O trang bi khong hop le.',
      invalid_monster: 'Du lieu quai khong hop le.',
    };
    return json(
      {
        ok: false,
        error: result.error,
        message: messages[result.error] || 'Khong the thuc hien.',
        read2lead_state: publicProgressState(state),
      },
      400,
    );
  }

  const saved = await saveProgressState(env, accessCode, result.state);
  return json({
    ok: true,
    action,
    already_owned: Boolean(result.already_owned),
    purchased: Boolean(result.purchased),
    item: result.item || null,
    minny_message_vi: result.purchased
      ? `Minny thich ${result.item?.emoji || ''} ${result.item?.name_vi || 'do nay'} cua con qua!`
      : null,
    read2lead_state: publicProgressState(saved),
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
