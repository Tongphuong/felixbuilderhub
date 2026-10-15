/** Synthetic editor transport and per-tab recovery. No automatic network retry or stored credentials. */
import { validId } from './session-contract.mjs';
const writes = new Set(['draft', 'request-review', 'review', 'publish-qa', 'quarantine']);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const revision = n => Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER;
const bytes = text => new TextEncoder().encode(text).length;
export class EditorError extends Error {
  constructor(code, status = 0, issues = []) { super(code); this.code = code; this.status = status; this.issues = structuredClone(issues); }
}
const requireThat = (ok, code) => { if (!ok) throw new EditorError(code); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function validRoute(route, post) {
  if (post) return ['login', 'logout', ...writes, 'publisher-review-plan', 'publisher-import-plan', 'publisher-catalogue-plan', 'publisher-apply', 'publisher-withdraw'].includes(route);
  if (['publisher-documents','publisher-catalogue'].includes(route) || /^publisher-documents\?cursor=(0|[1-9][0-9]*)$/.test(route)) return true;
  if (route.startsWith('publisher-document?')) { const q = new URLSearchParams(route.slice(19)); return [...q.keys()].length === 2 && validId(q.get('source_id')) && /^1\.2\.[1-9][0-9]*$/.test(q.get('version') || '') && q.get('version').length <= 32 && q.has('source_id') && q.has('version'); }
  if (['me', 'documents', 'templates', 'catalogue', 'audit'].includes(route)) return true;
  return /^(?:document|audit)\?lesson_id=[a-zA-Z0-9._:-]+$/.test(route) && validId(route.split('=')[1]);
}
export class EditorApi {
  constructor({ fetcher = globalThis.fetch.bind(globalThis), timeoutMs = 10000 } = {}) {
    requireThat(typeof fetcher === 'function' && Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30000, 'invalid_config');
    Object.assign(this, { fetcher, timeoutMs }); this.csrf = null;
  }
  async request(route, data) {
    const post = data !== undefined; requireThat(typeof route === 'string' && validRoute(route, post), 'invalid_route');
    let body;
    if (post) { try { body = JSON.stringify(data); } catch { throw new EditorError('invalid_request'); } requireThat(typeof body === 'string' && bytes(body) <= (route.startsWith('publisher-') ? 2097152 : 270336), 'editor_input_limit'); }
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher('/api/read2lead/editor/' + route, { method: post ? 'POST' : 'GET', credentials: 'same-origin', mode: 'cors', redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json', ...(this.csrf ? { 'X-R2L-Editor-CSRF': this.csrf } : {}) } : {}) }, ...(post ? { body } : {}) });
      requireThat(response.headers.get('content-type')?.startsWith('application/json'), 'invalid_response');
      let value; try { value = await response.json(); } catch { throw new EditorError('invalid_response', response.status); }
      if (!response.ok || value?.ok !== true) throw new EditorError(typeof value?.code === 'string' ? value.code : 'invalid_response', response.status, Array.isArray(value?.issues) ? value.issues.slice(0, 100) : []);
      return value;
    } catch (error) { if (error instanceof EditorError) throw error; throw new EditorError(abort.signal.aborted ? 'request_timeout' : 'connection_lost'); }
    finally { clearTimeout(timer); }
  }
}
function validDraft(d) { return d === null || exact(d, ['text', 'lesson_id', 'expected_revision']) && typeof d.text === 'string' && bytes(d.text) <= 262144 && (d.lesson_id === null || validId(d.lesson_id)) && revision(d.expected_revision); }
function validOperation(p) {
  if (p === null) return true;
  if (!exact(p, ['route', 'data']) || !writes.has(p.route) || !validId(p.data?.request_id) || !revision(p.data.expected_revision)) return false;
  const d = p.data, common = ['request_id', 'expected_revision'];
  if (p.route === 'draft') return exact(d, [...common, 'lesson']) && object(d.lesson) && validId(d.lesson.id) && bytes(JSON.stringify(d)) <= 270336;
  if (!validId(d.lesson_id)) return false;
  if (['request-review', 'publish-qa'].includes(p.route)) return exact(d, [...common, 'lesson_id']);
  if (p.route === 'review') return exact(d, [...common, 'lesson_id', 'decision', 'note']) && ['qa_ready', 'changes_requested'].includes(d.decision) && typeof d.note === 'string' && d.note.trim().length > 0 && d.note.length <= 1000;
  return exact(d, [...common, 'lesson_id', 'content_revision', 'blocked', 'reason']) && revision(d.content_revision) && d.content_revision > 0 && typeof d.blocked === 'boolean' && typeof d.reason === 'string' && d.reason.trim().length > 0 && d.reason.length <= 1000;
}
function validRow(v, editor) { return exact(v, ['format', 'editor_id', 'draft', 'pending']) && v.format === 1 && v.editor_id === editor && validDraft(v.draft) && validOperation(v.pending); }
/** One authenticated editor per instance. Construct only after online login/me succeeds. */
export class EditorClient {
  #row; #csrf; #raw = null; #invalid = false; #active = true; #epoch = 0; #busy = false; #reconciled = false; #views = new Map();
  constructor({ api, storage, access, id = () => 'editor-' + crypto.randomUUID() }) {
    requireThat(access?.role === 'editor' && validId(access.editor_id) && typeof access.csrf === 'string' && access.csrf === api?.csrf, 'editor_required');
    Object.assign(this, { api, storage, editorId: access.editor_id, id }); this.#csrf = access.csrf; this.key = (access.environment==='private-local'?'r2l-editor-private:':'r2l-editor-local:') + this.editorId;
    this.#row = { format: 1, editor_id: this.editorId, draft: null, pending: null };
    try { this.#raw = storage.getItem(this.key); } catch { throw new EditorError('storage_unavailable'); }
    if (this.#raw !== null) {
      let saved; try { if (this.#raw.length <= 600000) saved = JSON.parse(this.#raw); } catch { /* Retain malformed storage for explicit recovery. */ }
      if (validRow(saved, this.editorId)) this.#row = saved; else this.#invalid = true;
    }
  }
  get draft() { return this.#active ? structuredClone(this.#row.draft) : null; }
  get pending() { return this.#active ? structuredClone(this.#row.pending) : null; }
  get storageInvalid() { return this.#invalid; }
  get reconciled() { return this.#reconciled; }
  get busy() { return this.#busy; }
  deactivate() { this.#active = false; this.#epoch++; this.#views.clear(); }
  #current(epoch = this.#epoch) { requireThat(this.#active && this.#epoch === epoch, 'editor_scope_expired'); }
  #idle() { this.#current(); requireThat(!this.#busy, 'operation_busy'); }
  #write(row) {
    const raw = row.draft === null && row.pending === null ? null : JSON.stringify(row);
    try {
      requireThat(this.storage.getItem(this.key) === this.#raw, 'editor_storage_changed');
      if (raw === null) this.storage.removeItem(this.key); else this.storage.setItem(this.key, raw);
    } catch (error) { if (error instanceof EditorError) throw error; throw new EditorError('storage_unavailable'); }
    this.#row = structuredClone(row); this.#raw = raw; this.#invalid = false; this.#reconciled = false;
  }
  saveDraftText(draft) { this.#idle(); requireThat(!this.#invalid, 'editor_storage_invalid'); requireThat(!this.#row.pending, 'editor_pending'); requireThat(validDraft(draft), 'invalid_editor_draft'); this.#write({ ...this.#row, draft: structuredClone(draft) }); }
  async #live(epoch) {
    this.#current(epoch); requireThat(this.api.csrf === this.#csrf, 'csrf_failed'); const access = await this.api.request('me'); this.#current(epoch);
    requireThat(access.role === 'editor' && access.editor_id === this.editorId, 'editor_required'); requireThat(access.csrf === this.#csrf && this.api.csrf === this.#csrf, 'csrf_failed'); return access;
  }
  #accept(view, expectedId) {
    requireThat(view?.document?.lesson_id === expectedId && view.lesson?.id === expectedId && revision(view.document.revision) && view.document.revision > 0 && Array.isArray(view.revisions) && Array.isArray(view.reviews) && Array.isArray(view.blocks), 'invalid_response');
    const previous = this.#views.get(expectedId);
    if (!previous || view.document.revision >= previous.document.revision) this.#views.set(expectedId, structuredClone(view));
    return structuredClone(this.#views.get(expectedId));
  }
  async read(route) {
    this.#idle(); requireThat(validRoute(route, false), 'invalid_route'); const epoch = this.#epoch; this.#busy = true;
    try {
      await this.#live(epoch); const result = await this.api.request(route); await this.#live(epoch);
      if (route.startsWith('document?')) return { ...result, current_view: this.#accept(result.current_view, route.split('=')[1]) };
      return result;
    } finally { if (epoch === this.#epoch) this.#busy = false; }
  }
  async submit(route, data) {
    this.#idle(); requireThat(!this.#invalid, 'editor_storage_invalid'); requireThat(!this.#row.pending, 'editor_pending');
    requireThat(object(data) && !Object.hasOwn(data, 'request_id'), 'invalid_request');
    const pending = { route, data: { ...structuredClone(data), request_id: this.id() } }; requireThat(validOperation(pending), 'invalid_request');
    this.#write({ ...this.#row, pending }); return this.retry();
  }
  async retry() {
    this.#idle(); requireThat(!this.#invalid, 'editor_storage_invalid'); requireThat(this.#row.pending, 'editor_request_missing');
    const saved = structuredClone(this.#row.pending), epoch = this.#epoch; this.#busy = true;
    try {
      await this.#live(epoch); const result = await this.api.request(saved.route, structuredClone(saved.data)); await this.#live(epoch);
      const lessonId = saved.route === 'draft' ? saved.data.lesson.id : saved.data.lesson_id;
      requireThat(result?.ok === true && typeof result.replayed === 'boolean' && result.document?.lesson_id === lessonId && revision(result.document.revision) && result.current_view?.document?.revision >= result.document.revision, 'invalid_response');
      const current = this.#accept(result.current_view, lessonId); this.#write({ ...this.#row, pending: null });
      return { ...result, current_view: current }; // Original receipt remains separate from current state; draft text is never replaced here.
    } catch (error) {
      if (this.#active && this.#epoch === epoch && [400, 404, 405, 413, 415].includes(error.status)) this.#write({ ...this.#row, pending: null });
      throw error;
    } finally { if (epoch === this.#epoch) this.#busy = false; }
  }
  async #snapshot(epoch) {
    await this.#live(epoch); const result = await this.api.request('documents'); await this.#live(epoch);
    requireThat(Array.isArray(result.documents) && result.documents.every(d => validId(d.lesson_id) && revision(d.revision)), 'invalid_response');
    const pending = this.#row.pending, id = pending?.route === 'draft' ? pending.data.lesson.id : pending?.data.lesson_id;
    let current = null;
    if (id && result.documents.some(d => d.lesson_id === id)) {
      const response = await this.api.request('document?lesson_id=' + id); await this.#live(epoch); current = this.#accept(response.current_view, id);
    }
    return { ...result, current_view: current };
  }
  async reconcile() {
    this.#idle(); const epoch = this.#epoch; this.#busy = true;
    try { const result = await this.#snapshot(epoch); this.#reconciled = true; return result; }
    finally { if (epoch === this.#epoch) this.#busy = false; }
  }
  async discardPending() {
    this.#idle(); requireThat((this.#row.pending || this.#invalid) && this.#reconciled, 'editor_reconcile_required'); const epoch = this.#epoch; this.#busy = true;
    try { const result = await this.#snapshot(epoch); this.#write({ ...this.#row, pending: null }); return result; }
    finally { if (epoch === this.#epoch) this.#busy = false; }
  }
}
