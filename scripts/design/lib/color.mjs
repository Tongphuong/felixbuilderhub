// CSS colour -> sRGB, for the never_red check (R2L-MAINT-1 D5).
//
// getComputedStyle() hands back sRGB colours as rgb()/rgba(), but a colour authored as oklch()/oklab()/lab()/lch()/color(display-p3 ...)
// is returned in that SAME syntax, so a comparison that only reads rgb() lets a coral or Minny red slip through when it is written another way.
// This turns every CSS colour syntax into [r, g, b, a]: r/g/b are sRGB 0..255 (floats, clipped to the sRGB gamut, NOT rounded), a is 0..1.
// Returns null when the text is not a colour this file understands. A caller that must not be fooled (never_red) treats null as a FAILURE,
// never as "safe" (rule 28b: a verifier that cannot read what it verifies must fail).
//
// Supported: #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla(), hwb(), lab(), lch(), oklab(), oklch(),
//            color(srgb | srgb-linear | display-p3 | xyz | xyz-d65 | xyz-d50 ...), `transparent`.
//            Legacy comma syntax, space syntax, `/ alpha`, percentages and `none` are all handled.
//
// SELF-CONTAINED ON PURPOSE: no imports and no outer-scope references, because fidelity.mjs serialises this function with toString()
// and ships it into the page next to neverRedCheck (the page CSP may forbid eval, so it is passed as source, never eval'd by page code).
export function parseCssColor(input) {
  const s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return [0, 0, 0, 0];
  const mul = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const lin = u => { const a = Math.abs(u); const v = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4); return u < 0 ? -v : v; };
  const enc = u => { const a = Math.abs(u); const v = a > 0.0031308 ? 1.055 * Math.pow(a, 1 / 2.4) - 0.055 : 12.92 * a; return u < 0 ? -v : v; };
  const XYZ65_TO_LIN = [3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797, -0.2039769589, 1.0569715142];
  const P3_TO_XYZ65 = [0.4865709486, 0.2656676932, 0.1982172852, 0.2289745641, 0.6917385218, 0.0792869141, 0, 0.0451133819, 1.0439443689];
  const XYZ50_TO_65 = [0.9554734527, -0.0230985368, 0.0632593086, -0.0283697069, 1.0099954580, 0.0210413989, 0.0123140016, -0.0205076964, 1.3303659366];
  const out = (lr, a) => { const c = mul([1, 0, 0, 0, 1, 0, 0, 0, 1], lr).map(v => Math.min(1, Math.max(0, enc(v))) * 255); return [c[0], c[1], c[2], a]; };
  const fromXyz65 = (xyz, a) => out(mul(XYZ65_TO_LIN, xyz), a);
  const clamp01 = v => Math.min(1, Math.max(0, v));

  let m = /^#([0-9a-f]+)$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = /^([a-z-]+)\((.*)\)$/.exec(s);
  if (!m) return null;
  const fn = m[1];
  const slash = m[2].split('/');
  if (slash.length > 2) return null;
  const tokens = slash[0].trim().split(/[\s,]+/).filter(Boolean);
  let alphaTok = slash.length === 2 ? slash[1].trim() : null;
  if (alphaTok == null && /^(rgba?|hsla?)$/.test(fn) && tokens.length === 4) alphaTok = tokens.pop();
  const num = (t, pct) => {
    if (t === undefined) return NaN;
    if (t === 'none') return 0;
    if (t.endsWith('%')) return parseFloat(t) / 100 * pct;
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t) ? parseFloat(t) : NaN;
  };
  const hue = t => {
    if (t === undefined) return NaN;
    if (t === 'none') return 0;
    const u = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/.exec(t);
    if (!u) return NaN;
    const v = parseFloat(u[1]);
    return u[2] === 'rad' ? v * 180 / Math.PI : u[2] === 'grad' ? v * 0.9 : u[2] === 'turn' ? v * 360 : v;
  };
  let a = 1;
  if (alphaTok != null) { a = num(alphaTok, 1); if (!Number.isFinite(a)) return null; a = clamp01(a); }
  const ok = (...v) => v.every(Number.isFinite);
  const polar = (cc, h) => [cc * Math.cos(h * Math.PI / 180), cc * Math.sin(h * Math.PI / 180)];

  if (fn === 'rgb' || fn === 'rgba') {
    if (tokens.length !== 3) return null;
    const v = tokens.map(t => num(t, 255));
    if (!ok(...v)) return null;
    return [...v.map(x => Math.min(255, Math.max(0, x))), a];
  }
  if (fn === 'hsl' || fn === 'hsla' || fn === 'hwb') {
    if (tokens.length !== 3) return null;
    const h = hue(tokens[0]), x = num(tokens[1], 100), y = num(tokens[2], 100);
    if (!ok(h, x, y)) return null;
    const hh = ((h % 360) + 360) % 360;
    const f = (n, sl, l) => { const k = (n + hh / 30) % 12; return l - sl * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    let rgb;
    if (fn === 'hwb') {
      let w = clamp01(x / 100), bl = clamp01(y / 100);
      if (w + bl >= 1) { const g = w / (w + bl); rgb = [g, g, g]; }
      else rgb = [0, 8, 4].map(n => f(n, 1, 0.5) * (1 - w - bl) + w);
    } else { const sl = clamp01(x / 100), l = clamp01(y / 100); rgb = [0, 8, 4].map(n => f(n, sl, l)); }
    return [...rgb.map(v => clamp01(v) * 255), a];
  }
  if (fn === 'oklab' || fn === 'oklch') {
    if (tokens.length !== 3) return null;
    const L = num(tokens[0], 1);
    let aa, bb;
    if (fn === 'oklab') { aa = num(tokens[1], 0.4); bb = num(tokens[2], 0.4); }
    else { const cc = num(tokens[1], 0.4), h = hue(tokens[2]); if (!ok(cc, h)) return null; [aa, bb] = polar(cc, h); }
    if (!ok(L, aa, bb)) return null;
    const l_ = L + 0.3963377774 * aa + 0.2158037573 * bb, m_ = L - 0.1055613458 * aa - 0.0638541728 * bb, s_ = L - 0.0894841775 * aa - 1.2914855480 * bb;
    const l = l_ * l_ * l_, mm = m_ * m_ * m_, ss = s_ * s_ * s_;
    return out([4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss, -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss], a);
  }
  if (fn === 'lab' || fn === 'lch') {
    if (tokens.length !== 3) return null;
    const L = num(tokens[0], 100);
    let aa, bb;
    if (fn === 'lab') { aa = num(tokens[1], 125); bb = num(tokens[2], 125); }
    else { const cc = num(tokens[1], 150), h = hue(tokens[2]); if (!ok(cc, h)) return null; [aa, bb] = polar(cc, h); }
    if (!ok(L, aa, bb)) return null;
    const fy = (L + 16) / 116, fx = aa / 500 + fy, fz = fy - bb / 200;
    const eps = 216 / 24389, kap = 24389 / 27;
    const x = Math.pow(fx, 3) > eps ? Math.pow(fx, 3) : (116 * fx - 16) / kap;
    const y = L > kap * eps ? Math.pow(fy, 3) : L / kap;
    const z = Math.pow(fz, 3) > eps ? Math.pow(fz, 3) : (116 * fz - 16) / kap;
    return fromXyz65(mul(XYZ50_TO_65, [x * 0.3457 / 0.3585, y, z * (1 - 0.3457 - 0.3585) / 0.3585]), a);
  }
  if (fn === 'color') {
    const space = tokens[0];
    if (tokens.length !== 4) return null;
    const v = tokens.slice(1).map(t => num(t, 1));
    if (!ok(...v)) return null;
    if (space === 'srgb') return [...v.map(x => clamp01(x) * 255), a];
    if (space === 'srgb-linear') return out(v, a);
    if (space === 'display-p3') return fromXyz65(mul(P3_TO_XYZ65, v.map(lin)), a);
    if (space === 'xyz' || space === 'xyz-d65') return fromXyz65(v, a);
    if (space === 'xyz-d50') return fromXyz65(mul(XYZ50_TO_65, v), a);
    return null;
  }
  return null;
}
