import { test } from 'node:test';
import assert from 'node:assert/strict';

// A DELIBERATELY FAILING TEST. It exists for about ninety seconds, to prove that a
// red check actually blocks a merge into main — because a gate nobody has watched
// refuse anything is not a gate (_ops/AGENTS.md rule 28). Deleted immediately after.
test('branch protection canary — this MUST fail', () => {
  assert.equal(1, 2, 'if this merges, branch protection is decoration');
});
