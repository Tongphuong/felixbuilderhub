import {privateVoiceConfiguration,existingStudentVoiceConfiguration,verifiedLessonCatalogue} from '../../functions/lib/read2lead/private-voice.mjs';
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {StorySqlStore} from '../../functions/lib/read2lead/story-store.mjs';
import {createPreviewApp,createPreviewContentLoader,durableSqlAdapter} from './app.mjs';
import {createExistingTestAccountApp} from './account-app.mjs';
import {createUnifiedAccountApp} from './unified-account-app.mjs';
import {UNIFIED_MODE,FREEZE_MODE,ACCOUNT_MODE_HEADER,ACCOUNT_PLAN_HEADER} from '../../functions/lib/read2lead/account-unified-gateway.mjs';
import {captureFrozenAccountState,applyFrozenAccountRollout} from '../../functions/lib/read2lead/account-rollout-operator.mjs';
import {studentStoryConfiguration} from '../../functions/lib/read2lead/student-story.mjs';

const EXISTING_TEST_OBJECT='existing-student-test-v1';
const ADMIN_HEADER='X-R2L-Account-Admin-Verified';
async function existingAccountApp(ctx,env,adapter){
  const contentLoader=env.R2L_ACCOUNT_MODE===UNIFIED_MODE
    ?createPreviewContentLoader({assets:env.ASSETS,packageSha256:env.R2L_PREVIEW_PACKAGE_SHA256}):null;
  let manifest,hash;
  if(contentLoader){manifest=await contentLoader.load();hash=contentLoader.packageSha256;}
  else {
    const response=await env.ASSETS.fetch(new Request('https://preview-assets.invalid/__private/package.json'));
    if(!response.ok)throw Error('account_manifest_missing');
    const text=await response.text();hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==env.R2L_PREVIEW_PACKAGE_SHA256)throw Error('account_manifest_pin_mismatch');
    manifest=JSON.parse(text);
  }
  const config=manifest.existingTestAccount;
  if(!config)throw Error('account_manifest_not_configured');
  const store=new StorySqlStore(adapter.db,{transaction:adapter.transaction});
  const lessonCatalogue=await verifiedLessonCatalogue(manifest).catch(()=>null);
  const {config:voiceConfig}=existingStudentVoiceConfiguration({store,env,packageSha256:manifest.sourcePackageSha256,lessonCatalogue});
  const ordinaryStory=contentLoader?await studentStoryConfiguration({manifest,store,env}):null;
  const app=env.R2L_ACCOUNT_MODE===UNIFIED_MODE
    ? createUnifiedAccountApp({...adapter,contentLoader,assets:env.ASSETS,packageSha256:hash,expectedRolloutSha256:env.R2L_ACCOUNT_ROLLOUT_SHA256,
      progressInCodes:config.snapshot.progressInCodes,founderCode:config.code,origin:config.origin,founderVoiceConfig:voiceConfig,
      infrastructure:{...env,ADMIN_PASSWORD:'internal-pages-admin'},legacySpeechCache:env.READ2LEAD_CODES,
      // Ordinary OSAD activation requires its own approved catalogue and
      // bounded policy. No founder reservation is inherited by this host.
      ordinaryStory,scheduleBackground:p=>ctx.waitUntil(p)})
    : createExistingTestAccountApp({...adapter,assets:env.ASSETS,snapshot:config.snapshot,expectedSnapshotSha256:config.snapshotSha256,
      packageSha256:hash,code:config.code,origin:config.origin,voiceConfig,infrastructure:{ADMIN_PASSWORD:'internal-pages-admin'},scheduleBackground:p=>ctx.waitUntil(p)});
  return request=>{
    // Public worker traffic always uses the adult object below; only the Pages
    // binding reaches this named object. Pages strips/rebuilds this marker.
    if(new URL(request.url).pathname.startsWith('/api/admin/')&&request.headers.get(ADMIN_HEADER)==='1'){
      const headers=new Headers(request.headers);headers.delete(ADMIN_HEADER);headers.set('Authorization','Basic '+btoa('pages:internal-pages-admin'));
      request=new Request(request,{headers});
    }
    return app(request);
  };
}

export class Read2LeadPrivatePreview extends DurableObject {
  #frozenExport;
  #frozenApply;
  constructor(ctx,env) {
    super(ctx,env);
    const adapter=durableSqlAdapter(ctx.storage);
    if(ctx.id.toString()===env.R2L_PREVIEW_STATE.idFromName(EXISTING_TEST_OBJECT).toString()){
      const frozenOptions=()=>{
        if(env.R2L_ACCOUNT_MODE!==FREEZE_MODE)throw Error('account_operator_forbidden');
        const imported=adapter.db.prepare('SELECT progress_in_codes FROM read2lead_account_import WHERE id=1').get();
        if(![0,1].includes(imported?.progress_in_codes))throw Error('account_operator_storage_mode_mismatch');
        return {...adapter,objectName:EXISTING_TEST_OBJECT,objectId:ctx.id.toString(),
          progressInCodes:imported.progress_in_codes===1,isFrozen:()=>env.R2L_ACCOUNT_MODE===FREEZE_MODE,
          exclusive:fn=>ctx.blockConcurrencyWhile(fn),getCurrentBookmark:()=>ctx.storage.getCurrentBookmark()};
      };
      this.#frozenExport=()=>captureFrozenAccountState(frozenOptions());
      this.#frozenApply=input=>{
        const options=frozenOptions();
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='backup,plan,snapshot')throw Error('account_operator_input_invalid');
        if(!/^[a-f0-9]{64}$/.test(env.R2L_ACCOUNT_BACKUP_SHA256||'')||!/^[a-f0-9]{64}$/.test(env.R2L_ACCOUNT_ROLLOUT_SHA256||''))throw Error('account_operator_pins_required');
        return applyFrozenAccountRollout({...options,backup:input.backup,snapshot:input.snapshot,plan:input.plan,
          expectedBackupSha256:env.R2L_ACCOUNT_BACKUP_SHA256,expectedPlanSha256:env.R2L_ACCOUNT_ROLLOUT_SHA256});
      };
      let app;
      this.app=async request=>{
        try{
          if(env.R2L_ACCOUNT_MODE===FREEZE_MODE)return Response.json({code:'account_temporarily_paused'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}});
          if(env.R2L_ACCOUNT_MODE&&env.R2L_ACCOUNT_MODE!==UNIFIED_MODE)throw Error('account_mode_invalid');
          if(env.R2L_ACCOUNT_MODE===UNIFIED_MODE&&
            (request.headers.get(ACCOUNT_MODE_HEADER)!==UNIFIED_MODE||request.headers.get(ACCOUNT_PLAN_HEADER)!==env.R2L_ACCOUNT_ROLLOUT_SHA256))throw Error('account_gateway_mismatch');
          app??=existingAccountApp(ctx,env,adapter);
          const response=await (await app)(request),headers=new Headers(response.headers);
          headers.set('X-R2L-Account-Host',EXISTING_TEST_OBJECT);
          if(env.R2L_ACCOUNT_MODE===UNIFIED_MODE){headers.set(ACCOUNT_MODE_HEADER,UNIFIED_MODE);headers.set(ACCOUNT_PLAN_HEADER,env.R2L_ACCOUNT_ROLLOUT_SHA256);}
          return new Response(response.body,{status:response.status,headers});
        }catch{app=null;return Response.json({code:'account_host_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
      };
      return;
    }
    const store=new StorySqlStore(adapter.db,{transaction:adapter.transaction});
    this.app=createPreviewApp({store,assets:env.ASSETS,accessKey:env.R2L_PREVIEW_ACCESS_KEY,
      packageSha256:env.R2L_PREVIEW_PACKAGE_SHA256,
      voiceConfigurationFor:async m=>privateVoiceConfiguration({store,env,packageSha256:m.sourcePackageSha256,
        lessonCatalogue:await verifiedLessonCatalogue(m).catch(()=>null)})});
  }
  fetch(request){return this.app(request);}
  // RPC-only through the internal namespace binding. Public HTTP dispatch
  // always targets the adult object, which has no export capability.
  async exportFrozenAccounts(){
    if(!this.#frozenExport)throw Error('account_operator_forbidden');
    return this.#frozenExport();
  }
  async applyFrozenAccounts(input){
    if(!this.#frozenApply)throw Error('account_operator_forbidden');
    return this.#frozenApply(input);
  }
}
// Named service-binding RPC only. No public route, caller-selected namespace,
// restore operation or HTTP importer. Wrangler authenticates the local caller.
export class Read2LeadAccountOperator extends WorkerEntrypoint {
  #target(){
    if(this.env.R2L_ACCOUNT_MODE!==FREEZE_MODE)throw Error('account_operator_forbidden');
    return this.env.R2L_PREVIEW_STATE.get(this.env.R2L_PREVIEW_STATE.idFromName(EXISTING_TEST_OBJECT));
  }
  async exportFrozenAccounts(){return this.#target().exportFrozenAccounts();}
  async applyFrozenAccounts(input){return this.#target().applyFrozenAccounts(input);}
  fetch(){return new Response(null,{status:404});}
}
export default {
  fetch(request,env) {
    return env.R2L_PREVIEW_STATE.get(env.R2L_PREVIEW_STATE.idFromName('private-adult-preview-v1')).fetch(request);
  },
};
