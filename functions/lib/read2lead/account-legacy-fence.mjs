const invalid = () => { throw new TypeError('invalid_legacy_account_fence'); };
const blocked = () => { throw new Error('legacy_account_fenced'); };
const validKey = key => typeof key === 'string' && key.length > 0 &&
  key.isWellFormed() && new TextEncoder().encode(key).length <= 512;

function keySet(keys) {
  if (!Array.isArray(keys) || !keys.every(validKey)) invalid();
  return new Set(keys);
}

function guardNamespace(binding, protectedKeys) {
  if (!binding || !['get', 'put', 'delete', 'list'].every(name => typeof binding[name] === 'function')) invalid();
  const guard = Object.create(null);
  function check(key) {
    if (!validKey(key)) invalid();
    if (protectedKeys.has(key)) blocked();
  }
  for (const name of ['get', 'getWithMetadata', 'put', 'delete']) {
    const operation = binding[name];
    if (typeof operation !== 'function') continue;
    guard[name] = async (key, ...options) => {
      // Copy a bulk-read array before any async work or raw binding access.
      if (Array.isArray(key) && (name === 'get' || name === 'getWithMetadata')) {
        key = [...key];
        key.forEach(check);
      } else check(key);
      return operation.call(binding, key, ...options);
    };
  }
  const list = binding.list;
  guard.list = async (...options) => {
    const page = await list.apply(binding, options);
    if (!page || !Array.isArray(page.keys)) invalid();
    // Do not silently hide rows or lose the provider's pagination contract.
    // A host must route affected listing operations to the authoritative store.
    for (const row of page.keys) check(row?.name);
    return page;
  };
  return Object.freeze(guard);
}

/** Host-only old-store guard, not a migration or routing mechanism.
 * Inventory must contain EVERY owned key, including indirect/shared records.
 * Existing raw references, older deployed versions, REST/CLI and in-flight
 * requests are outside this boundary and must be retired before a source freeze.
 * List refusal does not roll back writes already made on earlier list pages.
 */
export function fenceLegacyAccountBindings(env, inventory) {
  if (!env || !inventory || Object.keys(inventory).sort().join(',') !== 'codes,progress') invalid();
  const codes = keySet(inventory.codes);
  const progress = keySet(inventory.progress);
  if (!codes.size && !progress.size) invalid();
  const shared = !env.READ2LEAD_PROGRESS || env.READ2LEAD_PROGRESS === env.READ2LEAD_CODES;
  if (shared) for (const key of progress) codes.add(key);
  const codeGuard = guardNamespace(env.READ2LEAD_CODES, codes);
  const guarded = { ...env, READ2LEAD_CODES: codeGuard };
  if (env.READ2LEAD_PROGRESS) guarded.READ2LEAD_PROGRESS = shared ? codeGuard : guardNamespace(env.READ2LEAD_PROGRESS, progress);
  return Object.freeze(guarded);
}
