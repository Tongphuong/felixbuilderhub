#!/usr/bin/env node
/** Prepare an immutable private Cloudflare upload directory. Never deploys. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonical} from '../src/lib/read2lead/self-learn/session-contract.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/** An additive preview must retain the original illustrated-reader build mode. */
export function verifyExistingReaderBuild(html) {
  const mains=typeof html==='string'?[...html.matchAll(/<main\b[^>]*>/gi)].map(m=>m[0]):[];
  const reader=mains.filter(tag=>/\bid\s*=\s*(["'])main\1/i.test(tag));
  if(reader.length!==1||!/\bdata-r2l-w1-ssr\s*=\s*(["'])1\1/i.test(reader[0]))throw Error('preview_existing_reader_disabled');
  return {illustratedReaderEnabled:true};
}
/** Validate identity only: this does not authorize spending or verify providers. */
export function verifyPreviewVoicePin({manifest,configuration}) {
  if(manifest?.format!=='read2lead-private-cloud-preview-v1'||!manifest.package||
    sha(canonical(manifest.package))!==manifest.sourcePackageSha256)throw Error('preview_package_corrupt');
  if(configuration===undefined)return {configured:false,packageSha256:manifest.sourcePackageSha256};
  let value;
  try {
    if(typeof configuration!=='string'||configuration.length>4096)throw Error();
    value=JSON.parse(configuration);
  }catch{throw Error('preview_voice_configuration_invalid');}
  if(value?.format!=='read2lead-private-voice-v1'||
    value.packageSha256!==manifest.sourcePackageSha256)throw Error('preview_voice_package_mismatch');
  return {configured:true,packageSha256:manifest.sourcePackageSha256};
}
function safeFile(root,relative) {
  if(!relative||relative.split('/').some(s=>s==='..'||s==='')||path.isAbsolute(relative))throw Error('preview_path_refused');
  const file=path.join(root,relative),stat=fs.lstatSync(file);
  if(fs.realpathSync(file)!==file||!stat.isFile()||stat.nlink!==1)throw Error('preview_file_refused');
  return file;
}
export function preparePreviewPackage({plan,distRoot,assetRoot,output,existingSite=false}) {
  for(const root of [distRoot,assetRoot])if(!path.isAbsolute(root)||fs.realpathSync(root)!==root)throw Error('preview_root_refused');
  if(!path.isAbsolute(output)||fs.existsSync(output)||fs.realpathSync(path.dirname(output))!==path.dirname(output)||output.split(path.sep).some(s=>['public','dist','.git'].includes(s)))throw Error('preview_output_refused');
  const db=new DatabaseSync(plan.publisherDb,{readOnly:true});let row;
  try{row=db.prepare('SELECT package_json,package_sha256,state FROM publisher_packages WHERE source_id=? AND version=?').get(plan.sourceId,plan.contentVersion);}finally{db.close();}
  if(!row||row.state!=='draft'||row.package_sha256!==plan.packageSha256)throw Error('preview_package_changed');
  const pkg=JSON.parse(row.package_json);
  if(sha(canonical(pkg))!==plan.packageSha256)throw Error('preview_package_corrupt');
  const html=fs.readFileSync(safeFile(distRoot,'read2lead/lesson/index.html'),'utf8');
  if(!html.includes('story-mission-v1'))throw Error('preview_reader_outdated');
  if(existingSite)verifyExistingReaderBuild(html);
  const pages={},pageHtml=[html];
  if(existingSite)for(const name of ['read2lead','read2lead/lesson','ho-so','speak-up','shadowing','read2lead/speaking','read2lead/companion','read2lead/shop','read2lead/gifts','read2lead/leaderboard','read2lead/vinh-danh','read2lead/games','r2l/start']){
    const file=name+'/index.html';pages['/'+name]='/'+file;pages['/'+name+'/']='/'+file;
    if(name!=='read2lead/lesson')pageHtml.push(fs.readFileSync(safeFile(distRoot,file),'utf8'));
  }
  const scriptHashes=[...new Set(pageHtml.flatMap(text=>[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!/\bsrc=/.test(m[1])).map(m=>'sha256-'+createHash('sha256').update(m[2]).digest('base64'))))];
  const files=new Map(),publicAssets=new Set();
  const add=(target,file)=>{files.set(target,fs.readFileSync(file));};
  add('assets/read2lead/lesson/index.html',safeFile(distRoot,'read2lead/lesson/index.html'));
  for(const file of new Set(Object.values(pages)))add('assets'+file,safeFile(distRoot,file.slice(1)));
  // Build-generated JS/CSS only; no application data or unrelated HTML pages.
  for(const name of fs.readdirSync(path.join(distRoot,'_astro')))if(/^[\w.-]+\.(js|css|woff2?)$/.test(name)){
    const relative='_astro/'+name;add('assets/'+relative,safeFile(distRoot,relative));publicAssets.add('/'+relative);
  }
  const texts=[...pageHtml,...[...files.values()].map(b=>b.toString('utf8'))];
  for(const text of texts)for(const m of text.matchAll(/["'(](\/(?:assets|scripts|fonts|logo)\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?|png|webp|svg|jpg|mp3|ogg))(?:\?v=[a-f0-9]+)?["')]/g)){
    const relative=m[1].slice(1);if(!fs.existsSync(path.join(distRoot,relative)))continue;
    add('assets/'+relative,safeFile(distRoot,relative));publicAssets.add(m[1]);
  }
  // Existing avatar parts, Minny videos and reader sounds use computed URLs, so literal-URL
  // extraction alone misses them. Preserve these established public asset sets.
  if(existingSite)for(const directory of ['assets/monsters','assets/minny','assets/cosmetics','assets/effects','assets/frames','sfx/r2l']){
    const walk=relative=>{
      for(const item of fs.readdirSync(path.join(distRoot,relative),{withFileTypes:true})){
        const child=relative+'/'+item.name;
        if(item.isDirectory())walk(child);
        else if(item.isFile()&&/\.(?:png|webp|svg|jpg|mp4|webm|mp3|json)$/.test(item.name)){
          add('assets/'+child,safeFile(distRoot,child));publicAssets.add('/'+child);
        }
      }
    };walk(directory);
  }
  for(const a of pkg.assets){
    const file=safeFile(assetRoot,a.object_key),bytes=fs.readFileSync(file);
    if(bytes.length!==a.bytes||sha(bytes)!==a.sha256)throw Error('preview_media_changed');
    files.set('assets/__private/media/'+a.object_key,bytes);
  }
  const manifest=JSON.stringify({format:'read2lead-private-cloud-preview-v1',sourcePackageSha256:plan.packageSha256,package:pkg,publicAssets:[...publicAssets].sort(),scriptHashes,...(existingSite?{existingSite:true,pages}:{} )});
  verifyPreviewVoicePin({manifest:JSON.parse(manifest)});
  files.set('assets/__private/package.json',Buffer.from(manifest));
  const seen=new Set();
  function include(relative){
    if(seen.has(relative))return;seen.add(relative);
    const file=safeFile(repo,relative),source=fs.readFileSync(file,'utf8');files.set('source/'+relative,Buffer.from(source));
    for(const m of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))include(path.posix.normalize(path.posix.join(path.posix.dirname(relative),m[1])));
  }
  include('cloudflare/read2lead-private-preview/worker.mjs');
  const config={name:'read2lead-story-private-preview',main:'source/cloudflare/read2lead-private-preview/worker.mjs',compatibility_date:'2026-09-10',workers_dev:true,
    assets:{directory:'./assets',binding:'ASSETS',run_worker_first:true,html_handling:'none',not_found_handling:'none'},
    durable_objects:{bindings:[{name:'R2L_PREVIEW_STATE',class_name:'Read2LeadPrivatePreview'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['Read2LeadPrivatePreview']}],
    vars:{R2L_PREVIEW_PACKAGE_SHA256:sha(manifest)},observability:{enabled:false}};
  files.set('wrangler.json',Buffer.from(JSON.stringify(config,null,2)+'\n'));
  const checks=[...files].map(([file,bytes])=>({file,bytes:bytes.length,sha256:sha(bytes)}));
  const report={format:'read2lead-preview-upload-manifest-v1',preparedAt:new Date().toISOString(),status:'prepared-not-deployed',sourceId:plan.sourceId,contentVersion:plan.contentVersion,
    packageSha256:plan.packageSha256,manifestSha256:sha(manifest),aiEnabled:false,productionBindings:false,completeLessons:0,files:checks,totalBytes:checks.reduce((n,f)=>n+f.bytes,0)};
  fs.mkdirSync(output,{mode:0o700});
  for(const [relative,bytes] of files){const target=path.join(output,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});}
  fs.writeFileSync(path.join(output,'UPLOAD-MANIFEST.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2),options={};
    while(args.length){const key=args.shift();if(!['--plan','--dist','--asset-root','--output'].includes(key)||options[key]||!args.length)throw Error('preview_arguments');options[key]=args.shift();}
    const report=preparePreviewPackage({plan:JSON.parse(fs.readFileSync(options['--plan'],'utf8')),distRoot:options['--dist'],assetRoot:options['--asset-root'],output:options['--output']});
    console.log(JSON.stringify({status:report.status,files:report.files.length,totalBytes:report.totalBytes,manifestSha256:report.manifestSha256,output:options['--output']}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
