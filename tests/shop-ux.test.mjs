import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

import { RARITY_COLORS } from '../functions/api/_read2lead-chests.js';

/** @type {import('vite').ViteDevServer | undefined} */
let viteServer;
/** @type {import('astro/container').experimental_AstroContainer | undefined} */
let container;

async function ensureHarness() {
  if (container) return;
  const configFn = getViteConfig({}, { root: process.cwd() });
  const config = await configFn({ command: 'serve', mode: 'development' });
  viteServer = await createServer({
    ...config,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  await viteServer.pluginContainer.buildStart({});
  container = await AstroContainer.create();
}

async function renderComponent(modulePath, props) {
  await ensureHarness();
  const Component = (await viteServer.ssrLoadModule(modulePath)).default;
  return container.renderToString(Component, { props });
}

test.before(async () => {
  await ensureHarness();
});

test.after(async () => {
  if (viteServer) await viteServer.close();
});

const shopUxSource = readFileSync('src/lib/shop-ux.ts', 'utf8');
const shopPage = readFileSync('src/pages/read2lead/shop.astro', 'utf8');

// ---------------------------------------------------------------------------
// Minimal, purpose-built fake DOM — used ONLY by the real-click regression
// test below (bug: a real tap on an unaffordable shop item did nothing).
// This is not a general-purpose DOM: it exists to faithfully model the ONE
// browser behavior the bug and its fix both hinge on — a native `disabled`
// form control never receives dispatched click events at all (WHATWG HTML
// "activation behavior"), while `aria-disabled` is purely semantic/visual
// and never blocks dispatch. No jsdom/happy-dom is a dependency here (not
// even transitively — checked node_modules and package-lock.json), so this
// runs shop-ux.ts's REAL exported initShopPage() end-to-end against a
// mocked fetch, close enough to how a browser actually behaves for the one
// fact this bug is about.
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(['img', 'br', 'input', 'hr']);

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this._attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
    this._disabled = false;
    this._open = false;
    this.value = '';
  }

  get id() { return this.getAttribute('id') || ''; }

  get classList() {
    const self = this;
    const read = () => new Set((self.getAttribute('class') || '').split(/\s+/).filter(Boolean));
    const write = (set) => self.setAttribute('class', [...set].join(' '));
    return {
      add: (...names) => { const s = read(); names.forEach((n) => s.add(n)); write(s); },
      remove: (...names) => { const s = read(); names.forEach((n) => s.delete(n)); write(s); },
      contains: (name) => read().has(name),
      toggle: (name, force) => {
        const s = read();
        const shouldHave = force === undefined ? !s.has(name) : force;
        if (shouldHave) s.add(name); else s.delete(name);
        write(s);
        return shouldHave;
      },
    };
  }

  get dataset() {
    const self = this;
    return new Proxy({}, {
      get(_t, prop) {
        const attr = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        const value = self.getAttribute(attr);
        return value === null ? undefined : value;
      },
      set(_t, prop, value) {
        const attr = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        self.setAttribute(attr, String(value));
        return true;
      },
    });
  }

  get disabled() { return this.tagName === 'BUTTON' ? this._disabled : false; }
  set disabled(value) {
    this._disabled = !!value;
    if (this._disabled) this._attrs.set('disabled', '');
    else this._attrs.delete('disabled');
  }

  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  setAttribute(name, value) {
    this._attrs.set(name, String(value));
    if (name === 'disabled') this._disabled = true;
  }
  removeAttribute(name) {
    this._attrs.delete(name);
    if (name === 'disabled') this._disabled = false;
  }
  hasAttribute(name) { return this._attrs.has(name); }

  get textContent() {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  set textContent(value) { this.children = [String(value)]; }

  set innerHTML(html) {
    const parsed = parseHtmlFragment(html);
    parsed.forEach((child) => { if (typeof child !== 'string') child.parentNode = this; });
    this.children = parsed;
  }
  get innerHTML() { return ''; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this._listeners.get(type)?.delete(handler); }

  dispatchEvent(event) {
    event.target = event.target || this;
    // Faithful to real browsers: a NATIVE-disabled form control never
    // receives click-family events, no matter how the click happens (real
    // tap, .click(), or dispatchEvent) — this IS the bug: the old code
    // relied on the native `disabled` attribute, so a real tap on an
    // unaffordable item's button never reached its own click listener.
    if (this.disabled && /^(click|mousedown|mouseup|pointerdown|pointerup)$/.test(event.type)) {
      return true;
    }
    const handlers = this._listeners.get(event.type);
    if (handlers) for (const handler of [...handlers]) handler.call(this, event);
    return true;
  }

  click() {
    if (this.disabled) return; // spec: .click() on a disabled control does nothing
    this.dispatchEvent({ type: 'click', target: this });
  }

  showModal() { this._open = true; }
  close() { this._open = false; }
  get open() { return this._open; }

  querySelector(selector) { return findAll(this, selector)[0] || null; }
  querySelectorAll(selector) { return findAll(this, selector); }
}

function matchesSimpleSelector(el, selector) {
  const tokens = selector.match(/(#[^.#[]+)|(\.[^.#[]+)|(\[[^\]]+\])|^[a-zA-Z][\w-]*/g) || [];
  if (!tokens.length) return false;
  return tokens.every((token) => {
    if (token[0] === '#') return el.id === token.slice(1);
    if (token[0] === '.') return el.classList.contains(token.slice(1));
    if (token[0] === '[') {
      const inner = token.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) return el.hasAttribute(inner);
      const attr = inner.slice(0, eq);
      const val = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
      return el.getAttribute(attr) === val;
    }
    return el.tagName === token.toUpperCase();
  });
}

function findAll(root, selector) {
  const results = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if (matchesSimpleSelector(child, selector)) results.push(child);
      walk(child);
    }
  };
  walk(root);
  return results;
}

function parseHtmlFragment(html) {
  const root = { tagName: '#root', children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\s*(\/?)>|([^<]+)/g;
  let match;
  while ((match = tagRe.exec(html))) {
    const [, closing, rawTag, attrsRaw, selfClose, text] = match;
    const top = () => stack[stack.length - 1];
    if (text !== undefined) {
      top().children.push(text);
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === rawTag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new FakeElement(rawTag);
    const attrRe = /([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g;
    let am;
    while ((am = attrRe.exec(attrsRaw || ''))) {
      const value = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : '');
      el.setAttribute(am[1], value);
    }
    const parent = top();
    parent.children.push(el);
    el.parentNode = parent === root ? null : parent;
    const isVoid = VOID_TAGS.has(rawTag.toLowerCase()) || selfClose === '/';
    if (!isVoid) stack.push(el);
  }
  return root.children;
}

function buildFakeShopPage() {
  const body = new FakeElement('body');
  const add = (parent, tag, attrs = {}) => {
    const el = new FakeElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.appendChild(el);
    return el;
  };

  add(body, 'input', { id: 'shop-code' });
  add(body, 'button', { id: 'shop-load' });
  add(body, 'div', { id: 'shop-error', class: 'hidden' });
  const shell = add(body, 'div', { id: 'shop-shell', class: 'hidden' });
  add(shell, 'span', { id: 'shop-diamonds' });
  add(shell, 'a', { id: 'shop-profile-link' });
  add(body, 'p', { id: 'shop-minny', class: 'hidden' });
  add(body, 'div', { id: 'shop-grid' });

  const insufficient = add(body, 'dialog', { class: 'insufficient-modal' });
  add(insufficient, 'h2', { class: 'insufficient-title' });
  add(insufficient, 'button', { class: 'insufficient-go-learn' });
  add(insufficient, 'button', { class: 'insufficient-close' });

  const unlock = add(body, 'dialog', { class: 'unlock-celebration' });
  add(unlock, 'h2', { class: 'unlock-title' });
  add(unlock, 'div', { class: 'unlock-part-name' });
  add(unlock, 'button', { class: 'unlock-equip' });
  add(unlock, 'button', { class: 'unlock-later' });

  return body;
}

async function waitFor(conditionFn, timeoutMs = 2000) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true in time');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('RarityBadge renders Vietnamese label per rarity', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'rare',
  });
  assert.match(html, /Hiếm/);
  assert.match(html, /data-rarity="?rare"?/);
});

test('RarityBadge epic includes sparkle emoji', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'epic',
  });
  assert.match(html, /✨/);
  assert.match(html, /Sử Thi/);
});

test('RarityBadge color CSS var matches mobile convention', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'epic',
  });
  assert.match(html, new RegExp(RARITY_COLORS.epic.replace('#', '#')));
  assert.match(html, /--badge-color/);
});

test('active shop renderer emits item rarity and affordability metadata', () => {
  assert.match(shopUxSource, /class=\"shop-item\"/);
  assert.match(shopUxSource, /data-rarity=\"/);
  assert.match(shopUxSource, /data-can-afford=\"/);
  // Bug fix: aria-disabled (semantic/visual only), NOT the native `disabled`
  // attribute — a real browser refuses to dispatch click events to a
  // natively-disabled button, which silently ate the insufficient-diamonds
  // flow for every kid who tapped an item they couldn't afford. See the
  // real-click regression test below for the behavioral proof.
  assert.match(shopUxSource, /aria-disabled=\"\$\{item\.can_afford \? 'false' : 'true'\}\"/);
  assert.doesNotMatch(shopUxSource, /item\.can_afford \? \x27\x27 : \x27disabled\x27/);
});

test('active shop renderer groups epic, rare, then common and hides empty sections', () => {
  const epic = shopUxSource.indexOf("renderSection('epic'");
  const rare = shopUxSource.indexOf("renderSection('rare'");
  const common = shopUxSource.indexOf("renderSection('common'");
  assert.ok(epic >= 0 && rare > epic && common > rare);
  assert.match(shopUxSource, /if \(!items\.length\) return \x27\x27/);
});

test('dark shop styles apply W6 rarity borders and reduced motion', () => {
  assert.match(shopPage, /var\(--w6-rare\)/);
  assert.match(shopPage, /var\(--w6-epic\)/);
  assert.match(shopPage, /prefers-reduced-motion: reduce/);
});

test('InsufficientCoinsModal opens with correct deficit number', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/InsufficientCoinsModal.astro', {
    coins_needed: 80,
    current_coins: 20,
  });
  // R2L Rewards Redesign (founder decision #5): 🪙 xu wording replaced by 💎.
  assert.match(html, /Còn thiếu 60💎/);
  assert.doesNotMatch(html, /\bxu\b/);
  assert.match(html, /data-deficit="?60"?/);
  assert.match(html, /Đi học/);
});

test('UnlockCelebration includes Vietnamese rarity label', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/UnlockCelebration.astro', {
    part_name: 'Sừng xanh lớn',
    rarity: 'epic',
  });
  assert.match(html, /Mới có Sử Thi!/);
  assert.match(html, /Sừng xanh lớn/);
  assert.match(html, /Đeo ngay/);
});

// R2L Rewards Redesign (SPEC_R2L_REWARDS_REDESIGN.md, approved 2026-07-18) —
// diamonds are now the only shop currency; the 🪙 coin badge is gone.

test('shop page shows a diamond balance, not a coin balance', () => {
  assert.match(shopPage, /id="shop-diamonds"/);
  assert.match(shopPage, /💎 <span id="shop-diamonds">0<\/span>/);
  assert.doesNotMatch(shopPage, /id="shop-coins"/);
  assert.doesNotMatch(shopPage, /🪙/);
  assert.doesNotMatch(shopPage, /\bxu\b/);
});

// Reuse-first convergence: the monster shop's 💎 display must match the
// live "Quà thật" gift shop's established convention (gold, "Kim cương của
// con"), not invent a second diamond visual language.
test('shop balance box reuses the gift shop\'s label wording and gold emphasis', () => {
  assert.match(shopPage, /Kim cương của con/);
  assert.doesNotMatch(shopPage, /Số dư của con/);
  assert.match(shopPage, /border-gold\/30 bg-gold\/10/);
  assert.match(shopPage, /text-gold">💎/);
  assert.doesNotMatch(shopPage, /cyan/);
});

// Linking work (founder decision): kids must be able to find the shop —
// the ?v3=1 preview gate is gone, and each diamond shop links to the other.
test('shop page has no v3 preview gate and cross-links to the gift shop', () => {
  assert.doesNotMatch(shopPage, /shop-gate/);
  assert.doesNotMatch(shopPage, /isV3Enabled/);
  assert.doesNotMatch(shopPage, /v3 preview/);
  assert.match(shopPage, /href="\/read2lead\/gifts"/);
});

test('shop-ux tracks a diamond balance and falls back to the legacy coins field during rollout', () => {
  assert.match(shopUxSource, /let shopDiamonds = 0;/);
  assert.match(shopUxSource, /const setShopDiamonds = /);
  assert.match(shopUxSource, /qs\('#shop-diamonds'\)/);
  assert.match(shopUxSource, /setShopDiamonds\(payload\.diamonds \?\? payload\.coins \?\? 0\)/);
  assert.doesNotMatch(shopUxSource, /shop-item-coin\b/);
  assert.doesNotMatch(shopUxSource, /🪙/);
});

test('renderShopItem shows Silver+ free items as an always-visible "Nhận miễn phí" pill, backend can_afford still gates the button', () => {
  const start = shopUxSource.indexOf('function renderShopItem');
  const end = shopUxSource.indexOf('const SHOP_FILTERS');
  assert.ok(start > -1 && end > start);
  const body = shopUxSource.slice(start, end);
  assert.match(body, /const isFree = item\.price === 0;/);
  assert.match(body, /Nhận miễn phí/);
  // Unchanged from before this redesign — buildShopView (backend) already
  // sends can_afford: true whenever price is 0, so the aria-disabled gate
  // doesn't need an extra isFree check (SPEC §3.2/§5).
  assert.match(body, /aria-disabled="\$\{item\.can_afford \? 'false' : 'true'\}"/);
});

test('showInsufficient reports the diamond deficit, not a coin deficit', () => {
  const start = shopUxSource.indexOf('export function showInsufficient');
  const end = shopUxSource.indexOf('export function wireShopModals');
  assert.ok(start > -1 && end > start);
  const body = shopUxSource.slice(start, end);
  assert.match(body, /Còn thiếu \$\{deficit\} 💎/);
});

// Founder-confirmed live bug, pre-existing before this packet: the
// insufficient-diamonds path was a click listener bound to the buy button
// ITSELF, gated on `button.disabled`. Browsers never dispatch click events
// to a natively-disabled button, so a real kid tapping an unaffordable item
// got nothing — no buzz, no modal. Fixed by switching to aria-disabled
// (semantic/visual only, never blocks dispatch). This test dispatches a
// REAL click event on the actual button element returned by the module's
// live initShopPage() — not a direct call to showInsufficient(), which
// would have passed before the fix and proven nothing.
test('a real tap on an unaffordable item fires the insufficient-diamonds modal with the correct deficit', async () => {
  const saved = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  try {
    const body = buildFakeShopPage();
    globalThis.document = {
      querySelector: (sel) => body.querySelector(sel),
      querySelectorAll: (sel) => body.querySelectorAll(sel),
      createElement: (tag) => new FakeElement(tag),
    };
    globalThis.window = { location: { search: '' } };
    globalThis.fetch = async (url) => {
      if (String(url).includes('read2lead-shop-list')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            // R2L-FLAVORBOT-TR6Q live-repro numbers: balance 40, an epic
            // priced 100 -> deficit 60.
            diamonds: 40,
            items: [
              { id: 'wings-epic-test', slot: 'wings', rarity: 'epic', price: 100, name: 'Cánh Epic', owned: false, can_afford: false },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    };

    const { initShopPage } = await import('../src/lib/shop-ux.ts');
    initShopPage({ confirmBuy: async () => true, onError: () => { throw new Error('onError should not fire in this scenario'); } });

    // Real user flow: type the code, tap "Vào cửa hàng" — a real click, not
    // a direct loadShop() call (loadShop isn't even exported).
    document.querySelector('#shop-code').value = 'R2L-FLAVORBOT-TR6Q';
    document.querySelector('#shop-load').click();
    await waitFor(() => document.querySelector('#shop-grid').querySelectorAll('.shop-item-buy').length > 0);

    const buyButton = document.querySelector('.shop-item-buy');
    assert.equal(buyButton.getAttribute('aria-disabled'), 'true', 'unaffordable item must render aria-disabled');
    assert.equal(buyButton.disabled, false, 'the fix: must NOT be natively disabled, or real taps never reach the handler');

    const modal = document.querySelector('.insufficient-modal');
    assert.equal(modal.open, false, 'sanity check: modal starts closed');

    // THE regression check — a genuine dispatched click on the card's own
    // button, exactly what a real tap produces.
    buyButton.dispatchEvent({ type: 'click' });

    assert.equal(modal.open, true, 'a real tap on the unaffordable item must open the insufficient-diamonds modal');
    assert.equal(modal.querySelector('.insufficient-title').textContent, 'Còn thiếu 60 💎', 'balance 40, price 100 -> deficit 60');
    assert.equal(modal.getAttribute('data-deficit'), '60');
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.fetch = saved.fetch;
  }
});

// Negative control for the fake-DOM harness itself: if a button IS natively
// disabled, dispatchEvent must NOT invoke its click listener — this is what
// makes the test above trustworthy (a harness that ignored `disabled`
// entirely would have let the OLD buggy code pass too).
test('fake DOM harness sanity check: a native-disabled button does not receive dispatched click events', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  let fired = false;
  button.addEventListener('click', () => { fired = true; });
  button.dispatchEvent({ type: 'click' });
  assert.equal(fired, false, 'a native-disabled button must not receive click events (this is the exact bug mechanism)');

  button.disabled = false;
  button.dispatchEvent({ type: 'click' });
  assert.equal(fired, true, 'once enabled, the same button must receive click events normally');
});
