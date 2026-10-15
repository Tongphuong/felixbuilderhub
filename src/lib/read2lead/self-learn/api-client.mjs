/** Same-origin transport and acknowledged/pending coordination. No offline authentication. */
import { validId } from './session-contract.mjs';
function libraryRoute(route) {
  if (route.startsWith('library/history?')) {
    if (!/^library\/history\?[a-zA-Z0-9._:%=&-]+$/.test(route)) return false;
    const query = new URLSearchParams(route.slice('library/history?'.length)), keys = [...query.keys()];
    return keys.length >= 1 && keys.length <= 2 && new Set(keys).size === keys.length &&
      keys.every(key => ['kind','before'].includes(key)) && ['practice','reading'].includes(query.get('kind')) &&
      (!query.has('before') || validId(query.get('before')));
  }

  if (['library', 'library/interests', 'library/favorite', 'library/open', 'library/position'].includes(route)) return true;
  if (route.startsWith('library/reading?reading_id=')) return validId(route.slice('library/reading?reading_id='.length));
  if (!route.startsWith('library?') || !/^library\?[a-zA-Z0-9=&-]+$/.test(route)) return false;
  const query = new URLSearchParams(route.slice(8)), keys = [...query.keys()];
  return keys.length > 0 && keys.length <= 3 && new Set(keys).size === keys.length && keys.every(key =>
    key === 'level' ? /^L[0-5]$/.test(query.get(key)) : key === 'interest' ? ['nature', 'together', 'everyday', 'create', 'community', 'investigate'].includes(query.get(key)) : key === 'favorites' && query.get(key) === '1');
}
export class ApiError extends Error { constructor(code, status = 0) { super(code); this.code = code; this.status = status; } }
export class ApiClient {
  constructor({ fetcher = globalThis.fetch.bind(globalThis), timeoutMs = 10000 } = {}) { this.fetcher = fetcher; this.timeoutMs = timeoutMs; this.csrf = null; }
  async request(route, data) {
    if (typeof route === 'string' && route.startsWith('library/history?') && data !== undefined) throw new ApiError('invalid_route');
    if (typeof route !== 'string' || (!libraryRoute(route) && !/^(?:gifts(?:\/(?:goal|redeem))?|game(?:\/(?:catalogue|audit|monster))?|login|logout|me|child|recover|parent\/(?:enter|exit|family|audit|create-child|update-child)|lessons(?:\?level=L[0-5])?|start|event|(?:session|dialogue)\?session_id=[a-zA-Z0-9._:-]+)$/.test(route))) throw new ApiError('invalid_route');
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher('/api/read2lead/self-learn/' + route, { method: data === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', mode: 'cors', redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json', ...(this.csrf ? { 'X-R2L-CSRF': this.csrf } : {}) }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('invalid_response', response.status);
      let result; try { result = await response.json(); } catch { throw new ApiError('invalid_response', response.status); }
      if (!response.ok || result?.ok !== true) throw new ApiError(typeof result?.code === 'string' ? result.code : 'invalid_response', response.status);
      return result;
    } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(abort.signal.aborted ? 'request_timeout' : 'connection_lost'); }
    finally { clearTimeout(timer); }
  }
}
/** An instance belongs to one authenticated child/session. Deactivate before navigating away. */
export class SessionClient {
  constructor({ api, cache, scope, view, onChange = () => {} }) {
    if (!validId(view?.session?.session_id) || view.session.child_id !== scope?.child_id) throw new ApiError('wrong_scope');
    Object.assign(this, { api, cache, scope, view, onChange }); this.row = null; this.active = true; this.busy = false;
  }
  deactivate() { this.active = false; }
  async accept(view, wallet) {
    if (!this.active) return false;
    if (view?.session?.session_id !== this.view.session.session_id || view?.session?.child_id !== this.scope.child_id) throw new ApiError('wrong_scope');
    const row = await this.cache.accept(this.scope, view.session);
    if (!this.active) return false;
    this.row = row;
    // A replay receipt or late read cannot rewind displayed questions, hints or balances.
    if (view.session.revision >= this.view.session.revision && view.session.revision >= row.acknowledged.revision) { this.view = view; if (wallet !== undefined) this.wallet = wallet; }
    this.onChange(); return true;
  }
  async refresh() { const r = await this.api.request('session?session_id=' + this.view.session.session_id); return this.accept(r.view, r.wallet); }
  async submit(event, payload) {
    if (!this.active || this.busy) throw new ApiError('operation_busy');
    this.busy = true;
    try {
      const s = this.view.session;
      this.row = await this.cache.enqueue(this.scope, { api_version: s.schema_version.slice(0, 3), request_id: 'event-' + crypto.randomUUID(), child_id: s.child_id, session_id: s.session_id, expected_revision: s.revision, event, payload });
      if (!this.active) return false;
      this.onChange(); return await this.sendPending();
    } catch (error) {
      if (this.active && ['stale_revision', 'pending_exists', 'already_acknowledged'].includes(error.code || error.message)) {
        this.row = await this.cache.read(this.scope, this.view.session.session_id);
        await this.refresh();
      }
      throw error;
    } finally { this.busy = false; }
  }
  async retry() {
    if (!this.active || this.busy) throw new ApiError('operation_busy');
    this.busy = true;
    try {
      this.row = await this.cache.read(this.scope, this.view.session.session_id);
      if (!this.row?.pending) { await this.refresh(); return false; }
      return await this.sendPending();
    }
    finally { this.busy = false; }
  }
  async sendPending() {
    if (!this.row?.pending || !this.active) return false;
    const event = structuredClone(this.row.pending);
    try {
      const response = await this.api.request('event', event);
      if (!this.active) return false;
      await this.cache.acknowledge(this.scope, response);
      if (!this.active) return false;
      await this.accept(response.current_view, response.wallet); return true;
    } catch (error) {
      if (this.active && ['stale_revision', 'invalid_transition', 'request_conflict'].includes(error.code)) await this.refresh();
      throw error;
    }
  }
  async discard() {
    if (!this.active || this.busy || this.row?.state !== 'conflict') throw new ApiError('reconciliation_required');
    this.row = await this.cache.discardPending(this.scope, this.view.session.session_id, this.row.pending.request_id); this.onChange();
  }
}
