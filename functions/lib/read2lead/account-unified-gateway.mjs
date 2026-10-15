import { ACCOUNT_ROUTES } from './account-routes.mjs';
import { EXISTING_TEST_OBJECT, VERIFIED_ADMIN_HEADER } from './account-gateway.mjs';

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
    const response=await namespace.get(namespace.idFromName(EXISTING_TEST_OBJECT)).fetch(new Request(request,{headers}));
    if (response.headers.get('X-R2L-Account-Host')!==EXISTING_TEST_OBJECT||
        response.headers.get(ACCOUNT_MODE_HEADER)!==UNIFIED_MODE||response.headers.get(ACCOUNT_PLAN_HEADER)!==pin||
        (response.status>=300&&response.status<400)) {
      await response.body?.cancel();return unavailable();
    }
    // Public pages can request their own assets with an old student cookie.
    // Only this static-file path may fall back, never an account API or page.
    if(accountAsset&&[401,404].includes(response.status)){
      await response.body?.cancel();return null;
    }
    return response;
  } catch { return unavailable(); }
}
