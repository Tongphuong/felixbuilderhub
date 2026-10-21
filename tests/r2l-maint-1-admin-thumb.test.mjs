import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';

let viteServer;
async function load() {
  if (!viteServer) {
    const config = await getViteConfig({}, { root: process.cwd() })({ command: 'serve', mode: 'development' });
    viteServer = await createServer({ ...config, server: { watch: null, middlewareMode: true, hmr: false }, appType: 'custom' });
    await viteServer.pluginContainer.buildStart({});
  }
  return viteServer.ssrLoadModule('/src/lib/admin-gifts.ts');
}
test.after(async () => { if (viteServer) await viteServer.close(); });

// The template as it was BEFORE this fix (inline handlers, blocked by the live CSP). Kept to prove the assertion bites.
const OLD_TEMPLATE = `<img src="/x.jpg" alt="" loading="lazy" onerror="this.remove()" onload="this.closest('.ag-thumb')?.classList.add('ag-thumb--has-img')" class="ag-thumb__img" data-ag-thumb-img />`;
const noInlineHandlers = (html) => assert.doesNotMatch(html, /\son(error|load)\s*=/i);

// Hand-rolled DOM mock: a document with capture listeners and a list of <img>s, each with a .ag-thumb parent.
function makeDoc(imgSpecs) {
  const listeners = [];
  const doc = {
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    querySelectorAll(sel) { assert.equal(sel, 'img[data-ag-thumb-img]'); return doc.imgs.filter((i) => !i.removed); },
    listeners,
    dispatch(type, target) { for (const l of listeners) if (l.type === type) l.fn({ target }); },
  };
  doc.imgs = imgSpecs.map((s) => {
    const thumb = { classes: new Set(), classList: { add(c) { thumb.classes.add(c); } } };
    const img = {
      tagName: 'IMG', removed: false, complete: !!s.complete, naturalWidth: s.naturalWidth || 0,
      hasAttribute: (n) => (n === 'data-ag-thumb-img' ? s.marked !== false : false),
      closest: (sel) => (sel === '.ag-thumb' ? thumb : null),
      remove() { img.removed = true; },
      thumb,
    };
    return img;
  });
  return doc;
}

test('rendered thumb carries no inline onerror/onload (CSP-safe) but keeps its data hook', async () => {
  const { renderGiftPhotoThumb } = await load();
  const html = renderGiftPhotoThumb({ id: 's', emoji: '🌟', image_key: null, image_url: 'https://cf.shopee.vn/x.jpg' });
  assert.match(html, /<img /);
  assert.match(html, /data-ag-thumb-img/);
  noInlineHandlers(html);
});

test('BITE: the no-inline-handler assertion FAILS on the old template', () => {
  assert.throws(() => noInlineHandlers(OLD_TEMPLATE), assert.AssertionError);
});

test('error event removes the img; load event adds ag-thumb--has-img; unmarked imgs are ignored', async () => {
  const { installAdminThumbFallback } = await load();
  const doc = makeDoc([{}, {}, { marked: false }]);
  installAdminThumbFallback(doc);
  assert.ok(doc.listeners.every((l) => l.capture === true), 'both listeners are capture-phase');
  doc.dispatch('error', doc.imgs[0]);
  assert.equal(doc.imgs[0].removed, true);
  doc.dispatch('load', doc.imgs[1]);
  assert.ok(doc.imgs[1].thumb.classes.has('ag-thumb--has-img'));
  assert.equal(doc.imgs[1].removed, false);
  doc.dispatch('error', doc.imgs[2]);
  doc.dispatch('load', doc.imgs[2]);
  assert.equal(doc.imgs[2].removed, false);
  assert.equal(doc.imgs[2].thumb.classes.size, 0);
});

test('images that already finished are swept once: broken removed, good gets the class, in-flight untouched', async () => {
  const { installAdminThumbFallback } = await load();
  const doc = makeDoc([{ complete: true, naturalWidth: 0 }, { complete: true, naturalWidth: 120 }, { complete: false }]);
  installAdminThumbFallback(doc);
  assert.equal(doc.imgs[0].removed, true);
  assert.ok(doc.imgs[1].thumb.classes.has('ag-thumb--has-img'));
  assert.equal(doc.imgs[2].removed, false);
  assert.equal(doc.imgs[2].thumb.classes.size, 0);
});

test('calling install twice adds exactly one listener pair', async () => {
  const { installAdminThumbFallback } = await load();
  const doc = makeDoc([]);
  installAdminThumbFallback(doc);
  installAdminThumbFallback(doc);
  assert.deepEqual(doc.listeners.map((l) => l.type).sort(), ['error', 'load']);
});

test('gifts.astro installs the fallback', () => {
  const page = readFileSync('src/pages/admin/gifts.astro', 'utf8');
  assert.match(page, /import \{[^}]*installAdminThumbFallback[^}]*\} from '\.\.\/\.\.\/lib\/admin-gifts'/);
  assert.match(page, /installAdminThumbFallback\(\);/);
});
