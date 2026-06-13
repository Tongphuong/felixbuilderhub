import {
  authorizeParentCode,
  json,
  loadPortfolio,
  savePortfolio,
} from './portfolio.js';

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Dữ liệu không hợp lệ.' }, 400);
  }

  const auth = await authorizeParentCode(context, body?.code);
  if (auth.response) return auth.response;

  const id = String(body?.id || '').trim();
  const items = await loadPortfolio(context.env.READ2LEAD_CODES, auth.code);
  const index = items.findIndex((item) => item?.id === id);
  if (index === -1) {
    return json({ ok: false, error: 'video_not_found', message: 'Không tìm thấy video.' }, 404);
  }

  if (!items[index].parent_seen_at) {
    items[index] = { ...items[index], parent_seen_at: new Date().toISOString() };
    await savePortfolio(context.env.READ2LEAD_CODES, auth.code, items);
  }

  return json({ ok: true, parent_seen_at: items[index].parent_seen_at });
}
