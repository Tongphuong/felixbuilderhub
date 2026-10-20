// Node-side half of the text checks: finishes what scanText() (in-page) started.
//  - visible-text stream for the `texts` check (text NODES only, never alt/aria-label/value)
//  - contrast: determinate in-page where the backdrop is a plain colour, otherwise the
//    backdrop is SAMPLED from the rendered screenshot (dominant colour around the glyphs).
import { PNG } from 'pngjs';

export const collapse = s => String(s).normalize('NFC').replace(/[\s ]+/g, ' ').trim();

const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const contrastRatio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3])];

// Dominant colour inside rect (document px == screenshot px at DPR 1), ignoring pixels that are
// close to the text colour (so a heavy glyph cannot out-vote its own background).
export function sampleBackdrop(png, rect, fg) {
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(png.height, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const buckets = new Map();
  let used = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * png.width + x) * 4;
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (fg && Math.abs(r - fg[0]) + Math.abs(g - fg[1]) + Math.abs(b - fg[2]) < 60) continue;
    const k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b; buckets.set(k, e);
    used++;
  }
  if (!used) return null;
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

export function analyseText(items, pngBuf) {
  const png = pngBuf ? PNG.sync.read(pngBuf) : null;
  let sampled = 0, indeterminate = 0, measured = 0;
  const fails = [];
  for (const it of items) {
    if (!it.vis) continue;
    let ratio = it.ratio;
    if (ratio == null) {
      const bg = png && it.rect ? sampleBackdrop(png, it.rect, it.fg) : null;
      if (bg && it.fg) {
        const eff = over(it.fg, bg);
        ratio = contrastRatio(eff, bg);
        sampled++;
        if (ratio < 1.1) { it.vis = false; it.why = 'text colour equals its (sampled) background'; continue; }
      }
    }
    measured++;
    if (ratio == null) { indeterminate++; continue; }
    if (ratio < 4.5) fails.push({ text: collapse(it.text).slice(0, 50), ratio: +ratio.toFixed(2), tag: it.tag + (it.svg ? ' (svg)' : '') });
  }
  const visible = items.filter(i => i.vis);
  let stream = '';
  let prev = null;
  for (const it of visible) {
    if (prev && (prev.blockId !== it.blockId || it.top >= prev.bottom - 1)) stream += ' ';
    stream += it.text;
    prev = it;
  }
  return { visible, stream: collapse(stream), contrast: { measured, sampled, indeterminate, fails } };
}

export function textOf(items, designId) {
  return collapse(items.filter(i => i.vis && i.designIds.includes(designId)).map(i => i.text).join(' '));
}

// Token match for the data-binding check: the token must not sit INSIDE a longer number or word. "60 kim cương" is not in
// "1.160 kim cương" or "Bút60"; "Quyển 1" is not in "Quyển 10"; "#1" is not in "#11". (Substring checks gave false positives
// and false stale-value hits.) Thousands separators (. or ,) between digits count as part of the number.
const isDigit = c => !!c && c >= '0' && c <= '9';
const isLetter = c => !!c && /\p{L}/u.test(c);
export function containsToken(stream, token) {
  const t = collapse(token);
  if (!t) return true;
  const first = t[0], last = t[t.length - 1];
  for (let from = 0; ;) {
    const i = stream.indexOf(t, from);
    if (i < 0) return false;
    const prev = stream[i - 1], prev2 = stream[i - 2], nextIdx = i + t.length, next = stream[nextIdx], next2 = stream[nextIdx + 1];
    let ok = true;
    if ((isDigit(first) || isLetter(first)) && prev && (isDigit(prev) || isLetter(prev))) ok = false;
    if (ok && isDigit(first) && prev && (prev === '.' || prev === ',') && isDigit(prev2)) ok = false;
    if (ok && (isDigit(last) || isLetter(last)) && next && (isDigit(next) || isLetter(next))) ok = false;
    if (ok && isDigit(last) && next && (next === '.' || next === ',') && isDigit(next2)) ok = false;
    // a symbol-only token ("★★") must not be the head of a longer run of the same symbol ("★★★"): no word boundary exists there
    const sym = c => !!c && !isDigit(c) && !isLetter(c) && !/[\s.,;:!?)\]]/.test(c);
    if (ok && !isDigit(first) && !isLetter(first) && sym(first) && prev === first) ok = false;
    if (ok && !isDigit(last) && !isLetter(last) && sym(last) && next === last) ok = false;
    if (ok) return true;
    from = i + 1;
  }
}
