// Pixel diff + composite rendering for the fidelity harness.
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export function diffPngs(bufA, bufB, threshold = 0.1) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
  return { count, total: a.width * a.height, fraction: count / (a.width * a.height), diffPng: PNG.sync.write(diff), width: a.width, height: a.height };
}

// Composite: design | built | diff, with a title bar. Rendered by the browser itself
// (no font/canvas dependency): an HTML sheet with three data-URI images.
export async function writeComposite(browser, outPath, { title, ok, design, built, diff, regions = [] }) {
  const uri = b => 'data:image/png;base64,' + b.toString('base64');
  const w = PNG.sync.read(design).width;
  const ctx = await browser.newContext({ viewport: { width: w * 3 + 60, height: 400 } });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#222;font:600 22px/1.2 system-ui,sans-serif;color:#fff}
    .bar{padding:12px 16px;background:${ok ? '#237A41' : '#B3261E'};display:flex;gap:16px;align-items:center}
    .bar b{background:#fff;color:${ok ? '#237A41' : '#B3261E'};padding:2px 10px;border-radius:6px}
    .row{display:flex;gap:12px;padding:12px;align-items:flex-start}
    .col{display:flex;flex-direction:column;gap:6px}
    .col span{font-size:15px;opacity:.8}
    img{display:block;background:#fff}
  </style>
  <div class="bar"><b>${ok ? 'PASS' : 'FAIL'}</b><span>${title.replace(/[<&]/g, '')}</span></div>
  <div class="row">
    <div class="col"><span>design (mock)</span><img src="${uri(design)}"></div>
    <div class="col"><span>built</span><img src="${uri(built)}"></div>
    <div class="col"><span>diff (pixelmatch 0.1)</span><img src="${uri(diff)}"></div>
  </div>${regions.map(g => `<div class="bar" style="background:${g.ok ? '#237A41' : '#B3261E'}"><b style="color:${g.ok ? '#237A41' : '#B3261E'}">${g.ok ? 'PASS' : 'FAIL'}</b><span>region ${g.label.replace(/[<&]/g, '')}</span></div>
  <div class="row"><img src="${uri(g.mock)}"><img src="${uri(g.built)}"><img src="${uri(g.diff)}"></div>`).join('')}`);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.screenshot({ path: outPath, fullPage: true });
  await ctx.close();
}

// Pad a PNG (bottom) to `height` with a solid colour so mock and built compare over the same area.
export function padPng(buf, height, color) {
  const src = PNG.sync.read(buf);
  if (src.height >= height) return buf;
  const out = new PNG({ width: src.width, height });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = color[0]; out.data[i + 1] = color[1]; out.data[i + 2] = color[2]; out.data[i + 3] = 255; }
  PNG.bitblt(src, out, 0, 0, src.width, src.height, 0, 0);
  return PNG.sync.write(out);
}

// Background colour of a screenshot = its bottom-left pixel.
export function cornerColor(buf) {
  const p = PNG.sync.read(buf);
  const i = ((p.height - 1) * p.width) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
}

export function pngHeight(buf) { return PNG.sync.read(buf).height; }

// Force a screenshot to exactly `width` px wide (crop the overflow / pad with white), so a page that
// scrolls horizontally still diffs (the no-h-scroll check reports the overflow separately).
export function fitWidth(buf, width) {
  const src = PNG.sync.read(buf);
  if (src.width === width) return buf;
  const out = new PNG({ width, height: src.height });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, 0, Math.min(width, src.width), src.height, 0, 0);
  return PNG.sync.write(out);
}
