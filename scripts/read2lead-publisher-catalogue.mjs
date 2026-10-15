#!/usr/bin/env node
/** Offline private catalogue operator. No network/deployment operation. */
import fs from 'node:fs';
import path from 'node:path';
import {openPublisherStore} from './lib/read2lead-publisher-import.mjs';
import {initializePublisherCatalogue,loadPublisherCatalogue,planPublisherCatalogue,applyPublisherCatalogue} from './lib/read2lead-publisher-catalogue.mjs';
try{
 const args=process.argv.slice(2),o={};
 for(let i=0;i<args.length;i++){
  const k=args[i];if(Object.hasOwn(o,k))throw Error('duplicate_argument');
  if(k==='--initialize')o[k]=true;
  else if(['--db','--assets','--request','--apply-plan','--output'].includes(k)&&args[i+1]&&!args[i+1].startsWith('--'))o[k]=args[++i];
  else throw Error('invalid_arguments');
 }
 if(!o['--db']||!o['--output']||[o['--initialize'],o['--request'],o['--apply-plan']].filter(Boolean).length>1)throw Error('required_arguments: --db --output [--assets] [--initialize | --request | --apply-plan]');
 const output=path.resolve(o['--output']);
 if(output.split(path.sep).some(x=>['public','dist','.git'].includes(x))||fs.realpathSync(path.dirname(output))!==path.dirname(output))throw Error('private_output_required');
 if(fs.existsSync(output))throw Error('output_exists');
 const db=openPublisherStore(o['--db']);try{
  const config={assetRoot:o['--assets'],now:new Date().toISOString()};
  const result=o['--initialize']?initializePublisherCatalogue(db):o['--apply-plan']?await applyPublisherCatalogue(db,JSON.parse(fs.readFileSync(o['--apply-plan'],'utf8')),config):o['--request']?await planPublisherCatalogue(db,JSON.parse(fs.readFileSync(o['--request'],'utf8')),config):await loadPublisherCatalogue(db,config);
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'pass',output,scope:'private_local_catalogue',production_release_authorized:false}));
 }finally{db.close();}
}catch(error){console.error(JSON.stringify({status:'refused',error:error.message}));process.exitCode=1;}
