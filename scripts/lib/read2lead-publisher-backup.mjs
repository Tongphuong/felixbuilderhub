/** Private publisher DB + referenced delivery assets. Never overwrites or switches an active store. */
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {validatePublisherPackage} from '../../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import {publisherCatalogueHead} from './read2lead-publisher-catalogue.mjs';
import {canonical} from '../../src/lib/read2lead/self-learn/session-contract.mjs';
const FORMAT='r2l-private-publisher-backup/1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
function privatePath(name){const result=path.resolve(name);requireThat(!result.split(path.sep).some(p=>['public','dist','.git'].includes(p)),'private_backup_required');requireThat(fs.realpathSync(path.dirname(result))===path.dirname(result),'symlink_path_refused');return result;}
function newDirectory(name){const target=privatePath(name);fs.mkdirSync(target,{mode:0o700});return target;}
function regular(root,name){const file=path.join(root,name);requireThat(fs.realpathSync(file)===file&&fs.lstatSync(file).isFile(),'unsafe_backup_file');return file;}
function readChecked(file,expected){const stat=fs.lstatSync(file);requireThat(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===expected.bytes,'backup_size_mismatch');const bytes=fs.readFileSync(file);requireThat(hash(bytes)===expected.sha256,'backup_hash_mismatch');return bytes;}
function writeNew(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
async function databaseAssets(filename){
 const db=new DatabaseSync(filename,{readOnly:true});try{
  requireThat(db.prepare("SELECT value FROM publisher_meta WHERE key='format'").get()?.value==='r2l-private-publisher-store/1','wrong_publisher_store');
  requireThat(db.prepare('PRAGMA integrity_check').all().every(r=>r.integrity_check==='ok')&&db.prepare('PRAGMA foreign_key_check').all().length===0,'backup_database_integrity');
  const assets=new Map(),versions=new Map();
  for(const row of db.prepare('SELECT * FROM publisher_packages ORDER BY source_id,version').all()){
   const {package:pkg,package_sha256}=await validatePublisherPackage(JSON.parse(row.package_json));
   requireThat(package_sha256===row.content_sha256&&hash(canonical(pkg))===row.package_sha256&&pkg.lesson.id===row.lesson_id&&pkg.lesson.version===row.version&&pkg.lesson.source.source_id===row.source_id,'backup_package_integrity');
   versions.set(JSON.stringify([row.source_id,row.version]),row.content_sha256);
   for(const a of pkg.assets){const item={object_key:a.object_key,sha256:a.sha256,bytes:a.bytes},old=assets.get(a.object_key);requireThat(!old||canonical(old)===canonical(item),'backup_asset_conflict');assets.set(a.object_key,item);}
  }
  if(db.prepare("SELECT value FROM publisher_meta WHERE key='catalogue_format'").get()){
   publisherCatalogueHead(db);
   for(const row of db.prepare('SELECT id,manifest_json FROM publisher_catalogues').all()){
    const manifest=JSON.parse(row.manifest_json);requireThat(manifest.format==='r2l-private-publisher-catalogue/1'&&hash(canonical(manifest))===row.id&&Array.isArray(manifest.entries),'backup_catalogue_integrity');
    requireThat(manifest.entries.every(e=>versions.get(JSON.stringify([e.source_id,e.version]))===e.content_sha256),'backup_catalogue_integrity');
   }
  }
  return [...assets.values()].sort((a,b)=>a.object_key.localeCompare(b.object_key));
 }finally{db.close();}
}
export async function verifyPublisherBackup(directory){
 const root=privatePath(directory);requireThat(fs.realpathSync(root)===root&&fs.lstatSync(root).isDirectory(),'unsafe_backup_directory');
 const manifestFile=regular(root,'manifest.json');requireThat(fs.statSync(manifestFile).size<=8388608,'backup_manifest_limit');
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 requireThat(manifest.format===FORMAT&&manifest.database?.file==='publisher.sqlite'&&Array.isArray(manifest.assets)&&manifest.assets.length<=100000,'invalid_backup_manifest');
 requireThat(new Set(manifest.assets.map(a=>a.object_key)).size===manifest.assets.length&&manifest.assets.every(a=>/^[a-f0-9]{64}\.(png|jpg|webp|mp3|wav|ogg)$/.test(a.object_key)&&a.object_key.startsWith(a.sha256+'.')&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=104857600),'invalid_backup_manifest');
 const filename=regular(root,'publisher.sqlite');for(const suffix of ['-wal','-shm','-journal'])requireThat(!fs.existsSync(filename+suffix),'backup_database_in_use');
 readChecked(filename,manifest.database);const expected=await databaseAssets(filename);requireThat(canonical(expected)===canonical(manifest.assets),'backup_asset_manifest_mismatch');
 for(const asset of manifest.assets)readChecked(regular(root,'assets/'+asset.object_key),asset);
 // Refuse a backup that changed while its metadata was being inspected.
 readChecked(filename,manifest.database);
 return{format:FORMAT,directory:root,database:manifest.database,assets:manifest.assets,created_at:manifest.created_at,verified:true,learner_writes:0,original_source_archives_included:false};
}
export async function createPublisherBackup(db,{assetRoot,destination,now}){
 requireThat(typeof now==='string'&&Number.isFinite(Date.parse(now)),'backup_time_required');
 requireThat(db.prepare("SELECT value FROM publisher_meta WHERE key='format'").get()?.value==='r2l-private-publisher-store/1','wrong_publisher_store');
 const root=newDirectory(destination),filename=path.join(root,'publisher.sqlite');
 // SQLite creates a consistent standalone snapshot, including data currently in WAL.
 // On interruption the new directory is retained; absent/invalid manifest means incomplete.
 db.prepare('VACUUM INTO ?').run(filename);fs.chmodSync(filename,0o600);
 const assets=await databaseAssets(filename);fs.mkdirSync(path.join(root,'assets'),{mode:0o700});
 if(assets.length)requireThat(fs.realpathSync(assetRoot)===path.resolve(assetRoot),'symlink_path_refused');
 for(const asset of assets)writeNew(path.join(root,'assets',asset.object_key),readChecked(regular(path.resolve(assetRoot),asset.object_key),asset));
 const bytes=fs.readFileSync(filename),fd=fs.openSync(filename,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const manifest={format:FORMAT,created_at:now,database:{file:'publisher.sqlite',sha256:hash(bytes),bytes:bytes.length},assets,original_source_archives_included:false};
 writeNew(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return verifyPublisherBackup(root);
}
export async function restorePublisherBackup(source,{destination}){
 const verified=await verifyPublisherBackup(source),root=newDirectory(destination);fs.mkdirSync(path.join(root,'assets'),{mode:0o700});
 writeNew(path.join(root,'publisher.sqlite'),readChecked(regular(verified.directory,'publisher.sqlite'),verified.database));
 for(const asset of verified.assets)writeNew(path.join(root,'assets',asset.object_key),readChecked(regular(verified.directory,'assets/'+asset.object_key),asset));
 const manifest={format:FORMAT,created_at:verified.created_at,database:verified.database,assets:verified.assets,original_source_archives_included:false};
 writeNew(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return{...await verifyPublisherBackup(root),restored_from:verified.directory,active_store_switched:false};
}
