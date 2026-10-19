// Region checks: compare one box of the mock with the matching [data-design] element of the built page.
// Catches what a whole-screen pixel ceiling lets through (an EMPTY monster box is ~2% of a screen).
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export function cropPng(buf, box) {
  const src = PNG.sync.read(buf);
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.min(src.width - x, Math.round(box.w))), h = Math.max(1, Math.min(src.height - y, Math.round(box.h)));
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  return out;
}

// Bilinear resize to exactly w x h.
export function resizePng(src, w, h) {
  if (src.width === w && src.height === h) return src;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * src.height / h - 0.5, y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(src.height - 1, y0 + 1), ty = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * src.width / w - 0.5, x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(src.width - 1, x0 + 1), tx = Math.min(1, Math.max(0, fx - x0));
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c], b = src.data[(y0 * src.width + x1) * 4 + c];
        const cc = src.data[(y1 * src.width + x0) * 4 + c], d = src.data[(y1 * src.width + x1) * 4 + c];
        out.data[(y * w + x) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty);
      }
    }
  }
  return out;
}

// Standard deviation of luminance (0-255). A blank or single-colour box is ~0.
export function stddev(png) {
  const n = png.width * png.height;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * png.data[i * 4] + 0.7152 * png.data[i * 4 + 1] + 0.0722 * png.data[i * 4 + 2];
    sum += l; sum2 += l * l;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

export const EMPTY_STDDEV = 4; // luminance stddev below this = "blank or uniform"

// Edge energy: mean Sobel gradient magnitude of the luminance. A box with a real subject (monster, shield, stars) has
// far more edges than the same box showing only its backdrop (rays, gradient), which still has a non-zero stddev.
export function edgeEnergy(png) {
  const { width: w, height: h } = png;
  if (w < 3 || h < 3) return 0;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * png.data[i * 4] + 0.7152 * png.data[i * 4 + 1] + 0.0722 * png.data[i * 4 + 2];
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
    const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
    sum += Math.sqrt(gx * gx + gy * gy);
  }
  return sum / ((w - 2) * (h - 2));
}
// The built crop must carry at least this share of the MOCK crop's edge energy ("region empty" otherwise).
// Calibrated in tests/design-fidelity.test.mjs and recorded in README-LOCK.md.
export const EDGE_MIN_RATIO = 0.5;

export function compareRegion(mockBuf, builtBuf, mockBox, builtBox, ceiling, minEdgeRatio = EDGE_MIN_RATIO) {
  const mockCrop = cropPng(mockBuf, mockBox);
  const w = mockCrop.width, h = mockCrop.height;
  const builtCrop = resizePng(cropPng(builtBuf, builtBox), w, h);
  const mockSd = stddev(mockCrop), builtSd = stddev(builtCrop);
  const mockEdge = edgeEnergy(mockCrop), builtEdge = edgeEnergy(builtCrop), edgeRatio = mockEdge > 0 ? builtEdge / mockEdge : 1;
  const diff = new PNG({ width: w, height: h });
  const count = pixelmatch(mockCrop.data, builtCrop.data, diff.data, w, h, { threshold: 0.1 });
  const fraction = count / (w * h);
  const problems = [];
  if (mockSd < EMPTY_STDDEV) problems.push(`MOCK region is uniform (stddev ${mockSd.toFixed(1)}): contract box is wrong`);
  if (builtSd < EMPTY_STDDEV) problems.push(`region empty: built crop is blank or uniform (stddev ${builtSd.toFixed(1)} < ${EMPTY_STDDEV})`);
  else if (mockEdge > 0.5 && edgeRatio < minEdgeRatio) problems.push(`region empty: built crop has only ${(edgeRatio * 100).toFixed(0)}% of the mock's edge energy (min ${(minEdgeRatio * 100).toFixed(0)}%): the subject is missing`);
  if (fraction > ceiling) problems.push(`${(fraction * 100).toFixed(1)}% differing (ceiling ${(ceiling * 100).toFixed(1)}%)`);
  return { pass: problems.length === 0, fraction, problems, mockSd, builtSd, mockEdge, builtEdge, edgeRatio, mock: PNG.sync.write(mockCrop), built: PNG.sync.write(builtCrop), diff: PNG.sync.write(diff), w, h };
}

// "Own pixels": how much of the region's box CHANGES when the region's own element is hidden (visibility:hidden on it and its subtree).
// An element that renders nothing visible (a blank monster box over backdrop rays that look like the mock's) changes ~0%, whatever
// the backdrop is, so this catches what stddev and edge energy cannot (home monster at 390 has bubble and hills edges inside the box).
export const OWN_MIN_FRACTION = 0.005; // 0.5%: a text-only element is a few percent of its box; an empty one is exactly 0. Monster regions should set min_own_pixels ~0.10.
export function ownPixelFraction(withBuf, withoutBuf, box) {
  const a = cropPng(withBuf, box), b = cropPng(withoutBuf, box);
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const A = new PNG({ width: w, height: h }), B = new PNG({ width: w, height: h });
  PNG.bitblt(a, A, 0, 0, w, h, 0, 0); PNG.bitblt(b, B, 0, 0, w, h, 0, 0);
  const out = new PNG({ width: w, height: h });
  return pixelmatch(A.data, B.data, out.data, w, h, { threshold: 0.1 }) / (w * h);
}
