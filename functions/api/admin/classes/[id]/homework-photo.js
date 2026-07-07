// Homework photo upload + admin preview. Binary goes to R2 (R2L_MEDIA),
// mirroring the portfolio video pattern; the homework JSON only ever
// references the returned descriptor. Basic-Auth is enforced for all
// /api/admin/* routes by functions/_middleware.js.
import { loadClassStore, findClass, json } from '../../_classes.js';
import { HOMEWORK_PHOTO_MAX_BYTES, HOMEWORK_PHOTO_TYPES } from '../../../_homework.js';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeHomeworkPhotoId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) {
    if (byte >= 252) continue;
    value += ID_CHARS[byte % ID_CHARS.length];
    if (value.length === 12) return `hp_${value}`;
  }
  return makeHomeworkPhotoId();
}

export function validatePhotoFile(photo) {
  if (!photo || typeof photo.size !== 'number' || typeof photo.type !== 'string') {
    return { ok: false, error: 'photo_required', status: 400 };
  }
  if (photo.type === 'image/heic' || photo.type === 'image/heif') {
    return { ok: false, error: 'photo_heic', status: 415 };
  }
  const extension = HOMEWORK_PHOTO_TYPES[photo.type];
  if (!extension) {
    return { ok: false, error: 'photo_type_invalid', status: 415 };
  }
  if (photo.size <= 0) {
    return { ok: false, error: 'photo_empty', status: 400 };
  }
  if (photo.size > HOMEWORK_PHOTO_MAX_BYTES) {
    return { ok: false, error: 'photo_too_large', status: 413 };
  }
  return { ok: true, extension };
}

const PHOTO_ERROR_MESSAGES = {
  photo_required: 'Vui lòng chọn ảnh.',
  photo_heic: 'Ảnh HEIC chưa được hỗ trợ — vui lòng chọn JPEG/PNG.',
  photo_type_invalid: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.',
  photo_empty: 'Ảnh đang trống.',
  photo_too_large: 'Ảnh tối đa 8MB.',
};

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }
  if (!env.R2L_MEDIA) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống ảnh chưa được cấu hình.' }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form', message: 'Dữ liệu tải lên không hợp lệ.' }, 400);
  }

  try {
    const store = await loadClassStore(env);
    const klass = findClass(store, params.id);
    if (!klass) return json({ ok: false, error: 'class_not_found' }, 404);

    const photo = formData.get('photo');
    const validation = validatePhotoFile(photo);
    if (!validation.ok) {
      return json(
        { ok: false, error: validation.error, message: PHOTO_ERROR_MESSAGES[validation.error] },
        validation.status,
      );
    }

    const id = makeHomeworkPhotoId();
    const r2Key = `homework/${klass.id}/${id}.${validation.extension}`;
    try {
      await env.R2L_MEDIA.put(r2Key, photo, { httpMetadata: { contentType: photo.type } });
    } catch {
      return json({ ok: false, error: 'storage_error', message: 'Chưa lưu được ảnh. Vui lòng thử lại.' }, 502);
    }

    return json(
      { ok: true, photo: { id, r2_key: r2Key, content_type: photo.type, size: photo.size } },
      201,
    );
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}

// Admin-modal preview of an already-uploaded photo. Key is confined to
// this class's homework/ prefix by regex; class ids are [a-z0-9_-] so no
// regex escaping is needed.
export async function onRequestGet(context) {
  const { request, env, params } = context;
  if (!env.R2L_MEDIA) {
    return json({ ok: false, error: 'config_error' }, 500);
  }
  const classId = String(params.id || '');
  if (!/^[a-z0-9_-]+$/.test(classId)) {
    return json({ ok: false, error: 'photo_not_found' }, 404);
  }
  const url = new URL(request.url);
  const key = String(url.searchParams.get('key') || '');
  const pattern = new RegExp(`^homework/${classId}/hp_[a-z0-9]{12}\\.(jpg|png|webp)$`);
  if (!pattern.test(key)) {
    return json({ ok: false, error: 'photo_not_found' }, 404);
  }

  const object = await env.R2L_MEDIA.get(key);
  if (!object) {
    return json({ ok: false, error: 'photo_not_found' }, 404);
  }

  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
    },
  });
}
