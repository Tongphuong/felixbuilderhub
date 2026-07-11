// Kid-facing homework photo. Authorized by student access code (same
// contract as parent/video.js); the R2 key comes only from the kid's own
// KV homework record, never from the client. Serves the CURRENT homework
// photo only — history photos are not reachable.
import { authorizeParentCode, json } from './parent/portfolio.js';
import { normalizeHomeworkRecord } from './_homework.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.R2L_MEDIA) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống ảnh chưa được cấu hình.' }, 500);
  }

  const url = new URL(request.url);
  const auth = await authorizeParentCode(context, url.searchParams.get('code'));
  if (auth.response) return auth.response;

  const photoId = String(url.searchParams.get('id') || '');
  const homework = normalizeHomeworkRecord(auth.codeRecord.homework);
  const photo = homework && homework.photo && homework.photo.id === photoId ? homework.photo : null;
  if (!photo || !photo.r2_key) {
    return json({ ok: false, error: 'photo_not_found', message: 'Không tìm thấy ảnh bài tập.' }, 404);
  }

  const object = await env.R2L_MEDIA.get(photo.r2_key);
  if (!object) {
    return json({ ok: false, error: 'photo_not_found', message: 'Không tìm thấy ảnh bài tập.' }, 404);
  }

  const etag = object.httpEtag || `"hw-${photo.id}"`;
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'private, max-age=3600' },
    });
  }

  const contentType = object.httpMetadata?.contentType || photo.content_type || 'application/octet-stream';
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
      ETag: etag,
    },
  });
}
