import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('Read2Lead mechanical resume guard: real Git and process fixtures', () => {
  const result = spawnSync('python3', ['tests/fixtures/read2lead-self-learn/resume_cases.py', '-v'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 45000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran \d+ tests/);
  process.stdout.write(result.stdout + result.stderr);
});
