/** Local synthetic Request/Response boundary. Not registered as a production route. */
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
import { VoiceProof } from './voice.mjs';
import { lessonCard, publicCheckpoint, sessionView, practiceSummary } from './views.mjs';
import { validateLibraryInterests } from './library-policy.mjs';
import { publicReading, publicPracticeHistory, publicPreferences, publicLibrary, freeReadingView } from './library-views.mjs';
import { publicGamePreferences, publicGameView, publicGameCatalogue, publicGameAudit } from './game-views.mjs';
import { publicGiftView, publicGiftReceipt } from './gift-views.mjs';
import { publisherPracticeSummary } from './publisher-journey.mjs';
const PREFIX = '/api/read2lead/self-learn/';
const COOKIE = 'r2l_synthetic_session';
const MAX_BODY = 32768;
function validOrigin(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(value)) return false;
  try { const url = new URL(value); return url.origin === value && Number(url.port) >= 1024 && Number(url.port) <= 65535; } catch { return false; }
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
class BoundaryError extends Error { constructor(code) { super(code); this.code = code; } }
const requireThat = (value, code) => { if (!value) throw new BoundaryError(code); };
const CODES = {
  invalid_gift_goal: 400, gift_changed: 409, gift_unavailable: 409, insufficient_funds: 409, request_aborted: 400,
  unauthorized: 401, access_expired: 401, invalid_access: 401,
  wrong_child: 403, csrf_failed: 403, origin_refused: 403, parent_required: 403, child_access_disabled: 403, recording_disabled: 403,
  child_limit: 409, last_active_child: 409, access_conflict: 409, credential_unchanged: 409,
  invalid_request: 400, invalid_json: 400, body_too_large: 413, unsupported_media_type: 415,
  method_not_allowed: 405, not_found: 404, session_missing: 404, lesson_missing: 404,
  request_conflict: 409, session_conflict: 409, stale_revision: 409, invalid_transition: 409,
  content_unavailable: 409, session_limit: 429, rate_limited: 429,
  unsupported_session: 409, reading_not_found: 404, reading_finished: 409,
  invalid_monster_shape: 400, invalid_monster_part: 400, invalid_monster_color: 400, monster_purchase_retired: 409, revision_limit: 409,
};
const reply = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
} });
async function body(request) {
  requireThat(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'unsupported_media_type');
  const length = request.headers.get('content-length');
  requireThat(!length || (/^\d+$/.test(length) && Number(length) <= MAX_BODY), 'body_too_large');
  const reader = request.body?.getReader(); requireThat(reader, 'invalid_json');
  let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new BoundaryError('body_too_large'); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text);
  } catch (e) { if (e instanceof BoundaryError) throw e; throw new BoundaryError('invalid_json'); }
  finally { reader.releaseLock(); }
}
function cookieToken(request) {
  const raw = request.headers.get('cookie') || '';
  if (raw.length > 8192) return null;
  const found = raw.split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE + '='));
  return found.length === 1 && /^[a-f0-9]{64}$/.test(found[0].slice(COOKIE.length + 1)) ? found[0].slice(COOKIE.length + 1) : null;
}
/** Configuration is explicit; only known synthetic families and loopback HTTP are accepted. */
export function createLocalHandlers({ mode, origin, access, lessons, store, publisherRuntime = null, familyStore, libraryStore, libraryInterests, gameStore, giftStore, voice = new VoiceProof(), now = () => Date.now(), ttlMs = 3600000, parentTtlMs = 900000 } = {}) {
  if (mode !== 'synthetic-local' || !validOrigin(origin) || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600000 || !Number.isSafeInteger(parentTtlMs) || parentTtlMs < 1000 || parentTtlMs > 900000) throw Error('unsafe_local_api_config');
  const config = structuredClone(access), content = new Map(lessons.map(l => [l.id, structuredClone(l)]));
  if ((libraryStore || gameStore || giftStore) && !familyStore) throw Error('unsafe_local_api_config');
  const interestGroups = libraryStore ? validateLibraryInterests(libraryInterests, [...content.values()]) : [];
  if (config?.format !== 1 || config.purpose !== 'read2lead-local-synthetic-access' || !Array.isArray(config.families) || !config.families.length || config.families.length > 20 || content.size !== lessons.length || !content.size) throw Error('unsafe_local_api_config');
  const children = new Set(), codes = new Set(), families = new Map();
  for (const f of config.families) {
    if (!validId(f.id) || !f.id.startsWith('synthetic-') || typeof f.label_vi !== 'string' || typeof f.access_code !== 'string' || f.access_code.length < 6 || f.access_code.length > 64 || codes.has(f.access_code) || families.has(f.id) || !Array.isArray(f.children) || !f.children.length || f.children.length > 10) throw Error('unsafe_local_api_config');
    codes.add(f.access_code); families.set(f.id, f);
    for (const c of f.children) {
      if (!validId(c.id) || !c.id.startsWith('synthetic-') || children.has(c.id) || typeof c.label_vi !== 'string' || c.label_vi.length > 80 || !/^L[0-5]$/.test(c.level)) throw Error('unsafe_local_api_config');
      children.add(c.id);
    }
  }
  // Complete validation precedes even synthetic registration.
  if (!familyStore) for (const f of families.values()) for (const c of f.children) store.registerChild({ active: true, role: 'staff', id: 'synthetic-local-qa' }, { child_id: c.id, family_id: f.id, display_name: c.label_vi });
  const sessions = new Map(), counts = { requests: 0, errors: 0, login_failures: 0 };
  const windows = new Map();
  function rate(name, limit) {
    let w = windows.get(name);
    if (!w || now() - w.at >= 60000) { w = { at: now(), count: 0 }; windows.set(name, w); }
    requireThat(++w.count <= limit, 'rate_limited');
  }
  function currentFamily(s) {
    if (!familyStore) return families.get(s.familyId);
    // Child projection stays least-privileged even while the parent area is open.
    return familyStore.familyView({ ...s.familyPrincipal, role: 'child' });
  }
  function validateSession(s) {
    if (familyStore) currentFamily(s); // Checks current credential version on every request.
    if (s.familyPrincipal?.role === 'parent' && s.parentExpires <= now()) {
      s.familyPrincipal = { ...s.familyPrincipal, role: 'child' }; s.parentExpires = null;
    }
  }
  const cleanExpired = () => {
    for (const [key, value] of sessions) {
      if (value.expires <= now()) { sessions.delete(key); continue; }
      try { validateSession(value); } catch { sessions.delete(key); }
    }
  };
  const cookie = (key, expires) => `${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=${Math.max(0, Math.floor((expires - now()) / 1000))}`;
  function publicAccess(s) {
    const f = currentFamily(s), available = f.children;
    return { ok: true, environment: 'synthetic', family_label_vi: f.label_vi,
      children: available.map(c => ({ id: c.id, label_vi: c.label_vi, level: c.level,
        ...(familyStore ? { recording_allowed: c.recording_allowed } : {}) })),
      active_child_id: available.some(c => c.id === s.childId) ? s.childId : null,
      csrf: s.csrf, expires_at: new Date(s.expires).toISOString(),
      ...(familyStore ? { role: s.familyPrincipal.role, parent_expires_at: s.parentExpires ? new Date(s.parentExpires).toISOString() : null, consent_scope: 'synthetic_local_only' } : {}) };
  }
  function rotate(key, s, familyPrincipal, parentExpires = null) {
    const nextKey = token(), next = { ...s, familyPrincipal, parentExpires, csrf: token() };
    sessions.delete(key); sessions.set(nextKey, next);
    return reply(publicAccess(next), 200, { 'Set-Cookie': cookie(nextKey, next.expires) });
  }
  function authenticate(request) {
    const key = cookieToken(request), s = key && sessions.get(key);
    requireThat(s, 'unauthorized');
    if (s.expires <= now()) { sessions.delete(key); throw new BoundaryError('access_expired'); }
    try { validateSession(s); } catch (e) { sessions.delete(key); throw e; }
    return { key, s };
  }
  function parentView(s) {
    const f = familyStore.familyView(s.familyPrincipal);
    return { ok: true, ...f, children: f.children.map(c => {
      const p = { active: true, childId: c.id };
      // Only the most recent 100 saved sessions; no raw answer, transcript, private key or audio fields.
      const history = store.history(p, c.id).map(h => {
        const record = store.record(p, c.id, h.session_id), summary = record.session.schema_version === '1.3.0' ? publisherPracticeSummary(record) : practiceSummary(record);
        const statuses = { provisional: 0, assisted: 0, needs_support: 0, pending: 0, unassessable: 0, practice_only: 0 };
        for (const item of [...summary.reading, ...summary.fresh_probes]) if (Object.hasOwn(statuses, item.status)) statuses[item.status]++;
        return { session_id: h.session_id, lesson_id: h.lesson_id, title_en: record.lesson.title_en,
          level: record.lesson.level, stage: h.stage, status: h.status, updated_at: h.updated_at,
          reading_mode: summary.reading_mode, practice_status_counts: statuses,
          support_used: [...new Set([...summary.reading, ...summary.speech, ...summary.fresh_probes].flatMap(i => i.support_used))],
          speech: { attempts: summary.speech.length, pending: summary.speech.filter(i => i.oral_language_state === 'pending').length,
            unassessable: summary.speech.filter(i => i.oral_language_state === 'unassessable').length },
          automatic_mastery: false, automatic_promotion: false };
      });
      return { ...c, wallet: { balance: store.wallet(p, c.id).balance, real_rewards: false }, history, history_limit: 100 };
    }) };
  }
  function queryId(url) {
    requireThat([...url.searchParams.keys()].length === 1 && validId(url.searchParams.get('session_id')), 'invalid_request');
    return url.searchParams.get('session_id');
  }
  function currentRecord(principal, id) { return store.availableRecord ? store.availableRecord(principal, principal.childId, id) : store.record(principal, principal.childId, id); }
  function currentContent(s) { return typeof libraryStore?.catalogue === 'function' ? new Map(libraryStore.catalogue({ ...s.familyPrincipal, childId: s.childId }).map(l => [l.id, l])) : content; }
  const card = lesson => publisherRuntime?.owns(lesson.id) ? publisherRuntime.card(lesson) : lessonCard(lesson);
  const viewSession = async (record, checkAccess) => { const view = await (record.session.schema_version === '1.3.0' && publisherRuntime ? publisherRuntime.sessionView(record) : sessionView(record)); checkAccess(); if (record.session.schema_version === '1.3.0' && publisherRuntime) publisherRuntime.assertRecord(record); return view; };
  const viewReading = async (value, checkAccess) => { const view = await (publisherRuntime?.owns(value.lesson.id) ? publisherRuntime.readingView(value) : freeReadingView(value)); checkAccess(); if (publisherRuntime?.owns(value.lesson.id)) publisherRuntime.assertAvailable(value.lesson.id,value.reading.content_sha256); return view; };
  function childMatch(principal, value) { requireThat(value?.child_id === principal.childId, 'wrong_child'); }
  return {
    diagnostics() { cleanExpired(); return { ...counts, active_sessions: sessions.size, provider_enabled: voice.usage?.()?.enabled === true, scope: 'synthetic_local' }; },
    async handle(request) {
      counts.requests++;
      try {
        const url = new URL(request.url), incomingOrigin = request.headers.get('origin');
        requireThat(url.origin === origin && (!request.headers.has('host') || request.headers.get('host') === url.host) && (!incomingOrigin || incomingOrigin === origin) && request.headers.get('sec-fetch-site') !== 'cross-site', 'origin_refused');
        requireThat(['GET', 'POST'].includes(request.method) || (request.method === 'HEAD' && url.pathname.startsWith(PREFIX + 'media/')), 'method_not_allowed');
        requireThat(request.method !== 'POST' || incomingOrigin === origin, 'origin_refused');
        requireThat(url.pathname.startsWith(PREFIX), 'not_found');
        const route = url.pathname.slice(PREFIX.length);
        if (route === 'recover' && familyStore) {
          requireThat(request.method === 'POST' && !url.search, 'method_not_allowed'); rate('recovery', 10);
          const data = await body(request), result = familyStore.recover(data, new Date(now()).toISOString());
          // Exact old receipt replays cannot revoke a session issued under newer credentials.
          for (const [key, s] of sessions) if (s.familyId === data.family_id && s.familyPrincipal.credentialVersion < result.credential_version) sessions.delete(key);
          return reply({ ok: result.ok, replayed: result.replayed });
        }
        if (route === 'login') {
          requireThat(request.method === 'POST' && !url.search, 'method_not_allowed'); rate('login', 20);
          const data = await body(request); requireThat(exact(data, ['access_code']) && typeof data.access_code === 'string' && data.access_code.length <= 64, 'invalid_request');
          let family, familyPrincipal;
          try {
            if (familyStore) { familyPrincipal = familyStore.authenticateAccess(data.access_code); family = familyStore.familyView(familyPrincipal); }
            else { family = [...families.values()].find(f => f.access_code === data.access_code); requireThat(family, 'invalid_access'); }
          } catch (e) { if (e.code === 'invalid_access') counts.login_failures++; throw e; }
          cleanExpired();
          const prior = cookieToken(request); if (prior) sessions.delete(prior);
          requireThat(sessions.size < 64, 'rate_limited');
          const key = token(), s = { familyId: familyStore ? family.family_id : family.id,
            childId: family.children[0]?.id ?? null, csrf: token(), expires: now() + ttlMs,
            ...(familyStore ? { familyPrincipal, parentExpires: null } : {}) };
          sessions.set(key, s);
          return reply(publicAccess(s), 200, { 'Set-Cookie': cookie(key, s.expires) });
        }
        // Auth precedes parsing malformed private payloads and looking up child/session data.
        const { key, s } = authenticate(request);
        if (request.method === 'POST') requireThat(request.headers.get('x-r2l-csrf') === s.csrf, 'csrf_failed');
        const principal = { active: true, childId: s.childId };
        const ensureActive = () => {
          requireThat(sessions.get(key) === s, 'unauthorized');
          requireThat(s.expires > now(), 'access_expired'); validateSession(s);
          requireThat(s.childId === principal.childId, 'wrong_child');
        };
        const requireParent = () => {
          ensureActive(); requireThat(familyStore && s.familyPrincipal.role === 'parent', 'parent_required');
        };
        const ensureLearning = () => {
          ensureActive(); if (familyStore) {
            requireThat(principal.childId, 'child_access_disabled');
            return familyStore.childAccess(s.familyPrincipal, principal.childId);
          }
        };
        if (route.startsWith('media/')) {
          requireThat(publisherRuntime && ['GET','HEAD'].includes(request.method) && !url.search, 'not_found');
          ensureLearning(); requireThat(!request.signal.aborted, 'request_aborted');
          const result = await publisherRuntime.media(route.slice(6), { range: request.headers.get('range'), head: request.method === 'HEAD' });
          ensureLearning(); requireThat(!request.signal.aborted, 'request_aborted'); return result;
        }
        if (familyStore && route === 'parent/enter' && request.method === 'POST' && !url.search) {
          rate('parent', 10);
          const data = await body(request); ensureActive();
          requireThat(exact(data, ['parent_secret']) && typeof data.parent_secret === 'string', 'invalid_request');
          const p = familyStore.elevateParent(s.familyPrincipal, data.parent_secret);
          return rotate(key, s, p, Math.min(s.expires, now() + parentTtlMs));
        }
        if (familyStore && route === 'parent/exit' && request.method === 'POST' && !url.search) {
          const data = await body(request); ensureActive(); requireThat(exact(data, []), 'invalid_request');
          return rotate(key, s, { ...s.familyPrincipal, role: 'child' });
        }
        if (familyStore && route.startsWith('parent/')) {
          requireParent();
          if (route === 'parent/family' && request.method === 'GET' && !url.search) return reply(parentView(s));
          if (route === 'parent/audit' && request.method === 'GET' && !url.search) return reply({ ok: true, events: familyStore.audit(s.familyPrincipal) });
          if (['parent/create-child', 'parent/update-child'].includes(route) && request.method === 'POST' && !url.search) {
            const data = await body(request); requireParent();
            const result = route === 'parent/create-child' ? familyStore.createChild(s.familyPrincipal, data, new Date(now()).toISOString()) :
              familyStore.updateChild(s.familyPrincipal, data, new Date(now()).toISOString());
            return reply(result);
          }
          throw new BoundaryError('not_found');
        }
        if (route === 'me' && request.method === 'GET' && !url.search) return reply(publicAccess(s));
        if (route === 'logout' && request.method === 'POST' && !url.search) {
          requireThat(exact(await body(request), []), 'invalid_request'); ensureActive(); sessions.delete(key);
          return reply({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=${PREFIX}; Max-Age=0` });
        }
        if (route === 'child' && request.method === 'POST' && !url.search) {
          const data = await body(request); ensureActive(); requireThat(exact(data, ['child_id']) && validId(data.child_id), 'invalid_request');
          if (familyStore) familyStore.childAccess(s.familyPrincipal, data.child_id);
          else requireThat(families.get(s.familyId).children.some(c => c.id === data.child_id), 'wrong_child');
          s.childId = data.child_id; return reply(publicAccess(s));
        }
        if (route === 'gifts' || route.startsWith('gifts/')) {
          requireThat(giftStore && familyStore, 'not_found');
          const ensureGiftSession = () => { requireThat(!request.signal.aborted, 'request_aborted'); ensureLearning(); };
          ensureGiftSession(); requireThat(!url.search, 'invalid_request');
          const giftPrincipal = () => ({ ...s.familyPrincipal, childId: principal.childId });
          const currentGift = () => { const value = giftStore.view(giftPrincipal(), ensureGiftSession); childMatch(principal, value); return publicGiftView(value); };
          if (request.method === 'GET' && route === 'gifts') {
            rate('gift-read:' + principal.childId, 180); const current = currentGift(); ensureGiftSession(); return reply({ ok: true, gifts: current });
          }
          if (request.method === 'POST' && ['gifts/goal', 'gifts/redeem'].includes(route)) {
            rate('gift-write:' + principal.childId, 30);
            const data = await body(request); ensureGiftSession(); childMatch(principal, data);
            const { child_id, ...change } = data, kind = route === 'gifts/goal' ? 'goal' : 'redeem';
            const result = giftStore[kind === 'goal' ? 'setGoal' : 'redeem'](giftPrincipal(), change, new Date(now()).toISOString(), ensureGiftSession);
            ensureGiftSession(); const receipt = publicGiftReceipt(result, kind, principal.childId), current = currentGift(); ensureGiftSession();
            return reply({ ...receipt, current_gifts: current });
          }
          if (['gifts', 'gifts/goal', 'gifts/redeem'].includes(route)) throw new BoundaryError('method_not_allowed');
          throw new BoundaryError('not_found');
        }
        if (route === 'game' || route.startsWith('game/')) {
          requireThat(gameStore && familyStore, 'not_found'); ensureLearning();
          requireThat(!url.search, 'invalid_request');
          const gamePrincipal = () => ({ ...s.familyPrincipal, childId: principal.childId });
          const gameView = () => { const value = gameStore.view(gamePrincipal(), new Date(now()).toISOString()); childMatch(principal, value); return publicGameView(value); };
          if (request.method === 'GET' && ['game', 'game/catalogue', 'game/audit'].includes(route)) {
            rate('game-read:' + principal.childId, 180);
            const gp = gamePrincipal();
            const result = route === 'game' ? { game: gameView() } :
              route === 'game/catalogue' ? { catalogue: publicGameCatalogue(gameStore.catalogue(gp)) } : { events: publicGameAudit(gameStore.audit(gp)), history_limit: 100 };
            ensureLearning(); return reply({ ok: true, ...result });
          }
          if (request.method === 'POST' && ['game/monster', 'game/buy-monster', 'game/buy-cosmetic', 'game/shop-buy'].includes(route)) {
            rate('game-write:' + principal.childId, 60);
            const data = await body(request); ensureLearning(); childMatch(principal, data);
            const gp = gamePrincipal();
            if (route !== 'game/monster') { gameStore.refusePaidMonster(gp); throw new BoundaryError('monster_purchase_retired'); }
            const { child_id, ...change } = data, date = new Date(now()).toISOString();
            const result = gameStore.selectMonster(gp, change, date, ensureLearning);
            requireThat(result?.ok === true && typeof result.replayed === 'boolean', 'invalid_game_result');
            ensureLearning();
            const current = gameView();
            ensureLearning();
            return reply({ ok: result.ok, replayed: result.replayed, preferences: publicGamePreferences(result.preferences), current_game: current });
          }
          throw new BoundaryError('not_found');
        }
        if (route === 'library' || route.startsWith('library/')) {
          requireThat(libraryStore && familyStore, 'not_found'); ensureLearning();
          const libraryPrincipal = () => ({ ...s.familyPrincipal, childId: principal.childId });
          if (route === 'library' && request.method === 'GET') {
            const keys = [...url.searchParams.keys()], level = url.searchParams.get('level'), interest = url.searchParams.get('interest'), favoritesOnly = url.searchParams.get('favorites');
            requireThat(new Set(keys).size === keys.length && keys.every(k => ['level', 'interest', 'favorites'].includes(k)) &&
              (!keys.includes('level') || /^L[0-5]$/.test(level)) && (!keys.includes('interest') || interestGroups.some(g => g.id === interest)) &&
              (!keys.includes('favorites') || favoritesOnly === '1'), 'invalid_request');
            const library = publicLibrary(libraryStore.view(libraryPrincipal())), favorites = new Set(library.favorites.map(f => f.lesson_id));
            const interestByTheme = new Map(interestGroups.flatMap(g => g.themes.map(theme => [theme, g.id])));
            const cards = [...currentContent(s).values()].filter(l => (!level || l.level === level) && (!interest || interestByTheme.get(l.theme) === interest) && (!favoritesOnly || favorites.has(l.id)))
              .map(l => ({ ...card(l), interest_id: interestByTheme.get(l.theme) }));
            return reply({ ok: true, library, lessons: cards, sessions: store.history(principal, principal.childId).map(publicCheckpoint), filters: { level, interest, favorites_only: favoritesOnly === '1' } });
          }
          if (route === 'library/history' && request.method === 'GET') {
            const keys = [...url.searchParams.keys()], kind = url.searchParams.get('kind'), before = url.searchParams.get('before');
            requireThat(new Set(keys).size === keys.length && keys.every(k => ['kind', 'before'].includes(k)) &&
              ['practice', 'reading'].includes(kind) && (before === null || validId(before)), 'invalid_request');
            const page = kind === 'practice' ? store.historyPage(principal, principal.childId, before) : libraryStore.historyPage(libraryPrincipal(), before);
            ensureLearning();
            return reply({ ok: true, child_id: principal.childId, kind, entries: page.entries.map(kind === 'practice' ? publicPracticeHistory : publicReading),
              next_before: page.next_before, page_size: 20, order: 'created_desc' });
          }
          if (route === 'library/reading' && request.method === 'GET') {
            requireThat([...url.searchParams.keys()].length === 1 && validId(url.searchParams.get('reading_id')), 'invalid_request');
            return reply({ ok: true, view: await viewReading(libraryStore.reading(libraryPrincipal(), url.searchParams.get('reading_id')), ensureLearning) });
          }
          if (['library/interests', 'library/favorite', 'library/open', 'library/position'].includes(route) && request.method === 'POST' && !url.search) {
            rate('library:' + principal.childId, 60);
            const data = await body(request); ensureLearning(); childMatch(principal, data);
            const { child_id, ...change } = data, lp = libraryPrincipal(), date = new Date(now()).toISOString();
            const result = route === 'library/interests' ? libraryStore.setInterests(lp, change, date) :
              route === 'library/favorite' ? libraryStore.setFavorite(lp, change, date) :
              route === 'library/open' ? libraryStore.openReading(lp, change, date) : libraryStore.updateReading(lp, change, date);
            // Exact receipt is separate from current state; a replay cannot rewind the client.
            return reply({ ok: result.ok, replayed: result.replayed,
              ...(result.preferences ? { preferences: publicPreferences(result.preferences) } : {}),
              ...(route === 'library/favorite' ? { lesson_id: result.lesson_id, favorite: result.favorite } : {}),
              ...(result.reading ? { reading: publicReading(result.reading), current_view: await viewReading(libraryStore.reading(lp, result.reading.reading_id), ensureLearning) } : {}),
              library: publicLibrary(libraryStore.view(lp)) });
          }
          throw new BoundaryError('not_found');
        }
        if (['lessons', 'start', 'session', 'event', 'dialogue'].includes(route)) ensureLearning();
        if (route === 'lessons' && request.method === 'GET') {
          const keys = [...url.searchParams.keys()], level = url.searchParams.get('level');
          requireThat(keys.length === 0 || (keys.length === 1 && keys[0] === 'level' && /^L[0-5]$/.test(level)), 'invalid_request');
          return reply({ ok: true, lessons: [...currentContent(s).values()].filter(l => !level || l.level === level).map(card), sessions: store.history(principal, s.childId).map(publicCheckpoint) });
        }
        if (route === 'start' && request.method === 'POST' && !url.search) {
          const data = await body(request); ensureLearning(); childMatch(principal, data);
          requireThat(exact(data, ['request_id', 'child_id', 'lesson_id']) && validId(data.request_id) && validId(data.lesson_id), 'invalid_request');
          let lesson;
          const raw = new TextEncoder().encode(JSON.stringify([s.childId, data.request_id]));
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), b => b.toString(16).padStart(2, '0')).join('');
          ensureLearning();
          const sessionId = 'session-' + hash;
          try {
            const old = currentRecord(principal, sessionId);
            requireThat(old.lesson.id === data.lesson_id, 'request_conflict'); lesson = old.lesson;
          } catch (e) { if (e.code !== 'session_missing') throw e; }
          if (!lesson) { lesson = currentContent(s).get(data.lesson_id); requireThat(lesson, libraryStore ? 'content_unavailable' : 'lesson_missing'); }
          const publisherPackage = publisherRuntime?.owns(lesson.id) ? publisherRuntime.packageFor(lesson) : undefined;
          const result = await store.start(principal, { sessionId, childId: principal.childId, lesson, publisherPackage, now: new Date(now()).toISOString(), apiVersion: publisherPackage ? '1.3' : '1.2' }, ensureLearning);
          ensureLearning();
          return reply({ ok: result.ok, session: publicCheckpoint(result.session), replayed: result.replayed, view: await viewSession(currentRecord(principal, sessionId), ensureLearning), wallet: store.wallet(principal, s.childId) });
        }
        if (route === 'session' && request.method === 'GET') {
          const id = queryId(url); return reply({ ok: true, view: await viewSession(currentRecord(principal, id), ensureLearning), wallet: store.wallet(principal, s.childId) });
        }
        if (route === 'event' && request.method === 'POST' && !url.search) {
          const data = await body(request); ensureLearning(); childMatch(principal, data);
          const eventAuthority = () => { const profile = ensureLearning(); if (familyStore && data?.payload?.capture_status === 'valid') requireThat(profile.recording_allowed, 'recording_disabled'); };
          eventAuthority();
          const result = store.submit(principal, data, new Date(now()).toISOString(), eventAuthority);
          // Original receipt remains unchanged; current_view explicitly labels later acknowledged progress.
          return reply({ ok: result.ok, request_id: result.request_id, session: publicCheckpoint(result.session), replayed: result.replayed, current_view: await viewSession(currentRecord(principal, data.session_id), ensureLearning), wallet: store.wallet(principal, s.childId) });
        }
        if (route === 'dialogue' && request.method === 'GET') {
          const record = currentRecord(principal, queryId(url));
          requireThat(record.session.stage === 'mini_story' && record.session.status === 'active', 'invalid_transition');
          const dialogue = await voice.dialogue({ lesson: record.lesson, cursor: record.session.dialogue_cursor });
          ensureLearning(); currentRecord(principal, record.session.session_id); return reply({ ok: true, dialogue });
        }
        throw new BoundaryError('not_found');
      } catch (error) {
        counts.errors++;
        const code = Object.hasOwn(CODES, error?.code) ? error.code : 'temporarily_unavailable';
        return reply({ ok: false, code }, CODES[code] || 503);
      }
    },
  };
}
