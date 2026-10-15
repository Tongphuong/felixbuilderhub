import {createStorySessionHandler} from '../../functions/api/read2lead-story-session.js';
import {createPrivateSiteApi,PRIVATE_SITE_CODE} from '../../functions/lib/read2lead/private-site.mjs';
import {validateBookLibrary,bookLibraryMedia,libraryPublicView} from '../../functions/lib/read2lead/book-library.mjs';
import {createPrivateContent} from '../../functions/lib/read2lead/private-content.mjs';

const LOGIN='/private-rehearsal/login', COOKIE='__Host-r2l_preview';
const landing='/read2lead/lesson/?mission=story-mission-v1';
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async text=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
const loginPage='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Read2Lead private preview</title><h1>Read2Lead private preview</h1><p>Adult review of unpublished lessons. Separate test progress.</p><form method="post" action="'+LOGIN+'"><label>Private access key <input name="access_secret" type="password" autocomplete="current-password" required></label><button>Open private preview</button></form></html>';

// Share only verified immutable content within one trusted host. Account state,
// access cookies, services and provider grants are never part of this loader.
const verifiedLoaders=new WeakSet();
function freezeContent(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeContent(child);
    Object.freeze(value);
  }
  return value;
}
export function createPreviewContentLoader({assets,packageSha256,existing}) {
  if(existing!==undefined){
    if(!verifiedLoaders.has(existing)||existing.assets!==assets||existing.packageSha256!==packageSha256)throw Error('preview_content_loader_mismatch');
    return existing;
  }
  let loaded;
  const loader=Object.freeze({assets,packageSha256,async load(){
    if(!loaded)loaded=(async()=>{
      const response=await assets.fetch(new Request('https://preview-assets.invalid/__private/package.json'));
      if(!response.ok)throw Error('preview_package_missing');
      const text=await response.text();
      if(await digest(text)!==packageSha256)throw Error('preview_package_changed');
      const value=JSON.parse(text);
      if(value.format!=='read2lead-private-cloud-preview-v1'||!value.package?.lesson||!Array.isArray(value.publicAssets)||!Array.isArray(value.scriptHashes))throw Error('preview_package_invalid');
      const content=createPrivateContent({pkg:value.package,packages:value.packages,legacyBooks:value.legacyBooks});
      await content.fingerprints();
      return freezeContent({...value,content});
    })().catch(error=>{loaded=null;throw error;});
    return loaded;
  }});
  verifiedLoaders.add(loader);return loader;
}

/** Shared logic for the isolated preview; no production bindings; voice requires explicit private configuration. */
export function createPreviewApp({store,assets,accessKey,packageSha256,voiceConfigurationFor=()=>({config:null,status:{enabled:false,reason:'not_configured'}}),now=()=>Date.now(),accountRuntime=null,contentLoader}) {
  if(accountRuntime!==null&&(typeof accountRuntime.authenticate!=='function'||typeof accountRuntime.apiFor!=='function'))throw Error('account_runtime_required');
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS preview_access (token TEXT PRIMARY KEY, origin TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS preview_login_limits (window INTEGER PRIMARY KEY, attempts INTEGER NOT NULL);`);
  const bundle=createPreviewContentLoader({assets,packageSha256,existing:contentLoader});
  let siteApi,loadedLibrary,originalBookMedia=false;
  async function library(hash){
    if(!loadedLibrary)loadedLibrary=(async()=>{
      const response=await assets.fetch(new Request('https://preview-assets.invalid/__private/book-library.json'));
      if(!response.ok)throw Error('library_missing');
      const text=await response.text();if(await digest(text)!==hash)throw Error('library_changed');
      return validateBookLibrary(JSON.parse(text));
    })().catch(error=>{loadedLibrary=null;throw error;});
    return loadedLibrary;
  }
  async function manifest() {
    const value=await bundle.load();
    originalBookMedia=value.existingSite===true&&value.legacyBooks?.length>0;
    return value;
  }
  async function authenticate(request) {
    if(accountRuntime)return accountRuntime.authenticate(request);
    const raw=request.headers.get('cookie')||'';
    if(raw.length>8192)return null;
    const token=raw.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if(!/^[a-f0-9]{64}$/.test(token||''))return null;
    const row=db.prepare('SELECT expires,origin FROM preview_access WHERE token=?').get(await digest(accessKey+':'+token));
    return row&&row.expires>now()&&row.origin===new URL(request.url).origin?'private-preview-adult':null;
  }
  const secure=(response,scriptHashes=[])=>{
    const headers=new Headers(response.headers);
    headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','same-origin');headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
    headers.set('Permissions-Policy','microphone=(self), camera=(), geolocation=()');
    // Existing books retain their original publisher audio/image URLs. This
    // fixed media origin cannot be supplied by a request or load scripts.
    const mediaOrigin=originalBookMedia?' https://audio.felixbuilderhub.com':'';
    headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' ${scriptHashes.map(x=>"'"+x+"'").join(' ')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:${mediaOrigin}; media-src 'self' blob: data:${mediaOrigin}; connect-src 'self'${mediaOrigin}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    return new Response(response.body,{status:response.status,headers});
  };
  const reply=(text,status=200,headers={})=>secure(new Response(text,{status,headers}));
  return async request=>{
    try {
      if((!accountRuntime&&(typeof accessKey!=='string'||accessKey.length<32))||!/^[a-f0-9]{64}$/.test(packageSha256||''))return reply('Private preview is not configured',503);
      const url=new URL(request.url);
      if(url.protocol!=='https:')return reply('HTTPS required',403);
      if(request.headers.get('sec-fetch-site')==='cross-site'&&accountRuntime?.allowsCrossSiteNavigation?.(request)!==true)return reply('Origin refused',403);
      if(url.pathname===LOGIN) {
        if(accountRuntime)return reply('Not found',404);
        if(url.search)return reply('Invalid request',400);
        if(['GET','HEAD'].includes(request.method))return reply(request.method==='HEAD'?null:loginPage,200,{'Content-Type':'text/html; charset=utf-8'});
        if(request.method!=='POST')return reply('Method not allowed',405);
        if(request.headers.get('origin')!==url.origin||request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded')return reply('Origin refused',403);
        const window=Math.floor(now()/60000);
        const count=store.transaction(()=>{
          db.prepare('DELETE FROM preview_login_limits WHERE window<?').run(window);
          db.prepare('INSERT INTO preview_login_limits VALUES(?,1) ON CONFLICT(window) DO UPDATE SET attempts=attempts+1').run(window);
          return db.prepare('SELECT attempts FROM preview_login_limits WHERE window=?').get(window).attempts;
        });
        if(count>20)return reply('Try again later',429,{'Retry-After':'60'});
        const reader=request.body?.getReader();if(!reader)return reply('Invalid request',400);
        let size=0,text='';const decoder=new TextDecoder();
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply('Request too large',413);}text+=decoder.decode(value,{stream:true});}
        text+=decoder.decode();const form=new URLSearchParams(text);
        if([...form.keys()].join(',')!=='access_secret')return reply('Invalid request',400);
        const expected=await digest(accessKey),received=await digest(form.get('access_secret'));
        let unequal=0;for(let i=0;i<expected.length;i++)unequal|=expected.charCodeAt(i)^received.charCodeAt(i);
        if(unequal)return reply('Private access refused',401);
        const token=hex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await digest(accessKey+':'+token);
        store.transaction(()=>{
          db.prepare('DELETE FROM preview_access WHERE expires<=?').run(now());
          if(db.prepare('SELECT COUNT(*) AS n FROM preview_access').get().n>=20)throw Error('preview_session_limit');
          db.prepare('INSERT INTO preview_access VALUES(?,?,?)').run(tokenHash,url.origin,now()+900000);
        });
        const target=(await manifest()).existingSite?'/read2lead/?code='+PRIVATE_SITE_CODE:landing;
        return reply('',303,{'Location':target,'Set-Cookie':`${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`});
      }
      if(!await authenticate(request))return accountRuntime?reply('Student access required',401):url.pathname.startsWith('/api/')?reply('Private access required',401):reply('',303,{'Location':LOGIN});
      if(url.pathname.startsWith('/__private/'))return reply('Not found',404);
      const m=await manifest(),pkg=m.package;
      if(url.pathname==='/api/read2lead-library'||url.pathname.startsWith('/api/read2lead-library-media/')){
        if(!/^[a-f0-9]{64}$/.test(m.librarySha256||''))return reply('Not found',404);
        if(!['GET','HEAD'].includes(request.method))return reply('Method not allowed',405);
        const catalogue=await library(m.librarySha256);
        if(url.pathname==='/api/read2lead-library')return url.search?reply('Not found',404):reply(request.method==='HEAD'?null:JSON.stringify(libraryPublicView(catalogue)),200,{'Content-Type':'application/json'});
        return secure(await bookLibraryMedia(request,catalogue,assets),m.scriptHashes);
      }
      if(m.existingSite&&url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/read2lead-story-media/')) {
        if(!siteApi){if(accountRuntime)siteApi=accountRuntime.apiFor(m);else{const voice=await voiceConfigurationFor(m);siteApi=createPrivateSiteApi({store,pkg,packages:m.packages,legacyBooks:m.legacyBooks,authenticate,now,voiceConfig:voice.config,voiceStatus:voice.status});}}
        return secure(await (await siteApi)(request),m.scriptHashes);
      }
      if(url.pathname==='/api/read2lead-story-session') {
        const runtime=m.content.runtime;
        return secure(await createStorySessionHandler({store,runtime,origin:url.origin,authenticate})(request),m.scriptHashes);
      }
      if(url.pathname==='/api/read2lead-story-turn')return reply(JSON.stringify({code:'story_voice_not_authorized',assessed:false,rewardsAwarded:false}),503,{'Content-Type':'application/json'});
      if(!['GET','HEAD'].includes(request.method))return reply('Method not allowed',405);
      let path,media;
      if(url.pathname.startsWith('/api/read2lead-story-media/')) {
        const key=url.pathname.slice('/api/read2lead-story-media/'.length);
        media=m.content.mediaFor(key);
        if(url.search||!media)return reply('Not found',404);
        if(accountRuntime?.authorizeMedia&&await accountRuntime.authorizeMedia(request,m,key)!==true)return reply('Not found',404);
        path='/__private/media/'+key;
      } else if(m.existingSite&&m.pages&&Object.hasOwn(m.pages,url.pathname)) {
        path=m.pages[url.pathname];
      } else if(url.pathname==='/read2lead/lesson/') {
        const query=url.searchParams,sessions=query.getAll('session');
        if(query.getAll('mission').length!==1||query.get('mission')!=='story-mission-v1'||
          [...query.keys()].some(key=>!['mission','session'].includes(key))||sessions.length>1||
          (sessions.length===1&&!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(sessions[0])))return reply('Not found',404);
        path='/read2lead/lesson/index.html';
      }
      else if((!url.search||/^\?v=[a-f0-9]{6,64}$/.test(url.search))&&m.publicAssets.includes(url.pathname))path=url.pathname;
      else return reply('Not found',404);
      let range=null;
      if(media&&request.headers.has('range')) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range'));
        if(!match||(!match[1]&&!match[2]))return reply('',416,{'Content-Range':`bytes */${media.bytes}`});
        const start=match[1]?Number(match[1]):Math.max(0,media.bytes-Number(match[2]));
        const end=match[1]?(match[2]?Math.min(Number(match[2]),media.bytes-1):media.bytes-1):media.bytes-1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=media.bytes||(!match[1]&&Number(match[2])===0))return reply('',416,{'Content-Range':`bytes */${media.bytes}`});
        range={start,end};
      }
      const asset=await assets.fetch(new Request('https://preview-assets.invalid'+path,{method:range?'GET':request.method}));
      if(asset.status>=300&&asset.status<400)return reply('Asset redirect refused',502);
      if(range&&asset.status===200) {
        const bytes=await asset.arrayBuffer();
        if(bytes.byteLength!==media.bytes)return reply('Media unavailable',503);
        return secure(new Response(request.method==='HEAD'?null:bytes.slice(range.start,range.end+1),{status:206,headers:{
          'Content-Type':media.mime,'Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),
          'Content-Range':`bytes ${range.start}-${range.end}/${media.bytes}`,
        }}),m.scriptHashes);
      }
      return secure(asset,m.scriptHashes);
    } catch {return reply('Private preview unavailable',503);}
  };
}

/** Cloudflare's synchronous cursor/transaction APIs match the tested store. */
export function durableSqlAdapter(storage) {
  return {db:{
    exec:sql=>{storage.sql.exec(sql).toArray();},
    prepare:sql=>({
      get:(...args)=>storage.sql.exec(sql,...args).toArray()[0],
      all:(...args)=>storage.sql.exec(sql,...args).toArray(),
      run:(...args)=>{storage.sql.exec(sql,...args).toArray();return {changes:storage.sql.exec('SELECT changes() AS n').one().n};},
    }),
  },transaction:fn=>storage.transactionSync(fn)};
}
