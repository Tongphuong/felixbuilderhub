import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { astroJavaScriptSource } from './helpers/astro-javascript-source.mjs';

// Execute the page functions, including their state assignments and fetch flow.
const source = astroJavaScriptSource(fs.readFileSync(new URL('../src/pages/admin/codes.astro', import.meta.url), 'utf8'));
const start = source.indexOf('async function loadList()');
const end = source.indexOf("loadMoreBtn.addEventListener('click', loadMore)", start);
assert.ok(start > 0 && end > start, 'actual page pagination functions are present');
const functions = source.slice(start, end);

function harness(responses) {
  const requests = [];
  const context = vm.createContext({
    fetch: async (url) => {
      requests.push(url);
      const response = responses.shift();
      assert.ok(response, 'unexpected request');
      if (response instanceof Error) throw response;
      return { ok: response.httpOk !== false, json: async () => response };
    },
    console: { error() {} },
  });
  const api = vm.runInContext(`
    let allItems = [], nextCursor = null, listComplete = true, renders = 0;
    const listStatus = { textContent: '' };
    const loadMoreBtn = { disabled: false, textContent: 'Tải thêm →' };
    function filterItems() { renders++; }
    ${functions}
    ({ loadList, loadMore, state: () => ({ allItems, nextCursor, listComplete, renders, listStatus, loadMoreBtn }) });
  `, context);
  return { ...api, requests, state: () => JSON.parse(JSON.stringify(api.state())) };
}
const page = (code, cursor, complete) => ({ ok: true, items: [{ code }], cursor, list_complete: complete });

test('initial incomplete page permits continuation', async () => {
  const h = harness([page('QA-1', 'next /+?', false)]);
  await h.loadList();
  assert.equal(h.state().listComplete, false);
  assert.equal(h.state().nextCursor, 'next /+?');
  assert.deepEqual(h.state().allItems, [{ code: 'QA-1' }]);
});

test('middle incomplete page permits a third page, with exact cursor encoding', async () => {
  const h = harness([page('QA-1', 'next /+?', false), page('QA-2', 'last', false), page('QA-3', null, true)]);
  await h.loadList();
  await h.loadMore();
  assert.equal(h.state().listComplete, false);
  assert.deepEqual(h.state().allItems.map(x => x.code), ['QA-1', 'QA-2']);
  await h.loadMore();
  assert.equal(h.state().listComplete, true);
  assert.equal(h.state().nextCursor, null);
  assert.deepEqual(h.state().allItems.map(x => x.code), ['QA-1', 'QA-2', 'QA-3']);
  assert.deepEqual(h.requests, ['/api/admin/codes', '/api/admin/codes?cursor=next%20%2F%2B%3F', '/api/admin/codes?cursor=last']);
  await h.loadMore();
  assert.equal(h.requests.length, 3);
});

for (const flag of [true, null, undefined]) {
  test(`complete or absent flag keeps safe terminal fallback: ${flag}`, async () => {
    const h = harness([page('QA-1', 'unused', flag)]);
    await h.loadList();
    assert.equal(h.state().listComplete, true);
    await h.loadMore();
    assert.equal(h.requests.length, 1);
  });
}

test('missing cursor prevents an extra request even with incomplete flag', async () => {
  const h = harness([page('QA-1', null, false)]);
  await h.loadList();
  await h.loadMore();
  assert.equal(h.requests.length, 1);
});

for (const failure of [{ httpOk: false, ok: false }, new Error('synthetic offline')]) {
  test(`failed continuation preserves items/cursor and permits retry: ${failure instanceof Error ? 'network' : 'HTTP'}`, async () => {
    const h = harness([page('QA-1', 'retry-me', false), failure, page('QA-2', null, true)]);
    await h.loadList();
    await h.loadMore();
    assert.deepEqual(h.state().allItems, [{ code: 'QA-1' }]);
    assert.equal(h.state().nextCursor, 'retry-me');
    assert.equal(h.state().listComplete, false);
    assert.equal(h.state().loadMoreBtn.disabled, false);
    assert.equal(h.state().loadMoreBtn.textContent, 'Tải thêm →');
    await h.loadMore();
    assert.deepEqual(h.state().allItems.map(x => x.code), ['QA-1', 'QA-2']);
    assert.deepEqual(h.requests.slice(1), ['/api/admin/codes?cursor=retry-me', '/api/admin/codes?cursor=retry-me']);
  });
}

test('refresh replaces the current page rather than duplicating old items', async () => {
  const h = harness([page('QA-1', null, true), page('QA-NEW', null, true)]);
  await h.loadList();
  await h.loadList();
  assert.deepEqual(h.state().allItems, [{ code: 'QA-NEW' }]);
});
