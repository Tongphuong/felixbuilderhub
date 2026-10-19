// In-page check functions for the fidelity harness. Each function is passed to
// page.evaluate(), so it MUST be fully self-contained (no imports, no outer-scope
// references): Playwright serialises it with toString().
//
// Every function returns plain JSON. None of them mutate the page (except `hit-test`
// scrolling in sunControlProblems, which restores the scroll position).

// ---------------------------------------------------------------------------
// scanText: walk EVERY text node (HTML and SVG) and describe it. Used for the `texts`
// check, the primary text, the contrast check, the state markers. Never uses
// innerText, never reads alt / aria-label / placeholder / value.
//   Each item: { text, tag, svg, blockId, top, bottom, rect:{x,y,w,h} (document px),
//                fontSize, vis:true|false, why (when !vis), fg:[r,g,b,a]|null,
//                bg:[r,g,b,1]|null (null = needs pixel sampling), designIds:[...] }
export function scanText() {
  const de = document.documentElement;
  const docW = Math.max(de.scrollWidth, window.innerWidth);
  const docH = Math.max(de.scrollHeight, document.body.scrollHeight);
  function parse(str) {
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]))];
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]))];
    return null;
  }
  const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3]), 1];
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

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
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  function clipped(el, r) {
    for (let n = el; n && n.nodeType === 1 && n !== document.body && n !== de; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const nb = n.getBoundingClientRect();
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        if (nb.width <= 0 || nb.height <= 0) return 'clipped to zero size by overflow';
        if (r.right <= nb.left || r.left >= nb.right || r.bottom <= nb.top || r.top >= nb.bottom) return 'outside its overflow-clipping parent';
      }
      if (cs.clipPath && cs.clipPath !== 'none') {
        let m = /^inset\(([^)]*)\)/.exec(cs.clipPath);
        if (m) {
          const v = m[1].split(/[\s,]+/).filter(Boolean).map(x => (x.endsWith('%') ? parseFloat(x) : (parseFloat(x) / (nb.height || 1)) * 100));
          const [t, rr = t, b = t, l = rr] = v;
          if (t + b >= 100 || l + rr >= 100) return 'clip-path inset hides it';
        }
        if (/^(circle|ellipse)\(\s*0(px|%)?[\s)]/.test(cs.clipPath)) return 'clip-path of zero size';
      }
      if (cs.clip && cs.clip !== 'auto') {
        const nums = (cs.clip.match(/-?[\d.]+/g) || []).map(Number);
        if (nums.length === 4 && (nums[0] >= nums[2] || nums[3] >= nums[1])) return 'clip: rect() of zero area';
      }
    }
    return null;
  }
  const blockOf = el => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const d = getComputedStyle(n).display;
      if (d !== 'inline' && d !== 'contents' && !d.startsWith('inline-') && d !== 'ruby') return n;
    }
    return document.body;
  };
  const blocks = new Map();
  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.replace(/[\s ]+/g, '')) continue;
    const el = node.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE'].includes(el.tagName)) continue;
    const svg = !!el.closest('svg');
    const it = { text: node.nodeValue, tag: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''), svg, vis: false, why: null, designIds: [] };
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const d = n.getAttribute('data-design'); if (d) it.designIds.push(d); }
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    let opacity = 1, hidden = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') { hidden = 'display:none'; break; }
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') { hidden = 'visibility:hidden'; break; }
      opacity *= parseFloat(cs.opacity);
    }
    const cs = getComputedStyle(el);
    it.fontSize = parseFloat(cs.fontSize);
    if (!rects.length) { it.why = hidden || 'no rendered box'; items.push(it); continue; }
    const u = rects.reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    it.rect = { x: u.left + scrollX, y: u.top + scrollY, w: u.right - u.left, h: u.bottom - u.top };
    it.top = it.rect.y; it.bottom = it.rect.y + it.rect.h;
    const b = blockOf(el);
    if (!blocks.has(b)) blocks.set(b, blocks.size);
    it.blockId = blocks.get(b);
    if (hidden) it.why = hidden;
    else if (opacity <= 0.01) it.why = 'effective opacity 0';
    else if (it.fontSize < 12) it.why = 'font-size ' + it.fontSize + 'px < 12px';
    else if (it.rect.x + it.rect.w <= 0 || it.rect.y + it.rect.h <= 0 || it.rect.x >= docW || it.rect.y >= docH) it.why = 'outside the document';
    else it.why = clipped(el, u);
    // colours
    let fg = parse(svg ? cs.fill : cs.color);
    if (fg && svg) fg[3] *= parseFloat(cs.fillOpacity || '1');
    if (fg) fg = [fg[0], fg[1], fg[2], fg[3] * opacity];
    it.fg = fg;
    it.bg = svg ? null : backdrop(el);
    if (!it.why) {
      it.vis = true;
      if (fg && it.bg) { const eff = over(fg, it.bg); it.ratio = ratio(eff, it.bg); it.fgEff = eff; if (it.ratio < 1.1) { it.vis = false; it.why = 'text colour equals its background'; } }
    }
    items.push(it);
  }
  return { items, docW, docH };
}

// ---------------------------------------------------------------------------
// Contract checks that need the DOM: order (+ minimum size), primary, sun rule, columns.
//   args = { order: string[], primary: {id,minHeight}|null, columns: {expected}|null }
export function contractChecks(args) {
  function visible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0 || r.bottom <= 0) return false;
    return true;
  }
  const out = {};
  const sel = id => '[data-design="' + id.replace(/"/g, '\\"') + '"]';

  const found = [], missing = [], hidden = [], tiny = [];
  for (const id of args.order) {
    const all = [...document.querySelectorAll(sel(id))];
    if (!all.length) { missing.push(id); continue; }
    const vis = all.find(visible);
    if (!vis) { hidden.push(id); continue; }
    const r = vis.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) tiny.push(id + ' is ' + Math.round(r.width) + 'x' + Math.round(r.height) + 'px (min 40x24; a 1px mark is not a section)');
    found.push({ id, top: r.top + window.scrollY, el: vis });
  }
  const orderProblems = [];
  for (const id of missing) orderProblems.push('missing: ' + id);
  for (const id of hidden) orderProblems.push('present but not visible: ' + id);
  for (const t of tiny) orderProblems.push('too small: ' + t);
  const multiCol = args.columns && args.columns.expected > 1;
  for (let i = 1; i < found.length; i++) {
    const a = found[i - 1], b = found[i];
    const domOk = !!(a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!domOk) orderProblems.push('DOM order: ' + b.id + ' comes before ' + a.id);
    else if (!multiCol && b.top < a.top - 1) orderProblems.push('vertical order: ' + b.id + ' (y=' + Math.round(b.top) + ') is above ' + a.id + ' (y=' + Math.round(a.top) + ')');
  }
  out.order = { problems: orderProblems, orderMode: multiCol ? 'dom-order (multi-column)' : 'dom-order + vertical', missing, hidden };

  if (args.primary) {
    const all = [...document.querySelectorAll(sel(args.primary.id))];
    const vis = all.filter(visible);
    const p = [];
    if (all.length !== 1) p.push('expected exactly 1 element with data-design="' + args.primary.id + '", found ' + all.length);
    if (all.length >= 1 && vis.length === 0) p.push('primary is not visible');
    const el = vis[0] || all[0];
    let height = null;
    if (el) {
      height = el.getBoundingClientRect().height;
      if (args.primary.minHeight != null && height < args.primary.minHeight - 0.5) p.push('primary height ' + height.toFixed(1) + 'px < min ' + args.primary.minHeight + 'px');
    }
    // "Exactly one sun primary": among everything CLICKABLE, exactly one visible element may be
    // sun-filled (solid #FFC83D +-6/channel, or a gradient whose stops are mostly sun), and it must
    // be the primary (or inside / around it). Non-interactive sun fills (bars, badges, tiles) are fine.
    const near = (c, t) => Math.abs(c[0] - t[0]) <= 6 && Math.abs(c[1] - t[1]) <= 6 && Math.abs(c[2] - t[2]) <= 6;
    const SUN = [255, 200, 61];
    const rgbs = s => [...s.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/g)].map(m => [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]]);
    const isSun = e => {
      const cs = getComputedStyle(e);
      const solid = rgbs(cs.backgroundColor)[0];
      if (solid && solid[3] >= 0.99 && near(solid, SUN)) return true;
      if (/gradient\(/.test(cs.backgroundImage)) { const st = rgbs(cs.backgroundImage).filter(c => c[3] > 0.5); if (st.length && st.filter(c => near(c, SUN)).length * 2 > st.length) return true; }
      return false;
    };
    const CLICK = 'a,button,summary,[role=button],[role=link],input[type=submit],input[type=button],input[type=reset]';
    const clickable = e => {
      if (e.matches(CLICK) || e.hasAttribute('onclick') || typeof e.onclick === 'function') return true;
      if (getComputedStyle(e).cursor !== 'pointer') return false;
      // cursor:pointer that actually receives a click: hit-test its centre (scroll, then restore).
      const sx = scrollX, sy = scrollY;
      const r0 = e.getBoundingClientRect();
      window.scrollTo(sx, sy + r0.top - innerHeight / 2 + r0.height / 2);
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      window.scrollTo(sx, sy);
      return !!hit && (hit === e || e.contains(hit));
    };
    const cand = [...document.querySelectorAll('body *')].filter(e => visible(e) && isSun(e) && clickable(e));
    const sunControls = cand.filter(e => !cand.some(o => o !== e && o.contains(e)));
    const label = e => '"' + (e.textContent || e.value || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 30) + '"';
    if (sunControls.length !== 1) p.push('expected exactly 1 sun-filled clickable control, found ' + sunControls.length + (sunControls.length ? ': ' + sunControls.map(label).join(', ') : ''));
    else if (!all.some(a => a === sunControls[0] || a.contains(sunControls[0]) || sunControls[0].contains(a))) p.push('the only sun-filled clickable ' + label(sunControls[0]) + ' is not the primary [data-design="' + args.primary.id + '"]');
    out.primary = { problems: p, height };
  }

  if (args.columns) {
    const cols = [...document.querySelectorAll('[data-design-col]')].filter(visible);
    out.columns = { expected: args.columns.expected, actual: cols.length };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tap targets (>= minTap px tall).
export function tapChecks(args) {
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
  const fails = [];
  let checked = 0;
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    checked++;
    if (r.height < minTap - 0.5) fails.push({ el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), text: (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30), height: +r.height.toFixed(1) });
  }
  return { checked, fails };
}

export function overflowCheck() {
  const de = document.documentElement;
  return { scrollWidth: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0), innerWidth: window.innerWidth };
}

// Reduced motion (structural half): running Web/CSS animations, plus ANY element whose computed
// animation-name is not "none" unless every duration is ~0 (a zero-duration fade) or the name is allowed.
export function motionCheck(args) {
  const allow = new Set(args.allow || []);
  const running = document.getAnimations()
    .filter(a => a.playState === 'running' && !(typeof CSSTransition !== 'undefined' && a instanceof CSSTransition))
    .map(a => (a.animationName || 'web-animation') + ' on ' + ((a.effect && a.effect.target && a.effect.target.tagName) || '?').toLowerCase());
  const named = [];
  for (const e of document.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (!cs.animationName || cs.animationName === 'none') continue;
    const names = cs.animationName.split(',').map(s => s.trim());
    const durs = cs.animationDuration.split(',').map(s => parseFloat(s) * (s.trim().endsWith('ms') ? 0.001 : 1));
    names.forEach((n, i) => { if (n !== 'none' && !allow.has(n) && (durs[i % durs.length] || 0) > 0.001) named.push(n + ' on ' + e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '')); });
  }
  return { running, named };
}

export function addStillClass() {
  for (const e of [document.documentElement, document.body, ...document.querySelectorAll('.r2l')]) e.classList.add('still');
}

export function fontCheck() {
  return [...document.fonts].map(f => ({ family: f.family.replace(/^["']|["']$/g, ''), status: f.status }));
}

// Built-page font resolution: headings + buttons -> Baloo 2, paragraph/list text -> Nunito.
// (The body element itself is not checked: the mocks set the font on their .r2l root, not on body.)
export function fontUsage() {
  const first = e => getComputedStyle(e).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const shown = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const bad = [];
  const pick = (selector, want) => {
    let n = 0;
    for (const e of document.querySelectorAll(selector)) {
      if (!shown(e) || !(e.textContent || e.value || '').trim()) continue;
      n++;
      if (first(e).toLowerCase() !== want.toLowerCase()) bad.push(e.tagName.toLowerCase() + ' "' + (e.textContent || e.value || '').trim().slice(0, 20) + '" uses ' + first(e) + ', want ' + want);
    }
    return n;
  };
  const headings = pick('h1,h2,h3,h4,h5,h6', 'Baloo 2');
  const buttons = pick('button,[role=button],input[type=submit]', 'Baloo 2');
  const paras = pick('p,li', 'Nunito');
  return { bad, headings, buttons, paras };
}

// Mock side: for each anchor text, the box of the smallest "card or section" ancestor.
//   card/section = a non-inline element with a border, or a background (colour/image), or height >= 60px.
export function mockBoxes(anchors) {
  const norm = s => String(s).normalize('NFC').replace(/[\s ]+/g, ' ').trim();
  const de = document.documentElement;
  const out = { docH: Math.max(de.scrollHeight, document.body.scrollHeight), docW: Math.max(de.scrollWidth, innerWidth), boxes: {} };
  for (const [id, text] of Object.entries(anchors)) {
    let node = null;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (norm(n.nodeValue).includes(norm(text)) && n.parentElement && !n.parentElement.closest('svg,script,style')) { node = n; break; }
    if (!node) { out.boxes[id] = null; continue; }
    let box = null;
    for (let e = node.parentElement; e && e !== document.body && e !== de; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const r = e.getBoundingClientRect();
      const border = ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
      const bg = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none';
      if (border || bg || r.height >= 60) { box = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; break; }
    }
    out.boxes[id] = box;
  }
  return out;
}

export function builtBoxes(ids) {
  const de = document.documentElement;
  const out = { docH: Math.max(de.scrollHeight, document.body.scrollHeight), boxes: {} };
  for (const id of ids) {
    const all = [...document.querySelectorAll('[data-design="' + id.replace(/"/g, '\\"') + '"]')];
    const e = all.find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!e) { out.boxes[id] = null; continue; }
    const r = e.getBoundingClientRect();
    out.boxes[id] = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }
  return out;
}

// State markers for the default driver: visible clickable labels + logged-in evidence.
export function stateProbe() {
  const shown = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const labels = [...document.querySelectorAll('a,button,[role=button],input[type=submit]')].filter(shown).map(e => (e.textContent || e.value || '').replace(/\s+/g, ' ').trim());
  const entryForm = [...document.querySelectorAll('#home-entry-form,#home-code')].some(shown);
  // The greeting may be split across inline elements ("Chào <span>Linh</span>!"), so match element text.
  const greeting = (() => { for (const e of document.querySelectorAll('h1,h2,h3,[data-design="home.hero"]')) { const t = (e.textContent || '').replace(/\s+/g, ' ').trim(); if (/^Chào\s+\S+!/.test(t) && shown(e)) return t; } return null; })();
  return { labels, entryForm, greeting, url: location.pathname };
}
