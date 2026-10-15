#!/usr/bin/env node
/** Offline operator only. Output contains private text, answer keys and rights metadata. */
import fs from 'node:fs';
import path from 'node:path';
import {openPublisherStore} from './lib/read2lead-publisher-import.mjs';
import {publisherReviewBundle,planPublisherReview,applyPublisherReview} from './lib/read2lead-publisher-review.mjs';
try{
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(!['--db','--assets','--source','--version','--request','--apply-plan','--output'].includes(key)||Object.hasOwn(options,key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('invalid_arguments');
  options[key]=args[++i];
 }
 if(!options['--db']||!options['--output']||(options['--request']&&options['--apply-plan']))throw Error('required_arguments: --db --output [--assets] [--source --version | --request | --apply-plan]');
 const output=path.resolve(options['--output']);
 if(output.split(path.sep).some(p=>['public','dist','.git'].includes(p))||fs.realpathSync(path.dirname(output))!==path.dirname(output))throw Error('private_output_required');
 if(fs.existsSync(output))throw Error('output_exists');
 const db=openPublisherStore(options['--db']);
 try{
  const config={assetRoot:options['--assets'],now:new Date().toISOString()};
  const mode=options['--apply-plan']?'apply_review':options['--request']?'plan_review':'inspect';
  if(mode==='inspect'&&(!options['--source']||!options['--version']))throw Error('source_and_version_required');
  const result=mode==='apply_review'?await applyPublisherReview(db,JSON.parse(fs.readFileSync(options['--apply-plan'],'utf8')),config):mode==='plan_review'?await planPublisherReview(db,JSON.parse(fs.readFileSync(options['--request'],'utf8')),config):await publisherReviewBundle(db,{source_id:options['--source'],version:options['--version']},config);
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'pass',mode,output,visibility:'private_operator_only',publication:'not_performed'}));
 }finally{db.close();}
}catch(error){console.error(JSON.stringify({status:'refused',error:error.message}));process.exitCode=1;}
