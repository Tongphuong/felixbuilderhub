import {PrivateStoryBudgetStore} from '../../../scripts/lib/read2lead-story-budget-store.mjs';
import {validateStoryBudget,STORY_POOL_MONTHLY_MICRO_USD,STORY_POOL_MIN_REMAINING_MICRO_USD,STORY_SYNTHESIS_FRESH} from './story-budget.mjs';
import {createMinnyStoryProvider} from './story-voice.mjs';
import {verifiedLessonCatalogue} from './private-voice.mjs';
import {publisherDigest} from './self-learn/publisher-contract.mjs';
import {getOrSynthesize} from '../../api/_minny-tts.js';

const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const disabled=reason=>({config:null,canAssign:()=>false,status:{enabled:false,reason}});
const batchKeys=['approvedVoiceMicroUsd','batchId','expiresAt','maxTurns','scope','worstCaseTurnMicroUsd'];
// Packet B (SPEC_R2L_MINNY_VOICE_COST): one standing monthly pool, no expiry.
export const STUDENT_POOL_ID='r2l-student-pool';
const poolKeys=['approvedVoiceMicroUsd','maxTurns','poolId','scope'];
const exactKeys=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.join(',');

/** Student speech goes through the shared saved-audio cache (getOrSynthesize,
 * same Aura-2 voice). Every fixed line is paid for once, then replayed free.
 * The returned audio is tagged fresh/cached so the pool debits honestly. A
 * cache outage degrades to plain synthesis, never to a failed turn. */
export function createStudentSynthesizer(env,fetchFn=fetch) {
  return async text=>{
    let hit=false;const kv=env.READ2LEAD_CODES;
    const cache=kv&&typeof kv.get==='function'&&typeof kv.put==='function'?{
      async get(key,options){try{const v=await kv.get(key,options);if(v&&v.audio_b64)hit=true;return v;}catch{return null;}},
      async put(key,value){try{await kv.put(key,value);}catch{/* cache write is best-effort */}},
    }:undefined;
    const audio=await getOrSynthesize({AI:env.AI,READ2LEAD_CODES:cache},text,{fetchFn});
    return Object.defineProperty({...audio},STORY_SYNTHESIS_FRESH,{value:!hit,enumerable:false});
  };
}

/** Trusted host configuration only. Grant and catalogue are separately pinned
 * release inputs, never HTTP fields. Evidence references do not manufacture
 * publication permission or provider verification.
 */
export async function studentVoiceConfiguration({store,env,packageSha256,lessonCatalogue,approvedGrant,now=()=>new Date(),fetchFn=fetch}) {
  const raw=env.R2L_STUDENT_VOICE_CONFIG;
  if(!raw)return disabled('not_configured');
  let value,grant;
  try{
    if(typeof raw!=='string'||raw.length>4096)throw Error();
    value=JSON.parse(raw);grant=structuredClone(approvedGrant);
  }catch{return disabled('invalid_configuration');}
  if(value?.format!=='read2lead-student-voice-v1'||value.audience!=='enrolled-students'||
    value.mode!=='assessed'||value.providerRoute!=='cloudflare-only'||value.assessorModel!=='gpt-oss-120b'||
    !hash(packageSha256)||value.packageSha256!==packageSha256)return disabled('package_or_policy_mismatch');
  if(value.processingApproved!==true||value.spendingApproved!==true)return disabled('approval_missing');
  const pool=grant?.budget?.scope==='pool',keys=pool?poolKeys:batchKeys;
  if(!hash(grant?.approvalSha256)||value.approvalSha256!==grant.approvalSha256||
    !exactKeys(value.budget,keys)||!exactKeys(grant.budget,keys)||
    keys.some(k=>value.budget[k]!==grant.budget[k]))return disabled('grant_mismatch');
  const b=grant.budget;
  let validated,expires=Infinity;
  if(pool) {
    // Standing monthly pool: no expiry, nothing reserved per mission or per child.
    if(b.poolId!==STUDENT_POOL_ID||b.approvedVoiceMicroUsd>STORY_POOL_MONTHLY_MICRO_USD||b.maxTurns!==32)return disabled('launch_limit_invalid');
    try{validated=validateStoryBudget(b);}catch{return disabled('launch_limit_invalid');}
  }else{
  if(b.scope!=='batch'||b.batchId!=='r2l-student-launch-'+grant.approvalSha256.slice(0,32)||
    b.approvedVoiceMicroUsd>5000000||b.maxTurns!==32||b.worstCaseTurnMicroUsd!==70000)return disabled('launch_limit_invalid');
  try{validated=validateStoryBudget(b);}catch{return disabled('launch_limit_invalid');}
  expires=Date.parse(b.expiresAt);const current=now().getTime();
  if(!Number.isFinite(current)||expires<=current||expires-current>7*86400000)return disabled('launch_expiry_invalid');
  }
  if(!hash(value.pricingEvidenceSha256)||value.verification?.provider!==true||
    value.verification?.assessor!==true||!hash(value.verification.evidenceSha256))return disabled('verification_missing');
  let catalogue;
  try{catalogue=await verifiedLessonCatalogue({voiceVerificationLessons:lessonCatalogue?.lessons});}catch{return disabled('catalogue_mismatch');}
  if(!catalogue||catalogue.sha256!==lessonCatalogue.sha256||value.verification.catalogueSha256!==catalogue.sha256)return disabled('catalogue_mismatch');
  if(typeof env.AI?.run!=='function')return disabled('existing_provider_missing');
  // Canonical key order keeps restart/config-conflict checks stable.
  const budgetConfig=pool?{scope:b.scope,poolId:b.poolId,approvedVoiceMicroUsd:b.approvedVoiceMicroUsd,maxTurns:b.maxTurns}
    :{scope:b.scope,batchId:b.batchId,expiresAt:b.expiresAt,
    approvedVoiceMicroUsd:b.approvedVoiceMicroUsd,worstCaseTurnMicroUsd:b.worstCaseTurnMicroUsd,maxTurns:b.maxTurns};
  let budget;
  try{budget=new PrivateStoryBudgetStore(store,budgetConfig,now);}catch{return disabled('budget_unavailable');}
  const provider=createMinnyStoryProvider({env:{AI:env.AI,AZURE_SPEECH_KEY:env.AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION:env.AZURE_SPEECH_REGION,READ2LEAD_CODES:env.READ2LEAD_CODES},
    fetchFn,assessor:'gpt-oss-120b',cloudflareTimeoutMs:10000});
  provider.synthesize=createStudentSynthesizer({AI:env.AI,READ2LEAD_CODES:env.READ2LEAD_CODES},fetchFn);
  const scoped={provider,budget,practiceTrial:false,activation:{externalProcessingApproved:true,
    spendingApproved:true,providerVerified:true,assessorValidated:true}};
  const entryFor=lesson=>catalogue.lessons.find(l=>l.id===lesson?.id&&l.version===lesson?.version);
  const alive=()=>pool||now().getTime()<expires;
  const config={...scoped,async forPackage(pkg){
    const entry=entryFor(pkg?.lesson);
    return alive()&&entry&&entry.packageSha256===await publisherDigest(pkg)?scoped:null;
  }};
  const canAssign=lesson=>{
    if(!alive()||!entryFor(lesson))return false;
    // No tap path in the interview: offer a new voice story only while money remains.
    if(pool){const st=budget.poolStatus();return st.capMicroUsd-st.usedMicroUsd>=STORY_POOL_MIN_REMAINING_MICRO_USD;}
    try{
      const scope='batch:'+budget.config.batchId;
      const prior=store.db.prepare('SELECT config FROM story_voice_reservations WHERE month=? LIMIT 1').get(scope);
      if(prior&&prior.config!==JSON.stringify(budget.config))return false;
      const total=store.db.prepare('SELECT COALESCE(SUM(reserved),0) AS total FROM story_voice_reservations WHERE month=?').get(scope).total;
      return total+validated.missionReserveMicroUsd<=b.approvedVoiceMicroUsd;
    }catch{return false;}
  };
  return {config,canAssign,status:{enabled:true,mode:'assessed',reason:'bounded_student_launch'}};
}
