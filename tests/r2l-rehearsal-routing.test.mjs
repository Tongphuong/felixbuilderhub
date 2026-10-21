// R2L-MAINT-2: the release rehearsal must route EVERY request through the account gateway, as production's
// functions/_middleware.js does. Gateway-owned static assets (/story-retell/**) are served to a reader cookie
// only if the gateway sees the request; a path allow-list in the rehearsal Worker hides that (it 404s from Pages).
//
// Asset used: /story-retell/sky/storyboard-v1.png. The rehearsal's synthetic fixture (Codex's rehearsal-v90-fixture.mjs,
// outside this repo) advertises only the PNG in its package manifest, so the candidate's .webp is not servable here
// (finding reported to Lead); the PNG exercises the identical gateway code path (same regex branch).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE = path.join(os.homedir(), 'work', 'r2l-releases', 'v110-20261021');
const ASSET = '/story-retell/sky/storyboard-v1.png';
const NEW_LINE = 'const response=(await unifiedAccountGateway({request,env:{...env},data:{},waitUntil:p=>ctx.waitUntil(p)}))||await env.PAGES_ASSETS.fetch(request);';
const OLD_LINES = "const viaGateway=url.pathname.startsWith('/api/')||/^\\/(read2lead|ho-so)(\\/|$)/.test(url.pathname);\n" +
  " const response=(viaGateway?await unifiedAccountGateway({request,env:{...env},data:{},waitUntil:p=>ctx.waitUntil(p)}):null)||await env.PAGES_ASSETS.fetch(request);";

function skipReason() {
  if (!fs.existsSync(path.join(CANDIDATE, 'source'))) return `candidate ${CANDIDATE} absent`;
  if (!fs.existsSync(path.join(root, 'dist'))) return 'no dist/ build (run: PUBLIC_R2L_W1=1 npm run build)';
  return null;
}

// Starts rehearse.mjs --serve (from scriptsDir) and returns {url, stop}.
async function serve(scriptsDir) {
  const proc = spawn('node', [path.join(scriptsDir, 'rehearse.mjs'), '--candidate', CANDIDATE, '--repo', root, '--serve'], {stdio: ['ignore', 'pipe', 'inherit']});
  const info = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout.on('data', d => { buf += d; const m = /"url":\s*"([^"]+)"/.exec(buf); if (m && buf.includes('}')) resolve(JSON.parse(buf)); });
    proc.on('exit', c => reject(new Error('rehearse exited ' + c)));
    setTimeout(() => reject(new Error('rehearse did not start')), 60000);
  });
  return {url: info.url, stop: () => new Promise(r => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill('SIGTERM'); })};
}

async function probe(url) {
  // Same way a child gets the cookie: open the home with the code (Set-Cookie __Host-r2l_account).
  const home = await fetch(url + '/read2lead?code=R2L-SYNTHETIC-PHONE');
  assert.equal(home.status, 200);
  const cookie = home.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('__Host-r2l_account='));
  assert.ok(cookie, 'home must issue the account cookie');
  const withCookie = await fetch(url + ASSET, {headers: {cookie}});
  const bytes = withCookie.status === 200 ? (await withCookie.arrayBuffer()).byteLength : 0;
  const without = await fetch(url + ASSET);
  return {withStatus: withCookie.status, type: withCookie.headers.get('content-type'), bytes, withoutStatus: without.status};
}

test('rehearsal serves /story-retell asset to a reader cookie, and not without it (mirrors production routing)', {timeout: 120000}, async t => {
  const why = skipReason(); if (why) return t.skip(why);
  const s = await serve(path.join(root, 'scripts', 'r2l-release'));
  try {
    const r = await probe(s.url);
    assert.equal(r.withStatus, 200, 'with cookie: gateway must serve the storyboard');
    assert.equal(r.type, 'image/png');
    assert.equal(r.bytes, fs.statSync(path.join(CANDIDATE, 'assets', ASSET)).size);
    assert.equal(r.withoutStatus, 404, 'without cookie: Pages dist has no such file, so 404 like production');
  } finally { await s.stop(); }
});

test('BITE: the old path allow-list routing makes the same assertion fail (404 with cookie)', {timeout: 120000}, async t => {
  const why = skipReason(); if (why) return t.skip(why);
  const src = fs.readFileSync(path.join(root, 'scripts', 'r2l-release', 'rehearse-worker.template.mjs'), 'utf8');
  assert.ok(src.includes(NEW_LINE), 'template must contain the all-requests gateway line (else this bite tests nothing)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2l-rehearse-old-'));
  fs.copyFileSync(path.join(root, 'scripts', 'r2l-release', 'rehearse.mjs'), path.join(dir, 'rehearse.mjs'));
  fs.writeFileSync(path.join(dir, 'rehearse-worker.template.mjs'), src.replace(NEW_LINE, OLD_LINES));
  const s = await serve(dir);
  try {
    const r = await probe(s.url);
    assert.equal(r.withStatus, 404, 'old routing must NOT serve the asset to a cookie holder');
  } finally { await s.stop(); fs.rmSync(dir, {recursive: true, force: true}); }
});
