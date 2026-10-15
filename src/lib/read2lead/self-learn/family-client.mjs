/** Family mutations keep payloads only in memory; durable storage receives an opaque request ID only. */
import { ApiError } from './api-client.mjs';
import { validId } from './session-contract.mjs';
const routes = new Set(['recover', 'parent/create-child', 'parent/update-child']);
const keyFor = (route, scope) => {
  if (!routes.has(route) || !validId(scope)) throw new ApiError('invalid_route');
  return 'r2l-family-request:' + route + ':' + scope;
};
export class FamilyClient {
  #pending = null; #busy = false; #epoch = 0;
  constructor({ api, storage, id = () => 'family-' + crypto.randomUUID() }) { Object.assign(this, { api, storage, id }); }
  get pending() { return this.#pending ? { route: this.#pending.route, scope: this.#pending.scope } : null; }
  unfinished(route, scope) { try { return validId(this.storage?.getItem(keyFor(route, scope))); } catch { return false; } }
  async submit(route, scope, data) {
    if (this.#pending || this.#busy) throw new ApiError('family_pending');
    const key = keyFor(route, scope); let request;
    try { request = this.storage?.getItem(key); } catch { /* Memory-only fallback remains safe until reload. */ }
    if (!validId(request)) request = this.id();
    if (!validId(request) || Object.hasOwn(data, 'request_id')) throw new ApiError('invalid_request');
    try { this.storage?.setItem(key, request); } catch { /* Never persist the submitted data. */ }
    this.#pending = { route, scope, key, data: { ...structuredClone(data), request_id: request } };
    return this.retry();
  }
  async retry() {
    if (this.#busy) throw new ApiError('operation_busy');
    if (!this.#pending) throw new ApiError('family_request_missing');
    const pending = this.#pending, epoch = this.#epoch; this.#busy = true;
    try {
      const result = await this.api.request(pending.route, structuredClone(pending.data));
      if (epoch !== this.#epoch) throw new ApiError('family_scope_expired');
      try { this.storage?.removeItem(pending.key); } catch { /* A stale ID can only replay, not duplicate. */ }
      this.#pending = null; return result;
    } catch (e) {
      // Definitive validation/auth refusal cannot be retried with edited data under an uncertain operation.
      // Keep its ID for request_conflict: user must reconcile before starting a new operation.
      if (epoch === this.#epoch && e.status >= 400 && e.status < 500 && e.status !== 429) {
        if (e.code !== 'request_conflict') { try { this.storage?.removeItem(pending.key); } catch {} }
        this.#pending = null;
      }
      throw e;
    } finally { if (epoch === this.#epoch) this.#busy = false; }
  }
  clear(route, scope) {
    if (this.#busy) throw new ApiError('operation_busy');
    const key = keyFor(route, scope);
    if (this.#pending && this.#pending.key !== key) throw new ApiError('family_pending');
    try { this.storage?.removeItem(key); } catch {}
    this.#pending = null; this.#epoch++;
  }
  forgetPayload() { this.#epoch++; this.#pending = null; this.#busy = false; }
}
