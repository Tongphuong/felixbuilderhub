import {
  json,
  loadPortfolio,
  normalizeCode,
  savePortfolio,
} from '../../parent/portfolio.js';

export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const VIDEO_EXTENSIONS = Object.freeze({
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
});

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makePortfolioId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) {
    if (byte >= 252) continue;
    value += ID_CHARS[byte % ID_CHARS.length];
    if (value.length === 12) return `vp_${value}`;
  }
  return makePortfolioId();
}

export function validateVideoFile(video) {
  if (!video || typeof video.size !== 'number' || typeof video.type !== 'string') {
    return { ok: false, error: 'video_required', status: 400 };
  }
  if (!VIDEO_EXTENSIONS[video.type]) {
    return { ok: false, error: 'video_type_invalid', status: 415 };
  }
  if (video.size <= 0) {
    return { ok: false, error: 'video_empty', status: 400 };
  }
  if (video.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: 'video_too_large', status: 413 };
  }
  return { ok: true, extension: VIDEO_EXTENSIONS[video.type] };
}

export async function onRequestPost(context) {
  const { request, env } = context;
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

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form', message: 'Dữ liệu tải lên không hợp lệ.' }, 400);
  }

  const code = normalizeCode(formData.get('access_code'));
  const title = String(formData.get('title') || '').trim().slice(0, 120);
  const noteVi = String(formData.get('note_vi') || '').trim().slice(0, 2000);
  const video = formData.get('video');

  if (!code) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng chọn học sinh.' }, 400);
  }

  const codeRecord = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeRecord) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }
  if (!title) {
    return json({ ok: false, error: 'title_required', message: 'Vui lòng nhập tiêu đề video.' }, 400);
  }
  if (!noteVi) {
    return json({ ok: false, error: 'note_required', message: 'Vui lòng nhập nhận xét.' }, 400);
  }

  const validation = validateVideoFile(video);
  if (!validation.ok) {
    const messages = {
      video_required: 'Vui lòng chọn video.',
      video_type_invalid: 'Chỉ nhận video MP4, WebM hoặc MOV.',
      video_empty: 'Video đang trống.',
      video_too_large: 'Video tối đa 80MB.',
    };
    return json(
      { ok: false, error: validation.error, message: messages[validation.error] },
      validation.status,
    );
  }

  const items = await loadPortfolio(env.READ2LEAD_CODES, code);
  let id = makePortfolioId();
  while (items.some((item) => item?.id === id)) id = makePortfolioId();

  const videoKey = `portfolio/${code}/${id}.${validation.extension}`;
  const entry = {
    id,
    ts: new Date().toISOString(),
    video_key: videoKey,
    size: video.size,
    content_type: video.type,
    title,
    note_vi: noteVi,
    parent_seen_at: null,
    reactions: { heart: 0, clap: 0, strong: 0 },
  };

  try {
    await env.R2L_MEDIA.put(videoKey, video, {
      httpMetadata: { contentType: video.type },
    });
  } catch {
    return json(
      { ok: false, error: 'storage_error', message: 'Chưa lưu được video. Vui lòng thử lại.' },
      502,
    );
  }

  const nextItems = [entry, ...items].slice(0, 50);
  try {
    await savePortfolio(env.READ2LEAD_CODES, code, nextItems);
  } catch {
    try {
      await env.R2L_MEDIA.delete(videoKey);
    } catch {
      // Best-effort rollback; the object remains private and is not referenced by KV.
    }
    return json(
      { ok: false, error: 'storage_error', message: 'Chưa lưu được thông tin video. Vui lòng thử lại.' },
      502,
    );
  }

  const removedKeys = items
    .slice(49)
    .map((item) => item?.video_key)
    .filter(Boolean);
  if (removedKeys.length) {
    try {
      await env.R2L_MEDIA.delete(removedKeys);
    } catch {
      // The trimmed objects are no longer reachable; cleanup can be retried operationally.
    }
  }

  return json({ ok: true, entry }, 201);
}
