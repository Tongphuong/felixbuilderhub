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
export async function writeComposite(browser, outPath, { title, ok, design, built, diff }) {
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
  </div>`);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.screenshot({ path: outPath, fullPage: true });
  await ctx.close();
}
