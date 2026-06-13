import {
  json,
  loadPortfolio,
  normalizeCode,
  savePortfolio,
} from '../../parent/portfolio.js';

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!env.READ2LEAD_CODES) {
    return json(
      { ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' },
      500,
    );
  }
  if (!env.R2L_MEDIA) {
    return json(
      { ok: false, error: 'config_error', message: 'Hệ thống video chưa được cấu hình.' },
      500,
    );
  }

  const code = normalizeCode(new URL(request.url).searchParams.get('code'));
  const id = String(params.id || '').trim();
  if (!code || !id) {
    return json({ ok: false, error: 'invalid_request', message: 'Thiếu mã học sinh hoặc video.' }, 400);
  }

  const codeRecord = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeRecord) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  const items = await loadPortfolio(env.READ2LEAD_CODES, code);
  const entry = items.find((item) => item?.id === id);
  if (!entry) {
    return json({ ok: false, error: 'video_not_found', message: 'Không tìm thấy video.' }, 404);
  }

  await savePortfolio(
    env.READ2LEAD_CODES,
    code,
    items.filter((item) => item?.id !== id),
  );

  try {
    await env.R2L_MEDIA.delete(entry.video_key);
  } catch {
    return json(
      {
        ok: false,
        error: 'storage_error',
        message: 'Đã gỡ video khỏi danh sách nhưng chưa xoá được tệp lưu trữ.',
      },
      502,
    );
  }

  return json({ ok: true, id });
}
