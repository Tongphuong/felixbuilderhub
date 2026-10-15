/** Cache only. Server authentication, revision and scoring remain authoritative. Never stores audio. */
import { validId as id, canonical as stable } from './session-contract.mjs';
import { validStoreEvent as validEvent } from './publisher-session-contract.mjs';
const key = (child, session) => JSON.stringify([child, session]);
function validSnapshot(s) {
  return ['1.1.0', '1.2.0', '1.3.0'].includes(s?.schema_version) && id(s.child_id) && id(s.session_id) && Number.isSafeInteger(s.revision) && s.revision >= 0 && Array.isArray(s.acknowledged_request_ids) && s.acknowledged_request_ids.every(id);
}
export function openPendingStore({ indexedDB = globalThis.indexedDB, name = 'r2l-self-learn-v1' } = {}) {
  if (!indexedDB || !/^r2l-self-learn-[a-z0-9-]+$/.test(name)) return Promise.reject(new Error('storage_unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('scopes', { keyPath: 'child_id' });
      request.result.createObjectStore('entries', { keyPath: 'key' });
    };
    request.onerror = () => reject(new Error('storage_unavailable'));
    request.onblocked = () => reject(new Error('storage_blocked'));
    request.onsuccess = () => {
      const db = request.result; db.onversionchange = () => db.close();
      const transact = fn => new Promise((done, fail) => {
        let result, error;
        let tx;
        try { tx = db.transaction(['scopes', 'entries'], 'readwrite'); } catch { fail(new Error('storage_unavailable')); return; }
        const abort = e => { error = e; tx.abort(); };
        tx.oncomplete = () => done(structuredClone(result));
        tx.onabort = () => fail(error || new Error('storage_write_failed'));
        tx.onerror = () => { error ||= new Error('storage_write_failed'); };
        try { fn(tx, value => { result = value; }, abort); } catch (e) { abort(e); }
      });
      const withScope = (scope, session, fn) => {
        if (!id(scope?.child_id) || !Number.isSafeInteger(scope?.epoch) || !id(session)) return Promise.reject(new Error('invalid_scope'));
        return transact((tx, done, abort) => {
          const r = tx.objectStore('scopes').get(scope.child_id);
          r.onsuccess = () => {
            if (!r.result?.active || r.result.epoch !== scope.epoch) { abort(new Error('scope_expired')); return; }
            const store = tx.objectStore('entries'), read = store.get(key(scope.child_id, session));
            read.onsuccess = () => { try { fn(store, read.result, done); } catch (e) { abort(e); } };
          };
        });
      };
      const merge = (row, snapshot) => {
        if (row && snapshot.revision < row.acknowledged.revision) return row;
        if (row && snapshot.revision === row.acknowledged.revision && stable(snapshot) !== stable(row.acknowledged)) throw new Error('snapshot_conflict');
        const pending = row?.pending && !snapshot.acknowledged_request_ids.includes(row.pending.request_id) ? row.pending : null;
        return { key: key(snapshot.child_id, snapshot.session_id), child_id: snapshot.child_id, session_id: snapshot.session_id, acknowledged: structuredClone(snapshot), pending, state: pending ? (pending.expected_revision < snapshot.revision ? 'conflict' : 'pending') : 'acknowledged' };
      };
      resolve({
        /** Call only after server authentication. Activating a signed-out child creates a new generation. */
        activateChild(child) {
          if (!id(child)) return Promise.reject(new Error('invalid_scope'));
          return transact((tx, done) => {
            const store = tx.objectStore('scopes'), r = store.get(child);
            r.onsuccess = () => {
              const epoch = r.result?.active ? r.result.epoch : (r.result?.epoch ?? 0) + 1;
              store.put({ child_id: child, epoch, active: true }); done({ child_id: child, epoch });
            };
          });
        },
        read(scope, session) { return withScope(scope, session, (_, row, done) => done(row ?? null)); },
        accept(scope, snapshot) {
          if (!validSnapshot(snapshot) || snapshot.child_id !== scope?.child_id) return Promise.reject(new Error('wrong_scope'));
          return withScope(scope, snapshot.session_id, (store, row, done) => { const next = merge(row, snapshot); store.put(next); done(next); });
        },
        enqueue(scope, event) {
          if (!validEvent(event) || event.child_id !== scope?.child_id) return Promise.reject(new Error('invalid_event'));
          return withScope(scope, event.session_id, (store, row, done) => {
            if (!row) throw new Error('acknowledgement_required');
            if (event.api_version !== row.acknowledged.schema_version.slice(0, 3)) throw new Error('incompatible_event');
            if (row.acknowledged.status === 'complete') throw new Error('session_complete');
            if (row.pending) {
              if (row.pending.request_id === event.request_id && stable(row.pending) === stable(event)) { done(row); return; }
              throw new Error(row.pending.request_id === event.request_id ? 'request_conflict' : 'pending_exists');
            }
            if (row.acknowledged.acknowledged_request_ids.includes(event.request_id)) throw new Error('already_acknowledged');
            if (row.acknowledged.revision !== event.expected_revision) throw new Error('stale_revision');
            const next = { ...row, pending: structuredClone(event), state: 'pending' }; store.put(next); done(next);
          });
        },
        acknowledge(scope, response) {
          if (!response?.ok || !validSnapshot(response.session) || response.session.child_id !== scope?.child_id || !id(response.request_id) || !response.session.acknowledged_request_ids.includes(response.request_id)) return Promise.reject(new Error('invalid_acknowledgement'));
          return withScope(scope, response.session.session_id, (store, row, done) => {
            if (!row) throw new Error('acknowledgement_required');
            const next = merge(row, response.session); store.put(next); done(next);
          });
        },
        /** Explicit user reconciliation only: preserve acknowledged state, discard just this pending request. */
        discardPending(scope, session, requestId) {
          return withScope(scope, session, (store, row, done) => {
            if (!row || row.pending?.request_id !== requestId) throw new Error('request_conflict');
            const next = { ...row, pending: null, state: 'acknowledged' }; store.put(next); done(next);
          });
        },
        signOut(scope) {
          if (!id(scope?.child_id)) return Promise.reject(new Error('invalid_scope'));
          return transact((tx, done, abort) => {
            const scopes = tx.objectStore('scopes'), r = scopes.get(scope.child_id);
            r.onsuccess = () => {
              if (!r.result?.active || r.result.epoch !== scope.epoch) { abort(new Error('scope_expired')); return; }
              scopes.put({ ...r.result, active: false });
              const cursor = tx.objectStore('entries').openCursor();
              cursor.onsuccess = () => { const c = cursor.result; if (c) { if (c.value.child_id === scope.child_id) c.delete(); c.continue(); } else done(true); };
            };
          });
        },
        close() { db.close(); },
      });
    };
  });
}
