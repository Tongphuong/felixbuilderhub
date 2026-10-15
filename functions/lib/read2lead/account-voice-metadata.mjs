import {createAccountTransactionRunner} from './account-transactions.mjs';
import {azureUsageKey,AZURE_PA_MONTHLY_FREE_SECONDS} from '../../api/_azure-pronunciation.js';

const cacheKey=key=>typeof key==='string'&&/^tts:[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]{64}$/.test(key);

/** Trusted unified-host capability. Legacy KV is only a retained TTS cache;
 * every new cache value and pronunciation reservation belongs to account SQL.
 * No provider work runs inside a transaction. Failed/unknown calls retain usage.
 */
export function createAccountVoiceMetadata({db,transaction,progressInCodes,legacySpeechCache,now=()=>Date.now()}) {
  const run=createAccountTransactionRunner({db,transaction,progressInCodes,now});
  return Object.freeze({
    async get(key,options){
      if(!cacheKey(key)||options?.type!=='json')throw Error('voice_metadata_key_refused');
      const response=await run(async env=>Response.json({value:await env.READ2LEAD_CODES.get(key,{type:'json'})}));
      if(!response.ok)throw Error('voice_metadata_unavailable');
      const {value}=await response.json();
      return value===null&&legacySpeechCache?legacySpeechCache.get(key,{type:'json'}):value;
    },
    async put(key,value){
      if(!cacheKey(key)||typeof value!=='string')throw Error('voice_metadata_key_refused');
      const response=await run(async env=>{
        await env.READ2LEAD_CODES.put(key,value);return new Response(null,{status:204});
      });
      if(response.status!==204)throw Error('voice_metadata_unavailable');
    },
    async reserveAzureSeconds(key,seconds){
      if(key!==azureUsageKey(new Date(now()))||typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0||seconds>121)return false;
      const response=await run(async env=>{
        const raw=await env.READ2LEAD_CODES.get(key,{type:'json'}),used=raw===null?0:raw;
        if(typeof used!=='number'||!Number.isFinite(used)||used<0||used+seconds>AZURE_PA_MONTHLY_FREE_SECONDS)return Response.json({reserved:false});
        await env.READ2LEAD_CODES.put(key,JSON.stringify(used+seconds),{expirationTtl:40*24*3600});
        return Response.json({reserved:true});
      });
      if(!response.ok)return false;
      return (await response.json()).reserved===true;
    },
  });
}
