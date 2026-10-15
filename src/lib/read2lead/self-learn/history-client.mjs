/** Read-only paged history, scoped to one child and one mounted library. No local persistence. */
import { ApiError } from './api-client.mjs';
import { validId } from './session-contract.mjs';
const requireThat = (ok, code) => { if (!ok) throw new ApiError(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const common = ['child_id','lesson_id','title_en','level','content_version','content_sha256','revision','created_at','updated_at'];
const keys = { practice: ['session_id',...common,'stage','status'], reading: ['reading_id',...common,'sentence_id','marked_finished','evidence_kind','rewards_awarded'] };
const idKey = kind => kind === 'practice' ? 'session_id' : 'reading_id';
const fresh = () => ({ entries: [], next_before: null, loaded: false, loading: false, failed: false, retry_from_start: true, generation: 0 });
function validEntry(entry, kind, childId) {
  return exact(entry, keys[kind]) && entry.child_id === childId && validId(entry[idKey(kind)]) && validId(entry.lesson_id) &&
    typeof entry.title_en === 'string' && entry.title_en.length > 0 && entry.title_en.length <= 1000 && /^L[0-5]$/.test(entry.level) &&
    typeof entry.content_version === 'string' && /^\d+\.\d+\.\d+$/.test(entry.content_version) && /^[a-f0-9]{64}$/.test(entry.content_sha256) &&
    Number.isSafeInteger(entry.revision) && entry.revision >= 0 && ['created_at','updated_at'].every(k => typeof entry[k] === 'string' && Number.isFinite(Date.parse(entry[k]))) &&
    (kind === 'practice' ? ['active','complete'].includes(entry.status) && validId(entry.stage) :
      validId(entry.sentence_id) && typeof entry.marked_finished === 'boolean' && entry.evidence_kind === 'self_reported_free_reading' && entry.rewards_awarded === false);
}
export class HistoryClient {
  #active = true; #pages = { practice: fresh(), reading: fresh() };
  constructor({api, childId}) { requireThat(validId(childId), 'wrong_child'); this.api = api; this.childId = childId; }
  #kind(kind) { requireThat(kind === 'practice' || kind === 'reading', 'invalid_request'); }
  page(kind) { this.#kind(kind); const {generation,...page} = this.#pages[kind]; return structuredClone(page); }
  deactivate() { this.#active = false; }
  #current(kind, generation) { requireThat(this.#active && this.#pages[kind].generation === generation, 'history_scope_expired'); }
  async #live(kind, generation) {
    this.#current(kind, generation); const access = await this.api.request('me'); this.#current(kind, generation);
    requireThat(access.csrf === this.api.csrf, 'csrf_failed');
    requireThat(access.active_child_id !== null, 'child_access_disabled');
    requireThat(access.active_child_id === this.childId, 'wrong_child');
  }
  refresh(kind) { return this.#load(kind, true); }
  more(kind) { return this.#load(kind, false); }
  async #load(kind, reset) {
    this.#kind(kind); requireThat(this.#active, 'history_scope_expired'); const page = this.#pages[kind];
    if (!reset) { requireThat(!page.loading, 'operation_busy'); if (page.loaded && page.next_before === null) return this.page(kind); }
    const before = reset || !page.loaded ? null : page.next_before, generation = ++page.generation;
    page.loading = true; page.failed = false; page.retry_from_start = before === null;
    try {
      await this.#live(kind, generation);
      const query = new URLSearchParams({kind}); if (before !== null) query.set('before', before);
      const result = await this.api.request('library/history?' + query);
      await this.#live(kind, generation);
      requireThat(exact(result,['ok','child_id','kind','entries','next_before','page_size','order']) && result.ok === true &&
        result.child_id === this.childId && result.kind === kind && result.page_size === 20 && result.order === 'created_desc' &&
        Array.isArray(result.entries) && result.entries.length <= 20 && result.entries.every(e => validEntry(e,kind,this.childId)), 'invalid_response');
      const key = idKey(kind), ids = result.entries.map(e => e[key]);
      requireThat(new Set(ids).size === ids.length && (result.next_before === null ||
        result.entries.length === 20 && result.next_before === ids.at(-1) && result.next_before !== before), 'invalid_response');
      const prior = new Map(page.entries.map(e => [e[key],e]));
      const received = result.entries.map(entry => {
        const old = prior.get(entry[key]);
        requireThat(before === null || !old, 'invalid_response');
        requireThat(!old || ['lesson_id','content_version','content_sha256','title_en','level','created_at'].every(k => old[k] === entry[k]), 'invalid_response');
        return structuredClone(old && old.revision > entry.revision ? old : entry);
      });
      page.entries = before === null ? received : [...page.entries,...received];
      page.next_before = result.next_before; page.loaded = true; return { ...this.page(kind), loading: false };
    } catch (error) {
      if (this.#active && page.generation === generation) page.failed = true;
      if (['connection_lost','request_timeout'].includes(error.code)) throw new ApiError('history_load_failed', error.status);
      throw error;
    } finally { if (page.generation === generation) page.loading = false; }
  }
}
