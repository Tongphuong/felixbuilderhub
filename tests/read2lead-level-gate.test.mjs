import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read2LeadPage = readFileSync('src/pages/read2lead.astro', 'utf-8');
const adminCodesPage = readFileSync('src/pages/admin/codes.astro', 'utf-8');
const generateEndpoint = readFileSync('functions/api/generate-read2lead-pack.js', 'utf-8');

test('parent intake form does not expose a level selector', () => {
  assert.doesNotMatch(read2LeadPage, /name="level"/);
  assert.match(read2LeadPage, /bắt đầu từ L1/);
});

test('admin create-code form does not expose a level selector', () => {
  assert.doesNotMatch(adminCodesPage, /student_level/);
  assert.match(adminCodesPage, /bắt đầu ở L1/);
});

test('generate endpoint does not accept client-provided level as source of truth', () => {
  assert.match(generateEndpoint, /loadProgressState/);
  assert.match(generateEndpoint, /progressState\?\.current_level/);
  assert.doesNotMatch(generateEndpoint, /data\.level/);
  assert.doesNotMatch(generateEndpoint, /includes\(data\.level\)/);
});
