import { speakingRetiredResponse } from './speaking-retired.mjs';
import { onRequest as existingMiddleware } from '../../_middleware.js';
import { createAccountTransactionRunner } from './account-transactions.mjs';
import { ACCOUNT_ROUTES } from './account-routes.mjs';
import { createAccountStoryApi } from './account-story-api.mjs';
import { accountMinnyVoice } from './account-minny-voice.mjs';
import { prepareRead2LeadVoice, renderRead2LeadVoice } from '../../api/read2lead-voice.js';
import { accountSpeakingCheck } from './account-speaking-check.mjs';
import { accountMediaEffects } from './account-media-effects.mjs';

const json = (body, status, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
// Explicit routes precede parameter routes (e.g. reset-levels vs [code]).
const routes = [...ACCOUNT_ROUTES].sort((a, b) => {
  const literal = route => route.pattern.split('/').filter(part => part && !part.startsWith('[')).length;
  return literal(b) - literal(a) || b.pattern.length - a.pattern.length;
});
export function matchAccountRoute(pathname) {
  const input = pathname.split('/');
  for (const route of routes) {
    const parts = route.pattern.split('/');
    if (parts.length !== input.length) continue;
    const params = {}; let matches = true;
    for (let i = 0; i < parts.length; i++) {
      const parameter = /^\[([a-z_]+)\]$/.exec(parts[i]);
      if (!parameter) { if (parts[i] !== input[i]) { matches = false; break; } continue; }
      const decoded = decodeURIComponent(input[i]);
      if (!decoded || /[/\\\x00-\x1f\x7f]/.test(decoded) || new TextEncoder().encode(decoded).length > 512) throw Error('invalid_account_path');
      params[parameter[1]] = decoded;
    }
    if (matches) return { route, params };
  }
  return null;
}

/** Local-to-production integration building block; not activated by importing it.
 * A future host must route ALL account readers/writers here after a verified
 * non-destructive migration. Only plain account SQL is transacted; no external
 * side effect or background-work atomicity is implied. Pending routes never
 * delegate to old KV. Existing private QA host remains isolated and unchanged.
 */
export function createRead2LeadAccountService({ db, transaction, now, progressInCodes = false, infrastructure = {}, story = null, scheduleBackground, legacySpeechCache }) {
  const run = createAccountTransactionRunner({ db, transaction, now, progressInCodes });
  const storyApi = story ? createAccountStoryApi({ db, transaction, run, now, progressInCodes, infrastructure, origin: story.origin, voiceConfig: story.voiceConfig }) : null;
  async function dispatch(request) {
    let match;
    try { match = matchAccountRoute(new URL(request.url).pathname); }
    catch { return json({ ok: false, error: 'invalid_account_path' }, 400); }
    if (!match) return json({ ok: false, error: 'account_route_not_found' }, 404);
    const { route, params } = match;
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (!route.methods.includes(method) && !route.methods.includes('*')) {
      const allowed = route.methods.includes('GET') ? [...route.methods, 'HEAD'] : route.methods;
      return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: allowed.join(', ') });
    }
    if (route.state === 'retired') {
      const response = speakingRetiredResponse();
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (route.state === 'story' && storyApi) {
      const response = await storyApi(request.method === 'HEAD' ? new Request(request, { method: 'GET' }) : request);
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (route.state === 'voice') return accountMinnyVoice({ request, infrastructure, run, legacySpeechCache,
      ...(route.pattern === '/api/read2lead-voice' ? { prepare: prepareRead2LeadVoice, render: renderRead2LeadVoice } : {}),
    });
    if (route.state === 'speaking') return accountSpeakingCheck({ request, infrastructure, run, scheduleBackground });
    if (route.state !== 'transactional') return json({ ok: false, error: 'account_route_not_integrated' }, 503);
    const name = 'onRequest' + method[0] + method.slice(1).toLowerCase();
    const handler = route.handlers[name] || route.handlers.onRequest;
    if (typeof handler !== 'function') return json({ ok: false, error: 'account_route_not_integrated' }, 503);
    let committedFailure = null;
    const effects = ['media-write', 'media-delete'].includes(route.execution) && infrastructure.R2L_MEDIA
      ? accountMediaEffects({ db, bucket: infrastructure.R2L_MEDIA }) : null;
    const response = await run(async accountEnv => {
      let backgroundAttempted = false;
      const media = effects ? { R2L_MEDIA: effects.media }
        : ['media-read', 'external-read'].includes(route.execution) && infrastructure.R2L_MEDIA
          ? { R2L_MEDIA: Object.freeze({ get: (...args) => infrastructure.R2L_MEDIA.get(...args) }) } : {};
      const result = await handler({ request, params, data: {},
        // Account bindings override legacy KV; media readers get only get().
        env: { ...infrastructure, ...accountEnv, ...media },
        ...(route.execution === 'generation-status' ? { commitTerminalFailure(response) { committedFailure = response; return response; } } : {}),
        waitUntil(promise) {
          backgroundAttempted = true;
          // A caller may already have started a promise. Observe its rejection,
          // refuse this response, and let the transaction close all KV handles.
          Promise.resolve(promise).catch(() => {});
          throw Error('account_background_route_not_integrated');
        },
      });
      return backgroundAttempted ? json({ ok: false, error: 'account_background_route_not_integrated' }, 503) : result;
    }, { allowErrorResponse: response => response === committedFailure });
    if (effects) {
      const cleanup = await effects.finish(response.ok);
      if (response.ok && cleanup.cleanupFailed && route.execution === 'media-delete') {
        // Preserve the existing explicit-delete result: metadata is removed,
        // but an R2 failure is honestly reported after the committed change.
        return json({ ok: false, error: 'storage_error',
          message: 'Đã gỡ video khỏi danh sách nhưng chưa xoá được tệp lưu trữ.' }, 502);
      }
    }
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
  return request => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/admin')) {
      // Reuse the exact deployed middleware's Basic Auth/config refusal.
      // Its maintenance gateway deliberately excludes every admin path.
      return existingMiddleware({ request, env: infrastructure, next: () => dispatch(request) });
    }
    return dispatch(request);
  };
}
