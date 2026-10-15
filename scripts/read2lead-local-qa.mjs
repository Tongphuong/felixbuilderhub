/** Loopback preview host. Learners stay synthetic; approved publisher content requires its separate entry point. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFileSync, realpathSync, lstatSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SyntheticFamilyStore } from './lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from './lib/read2lead-self-learn-library.mjs';
import { SyntheticEditorStore } from './lib/read2lead-self-learn-editor.mjs';
import { SyntheticGiftStore } from './lib/read2lead-self-learn-gifts.mjs';
import { createGiftStaffHandlers } from '../functions/lib/read2lead/self-learn/gift-staff-handlers.mjs';
import { SyntheticGameStore } from './lib/read2lead-self-learn-game.mjs';
import { freeMonsterCatalogue } from '../functions/lib/read2lead/self-learn/game-policy.mjs';
import { publicGameCatalogue } from '../functions/lib/read2lead/self-learn/game-views.mjs';
import { canonical } from '../src/lib/read2lead/self-learn/session-contract.mjs';
import { createEditorHandlers } from '../functions/lib/read2lead/self-learn/editor-handlers.mjs';
import { SyntheticStore } from './lib/read2lead-self-learn-sqlite.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
import { composeLocalCatalogue } from '../functions/lib/read2lead/self-learn/catalogue.mjs';
import {createSyntheticPublisherRuntime,createPublishedSyntheticRuntime,createPublishedApprovedRuntime,createPrivateRehearsalRuntime} from './lib/read2lead-publisher-runtime.mjs';
import {createPrivateRehearsalAccess} from './lib/read2lead-private-rehearsal-access.mjs';
import {verifyPublisherAsset} from './lib/read2lead-publisher-import.mjs';
import {createPublisherEditor} from './lib/read2lead-publisher-editor.mjs';
import {PrivateStoryStore} from './lib/read2lead-story-store.mjs';
import {createStorySessionHandler} from '../functions/api/read2lead-story-session.js';
import {createStoryTurnHandler,storyVoiceEnabled} from '../functions/api/read2lead-story-turn.js';
const PAGE = '/read2lead/self-learn/', EDITOR_PAGE = '/read2lead/editor/', GIFT_STAFF_PAGE = '/read2lead/gifts-staff/';
const PREFIX = '/api/read2lead/self-learn/';
const GIFT_STAFF_PREFIX = '/api/read2lead/gifts-staff/';
const EDITOR_PREFIX = '/api/read2lead/editor/';
const GAME_ASSETS = new Map(Object.values(publicGameCatalogue(freeMonsterCatalogue()).parts).flat().filter(p=>p.asset_url).map(p=>[p.asset_url,decodeURIComponent(p.asset_url.slice(1))]));
const MIME = { '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const SECURITY = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()' };
function safeFile(root, relative) {
  const path = join(root, relative);
  if (realpathSync(path) !== path || !lstatSync(path).isFile()) throw Error('unsafe_static_target');
  return path;
}
/** Creating a target is separate and explicit. Existing directories are never adopted or emptied. */
export function initializeSyntheticTarget(root) {
  if (!isAbsolute(root) || resolve(root) !== root || existsSync(root)) throw Error('unsafe_new_target');
  const parent = resolve(root, '..');
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) throw Error('unsafe_new_target');
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function startLocalQA(options={}) { return startLocalHost(options,false); }
/** Read-only publisher preview with synthetic learners; no content editing or release action. */
export async function startApprovedPublisherPreview(options={}) {
  if(options.mode!=='approved-local'||!options.publisherStore||options.publisherPackages!=null)throw Error('approved_publisher_store_required');
  return startLocalHost({...options,mode:'synthetic-local'},true);
}
export async function startPrivateDraftPreview(options={}) {
  if(options.mode!=='private-rehearsal'||!options.publisherStore||options.publisherPackages!=null||!options.accessFile)throw Error('private_rehearsal_config_required');
  const gate=createPrivateRehearsalAccess({accessFile:options.accessFile,...(options.now?{now:options.now}:{}),...(options.ttlMs?{ttlMs:options.ttlMs}:{}),...(options.storyMissions===true?{landingPath:'/read2lead/lesson/?mission=story-mission-v1'}:{})});
  return startLocalHost({...options,mode:'synthetic-local'},false,{gate,targets:options.targets});
}
async function startLocalHost({ mode, dataRoot, distRoot, port = 8770, now, ttlMs, afterHandle, publisherPackages = null, publisherAssetRoot = null, publisherStore = null, storyVoice=null } = {},approvedPublisher=false,rehearsal=null) {
  if (mode !== 'synthetic-local' || !Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535)) || !isAbsolute(distRoot || '') || realpathSync(distRoot) !== distRoot || !lstatSync(distRoot).isDirectory()) throw Error('unsafe_server_config');
  safeFile(distRoot, 'read2lead/self-learn/index.html');
  if(rehearsal&&!readFileSync(safeFile(distRoot,'read2lead/self-learn/index.html'),'utf8').includes('BẢN QA CỤC BỘ · Chỉ dùng dữ liệu mẫu · Không có quà thật'))throw Error('private_rehearsal_banner_required');
  const access = JSON.parse(readFileSync(new URL('../tests/fixtures/read2lead-self-learn/access.json', import.meta.url), 'utf8'));
  const fixture = name => JSON.parse(readFileSync(new URL('../tests/fixtures/read2lead-self-learn/' + name, import.meta.url), 'utf8'));
  const source = await composeLocalCatalogue({ mode, base: fixture('level-lessons.json'), additional: fixture('library-lessons.json'), review: fixture('library-review.json') });
  let publisherRuntime = null;
  if(publisherStore!==null&&publisherPackages!==null)throw Error('ambiguous_publisher_source');
  if(rehearsal)publisherRuntime=await createPrivateRehearsalRuntime({mode:'private-rehearsal',db:publisherStore,assetRoot:publisherAssetRoot,targets:rehearsal.targets});
  else if(publisherStore!==null)publisherRuntime=await (approvedPublisher?createPublishedApprovedRuntime:createPublishedSyntheticRuntime)({mode:approvedPublisher?'approved-local':mode,db:publisherStore,assetRoot:publisherAssetRoot,verification:'worker',now:()=>new Date(now?now():Date.now()).toISOString()});
  if (publisherPackages !== null) {
    const packages = structuredClone(publisherPackages), proofs = new Map();
    if (!Array.isArray(packages) || !packages.length || packages.some(p => p?.lesson?.source?.kind !== 'synthetic_fixture')) throw Error('synthetic_publisher_only');
    for (const pkg of packages) for (const asset of pkg.assets || []) {
      const proof = verifyPublisherAsset(asset, publisherAssetRoot); proofs.set(JSON.stringify([proof.id,proof.sha256]),proof);
    }
    publisherRuntime = await createSyntheticPublisherRuntime({ mode, packages, assetProofs: [...proofs.values()], readAsset: key => readFileSync(safeFile(publisherAssetRoot,key)) });
    if (publisherRuntime.catalogue().some(l => source.lessons.some(old => old.id === l.id))) throw Error('publisher_legacy_id_conflict');
  }
  if(publisherRuntime&&source.lessons.some(l=>publisherRuntime.owns(l.id)))throw Error('publisher_legacy_id_conflict');
  const familySeed = fixture('family-access.json');
  if (familySeed?.format !== 1 || familySeed.purpose !== 'read2lead-local-synthetic-family' || !Array.isArray(familySeed.accounts)) throw Error('unsafe_family_seed');
  const libraryInterests = fixture('library-interests.json');
  const editorSeed = fixture('editor-access.json');
  if (editorSeed?.format !== 1 || editorSeed.purpose !== 'read2lead-local-synthetic-editor' || !Array.isArray(editorSeed.accounts) || !editorSeed.accounts.length) throw Error('unsafe_editor_seed');
  const store = new SyntheticStore({ root: dataRoot, editorContent: true, publisherRuntime });
  let origin, handlers, familyStore, libraryStore, editorStore, editorHandlers, gameStore, giftStore, giftStaffHandlers, storyStore, storyHandler, storyTurnHandler;
  // Only files referenced by the built reader are served. Private assets never
  // enter dist, and inline scripts get content hashes instead of unsafe-inline.
  let readerHtml = null, readerCsp = null;
  const readerAssets = new Map();
  if(rehearsal && existsSync(join(distRoot,'read2lead/lesson/index.html'))) {
    readerHtml = readFileSync(safeFile(distRoot,'read2lead/lesson/index.html'),'utf8');
    const hashes = [...readerHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(m=>! /\bsrc=/.test(m[1])).map(m=>"'sha256-"+createHash('sha256').update(m[2]).digest('base64')+"'");
    readerCsp = SECURITY['Content-Security-Policy'].replace("script-src 'self'", "script-src 'self' "+hashes.join(' '))
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace("media-src 'none'", "media-src 'self' blob:");
    for(const m of readerHtml.matchAll(/(?:src|href)="(\/(?:scripts|assets|fonts|read2lead)\/[a-zA-Z0-9_./-]+)(?:\?[^"<>]*)?"/g)) {
      if(!m[1].includes('..'))readerAssets.set(m[1],m[1].slice(1));
    }
    readerAssets.set('/assets/minny/minny_idle.png','assets/minny/minny_idle.png');
  }
  try {
    familyStore = new SyntheticFamilyStore({ mode, root: dataRoot });
    for (const account of familySeed.accounts) familyStore.seed({ active: true, role: 'staff', id: 'synthetic-local-qa' }, account, new Date(now ? now() : Date.now()).toISOString());
    libraryStore = await SyntheticLibraryStore.open({ mode, root: dataRoot, catalogue: source, interests: libraryInterests, editorContent: true, publisherRuntime });
    editorStore = new SyntheticEditorStore({ mode, root: dataRoot });
    for (const account of editorSeed.accounts) editorStore.seed({ active: true, role: 'staff', id: 'synthetic-local-qa' }, account, new Date(now ? now() : Date.now()).toISOString());
    const gameThemes = fixture('game-seasons.json'), gameLegacy = fixture('game-legacy.json');
    if (gameThemes?.format !== 1 || gameThemes.purpose !== 'read2lead-local-synthetic-game-themes' || gameLegacy?.format !== 1 || gameLegacy.purpose !== 'read2lead-local-synthetic-legacy-game') throw Error('unsafe_game_seed');
    gameStore = new SyntheticGameStore({ mode, root: dataRoot, themes: gameThemes.themes, interestIds: libraryInterests.groups.map(g => g.id) });
    // Seed new targets only; restored imports and their original receipts remain authoritative.
    const gameSeedPrincipal = { active: true, role: 'staff', id: 'synthetic-local-qa' };
    if (gameStore.legacySource(gameSeedPrincipal, gameLegacy.child_id) === null) gameStore.importLegacy(gameSeedPrincipal, { child_id: gameLegacy.child_id, request_id: 'synthetic-host-game-import-v1', snapshot: gameLegacy.snapshot, expected_sha256: createHash('sha256').update(canonical(gameLegacy.snapshot)).digest('hex') }, new Date(now ? now() : Date.now()).toISOString());
    giftStore = new SyntheticGiftStore({ mode, root: dataRoot });
    giftStore.initializeCatalogue({ active: true, role: 'staff', id: 'synthetic-local-qa' }, fixture('gift-catalogue.json'));
  } catch (error) { giftStore?.close(); gameStore?.close(); editorStore?.close(); libraryStore?.close(); familyStore?.close(); store.close(); await publisherRuntime?.close?.(); throw error; }
  const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    const send = (status, body, headers = {}) => {
      if (!res.destroyed) {
        const merged = new Headers(SECURITY); if (publisherRuntime) merged.set('Content-Security-Policy', SECURITY['Content-Security-Policy'].replace("media-src 'none'", "media-src 'self'")); for (const [name, value] of Object.entries(headers)) merged.set(name, value);
        // Early auth/media/size rejection can leave an unread request body. Do not
        // reuse that connection for another request with unconsumed stream data.
        if (!['GET', 'HEAD'].includes(req.method) && !req.readableEnded) merged.set('Connection', 'close');
        res.writeHead(status, Object.fromEntries(merged)); res.end(body);
      }
    };
    try {
      if (!handlers) { send(503, 'Starting'); return; }
      if (req.headers.host !== new URL(origin).host || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) { send(403, 'Origin refused'); return; }
      const raw = req.url || '/';
      if (!raw.startsWith('/') || raw.startsWith('//') || /\\|%2f|%5c|%2e|(?:^|\/)\.\.(?:\/|\?|$)/i.test(raw)) { send(400, 'Invalid path'); return; }
      const url = new URL(raw, origin);
      if(rehearsal&&await rehearsal.gate(req,url,send))return;
      if(rehearsal && ['/api/read2lead-story-session','/api/read2lead-story-turn'].includes(url.pathname)) {
        const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort();});
        const request = new Request(url, {method:req.method,headers:req.headers,signal:abort.signal,
          ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
        const response = await (url.pathname==='/api/read2lead-story-turn'?storyTurnHandler:storyHandler)(request);
        if(await rehearsal.gate(req,url,send))return;
        send(response.status,Buffer.from(await response.arrayBuffer()),Object.fromEntries(response.headers));return;
      }
      if(rehearsal && url.pathname.startsWith('/api/read2lead-story-media/')) {
        if(!['GET','HEAD'].includes(req.method)||url.search){send(400,'Invalid media request');return;}
        const response = await publisherRuntime.media(url.pathname.slice('/api/read2lead-story-media/'.length),{range:req.headers.range||null,head:req.method==='HEAD'});
        if(await rehearsal.gate(req,url,send))return;
        send(response.status,Buffer.from(await response.arrayBuffer()),Object.fromEntries(response.headers));return;
      }
      if((approvedPublisher||rehearsal)&&(url.pathname===EDITOR_PAGE||url.pathname===EDITOR_PAGE.slice(0,-1)||url.pathname.startsWith(EDITOR_PREFIX))){send(404,'Not found');return;}
      if (url.pathname.startsWith(PREFIX) || url.pathname.startsWith(EDITOR_PREFIX) || url.pathname.startsWith(GIFT_STAFF_PREFIX)) {
        if(url.pathname.startsWith(PREFIX)){
          try{await publisherRuntime?.refresh?.();if(publisherRuntime&&source.lessons.some(l=>publisherRuntime.owns(l.id)))throw Error('publisher_legacy_id_conflict');}
          catch{send(409,JSON.stringify({ok:false,code:'content_unavailable'}),{'Content-Type':'application/json; charset=utf-8'});return;}
        }
        const abort = new AbortController(); req.on('aborted', () => abort.abort());
        const request = new Request(url, { method: req.method, headers: req.headers, signal: abort.signal,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
        const response = await (url.pathname.startsWith(GIFT_STAFF_PREFIX) ? giftStaffHandlers : url.pathname.startsWith(EDITOR_PREFIX) ? editorHandlers : handlers).handle(request);
        // Trusted test harness only: no request-controlled fault switches or special HTTP endpoint.
        if (afterHandle && await afterHandle({ request, response: response.clone() }) === 'drop') { req.socket.destroy(); return; }
        const responseBody=Buffer.from(await response.arrayBuffer());
        if(rehearsal&&await rehearsal.gate(req,url,send))return;
        send(response.status, responseBody, Object.fromEntries(response.headers)); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { send(405, 'Method not allowed', { Allow: 'GET, HEAD' }); return; }
      if(rehearsal && readerHtml && url.pathname === '/read2lead/lesson/') {
        send(200,req.method==='HEAD'?'':readerHtml,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':readerCsp});return;
      }
      if (url.pathname === GIFT_STAFF_PAGE.slice(0, -1)) { send(302, '', { Location: GIFT_STAFF_PAGE }); return; }
      if (url.pathname === EDITOR_PAGE.slice(0, -1)) { send(302, '', { Location: EDITOR_PAGE }); return; }
      if (url.pathname === '/' || url.pathname === PAGE.slice(0, -1)) { send(302, '', { Location: PAGE }); return; }
      const relative = url.pathname === PAGE ? 'read2lead/self-learn/index.html' : url.pathname === EDITOR_PAGE ? 'read2lead/editor/index.html' : url.pathname === GIFT_STAFF_PAGE ? 'read2lead/gifts-staff/index.html' :
        /^\/_astro\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?)$/.test(url.pathname) ? url.pathname.slice(1) : rehearsal && readerAssets.has(url.pathname) ? readerAssets.get(url.pathname) : !url.search && GAME_ASSETS.has(url.pathname) ? GAME_ASSETS.get(url.pathname) : null;
      if (!relative) { send(404, 'Not found'); return; }
      const path = safeFile(distRoot, relative);
      let body=req.method==='HEAD'?'':readFileSync(path);
      if(rehearsal&&url.pathname===PAGE&&req.method!=='HEAD')body=body.toString().replace('BẢN QA CỤC BỘ · Chỉ dùng dữ liệu mẫu · Không có quà thật','PRIVATE REHEARSAL · Unapproved story draft · Test progress only');
      send(200, body, { 'Content-Type': MIME[extname(path)] });
    } catch { send(404, 'Not found'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    origin = 'http://127.0.0.1:' + server.address().port;
    if(rehearsal) {
      storyStore = new PrivateStoryStore(dataRoot);
      const authenticate=request=>rehearsal.gate.principal({headers:{cookie:request.headers.get('cookie')||''}});
      storyHandler = createStorySessionHandler({store:storyStore,runtime:publisherRuntime,origin,
        authenticate,voiceEnabled:()=>storyVoiceEnabled(storyVoice)});
      storyTurnHandler=createStoryTurnHandler({store:storyStore,runtime:publisherRuntime,origin,authenticate,voiceConfig:storyVoice});
    }
    handlers = createLocalHandlers({ mode, origin, store, publisherRuntime, familyStore, libraryStore, libraryInterests, gameStore, giftStore, access, lessons: source.lessons, ...(now ? { now } : {}), ...(ttlMs ? { ttlMs } : {}) });
    giftStaffHandlers = createGiftStaffHandlers({ mode, origin, store: giftStore, editorStore, access: fixture('gift-staff-access.json'), ...(now ? { now } : {}) });
    editorHandlers = createEditorHandlers({ mode, origin, store: editorStore, ...(publisherStore&&!approvedPublisher&&!rehearsal?{publisher:createPublisherEditor({mode,db:publisherStore,assetRoot:publisherAssetRoot})}:{}), templates: source.lessons, ...(now ? { now } : {}) });
  } catch (error) { server.close(); storyStore?.close(); giftStore.close(); gameStore.close(); editorStore.close(); libraryStore.close(); familyStore.close(); store.close(); await publisherRuntime?.close?.(); throw error; }
  let closed = false;
  return { origin, url: origin + PAGE, contentEnvironment:rehearsal?'private-rehearsal':approvedPublisher?'approved-local':'synthetic', learnerEnvironment:'synthetic', diagnostics: () => handlers.diagnostics(),
    async close() { if (closed) return; closed = true; await new Promise(done => { server.close(done); server.closeAllConnections(); }); storyStore?.close(); giftStore.close(); gameStore.close(); editorStore.close(); libraryStore.close(); familyStore.close(); store.close(); await publisherRuntime?.close?.(); } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), options = {};
    while (args.length) {
      const key = args.shift();
      if (key === '--init-synthetic') { if (options.init) throw Error('duplicate_option'); options.init = true; continue; }
      if (!['--data-root', '--dist-root', '--port'].includes(key) || options[key] !== undefined || !args.length) throw Error('invalid_arguments');
      options[key] = args.shift();
    }
    if (!options['--data-root'] || !options['--dist-root']) throw Error('required: --data-root ABS_PATH --dist-root ABS_PATH [--init-synthetic] [--port 8770]');
    if (options.init) initializeSyntheticTarget(options['--data-root']);
    const qa = await startLocalQA({ mode: 'synthetic-local', dataRoot: options['--data-root'], distRoot: options['--dist-root'], port: options['--port'] === undefined ? 8770 : Number(options['--port']) });
    console.log(JSON.stringify({ status: 'ready', environment: 'synthetic', url: qa.url, providers: 'disabled' }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await qa.close(); process.exit(0); });
  } catch (e) { console.error('Local QA refused:', e.message); process.exitCode = 1; }
}
