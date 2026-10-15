import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const script = new URL('../scripts/read2lead-maintenance-banner.mjs', import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [script, ...args], {encoding:'utf8'});

test('normal release removes only the maintenance aside, recursively and idempotently', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2l-banner-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  await mkdir(join(dir,'read2lead'));
  const retained = '<aside id="parent-help">Keep help</aside><aside data-id="r2l-maintenance-notice">Keep data attribute</aside><main data-code="fixture">Saved work</main><script>const marker="r2l-maintenance-notice";</script>';
  const clean = '<html><body>'+retained+'</body></html>';
  await writeFile(join(dir,'read2lead/index.html'), '<html><body><aside role="region" id="r2l-maintenance-notice"><strong>Maintenance</strong></aside>'+retained+'</body></html>');
  await writeFile(join(dir,'index.html'), clean);
  await writeFile(join(dir,'data.json'), '{"unchanged":true}');
  let result = run(dir);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual({...JSON.parse(result.stdout),root:null}, {root:null,mode:'removed',scanned:2,changed:1,existing:0});
  assert.equal(await readFile(join(dir,'read2lead/index.html'),'utf8'),clean);
  assert.equal(await readFile(join(dir,'index.html'),'utf8'),clean);
  assert.equal(await readFile(join(dir,'data.json'),'utf8'),'{"unchanged":true}');
  result = run(dir);
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).changed,0);
});

test('explicit emergency enable is idempotent and a later normal invocation removes it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2l-banner-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const clean='<html><body><main>Reader</main></body></html>';
  await writeFile(join(dir,'index.html'),clean);
  assert.equal(run(dir,'--enable').status,0);
  assert.equal(run(dir,'--enable').status,0);
  assert.equal((await readFile(join(dir,'index.html'),'utf8')).match(/id="r2l-maintenance-notice"/g).length,1);
  assert.equal(run(dir).status,0);
  assert.equal(await readFile(join(dir,'index.html'),'utf8'),clean);
});

test('invalid options cannot enable or change the target', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2l-banner-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const html='<body>Unchanged</body>'; await writeFile(join(dir,'index.html'),html);
  assert.notEqual(run(dir,'--enabled').status,0);
  assert.equal(await readFile(join(dir,'index.html'),'utf8'),html);
});
