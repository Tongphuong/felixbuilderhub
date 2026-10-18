import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const page = fs.readFileSync(new URL('../src/pages/read2lead/lesson.astro', import.meta.url), 'utf8');

function extract(name) {
  const start = page.indexOf(`  function ${name}(`);
  assert.ok(start > 0, `${name} exists`);
  const end = page.indexOf('\n  }\n', start) + 4;
  return page.slice(start, end);
}

function bookState(pageIndex, total, pending = false) {
  return {
    bookReader: { pageIndex, chunkIndex: 0 },
    lesson: { book_images: Array.from({ length: total }, () => ({})) },
    pending,
  };
}

test('F1: last page — shadow-continue says "Hoàn thành trang →", the real save button says "Lưu chiến công 💾"', () => {
  const next = { disabled: true, textContent: '' };
  const state = bookState(2, 3);
  const ctx = {
    state,
    bookPageState: () => ({ page_reads: [{ status: 'done' }] }),
    qs: () => next,
  };
  vm.createContext(ctx);
  vm.runInContext(`${extract('bookShadowContinueLabel')}${extract('bookUpdateNavigation')};this.label=bookShadowContinueLabel;this.nav=bookUpdateNavigation;`, ctx);
  assert.equal(ctx.label(), 'Hoàn thành trang →');
  ctx.nav();
  assert.equal(next.textContent, 'Lưu chiến công 💾');
  // The non-saving step never wears a "save" label.
  assert.doesNotMatch(ctx.label(), /Lưu/);
});

test('F1: earlier pages keep their labels', () => {
  const next = { disabled: true, textContent: '' };
  const ctx = { state: bookState(0, 3), bookPageState: () => ({ page_reads: [{ status: 'done' }] }), qs: () => next };
  vm.createContext(ctx);
  vm.runInContext(`${extract('bookShadowContinueLabel')}${extract('bookUpdateNavigation')};this.label=bookShadowContinueLabel;this.nav=bookUpdateNavigation;`, ctx);
  assert.equal(ctx.label(), 'Trang tiếp →');
  ctx.nav();
  assert.equal(next.textContent, 'Trang tiếp →');
});

test('F3: finish card dismisses toast, combo badge and speaking feedback, and the finish path calls it', () => {
  const toast = { style: { opacity: '1' }, textContent: 'Minny cần nghe được ít nhất 50%', _hideTimer: 0 };
  const combo = { dataset: { visible: 'true' }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const slots = [0, 1].map(() => ({ textContent: 'x', cls: new Set(), classList: { add() {} } }));
  slots.forEach((s) => { s.classList = { add: (c) => s.cls.add(c) }; });
  const ctx = {
    clearTimeout,
    document: {
      querySelector: (sel) => (sel === '#r2l-toast' ? toast : sel === '.w2-combo-counter' ? combo : null),
      querySelectorAll: () => slots,
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`${extract('dismissFinishOverlays')};this.go=dismissFinishOverlays;`, ctx);
  ctx.go();
  assert.equal(toast.style.opacity, '0');
  assert.equal(toast.textContent, '');
  assert.equal(combo.dataset.visible, 'false');
  assert.equal(combo.attrs['aria-hidden'], 'true');
  assert.ok(slots.every((s) => s.textContent === '' && s.cls.has('hidden')));
  const fn = extract('_r2lShowCompletionAfterTrivia');
  assert.ok(fn.indexOf("qs('#completion-card').classList.remove('hidden')") < fn.indexOf('dismissFinishOverlays()'), 'called after the card is shown');
  // no-op safety when nothing is on screen
  const empty = { clearTimeout, document: { querySelector: () => null, querySelectorAll: () => [] } };
  vm.createContext(empty);
  vm.runInContext(`${extract('dismissFinishOverlays')};dismissFinishOverlays();`, empty);
});

test('F2: "Đọc thêm truyện" on the cream finish card has its own light background, dark text and a >=44px target', () => {
  const rule = page.match(/body\[data-lesson-finished="true"\] #completion-new-pack\{([^}]*)\}/);
  assert.ok(rule, 'finish-card rule exists');
  const css = rule[1];
  // Root cause: story-mission.css gives `body .r2l-secondary` a navy background; the finish rule only set colour.
  assert.match(css, /background:#fff/);
  assert.match(css, /color:#17364e/);
  const min = Number(css.match(/min-height:(\d+)px/)?.[1]);
  assert.ok(min >= 44, `min-height ${min}`);
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [a, b] = [lum('#ffffff'), lum('#17364e')];
  assert.ok((a + 0.05) / (b + 0.05) >= 4.5);
});
