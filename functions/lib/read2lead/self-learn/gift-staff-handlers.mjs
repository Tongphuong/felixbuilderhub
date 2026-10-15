/** Explicit synthetic gift-staff sessions, separate from family and editorial cookies. */
import {publicGiftReceipt,publicStaffOrder,publicStaffOrders} from './gift-views.mjs';
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
const PREFIX = '/api/read2lead/gifts-staff/', COOKIE = 'r2l_synthetic_gift_staff', MAX_BODY = 4096;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
class BoundaryError extends Error { constructor(code) { super(code); this.code = code; } }
const requireThat = (ok, code) => { if (!ok) throw new BoundaryError(code); };
const CODES = {
 unauthorized:401,access_expired:401,invalid_editor_access:401,editor_access_revoked:401,editor_required:403,gift_staff_required:403,
 origin_refused:403,csrf_failed:403,invalid_request:400,invalid_json:400,request_aborted:400,body_too_large:413,unsupported_media_type:415,
 method_not_allowed:405,not_found:404,order_missing:404,request_conflict:409,invalid_transition:409,rate_limited:429,session_limit:429,
};
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers,
} });
function validOrigin(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(value)) return false;
  try { const url = new URL(value); return url.origin === value && Number(url.port) >= 1024 && Number(url.port) <= 65535; } catch { return false; }
}
function cookieToken(request) {
  const raw = request.headers.get('cookie') || ''; if (raw.length > 8192) return null;
  const matches = raw.split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE + '='));
  return matches.length === 1 && /^[a-f0-9]{64}$/.test(matches[0].slice(COOKIE.length + 1)) ? matches[0].slice(COOKIE.length + 1) : null;
}
async function body(request) {
  requireThat(!request.signal.aborted, 'request_aborted');
  requireThat(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'unsupported_media_type');
  const length = request.headers.get('content-length'); requireThat(!length || (/^\d+$/.test(length) && Number(length) <= MAX_BODY), 'body_too_large');
  const reader = request.body?.getReader(); requireThat(reader, 'invalid_json'); let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const part = await reader.read(); requireThat(!request.signal.aborted, 'request_aborted'); if (part.done) break;
      size += part.value.byteLength; if (size > MAX_BODY) { await reader.cancel(); throw new BoundaryError('body_too_large'); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text);
  } catch (e) { if (e instanceof BoundaryError) throw e; throw new BoundaryError('invalid_json'); }
  finally { reader.releaseLock(); }
}
export function createGiftStaffHandlers({mode,origin,store,editorStore,access,now=()=>Date.now(),ttlMs=900000}={}){
 if(mode!=='synthetic-local'||!validOrigin(origin)||!store||typeof store.fulfil!=='function'||!editorStore||typeof editorStore.access!=='function'||typeof now!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>900000||!exact(access,['format','purpose','editor_ids'])||access.format!==1||access.purpose!=='read2lead-local-synthetic-gift-staff'||!Array.isArray(access.editor_ids)||!access.editor_ids.length||access.editor_ids.length>20||!access.editor_ids.every(x=>validId(x)&&x.startsWith('synthetic-'))||new Set(access.editor_ids).size!==access.editor_ids.length)throw Error('unsafe_gift_staff_config');
 const allowed=new Set(access.editor_ids),sessions=new Map(),windows=new Map();
 function rate(key,limit){let row=windows.get(key);if(!row||now()-row.at>=60000){row={at:now(),count:0};windows.set(key,row);}requireThat(++row.count<=limit,'rate_limited');}
 function account(p){requireThat(allowed.has(p?.editorId),'gift_staff_required');return editorStore.access(p);}
 function clean(){for(const [key,s] of sessions){try{if(s.expires<=now())throw Error();account(s.principal);}catch{sessions.delete(key);}}}
 const cookie=(key,expires)=>`${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=${Math.max(0,Math.floor((expires-now())/1000))}`;
 function publicAccess(s){const value=account(s.principal);requireThat(value?.editor_id===s.principal.editorId&&typeof value.display_name==='string'&&value.display_name.length<=100,'unauthorized');return {ok:true,environment:'synthetic',staff_id:s.principal.editorId,display_name:value.display_name,role:'gift_staff',csrf:s.csrf,expires_at:new Date(s.expires).toISOString(),real_rewards:false};}
 function authenticate(request){const key=cookieToken(request),s=key&&sessions.get(key);requireThat(s,'unauthorized');if(s.expires<=now()){sessions.delete(key);throw new BoundaryError('access_expired');}try{account(s.principal);}catch(e){sessions.delete(key);throw e;}return {key,s};}
 return {diagnostics(){clean();return {active_sessions:sessions.size,scope:'synthetic_gift_staff',provider_enabled:false};},async handle(request){
  try{
   const url=new URL(request.url),incoming=request.headers.get('origin');requireThat(url.origin===origin&&(!request.headers.has('host')||request.headers.get('host')===url.host)&&(!incoming||incoming===origin)&&request.headers.get('sec-fetch-site')!=='cross-site','origin_refused');requireThat(['GET','POST'].includes(request.method),'method_not_allowed');requireThat(request.method!=='POST'||incoming===origin,'origin_refused');requireThat(url.pathname.startsWith(PREFIX),'not_found');requireThat(!request.signal.aborted,'request_aborted');const route=url.pathname.slice(PREFIX.length);
   if(route==='login'){
    requireThat(request.method==='POST'&&!url.search,'method_not_allowed');rate('login',20);const data=await body(request);requireThat(exact(data,['editor_id','access_secret']),'invalid_request');const principal=editorStore.authenticate(data.editor_id,data.access_secret);account(principal);clean();const previous=cookieToken(request);if(previous)sessions.delete(previous);requireThat(sessions.size<50,'session_limit');const key=token(),s={principal,csrf:token(),expires:now()+ttlMs};sessions.set(key,s);return reply(publicAccess(s),200,{'Set-Cookie':cookie(key,s.expires)});
   }
   const {key,s}=authenticate(request);if(request.method==='POST')requireThat(request.headers.get('x-r2l-gift-csrf')===s.csrf,'csrf_failed');
   const ensureActive=()=>{requireThat(!request.signal.aborted,'request_aborted');requireThat(sessions.get(key)===s,'unauthorized');requireThat(s.expires>now(),'access_expired');account(s.principal);};
   const principal={active:true,role:'staff',id:s.principal.editorId};
   if(route==='logout'){requireThat(request.method==='POST'&&!url.search,'method_not_allowed');requireThat(exact(await body(request),[]),'invalid_request');ensureActive();sessions.delete(key);return reply({ok:true},200,{'Set-Cookie':cookie('',now())});}
   if(request.method==='GET'){
    rate('read:'+principal.id,180);ensureActive();
    if(route==='me'&&!url.search)return reply(publicAccess(s));
    if(route==='orders'&&!url.search){const orders=publicStaffOrders(store.staffOrders(principal,ensureActive));ensureActive();return reply({ok:true,orders,history_limit:100,real_rewards:false});}
    if(route==='order'){const keys=[...url.searchParams.keys()],id=url.searchParams.get('redemption_id');requireThat(keys.length===1&&keys[0]==='redemption_id'&&typeof id==='string'&&id.length>0&&id.length<=300,'invalid_request');const current=publicStaffOrder(store.staffOrder(principal,id,ensureActive));requireThat(current.order.redemption_id===id,'invalid_request');ensureActive();return reply({ok:true,current_order:current});}
   }
   if(request.method==='POST'&&['fulfil','refund'].includes(route)){
    requireThat(!url.search,'invalid_request');rate('write:'+principal.id,30);const data=await body(request);ensureActive();const result=store[route](principal,data,new Date(now()).toISOString(),ensureActive);ensureActive();const receipt=publicGiftReceipt(result,route),current=publicStaffOrder(store.staffOrder(principal,receipt.receipt.redemption.redemption_id,ensureActive));requireThat(receipt.receipt.redemption.redemption_id===data.redemption_id&&current.order.redemption_id===data.redemption_id,'invalid_request');ensureActive();return reply({...receipt,current_order:current});
   }
   if(['orders','order','me','fulfil','refund'].includes(route))throw new BoundaryError('method_not_allowed');throw new BoundaryError('not_found');
  }catch(error){const known=Object.hasOwn(CODES,error?.code),code=known?error.code:'temporarily_unavailable';return reply({ok:false,code},known?CODES[code]:503);}
 }};
}
