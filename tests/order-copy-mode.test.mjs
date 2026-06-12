import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');

test('order copy-mode completion arrives as a callback, never a closure-scoped name', () => {
  // Regression: checkOrderItem (top-level) called w1CompleteCopyMode (closure
  // of renderOrderActivity) by name → ReferenceError swallowed by Sentry →
  // kids who fixed their sentence after the reveal were stuck on stale orange
  // with no completion ("sửa rồi mà vẫn cam, không cho làm tiếp").
  const checkStart = lessonPage.indexOf('function checkOrderItem');
  const checkEnd = lessonPage.indexOf('function renderWrittenActivity');
  const checkBody = lessonPage.slice(checkStart, checkEnd);
  // The function body must use the callback parameter, not the closure name.
  assert.match(checkBody, /onCopyComplete/);
  assert.doesNotMatch(checkBody, /w1CompleteCopyMode\(/);
  // Both call sites (token click + drag-drop) must pass the callback.
  const callSites = lessonPage.match(/(?<!function )checkOrderItem\(root, activity, picked, wrongSignatures, solved, itemIndex,/g) || [];
  assert.ok(callSites.length >= 2, 'expected both order call sites present');
  const passes = lessonPage.match(/\}, \(\) => w1CompleteCopyMode\(itemIndex\)\)/g) || [];
  assert.equal(passes.length, callSites.length, 'every checkOrderItem call site must pass the copy-complete callback');
});

test('copy-mode completion clears stale orange and survives missing correct_order_indices', () => {
  const fnStart = lessonPage.indexOf('function w1CompleteCopyMode');
  const fnEnd = lessonPage.indexOf('root.querySelectorAll(\'[data-play-order]\')');
  const body = lessonPage.slice(fnStart, fnEnd);
  assert.match(body, /misplaced = 'false'/);
  assert.match(body, /Array\.isArray\(item\.correct_order_indices\)/);
});
