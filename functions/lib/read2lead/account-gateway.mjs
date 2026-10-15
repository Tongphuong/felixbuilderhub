import { fenceLegacyAccountBindings } from './account-legacy-fence.mjs';
import { onRequestGet as listAdminCodes } from '../../api/admin/codes.js';

export const EXISTING_TEST_OBJECT = 'existing-student-test-v1';
export const EXISTING_TEST_COOKIE = '__Host-r2l_student_test';
export const VERIFIED_ADMIN_HEADER = 'X-R2L-Account-Admin-Verified';
const unavailable=()=>Response.json({code:'test_account_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
const fencedEnvironments=new WeakMap();

// The original cursor still defines each page. Replace only the selected row
// on the page where its source key occurs; never expose its stale KV value.
async function authoritativeAdminList(context,code,rawCodes){
  let selectedOnPage=false;
  const guarded=context.env.READ2LEAD_CODES;
  const codes=Object.freeze({...guarded,list:async options=>{
    const page=await rawCodes.list(options);
    if(!page||!Array.isArray(page.keys))throw Error('invalid_legacy_account_fence');
    selectedOnPage=page.keys.some(row=>row.name===code);
    return {...page,keys:page.keys.filter(row=>row.name!==code&&row.name!=='progress:'+code)};
  }});
  const response=await listAdminCodes({...context,env:{...context.env,READ2LEAD_CODES:codes}});
  if(!response.ok||!selectedOnPage)return response;
  const namespace=context.env.R2L_MAINTENANCE_STATE;if(!namespace)return unavailable();
  try{
    const url=new URL(context.request.url);url.search='';
    const headers=new Headers(context.request.headers);
    headers.set('X-Read2Lead-Code',code);headers.set(VERIFIED_ADMIN_HEADER,'1');
    const current=await namespace.get(namespace.idFromName(EXISTING_TEST_OBJECT)).fetch(new Request(url,{headers}));
    if(!current.ok||current.headers.get('X-R2L-Account-Host')!==EXISTING_TEST_OBJECT){await current.body?.cancel();return unavailable();}
    const selected=await current.json();
    if(!selected.ok||!selected.list_complete||selected.items?.length!==1||selected.items[0].code!==code)return unavailable();
    const result=await response.json();result.items.push(selected.items[0]);
    result.items.sort((a,b)=>(b.issued_at||'').localeCompare(a.issued_at||''));
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch{return unavailable();}
}

/** Called ONLY after the ordinary Pages admin gate. The named backend is
 * internal to the existing DO binding, not a public HTTP authority header.
 */
export async function existingTestAccountGateway(context){
  const {request,env}=context;
  if(!env.R2L_TEST_ACCOUNT_CODE)return null;
  const code=env.R2L_TEST_ACCOUNT_CODE;
  if(typeof code!=='string'||!/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(code))return unavailable();
  // Do not expose raw bindings to next() or its detached/background handlers.
  const previous=fencedEnvironments.get(env);
  if(!previous||previous.code!==code||previous.codes!==env.READ2LEAD_CODES||previous.progress!==env.READ2LEAD_PROGRESS){
    const rawCodes=previous?.codes===env.READ2LEAD_CODES?previous.rawCodes:env.READ2LEAD_CODES;
    const guarded=fenceLegacyAccountBindings(env,{codes:[code],progress:['progress:'+code]});
    env.READ2LEAD_CODES=guarded.READ2LEAD_CODES;
    if(env.READ2LEAD_PROGRESS)env.READ2LEAD_PROGRESS=guarded.READ2LEAD_PROGRESS;
    fencedEnvironments.set(env,{code,codes:env.READ2LEAD_CODES,progress:env.READ2LEAD_PROGRESS,rawCodes});
  }
  const url=new URL(request.url),codes=[...url.searchParams.getAll('code'),...url.searchParams.getAll('access_code')];
  if(url.pathname==='/api/admin/codes'&&request.method==='GET')return authoritativeAdminList(context,code,fencedEnvironments.get(env).rawCodes);
  if(url.pathname==='/private-rehearsal/login')return null;
  // This is a public token-entry shell. An old student cookie must not route
  // it into protected lesson authentication before its token can be resolved.
  if(['/r2l/start','/r2l/start/'].includes(url.pathname)&&['GET','HEAD'].includes(request.method)){
    // Its public scripts/styles must not inherit a stale protected-asset cookie.
    // The resolved code will establish fresh media access on the lesson page.
    (context.data??={}).clearRead2LeadTestCookie=true;
    return null;
  }
  const header=request.headers.get('X-Read2Lead-Code');if(header!==null)codes.push(header);
  const match=/^\/api\/admin\/codes\/([^/]+)(?:\/|$)/.exec(url.pathname);
  if(match)try{codes.push(decodeURIComponent(match[1]));}catch{return unavailable();}
  const hasCookie=(request.headers.get('cookie')||'').split(';').some(v=>v.trim().startsWith(EXISTING_TEST_COOKIE+'='));
  if(!codes.some(v=>v.trim().toUpperCase()===code)&&!['GET','HEAD'].includes(request.method)){
    const type=request.headers.get('content-type')?.split(';')[0];
    try{
      if(type==='application/json'){
        const value=await request.clone().json();for(const field of ['code','access_code'])if(typeof value?.[field]==='string')codes.push(value[field]);
      }else if(type==='multipart/form-data'||type==='application/x-www-form-urlencoded'){
        const form=await request.clone().formData();for(const field of ['code','access_code'])for(const value of form.getAll(field))if(typeof value==='string')codes.push(value);
      }
    }catch{/* Original handler validates malformed bodies; guarded storage stays closed. */}
  }
  const selected=codes.some(v=>v.trim().toUpperCase()===code);
  // Admin-created selected-account tokens live in its SQL store. Resolve the
  // token there first, without pretending the caller supplied an account code.
  // Only an explicit missing-token response may use the original KV resolver.
  const tokenLookup=url.pathname==='/api/r2l-link'&&['GET','HEAD'].includes(request.method)&&codes.length===0;
  if(!selected&&codes.length){
    if(hasCookie)(context.data??={}).clearRead2LeadTestCookie=true;
    return null;
  }
  // A student cookie must not turn a global admin operation into a one-account
  // operation or silently replace the founder's list of ordinary accounts.
  if(!selected&&!tokenLookup&&(!hasCookie||url.pathname.startsWith('/api/admin')))return null;
  const namespace=env.R2L_MAINTENANCE_STATE;if(!namespace)return unavailable();
  try{
    const headers=new Headers(request.headers);headers.delete(VERIFIED_ADMIN_HEADER);
    if(url.pathname.startsWith('/api/admin/'))headers.set(VERIFIED_ADMIN_HEADER,'1');
    // HEAD needs the resolver's structured result to decide legacy fallback;
    // strip the body only after routing is decided, never infer from status alone.
    const response=await namespace.get(namespace.idFromName(EXISTING_TEST_OBJECT)).fetch(new Request(request,{headers,...(tokenLookup&&request.method==='HEAD'?{method:'GET'}:{})}));
    if(response.headers.get('X-R2L-Account-Host')!==EXISTING_TEST_OBJECT){await response.body?.cancel();return unavailable();}
    if(tokenLookup&&response.status===404){
      const missing=await response.clone().json();
      if(missing.ok===false&&missing.error==='link_not_found'){
        await response.body?.cancel();
        if(hasCookie)(context.data??={}).clearRead2LeadTestCookie=true;
        return null;
      }
    }
    if(response.status===404&&['GET','HEAD'].includes(request.method)&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/__private/')){
      await response.body?.cancel();return null;
    }
    return tokenLookup&&request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
  }catch{return unavailable();}
}
