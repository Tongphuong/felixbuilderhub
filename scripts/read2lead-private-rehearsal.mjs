#!/usr/bin/env node
/** Explicit unpublished adult rehearsal. Read-only publisher DB, isolated test learners. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {initializeSyntheticTarget,startPrivateDraftPreview} from './read2lead-local-qa.mjs';
import {initializePrivateEditorAccess} from './lib/read2lead-private-editor-access.mjs';
export async function runPrivateRehearsal(args){
 const o={};args=[...args];while(args.length){const k=args.shift();if(['--init-synthetic','--init-access','--story-missions'].includes(k)){if(o[k])throw Error('duplicate_option');o[k]=true;continue;}if(!['--publisher-db','--asset-root','--data-root','--dist-root','--access-file','--targets','--port'].includes(k)||o[k]!==undefined||!args.length)throw Error('invalid_arguments');o[k]=args.shift();}
 for(const k of ['--publisher-db','--asset-root','--data-root','--dist-root','--access-file','--targets'])if(!path.isAbsolute(o[k]||'')||path.resolve(o[k])!==o[k])throw Error('absolute_paths_required');
 for(const k of ['--publisher-db','--asset-root','--targets'])if(o[k].split(path.sep).some(x=>['public','dist','.git'].includes(x))||fs.realpathSync(o[k])!==o[k])throw Error('private_publisher_path_required');
 if(fs.statSync(o['--targets']).size>16384)throw Error('targets_too_large');
 const targets=JSON.parse(fs.readFileSync(o['--targets'],'utf8'));
 const db=new DatabaseSync(o['--publisher-db'],{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');
 try{
  if(o['--init-access'])initializePrivateEditorAccess(o['--access-file']);
  if(o['--init-synthetic'])initializeSyntheticTarget(o['--data-root']);
  const host=await startPrivateDraftPreview({mode:'private-rehearsal',publisherStore:db,publisherAssetRoot:o['--asset-root'],accessFile:o['--access-file'],targets,dataRoot:o['--data-root'],distRoot:o['--dist-root'],storyMissions:o['--story-missions']===true,port:o['--port']===undefined?8884:Number(o['--port'])});
  let closed=false;return{...host,async close(){if(closed)return;closed=true;await host.close();db.close();}};
 }catch(e){db.close();throw e;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const host=await runPrivateRehearsal(process.argv.slice(2));console.log(JSON.stringify({status:'ready',url:host.origin+'/private-rehearsal/login',content_environment:host.contentEnvironment,learner_environment:host.learnerEnvironment,publisher_store:'read_only',publication:'not_performed',providers:'disabled',complete_lessons:0}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await host.close();process.exit(0);});}
 catch(e){console.error(JSON.stringify({status:'refused',error:e.message}));process.exitCode=1;}
}
