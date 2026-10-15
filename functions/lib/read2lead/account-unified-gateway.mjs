import { ACCOUNT_ROUTES } from './account-routes.mjs';
import { EXISTING_TEST_OBJECT, VERIFIED_ADMIN_HEADER } from './account-gateway.mjs';

export const UNIFIED_MODE = 'unified-v1';
export const FREEZE_MODE = 'freeze-v1';
export const ACCOUNT_MODE_HEADER = 'X-R2L-Account-Mode';
export const ACCOUNT_PLAN_HEADER = 'X-R2L-Account-Rollout';
const unavailable = () => Response.json({code:'account_host_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
const fail = () => { throw Error('legacy_account_fenced'); };
const fenced = Object.freeze({get:fail,getWithMetadata:fail,list:fail,put:fail,delete:fail});
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
  if (!isUnifiedAccountPath(url.pathname)) return null;
  if (mode===FREEZE_MODE) return Response.json({code:'account_temporarily_paused'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}});
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
    return response;
  } catch { return unavailable(); }
}
