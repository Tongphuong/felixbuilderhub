#!/usr/bin/env node
/** Explicit private publisher-content preview. Synthetic learners, loopback only, no publication writes. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {initializeSyntheticTarget,startApprovedPublisherPreview} from './read2lead-local-qa.mjs';
export async function runPublisherPreview(args){
 const options={};args=[...args];
 while(args.length){const key=args.shift();if(key==='--init-synthetic'){if(options.init)throw Error('duplicate_option');options.init=true;continue;}if(!['--publisher-db','--asset-root','--data-root','--dist-root','--port'].includes(key)||options[key]!==undefined||!args.length)throw Error('invalid_arguments');options[key]=args.shift();}
 for(const key of ['--publisher-db','--asset-root','--data-root','--dist-root'])if(!path.isAbsolute(options[key]||'')||path.resolve(options[key])!==options[key])throw Error('absolute_paths_required');
 const filename=options['--publisher-db'],assetRoot=options['--asset-root'],port=options['--port']===undefined?8876:Number(options['--port']);
 if(!Number.isInteger(port)||(port!==0&&(port<1024||port>65535)))throw Error('invalid_port');
 for(const name of [filename,assetRoot])if(name.split(path.sep).some(part=>['public','dist','.git'].includes(part))||fs.realpathSync(name)!==name)throw Error('private_publisher_path_required');
 if(!fs.lstatSync(filename).isFile()||!fs.lstatSync(assetRoot).isDirectory())throw Error('private_publisher_path_required');
 const db=new DatabaseSync(filename,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');let preview;
 try{
  if(db.prepare("SELECT value FROM publisher_meta WHERE key='format'").get()?.value!=='r2l-private-publisher-store/1')throw Error('wrong_publisher_store');
  if(options.init)initializeSyntheticTarget(options['--data-root']);
  preview=await startApprovedPublisherPreview({mode:'approved-local',dataRoot:options['--data-root'],distRoot:options['--dist-root'],port,publisherStore:db,publisherAssetRoot:assetRoot});
 }catch(error){db.close();throw error;}
 let closed=false;return{url:preview.url,origin:preview.origin,contentEnvironment:'approved-local',learnerEnvironment:'synthetic',production_release_authorized:false,async close(){if(closed)return;closed=true;await preview.close();db.close();}};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const preview=await runPublisherPreview(process.argv.slice(2));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await preview.close();process.exit(0);});console.log(JSON.stringify({status:'ready',url:preview.url,content_environment:preview.contentEnvironment,learner_environment:preview.learnerEnvironment,publisher_store:'read_only',production_release_authorized:false}));}
 catch(error){console.error(JSON.stringify({status:'refused',error:error.message}));process.exitCode=1;}
}
