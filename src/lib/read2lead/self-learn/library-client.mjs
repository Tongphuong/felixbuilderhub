/** One exact library request per child/tab. No credential, name, answer or audio fields are permitted. */
import { ApiError } from './api-client.mjs';
import { validId } from './session-contract.mjs';
const routes = new Set(['library/interests', 'library/favorite', 'library/open', 'library/position']);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const requireThat = (value, code) => { if (!value) throw new ApiError(code); };
const keyFor = child => { requireThat(validId(child), 'wrong_child'); return 'r2l-library-pending:' + child; };
function validRequest(route, data, childId) {
  if (!routes.has(route) || !validId(data?.request_id) || data?.child_id !== childId) return false;
  const common = ['request_id', 'child_id'];
  if (route === 'library/open') return exact(data, [...common, 'lesson_id']) && validId(data.lesson_id);
  if (!revision(data.expected_revision)) return false;
  if (route === 'library/interests') return exact(data, [...common, 'expected_revision', 'interest_ids']) && Array.isArray(data.interest_ids) && data.interest_ids.length <= 3 && data.interest_ids.every(validId) && new Set(data.interest_ids).size === data.interest_ids.length;
  if (route === 'library/favorite') return exact(data, [...common, 'expected_revision', 'lesson_id', 'favorite']) && validId(data.lesson_id) && typeof data.favorite === 'boolean';
  return exact(data, [...common, 'reading_id', 'expected_revision', 'sentence_id', 'marked_finished']) && validId(data.reading_id) && validId(data.sentence_id) && typeof data.marked_finished === 'boolean';
}
export class LibraryClient {
  #pending = null; #pendingRaw = null; #invalidRaw = null; #busy = false; #epoch = 0; #active = true; #library = null; #view = null; #reconciled = false;
  constructor({ api, storage, childId, id = () => 'library-' + crypto.randomUUID() }) {
    Object.assign(this, { api, storage, childId, id }); this.key = keyFor(childId);
    let raw;
    try { requireThat(storage && typeof storage.getItem === 'function', 'storage_unavailable'); raw = storage.getItem(this.key); }
    catch { throw new ApiError('storage_unavailable'); }
    if (raw !== null) {
      let saved; try { saved = JSON.parse(raw); } catch { /* Keep the original record for explicit recovery after reconciliation. */ }
      if (exact(saved, ['format', 'route', 'data']) && saved.format === 1 && validRequest(saved.route, saved.data, childId)) { this.#pending = saved; this.#pendingRaw = raw; }
      else this.#invalidRaw = raw;
    }
  }
  get pending() { return this.#pending ? structuredClone(this.#pending) : null; }
  get storageInvalid() { return this.#invalidRaw !== null; }
  get library() { return this.#library ? structuredClone(this.#library) : null; }
  get view() { return this.#view ? structuredClone(this.#view) : null; }
  get reconciled() { return this.#reconciled; }
  deactivate() { this.#active = false; this.#epoch++; }
  #current(epoch = this.#epoch) { requireThat(this.#active && epoch === this.#epoch, 'library_scope_expired'); }
  async #live(epoch) {
    this.#current(epoch); const access = await this.api.request('me'); this.#current(epoch);
    requireThat(access.csrf === this.api.csrf, 'csrf_failed');
    requireThat(access.active_child_id !== null, 'child_access_disabled');
    requireThat(access.active_child_id === this.childId, 'wrong_child'); return access;
  }
  #savePending(saved) {
    const raw = JSON.stringify(saved);
    try {
      requireThat(this.storage.getItem(this.key) === null, 'library_pending_changed');
      this.storage.setItem(this.key, raw);
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('storage_unavailable'); }
    this.#pending = saved; this.#pendingRaw = raw; this.#reconciled = false;
  }
  #clearPending() {
    try {
      const current = this.storage.getItem(this.key);
      requireThat(current === (this.#invalidRaw ?? this.#pendingRaw), 'library_pending_changed');
      this.storage.removeItem(this.key);
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('storage_unavailable'); }
    this.#pending = null; this.#pendingRaw = null; this.#invalidRaw = null; this.#reconciled = false;
  }
  #acceptLibrary(library) {
    requireThat(library?.child_id === this.childId && revision(library.preferences?.revision) && Array.isArray(library.preferences.interest_ids) &&
      Array.isArray(library.groups) && Array.isArray(library.favorites) && Array.isArray(library.suggestions) && Array.isArray(library.reading_history) && library.reading_history.every(r => r.child_id === this.childId), 'invalid_response');
    const candidate = structuredClone(!this.#library || library.preferences.revision >= this.#library.preferences.revision ? library : this.#library);
    const history = new Map((this.#library?.reading_history || []).map(r => [r.reading_id, r]));
    for (const reading of library.reading_history) {
      const old = history.get(reading.reading_id);
      requireThat(!old || old.content_sha256 === reading.content_sha256, 'invalid_response');
      if (!old || reading.revision >= old.revision) history.set(reading.reading_id, structuredClone(reading));
    }
    candidate.reading_history = [...history.values()].sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)) || a.reading_id.localeCompare(b.reading_id)).slice(0,100);
    this.#library = candidate;
  }
  #acceptView(view) {
    const reading = view?.reading;
    requireThat(reading?.child_id === this.childId && validId(reading.reading_id) && revision(reading.revision) && reading.lesson_id === view.lesson?.id &&
      /^[a-f0-9]{64}$/.test(reading.content_sha256) && Array.isArray(view.lesson.story?.sentences) && Array.isArray(view.lesson.illustrations) && Array.isArray(view.lesson.input?.break_after_sentence_ids), 'invalid_response');
    if (this.#view?.reading.reading_id === reading.reading_id) {
      requireThat(this.#view.reading.content_sha256 === reading.content_sha256, 'invalid_response');
      if (reading.revision < this.#view.reading.revision) return;
    }
    this.#view = structuredClone(view);
  }
  async refresh(route = 'library') {
    this.#current(); const epoch = this.#epoch; await this.#live(epoch);
    requireThat(route === 'library' || route.startsWith('library?'), 'invalid_route');
    const result = await this.api.request(route); await this.#live(epoch);
    this.#acceptLibrary(result.library); this.#reconciled = !!this.#pending || this.storageInvalid;
    return { ...result, library: this.library };
  }
  async openSaved(readingId) {
    this.#current(); requireThat(validId(readingId), 'invalid_request'); const epoch = this.#epoch; await this.#live(epoch);
    const result = await this.api.request('library/reading?reading_id=' + readingId); await this.#live(epoch);
    this.#acceptView(result.view); return this.view;
  }
  async submit(route, data) {
    this.#current(); requireThat(!this.storageInvalid, 'library_storage_invalid'); requireThat(!this.#busy && !this.#pending, 'library_pending');
    requireThat(data && typeof data === 'object' && !Array.isArray(data) && !Object.hasOwn(data, 'request_id') && !Object.hasOwn(data, 'child_id'), 'invalid_request');
    const payload = { ...structuredClone(data), child_id: this.childId, request_id: this.id() };
    requireThat(validRequest(route, payload, this.childId), 'invalid_request');
    this.#savePending({ format: 1, route, data: payload }); return this.retry();
  }
  async retry() {
    this.#current(); requireThat(!this.storageInvalid, 'library_storage_invalid'); requireThat(!this.#busy, 'operation_busy'); requireThat(this.#pending, 'library_request_missing');
    const saved = this.#pending, epoch = this.#epoch; this.#busy = true;
    try {
      await this.#live(epoch);
      const result = await this.api.request(saved.route, structuredClone(saved.data)); await this.#live(epoch);
      requireThat(result?.ok === true && typeof result.replayed === 'boolean', 'invalid_response');
      this.#acceptLibrary(result.library);
      if (['library/open', 'library/position'].includes(saved.route)) {
        requireThat(result.reading?.child_id === this.childId && result.reading.reading_id === result.current_view?.reading?.reading_id, 'invalid_response');
        this.#acceptView(result.current_view);
      }
      this.#clearPending(); return { ...result, library: this.library, ...(result.current_view ? { current_view: this.view } : {}) };
    } catch (error) {
      if (this.#active && epoch === this.#epoch && [400, 404, 405, 413, 415].includes(error.status)) this.#clearPending();
      throw error;
    } finally { if (epoch === this.#epoch) this.#busy = false; }
  }
  async discard() {
    this.#current(); requireThat(!this.#busy, 'operation_busy'); requireThat((this.#pending || this.storageInvalid) && this.#reconciled, 'library_reconcile_required');
    this.#busy = true;
    try { await this.refresh(); this.#clearPending(); } finally { this.#busy = false; }
  }
  static clearOnLogout(storage, childId) {
    try { storage?.removeItem(keyFor(childId)); } catch { throw new ApiError('storage_unavailable'); }
  }
}
