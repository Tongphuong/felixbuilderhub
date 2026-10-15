/** Private local trial transport. Construction never reads credentials or calls a provider. */
export const STORY_TRIAL_MODELS={
  asr:'@cf/openai/whisper-large-v3-turbo',
  text:'@cf/qwen/qwen3-30b-a3b-fp8',
  speech:'@cf/deepgram/aura-2-en',
};
export function createStoryCloudflareBinding({accountId,token,fetchFn=fetch,onCall=()=>{},timeoutMs=7500}) {
  if(!/^[a-f0-9]{32}$/i.test(accountId||'')||typeof token!=='string'||token.length<20||/[\r\n]/.test(token))throw Error('trial_credentials_required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw Error('trial_timeout_limit');
  const counts=new Map();
  return {async run(model,input) {
    if(!Object.values(STORY_TRIAL_MODELS).includes(model))throw Error('trial_model_refused');
    const count=counts.get(model)||0,limit=model===STORY_TRIAL_MODELS.text?3:1;
    if(count>=limit)throw Error('trial_call_limit');
    if(model===STORY_TRIAL_MODELS.text) {
      if(!Array.isArray(input.messages)||new TextEncoder().encode(JSON.stringify(input.messages)).length>24000||
        input.stream!==false||!Number.isSafeInteger(input.max_tokens)||input.max_tokens<1||input.max_tokens>1536||input.tools)throw Error('trial_text_limit');
    } else if(model===STORY_TRIAL_MODELS.asr) {
      if(typeof input.audio!=='string'||input.audio.length>2_602_728)throw Error('trial_audio_limit');
    } else if(typeof input.text!=='string'||input.text.length>220||input.encoding!=='mp3'||input.speaker!=='luna')throw Error('trial_speech_limit');
    counts.set(model,count+1);onCall(model);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),
      });
      if(!response.ok)throw Error('trial_provider_http_'+response.status);
      const reader=response.body?.getReader();if(!reader)throw Error('trial_empty_response');
      const chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4_000_000){await reader.cancel();throw Error('trial_response_limit');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      if(model===STORY_TRIAL_MODELS.speech) {
        if(!/^audio\/(mpeg|mp3)(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('trial_audio_response_required');
        return bytes;
      }
      let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('trial_invalid_json');}
      if(data.success!==true||!data.result||typeof data.result!=='object')throw Error('trial_provider_result_refused');
      return data.result;
    } catch(error) {
      // Provider bodies and raw fetch errors may contain credentials/URLs. Do not log them.
      if(/^trial_/.test(error.message))throw error;
      throw Error(controller.signal.aborted?'trial_provider_timeout':'trial_provider_unavailable');
    } finally {clearTimeout(timer);}
  }};
}
