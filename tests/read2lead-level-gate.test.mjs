import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read2LeadPage = readFileSync('src/pages/read2lead.astro', 'utf-8');
const adminCodesPage = readFileSync('src/pages/admin/codes.astro', 'utf-8');
const generateEndpoint = readFileSync('functions/api/generate-read2lead-pack.js', 'utf-8');
const stateModule = readFileSync('functions/api/_read2lead-v2-state.js', 'utf-8');

test('parent intake form does not expose a level selector', () => {
  assert.doesNotMatch(read2LeadPage, /name="level"/);
  assert.match(read2LeadPage, /bắt đầu từ L1/);
});

test('parent intake form does not expose child identity fields', () => {
  assert.doesNotMatch(read2LeadPage, /name="child_name"/);
  assert.doesNotMatch(read2LeadPage, /name="age"/);
  assert.doesNotMatch(read2LeadPage, /name="child_gender"/);
  assert.match(read2LeadPage, /Mã học sinh là gì/);
});

test('admin create-code form does not expose a level selector', () => {
  assert.doesNotMatch(adminCodesPage, /student_level/);
  assert.match(adminCodesPage, /bắt đầu ở L1/);
});

test('generate endpoint does not accept client-provided level as source of truth', () => {
  assert.match(generateEndpoint, /loadProgressState/);
  assert.match(generateEndpoint, /progressState\?\.current_level/);
  assert.doesNotMatch(generateEndpoint, /data\.level/);
  assert.doesNotMatch(generateEndpoint, /data\.child_name/);
  assert.doesNotMatch(generateEndpoint, /includes\(data\.level\)/);
});

test('admin has bulk L1 reset action for old codes', () => {
  assert.equal(existsSync('functions/api/admin/codes/reset-levels.js'), true);
  assert.match(adminCodesPage, /Reset tất cả về L1/);
});

test('manual level override endpoint is removed', () => {
  assert.equal(existsSync('functions/api/admin/read2lead-set-level.js'), false);
  assert.doesNotMatch(stateModule, /setProgressLevel/);
});
