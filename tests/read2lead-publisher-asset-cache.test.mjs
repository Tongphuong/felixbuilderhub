import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublisherAssetVerifier,openPublisherStore,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue,planPublisherCatalogue,applyPublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {createPublishedSyntheticRuntime} from '../scripts/lib/read2lead-publisher-runtime.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-decode-cache-')),assets=fixtureAssets(root),bin=path.join(root,'bin'),countFile=path.join(root,'calls');fs.mkdirSync(bin);for(const name of ['ffprobe','ffmpeg'])fs.writeFileSync(path.join(bin,name),`#!/bin/sh\nprintf '%s\\n' '${name}' >> '${countFile}'\nexec /usr/bin/${name} "$@"\n`,{mode:0o700});const old=process.env.PATH;process.env.PATH=bin+path.delimiter+old;t.after(()=>{process.env.PATH=old;fs.rmSync(root,{recursive:true,force:true});});return{root,assets,calls:()=>fs.existsSync(countFile)?fs.readFileSync(countFile,'utf8').trim().split('\n').filter(Boolean).length:0};}
test('decode cache reuses only verified descriptions while rereading hashes and refusing symlinks',t=>{
 const s=setup(t),verify=createPublisherAssetVerifier(s.root),image=s.assets[0],file=path.join(s.root,image.object_key),original=fs.readFileSync(file),stat=fs.statSync(file);
 assert.equal(verify(image).decoded,true);assert.equal(s.calls(),2);assert.equal(verify(image).decoded,true);assert.equal(s.calls(),2);
 const corrupt=Buffer.from(original);corrupt[40]^=1;fs.writeFileSync(file,corrupt);fs.utimesSync(file,stat.atime,stat.mtime);assert.throws(()=>verify(image),/asset_hash_mismatch/);assert.equal(s.calls(),2);
 fs.writeFileSync(file,original);assert.equal(verify(image).decoded,true);assert.equal(s.calls(),2);
 assert.throws(()=>verify({...image,width:17}),/asset_dimensions_mismatch/);assert.equal(s.calls(),4);
 const replacement=path.join(s.root,'replacement.png');fs.renameSync(file,replacement);fs.symlinkSync(replacement,file);assert.throws(()=>verify(image),/asset_size_or_type/);assert.equal(s.calls(),4);
});
test('new bytes and fresh verifier require decoding; caller cannot forge cached proof by mutating its result',t=>{
 const s=setup(t),verify=createPublisherAssetVerifier(s.root),audio=s.assets[1],proof=verify(audio);assert.equal(s.calls(),2);proof.decoded=false;proof.sha256='0'.repeat(64);assert.equal(verify(audio).decoded,true);assert.equal(s.calls(),2);
 const bytes=fs.readFileSync(path.join(s.root,audio.object_key));bytes[44]=1;const sha=createHash('sha256').update(bytes).digest('hex'),changed={...audio,sha256:sha,object_key:sha+'.wav'};fs.writeFileSync(path.join(s.root,changed.object_key),bytes);assert.equal(verify(changed).decoded,true);assert.equal(s.calls(),4);
 assert.equal(createPublisherAssetVerifier(s.root)(audio).decoded,true);assert.equal(s.calls(),6);
});
test('failed decoding is not cached',t=>{
 const s=setup(t),bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0]),sha=createHash('sha256').update(bytes).digest('hex'),bad={...s.assets[0],sha256:sha,bytes:bytes.length,object_key:sha+'.png'};fs.writeFileSync(path.join(s.root,bad.object_key),bytes);const verify=createPublisherAssetVerifier(s.root);
 assert.throws(()=>verify(bad),/asset_decode_failed/);const calls=s.calls();assert.ok(calls>0);assert.throws(()=>verify(bad),/asset_decode_failed/);assert.ok(s.calls()>calls);
});
test('file changed during decode is rejected and does not populate the cache',t=>{
 const s=setup(t),asset=s.assets[0],file=path.join(s.root,asset.object_key),original=fs.readFileSync(file),wrapper=path.join(s.root,'bin/ffmpeg'),command=fs.readFileSync(wrapper,'utf8');
 fs.writeFileSync(wrapper,command.replace('exec /usr/bin/ffmpeg "$@"','/usr/bin/ffmpeg "$@" || exit "$?"\nprintf \'X\' | dd of=\''+file+'\' bs=1 seek=40 conv=notrunc status=none'));
 const verify=createPublisherAssetVerifier(s.root);assert.throws(()=>verify(asset),/asset_changed_during_decode/);assert.equal(s.calls(),2);
 fs.writeFileSync(wrapper,command);fs.writeFileSync(file,original);assert.equal(verify(asset).decoded,true);assert.equal(s.calls(),4);
});
test('catalogue refresh reuses decode evidence but corruption, expiry and withdrawal remain blocked',async t=>{
 const s=setup(t),db=openPublisherStore(path.join(s.root,'publisher.sqlite'),{create:true});t.after(()=>db.close());initializePublisherCatalogue(db);const p=await fixturePackage(s.assets);await seedFixturePackages(db,[p]);const options={assetRoot:s.root,now:fixtureNow};await applyPublisherCatalogue(db,await planPublisherCatalogue(db,{targets:[{source_id:p.lesson.source.source_id,version:p.lesson.version}],operator:'Synthetic test',reason:'Synthetic test only'},options),options);
 let now=fixtureNow;const r=await createPublishedSyntheticRuntime({mode:'synthetic-local',db,assetRoot:s.root,now:()=>now}),calls=s.calls();assert.equal(r.catalogue().length,1);
 const invalidate=()=>db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('synthetic_refresh','{}');invalidate();await r.refresh();assert.equal(r.catalogue().length,1);assert.equal(s.calls(),calls);
 const file=path.join(s.root,s.assets[0].object_key),original=fs.readFileSync(file),bad=Buffer.from(original);bad[40]^=1;fs.writeFileSync(file,bad);invalidate();await r.refresh();assert.equal(r.catalogue().length,0);assert.equal(r.diagnostics().blocked[0].reason,'asset_unavailable');assert.equal(s.calls(),calls);
 fs.writeFileSync(file,original);invalidate();await r.refresh();assert.equal(r.catalogue().length,1);assert.equal(s.calls(),calls);
 now='2027-01-02T00:00:00.000Z';assert.throws(()=>r.catalogue(),/content_unavailable/);await r.refresh();assert.equal(r.catalogue().length,0);assert.equal(r.diagnostics().blocked[0].reason,'publisher_not_approved');assert.equal(s.calls(),calls);
 now=fixtureNow;invalidate();await r.refresh();withdrawPublisherVersion(db,{source_id:p.lesson.source.source_id,version:p.lesson.version,reason:'Synthetic revoke',now});assert.throws(()=>r.catalogue(),/content_unavailable/);await r.refresh();assert.equal(r.catalogue().length,0);assert.equal(r.diagnostics().blocked[0].reason,'withdrawn_version');assert.equal(s.calls(),calls);
});
