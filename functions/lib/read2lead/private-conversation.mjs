const CHAT_URL='https://openrouter.ai/api/v1/chat/completions';
const CHAT_MODEL='meta-llama/llama-3.3-70b-instruct';
const MODEL_LIMITS=new Map([
  ['@cf/openai/whisper-large-v3-turbo',1],
  ['@cf/meta/llama-3.3-70b-instruct-fp8-fast',2],
  ['@cf/meta/llama-guard-3-8b',1],
  ['@cf/deepgram/aura-2-en',2],
  ['@cf/myshell-ai/melotts',2],
  ['openrouter',2],
]);
const unavailable=()=>Response.json({ok:false,error:'private_voice_unavailable',
  message:'Minny tạm thời chưa trò chuyện được. Con thử lại sau nhé.'},
  {status:503,headers:{'Cache-Control':'private, no-store'}});

/** Private adult QA only. Every provider attempt consumes a pre-reserved slot.
 * Keep the original handler/provider chain, isolate its writes per request,
 * and finish deferred audio before atomically committing those writes.
 * No reservation is created, increased or refunded by this adapter.
 */
export async function runPrivateConversation({handler,request,env,voiceConfig,store,owner,commit,now=()=>Date.now(),timeoutMs=30000}) {
  const writes=new Map(),jobs=[],attempts=[],counts=new Map();
  let closed=false,denied=false,timer;
  const active=()=>{if(closed||request.signal.aborted)throw Error('private_conversation_closed');};
  const kv={
    async get(key,options={}) {
      active();
      if(writes.has(key)) {
        const row=writes.get(key);
        if(!row||(row.expires!==null&&row.expires<=now()))return null;
        return options==='json'||options.type==='json'?JSON.parse(row.value):row.value;
      }
      const value=await env.READ2LEAD_CODES.get(key,options);active();return value;
    },
    async put(key,value,options={}) {active();writes.set(key,{value:String(value),expires:options.expirationTtl?now()+options.expirationTtl*1000:null});},
    async delete(key) {active();writes.set(key,null);},
  };
  function claim(kind) {
    try {
      active();const c=voiceConfig?.budget?.config,a=voiceConfig?.activation;
      if(c?.scope!=='batch'||a?.externalProcessingApproved!==true||a?.spendingApproved!==true||a?.adultTrialApproved!==true||
        !MODEL_LIMITS.has(kind)||(counts.get(kind)||0)>=MODEL_LIMITS.get(kind)||attempts.length>=8)throw Error('private_provider_not_authorized');
      const account=typeof owner==='function'?owner():owner;
      if(!account)throw Error('private_voice_account_required');
      const rows=voiceConfig.budget.reservedSessionsForOwner(account);
      if(rows.length!==1)throw Error('private_voice_reservation_unavailable');
      const attempt={session:rows[0].session,requestId:'conversation-'+crypto.randomUUID(),finished:false};
      voiceConfig.budget.claim(attempt.session,attempt.requestId);
      attempts.push(attempt);counts.set(kind,(counts.get(kind)||0)+1);return attempt;
    }catch(error){denied=true;throw error;}
  }
  function finish(attempt,outcome) {
    if(attempt.finished)return;
    voiceConfig.budget.finish(attempt.session,attempt.requestId,outcome);attempt.finished=true;
  }
  function provider(kind,call) {
    const attempt=claim(kind);
    const promise=(async()=>{
      try {
        const value=await call();
        finish(attempt,closed||value instanceof Response&&!value.ok?'failed_or_unknown':'succeeded');return value;
      }catch(error){finish(attempt,'failed_or_unknown');throw error;}
    })();
    // Drain all started calls, even if the original service times out first.
    jobs.push(promise.catch(()=>{}));return promise;
  }
  const AI={run(model,input) {
    const text=input?.text??input?.prompt;
    const chat=model.includes('llama');
    if(typeof voiceConfig?.legacyAI?.run!=='function'||!MODEL_LIMITS.has(model)||
      (chat&&new TextEncoder().encode(JSON.stringify(input)).length>24000)||
      (model.includes('instruct')&&(!Number.isInteger(input?.max_tokens)||input.max_tokens>150||input.max_tokens<1))||
      (!chat&&!model.includes('whisper')&&(typeof text!=='string'||text.length>2000))||
      (model.includes('whisper')&&(typeof input?.audio!=='string'||input.audio.length>8388608))) {
      denied=true;return Promise.reject(Error('private_provider_not_authorized'));
    }
    try{return provider(model,()=>voiceConfig.legacyAI.run(model,input));}catch(error){return Promise.reject(error);}
  }};
  const fetchFn=(url,options)=>{
    let body;
    try {
      body=JSON.parse(options?.body);
      if(url!==CHAT_URL||options?.method!=='POST'||body.model!==CHAT_MODEL||body.max_tokens!==150||
        !Array.isArray(body.messages)||new TextEncoder().encode(options.body).length>24000||
        typeof voiceConfig?.legacyConversationFetch!=='function')throw Error();
    }catch{denied=true;return Promise.reject(Error('private_provider_not_authorized'));}
    try{return provider('openrouter',()=>voiceConfig.legacyConversationFetch(url,options));}catch(error){return Promise.reject(error);}
  };
  try {
    const work=(async()=>{
      const response=await handler({request,env:{READ2LEAD_CODES:kv,AI,
        ...(voiceConfig?.legacyConversationFetch?{OPENROUTER_API_KEY:'private-capability'}:{})},
        minnyReplyOptions:{fetchFn},waitUntil:promise=>{jobs.push(Promise.resolve(promise).catch(()=>{denied=true;}));}});
      for(let index=0;index<jobs.length;){const batch=jobs.slice(index);index=jobs.length;await Promise.all(batch);}
      active();
      if(denied)return unavailable();
      if(response.ok)commit(writes);
      return response;
    })();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('private_conversation_timeout')),Math.min(30000,Math.max(1,timeoutMs)));});
    return await Promise.race([work,deadline]);
  }catch{return unavailable();}
  finally {
    closed=true;clearTimeout(timer);
    for(const attempt of attempts)if(!attempt.finished){try{finish(attempt,'failed_or_unknown');}catch{/* no refund; keep durable reservation */}}
  }
}
