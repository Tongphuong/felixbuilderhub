import {
  REACTION_KINDS,
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
  const kind = String(body?.kind || '').trim();
  if (!REACTION_KINDS.has(kind)) {
    return json({ ok: false, error: 'reaction_invalid', message: 'Cảm xúc không hợp lệ.' }, 400);
  }

  const items = await loadPortfolio(context.env.READ2LEAD_CODES, auth.code);
  const index = items.findIndex((item) => item?.id === id);
  if (index === -1) {
    return json({ ok: false, error: 'video_not_found', message: 'Không tìm thấy video.' }, 404);
  }

  const reactions = { heart: 0, clap: 0, strong: 0, ...(items[index].reactions || {}) };
  reactions[kind] = Math.min(99, Math.max(0, Number(reactions[kind]) || 0) + 1);
  items[index] = { ...items[index], reactions };
  await savePortfolio(context.env.READ2LEAD_CODES, auth.code, items);

  return json({ ok: true, reactions });
}
