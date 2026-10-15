/** Private local verification worker; never a network endpoint or learner writer. */
import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {realpathSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPublisherCatalogueLoader} from './read2lead-publisher-catalogue.mjs';
if(!parentPort||!['synthetic-local','approved-local'].includes(workerData?.mode))throw Error('invalid_publisher_worker');
const filename=resolve(workerData.filename);if(realpathSync(filename)!==filename||!lstatSync(filename).isFile())throw Error('unsafe_publisher_worker_database');
const db=new DatabaseSync(filename,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');
const load=createPublisherCatalogueLoader({assetRoot:workerData.assetRoot,asyncAssets:true});let busy=false,closing=false,job=null;
const shutdown=async()=>{if(closing)return;closing=true;await load.close();await job;db.close();parentPort.close();};
parentPort.on('message',message=>{
 if(message?.type==='close'){void shutdown();return;}
 if(closing)return;
 if(busy||!Number.isSafeInteger(message?.id)||message.id<1||typeof message.now!=='string'||!Number.isFinite(Date.parse(message.now))){parentPort.postMessage({id:message?.id,ok:false,code:'invalid_publisher_worker_job'});return;}
 busy=true;job=(async()=>{try{const value=await load(db,{now:message.now});if(value.packages.some(p=>p.lesson.source.kind!==(workerData.mode==='synthetic-local'?'synthetic_fixture':'user_supplied_publisher')))throw Error(workerData.mode==='synthetic-local'?'synthetic_publisher_only':'approved_publisher_only');if(!closing)parentPort.postMessage({id:message.id,ok:true,value});}
 catch(error){if(!closing)parentPort.postMessage({id:message.id,ok:false,code:String(error.message)});}finally{busy=false;}})();
});
parentPort.on('close',()=>{void shutdown();});
