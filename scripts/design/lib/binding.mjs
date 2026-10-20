import { containsToken } from './text.mjs';
// Contract data_bound values vs what the binding pass actually proves.
//
// A `data_bound` value is sample data in the mock ("Minh", "55", "1.080 XP"). It must be EITHER
//   (a) bound: the driver's expectations cover it (the alternate sample changes it, the new value must show and the old one
//       must be gone; or, for a value that does not change, it must still show), OR
//   (b) declared in the contract's `unbound` map {"<value>": "<reason>"} with a NON-EMPTY reason.
// Anything in neither is a failure: an empty set of expectations can never read as a pass.
// An expectation covers a value when it equals it, equals it minus a leading "[placeholder] " tag ("[Tên quà] Sticker" is bound by
// "Sticker"), CONTAINS it as a whole token ("Chào Minh!" shows "Minh"), or is a whole run of its " · "-separated parts
// ("Quyển 2 · Bài 4" is the tail of "Bộ 1 · Quyển 2 · Bài 4"; "48 câu chuyện · 6 quyển sách" of the heading that prefixes it).
// NOT any other substring: a short expectation that merely sits inside the value ("oan" inside "Hoang") proves nothing about it.
const parts = v => v.split(' · ');
const isPartRun = (e, v) => {
  const ps = parts(v);
  if (ps.length < 2) return false;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j <= ps.length; j++) if (ps.slice(i, j).join(' · ') === e) return true;
  return false;
};
const cover = (e, v) => e === v || e === v.replace(/^\[[^\]]*\]\s*/, '') || isPartRun(e, v) || (v.length >= 3 && containsToken(e, v));

export function classifyDataBound(contract, db) {
  const values = (contract && contract.data_bound) || [];
  const unbound = (contract && contract.unbound) || {};
  const exp = [...((db && db.expect) || []), ...((db && db.absent) || [])];
  const bound = [], declared = [], undeclared = [];
  for (const v of values) {
    const reason = unbound[v];
    const hasReason = typeof reason === 'string' && reason.trim().length > 0;
    if (exp.some(e => cover(String(e), v))) bound.push(v);
    else if (hasReason) declared.push(v);
    else undeclared.push(v);
  }
  // an `unbound` entry without a reason is a defect even when the value happens to be covered
  const noReason = Object.entries(unbound).filter(([, r]) => typeof r !== 'string' || !r.trim()).map(([k]) => k);
  return { bound, declared, undeclared, noReason };
}
