/** One local worker, at most one job, read-only store access and no caller-supplied code. */
import {Worker} from 'node:worker_threads';
import {isAbsolute} from 'node:path';
const error=code=>Object.assign(Error(code),{code});
export function createPublisherWorkerLoader({mode,filename,assetRoot,timeoutMs=900000}={}){
 if(!['synthetic-local','approved-local'].includes(mode)||!isAbsolute(filename||'')||!isAbsolute(assetRoot||'')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>900000)throw error('invalid_publisher_worker');
 let worker=null,pending=null,closed=false,sequence=0,stopping=null;
 const finish=(failure,value)=>{const job=pending;if(!job)return;pending=null;clearTimeout(job.timer);worker?.unref();failure?job.reject(failure):job.resolve(value);};
 const close=()=>{
  if(closed)return stopping??Promise.resolve();closed=true;finish(error('publisher_worker_closed'));
  stopping=!worker||worker.threadId===-1?Promise.resolve():new Promise(resolve=>{
   worker.ref();let timer;const done=()=>{clearTimeout(timer);resolve();};worker.once('exit',done);
   timer=setTimeout(()=>{void worker.terminate().then(done);},5000);
   try{worker.postMessage({type:'close'});}catch{void worker.terminate().then(done);}
  });return stopping;
 };
 const start=()=>{
  worker=new Worker(new URL('./read2lead-publisher-worker-entry.mjs',import.meta.url),{workerData:{mode,filename,assetRoot}});
  worker.on('message',message=>{if(closed||message?.id!==pending?.id)return;finish(message.ok?null:error(message.code||'publisher_worker_failed'),message.value);});
  worker.on('error',()=>{finish(error('publisher_worker_failed'));void close();});
  worker.on('exit',()=>{if(!closed){finish(error('publisher_worker_exited'));closed=true;}});
  worker.unref();
 };
 return Object.freeze({
  load({now}={}){
   if(closed)return Promise.reject(error('publisher_worker_closed'));
   if(pending)return Promise.reject(error('publisher_worker_busy'));
   if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))return Promise.reject(error('catalogue_time_required'));
   if(!worker)start();worker.ref();
   return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{finish(error('publisher_worker_timeout'));void close();},timeoutMs);pending={id,resolve,reject,timer};try{worker.postMessage({id,now});}catch{finish(error('publisher_worker_failed'));void close();}});
  },close
 });
}
