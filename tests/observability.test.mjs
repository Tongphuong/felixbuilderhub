import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseLayout = readFileSync('src/layouts/BaseLayout.astro', 'utf-8');
const read2LeadLanding = readFileSync('src/pages/read2lead.astro', 'utf-8');
const identityBanner = readFileSync('src/components/read2lead/v2/IdentityBanner.astro', 'utf-8');

test('BaseLayout gates Clarity init on PUBLIC_CLARITY_ID', () => {
  assert.match(baseLayout, /PUBLIC_CLARITY_ID/);
  assert.match(baseLayout, /if \(clarityId\)/);
  assert.match(baseLayout, /clarity\.ms\/tag/);
});

test('BaseLayout gates Sentry loader on PUBLIC_SENTRY_LOADER_SRC', () => {
  assert.match(baseLayout, /PUBLIC_SENTRY_LOADER_SRC/);
  assert.match(baseLayout, /if \(sentrySrc\)/);
  assert.match(baseLayout, /sendDefaultPii:\s*false/);
});

test('BaseLayout does not show the global maintenance banner', () => {
  assert.doesNotMatch(baseLayout, /MAINTENANCE BANNER/);
  assert.doesNotMatch(baseLayout, /Hệ thống đang bảo trì nâng cấp/);
});

test('Sentry config scrubs code and access_code from URLs', () => {
  assert.match(baseLayout, /beforeSend/);
  assert.match(baseLayout, /beforeBreadcrumb/);
  assert.match(baseLayout, /\(code\|access_code\)=/);
});

test('access code and child name displays carry clarity mask attribute', () => {
  assert.match(read2LeadLanding, /name="access_code"[\s\S]*data-clarity-mask="true"/);
  assert.match(read2LeadLanding, /id="result-child-name"[\s\S]*data-clarity-mask="true"/);
  assert.match(identityBanner, /id="identity-student-name"[\s\S]*data-clarity-mask="true"/);
});
