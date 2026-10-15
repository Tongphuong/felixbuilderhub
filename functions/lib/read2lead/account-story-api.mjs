import { createStorySessionHandler } from '../../api/read2lead-story-session.js';
import { createStoryTurnHandler, storyVoiceEnabled } from '../../api/read2lead-story-turn.js';
import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from '../../api/_rate-limit.js';
import { resolveAccessiblePack } from '../../api/_read2lead-pack-access.js';
import { isStoryPack, loadAssignedStory } from './story-catalogue.mjs';
import { StorySessionError } from './story-session.mjs';
import { createAccountStoryStore } from './account-story-store.mjs';

const json = (code, status) => Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
const refuse = (code, status = 409) => { throw new StorySessionError(code, status); };

/** Explicit server opt-in on the authoritative account host. No migration,
 * credential discovery, provider activation or paid-budget creation occurs here.
 * Account auth is the existing bearer access-code scheme plus its IP limiter.
 */
export function createAccountStoryApi({ db, transaction, run, now = () => Date.now(), progressInCodes = false, infrastructure, origin, voiceConfig = null, hostStorage = null }) {
  if (typeof origin !== 'string' || new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw Error('story_origin_required');
  // A trusted host may already own an atomic story/account store. Reuse it as
  // its synchronous account reader and outer access check. HTTP cannot select it.
  if (hostStorage !== null && (!hostStorage?.store || hostStorage.store.db !== db || typeof hostStorage.readAccount !== 'function' || typeof hostStorage.authorize !== 'function')) throw Error('account_host_storage_required');
  const store = hostStorage?.store ?? createAccountStoryStore({ db, transaction, now, progressInCodes });
  const readAccount = code => {
    let account;
    if (hostStorage) account = hostStorage.readAccount(code);
    else {
      const row = db.prepare("SELECT value,expires FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(code);
      account = row && (row.expires === null || row.expires > now()) ? JSON.parse(row.value) : null;
    }
    if (!account?.student_profile || typeof account.student_profile !== 'object') refuse('authentication_required', 401);
    return account;
  };
  return async request => {
    const url = new URL(request.url);
    if (url.origin !== origin || request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.method === 'POST' && request.headers.get('origin') !== origin)) return json('origin_refused', 403);
    if (!['GET', 'POST'].includes(request.method)) return json('method_not_allowed', 405);
    const code = (request.headers.get('X-Read2Lead-Code') || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(code)) return json('authentication_required', 401);
    try {
      const checked = await run(async env => {
        const ip = getClientIp(request), limit = await checkCodeRateLimit(env.READ2LEAD_CODES, ip);
        if (limit.blocked) return rateLimitedResponse(limit.retryAfter);
        const account = await env.READ2LEAD_CODES.get(code, { type: 'json' });
        if (!account?.student_profile || typeof account.student_profile !== 'object') {
          await recordCodeFailure(env.READ2LEAD_CODES, ip); return json('authentication_required', 401);
        }
        return json('authenticated', 200);
      });
      if (checked.status !== 200) return checked;
      const account = readAccount(code), validated = new Map(), contentPolicy = new Map(), resolvedVoice = new Map();
      const authenticate = async req => {
        if ((req.headers.get('X-Read2Lead-Code') || '').trim().toUpperCase() !== code) return null;
        if (hostStorage && !await hostStorage.authorize(req)) return null;
        try { readAccount(code); return code; } catch { return null; }
      };
      const packs = current => [current.progress?.current_pack, ...Object.values(current.story_pack_history || {})]
        .filter(pack => isStoryPack(pack) && resolveAccessiblePack(current, pack.pack_id) === pack);
      const binding = (pack, current) => JSON.stringify([pack.pack_id, pack.story_reference, pack.private_draft, current.is_test === true]);
      const key = value => `${value.id ?? value.storyId}@${value.version ?? value.contentVersion}`;
      const assigned = value => {
        const current = readAccount(code), pack = packs(current).find(p => p.story_reference?.id === (value.id ?? value.storyId) && p.story_reference.version === (value.version ?? value.contentVersion));
        if (!pack || pack.story_reference.source_id !== (value.source?.source_id ?? value.sourceId) ||
            (pack.private_draft !== false && current.is_test !== true)) refuse('assignment_not_found', 404);
        return { current, pack };
      };
      const assertValidated = lesson => {
        const { current, pack } = assigned(lesson);
        if (validated.get(key(lesson)) !== binding(pack, current)) refuse('story_version_changed');
      };
      const runtime = {
        catalogue: () => packs(readAccount(code)).map(pack => ({ id: pack.story_reference.id, version: pack.story_reference.version, title_en: pack.story_title })),
        async packageFor(lesson) {
          const current = readAccount(code), pack = packs(current).find(p => p.story_reference?.id === lesson.id && p.story_reference.version === lesson.version);
          if (!pack) refuse('assignment_not_found', 404);
          const pin = binding(pack, current);
          const loaded = await loadAssignedStory(infrastructure, current, pack.story_reference, { now: new Date(now()).toISOString() });
          // The root configuration may deliberately default to adult practice.
          // Decide permission only after resolving this exact assigned package.
          const voice = typeof voiceConfig?.forPackage === 'function' ? await voiceConfig.forPackage(loaded.pkg) : voiceConfig;
          const fresh = assigned(loaded.pkg.lesson);
          if (pin !== binding(fresh.pack, fresh.current)) refuse('story_version_changed');
          validated.set(key(loaded.pkg.lesson), pin);
          contentPolicy.set(key(loaded.pkg.lesson), { privateDraft: loaded.privateDraft, contentComplete: loaded.contentComplete === true });
          resolvedVoice.set(key(loaded.pkg.lesson), voice);
          return loaded.pkg;
        },
      };
      // Guards run synchronously immediately before each SQL operation. Async
      // content/provider work never holds a later staged account commit open.
      const owned = owner => { if (owner !== code) refuse('authentication_required', 401); readAccount(code); };
      const guardedStore = {
        get(owner, id) { owned(owner); const state = store.get(owner, id); assigned(state); if (validated.has(key(state))) assertValidated(state); return state; },
        open(owner, lesson) { owned(owner); assertValidated(lesson); return store.open(owner, lesson); },
        event(owner, lesson, input) { owned(owner); assertValidated(lesson); return store.event(owner, lesson, input); },
        beginVoice(owner, lesson, input, fingerprint) { owned(owner); assertValidated(lesson); return store.beginVoice(owner, lesson, input, fingerprint); },
        finishVoice(owner, lesson, input, result) { owned(owner); assertValidated(lesson); return store.finishVoice(owner, lesson, input, result); },
        beginPrompt(owner, lesson, input, enabled) { owned(owner); assertValidated(lesson); return store.beginPrompt(owner, lesson, input, enabled); },
        finishPrompt(owner, lesson, input, audio) { owned(owner); assertValidated(lesson); return store.finishPrompt(owner, lesson, input, audio); },
        voiceResult(owner, id, requestId) { owned(owner); assertValidated(store.get(owner, id)); return store.voiceResult(owner, id, requestId); },
        // A revoked account still needs its in-flight turn marked failed; this
        // cleanup never grants access or credits a balance.
        failVoice: (...args) => store.failVoice(...args),
        failPrompt: (...args) => store.failPrompt(...args),
      };
      const voiceFor = pkg => {
        assertValidated(pkg.lesson);
        const config = resolvedVoice.get(key(pkg.lesson));
        return config?.practiceTrial === true && readAccount(code).is_test !== true ? null : config;
      };
      const effectiveVoice = voiceConfig ? { ...voiceConfig, forPackage: voiceFor } : null;
      const options = { store: guardedStore, runtime, origin, authenticate, policyFor: (pkg, state) => {
        assertValidated(pkg.lesson);
        const testProgressOnly = readAccount(code).is_test === true;
        return { ...contentPolicy.get(key(pkg.lesson)), testProgressOnly, providerEnabled: storyVoiceEnabled(voiceFor(pkg)),
          rewardState: state.missionResult?.assessment?.status === 'complete' ? (testProgressOnly ? 'test_award_recorded' : 'award_recorded') : 'not_awarded' };
      } };
      if (url.pathname === '/api/read2lead-story-turn') return await createStoryTurnHandler({ ...options, voiceConfig: effectiveVoice })(request);
      return await createStorySessionHandler({ ...options, learnerProfile: account.student_profile,
        voiceEnabled: () => storyVoiceEnabled(effectiveVoice),
        assignmentFor: async (owner, packId) => {
          owned(owner); const pack = resolveAccessiblePack(readAccount(code), packId);
          if (!isStoryPack(pack)) refuse('assignment_not_found', 404);
          return { id: pack.story_reference.id, version: pack.story_reference.version };
        },
      })(request);
    } catch (error) { return json(error instanceof StorySessionError ? error.message : 'story_account_unavailable', error instanceof StorySessionError ? error.status : 503); }
  };
}
