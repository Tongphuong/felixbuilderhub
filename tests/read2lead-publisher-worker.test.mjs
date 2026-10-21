import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {openPublisherStore,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue,planPublisherCatalogue,applyPublisherCatalogue,publisherCatalogueState} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {createPublishedSyntheticRuntime} from '../scripts/lib/read2lead-publisher-runtime.mjs';
import {createPublisherWorkerLoader} from '../scripts/lib/read2lead-publisher-worker.mjs';
import {startLocalQA,initializeSyntheticTarget} from '../scripts/read2lead-local-qa.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-worker-')),filename=path.join(root,'publisher.sqlite'),assets=fixtureAssets(root),db=openPublisherStore(filename,{create:true});initializePublisherCatalogue(db);const pkg=await fixturePackage(assets);await seedFixturePackages(db,[pkg]);
 const options={assetRoot:root,now:fixtureNow},publish=async p=>applyPublisherCatalogue(db,await planPublisherCatalogue(db,{targets:[{source_id:p.lesson.source.source_id,version:p.lesson.version}],operator:'Synthetic worker test',reason:'Synthetic test only'},options),options);await publish(pkg);
 // The fake ffprobe holds the worker inside its decode so a test can act "during worker loading". Default: it holds for a FIXED 0.5 s once armed (a clock).
// A test that must act at a precise point in that window cannot trust a clock under load (a busy machine can delay the main thread by more than 0.5 s,
// and the worker then finishes first): such a test calls s.gate() before s.arm(), and the stub then holds until s.release() creates the `release` file
// (an event, not a delay). The hold is capped at 30 s so a test that dies before releasing cannot leave a stub spinning for ever.
 const bin=path.join(root,'bin'),armed=path.join(root,'armed'),entered=path.join(root,'entered'),gated=path.join(root,'gated'),released=path.join(root,'release');fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'ffprobe'),`#!/bin/sh\nif test -e '${armed}'; then\n test -e '${entered}' || printf entered > '${entered}'\n if test -e '${gated}'; then\n  n=0\n  while ! test -e '${released}' && test $n -lt 3000; do n=$((n+1)); sleep 0.01; done\n else\n  sleep 0.5\n fi\nfi\nexec /usr/bin/ffprobe "$@"\n`,{mode:0o700});const oldPath=process.env.PATH;process.env.PATH=bin+path.delimiter+oldPath;
 t.after(()=>{process.env.PATH=oldPath;db.close();fs.rmSync(root,{recursive:true,force:true});});
 return{root,filename,assets,db,pkg,publish,arm:()=>fs.writeFileSync(armed,''),gate:()=>fs.writeFileSync(gated,''),release:()=>fs.writeFileSync(released,''),entered,options};
}
async function waitEntered(s){const start=Date.now();while(!fs.existsSync(s.entered)){assert.ok(Date.now()-start<5000,'worker decoder did not start');await sleep(5);}return Date.now()-fs.statSync(s.entered).mtimeMs;}
test('actual HTTP remains responsive while a changed catalogue decodes in its read-only worker',async t=>{
 const s=await setup(t),dataRoot=path.join(s.root,'learner'),distRoot=path.join(s.root,'dist');initializeSyntheticTarget(dataRoot);fs.mkdirSync(path.join(distRoot,'read2lead/self-learn'),{recursive:true});fs.writeFileSync(path.join(distRoot,'read2lead/self-learn/index.html'),'<html>Synthetic worker responsiveness</html>');const qa=await startLocalQA({mode:'synthetic-local',dataRoot,distRoot,port:0,publisherStore:s.db,publisherAssetRoot:s.root,now:()=>Date.parse(fixtureNow)});
 try{
  const next=await fixturePackage(s.assets.map(a=>({...a,alt_en:a.alt_en+' revised'})),{revision:2});await seedFixturePackages(s.db,[next]);await s.publish(next);s.arm();let finished=false;const pending=fetch(qa.origin+'/api/read2lead/self-learn/lessons').then(r=>{finished=true;return r;});
  pending.catch(()=>{});const age=await waitEntered(s);assert.ok(age<250,'main request thread was blocked by decoder');const page=await fetch(qa.url);assert.equal(page.status,200);assert.match(await page.text(),/Synthetic worker responsiveness/);assert.equal(finished,false,'static response must finish while verification is still running');assert.equal((await pending).status,401);t.diagnostic('WORKER_RESPONSIVENESS '+JSON.stringify({decoder_marker_observed_after_ms:Math.round(age),static_served_before_decode_finished:true}));
 }finally{await qa.close();}
});
test('a withdrawal during worker loading cannot publish the stale result',async t=>{
 // Gated (event, not a 0.5 s clock): the worker is held inside its decode until the withdrawal has been committed, however slow this machine is.
 const s=await setup(t);s.gate();s.arm();const pending=createPublishedSyntheticRuntime({mode:'synthetic-local',db:s.db,assetRoot:s.root,verification:'worker',now:()=>fixtureNow});const rejected=assert.rejects(pending,/stale_catalogue_snapshot|content_unavailable/);
 try{await waitEntered(s);withdrawPublisherVersion(s.db,{source_id:s.pkg.lesson.source.source_id,version:s.pkg.lesson.version,reason:'Synthetic concurrent withdrawal',now:fixtureNow});}finally{s.release();}await rejected;
});
test('main-connection uncommitted state cannot be replaced by a worker committed snapshot',async t=>{
 const s=await setup(t),runtime=await createPublishedSyntheticRuntime({mode:'synthetic-local',db:s.db,assetRoot:s.root,verification:'worker',now:()=>fixtureNow});
 try{s.db.exec('BEGIN');s.db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('synthetic_uncommitted','{}');await assert.rejects(runtime.refresh(),/content_unavailable/);assert.throws(()=>runtime.catalogue(),/content_unavailable/);s.db.exec('ROLLBACK');await runtime.refresh();assert.equal(runtime.catalogue().length,1);}finally{await runtime.close();}
 assert.throws(()=>runtime.catalogue(),/content_unavailable/);await assert.rejects(runtime.refresh(),/content_unavailable/);
});
test('worker timeout and explicit close reject pending work and cannot accept late results',async t=>{
 const s=await setup(t),timed=createPublisherWorkerLoader({mode:'synthetic-local',filename:s.filename,assetRoot:s.root,timeoutMs:1});await assert.rejects(timed.load({now:fixtureNow}),/publisher_worker_timeout/);await timed.close();await assert.rejects(timed.load({now:fixtureNow}),/publisher_worker_closed/);
 const stopped=createPublisherWorkerLoader({mode:'synthetic-local',filename:s.filename,assetRoot:s.root});const pending=stopped.load({now:fixtureNow}),rejected=assert.rejects(pending,/publisher_worker_closed/);await stopped.close();await rejected;await assert.rejects(stopped.load({now:fixtureNow}),/publisher_worker_closed/);
});
test('worker reports corrupt catalogue without writing to its database and later accepts a repaired snapshot',async t=>{
 const s=await setup(t),row=s.db.prepare('SELECT id,manifest_json FROM publisher_catalogues').get(),loader=createPublisherWorkerLoader({mode:'synthetic-local',filename:s.filename,assetRoot:s.root});
 try{s.db.prepare('UPDATE publisher_catalogues SET manifest_json=? WHERE id=?').run('{}',row.id);const state=publisherCatalogueState(s.db);await assert.rejects(loader.load({now:fixtureNow}),/publisher_catalogue_integrity/);assert.equal(publisherCatalogueState(s.db),state);s.db.prepare('UPDATE publisher_catalogues SET manifest_json=? WHERE id=?').run(row.manifest_json,row.id);assert.equal((await loader.load({now:fixtureNow})).packages.length,1);}finally{await loader.close();}
});
