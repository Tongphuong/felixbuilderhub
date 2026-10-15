import { exactFields, storyIdentity, storySessionView, StorySessionError } from '../lib/read2lead/story-session.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
async function body(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new StorySessionError('json_required', 415);
  const reader = request.body?.getReader(); if (!reader) throw new StorySessionError('body_required');
  let size = 0, chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 8192) { await reader.cancel(); throw new StorySessionError('body_too_large', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new StorySessionError('invalid_json'); }
}

/** Server-injected identity and verified publisher runtime; no HTTP-supplied grading. */
export function createStorySessionHandler({ store, runtime, origin, authenticate, voiceEnabled=()=>false, assignmentFor=null, learnerProfile=null, policyFor=null }) {
  const view=(pkg,state)=>{
    const result=storySessionView(pkg,state,{voiceEnabled:voiceEnabled()});
    if(policyFor)result.policy={...result.policy,...policyFor(pkg,state)};
    return {...result,...(learnerProfile?{learner:{name:learnerProfile.student_name,level:learnerProfile.level}}:{})};
  };
  const lessonFor = (id, version) => {
    const l = runtime.catalogue().find(x => x.id === id && (!version || x.version === version));
    if (!l) throw new StorySessionError('content_unavailable', 409);
    return runtime.packageFor(l);
  };
  return async request => {
    try {
      if (new URL(request.url).origin !== origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ code: 'origin_refused' }, 403);
      const owner = await authenticate(request);
      if (!owner) return json({ code: 'authentication_required' }, 401);
      if (request.method === 'GET') {
        const url = new URL(request.url);
        if (!url.search) return json({ lessons: runtime.catalogue().map(l => ({ id: l.id, version: l.version, title: l.title_en })) });
        if ([...url.searchParams.keys()].join(',') !== 'sessionId') throw new StorySessionError('invalid_query');
        const state = store.get(owner, storyIdentity(url.searchParams.get('sessionId')));
        const pkg = await lessonFor(state.storyId, state.contentVersion);
        return json(view(pkg, store.get(owner, state.sessionId)));
      }
      if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405);
      if (request.headers.get('origin') !== origin || new URL(request.url).search) return json({ code: 'origin_refused' }, 403);
      const input = await body(request);
      if (await authenticate(request) !== owner) return json({ code: 'authentication_required' }, 401);
      if (input?.action === 'open_assigned') {
        exactFields(input, ['action', 'packId']);
        if (!assignmentFor) throw new StorySessionError('assignment_unavailable', 409);
        const assigned = await assignmentFor(owner, storyIdentity(input.packId));
        const pkg = await lessonFor(assigned.id, assigned.version);
        return json(view(pkg, store.open(owner, pkg.lesson)));
      }
      if (input?.action === 'open') {
        exactFields(input, ['action', 'storyId', 'contentVersion']);
        const pkg = await lessonFor(storyIdentity(input.storyId), storyIdentity(input.contentVersion));
        return json(view(pkg, store.open(owner, pkg.lesson)));
      }
      exactFields(input, ['action', 'sessionId', 'requestId', 'revision', 'event']);
      if (input.action !== 'event' || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new StorySessionError('invalid_event');
      storyIdentity(input.sessionId); storyIdentity(input.requestId);
      const saved = store.get(owner, input.sessionId), pkg = await lessonFor(saved.storyId, saved.contentVersion);
      const { state, replayed } = store.event(owner, pkg.lesson, input);
      return json({ ...view(pkg, state), replayed });
    } catch (error) {
      return json({ code: error instanceof StorySessionError ? error.message : 'content_unavailable' }, error instanceof StorySessionError ? error.status : 409);
    }
  };
}

// Cloud hosting is deliberately unavailable until its authenticated store and
// deployment bindings pass verification. Local host calls the factory above.
export function onRequest() { return json({ code: 'story_missions_not_configured' }, 503); }
