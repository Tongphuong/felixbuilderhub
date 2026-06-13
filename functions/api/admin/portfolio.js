import {
  json,
  loadPortfolio,
  normalizeCode,
} from '../parent/portfolio.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json(
      { ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' },
      500,
    );
  }

  const code = normalizeCode(new URL(request.url).searchParams.get('code'));
  if (!code) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng chọn học sinh.' }, 400);
  }

  const codeRecord = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeRecord) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  return json({ ok: true, code, items: await loadPortfolio(env.READ2LEAD_CODES, code) });
}
