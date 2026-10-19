import { ACCOUNT_ROUTES } from './account-routes.mjs';
import { EXISTING_TEST_OBJECT, VERIFIED_ADMIN_HEADER } from './account-gateway.mjs';
import { verifyTurnstile, turnstileRefusal, turnstileTokenProblem, TURNSTILE_VERIFIED_HEADER } from '../../api/signup.js';
import { getClientIp } from '../../api/_rate-limit.js';

export const UNIFIED_MODE = 'unified-v1';
export const FREEZE_MODE = 'freeze-v1';
export const ACCOUNT_MODE_HEADER = 'X-R2L-Account-Mode';
export const ACCOUNT_PLAN_HEADER = 'X-R2L-Account-Rollout';
const unavailable = () => Response.json({code:'account_host_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
const fail = () => { throw Error('legacy_account_fenced'); };
const fenced = Object.freeze({get:fail,getWithMetadata:fail,list:fail,put:fail,delete:fail});
const pausedPage = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Read2Lead đang cập nhật</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#fbf6e9;color:#24382e;font:18px/1.6 system-ui,sans-serif}main{width:100%;max-width:520px;padding:32px;border:1px solid #e2d9bc;border-radius:24px;background:#fffdf7}h1{font-size:clamp(24px,5vw,32px);line-height:1.25;margin:0 0 20px}p{margin:0 0 20px}a{display:inline-block;background:#315b43;color:white;padding:12px 24px;border-radius:14px;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid #a66e0b;outline-offset:4px}
</style></head><body><main data-read2lead-state="account_temporarily_paused"><h1>Read2Lead đang cập nhật</h1><p>Bài đã lưu và kim cương của con vẫn được giữ nguyên.</p><p>Con quay lại sau nhé.</p><a href="">Thử lại</a></main></body></html>`;
function pausedResponse(request, pathname) {
  const options={status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}};
  if (!pathname.startsWith('/api/')&&['GET','HEAD'].includes(request.method)) {
    options.headers['Content-Type']='text/html; charset=utf-8';
    return new Response(request.method==='HEAD'?null:pausedPage,options);
  }
  return Response.json({code:'account_temporarily_paused'},options);
}
const patterns = ACCOUNT_ROUTES.map(route => new RegExp('^'+route.pattern.split('/').map(part => part.startsWith('[')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'$'));

export function isUnifiedAccountPath(path) {
  return patterns.some(pattern=>pattern.test(path)) ||
    /^\/api\/(?:read2lead(?:-|\/|$)|parent(?:\/|$)|admin\/(?:codes|classes|gifts|portfolio|homework-photo|read2lead)(?:\/|-|$))/.test(path) ||
    /^\/(?:read2lead|ho-so|read2lead-profile)(?:\/|$)/.test(path);
}

/** Call only after Pages' existing admin gate. Off unless explicitly configured.
 * Freeze fences all old KV access, including unknown/background route writers.
 * Unified requests require the same pinned rollout on both ends; failures and
 * 404s NEVER delegate back to legacy accounts. Static public pages stay Pages.
 */
export async function unifiedAccountGateway(context) {
  const {request,env}=context,mode=env.R2L_ACCOUNT_MODE;
  if (!mode) return null;
  if (env.READ2LEAD_CODES) env.READ2LEAD_CODES=fenced;
  if (env.READ2LEAD_PROGRESS) env.READ2LEAD_PROGRESS=fenced;
  const url=new URL(request.url);
  if (![UNIFIED_MODE,FREEZE_MODE].includes(mode)) return unavailable();
  if (['/r2l/start','/r2l/start/'].includes(url.pathname)&&['GET','HEAD'].includes(request.method)) {
    (context.data??={}).clearRead2LeadAccountCookies=true;
    return null;
  }
  // Bare entry address (no explicit code): a device with NO reader session gets the
  // public static shell (friendly code form, no student data); a device WITH a session
  // cookie still goes to the account host, which decides if it is valid (see below).
  // Exact paths only; any explicit code/access_code goes to the account host as before.
  const hasReaderCookie=(request.headers.get('cookie')||'').split(';').some(value=>value.trim().startsWith('__Host-r2l_account='));
  const bareEntry=mode===UNIFIED_MODE&&['GET','HEAD'].includes(request.method)&&
    ['/read2lead','/read2lead/','/ho-so','/ho-so/'].includes(url.pathname)&&
    !url.searchParams.has('code')&&!url.searchParams.has('access_code');
  if (bareEntry&&!hasReaderCookie) return null;
  // The account HTML, hashed build assets and retelling pictures share one bundle.
  // Cookie presence selects transport only; the host authenticates the token.
  const accountAsset=mode===UNIFIED_MODE&&['GET','HEAD'].includes(request.method)&&
    (/^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(url.pathname)||
    /^\/story-retell\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpg|jpeg|webp)$/.test(url.pathname))&&
    (request.headers.get('cookie')||'').split(';').some(value=>value.trim().startsWith('__Host-r2l_account='));
  if (!isUnifiedAccountPath(url.pathname)&&!accountAsset) return null;
  if (mode===FREEZE_MODE) return pausedResponse(request,url.pathname);
  const pin=env.R2L_ACCOUNT_ROLLOUT_SHA256,namespace=env.R2L_MAINTENANCE_STATE;
  if (!/^[a-f0-9]{64}$/.test(pin||'')||!namespace) return unavailable();
  try {
    const headers=new Headers(request.headers);
    headers.delete(VERIFIED_ADMIN_HEADER);
    if (url.pathname.startsWith('/api/admin/')) headers.set(VERIFIED_ADMIN_HEADER,'1');
    headers.set(ACCOUNT_MODE_HEADER,UNIFIED_MODE);
    headers.set(ACCOUNT_PLAN_HEADER,pin);
    // Turnstile for public sign-up is verified HERE, outside the serialized account lane, with a
    // hard timeout; junk or hung verification never enters the account object. The marker is
    // stripped from EVERY incoming request first, so a client can never forge it.
    headers.delete(TURNSTILE_VERIFIED_HEADER);
    if (request.method==='POST'&&url.pathname==='/api/signup') {
      const secret=env.TURNSTILE_SECRET_KEY;
      if (!secret) return turnstileRefusal('turnstile_not_configured');
      let body;
      try { body=await request.clone().json(); } catch { return turnstileRefusal('invalid_json'); }
      if (!body||typeof body!=='object'||Array.isArray(body)) return turnstileRefusal('invalid_json');
      const token=body.turnstile_token||body['cf-turnstile-response'];
      const problem=turnstileTokenProblem(token);
      if (problem) return turnstileRefusal(problem);
      let passed=false;
      try { passed=await verifyTurnstile(secret,token,getClientIp(request),context.fetchImpl||fetch); } catch { passed=false; }
      if (!passed) return turnstileRefusal('turnstile_failed');
      headers.set(TURNSTILE_VERIFIED_HEADER,'1');
    }
    const response=await namespace.get(namespace.idFromName(EXISTING_TEST_OBJECT)).fetch(new Request(request,{headers}));
    if (response.headers.get('X-R2L-Account-Host')!==EXISTING_TEST_OBJECT||
        response.headers.get(ACCOUNT_MODE_HEADER)!==UNIFIED_MODE||response.headers.get(ACCOUNT_PLAN_HEADER)!==pin||
        (response.status>=300&&response.status<400)) {
      await response.body?.cancel();return unavailable();
    }
    // Logged-out (or expired/unknown-session) visitor opening a student PAGE, e.g. a shared
    // /read2lead/library link: send them to the public page with sign-up instead of a bare 401.
    // Not for APIs, admin, private paths, assets, non-GET/HEAD, or an explicit code (those keep 401).
    if(response.status===401&&['GET','HEAD'].includes(request.method)&&!accountAsset&&!bareEntry&&
       !url.searchParams.has('code')&&!url.searchParams.has('access_code')&&
       !url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/admin')&&!url.pathname.startsWith('/__private/')){
      await response.body?.cancel();return new Response(null,{status:303,headers:{'Location':'/read2lead/','Cache-Control':'no-store'}});
    }
    // Public pages can request their own assets with an old student cookie.
    // Only this static-file path may fall back, never an account API or page.
    if(accountAsset&&[401,404].includes(response.status)){
      await response.body?.cancel();return null;
    }
    // Stale/unknown reader cookie on the bare entry address: show the public code
    // form and drop the dead cookie, not the account host's bare 401 text.
    if(bareEntry&&response.status===401){
      await response.body?.cancel();(context.data??={}).clearRead2LeadAccountCookies=true;return null;
    }
    return response;
  } catch { return unavailable(); }
}
