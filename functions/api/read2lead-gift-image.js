// Serves an uploaded gift photo by gift id. These are product photos, not
// private student media (contrast functions/api/parent/video.js): no
// per-student auth, and no range-request handling. Serves strictly by gift
// id, via the gift's own image_key, so no other R2 object is reachable.
import { loadGiftStore } from './admin/_gifts.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) {
    return json({ ok: false, error: 'id_missing', message: 'Thiếu mã quà tặng.' }, 400);
  }

  if (!env.R2L_MEDIA) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống ảnh chưa được cấu hình.' }, 500);
  }

  const store = await loadGiftStore(env);
  const gift = store.gifts.find((item) => item.id === id);
  if (!gift?.image_key) {
    return json({ ok: false, error: 'image_not_found', message: 'Không tìm thấy ảnh.' }, 404);
  }

  let object;
  try {
    object = await env.R2L_MEDIA.get(gift.image_key);
  } catch {
    return json(
      { ok: false, error: 'storage_error', message: 'Chưa tải được ảnh. Vui lòng thử lại.' },
      502,
    );
  }

  if (!object || !('body' in object)) {
    return json({ ok: false, error: 'image_not_found', message: 'Không tìm thấy ảnh.' }, 404);
  }

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (Number.isFinite(object.size)) headers.set('Content-Length', String(object.size));

  return new Response(object.body, { status: 200, headers });
}
