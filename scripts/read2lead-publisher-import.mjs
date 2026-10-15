#!/usr/bin/env node
/** Private offline operator CLI. Default is dry-run; apply requires a saved plan. */
import fs from 'node:fs';
import {openPublisherStore,planPublisherImport,applyPublisherImport} from './lib/read2lead-publisher-import.mjs';
const args=process.argv.slice(2),options={};
try{
 for(let i=0;i<args.length;i++){const key=args[i];if(['--create','--apply'].includes(key)){if(options[key])throw Error('duplicate_argument');options[key]=true;}else if(['--db','--packages','--assets','--plan','--output'].includes(key)&&args[i+1]&&!args[i+1].startsWith('--')){if(options[key])throw Error('duplicate_argument');options[key]=args[++i];}else throw Error('invalid_arguments');}
 if(!options['--db']||!options['--packages']||!options['--output'])throw Error('required_arguments: --db --packages --output [--assets] [--create] [--apply --plan]');
 // Never overwrite an operator's prior report/plan or source package.
 if(fs.existsSync(options['--output']))throw Error('output_exists');
 const packages=JSON.parse(fs.readFileSync(options['--packages'],'utf8'));
 const db=openPublisherStore(options['--db'],{create:options['--create']===true});
 try{
  const config={assetRoot:options['--assets'],now:new Date().toISOString()};
  const report=options['--apply']?await applyPublisherImport(db,packages,{...JSON.parse(fs.readFileSync(options['--plan'],'utf8')),...config}):await planPublisherImport(db,packages,config);
  fs.writeFileSync(options['--output'],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'pass',mode:options['--apply']?'private_import':'dry_run',publication:'not_performed',output:options['--output']}));
 }finally{db.close();}
}catch(e){console.error(JSON.stringify({status:'refused',error:e.message}));process.exitCode=1;}
