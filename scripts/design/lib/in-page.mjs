// In-page check functions for the fidelity harness. Each function is passed to
// page.evaluate(), so it MUST be fully self-contained (no imports, no outer-scope
// references): Playwright serialises it with toString().
//
// Every function returns plain JSON. None of them mutate the page.

// ---------------------------------------------------------------------------
// Contract checks: order, texts, primary, columns.
//   args = { order: string[], texts: string[], primary: {id,text,minHeight}|null,
//            columns: {expected:number}|null }
export function contractChecks(args) {
  const norm = s => String(s).normalize('NFC').replace(/[\s ]+/g, ' ').trim();
  function visible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0 || r.bottom <= 0) return false; // parked off-screen (skip links etc.)
    return true;
  }
  const out = {};

  // -- order -------------------------------------------------------------
  const found = [];
  const missing = [];
  const hidden = [];
  for (const id of args.order) {
    const all = [...document.querySelectorAll('[data-design="' + id.replace(/"/g, '\\"') + '"]')];
    if (!all.length) { missing.push(id); continue; }
    const vis = all.find(visible);
    if (!vis) { hidden.push(id); continue; }
    const r = vis.getBoundingClientRect();
    found.push({ id, top: r.top + window.scrollY, el: vis });
  }
  const orderProblems = [];
  for (const id of missing) orderProblems.push('missing: ' + id);
  for (const id of hidden) orderProblems.push('present but not visible: ' + id);
  const multiCol = args.columns && args.columns.expected > 1;
  for (let i = 1; i < found.length; i++) {
    const a = found[i - 1], b = found[i];
    const domOk = !!(a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!domOk) orderProblems.push('DOM order: ' + b.id + ' comes before ' + a.id);
    else if (!multiCol && b.top < a.top - 1) orderProblems.push('vertical order: ' + b.id + ' (y=' + Math.round(b.top) + ') is above ' + a.id + ' (y=' + Math.round(a.top) + ')');
  }
  out.order = { problems: orderProblems, orderMode: multiCol ? 'dom-order (multi-column)' : 'dom-order + vertical', tops: found.map(f => f.id + '@' + Math.round(f.top)) };

  // -- texts -------------------------------------------------------------
  const body = norm(document.body.innerText || '');
  out.texts = { missing: args.texts.filter(t => !body.includes(norm(t))) };

  // -- primary -----------------------------------------------------------
  if (args.primary) {
    const all = [...document.querySelectorAll('[data-design="' + args.primary.id.replace(/"/g, '\\"') + '"]')];
    const vis = all.filter(visible);
    const p = [];
    if (all.length !== 1) p.push('expected exactly 1 element with data-design="' + args.primary.id + '", found ' + all.length);
    if (all.length >= 1 && vis.length === 0) p.push('primary is not visible');
    const el = vis[0] || all[0];
    let height = null, text = null;
    if (el) {
      height = el.getBoundingClientRect().height;
      text = norm(el.innerText || el.textContent || '');
      if (!text.includes(norm(args.primary.text))) p.push('primary text "' + text + '" does not include "' + args.primary.text + '"');
      if (args.primary.minHeight != null && height < args.primary.minHeight - 0.5) p.push('primary height ' + height.toFixed(1) + 'px < min ' + args.primary.minHeight + 'px');
    }
    // Soft signal only (reported as a warning): other visible buttons/links painted in the sun fill.
    const sun = 'rgb(255, 200, 61)';
    const sunOthers = [...document.querySelectorAll('a,button,[role=button]')].filter(e => visible(e) && getComputedStyle(e).backgroundColor === sun && !all.includes(e) && !all.some(a => a.contains(e) || e.contains(a)));
    out.primary = { problems: p, height, text, sunLookalikes: sunOthers.map(e => norm(e.innerText || '').slice(0, 40)) };
  }

  // -- columns -----------------------------------------------------------
  if (args.columns) {
    const cols = [...document.querySelectorAll('[data-design-col]')].filter(visible);
    out.columns = { expected: args.columns.expected, actual: cols.length };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Accessibility-ish checks: contrast >= 4.5:1 and tap targets >= 48px.
// Contrast is an APPROXIMATION (see README-LOCK.md "Known limits").
export function a11yChecks(args) {
  const minRatio = args.minRatio || 4.5;
  const minTap = args.minTap || 48;
  function visible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0;
  }
  function parse(str) {
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) {
      let a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return [+m[1], +m[2], +m[3], a];
    }
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) {
      let a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return [+m[1] * 255, +m[2] * 255, +m[3] * 255, a];
    }
    return null;
  }
  const over = (top, bot) => {
    const a = top[3];
    return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
  };
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  // Effective background: stack ancestor background-colors until an opaque one.
  // Any background-image (gradient/url) met on the way => indeterminate (skipped, counted).
  function backdrop(el) {
    const layers = [];
    let opaque = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c === null) return null;
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) { opaque = true; break; } }
    }
    let base = [255, 255, 255, 1];
    if (!opaque) base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  function opacityChain(el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  }

  const seen = new Set();
  const fails = [];
  let checked = 0, indeterminate = 0, svgSkipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.replace(/[\s ]+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
    if (el.closest('svg')) { svgSkipped++; continue; }
    if (!visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    if (![...rects].some(r => r.width > 0 && r.height > 0)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    let fg = parse(cs.color);
    const bg = backdrop(el);
    if (!fg || !bg) { indeterminate++; continue; }
    fg = [fg[0], fg[1], fg[2], fg[3] * opacityChain(el)];
    const fgEff = over(fg, bg);
    const r = ratio(fgEff, bg);
    checked++;
    if (r < minRatio) fails.push({ text: text.slice(0, 50), ratio: +r.toFixed(2), tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') });
  }

  // Tap targets
  const tapFails = [];
  let tapChecked = 0;
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    if (el.disabled) { /* disabled controls are still touch targets; keep them */ }
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue; // visually-hidden helpers
    tapChecked++;
    if (r.height < minTap - 0.5) tapFails.push({ el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30), height: +r.height.toFixed(1) });
  }
  return { contrast: { checked, indeterminate, svgSkipped, fails }, tap: { checked: tapChecked, fails: tapFails } };
}

export function overflowCheck() {
  const de = document.documentElement;
  return { scrollWidth: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0), innerWidth: window.innerWidth };
}

export function animationCheck() {
  const running = document.getAnimations()
    .filter(a => a.playState === 'running' && !(typeof CSSTransition !== 'undefined' && a instanceof CSSTransition))
    .map(a => (a.animationName || (a.effect && a.effect.getKeyframes ? 'web-animation' : 'unknown')) + ' on ' + ((a.effect && a.effect.target && a.effect.target.tagName) || '?').toLowerCase());
  return { running };
}

export function fontCheck() {
  return [...document.fonts].map(f => ({ family: f.family, status: f.status }));
}
