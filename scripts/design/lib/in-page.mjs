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
      if (cs.display === 'contents') continue; // no box of its own: its overflow clips nothing (a 0x0 rect is not "clipped to zero")
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
      // `clip` only applies to absolutely/fixed positioned boxes; honour it only for the tiny ".sr-only" kind (<= 2px box)
      if (cs.clip && cs.clip !== 'auto' && (cs.position === 'absolute' || cs.position === 'fixed') && nb.width <= 2 && nb.height <= 2) {
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
//   args = { order: string[], primary: {id,minHeight}|null, columns: {expected}|null,
//            minSize: {id: [w,h]} (per-id override of the default 40x24), viewportOnly: bool, mockBelowFold: string[] }
//   viewportOnly (contract "capture":"viewport"): an id may sit below the fold ONLY if its MOCK box does
//   (mockBelowFold: ids, from anchors / region mock boxes); then it is neither ordered nor size-checked.
//   Any other id that the build pushes below the fold or off-screen FAILS ("pushed below the fold").
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

  const found = [], missing = [], hidden = [], tiny = [], orderProblems0 = [];
  for (const id of args.order) {
    const all = [...document.querySelectorAll(sel(id))];
    if (!all.length) { missing.push(id); continue; }
    const vis = all.find(visible);
    if (!vis) { hidden.push(id); continue; }
    const r = vis.getBoundingClientRect();
    if (args.viewportOnly && (r.top >= window.innerHeight || r.bottom <= 0)) {
      if (!(args.mockBelowFold || []).includes(id)) orderProblems0.push('pushed below the fold: ' + id + ' (y=' + Math.round(r.top + window.scrollY) + ', viewport ' + window.innerHeight + 'px) but the mock shows it on screen');
      continue;
    }
    const [mw, mh] = (args.minSize && args.minSize[id]) || [40, 24];
    if (r.width < mw || r.height < mh) tiny.push(id + ' is ' + Math.round(r.width) + 'x' + Math.round(r.height) + 'px (min ' + mw + 'x' + mh + '; a 1px mark is not a section)');
    found.push({ id, top: r.top + window.scrollY, el: vis });
  }
  const orderProblems = [...orderProblems0];
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

  if (args.primary || args.noPrimary) {
    const all = args.primary ? [...document.querySelectorAll(sel(args.primary.id))] : [];
    const vis = all.filter(visible);
    const p = [];
    if (args.primary && all.length !== 1) p.push('expected exactly 1 element with data-design="' + args.primary.id + '", found ' + all.length);
    if (args.primary && all.length >= 1 && vis.length === 0) p.push('primary is not visible');
    const el = vis[0] || all[0];
    let height = null;
    if (el) {
      const pr = el.getBoundingClientRect();
      height = pr.height;
      if (args.viewportOnly && (pr.top >= window.innerHeight || pr.bottom <= 0) && !(args.mockBelowFold || []).includes(args.primary.id)) p.push('primary pushed below the fold (y=' + Math.round(pr.top + window.scrollY) + ', viewport ' + window.innerHeight + 'px)');
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
    // The mocks paint SELECTED toggles sun too (the active tab, category, option tile): they show a state, they are not the action.
    // The exemption is narrow, because "aria-pressed" on a Mua-ngay button is one attribute away from a hidden second action:
    // the control must ITSELF carry the selected state (never an ancestor), it must sit in a tab/radio/toolbar/listbox group or be a
    // checked radio/checkbox input, and it is never a submit control or a [data-design$=".primary"] element.
    const SELECTED = '[role=tab][aria-selected=true],[role=option][aria-selected=true],[aria-pressed=true],[aria-current]:not([aria-current=false]),[role=radio][aria-checked=true],[role=menuitemradio][aria-checked=true],[role=checkbox][aria-checked=true],[role=switch][aria-checked=true]';
    const GROUP = '[role=tablist],[role=radiogroup],[role=toolbar],[role=listbox]';
    const NEVER = 'input[type=submit],button[type=submit],form button:not([type]),[data-design$=".primary"]';
    const MEMBER = 'button,a[href],[role=tab],[role=radio],[role=option],[role=checkbox],[role=switch],[role=menuitemradio],input:not([type=hidden])';
    // A group only vouches for a selected member when it really is a SET of toggles: >= 2 member controls, at least one NOT sun-filled
    // (an all-sun or one-button "toolbar" is just a wrapper around actions), and, except for a toolbar (which may be multi-pressed),
    // at most one selected member.
    const groupOk = g => {
      const members = [...g.querySelectorAll(MEMBER)].filter(m => !m.parentElement.closest(MEMBER) || m.matches('input'));
      if (members.length < 2 || !members.some(m => !isSun(m))) return false;
      if (g.matches('[role=toolbar]')) return true;
      return members.filter(m => m.matches(SELECTED)).length <= 1;
    };
    const checkedInput = e => e.tagName === 'INPUT' && (e.type === 'radio' || e.type === 'checkbox') && e.checked;
    const isSelected = e => {
      if (e.matches(NEVER)) return false;
      if (checkedInput(e)) return true;
      if (e.matches('label') && !!e.querySelector('input[type=radio]:checked,input[type=checkbox]:checked')) return true;
      const g = e.closest(GROUP);
      return e.matches(SELECTED) && !!g && groupOk(g);
    };
    const cand0 = [...document.querySelectorAll('body *')].filter(e => visible(e) && isSun(e) && clickable(e) && !isSelected(e));
    // sun_also (Release 3): extra sun controls allowed at this width. Each listed element MUST be an in-page anchor (a[href^="#"]);
    // a sun <button> or an off-page link listed there is itself a failure and is NOT let through.
    const alsoOk = [];
    for (const id of args.sunAlso || []) {
      const els = [...document.querySelectorAll(sel(id))].filter(visible);
      if (!els.length) { p.push('sun_also "' + id + '": no visible element with that data-design'); continue; }
      for (const e of els) {
        if (e.matches('a[href^="#"]')) alsoOk.push(e);
        else p.push('sun_also "' + id + '" is not an in-page anchor (a[href^="#"]): <' + e.tagName.toLowerCase() + (e.getAttribute('href') != null ? ' href="' + e.getAttribute('href') + '"' : '') + '>');
      }
    }
    // only the anchor ITSELF is exempt: a sun control nested inside it (a <button> in the link) or wrapping it is still a second action
    const cand = cand0.filter(e => !alsoOk.some(a => a === e));
    const sunControls = cand.filter(e => !cand.some(o => o !== e && o.contains(e)));
    const label = e => '"' + (e.textContent || e.value || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 30) + '"';
    if (args.noPrimary) {
      if (sunControls.length) p.push('primary.none: expected NO sun-filled clickable control in this state, found ' + sunControls.length + ': ' + sunControls.map(label).join(', '));
    } else if (sunControls.length !== 1) p.push('expected exactly 1 sun-filled clickable control, found ' + sunControls.length + (sunControls.length ? ': ' + sunControls.map(label).join(', ') : ''));
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

export function removeStillClass() {
  for (const e of [document.documentElement, document.body, ...document.querySelectorAll('.r2l')]) e.classList.remove('still');
}

export function fontCheck() {
  return [...document.fonts].map(f => ({ family: f.family.replace(/^["']|["']$/g, ''), status: f.status }));
}

// Built-page font resolution: headings + primary/secondary buttons + every class the DESIGN CSS sets in Baloo 2 AND the mock
// renders in Baloo 2 (.chip, .back, .bubble, .btn, .d ...) -> Baloo 2; paragraph/list text -> Nunito; any real button / role=button /
// tab in a font that is neither design family (Arial ...) is a failure. Tabs and filter chips that the mock renders in Nunito stay Nunito.
// (The body element itself is not checked: the mocks set the font on their .r2l root, not on body.)
// args.balooClasses: class names (from mockBalooClasses on the MOCK page). Falls back to the btn classes only.
export function fontUsage(args) {
  const balooClasses = (args && args.balooClasses) || ['btn', 'r2l-btn'];
  const first = e => getComputedStyle(e).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const shown = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const bad = [];
  const desc = e => e.tagName.toLowerCase() + ' "' + (e.textContent || e.value || '').trim().slice(0, 20) + '"';
  const pick = (selector, want) => {
    let n = 0;
    for (const e of document.querySelectorAll(selector)) {
      if (!shown(e) || !(e.textContent || e.value || '').trim()) continue;
      n++;
      if (first(e).toLowerCase() !== want.toLowerCase()) bad.push(desc(e) + ' uses ' + first(e) + ', want ' + want);
    }
    return n;
  };
  const headings = pick('h1,h2,h3,h4,h5,h6', 'Baloo 2');
  const classSel = balooClasses.map(c => '.' + CSS.escape(c)).join(',');
  const buttons = pick('[data-design$=".primary"],[data-design$=".secondary"]' + (classSel ? ',' + classSel : ''), 'Baloo 2');
  const paras = pick('p,li', 'Nunito');
  // every other real control: a design family (Baloo 2 or Nunito), never a browser default
  for (const e of document.querySelectorAll('button,a[role=button],[role=tab],input[type=submit],input[type=button]')) {
    if (!shown(e) || !(e.textContent || e.value || '').trim()) continue;
    const f = first(e).toLowerCase();
    if (f !== 'baloo 2' && f !== 'nunito') bad.push(desc(e) + ' uses ' + first(e) + ', want Baloo 2 or Nunito');
  }
  return { bad: [...new Set(bad)], headings, buttons, paras };
}

// Mock page: which of the design CSS's Baloo-2 classes the mock really renders in Baloo 2 on EVERY visible instance
// (03-minny-voice overrides .bubble to Nunito, so .bubble is not required there).
export function mockBalooClasses(classes) {
  const first = e => getComputedStyle(e).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  const out = [];
  for (const c of classes) {
    const els = [...document.querySelectorAll('.' + CSS.escape(c))].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.textContent || e.value || '').trim(); });
    if (els.length && els.every(e => first(e) === 'baloo 2')) out.push(c);
  }
  return out;
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

// ---------------------------------------------------------------------------
// Release 3 `locate` / `locate_cols`: for elements that cannot carry data-design (lesson.astro is protected).
//   args = { locate: {id: selector}, cols: [selector], needed: [id] }
// [data-design="id"] wins when present. Otherwise the selector must match EXACTLY ONE visible element (0 or > 1 FAILS, but only for
// `needed` ids: a step the state does not show is not a failure). The located element is STAMPED with data-design="id" on the
// throwaway BUILT page (never the mock), so order, regions, min_size, primary, anchors and never_red all see it unchanged.
// `cols` selectors: every visible match gets data-design-col (the layout column count reads that attribute).
export function resolveLocate(args) {
  function visible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0;
  }
  const problems = [];
  const placed = {};
  const needed = new Set(args.needed || []);
  for (const [id, selector] of Object.entries(args.locate || {})) {
    if (document.querySelector('[data-design="' + id.replace(/"/g, '\\"') + '"]')) continue; // data-design first
    let all;
    try { all = [...document.querySelectorAll(selector)]; } catch { if (needed.has(id)) problems.push('locate "' + id + '": invalid selector ' + selector); continue; }
    const vis = all.filter(visible);
    if (vis.length !== 1) { if (needed.has(id)) problems.push('locate "' + id + '" (' + selector + '): ' + vis.length + ' visible match' + (vis.length === 1 ? '' : 'es') + (all.length !== vis.length ? ' (' + all.length + ' in the DOM)' : '') + ', need exactly 1'); continue; }
    const el = vis[0];
    // a selector that resolves to the whole page matches EVERY check trivially: never a legitimate locate
    if (el === document.body || el === document.documentElement) { if (needed.has(id)) problems.push('locate "' + id + '" (' + selector + '): resolves to <' + el.tagName.toLowerCase() + '>, the whole page'); continue; }
    const other = el.getAttribute('data-design');
    if (other && other !== id) { if (needed.has(id)) problems.push('locate "' + id + '" (' + selector + '): that element already carries data-design="' + other + '"'); continue; }
    el.setAttribute('data-design', id);
    placed[id] = el;
  }
  // a catch-all wrapper (an ancestor of at least 3 other located elements and half of them) also matches everything inside it
  const placedIds = Object.keys(placed);
  const wrappers = new Set(args.wrappers || []); // layout_only `locate_wrappers`: ids declared to be a container ON PURPOSE (their `contained` check IS the box)
  for (const id of placedIds) {
    if (!needed.has(id) || wrappers.has(id)) continue;
    const inside = placedIds.filter(o => o !== id && placed[id].contains(placed[o]));
    if (inside.length >= 3 && inside.length * 2 >= placedIds.length - 1) problems.push('locate "' + id + '" (' + (args.locate[id]) + '): is an ancestor of ' + inside.length + ' other located elements (' + inside.slice(0, 4).join(', ') + '); a located id must be its own element, not a wrapper');
  }
  let cols = 0;
  for (const selector of args.cols || []) {
    let all = [];
    try { all = [...document.querySelectorAll(selector)].filter(visible); } catch { problems.push('locate_cols: invalid selector ' + selector); continue; }
    for (const e of all) { e.setAttribute('data-design-col', ''); cols++; }
  }
  return { problems, cols };
}

// never_red (Release 3): inside each id, no TEXT colour, background or border may be coral #FF7A3D or Minny red #E0362C (computed
// styles). Raster images are excluded (<img>/<picture>/<video>/<canvas>), so Minny's own ring is fine.
// A text colour only counts on an element that has its own text (an inherited colour on an empty box is not text).
// R2L-MAINT-1 D5: INLINE <svg> is no longer excluded: the computed `fill`, `stroke` and `stop-color` of every shape inside it are checked too.
// Every colour is first normalised to sRGB by `parseCssColor` (lib/color.mjs: rgb(), hex, hsl, hwb, lab, lch, oklab, oklch, color(srgb | display-p3 | ...)),
// then matched against the two brand colours with a tolerance of +-3 per channel (out of 255). A colour string that cannot be read is a FAILURE,
// not a pass ("cannot read colour ..."): a verifier that cannot read what it checks must not say "safe".
// Accepted residual (one line): a wrapper id that only encloses 2 located ids passes the locate wrapper test, so never_red on it can cover fewer elements than intended.
// Not covered: <use>/<symbol> shadow trees, CSS variables inside SVG <style> (the computed value IS checked), and colours painted by filters or blend modes.
// parseCssColor is passed in as the 2nd argument (fidelity.mjs ships its source next to this function), because page.evaluate serialises ONE function.
export function neverRedCheck(args, parseCssColor) {
  if (typeof parseCssColor !== 'function') throw new Error('neverRedCheck needs parseCssColor (lib/color.mjs) as its second argument');
  function visible(el, box = true) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    }
    if (!box) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  const REDS = [['#FF7A3D', [255, 122, 61]], ['#E0362C', [224, 54, 44]]];
  const TOL = 3; // per channel, out of 255
  const unreadable = new Set();
  // every colour inside one computed value (a single colour, a shadow list, a gradient): null entries = unreadable, reported once at the end
  const COLOUR_FN = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-fA-F]{3,8}\b/g;
  const colours = str => {
    // a paint-server reference (fill="url(#g)") is not a colour: the gradient's own <stop>s are checked as svg parts
    str = String(str == null ? '' : str).replace(/url\((?:[^()]|\([^()]*\))*\)/g, '').trim();
    if (!str || /^(none|transparent|normal|context-fill|context-stroke)$/.test(str)) return [];
    if (!/[(#]/.test(str)) { const c = parseCssColor(str); if (c) return [c]; unreadable.add(str); return []; }
    const found = str.match(COLOUR_FN) || [];
    if (!found.length) { unreadable.add(str); return []; }
    const parsed = [];
    for (const f of found) { const c = parseCssColor(f); if (c) parsed.push(c); else unreadable.add(f); }
    return parsed;
  };
  const red = c => { if (!c || c[3] < 0.5) return null; const hit = REDS.find(([, t]) => Math.abs(c[0] - t[0]) <= TOL && Math.abs(c[1] - t[1]) <= TOL && Math.abs(c[2] - t[2]) <= TOL); return hit ? hit[0] : null; };
  const firstRed = str => { for (const c of colours(str)) { const h = red(c); if (h) return h; } return null; };
  const IMG = 'img,picture,video,canvas';
  const isSvgPart = e => typeof SVGElement !== 'undefined' && e instanceof SVGElement && e.localName !== 'svg';
  const problems = [];
  const desc = e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '') + ((e.textContent || '').trim() ? ' "' + e.textContent.replace(/\s+/g, ' ').trim().slice(0, 24) + '"' : '');
  for (const id of args.ids) {
    const roots = [...document.querySelectorAll('[data-design="' + id.replace(/"/g, '\\"') + '"]')].filter(el => visible(el));
    if (!roots.length) { problems.push('never_red "' + id + '": no visible element'); continue; }
    for (const root of roots) {
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (e.closest(IMG)) continue;
        // an SVG shape has no box of its own to measure (a horizontal <path> is 0px tall): it is visible when its <svg> is
        if (isSvgPart(e)) {
          const svg = e.ownerSVGElement;
          // (<stop>s live in <defs>, whose computed display is "none": a gradient is visible when the <svg> that carries it is)
          if (!svg || !visible(svg) || (e.localName !== 'stop' && !visible(e, false))) continue;
          const cs = getComputedStyle(e), hits = [];
          const f = firstRed(cs.fill); if (f && parseFloat(cs.fillOpacity) !== 0) hits.push('svg fill ' + f);
          { const s = firstRed(cs.stroke); if (s && parseFloat(cs.strokeOpacity) !== 0 && parseFloat(cs.strokeWidth) !== 0) hits.push('svg stroke ' + s); }
          if (e.localName === 'stop') { const st = firstRed(cs.stopColor); if (st) hits.push('svg stop-color ' + st); }
          if (hits.length) problems.push('never_red "' + id + '": ' + e.tagName.toLowerCase() + ' in an inline svg uses ' + hits.join(' + '));
          continue;
        }
        if (!visible(e)) continue;
        const ownText = [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
        // the element itself and its ::before / ::after (a coral dot or ring is often drawn there)
        for (const pseudo of [null, '::before', '::after']) {
          const cs = pseudo ? getComputedStyle(e, pseudo) : getComputedStyle(e);
          if (pseudo && (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none')) continue;
          const where = pseudo || '';
          const hits = [];
          const hasText = pseudo ? cs.content.replace(/^["']|["']$/g, '').trim() !== '' : ownText;
          if (hasText) {
            const h = firstRed(cs.color); if (h) hits.push('text colour ' + h);
            const f = firstRed(cs.webkitTextFillColor); if (f) hits.push('text fill ' + f);
            if (cs.textDecorationLine && cs.textDecorationLine !== 'none') { const d = firstRed(cs.textDecorationColor); if (d) hits.push('text decoration ' + d); }
            if (cs.textShadow && cs.textShadow !== 'none') { const s = firstRed(cs.textShadow); if (s) hits.push('text shadow ' + s); }
          }
          { const h = firstRed(cs.backgroundColor); if (h) hits.push('background ' + h); }
          if (/gradient\(/.test(cs.backgroundImage)) { const h = firstRed(cs.backgroundImage); if (h) hits.push('background gradient ' + h); }
          for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
            if (!(parseFloat(cs['border' + side + 'Width']) > 0) || cs['border' + side + 'Style'] === 'none') continue;
            const h = firstRed(cs['border' + side + 'Color']);
            if (h) { hits.push('border ' + h); break; }
          }
          if (cs.boxShadow && cs.boxShadow !== 'none') { const h = firstRed(cs.boxShadow); if (h) hits.push('box-shadow ' + h); }
          if (cs.outlineStyle && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) { const h = firstRed(cs.outlineColor); if (h) hits.push('outline ' + h); }
          if (hits.length) problems.push('never_red "' + id + '": ' + desc(e) + where + ' uses ' + hits.join(' + '));
        }
      }
    }
  }
  for (const u of unreadable) problems.push('never_red: cannot read the colour "' + u.slice(0, 60) + '" (unsupported colour syntax); refusing to call it safe');
  return problems;
}

// no_overlap / contained (R2L-MAINT-1 D4, layout-only contracts). Ids are [data-design] values (a `locate` selector has stamped them already).
//   args = { groups: string[][], contained: string[], optional: string[] }
//   groups: every pair inside one group must not share a visible area of 1px^2 or more (boxes are the elements' own bounding boxes).
//   contained: the element's content must fit its box: scrollHeight <= clientHeight + 1. This is what catches a fixed-height box whose
//   content spills out of it; the spilled content is NOT part of the box's own bounding box, so list the spilled child in a group as well.
//   An id with no visible element is a failure unless it is listed in `optional`.
// Returns { problems: string[], checked: number }.
export function layoutOnlyChecks(args) {
  function visible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  const optional = new Set(args.optional || []);
  const els = id => [...document.querySelectorAll('[data-design="' + id.replace(/"/g, '\\"') + '"]')].filter(visible);
  const box = e => { const r = e.getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY }; };
  const px = n => Math.round(n);
  const problems = [];
  let checked = 0;
  const missing = new Set();
  for (const group of args.groups || []) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const A = els(group[i]), B = els(group[j]);
        for (const [id, list] of [[group[i], A], [group[j], B]]) if (!list.length && !optional.has(id) && !missing.has(id)) { missing.add(id); problems.push('no_overlap "' + id + '": no visible element'); }
        for (const a of A) for (const b of B) {
          checked++;
          if (a === b) continue;
          const x = box(a), y = box(b);
          const w = Math.min(x.r, y.r) - Math.max(x.l, y.l), h = Math.min(x.b, y.b) - Math.max(x.t, y.t);
          if (w > 0 && h > 0 && w * h >= 1) problems.push('no_overlap: "' + group[i] + '" (y ' + px(x.t) + '-' + px(x.b) + ') overlaps "' + group[j] + '" (y ' + px(y.t) + '-' + px(y.b) + ') by ' + px(w) + 'x' + px(h) + 'px');
        }
      }
    }
  }
  for (const id of args.contained || []) {
    const list = els(id);
    if (!list.length) { if (!optional.has(id)) problems.push('contained "' + id + '": no visible element'); continue; }
    for (const e of list) {
      checked++;
      if (e.scrollHeight > e.clientHeight + 1) problems.push('contained "' + id + '": content is ' + e.scrollHeight + 'px tall in a ' + e.clientHeight + 'px box (overflows by ' + (e.scrollHeight - e.clientHeight) + 'px)');
    }
  }
  return { problems, checked };
}

// turnstile (Release 3): the third-party widget is masked out of the pixel diff, so its PRESENCE is asserted here.
// Pass = [data-design=id] is visible AND (it holds the widget's iframe OR the Turnstile api script tag is in the page, which is what an
// offline run, with no network to the widget host, can show). A missing container, or a container with neither, FAILS.
export function turnstileCheck(args) {
  const el = document.querySelector('[data-design="' + String(args.id).replace(/"/g, '\\"') + '"]');
  if (!el) return ['turnstile: no element with data-design="' + args.id + '" (the widget container is missing)'];
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return ['turnstile: the container data-design="' + args.id + '" is not visible'];
  const hasFrame = !!el.querySelector('iframe');
  const hasScript = !!document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
  if (!hasFrame && !hasScript) return ['turnstile: container "' + args.id + '" holds no iframe and the Turnstile api script tag is not in the page'];
  return [];
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

// ---------------------------------------------------------------------------
// Layout sanity on the BUILT page at the current viewport width. The mocks exist only at 390/1280, so in-between
// widths are checked for breakage a pixel diff can never see. Returns offenders [{kind, sel, detail}].
//   (a) overlap     two visible text LINES of different text nodes intersect by more than 2px (both axes)
//   (b) escape      an interactive control or [data-design] element sticks out of its nearest card/section
//                   (ancestor with a border or a background) by more than 2px; `allow` = overflow_allow list
//                   (data-design ids or CSS selectors) exempts element or card
//   (c) word-split  a line break falls INSIDE a word
//   (d) clipped     overflow:hidden|clip element whose text is cut off (scroll size > client size),
//                   except text-overflow: ellipsis
export function layoutSanity(args) {
  const allow = args.allow || [];
  const TOL = 2;        // escape (b) tolerance
  const OVERLAP_TOL = 1; // text ink overlap (a) tolerance
  const mustShow = (args.texts || []).map(t => String(t).replace(/[\s\u00a0]+/g, ' ').trim()).filter(Boolean);
  const sel = e => {
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    const dd = e.getAttribute('data-design'); if (dd) s += '[data-design="' + dd + '"]';
    else if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\s+/)[0];
    return s;
  };
  const shown = e => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      if (cs.contentVisibility === 'hidden') return false;
      // the body of a CLOSED <details> is measured by layout but never on screen (Release 3: it produced phantom 360px overlaps)
      const par = n.parentElement;
      if (par && par.tagName === 'DETAILS' && !par.open && n.tagName !== 'SUMMARY') return false;
    }
    return true;
  };
  // visually hidden by clipping (".sr-only" pattern): the text is not on screen, so it can neither overlap nor be clipped
  const clippedAway = e => {
    for (let n = e; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const nb = n.getBoundingClientRect();
      if (cs.display === 'contents') continue;
      if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && (nb.width <= 2 || nb.height <= 2)) return true;
      if (cs.clip && cs.clip !== 'auto' && (cs.position === 'absolute' || cs.position === 'fixed') && nb.width <= 2 && nb.height <= 2) { const nums = (cs.clip.match(/-?[\d.]+/g) || []).map(Number); if (nums.length === 4 && (nums[0] >= nums[2] || nums[3] >= nums[1])) return true; }
      if (cs.clipPath && /^inset\(\s*(50|[6-9]\d|100)%/.test(cs.clipPath)) return true;
    }
    return false;
  };
  const allowed = e => allow.some(a => { try { return e.matches('[data-design="' + a + '"]') || e.matches(a); } catch { return false; } });
  const allowedWithin = e => allow.some(a => { try { return !!e.closest('[data-design="' + a + '"]') || !!e.closest(a); } catch { return false; } });
  const out = [];

  // text nodes + their line rects
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) || el.closest('svg') || !shown(el) || clippedAway(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    if (rects.every(r => r.right <= 0 || r.bottom <= 0 || r.left >= document.documentElement.clientWidth + 5)) continue;
    // Range rects are the font's content area, taller than the glyphs. Use the real INK box: the baseline sits fontBoundingBoxAscent
    // below the rect top, and the ink reaches actualBoundingBoxAscent above / actualBoundingBoxDescent below it (canvas measureText
    // of this very text in this very font). Falls back to 90% of the font size when the metrics are missing.
    const cst = getComputedStyle(el);
    const fs = parseFloat(cst.fontSize) || 16;
    let inkAsc = null, inkDesc = null, fontAsc = null;
    try {
      const ctx2 = (layoutSanity._cv = layoutSanity._cv || document.createElement('canvas').getContext('2d'));
      ctx2.font = `${cst.fontStyle} ${cst.fontWeight} ${cst.fontSize} ${cst.fontFamily}`;
      let txt = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (cst.textTransform === 'uppercase') txt = txt.toUpperCase(); else if (cst.textTransform === 'lowercase') txt = txt.toLowerCase();
      const m = ctx2.measureText(txt);
      if (m.actualBoundingBoxAscent != null && m.fontBoundingBoxAscent != null) { inkAsc = m.actualBoundingBoxAscent; inkDesc = m.actualBoundingBoxDescent; fontAsc = m.fontBoundingBoxAscent; }
    } catch { /* fall back below */ }
    const glyphs = rects.map(r => {
      if (inkAsc != null) { const base = r.top + fontAsc; return { left: r.left, right: r.right, top: base - inkAsc, bottom: base + inkDesc }; }
      const h = Math.min(r.height, fs * 0.9), cy = r.top + r.height / 2;
      return { left: r.left, right: r.right, top: cy - h / 2, bottom: cy + h / 2 };
    });
    nodes.push({ n, el, rects, glyphs });
  }

  // (a) overlapping text lines of different nodes
  const seen = new Set();
  for (let i = 0; i < nodes.length && out.length < 40; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    if (a.el === b.el) continue;
    if (allowedWithin(a.el) || allowedWithin(b.el)) continue; // overflow_allow: text inside a listed element (or the element itself) may overlap
    let hit = null;
    for (const ra of a.glyphs) { for (const rb of b.glyphs) {
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > OVERLAP_TOL && h > OVERLAP_TOL) { hit = { w, h }; break; }
    } if (hit) break; }
    if (hit) {
      const key = sel(a.el) + '|' + sel(b.el);
      if (!seen.has(key)) { seen.add(key); out.push({ kind: 'overlap', sel: sel(a.el) + ' x ' + sel(b.el), detail: `"${a.n.nodeValue.trim().slice(0, 24)}" overlaps "${b.n.nodeValue.trim().slice(0, 24)}" by ${Math.round(hit.w)}x${Math.round(hit.h)}px` }); }
    }
  }

  // (b) controls / design elements escaping their card
  const hasBox = cs => ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none')
    || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none';
  for (const e of document.querySelectorAll('a,button,input,select,textarea,summary,[role=button],[data-design]')) {
    if (!shown(e) || allowed(e)) continue;
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' || cs.position === 'sticky') continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    let card = null;
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (hasBox(getComputedStyle(p)) && p.getBoundingClientRect().width > 1) { card = p; break; }
    }
    if (!card || allowed(card)) continue;
    const c = card.getBoundingClientRect();
    const over = [];
    if (r.left < c.left - TOL) over.push('left ' + Math.round(c.left - r.left) + 'px');
    if (r.right > c.right + TOL) over.push('right ' + Math.round(r.right - c.right) + 'px');
    if (r.top < c.top - TOL) over.push('top ' + Math.round(c.top - r.top) + 'px');
    if (r.bottom > c.bottom + TOL) over.push('bottom ' + Math.round(r.bottom - c.bottom) + 'px');
    if (over.length) out.push({ kind: 'escape', sel: sel(e) + ' in ' + sel(card), detail: 'sticks out of its card by ' + over.join(', ') });
  }

  // (c) a line break inside a word
  for (const { n, el, rects } of nodes) {
    if (rects.length < 2) continue;
    const text = n.nodeValue;
    const range = document.createRange();
    let prev = null, prevCh = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\p{M}/u.test(ch)) continue;
      if (/\s/.test(ch)) { prev = null; prevCh = ''; continue; }
      range.setStart(n, i); range.setEnd(n, i + 1);
      const rr = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)[0];
      if (!rr) continue;
      if (prev && prevCh && /[\p{L}\p{N}]/u.test(prevCh) && /[\p{L}\p{N}]/u.test(ch) && rr.top > prev.bottom - prev.height / 2 && rr.left < prev.left) {
        out.push({ kind: 'word-split', sel: sel(el), detail: `line break inside a word near "${text.slice(Math.max(0, i - 5), i + 5).trim()}"` });
        break;
      }
      prev = rr; prevCh = ch;
    }
  }

  // (d) text clipped by overflow:hidden (ellipsis excepted)
  for (const e of document.querySelectorAll('body *')) {
    if (!shown(e) || allowed(e)) continue;
    const cs = getComputedStyle(e);
    if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
    if (!(e.textContent || '').trim() || e.closest('svg')) continue;
    const required = e.hasAttribute('data-design') || e.matches('a,button,input,select,textarea,summary,[role=button]')
      || (mustShow.length > 0 && mustShow.some(t => (e.textContent || '').replace(/[\s\u00a0]+/g, ' ').includes(t)));
    if (cs.textOverflow === 'ellipsis' && !required) continue; // by design for data-bound names in lists, never for required text
    const cutX = /(hidden|clip)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
    const cutY = /(hidden|clip)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
    if (!(cutX || cutY) || e.clientWidth === 0 || e.clientHeight === 0) continue;
    // only text that is really cut: a text node that lies partly outside the element's box
    const eb = e.getBoundingClientRect();
    const cut = nodes.some(({ el, rects }) => e.contains(el) && rects.some(r => r.right > eb.right + 1 || r.bottom > eb.bottom + 1 || r.left < eb.left - 1 || r.top < eb.top - 1));
    if (cut) out.push({ kind: 'clipped', sel: sel(e), detail: `text cut off by overflow${cs.textOverflow === 'ellipsis' ? ' (ellipsis on REQUIRED text)' : ''} (content ${e.scrollWidth}x${e.scrollHeight}px in a ${e.clientWidth}x${e.clientHeight}px box)` });
  }
  return out;
}
