import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createPublisherAsyncAssetVerifier,openPublisherStore} from '../scripts/lib/read2lead-publisher-import.mjs';
import {createPublisherWorkerLoader} from '../scripts/lib/read2lead-publisher-worker.mjs';
import {initializePublisherCatalogue,planPublisherCatalogue,applyPublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-async-assets-')),assets=fixtureAssets(root),bin=path.join(root,'bin'),events=path.join(root,'events');fs.mkdirSync(bin);
 const oldPath=process.env.PATH;t.after(()=>{process.env.PATH=oldPath;fs.rmSync(root,{recursive:true,force:true});});
 const wrap=(name,seconds=0)=>{fs.writeFileSync(path.join(bin,name),`#!/usr/bin/python3\nimport os,time,json\np=${JSON.stringify(events)}\ndef event(phase):\n with open(p,'a') as f:f.write(json.dumps({'phase':phase,'pid':os.getpid(),'tool':${JSON.stringify(name)}})+'\\n')\nevent('start')\ntime.sleep(${seconds})\nevent('exec')\nos.execv('/usr/bin/${name}',['${name}']+__import__('sys').argv[1:])\n`,{mode:0o700});process.env.PATH=bin+path.delimiter+oldPath;};
 return{root,assets,bin,events,wrap,read:()=>fs.existsSync(events)?fs.readFileSync(events,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[]};
}
async function entered(s){const deadline=Date.now()+5000;while(!s.read().some(e=>e.phase==='start')){assert.ok(Date.now()<deadline,'decoder did not enter');await sleep(5);}return s.read().filter(e=>e.phase==='start').map(e=>e.pid);}
function gone(pid){try{process.kill(pid,0);return false;}catch(error){assert.equal(error.code,'ESRCH');return true;}}
test('bounded asynchronous verification overlaps real decoder jobs without exceeding its limit',async t=>{
 const s=setup(t);s.wrap('ffprobe',0.1);s.wrap('ffmpeg',0.1);const verify=createPublisherAsyncAssetVerifier(s.root,{concurrency:2});t.after(()=>verify.close());
 const inputs=Array.from({length:8},(_,i)=>({...s.assets[i%2],alt_en:'Synthetic concurrency '+i}));const proofs=await Promise.all(inputs.map(verify));assert.equal(proofs.length,8);assert.ok(proofs.every(p=>p.decoded));
 let active=0,max=0;for(const event of s.read()){active+=event.phase==='start'?1:-1;max=Math.max(max,active);}assert.equal(active,0);assert.equal(max,2);assert.equal(s.read().filter(e=>e.phase==='start').length,16);
 const count=s.read().length;await Promise.all(inputs.map(verify));assert.equal(s.read().length,count,'unchanged verified descriptions must reuse decoding');
 for(const concurrency of [0,5,1.5,NaN])assert.throws(()=>createPublisherAsyncAssetVerifier(s.root,{concurrency}),/invalid_asset_concurrency/);
});
test('async cached proofs still reject changed bytes, metadata and symlinks and cannot be poisoned by callers',async t=>{
 const s=setup(t),verify=createPublisherAsyncAssetVerifier(s.root);t.after(()=>verify.close());const asset=s.assets[0],file=path.join(s.root,asset.object_key),bytes=fs.readFileSync(file),stat=fs.statSync(file);
 const proof=await verify(asset);proof.decoded=false;proof.sha256='0'.repeat(64);assert.equal((await verify(asset)).decoded,true);
 const bad=Buffer.from(bytes);bad[40]^=1;fs.writeFileSync(file,bad);fs.utimesSync(file,stat.atime,stat.mtime);await assert.rejects(verify(asset),/asset_hash_mismatch/);fs.writeFileSync(file,bytes);
 await assert.rejects(verify({...asset,width:17}),/asset_dimensions_mismatch/);const moved=path.join(s.root,'moved.png');fs.renameSync(file,moved);fs.symlinkSync(moved,file);await assert.rejects(verify(asset),/asset_size_or_type/);
});
test('queued asset descriptions are snapshotted and failed decoding is retried',async t=>{
 const s=setup(t);s.wrap('ffprobe',0.1);const verify=createPublisherAsyncAssetVerifier(s.root,{concurrency:1});t.after(()=>verify.close());const mutable={...s.assets[1]},first=verify(s.assets[0]),second=verify(mutable);mutable.duration_seconds=999;assert.ok((await Promise.all([first,second])).every(p=>p.decoded));
 const command=path.join(s.bin,'ffmpeg');fs.writeFileSync(command,'#!/bin/sh\nexit 1\n',{mode:0o700});const changed={...s.assets[0],alt_en:'Uncached failure'};await assert.rejects(verify(changed),/asset_decode_failed/);fs.unlinkSync(command);assert.equal((await verify(changed)).decoded,true);
});
test('file changed while decoding never produces a reusable asynchronous proof',async t=>{
 const s=setup(t),asset=s.assets[0],file=path.join(s.root,asset.object_key),bytes=fs.readFileSync(file);s.wrap('ffprobe');const wrapper=path.join(s.bin,'ffmpeg');fs.writeFileSync(wrapper,`#!/bin/sh\n/usr/bin/ffmpeg "$@" || exit "$?"\nprintf 'X' | dd of='${file}' bs=1 seek=40 conv=notrunc status=none\n`,{mode:0o700});const verify=createPublisherAsyncAssetVerifier(s.root);t.after(()=>verify.close());await assert.rejects(verify(asset),/asset_changed_during_decode/);
 fs.writeFileSync(file,bytes);fs.unlinkSync(wrapper);assert.equal((await verify(asset)).decoded,true);assert.equal(s.read().filter(e=>e.phase==='start').length,2,'restored bytes must be decoded again');
});
test('closing the verifier kills active decoders, rejects queued work and refuses new jobs',async t=>{
 const s=setup(t);s.wrap('ffprobe',10);const verify=createPublisherAsyncAssetVerifier(s.root,{concurrency:1});const results=Promise.allSettled([verify(s.assets[0]),verify(s.assets[1])]);const pids=await entered(s);await verify.close();await verify.close();assert.ok((await results).every(r=>r.status==='rejected'&&r.reason.message==='asset_verifier_closed'));assert.ok(pids.every(gone));await assert.rejects(verify(s.assets[0]),/asset_verifier_closed/);
});
test('worker close drains real decoder processes before resolving and rejects its pending load',async t=>{
 const s=setup(t),filename=path.join(s.root,'publisher.sqlite'),db=openPublisherStore(filename,{create:true});t.after(()=>db.close());initializePublisherCatalogue(db);const p=await fixturePackage(s.assets);await seedFixturePackages(db,[p]);const options={assetRoot:s.root,now:fixtureNow};await applyPublisherCatalogue(db,await planPublisherCatalogue(db,{targets:[{source_id:p.lesson.source.source_id,version:p.lesson.version}],operator:'Synthetic cancellation test',reason:'Synthetic only'},options),options);
 s.wrap('ffprobe',10);const worker=createPublisherWorkerLoader({mode:'synthetic-local',filename,assetRoot:s.root});const pending=assert.rejects(worker.load({now:fixtureNow}),/publisher_worker_closed/);const pids=await entered(s);const began=Date.now();await worker.close();await pending;assert.ok(Date.now()-began<4000,'close must cancel rather than wait for slow decode');assert.ok(pids.every(gone));
});
