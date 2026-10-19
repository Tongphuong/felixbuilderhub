// Contract data_bound values vs what the binding pass actually proves.
//
// A `data_bound` value is sample data in the mock ("Minh", "55", "1.080 XP"). It must be EITHER
//   (a) bound: the driver's expectations cover it (the alternate sample changes it, the new value must show and the old one
//       must be gone; or, for a value that does not change, it must still show), OR
//   (b) declared in the contract's `unbound` map {"<value>": "<reason>"} with a NON-EMPTY reason.
// Anything in neither is a failure: an empty set of expectations can never read as a pass.
const cover = (e, v) => e === v || (e.length >= 3 && v.includes(e)) || (v.length >= 3 && e.includes(v));

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
