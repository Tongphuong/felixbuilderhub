/** Internal validator for the audited keyword subset in the existing lesson contract.
 * Unsupported schema features fail at construction; this is not a general Draft7 implementation.
 */
const KEYWORDS = new Set(['$schema', '$id', 'title', 'type', 'properties', 'required', 'additionalProperties', 'definitions',
  'const', 'items', 'minItems', 'maxItems', '$ref', 'minLength', 'enum', 'minimum', 'maximum', 'pattern']);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : object(v) ?
  '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
const isType = (v, t) => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'object' ? object(v) :
  t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t;
function requireSchema(ok) { if (!ok) throw Error('unsupported_schema'); }
export function createSchemaCheck(input) {
  const schema = structuredClone(input);
  let nodes = 0;
  function inspect(s, ancestors = []) {
    requireSchema(object(s) && ++nodes < 1000 && !ancestors.includes(s) && Object.keys(s).every(k => KEYWORDS.has(k)));
    if (s.$ref !== undefined) {
      requireSchema(Object.keys(s).length === 1 && /^#\/definitions\/[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.$ref));
      const target = schema.definitions?.[s.$ref.split('/').at(-1)];
      requireSchema(target); inspect(target, [...ancestors, s]); return;
    }
    requireSchema(s.type === undefined ? Object.hasOwn(s, 'const') || Array.isArray(s.enum) : (Array.isArray(s.type) ? s.type.length > 0 && s.type.every(t => TYPES.has(t)) : TYPES.has(s.type)));
    if (s.properties !== undefined) { requireSchema(object(s.properties)); for (const child of Object.values(s.properties)) inspect(child, [...ancestors, s]); }
    if (s.definitions !== undefined) { requireSchema(object(s.definitions)); for (const child of Object.values(s.definitions)) inspect(child, [...ancestors, s]); }
    if (s.items !== undefined) inspect(s.items, [...ancestors, s]);
    if (s.required !== undefined) requireSchema(Array.isArray(s.required) && s.required.every(k => typeof k === 'string'));
    if (s.additionalProperties !== undefined) requireSchema(s.additionalProperties === false);
    if (s.enum !== undefined) requireSchema(Array.isArray(s.enum) && s.enum.length > 0);
    for (const k of ['minItems', 'maxItems', 'minLength']) if (s[k] !== undefined) requireSchema(Number.isSafeInteger(s[k]) && s[k] >= 0);
    for (const k of ['minimum', 'maximum']) if (s[k] !== undefined) requireSchema(typeof s[k] === 'number' && Number.isFinite(s[k]));
    if (s.pattern !== undefined) { requireSchema(typeof s.pattern === 'string'); try { new RegExp(s.pattern); } catch { requireSchema(false); } }
  }
  inspect(schema);
  return value => {
    const issues = [];
    const issue = (path, code) => { if (issues.length < 100) issues.push({ path, code }); };
    function check(s, v, path) {
      if (issues.length >= 100) return;
      if (s.$ref) { check(schema.definitions[s.$ref.split('/').at(-1)], v, path); return; }
      if (s.type !== undefined && !(Array.isArray(s.type) ? s.type : [s.type]).some(t => isType(v, t))) { issue(path, 'type'); return; }
      if (Object.hasOwn(s, 'const') && canonical(v) !== canonical(s.const)) issue(path, 'const');
      if (s.enum && !s.enum.some(option => canonical(option) === canonical(v))) issue(path, 'enum');
      if (typeof v === 'string') {
        if (s.minLength !== undefined && [...v].length < s.minLength) issue(path, 'minLength');
        if (s.pattern && !new RegExp(s.pattern).test(v)) issue(path, 'pattern');
      }
      if (typeof v === 'number') {
        if (s.minimum !== undefined && v < s.minimum) issue(path, 'minimum');
        if (s.maximum !== undefined && v > s.maximum) issue(path, 'maximum');
      }
      if (Array.isArray(v)) {
        if (s.minItems !== undefined && v.length < s.minItems) issue(path, 'minItems');
        if (s.maxItems !== undefined && v.length > s.maxItems) issue(path, 'maxItems');
        if (s.items) v.forEach((item, i) => check(s.items, item, path + '/' + i));
      } else if (object(v)) {
        for (const k of s.required || []) if (!Object.hasOwn(v, k)) issue(path + '/' + k, 'required');
        for (const k of Object.keys(v)) {
          if (Object.hasOwn(s.properties || {}, k)) check(s.properties[k], v[k], path + '/' + k);
          else if (s.additionalProperties === false) issue(path, 'additionalProperties');
        }
      }
    }
    check(schema, value, ''); return issues;
  };
}
