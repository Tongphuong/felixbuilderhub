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

export function compareRegion(mockBuf, builtBuf, mockBox, builtBox, ceiling) {
  const mockCrop = cropPng(mockBuf, mockBox);
  const w = mockCrop.width, h = mockCrop.height;
  const builtCrop = resizePng(cropPng(builtBuf, builtBox), w, h);
  const mockSd = stddev(mockCrop), builtSd = stddev(builtCrop);
  const diff = new PNG({ width: w, height: h });
  const count = pixelmatch(mockCrop.data, builtCrop.data, diff.data, w, h, { threshold: 0.1 });
  const fraction = count / (w * h);
  const problems = [];
  if (mockSd < EMPTY_STDDEV) problems.push(`MOCK region is uniform (stddev ${mockSd.toFixed(1)}): contract box is wrong`);
  if (builtSd < EMPTY_STDDEV) problems.push(`region empty: built crop is blank or uniform (stddev ${builtSd.toFixed(1)} < ${EMPTY_STDDEV})`);
  if (fraction > ceiling) problems.push(`${(fraction * 100).toFixed(1)}% differing (ceiling ${(ceiling * 100).toFixed(1)}%)`);
  return { pass: problems.length === 0, fraction, problems, mockSd, builtSd, mock: PNG.sync.write(mockCrop), built: PNG.sync.write(builtCrop), diff: PNG.sync.write(diff), w, h };
}
