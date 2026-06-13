import {
  authorizeParentCode,
  json,
  loadPortfolio,
} from './portfolio.js';

function parsedRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
  if (!match || (!match[1] && !match[2]) || !Number.isFinite(size) || size <= 0) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1, length: size - start };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return null;
  }
  const end = Math.min(size - 1, requestedEnd);
  return { start, end, length: end - start + 1 };
}

function objectRange(object, rangeHeader) {
  const size = Number(object.size || 0);
  const range = object.range;
  if (range && Number.isFinite(range.offset)) {
    const start = Number(range.offset);
    const length = Number.isFinite(range.length) ? Number(range.length) : Math.max(0, size - start);
    return { start, end: Math.min(size - 1, start + length - 1), length };
  }
  if (range && Number.isFinite(range.suffix)) {
    const length = Math.min(size, Number(range.suffix));
    return { start: size - length, end: size - 1, length };
  }
  return parsedRange(rangeHeader, size);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const auth = await authorizeParentCode(context, url.searchParams.get('code'));
  if (auth.response) return auth.response;

  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) {
    return json({ ok: false, error: 'id_missing', message: 'Thiếu mã video.' }, 400);
  }

  const items = await loadPortfolio(env.READ2LEAD_CODES, auth.code);
  const entry = items.find((item) => item?.id === id);
  if (!entry?.video_key) {
    return json({ ok: false, error: 'video_not_found', message: 'Không tìm thấy video.' }, 404);
  }

  if (!env.R2L_MEDIA) {
    return json(
      { ok: false, error: 'config_error', message: 'Hệ thống video chưa được cấu hình.' },
      500,
    );
  }

  const rangeHeader = request.headers.get('range');
  let object;
  try {
    object = await env.R2L_MEDIA.get(
      entry.video_key,
      rangeHeader ? { range: request.headers } : undefined,
    );
  } catch {
    if (rangeHeader) {
      return new Response(null, {
        status: 416,
        headers: {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=0',
        },
      });
    }
    return json(
      { ok: false, error: 'storage_error', message: 'Chưa tải được video. Vui lòng thử lại.' },
      502,
    );
  }

  if (!object || !('body' in object)) {
    return json({ ok: false, error: 'video_not_found', message: 'Không tìm thấy video.' }, 404);
  }

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('Content-Type', entry.content_type || headers.get('Content-Type') || 'video/mp4');
  headers.set('Cache-Control', 'private, max-age=0');
  headers.set('Accept-Ranges', 'bytes');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);

  let status = 200;
  if (rangeHeader) {
    const range = objectRange(object, rangeHeader);
    if (!range) {
      headers.set('Content-Range', `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
    headers.set('Content-Length', String(range.length));
    status = 206;
  } else if (Number.isFinite(object.size)) {
    headers.set('Content-Length', String(object.size));
  }

  return new Response(object.body, { status, headers });
}
