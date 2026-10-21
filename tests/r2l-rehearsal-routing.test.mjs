// R2L-MAINT-2: the release rehearsal must route EVERY request through the account gateway, as production's
// functions/_middleware.js does, and the synthetic manifest must advertise the candidate's own /story-retell pictures.
// Gateway-owned static assets (/story-retell/**) are served to a reader cookie only if (1) the gateway sees the
// request and (2) the host's public-asset manifest lists the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE = path.join(os.homedir(), 'work', 'r2l-releases', 'v110-20261021');
const WEBP = '/story-retell/sky/storyboard-v1.webp';
const PNG = '/story-retell/sky/storyboard-v1.png';
const NEW_LINE = 'const response=(await unifiedAccountGateway({request,env:{...env},data:{},waitUntil:p=>ctx.waitUntil(p)}))||await env.PAGES_ASSETS.fetch(request);';
const OLD_LINES = "const viaGateway=url.pathname.startsWith('/api/')||/^\\/(read2lead|ho-so)(\\/|$)/.test(url.pathname);\n" +
  " const response=(viaGateway?await unifiedAccountGateway({request,env:{...env},data:{},waitUntil:p=>ctx.waitUntil(p)}):null)||await env.PAGES_ASSETS.fetch(request);";

function skipReason() {
  if (!fs.existsSync(path.join(CANDIDATE, 'source'))) return `candidate ${CANDIDATE} absent`;
  if (!fs.existsSync(path.join(root, 'dist'))) return 'no dist/ build (run: PUBLIC_R2L_W1=1 npm run build)';
  return null;
}

// Starts rehearse.mjs --serve (from scriptsDir) and returns {url, stop}.
async function serve(scriptsDir, env = {}) {
  const proc = spawn('node', [path.join(scriptsDir, 'rehearse.mjs'), '--candidate', CANDIDATE, '--repo', root, '--serve'], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, ...env}});
  const info = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout.on('data', d => { buf += d; const m = /"url":\s*"([^"]+)"/.exec(buf); if (m && buf.includes('}')) resolve(JSON.parse(buf)); });
    proc.on('exit', c => reject(new Error('rehearse exited ' + c)));
    setTimeout(() => reject(new Error('rehearse did not start')), 60000);
  });
  return {url: info.url, stop: () => new Promise(r => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill('SIGTERM'); })};
}

async function probe(url, asset) {
  // Same way a child gets the cookie: open the home with the code (Set-Cookie __Host-r2l_account).
  const home = await fetch(url + '/read2lead?code=R2L-SYNTHETIC-PHONE');
  assert.equal(home.status, 200);
  const cookie = home.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('__Host-r2l_account='));
  assert.ok(cookie, 'home must issue the account cookie');
  const withCookie = await fetch(url + asset, {headers: {cookie}});
  const bytes = withCookie.status === 200 ? (await withCookie.arrayBuffer()).byteLength : 0;
  const without = await fetch(url + asset);
  return {withStatus: withCookie.status, type: withCookie.headers.get('content-type'), bytes, withoutStatus: without.status};
}

test('rehearsal serves /story-retell .webp and .png to a reader cookie, and not without it (mirrors production)', {timeout: 120000}, async t => {
  const why = skipReason(); if (why) return t.skip(why);
  const s = await serve(path.join(root, 'scripts', 'r2l-release'));
  try {
    const w = await probe(s.url, WEBP);
    assert.equal(w.withStatus, 200, 'with cookie: gateway must serve the webp storyboard');
    assert.equal(w.type, 'image/webp');
    assert.equal(w.bytes, 339848);
    assert.equal(w.withoutStatus, 404, 'without cookie: Pages dist has no such file, so 404 like production');
    const p = await probe(s.url, PNG);
    assert.equal(p.withStatus, 200);
    assert.equal(p.type, 'image/png');
    assert.equal(p.bytes, fs.statSync(path.join(CANDIDATE, 'assets', PNG)).size);
    assert.equal(p.withoutStatus, 404);
  } finally { await s.stop(); }
});

test('BITE 1: the old path allow-list routing makes the same assertion fail (404 with cookie)', {timeout: 120000}, async t => {
  const why = skipReason(); if (why) return t.skip(why);
  const src = fs.readFileSync(path.join(root, 'scripts', 'r2l-release', 'rehearse-worker.template.mjs'), 'utf8');
  assert.ok(src.includes(NEW_LINE), 'template must contain the all-requests gateway line (else this bite tests nothing)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2l-rehearse-old-'));
  fs.copyFileSync(path.join(root, 'scripts', 'r2l-release', 'rehearse.mjs'), path.join(dir, 'rehearse.mjs'));
  fs.writeFileSync(path.join(dir, 'rehearse-worker.template.mjs'), src.replace(NEW_LINE, OLD_LINES));
  const s = await serve(dir);
  try {
    assert.equal((await probe(s.url, WEBP)).withStatus, 404, 'old routing must NOT serve the asset to a cookie holder');
  } finally { await s.stop(); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('BITE 2: without the candidate story-asset manifest merge, the .webp is 404 even with the cookie', {timeout: 120000}, async t => {
  const why = skipReason(); if (why) return t.skip(why);
  const s = await serve(path.join(root, 'scripts', 'r2l-release'), {R2L_REHEARSAL_NO_CANDIDATE_STORY_ASSETS_FOR_BITE_TEST: '1'});
  try {
    const w = await probe(s.url, WEBP);
    assert.equal(w.withStatus, 404, 'v90 fixture manifest does not list the webp');
    assert.equal((await probe(s.url, PNG)).withStatus, 200, 'the png (listed by the fixture) still works, so only the merge is under test');
  } finally { await s.stop(); }
});
