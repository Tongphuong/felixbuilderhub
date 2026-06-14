import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEggHtml } from '../src/lib/egg-renderer.ts';

test('renderEggHtml includes inline SVG, name, and Vietnamese greeting', () => {
  const html = renderEggHtml('Linh', 'L1', 4);
  assert.match(html, /<svg/);
  assert.match(html, /Chào Linh!/);
  assert.match(html, /trứng sẽ nở/);
});

test('renderEggHtml sets level and packs-until-hatch data attributes', () => {
  const html = renderEggHtml('An', 'L1', 3);
  assert.match(html, /data-level="L1"/);
  assert.match(html, /data-packs-until-hatch="3"/);
});

test('egg HTML escapes names and never leaks a monster config', () => {
  const html = renderEggHtml('<script>monster</script>', 'L1', 2);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /png-default-body/);
  assert.doesNotMatch(html, /data-monster-/);
});
