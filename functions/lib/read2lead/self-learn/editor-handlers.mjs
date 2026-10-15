/** Synthetic loopback editor boundary. Its authority is separate from family/child access. */
import { validateEditorLesson } from './editor-policy.mjs';
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
const PREFIX = '/api/read2lead/editor/', COOKIE = 'r2l_synthetic_editor', MAX_BODY = 270336, MAX_PUBLISHER_BODY = 2097152;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
class BoundaryError extends Error { constructor(code) { super(code); this.code = code; } }
const requireThat = (ok, code) => { if (!ok) throw new BoundaryError(code); };
const CODES = {
  unauthorized: 401, access_expired: 401, invalid_editor_access: 401, editor_access_revoked: 401, editor_required: 403,
  origin_refused: 403, csrf_failed: 403, invalid_request: 400, invalid_json: 400, request_aborted: 400,
  invalid_editor_json: 400, invalid_editor_draft: 400, invalid_editor_integrity: 400, editor_input_limit: 413,
  body_too_large: 413, unsupported_media_type: 415, method_not_allowed: 405, not_found: 404,
  editor_document_not_found: 404, editor_revision_not_found: 404, request_conflict: 409, stale_revision: 409,
  invalid_editor_transition: 409, technical_review_required: 409, content_quarantined: 409, editor_content_corrupt: 409,
  invalid_publisher_schema:400,invalid_publisher_integrity:400,invalid_publisher_json:400,publisher_input_limit:413,invalid_import_plan:400,invalid_review_plan:400,invalid_catalogue_plan:400,invalid_review_record:400,invalid_review_batch:400,duplicate_review:400,invalid_review_time:400,review_evidence_required:400,human_review_required:400,editorial_review_required:400,invalid_withdrawal:400,
  publisher_editor_synthetic_only:403,publisher_editor_private_only:403,unknown_publisher_version:404,unknown_publisher_catalogue:404,publisher_asset_not_found:404,publisher_asset_unavailable:409,publisher_not_approved:409,withdrawn_version:409,stale_review_package:409,stale_review_content:409,stale_review_snapshot:409,stale_package_plan:409,stale_store_plan:409,stale_catalogue_plan:409,stale_catalogue_snapshot:409,stale_catalogue_approval:409,immutable_version_conflict:409,source_identity_conflict:409,catalogue_predecessor_missing:409,publisher_catalogue_integrity:409,publisher_store_integrity:409,
  revision_limit: 409, rate_limited: 429, session_limit: 429,
};
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers,
} });
function validOrigin(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(value)) return false;
  try { const url = new URL(value); return url.origin === value && Number(url.port) >= 1024 && Number(url.port) <= 65535; } catch { return false; }
}
function cookieToken(request, name = COOKIE) {
  const raw = request.headers.get('cookie') || ''; if (raw.length > 8192) return null;
  const matches = raw.split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  return matches.length === 1 && /^[a-f0-9]{64}$/.test(matches[0].slice(name.length + 1)) ? matches[0].slice(name.length + 1) : null;
}
async function body(request, limit = MAX_BODY) {
  requireThat(!request.signal.aborted, 'request_aborted');
  requireThat(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'unsupported_media_type');
  const length = request.headers.get('content-length'); requireThat(!length || (/^\d+$/.test(length) && Number(length) <= limit), 'body_too_large');
  const reader = request.body?.getReader(); requireThat(reader, 'invalid_json'); let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const part = await reader.read(); requireThat(!request.signal.aborted, 'request_aborted'); if (part.done) break;
      size += part.value.byteLength; if (size > limit) { await reader.cancel(); throw new BoundaryError('body_too_large'); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text);
  } catch (e) { if (e instanceof BoundaryError) throw e; throw new BoundaryError('invalid_json'); }
  finally { reader.releaseLock(); }
}
export function createEditorHandlers({ mode, origin, store, publisher = null, templates = [], now = () => Date.now(), ttlMs = 900000 } = {}) {
  if (!['synthetic-local','private-local'].includes(mode) || !validOrigin(origin) || !store || typeof store.access !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) throw Error('unsafe_editor_api_config');
  if(publisher&&(!['list','document','catalogue','plan','apply','withdraw','media'].every(k=>typeof publisher[k]==='function')||typeof store.withPublisherCommit!=='function'))throw Error('unsafe_editor_api_config');
  const privateMode=mode==='private-local', cookieName=privateMode?'r2l_private_publisher_editor':COOKIE;
  if(privateMode&&(store.environment!=='private-local'||publisher?.environment!=='private-local'))throw Error('unsafe_editor_api_config');
  if(!privateMode&&publisher?.environment==='private-local')throw Error('unsafe_editor_api_config');
  let templateSource;
  try { if (!Array.isArray(templates) || templates.length > 100 || new Set(templates.map(l => l?.id)).size !== templates.length || !templates.every(l => validId(l?.id)) || new TextEncoder().encode(JSON.stringify(templates)).length > 2097152) throw Error(); templateSource = structuredClone(templates); } catch { throw Error('unsafe_editor_api_config'); }
  let validatedTemplates = null;
  const sessions = new Map(), windows = new Map(), counts = { requests: 0, errors: 0, login_failures: 0 };
  function rate(name, limit) {
    let value = windows.get(name); if (!value || now() - value.at >= 60000) { value = { at: now(), count: 0 }; windows.set(name, value); }
    requireThat(++value.count <= limit, 'rate_limited');
  }
  function cleanExpired() {
    for (const [key, s] of sessions) {
      if (s.expires <= now()) { sessions.delete(key); continue; }
      try { store.access(s.principal); } catch { sessions.delete(key); }
    }
  }
  const cookie = (key, expires) => `${cookieName}=${key}; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=${Math.max(0, Math.floor((expires - now()) / 1000))}`;
  const publicAccess = s => ({ ok: true, environment: privateMode?'private-local':'synthetic', ...store.access(s.principal), csrf: s.csrf, expires_at: new Date(s.expires).toISOString(), publication_scope: privateMode?'private_catalogue_only':'synthetic_qa_only', human_review: false, ...(privateMode?{publisher_only:true}:{}), ...(publisher?{publisher_editor:true}:{}) });
  function authenticate(request) {
    const key = cookieToken(request,cookieName), s = key && sessions.get(key); requireThat(s, 'unauthorized');
    if (s.expires <= now()) { sessions.delete(key); throw new BoundaryError('access_expired'); }
    try { store.access(s.principal); } catch (e) { sessions.delete(key); throw e; }
    return { key, s };
  }
  function queryId(url, optional = false) {
    if (optional && !url.search) return undefined;
    requireThat([...url.searchParams.keys()].length === 1 && validId(url.searchParams.get('lesson_id')), 'invalid_request'); return url.searchParams.get('lesson_id');
  }
  const writes = new Map([['draft', 'saveDraft'], ['request-review', 'requestReview'], ['review', 'review'], ['publish-qa', 'publishQA'], ['quarantine', 'setQuarantine']]);
  return {
    diagnostics() { cleanExpired(); return { ...counts, active_sessions: sessions.size, scope: privateMode?'private_publisher_editor':'synthetic_editor', provider_enabled: false }; },
    async handle(request) {
      counts.requests++;
      try {
        const url = new URL(request.url), incoming = request.headers.get('origin');
        requireThat(url.origin === origin && (!request.headers.has('host') || request.headers.get('host') === url.host) && (!incoming || incoming === origin) && request.headers.get('sec-fetch-site') !== 'cross-site', 'origin_refused');
        requireThat(['GET', 'POST'].includes(request.method)||(request.method==='HEAD'&&url.pathname===PREFIX+'publisher-media'), 'method_not_allowed');
        requireThat(request.method !== 'POST' || incoming === origin, 'origin_refused');
        requireThat(url.pathname.startsWith(PREFIX), 'not_found'); requireThat(!request.signal.aborted, 'request_aborted');
        const route = url.pathname.slice(PREFIX.length);
        if (route === 'login') {
          requireThat(request.method === 'POST' && !url.search, 'method_not_allowed'); rate('login', 20);
          const data = await body(request); requireThat(exact(data, ['editor_id', 'access_secret']), 'invalid_request');
          let principal;
          try { principal = store.authenticate(data.editor_id, data.access_secret); }
          catch (e) { if (e.code === 'invalid_editor_access') counts.login_failures++; throw e; }
          cleanExpired(); const previous = cookieToken(request,cookieName); if (previous) sessions.delete(previous); requireThat(sessions.size < 50, 'session_limit');
          const key = token(), s = { principal, csrf: token(), expires: now() + ttlMs }; sessions.set(key, s);
          return reply(publicAccess(s), 200, { 'Set-Cookie': cookie(key, s.expires) });
        }
        const { key, s } = authenticate(request);
        if (request.method === 'POST') requireThat(request.headers.get('x-r2l-editor-csrf') === s.csrf, 'csrf_failed');
        // Memory/clock checks only: this callback also runs inside the store's SQLite transaction.
        const ensureSession = () => {
          requireThat(!request.signal.aborted, 'request_aborted'); requireThat(sessions.get(key) === s, 'unauthorized'); requireThat(s.expires > now(), 'access_expired');
        };
        const ensureActive = () => { ensureSession(); store.access(s.principal); };
        if(publisher&&route.startsWith('publisher-')){
          const context={principal:s.principal,guard:ensureActive,commit:work=>store.withPublisherCommit(s.principal,work,ensureSession)},at=()=>new Date(now()).toISOString();
          const target=withAsset=>{const keys=withAsset?['source_id','version','asset_id']:['source_id','version'];requireThat([...url.searchParams.keys()].length===keys.length&&keys.every(k=>url.searchParams.has(k)),'invalid_request');return Object.fromEntries(keys.map(k=>[k,url.searchParams.get(k)]));};
          if(route==='publisher-media'){
            requireThat(['GET','HEAD'].includes(request.method),'method_not_allowed');rate('read:'+s.principal.editorId,240);const result=await publisher.media(target(true),request,context);ensureActive();return result;
          }
          if(request.method==='GET'){
            rate('read:'+s.principal.editorId,240);let result;
            if(route==='publisher-documents'){requireThat(!url.search||([...url.searchParams.keys()].length===1&&url.searchParams.has('cursor')),'invalid_request');const raw=url.searchParams.get('cursor')??'0';requireThat(/^(0|[1-9][0-9]*)$/.test(raw),'invalid_request');result=publisher.list(Number(raw),context);}
            else if(route==='publisher-document')result={current_view:await publisher.document(target(false),context,at())};
            else if(route==='publisher-catalogue'&&!url.search)result=publisher.catalogue(context);
            else throw new BoundaryError('not_found');
            ensureActive();return reply({ok:true,...result});
          }
          requireThat(request.method==='POST'&&!url.search,'method_not_allowed');rate('write:'+s.principal.editorId,60);const data=await body(request,MAX_PUBLISHER_BODY);ensureActive();let result;
          if(['publisher-review-plan','publisher-import-plan','publisher-catalogue-plan'].includes(route))result={prepared:await publisher.plan(route.slice(10,-5),data,context,at())};
          else if(route==='publisher-apply')result={result:await publisher.apply(data,context,at())};
          else if(route==='publisher-withdraw')result={result:publisher.withdraw(data,context,at())};
          else throw new BoundaryError('not_found');
          ensureActive();return reply({ok:true,...result});
        }
        if (route === 'logout') {
          requireThat(request.method === 'POST' && !url.search, 'method_not_allowed'); requireThat(exact(await body(request), []), 'invalid_request'); ensureActive(); sessions.delete(key);
          return reply({ ok: true }, 200, { 'Set-Cookie': cookie('', now()) });
        }
        if(privateMode&&route!=='me')throw new BoundaryError('not_found');
        if (request.method === 'GET') {
          rate('read:' + s.principal.editorId, 240); ensureActive();
          if (route === 'me' && !url.search) return reply(publicAccess(s));
          if (route === 'templates' && !url.search) {
            if (!validatedTemplates) validatedTemplates = await Promise.all(templateSource.map(lesson => validateEditorLesson({ mode: 'synthetic-local', lesson })));
            ensureActive(); return reply({ ok: true, templates: validatedTemplates.map(v => v.lesson), publication_scope: 'synthetic_qa_only', human_review: false });
          }
          if (route === 'documents' && !url.search) return reply({ ok: true, documents: store.list(s.principal) });
          if (route === 'document') return reply({ ok: true, current_view: store.document(s.principal, queryId(url)) });
          if (route === 'audit') return reply({ ok: true, events: store.audit(s.principal, queryId(url, true)) });
          if (route === 'catalogue' && !url.search) return reply({ ok: true, ...store.qaCatalogue(s.principal) });
          if (writes.has(route)) throw new BoundaryError('method_not_allowed');
        }
        if (request.method === 'POST' && writes.has(route)) {
          requireThat(!url.search, 'invalid_request'); rate('write:' + s.principal.editorId, 60);
          const data = await body(request); ensureActive();
          const result = await store[writes.get(route)](s.principal, data, new Date(now()).toISOString(), ensureSession);
          ensureActive(); return reply({ ...result, current_view: store.document(s.principal, result.document.lesson_id) });
        }
        throw new BoundaryError('not_found');
      } catch (error) {
        counts.errors++; const known = Object.hasOwn(CODES, error?.code||error?.message), code = known ? (error.code||error.message) : 'internal_error';
        const issues = known && ['invalid_editor_draft', 'invalid_editor_integrity','invalid_publisher_schema','invalid_publisher_integrity'].includes(code) && Array.isArray(error.issues) ? { issues: error.issues.slice(0, 100) } : {};
        return reply({ ok: false, code, ...issues }, known ? CODES[code] : 500);
      }
    },
  };
}
