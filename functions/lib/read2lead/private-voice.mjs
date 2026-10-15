import {PrivateStoryBudgetStore} from '../../../scripts/lib/read2lead-story-budget-store.mjs';
import {createMinnyStoryProvider} from './story-voice.mjs';
import {publisherDigest} from './self-learn/publisher-contract.mjs';
import {contentDigest} from './self-learn/catalogue.mjs';
import {synthesizeWithAura2} from '../../api/_minny-tts.js';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const disabled=reason=>({config:null,status:{enabled:false,reason}});
const validLessons=(lessons,limit)=>Array.isArray(lessons)&&lessons.length>0&&lessons.length<=limit&&
  lessons.every(l=>l&&Object.keys(l).sort().join(',')==='id,packageSha256,version'&&
    typeof l.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(l.id)&&
    typeof l.version==='string'&&/^1\.2\.[1-9][0-9]*$/.test(l.version)&&hash(l.packageSha256))&&
  new Set(lessons.map(l=>l.id+'@'+l.version)).size===lessons.length;
/** Called only on the hash-verified deployment manifest. Configuration pins
 * this exact list; packages are not approved merely by being in a deployment.
 */
export async function verifiedLessonCatalogue(manifest) {
  const lessons=manifest?.voiceVerificationLessons;
  if(lessons===undefined)return null;
  if(!validLessons(lessons,320))throw Error('voice_catalogue_invalid');
  const snapshot=Object.freeze(lessons.map(l=>Object.freeze({...l})));
  return Object.freeze({sha256:await contentDigest(snapshot),lessons:snapshot});
}
/** The existing test learner has its own persisted allowance. Never inherit
 * the adult host's grant: the same grant in two stores would double capacity.
 */
export function existingStudentVoiceConfiguration(options){
  const raw=options.env.R2L_EXISTING_TEST_VOICE_CONFIG;
  if(!raw)return disabled('not_configured');
  let value;
  try{
    if(typeof raw!=='string'||raw.length>4096)throw Error();
    value=JSON.parse(raw);
  }catch{return disabled('invalid_configuration');}
  if(value?.budget?.scope!=='batch'||typeof value.budget.batchId!=='string'||
    !/^r2l-existing-student-[a-zA-Z0-9_-]+$/.test(value.budget.batchId))return disabled('student_batch_required');
  return privateVoiceConfiguration({...options,env:{...options.env,R2L_PRIVATE_VOICE_CONFIG:raw}});
}
/** Trusted deployment configuration only. Never accept this object from HTTP.
 * Evidence hashes point to separately reviewed records; they do not prove QA.
 * Invalid configuration keeps reading available and makes no provider request.
 */
export function privateVoiceConfiguration({store,env,packageSha256,lessonCatalogue=null,now=()=>new Date(),fetchFn=fetch}) {
  if(!env.R2L_PRIVATE_VOICE_CONFIG)return disabled('not_configured');
  let value;
  try {
    if(typeof env.R2L_PRIVATE_VOICE_CONFIG!=='string'||env.R2L_PRIVATE_VOICE_CONFIG.length>4096)throw Error();
    value=JSON.parse(env.R2L_PRIVATE_VOICE_CONFIG);
  }catch{return disabled('invalid_configuration');}
  if(value?.format!=='read2lead-private-voice-v1'||!['adult-practice','assessed'].includes(value.mode)||
    !hash(value.packageSha256)||value.packageSha256!==packageSha256)return disabled('package_or_mode_mismatch');
  if(value.processingApproved!==true||value.spendingApproved!==true||value.adultTrialApproved!==true)return disabled('approval_missing');
  if(!hash(value.pricingEvidenceSha256))return disabled('pricing_evidence_missing');
  const assessor=value.assessorModel??'legacy';
  if(!['legacy','gpt-oss-120b'].includes(assessor))return disabled('assessor_not_supported');
  const route=value.providerRoute??'speakup-default';
  if(!['speakup-default','cloudflare-only'].includes(route))return disabled('provider_route_not_supported');
  const assessed=value.mode==='assessed';
  if(value.verifiedLessonsOnly!==undefined&&(typeof value.verifiedLessonsOnly!=='boolean'||(value.verifiedLessonsOnly&&!assessed)))return disabled('verified_scope_required');
  if(assessed&&(value.verification?.provider!==true||value.verification?.assessor!==true||!hash(value.verification?.evidenceSha256)))return disabled('verification_missing');
  let verifiedLessons=value.verification?.lessons;
  if(value.verification?.catalogueSha256!==undefined){
    if(!assessed||value.verifiedLessonsOnly!==true||verifiedLessons!==undefined||
      !hash(value.verification.catalogueSha256)||lessonCatalogue?.sha256!==value.verification.catalogueSha256||
      !validLessons(lessonCatalogue?.lessons,320))return disabled('verification_catalogue_mismatch');
    verifiedLessons=lessonCatalogue.lessons.map(l=>({...l}));
  }else if(assessed&&!validLessons(verifiedLessons,20))return disabled('verification_scope_missing');
  if(!env.AI||typeof env.AI.run!=='function'||(route==='speakup-default'&&(typeof env.OPENROUTER_API_KEY!=='string'||!env.OPENROUTER_API_KEY.trim())))return disabled('existing_providers_missing');
  if(value.budget?.scope!=='batch'&&value.budget?.month!==now().toISOString().slice(0,7))return disabled('budget_month_expired');
  let budget;
  try{budget=new PrivateStoryBudgetStore(store,value.budget,now);}catch{return disabled('budget_not_reconciled');}
  if(budget.config.scope==='batch'&&now().getTime()>=Date.parse(budget.config.expiresAt))return disabled('budget_batch_expired');
  if(budget.config.missionReserveMicroUsd>budget.config.approvedVoiceMicroUsd)return disabled('budget_exhausted');
  const providerEnv=route==='cloudflare-only'?{AI:env.AI}:{AI:env.AI,OPENROUTER_API_KEY:env.OPENROUTER_API_KEY,
    OPENAI_API_KEY:env.OPENAI_API_KEY,READ2LEAD_OPENAI_API_KEY:env.READ2LEAD_OPENAI_API_KEY};
  // Optional existing free-tier service. Missing binding/meter falls back to STT.
  Object.assign(providerEnv,{AZURE_SPEECH_KEY:env.AZURE_SPEECH_KEY,AZURE_SPEECH_REGION:env.AZURE_SPEECH_REGION,READ2LEAD_CODES:env.READ2LEAD_CODES});
  const provider=createMinnyStoryProvider({env:providerEnv,fetchFn,assessor,cloudflareTimeoutMs:route==='cloudflare-only'?10000:4000});
  // Explicit bounded trial of the existing SpeakUp services. No different
  // voice or unallocated service is called when Aura is unavailable.
  if(route==='cloudflare-only')provider.synthesize=text=>synthesizeWithAura2(env.AI,text);
  const legacyConversationFetch=(url,options)=>fetchFn(url,{...options,headers:{...options.headers,Authorization:`Bearer ${env.OPENROUTER_API_KEY}`}});
  // Default to practice, including legacy services. Only a server-resolved exact
  // package can use the separately verified grading configuration.
  const practice={provider,budget,legacyAI:env.AI,legacyConversationFetch,practiceTrial:true,activation:{externalProcessingApproved:true,spendingApproved:true,
    adultTrialApproved:true,providerVerified:false,assessorValidated:false,assessorTrial:value.assessorTrial===true}};
  const config=assessed?{...practice,async forPackage(pkg){
    const entry=verifiedLessons.find(l=>l.id===pkg?.lesson?.id&&l.version===pkg?.lesson?.version);
    if(!entry||entry.packageSha256!==await publisherDigest(pkg))return value.verifiedLessonsOnly===true?null:practice;
    return {...practice,practiceTrial:false,activation:{...practice.activation,providerVerified:true,assessorValidated:true,assessorTrial:false}};
  }}:practice;
  return {config,
    status:{enabled:true,mode:value.mode,reason:assessed?'verified_configuration':'adult_practice_unassessed'}};
}

/** Original lesson services share already-reserved private adult trial slots.
 * No grant, session or reservation is created here. This is private QA only,
 * not a budget/account adapter for real learners. Credentials are not forwarded.
 */
export async function runPrivateLegacyVoice({handler,request,env,voiceConfig,store,owner,service}) {
  const models=service==='tts'
    ? new Set(['@cf/deepgram/aura-2-en','@cf/myshell-ai/melotts'])
    : new Set(['@cf/openai/whisper-large-v3-turbo']);
  let claim=null,denied=false,failed=false,calls=0,inFlight=0,closed=false,response;
  const unavailable=()=>Response.json({ok:false,error:'private_voice_unavailable',
    message:'Minny tạm thời chưa nghe hoặc đọc được. Con thử lại sau nhé.'},
    {status:503,headers:{'Cache-Control':'private, no-store'}});
  const AI={async run(model,input) {
    try {
      const c=voiceConfig?.budget?.config,a=voiceConfig?.activation;
      if(closed||!['tts','asr'].includes(service)||!models.has(model)||calls>=2||
        c?.scope!=='batch'||a?.externalProcessingApproved!==true||
        a?.spendingApproved!==true||a?.adultTrialApproved!==true||
        typeof voiceConfig?.legacyAI?.run!=='function')throw Error('private_voice_not_authorized');
      if(!claim) {
        const account=typeof owner==='function'?owner():owner;
        if(!account)throw Error('private_voice_account_required');
        const rows=voiceConfig.budget.reservedSessionsForOwner(account);
        if(rows.length!==1)throw Error('private_voice_reservation_unavailable');
        const session=rows[0].session,requestId='service-'+service+'-'+crypto.randomUUID();
        voiceConfig.budget.claim(session,requestId);
        claim={session,requestId};
      }
    }catch(error){denied=true;throw error;}
    calls++;inFlight++;
    try{return await voiceConfig.legacyAI.run(model,input);}
    catch(error){failed=true;throw error;}
    finally{inFlight--;}
  }};
  try {
    // Only isolated account storage and the guarded AI capability are passed.
    // Original allowlists/pack checks run before AI.run; a cache hit is free.
    response=await handler({request,env:{READ2LEAD_CODES:env.READ2LEAD_CODES,AI},waitUntil:p=>Promise.resolve(p).catch(()=>{})});
  }catch{failed=true;response=unavailable();}
  closed=true;
  if(claim) {
    try{voiceConfig.budget.finish(claim.session,claim.requestId,
      failed||denied||inFlight>0||!response.ok?'failed_or_unknown':'succeeded');}
    catch{return unavailable();}
  }
  return denied?unavailable():response;
}
