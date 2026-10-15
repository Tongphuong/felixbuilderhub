/** Pages entry point for the same authenticated private preview backend. */
export default {
  async fetch(request,env) {
    if(!env.R2L_PREVIEW_STATE)return new Response('Private preview unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
    return env.R2L_PREVIEW_STATE.get(env.R2L_PREVIEW_STATE.idFromName('private-adult-preview-v1')).fetch(request);
  },
};
