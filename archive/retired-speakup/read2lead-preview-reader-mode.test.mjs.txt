import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExistingReaderBuild} from '../scripts/read2lead-story-preview-package.mjs';

test('existing illustrated reader must be enabled in the actual built main element',()=>{
 for(const html of ['<main id="main" data-r2l-w1-ssr="1"></main>',"<main class='reader' data-r2l-w1-ssr = '1' id = 'main'></main>"])
  assert.deepEqual(verifyExistingReaderBuild(html),{illustratedReaderEnabled:true});
});
test('disabled, missing and unrelated mode markers cannot pass additive release validation',()=>{
 for(const html of [undefined,'','<main id="main" data-r2l-w1-ssr="0"></main>','<main id="main"></main>',
  '<div data-r2l-w1-ssr="1"></div><main id="main" data-r2l-w1-ssr="0"></main>',
  '<main id="other" data-r2l-w1-ssr="1"></main>',
  '<main id="main" data-r2l-w1-ssr="1"></main><main id="main" data-r2l-w1-ssr="0"></main>'])
  assert.throws(()=>verifyExistingReaderBuild(html),/preview_existing_reader_disabled/);
});
