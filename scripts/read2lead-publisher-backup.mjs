#!/usr/bin/env node
import {openPublisherStore} from './lib/read2lead-publisher-import.mjs';
import {createPublisherBackup,verifyPublisherBackup,restorePublisherBackup} from './lib/read2lead-publisher-backup.mjs';
try{
 const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i++){const k=args[i];if(!['--db','--assets','--create','--verify','--restore','--destination'].includes(k)||Object.hasOwn(o,k)||!args[i+1]||args[i+1].startsWith('--'))throw Error('invalid_arguments');o[k]=args[++i];}
 if([o['--create'],o['--verify'],o['--restore']].filter(Boolean).length!==1)throw Error('one_backup_mode_required');
 let result;
 if(o['--create']){if(!o['--db']||o['--destination'])throw Error('create_requires_db');const db=openPublisherStore(o['--db']);try{result=await createPublisherBackup(db,{assetRoot:o['--assets'],destination:o['--create'],now:new Date().toISOString()});}finally{db.close();}}
 else if(o['--restore']){if(!o['--destination']||o['--db']||o['--assets'])throw Error('restore_requires_new_destination');result=await restorePublisherBackup(o['--restore'],{destination:o['--destination']});}
 else{if(o['--db']||o['--assets']||o['--destination'])throw Error('invalid_verify_arguments');result=await verifyPublisherBackup(o['--verify']);}
 console.log(JSON.stringify({status:'pass',directory:result.directory,verified:result.verified,assets:result.assets.length,database_sha256:result.database.sha256,learner_writes:0,active_store_switched:false,original_source_archives_included:false}));
}catch(error){console.error(JSON.stringify({status:'refused',error:error.message}));process.exitCode=1;}
