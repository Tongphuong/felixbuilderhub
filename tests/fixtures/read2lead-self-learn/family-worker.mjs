/** Subprocess fixture: hard interruption of an explicit marked synthetic target only. */
import { SyntheticFamilyStore } from '../../../scripts/lib/read2lead-self-learn-family.mjs';
import { readFileSync } from 'node:fs';
const [root, operation, boundary = '', requestId = 'worker-request'] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(new URL('./family-access.json', import.meta.url))).accounts[0];
const f = new SyntheticFamilyStore({ mode: 'synthetic-local', root, fault(name) { if (name === boundary) process.kill(process.pid, 'SIGKILL'); } });
try {
  let result;
  if (operation === 'create') result = f.createChild(f.elevateParent(f.authenticateAccess(seed.access_code), seed.parent_secret), { request_id: requestId, display_name: 'Worker sample' }, '2026-09-18T15:00:00Z');
  else if (operation === 'recover') result = f.recover({ family_id: seed.family_id, request_id: requestId, recovery_code: seed.recovery_code, new_access_code: 'WORKER-ACCESS-NEXT', new_parent_secret: 'WORKER-PARENT-NEXT', new_recovery_code: 'WORKER-RECOVERY-NEXT-2026' }, '2026-09-18T15:00:00Z');
  else throw Error('unknown_fixture_operation');
  console.log(JSON.stringify(result));
} catch (e) { console.log(JSON.stringify({ error: e.code || e.message })); process.exitCode = 2; }
finally { f.close(); }
