#!/usr/bin/env node
// Local Miniflare rehearsal of a Read2Lead Worker candidate. SYNTHETIC data, outbound network DISABLED.
// Never touches production: no Cloudflare calls, no real KV/D1/R2/AI, no real accounts.
//
//   node scripts/r2l-release/rehearse.mjs --candidate <dir from build_candidate.py> --repo <repo with dist/> [--serve] [--api-script <module>]
//
// Default: starts the synthetic Worker and runs a smoke check (entry, magic link, home, every _astro
// asset the home page loads is served byte-identical to the candidate), prints PASS/FAIL, exits.
// --serve: stays up and prints a local URL so pages can be screenshotted (Ctrl-C / SIGTERM to stop).
//          Synthetic child code: R2L-SYNTHETIC-PHONE, link /r2l/start/?t=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
//
// KNOWN DEPENDENCIES (not in this repo yet; paths overridable):
//   --fixture   Codex's synthetic fixture builder rehearsal-v90-fixture.mjs (it also needs its sibling
//               candidate-v90-inactive/ and sky-release-proof.json). Default points into ~/Documents/Codex/...
//   --miniflare / --esbuild   resolved from the repo's node_modules, then the npx cache. No new npm dependencies.
import fs from 'node:fs/promises';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };

const candidate = opt('candidate') && path.resolve(opt('candidate'));
const repo = opt('repo') && path.resolve(opt('repo'));
if (!candidate || !repo) fail('usage: rehearse.mjs --candidate <dir> --repo <repo root with dist/> [--serve] [--fixture <path>] [--api-script <module>]');
const sourceDir = path.join(candidate, 'source');
const candAssets = path.join(candidate, 'assets');
const pagesRoot = path.join(repo, 'dist') + path.sep;
for (const p of [path.join(sourceDir, 'cloudflare/read2lead-private-preview/worker.mjs'), candAssets, pagesRoot]) if (!existsSync(p)) fail('missing ' + p);

const CODEX = '/home/felixbuilderhub/Documents/Codex/2026-09-20/read-and-execute-the-implementation-goal/work/';
const fixturePath = path.resolve(opt('fixture', CODEX + 'existing-site-20260928/child-ui-r2/production-release-20261015/rehearsal-v90-fixture.mjs'));
if (!existsSync(fixturePath)) fail('fixture builder not found: ' + fixturePath + ' (known dependency, see header)');

function findModule(name, rel, explicit) {
  const tries = [];
  if (explicit) tries.push(path.resolve(explicit));
  tries.push(path.join(repo, 'node_modules', name, rel));
  const npx = path.join(os.homedir(), '.npm/_npx');
  if (existsSync(npx)) for (const d of readdirSync(npx)) tries.push(path.join(npx, d, 'node_modules', name, rel));
  tries.push(path.join('/home/felixbuilderhub/work/repos/felixbuilderhub/node_modules', name, rel));
  const hit = tries.find(existsSync);
  if (!hit) fail(`cannot find ${name}; pass --${name} <path to ${rel}>`);
  return hit;
}
const {build} = await import(pathToFileURL(findModule('esbuild', 'lib/main.js', opt('esbuild'))).href);
const {Miniflare, convertV4MiniflareOptions} = await import(pathToFileURL(findModule('miniflare', 'dist/src/index.js', opt('miniflare'))).href);
const {makeFixture, assetRoot: fixtureAssetRoot, origin, digest} = await import(pathToFileURL(fixturePath).href);

// Generate the worker entry from the template, pointing at THIS candidate's server source.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r2l-rehearse-'));
const template = (await fs.readFile(path.join(here, 'rehearse-worker.template.mjs'), 'utf8')).replaceAll('__SRC__', sourceDir);
const entry = path.join(tmpDir, 'rehearse-worker.mjs');
await fs.writeFile(entry, template);
const fixture = await makeFixture();
// The external synthetic fixture is frozen at the v90 manifest, so its publicAssets lists only the old story pictures.
// Advertise the CANDIDATE's own /story-retell/ pictures too (public art, not children's content), so the host can serve
// them the way production does; then re-serialise and re-hash so R2L_PREVIEW_PACKAGE_SHA256 still matches the served manifest.
// (plan.sha256 derives from account snapshots, not from this manifest.) The env var is a bite-test hook only.
if (!process.env.R2L_REHEARSAL_NO_CANDIDATE_STORY_ASSETS_FOR_BITE_TEST) {
  const own = JSON.parse(await fs.readFile(path.join(candAssets, '__private/package.json'), 'utf8'));
  const manifest = JSON.parse(fixture.text);
  const extra = (own.publicAssets || []).filter(a => typeof a === 'string' && a.startsWith('/story-retell/'));
  manifest.publicAssets = [...new Set([...(manifest.publicAssets || []), ...extra])];
  fixture.text = JSON.stringify(manifest);
  fixture.packageSha256 = digest(fixture.text);
}
const bundle = await build({entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], logLevel: 'silent'});

const mime = {'.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'};
async function serveFrom(root, pathname, ownRoot) {
  const name0 = path.resolve(root, '.' + pathname);
  const rootAbs = path.resolve(root);
  if (name0 !== rootAbs && !name0.startsWith(rootAbs + path.sep)) return new Response(null, {status: 404});
  try {
    let name = name0;
    if ((await fs.stat(name)).isDirectory()) name = path.join(name, 'index.html');
    return new Response(await fs.readFile(name), {headers: {'Content-Type': mime[path.extname(name)] || 'application/octet-stream'}});
  } catch { return new Response(null, {status: 404}); }
}
let outbound = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-10',
  durableObjects: {R2L_PREVIEW_STATE: {className: 'SyntheticReleaseState', useSQLite: true}, R2L_MAINTENANCE_STATE: {className: 'SyntheticReleaseState', useSQLite: true}},
  telemetry: {enabled: false},
  bindings: {SYNTHETIC_FIXTURE: JSON.stringify(fixture), R2L_PREVIEW_PACKAGE_SHA256: fixture.packageSha256, R2L_ACCOUNT_MODE: 'unified-v1', R2L_ACCOUNT_ROLLOUT_SHA256: fixture.plan.sha256, R2L_STUDENT_VOICE_CONFIG: JSON.stringify(fixture.voice)},
  serviceBindings: {
    // Pages side = the freshly built dist of the repo.
    PAGES_ASSETS: async request => serveFrom(pagesRoot, new URL(request.url).pathname),
    // Worker side = the CANDIDATE's own asset bundle. Private story content (__private/*) comes from the
    // synthetic fixture so no real children's content/media is read.
    ASSETS: async request => {
      const p = new URL(request.url).pathname;
      if (p === '/__private/package.json') return new Response(fixture.text, {headers: {'Content-Type': 'application/json'}});
      if (p.startsWith('/__private/')) return serveFrom(fixtureAssetRoot, p);
      return serveFrom(candAssets, p);
    },
  },
  outboundService: async () => { outbound++; return new Response('External network disabled', {status: 403}); },
}));
const fetcher = async (url, options = {}) => {
  const request = new Request(url, options);
  return mf.dispatchFetch(url, {method: request.method, headers: Object.fromEntries(request.headers), redirect: 'manual', body: ['GET', 'HEAD'].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer())});
};
async function shutdown(code) { await mf.dispose(); await fs.rm(tmpDir, {recursive: true, force: true}); process.exit(code); }

if (flag('serve')) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const headers = new Headers(req.headers);
      if (headers.has('origin')) { if (headers.get('origin') !== `http://127.0.0.1:${server.address().port}`) { res.writeHead(403).end(); return; } headers.set('origin', origin); }
      headers.delete('host');
      const r = await fetcher(origin + req.url, {method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)});
      const out = Object.fromEntries(r.headers);
      if (r.headers.getSetCookie().length) out['set-cookie'] = r.headers.getSetCookie();
      res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(500).end('Synthetic harness unavailable'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({url, pid: process.pid, warning: 'Synthetic local data only; not production', childCode: 'R2L-SYNTHETIC-PHONE', entryLink: url + '/r2l/start/?t=' + 'b'.repeat(32), bundleSha256: digest(bundle.outputFiles[0].contents)}, null, 2));
  process.on('SIGTERM', () => server.close(() => shutdown(0)));
  process.on('SIGINT', () => server.close(() => shutdown(0)));
} else {
  // ---- smoke check
  const problems = []; const check = (ok, msg) => { if (!ok) problems.push(msg); };
  let cookie = '';
  const call = async (route, init = {}) => {
    const r = await fetcher(origin + route, {...init, headers: {...(cookie ? {cookie} : {}), ...(init.headers || {})}});
    const jar = new Map(cookie.split('; ').filter(Boolean).map(v => [v.split('=')[0], v]));
    for (const v of r.headers.getSetCookie()) { const pair = v.split(';')[0]; jar.set(pair.split('=')[0], pair); }
    cookie = [...jar.values()].join('; ');
    return r;
  };
  const code = 'R2L-SYNTHETIC-PHONE';
  for (const p of ['/__private/package.json', '/api/admin/codes']) check((await call(p)).status === 404, p + ' must be 404');
  const entryPage = await call('/r2l/start/?t=' + 'b'.repeat(32)); check(entryPage.status === 200, 'entry page ' + entryPage.status);
  const link = await call('/api/r2l-link?token=' + 'b'.repeat(32)); check(link.status === 200 && (await link.json()).access_code === code, 'magic link did not resolve');
  const home = await call('/read2lead?code=' + code); check(home.status === 200, 'home ' + home.status);
  const html = await home.text();
  check(/data-synthetic-rehearsal/.test(html), 'home is not the synthetic rehearsal page');
  const files = [...new Set([...html.matchAll(/(?:src|href)="(\/_astro\/[^"?#]+)(?:[?#][^"]*)?"/g)].map(m => m[1]))];
  check(files.length > 0, 'home page references no /_astro assets (suspicious)');
  for (const f of files) {
    const r = await call(f);
    if (r.status !== 200) { problems.push(`${f} -> ${r.status} (would 404 for kids)`); continue; }
    const want = createHash('sha256').update(await fs.readFile(path.join(candAssets, f))).digest('hex');
    check(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex') === want, f + ' served bytes differ from candidate');
  }
  check((await call('/api/read2lead-progress?code=' + code, {headers: {'Sec-Fetch-Site': 'cross-site'}})).status === 403, 'cross-site progress read must be 403');
  if (opt('api-script')) {
    const mod = await import(pathToFileURL(path.resolve(opt('api-script'))).href);
    try { const proof = await mod.runRehearsal({fetcher: (u, o) => fetcher(u, o), origin, fixture}); console.log('api-script:', proof.status || 'done'); }
    catch (e) { problems.push('api-script failed: ' + e.message); }
  }
  check(outbound === 0, `${outbound} outbound network call(s) were attempted (all blocked)`);
  if (problems.length) { console.error('FAIL rehearsal:\n  - ' + problems.join('\n  - ')); await shutdown(1); }
  console.log(`PASS rehearsal: smoke ok, ${files.length} _astro assets byte-identical to candidate, outbound attempts=${outbound}`);
  await shutdown(0);
}
