import { createPreviewApp } from './app.mjs';
import { createRead2LeadAccountService } from '../../functions/lib/read2lead/account-service.mjs';
import { createAccountTransactionRunner } from '../../functions/lib/read2lead/account-transactions.mjs';
import { importAccountSnapshot } from '../../functions/lib/read2lead/account-snapshot.mjs';
import { StorySqlStore } from '../../functions/lib/read2lead/story-store.mjs';
import { createPrivateContent } from '../../functions/lib/read2lead/private-content.mjs';

export const TEST_ACCOUNT_COOKIE = '__Host-r2l_student_test';
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const reply = (code,status) => Response.json({code},{status,headers:{'Cache-Control':'private, no-store'}});

/** Trusted, single existing TEST account host. Caller must complete live routing
 * and old-writer fencing before enabling it. Snapshot pins are not that proof.
 * No HTTP import, fabricated profile, automatic level change or voice grant.
 */
export function createExistingTestAccountApp({db,transaction,assets,snapshot,expectedSnapshotSha256,packageSha256,code,origin,infrastructure={},voiceConfig=null,scheduleBackground,now=()=>Date.now()}) {
  if(!/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(code||'')||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('test_account_host_config_required');
  const ownedSnapshot=structuredClone(snapshot);
  const records=ownedSnapshot?.records;
  const progressNamespace=ownedSnapshot?.progressInCodes?'codes':'progress';
  if(!Array.isArray(records)||records.length!==2||!records.some(r=>r.namespace===progressNamespace&&r.key==='progress:'+code))throw Error('test_account_inventory_required');
  const record=records.find(r=>r.namespace==='codes'&&r.key===code);
  let original;try{original=JSON.parse(record?.value);}catch{throw Error('test_account_required');}
  if(original?.is_test!==true||original.is_shared!==false||!original.student_profile)throw Error('test_account_required');
  const progressInCodes=ownedSnapshot.progressInCodes;
  createAccountTransactionRunner({db,transaction,now,progressInCodes});
  const store=new StorySqlStore(db,{transaction,now});
  db.exec('CREATE TABLE IF NOT EXISTS account_browser_access (token TEXT PRIMARY KEY, origin TEXT NOT NULL, expires INTEGER NOT NULL)');
  let initialized;
  const initialize=()=>initialized??=(async()=>{
    // Validate content BEFORE the first account import, not after a failed view.
    const asset=await assets.fetch(new Request('https://preview-assets.invalid/__private/package.json'));
    if(!asset.ok)throw Error('test_account_content_missing');
    const text=await asset.text();if(await hash(text)!==packageSha256)throw Error('test_account_content_pin_mismatch');
    const manifest=JSON.parse(text);if(manifest.existingSite!==true||manifest.format!=='read2lead-private-cloud-preview-v1')throw Error('test_account_content_invalid');
    if(!Array.isArray(manifest.publicAssets)||!Array.isArray(manifest.scriptHashes))throw Error('test_account_content_invalid');
    await createPrivateContent({pkg:manifest.package,packages:manifest.packages,legacyBooks:manifest.legacyBooks}).fingerprints();
    return importAccountSnapshot({db,transaction,snapshot:ownedSnapshot,expectedSha256:expectedSnapshotSha256,progressInCodes});
  })().catch(error=>{initialized=null;throw error;});
  function currentAccount(){
    const row=db.prepare("SELECT value,expires FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(code);
    if(!row||(row.expires!==null&&row.expires<=now()))return null;
    const account=JSON.parse(row.value);
    if(account.is_test!==true||account.is_shared!==false||!account.student_profile)return null;
    return account;
  }
  function explicitCode(request){
    const url=new URL(request.url),found=[...url.searchParams.getAll('code'),...url.searchParams.getAll('access_code')];
    const header=request.headers.get('X-Read2Lead-Code');if(header!==null)found.push(header);
    const match=/^\/api\/admin\/codes\/([^/]+)(?:\/|$)/.exec(url.pathname);
    if(match)try{found.push(decodeURIComponent(match[1]));}catch{return false;}
    if(!found.length)return null;
    return found.every(v=>v.trim().toUpperCase()===code)?code:false;
  }
  function isLinkLookup(request){
    return ['GET','HEAD'].includes(request.method)&&new URL(request.url).pathname==='/api/r2l-link';
  }
  function ownsLink(request){
    const tokens=new URL(request.url).searchParams.getAll('token');
    if(tokens.length!==1||!/^[a-f0-9]{32}$/.test(tokens[0]))return false;
    const row=db.prepare("SELECT value,expires FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get('r2l_link:'+tokens[0]);
    // Ownership is not validity: the original resolver still checks the
    // record's expiry and controls its renewal and last-used bookkeeping.
    return !!row&&(row.expires===null||row.expires>now())&&JSON.parse(row.value)?.access_code===code;
  }
  async function cookieOwner(request){
    const raw=request.headers.get('cookie')||'';if(raw.length>8192)return null;
    const tokens=raw.split(';').map(v=>v.trim()).filter(v=>v.startsWith(TEST_ACCOUNT_COOKIE+'='));
    if(tokens.length!==1)return null;
    const token=tokens[0].slice(TEST_ACCOUNT_COOKIE.length+1);if(!/^[a-f0-9]{64}$/.test(token))return null;
    const row=db.prepare('SELECT expires,origin FROM account_browser_access WHERE token=?').get(await hash(token));
    return row&&row.expires>now()&&row.origin===origin?code:null;
  }
  // A parent may open the code-bearing reader link from another site. Only
  // this top-level document GET can enter; cookies alone, embeds and API
  // requests never receive the cross-site exception.
  function allowsCrossSiteNavigation(request){
    const url=new URL(request.url);
    return url.origin===origin&&request.method==='GET'&&
      ['/read2lead','/read2lead/'].includes(url.pathname)&&
      request.headers.get('sec-fetch-mode')==='navigate'&&
      request.headers.get('sec-fetch-dest')==='document'&&
      (url.searchParams.has('code')||url.searchParams.has('access_code'))&&
      explicitCode(request)===code;
  }
  async function authenticate(request){
    const url=new URL(request.url);
    if(url.origin!==origin||(request.headers.get('sec-fetch-site')==='cross-site'&&!allowsCrossSiteNavigation(request))||(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==origin))return null;
    const explicit=explicitCode(request);if(explicit===false)return null;
    if(!currentAccount())return null;
    if(isLinkLookup(request)&&ownsLink(request))return code;
    return explicit===code?code:cookieOwner(request);
  }
  const app=createPreviewApp({store,assets,packageSha256,now,accountRuntime:{authenticate,allowsCrossSiteNavigation,async apiFor(manifest){
    // Service overrides any supplied legacy account bindings with its SQL store.
    const content=manifest.content;
    return createRead2LeadAccountService({db,transaction,now,progressInCodes,scheduleBackground,
      infrastructure:{...infrastructure,R2L_CONTENT_SOURCE:content.contentSource,R2L_PRIVATE_QA:'adult-isolated',R2L_STORY_CATALOGUE:{get:async key=>content.storyValue(key)}},
      story:{origin,voiceConfig}});
  }}});
  return async request=>{
    try{
      if(new URL(request.url).origin!==origin)return reply('origin_refused',403);
      await initialize();
      if(isLinkLookup(request)){
        if(request.headers.get('sec-fetch-site')==='cross-site')return reply('origin_refused',403);
        if(explicitCode(request)===false)return reply('student_access_required',401);
        if(!ownsLink(request))return Response.json({ok:false,error:'link_not_found'},{status:404,headers:{'Cache-Control':'no-store'}});
      }
      const response=await app(request);
      // Issue access for ordinary same-origin media requests after a successful
      // code-bearing student page. APIs keep their existing code/auth checks.
      if(request.method==='GET'&&!new URL(request.url).pathname.startsWith('/api/')&&explicitCode(request)===code&&response.ok&&await authenticate(request)&&!await cookieOwner(request)){
        const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
        const tokenHash=await hash(token);
        transaction(()=>{
          db.prepare('DELETE FROM account_browser_access WHERE expires<=?').run(now());
          if(db.prepare('SELECT COUNT(*) AS n FROM account_browser_access').get().n>=32)throw Error('test_account_browser_limit');
          db.prepare('INSERT INTO account_browser_access VALUES(?,?,?)').run(tokenHash,origin,now()+900000);
        });
        const headers=new Headers(response.headers);headers.append('Set-Cookie',`${TEST_ACCOUNT_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`);
        return new Response(response.body,{status:response.status,headers});
      }
      return response;
    }catch{return reply('test_account_unavailable',503);}
  };
}
