import { createPreviewApp, createPreviewContentLoader } from './app.mjs';
import { createRead2LeadAccountService } from '../../functions/lib/read2lead/account-service.mjs';
import { StorySqlStore } from '../../functions/lib/read2lead/story-store.mjs';
import { isStoryPack, loadAssignedStory } from '../../functions/lib/read2lead/story-catalogue.mjs';
import { resolveAccessiblePack } from '../../functions/api/_read2lead-pack-access.js';
import { storyVoiceEnabled } from '../../functions/api/read2lead-story-turn.js';

export const ACCOUNT_COOKIE = '__Host-r2l_account';
const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const pinPattern = /^[a-f0-9]{64}$/;
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2,'0')).join('');
const reply = (code, status) => Response.json({code}, {status, headers:{'Cache-Control':'private, no-store'}});
const machinePaths = new Set(['/api/task-state', '/api/publish-read2lead-book', '/api/debug-speaking', '/api/debug-convo-flags']);

// Identity is never inferred from a media cookie for API calls. Original
// handlers retain code, admin, backend-secret and signup verification checks.
async function explicitIdentity(request) {
  const url = new URL(request.url), values = [...url.searchParams.getAll('code'), ...url.searchParams.getAll('access_code')];
  const header = request.headers.get('X-Read2Lead-Code');
  if (header !== null) values.push(header);
  const match = /^\/api\/admin\/codes\/([^/]+)(?:\/|$)/.exec(url.pathname);
  // Literal global operations are not learner codes.
  if (match && !['reset-levels','clear-open-lessons','apply-bot-presets'].includes(match[1])) {
    try { values.push(decodeURIComponent(match[1])); } catch { return false; }
  }
  if (!['GET','HEAD'].includes(request.method)) {
    try {
      const type = request.headers.get('content-type')?.split(';')[0];
      if (type === 'application/json') {
        const body = await request.clone().json();
        for (const key of ['code','access_code']) if (body && Object.hasOwn(body,key)) values.push(body[key]);
      } else if (['multipart/form-data','application/x-www-form-urlencoded'].includes(type)) {
        const body = await request.clone().formData();
        for (const key of ['code','access_code']) values.push(...body.getAll(key));
      }
    } catch { return false; }
  }
  if (!values.length) return null;
  if (values.some(value => typeof value !== 'string' || !codePattern.test(value.trim().toUpperCase()))) return false;
  const codes = values.map(value => value.trim().toUpperCase());
  return codes.every(value => value === codes[0]) ? codes[0] : false;
}

/** Opt-in integration building block. No import, migration, freeze or provider
 * grant occurs here. The trusted caller must complete the frozen rollout and
 * supply its independently pinned receipt. No public HTTP migration endpoint.
 * ordinaryStory must carry a separately approved catalogue and bounded voice
 * policy. The founder's private catalogue/grant never becomes the default.
 */
export function createUnifiedAccountApp({db,transaction,assets,packageSha256,expectedRolloutSha256,progressInCodes,
  origin,founderCode,founderVoiceConfig=null,ordinaryStory=null,infrastructure={},legacySpeechCache,scheduleBackground,onError,contentLoader,now=()=>Date.now()}) {
  if (!pinPattern.test(packageSha256 || '') || !pinPattern.test(expectedRolloutSha256 || '') ||
      typeof progressInCodes !== 'boolean' || !codePattern.test(founderCode || '') ||
      new URL(origin).origin !== origin || !origin.startsWith('https://')) throw Error('unified_account_config_required');
  if (ordinaryStory !== null && (typeof ordinaryStory.catalogue?.get !== 'function' ||
      typeof ordinaryStory.canAssign !== 'function' || (founderVoiceConfig && (ordinaryStory.voiceConfig === founderVoiceConfig ||
        (ordinaryStory.voiceConfig?.budget && ordinaryStory.voiceConfig.budget === founderVoiceConfig.budget))) ||
      ordinaryStory.voiceConfig?.practiceTrial === true)) throw Error('ordinary_story_policy_required');

  const bundle=createPreviewContentLoader({assets,packageSha256,existing:contentLoader});
  let loaded, browserApp, ordinaryApi, ordinarySelectionApi, founderApi;
  function ready() {
    const receipt = db.prepare('SELECT * FROM read2lead_account_rollout WHERE id=1').get();
    const revision = db.prepare('SELECT revision FROM read2lead_account_revision WHERE id=1').get()?.revision;
    if (!receipt || receipt.plan_sha256 !== expectedRolloutSha256 || receipt.progress_in_codes !== Number(progressInCodes) || !Number.isSafeInteger(receipt.revision) || receipt.revision < 2 ||
        !Number.isSafeInteger(revision) || revision < receipt.revision) throw Error('account_rollout_not_ready');
  }
  function account(code) {
    if (!codePattern.test(code || '')) return null;
    const row = db.prepare("SELECT value,expires FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(code);
    if (!row || (row.expires !== null && row.expires <= now())) return null;
    const value = JSON.parse(row.value);
    return value?.student_profile && typeof value.student_profile === 'object' ? value : null;
  }
  const founder = code => code === founderCode && account(code)?.is_test === true && account(code)?.is_shared === false;
  async function browserAccess(request) {
    const raw = request.headers.get('cookie') || '';
    if (raw.length > 8192) return null;
    const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(ACCOUNT_COOKIE+'='));
    if (values.length !== 1) return null;
    const value = values[0].slice(ACCOUNT_COOKIE.length+1);
    if (!pinPattern.test(value)) return null;
    const row = db.prepare('SELECT code,origin,expires FROM unified_account_browser_access WHERE token=?').get(await hash(value));
    return row && row.origin === origin && row.expires > now() && account(row.code) ? {...row,token:value} : null;
  }
  const cookieOwner = async request => (await browserAccess(request))?.code ?? null;
  async function withBrowserAccess(request,response,identity) {
    const url=new URL(request.url),api=url.pathname.startsWith('/api/');
    if (!response.ok || !identity || !account(identity) || (!api && request.method !== 'GET') ||
        url.pathname.startsWith('/api/admin') || machinePaths.has(url.pathname)) return response;
    const access=await browserAccess(request);
    // A stale tab must not replace another learner's current media identity.
    // A deliberate code-bearing page entry may switch it; API activity may not.
    if (api && (!access || access.code !== identity)) return response;
    if (access?.code === identity && access.expires > now()+300000) return response;
    const token = access?.code === identity ? access.token : Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const tokenHash = await hash(token);
    transaction(() => {
      db.prepare('DELETE FROM unified_account_browser_access WHERE expires<=?').run(now());
      const existing=db.prepare('SELECT code,origin FROM unified_account_browser_access WHERE token=?').get(tokenHash);
      if (existing && (existing.code !== identity || existing.origin !== origin)) throw Error('account_browser_changed');
      if (!existing && db.prepare('SELECT COUNT(*) AS n FROM unified_account_browser_access WHERE code=?').get(identity).n >= 32) throw Error('account_browser_limit');
      db.prepare('INSERT INTO unified_account_browser_access VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET expires=excluded.expires').run(tokenHash,identity,origin,now()+900000);
    });
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie',`${ACCOUNT_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`);
    return new Response(response.body,{status:response.status,headers});
  }
  async function authenticate(request) {
    const code = await explicitIdentity(request);
    if (code === false) return null;
    return code ? (account(code) ? code : null) : cookieOwner(request);
  }
  function crossSiteEntry(request) {
    const url = new URL(request.url);
    return request.method === 'GET' && ['/read2lead','/read2lead/'].includes(url.pathname) &&
      request.headers.get('sec-fetch-mode') === 'navigate' && request.headers.get('sec-fetch-dest') === 'document' &&
      (url.searchParams.has('code') || url.searchParams.has('access_code'));
  }
  async function initialize() {
    ready();
    if (!loaded) loaded = (async () => {
      const manifest=await bundle.load();
      if(manifest.existingSite!==true)throw Error('account_content_invalid');
      const content=manifest.content;
      const ordinaryCatalogue = {async get(key, options) {
        if (!ordinaryStory) return key.startsWith('index:') ? [] : null;
        const record = await ordinaryStory.catalogue.get(key, options);
        if (key.startsWith('index:')) return record;
        return record?.status === 'accepted' ? record : null;
      }};
      const selectionCatalogue = {async get(key, options) {
        if (key.startsWith('index:') && !storyVoiceEnabled(ordinaryStory?.voiceConfig)) return [];
        const record = await ordinaryCatalogue.get(key,options);
        // Check only the package being considered by the existing bounded
        // selector. Saved package reads remain possible after budget expiry.
        if (record?.package && await ordinaryStory.canAssign({id:record.package.lesson.id,version:record.package.lesson.version}) !== true) return null;
        return record;
      }};
      const base = {...infrastructure};
      // Explicit capability construction prevents accidental inherited QA,
      // maintenance routing recursion or a legacy account-storage fallback.
      for (const key of ['R2L_PRIVATE_QA','R2L_TEST_ACCOUNT_CODE','R2L_MAINTENANCE_STATE','R2L_ACCOUNT_MODE','R2L_CONTENT_SOURCE','R2L_STORY_CATALOGUE']) delete base[key];
      const normalEnv = {...base,R2L_CONTENT_SOURCE:'combined',R2L_STORY_CATALOGUE:ordinaryCatalogue};
      const founderEnv = {...base,R2L_CONTENT_SOURCE:content.contentSource,R2L_PRIVATE_QA:'adult-isolated',R2L_STORY_CATALOGUE:{get:async key=>content.storyValue(key)}};
      const service = (environment,voiceConfig) => createRead2LeadAccountService({db,transaction,now,progressInCodes,
        infrastructure:environment,story:{origin,voiceConfig},legacySpeechCache,scheduleBackground});
      ordinaryApi = service(normalEnv,ordinaryStory?.voiceConfig ?? null);
      ordinarySelectionApi = service({...normalEnv,R2L_STORY_CATALOGUE:selectionCatalogue},ordinaryStory?.voiceConfig ?? null);
      founderApi = service(founderEnv,founderVoiceConfig);
      db.exec('CREATE TABLE IF NOT EXISTS unified_account_browser_access (token TEXT PRIMARY KEY, code TEXT NOT NULL, origin TEXT NOT NULL, expires INTEGER NOT NULL)');
      browserApp = createPreviewApp({store:new StorySqlStore(db,{transaction,now}),assets,packageSha256,now,contentLoader:bundle,accountRuntime:{
        authenticate,allowsCrossSiteNavigation:crossSiteEntry,apiFor:()=>ordinaryApi,
        async authorizeMedia(request,_manifest,key) {
          const code = await authenticate(request), owner = account(code);
          if (!owner) return false;
          const env = founder(code) ? founderEnv : normalEnv;
          const packs = [owner.progress?.current_pack,...Object.values(owner.story_pack_history || {})]
            .filter(pack => isStoryPack(pack) && resolveAccessiblePack(owner,pack.pack_id) === pack);
          for (const pack of packs) {
            if (!pinPattern.test(pack.story_reference?.sha256 || '')) continue;
            const before = JSON.stringify(pack);
            try {
              const loaded = await loadAssignedStory(env,owner,pack.story_reference,{now:new Date(now()).toISOString()});
              if (loaded.pkg.lesson.source.source_id !== pack.story_reference.source_id) continue;
              if (!loaded.pkg.assets.some(asset => asset.object_key === key)) continue;
              const current = account(code), fresh = current && resolveAccessiblePack(current,pack.pack_id);
              if (JSON.stringify(fresh) === before && (!loaded.privateDraft || founder(code))) return true;
            } catch { /* A changed, revoked or unaccepted assignment grants no media. */ }
          }
          return false;
        },
      }});
    })().catch(error => {loaded=null;throw error;});
    await loaded;
  }
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin || (request.headers.get('sec-fetch-site') === 'cross-site' && !crossSiteEntry(request))) return reply('origin_refused',403);
      if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== origin && !machinePaths.has(url.pathname)) return reply('origin_refused',403);
      if (request.headers.has('origin') && request.headers.get('origin') !== origin) return reply('origin_refused',403);
      await initialize();
      const identity = await explicitIdentity(request);
      if (identity === false) return reply('conflicting_account_identity',400);
      if (url.pathname === '/api/r2l-link') {
        const tokens = url.searchParams.getAll('token');
        if (tokens.length !== 1) return reply('invalid_token',400);
        if (identity) {
          const row = db.prepare("SELECT value FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get('r2l_link:'+tokens[0]);
          if (!row || JSON.parse(row.value)?.access_code !== identity) return reply('conflicting_account_identity',400);
        }
      }
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/read2lead-story-media/') &&
          url.pathname !== '/api/read2lead-library' && !url.pathname.startsWith('/api/read2lead-library-media/')) {
        const response=await (founder(identity) ? founderApi : url.pathname === '/api/generate-read2lead-pack' ? ordinarySelectionApi : ordinaryApi)(request);
        return await withBrowserAccess(request,response,identity);
      }
      const response = await browserApp(request);
      return await withBrowserAccess(request,response,identity);
    } catch (error) {
      // Trusted diagnostics never change or expose the public failure response.
      try { onError?.(error); } catch { /* Diagnostics must not break fail-closed handling. */ }
      return reply('account_host_unavailable',503);
    }
  };
}
