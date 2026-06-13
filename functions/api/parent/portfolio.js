import {
  getClientIp,
  checkCodeRateLimit,
  recordCodeFailure,
  rateLimitedResponse,
} from '../_rate-limit.js';

export const PORTFOLIO_PREFIX = 'portfolio:';
export const REACTION_KINDS = new Set(['heart', 'clap', 'strong']);

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function portfolioKey(code) {
  return `${PORTFOLIO_PREFIX}${normalizeCode(code)}`;
}

export async function loadPortfolio(kv, code) {
  const value = await kv.get(portfolioKey(code), { type: 'json' });
  return Array.isArray(value) ? value : [];
}

export async function savePortfolio(kv, code, items) {
  await kv.put(portfolioKey(code), JSON.stringify(items.slice(0, 50)));
}

export async function authorizeParentCode(context, rawCode) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return {
      response: json(
        { ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' },
        500,
      ),
    };
  }

  const code = normalizeCode(rawCode);
  if (!code) {
    return {
      response: json(
        { ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' },
        400,
      ),
    };
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return { response: rateLimitedResponse(rateLimit.retryAfter) };
  }

  const codeRecord = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeRecord) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return {
      response: json(
        { ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' },
        404,
      ),
    };
  }

  return { code, codeRecord };
}

export function publicPortfolioItem(entry, code) {
  const safeEntry = { ...entry };
  delete safeEntry.video_key;
  return {
    ...safeEntry,
    video_url: `/api/parent/video?code=${encodeURIComponent(code)}&id=${encodeURIComponent(entry.id)}`,
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const auth = await authorizeParentCode(context, url.searchParams.get('code'));
  if (auth.response) return auth.response;

  const items = await loadPortfolio(context.env.READ2LEAD_CODES, auth.code);
  return json({
    ok: true,
    items: items.map((entry) => publicPortfolioItem(entry, auth.code)),
  });
}
