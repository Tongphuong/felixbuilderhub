// Small mean-SSIM (luminance + per channel), 8x8 uniform windows, stride 4. Reusable from tests.
// Reuse survey: ssim.js / image-ssim (npm) exist but are not installed and the packet forbids new deps; ~40 lines hand-rolled.
import sharp from 'sharp';

export async function loadRaw(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

function plane(img, ch) {
  const n = img.w * img.h;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = ch === 'luma'
      ? 0.299 * img.data[i * img.c] + 0.587 * img.data[i * img.c + 1] + 0.114 * img.data[i * img.c + 2]
      : img.data[i * img.c + ch];
  }
  return out;
}

function ssimPlane(a, b, w, h, win = 8, step = 4) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const N = win * win;
  let sum = 0;
  let cnt = 0;
  for (let y = 0; y + win <= h; y += step) {
    for (let x = 0; x + win <= w; x += step) {
      let ma = 0, mb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < win; j++) {
        const o = (y + j) * w + x;
        for (let i = 0; i < win; i++) {
          const p = a[o + i];
          const q = b[o + i];
          ma += p; mb += q; saa += p * p; sbb += q * q; sab += p * q;
        }
      }
      ma /= N; mb /= N;
      const va = saa / N - ma * ma;
      const vb = sbb / N - mb * mb;
      const cov = sab / N - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      cnt++;
    }
  }
  return sum / cnt;
}

// Returns { luma, channels:[r,g,b], min } where min is the worst of luma and the 3 channels.
export async function ssim(inputA, inputB) {
  const a = await loadRaw(inputA);
  const b = await loadRaw(inputB);
  if (a.w !== b.w || a.h !== b.h) throw new Error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const luma = ssimPlane(plane(a, 'luma'), plane(b, 'luma'), a.w, a.h);
  const channels = [0, 1, 2].map((c) => ssimPlane(plane(a, c), plane(b, c), a.w, a.h));
  return { luma, channels, min: Math.min(luma, ...channels) };
}
