import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {openPublisherStore,withdrawPublisherVersion} from '../scripts/lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue,publisherCatalogueState,publisherCatalogueHead,planPublisherCatalogue,applyPublisherCatalogue} from '../scripts/lib/read2lead-publisher-catalogue.mjs';
import {createPublisherBackup,verifyPublisherBackup,restorePublisherBackup} from '../scripts/lib/read2lead-publisher-backup.mjs';
import {fixtureAssets,fixturePackage,fixtureNow,seedFixturePackages} from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
async function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2l-backup-')),filename=path.join(root,'publisher.sqlite'),db=openPublisherStore(filename,{create:true});t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});const assets=fixtureAssets(root),pkg=await fixturePackage(assets);await seedFixturePackages(db,[pkg]);initializePublisherCatalogue(db);const options={assetRoot:root,now:fixtureNow},plan=await planPublisherCatalogue(db,{targets:[{source_id:pkg.lesson.source.source_id,version:pkg.lesson.version}],operator:'Synthetic backup test',reason:'Synthetic only'},options);await applyPublisherCatalogue(db,plan,options);return{root,filename,db,assets,pkg,options,create:name=>createPublisherBackup(db,{...options,destination:path.join(root,name)})};}
test('consistent WAL backup restores database, catalogue, reviews, receipts and referenced assets without changing live state',async t=>{
 const s=await setup(t);s.db.exec('PRAGMA journal_mode=WAL');s.db.prepare('INSERT INTO publisher_events(kind,payload_json) VALUES(?,?)').run('synthetic_wal_event','{}');const before=publisherCatalogueState(s.db),head=publisherCatalogueHead(s.db);
 const saved=await s.create('backup');assert.equal(saved.verified,true);assert.equal(saved.assets.length,2);assert.equal(publisherCatalogueState(s.db),before);assert.equal(fs.statSync(path.join(saved.directory,'publisher.sqlite')).mode&0o777,0o600);assert.equal(fs.statSync(saved.directory).mode&0o777,0o700);
 withdrawPublisherVersion(s.db,{source_id:s.pkg.lesson.source.source_id,version:s.pkg.lesson.version,reason:'Synthetic change after backup',now:fixtureNow});
 const restored=await restorePublisherBackup(saved.directory,{destination:path.join(s.root,'restored')});assert.equal(restored.active_store_switched,false);assert.equal(restored.original_source_archives_included,false);
 const copy=openPublisherStore(path.join(restored.directory,'publisher.sqlite'));try{assert.equal(publisherCatalogueHead(copy),head);assert.equal(publisherCatalogueState(copy),before);assert.equal(copy.prepare("SELECT count(*) n FROM publisher_events WHERE kind='synthetic_wal_event'").get().n,1);assert.equal(copy.prepare('SELECT count(*) n FROM publisher_catalogue_receipts').get().n,1);}finally{copy.close();}
 assert.equal(s.db.prepare('SELECT state FROM publisher_packages').get().state,'withdrawn');assert.equal((await verifyPublisherBackup(saved.directory)).verified,true);
});
test('existing destinations and symlinked/public paths are refused without overwriting data',async t=>{
 const s=await setup(t),existing=path.join(s.root,'existing');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'keep.txt'),'keep');await assert.rejects(s.create('existing'),/EEXIST/);assert.equal(fs.readFileSync(path.join(existing,'keep.txt'),'utf8'),'keep');
 fs.mkdirSync(path.join(s.root,'public'));await assert.rejects(createPublisherBackup(s.db,{...s.options,destination:path.join(s.root,'public','bad')}),/private_backup_required/);
 fs.symlinkSync(existing,path.join(s.root,'link'));await assert.rejects(createPublisherBackup(s.db,{...s.options,destination:path.join(s.root,'link','bad')}),/symlink_path_refused/);
 const saved=await s.create('backup');await assert.rejects(restorePublisherBackup(saved.directory,{destination:existing}),/EEXIST/);assert.equal(fs.readFileSync(path.join(existing,'keep.txt'),'utf8'),'keep');
});
test('corrupt or missing source assets leave an explicitly incomplete new backup, never a valid manifest',async t=>{
 const s=await setup(t),file=path.join(s.root,s.assets[0].object_key),bytes=fs.readFileSync(file);fs.writeFileSync(file,Buffer.alloc(bytes.length));await assert.rejects(s.create('corrupt'),/backup_hash_mismatch/);assert.equal(fs.existsSync(path.join(s.root,'corrupt','manifest.json')),false);await assert.rejects(verifyPublisherBackup(path.join(s.root,'corrupt')));
 fs.unlinkSync(file);await assert.rejects(s.create('missing'));assert.equal(fs.existsSync(path.join(s.root,'missing','manifest.json')),false);
 fs.writeFileSync(path.join(s.root,'other.png'),bytes);fs.symlinkSync(path.join(s.root,'other.png'),file);await assert.rejects(s.create('symlink'),/unsafe_backup_file/);
});
test('manifest omission, asset tampering and unexpected SQLite sidecars fail verification and restore before destination creation',async t=>{
 const s=await setup(t),saved=await s.create('backup'),manifestPath=path.join(saved.directory,'manifest.json'),text=fs.readFileSync(manifestPath,'utf8'),manifest=JSON.parse(text);manifest.assets.pop();fs.writeFileSync(manifestPath,JSON.stringify(manifest));await assert.rejects(verifyPublisherBackup(saved.directory),/backup_asset_manifest_mismatch/);fs.writeFileSync(manifestPath,text);
 const asset=path.join(saved.directory,'assets',s.assets[0].object_key),bytes=fs.readFileSync(asset);fs.writeFileSync(asset,Buffer.alloc(bytes.length));await assert.rejects(restorePublisherBackup(saved.directory,{destination:path.join(s.root,'refused')}),/backup_hash_mismatch/);assert.equal(fs.existsSync(path.join(s.root,'refused')),false);fs.writeFileSync(asset,bytes);
 fs.writeFileSync(path.join(saved.directory,'publisher.sqlite-wal'),'unexpected');await assert.rejects(verifyPublisherBackup(saved.directory),/backup_database_in_use/);
});
test('logical catalogue corruption refuses backup completion even when SQLite pages are healthy',async t=>{
 const s=await setup(t);s.db.prepare('UPDATE publisher_catalogues SET manifest_json=?').run('{}');await assert.rejects(s.create('bad-catalogue'),/backup_catalogue_integrity/);assert.equal(fs.existsSync(path.join(s.root,'bad-catalogue','manifest.json')),false);
});
test('actual backup CLI creates, verifies and restores to a new directory and refuses overwrite',async t=>{
 const s=await setup(t),cli=fileURLToPath(new URL('../scripts/read2lead-publisher-backup.mjs',import.meta.url)),backup=path.join(s.root,'cli-backup'),restored=path.join(s.root,'cli-restored');const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
 let result=run(['--db',s.filename,'--assets',s.root,'--create',backup]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).assets,2);
 result=run(['--verify',backup]);assert.equal(result.status,0,result.stderr);result=run(['--restore',backup,'--destination',restored]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).active_store_switched,false);
 result=run(['--restore',backup,'--destination',restored]);assert.equal(result.status,1);assert.match(result.stderr,/EEXIST/);assert.equal((await verifyPublisherBackup(restored)).verified,true);
});
