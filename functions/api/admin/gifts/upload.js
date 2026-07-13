// Gift photo upload. Mirrors functions/api/admin/portfolio/upload.js closely:
// formData -> validate -> env.R2L_MEDIA.put(...) -> save KV -> roll back the
// R2 object if the KV write fails.
//
// The founder does not own these gifts (they are sourced from online product
// listings) so in practice he will usually paste an image_url instead of
// uploading a photo — both paths must work; this endpoint only covers the
// upload path, image_url is just a plain field on the gift record saved via
// admin/gifts.js.
import { json, loadGiftStore, saveGiftStore } from '../_gifts.js';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export function validateGiftImageFile(image) {
  if (!image || typeof image.size !== 'number' || typeof image.type !== 'string') {
    return { ok: false, error: 'image_required', status: 400 };
  }
  if (!IMAGE_EXTENSIONS[image.type]) {
    return { ok: false, error: 'image_type_invalid', status: 415 };
  }
  if (image.size <= 0) {
    return { ok: false, error: 'image_empty', status: 400 };
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'image_too_large', status: 413 };
  }
  return { ok: true, extension: IMAGE_EXTENSIONS[image.type] };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json(
      { ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình quà tặng.' },
      500,
    );
  }
  if (!env.R2L_MEDIA) {
    return json(
      { ok: false, error: 'config_error', message: 'Hệ thống ảnh chưa được cấu hình.' },
      500,
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form', message: 'Dữ liệu tải lên không hợp lệ.' }, 400);
  }

  const giftId = String(formData.get('gift_id') || '').trim();
  const image = formData.get('image');

  if (!giftId) {
    return json({ ok: false, error: 'gift_id_missing', message: 'Thiếu mã quà tặng.' }, 400);
  }

  const store = await loadGiftStore(env);
  const gift = store.gifts.find((item) => item.id === giftId);
  if (!gift) {
    return json({ ok: false, error: 'gift_not_found', message: 'Không tìm thấy quà tặng.' }, 404);
  }

  const validation = validateGiftImageFile(image);
  if (!validation.ok) {
    const messages = {
      image_required: 'Vui lòng chọn ảnh.',
      image_type_invalid: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.',
      image_empty: 'Ảnh đang trống.',
      image_too_large: 'Ảnh tối đa 2MB.',
    };
    return json(
      { ok: false, error: validation.error, message: messages[validation.error] },
      validation.status,
    );
  }

  // The key carries a timestamp, so REPLACING a photo produces a NEW key.
  //
  // It used to be `gifts/<id>.<ext>` — stable across uploads. That looked tidy
  // and was a real bug: read2lead-gift-image.js serves with
  // `Cache-Control: public, max-age=31536000, immutable`, and the kid-facing URL
  // (`?id=<id>`) never changed either. So a child who had already loaded the old
  // photo kept it FOR A YEAR, and so did the CDN edge. Coach Felix would swap a
  // wrong photo for a right one, reload, still see the wrong one, and conclude —
  // correctly, from where he sat — that the upload was broken. He reported that
  // exact symptom once already.
  //
  // With a unique key per upload the URL changes (the client appends the key as
  // a `v` param), so `immutable` becomes TRUE instead of a lie: those bytes
  // really never change.
  // A timestamp ALONE is not enough: two uploads inside the same millisecond
  // produce the same key, and then the failure-rollback below (`delete(imageKey)`)
  // would delete the object the gift still points at. Caught by the test that
  // uploads twice back to back. A random suffix makes the key genuinely unique.
  const previousKey = gift.image_key || null;
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const imageKey = `gifts/${giftId}-${stamp}.${validation.extension}`;

  try {
    await env.R2L_MEDIA.put(imageKey, image, {
      httpMetadata: { contentType: image.type },
    });
  } catch {
    return json(
      { ok: false, error: 'storage_error', message: 'Chưa lưu được ảnh. Vui lòng thử lại.' },
      502,
    );
  }

  const nextGifts = store.gifts.map((item) =>
    (item.id === giftId ? { ...item, image_key: imageKey } : item));

  try {
    await saveGiftStore(env, { ...store, gifts: nextGifts });
  } catch {
    try {
      await env.R2L_MEDIA.delete(imageKey);
    } catch {
      // Best-effort rollback; the object remains but is not referenced by KV.
    }
    return json(
      { ok: false, error: 'storage_error', message: 'Chưa lưu được thông tin quà tặng. Vui lòng thử lại.' },
      502,
    );
  }

  // The old object is now unreferenced. Delete it AFTER the KV write, never
  // before: if this fails, R2 keeps one orphan (harmless, ~100KB); if it ran
  // first and the KV write then failed, the gift would point at a key that no
  // longer exists and the child would see a broken photo. Fail toward the
  // wasted byte, never toward the broken screen.
  if (previousKey && previousKey !== imageKey) {
    try {
      await env.R2L_MEDIA.delete(previousKey);
    } catch {
      // Orphaned object; the gift is correct, which is what matters.
    }
  }

  return json({ ok: true, gift_id: giftId, image_key: imageKey });
}
