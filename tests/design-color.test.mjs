// Tests for scripts/design/lib/color.mjs (R2L-MAINT-1 D5): every CSS colour syntax -> sRGB, so never_red cannot be fooled by a brand colour
// written as oklch()/oklab()/lab()/lch()/color(display-p3 ...).
//   1. Pure vectors (no Chrome): hex, rgb, hsl, hwb, alpha forms, `none`, garbage -> null.
//   2. Independent oracle (Chrome): the parser must agree with what CHROME paints for the same string (canvas pixel, sRGB), so a mistake in a
//      matrix cannot hide behind a test that uses the same matrix.
//   3. The brand colours #FF7A3D and #E0362C written in every syntax (converted FORWARD here, with its own maths) must parse back to within
//      +-3/255 of the brand colour, AND Chrome must confirm that the generated string really is that colour (proving the test's own conversion).
// No Chrome: FAILS loudly locally, skips only when CI is set (same as design-fidelity.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { parseCssColor } from '../scripts/design/lib/color.mjs';
import { findChrome } from '../scripts/design/fidelity.mjs';

let chromeMissing = null;
try { findChrome(); } catch (e) { chromeMissing = e; }
const skipNoChrome = t => {
  if (!chromeMissing) return false;
  if (process.env.CI) { t.skip('no Chrome binary found and CI is set: ' + chromeMissing.message); return true; }
  throw chromeMissing;
};

const near = (got, want, tol) => got && want.every((v, i) => Math.abs(got[i] - v) <= tol);
const BRANDS = { coral: [255, 122, 61], 'minny-red': [224, 54, 44], 'sun-yellow (safe)': [255, 200, 61] };

// ---- forward conversion sRGB -> other syntaxes (the test's own maths) ----
const mul = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const inv = m => { const [a, b, c, d, e, f, g, h, i] = m; const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); return [(e * i - f * h), (c * h - b * i), (b * f - c * e), (f * g - d * i), (a * i - c * g), (c * d - a * f), (d * h - e * g), (b * g - a * h), (a * e - b * d)].map(x => x / det); };
const lin = u => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
const enc = u => (u > 0.0031308 ? 1.055 * Math.pow(u, 1 / 2.4) - 0.055 : 12.92 * u);
const SRGB_TO_XYZ = [0.4123907993, 0.3575843394, 0.1804807884, 0.2126390059, 0.7151686788, 0.0721923154, 0.0193308187, 0.1191947798, 0.9505321522];
const P3_TO_XYZ = [0.4865709486, 0.2656676932, 0.1982172852, 0.2289745641, 0.6917385218, 0.0792869141, 0, 0.0451133819, 1.0439443689];
const D50_TO_D65 = [0.9554734527, -0.0230985368, 0.0632593086, -0.0283697069, 1.0099954580, 0.0210413989, 0.0123140016, -0.0205076964, 1.3303659366];
const xyz65 = rgb => mul(SRGB_TO_XYZ, rgb.map(v => lin(v / 255)));
const f3 = n => +n.toFixed(5);
function toOklab(rgb) {
  const [r, g, b] = rgb.map(v => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function toLab(rgb) {
  const [x, y, z] = mul(inv(D50_TO_D65), xyz65(rgb));
  const W = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585], eps = 216 / 24389, kap = 24389 / 27;
  const f = t => (t > eps ? Math.cbrt(t) : (kap * t + 16) / 116);
  const fx = f(x / W[0]), fy = f(y / W[1]), fz = f(z / W[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const polar = (L, a, b) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360];
function syntaxes(rgb) {
  const ok = toOklab(rgb), lab = toLab(rgb), p3 = mul(inv(P3_TO_XYZ), xyz65(rgb)).map(enc);
  const [oL, oC, oH] = polar(...ok), [lL, lC, lH] = polar(...lab);
  return {
    hex: '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''),
    'rgb()': `rgb(${rgb.join(' ')})`,
    'rgb(% )': `rgb(${rgb.map(v => f3(v / 255 * 100) + '%').join(' ')})`,
    'oklch()': `oklch(${f3(oL)} ${f3(oC)} ${f3(oH)})`,
    'oklch(% deg)': `oklch(${f3(oL * 100)}% ${f3(oC)} ${f3(oH)}deg)`,
    'oklab()': `oklab(${f3(ok[0])} ${f3(ok[1])} ${f3(ok[2])})`,
    'lab()': `lab(${f3(lab[0])} ${f3(lab[1])} ${f3(lab[2])})`,
    'lch()': `lch(${f3(lL)} ${f3(lC)} ${f3(lH)})`,
    'color(display-p3)': `color(display-p3 ${p3.map(f3).join(' ')})`,
    'color(srgb)': `color(srgb ${rgb.map(v => f3(v / 255)).join(' ')})`,
    'color(srgb-linear)': `color(srgb-linear ${rgb.map(v => f3(lin(v / 255))).join(' ')})`,
    'color(xyz)': `color(xyz ${xyz65(rgb).map(f3).join(' ')})`,
  };
}

test('parseCssColor: pure vectors', () => {
  assert.deepEqual(parseCssColor('#E0362C'), [224, 54, 44, 1]);
  assert.deepEqual(parseCssColor('#f73'), [255, 119, 51, 1]);
  assert.deepEqual(parseCssColor('#E0362C80').map(v => +v.toFixed(2)), [224, 54, 44, 0.5]);
  assert.deepEqual(parseCssColor('rgb(255, 122, 61)'), [255, 122, 61, 1]);
  assert.deepEqual(parseCssColor('rgba(255,122,61,.5)'), [255, 122, 61, 0.5]);
  assert.deepEqual(parseCssColor('rgb(255 122 61 / 40%)'), [255, 122, 61, 0.4]);
  assert.deepEqual(parseCssColor('RGB(255 122 61)'), [255, 122, 61, 1]);
  assert.deepEqual(parseCssColor('transparent'), [0, 0, 0, 0]);
  assert.deepEqual(parseCssColor('oklab(1 0 0)').map(Math.round), [255, 255, 255, 1]);
  assert.deepEqual(parseCssColor('oklch(0 0 0)').map(Math.round), [0, 0, 0, 1]);
  assert.deepEqual(parseCssColor('oklch(0.7 0.15 none)'), parseCssColor('oklch(0.7 0.15 0)'), '`none` reads as 0');
  assert.deepEqual(parseCssColor('hsl(10 80% 50%)').map(v => +v.toFixed(1)), [229.5, 59.5, 25.5, 1]);
  assert.deepEqual(parseCssColor('hsl(0, 100%, 50%)'), [255, 0, 0, 1]);
  assert.deepEqual(parseCssColor('hwb(0 0% 0%)'), [255, 0, 0, 1]);
  assert.deepEqual(parseCssColor('color(srgb 1 0 0 / 0.25)'), [255, 0, 0, 0.25]);
  assert.deepEqual(parseCssColor('color(display-p3 1 1 1)').map(Math.round), [255, 255, 255, 1]);
  assert.deepEqual(parseCssColor('color(display-p3 1 0 0)').map(Math.round), [255, 0, 0, 1], 'out-of-gamut p3 red clips to sRGB red');
  for (const bad of ['', 'banana', 'rgb(1 2)', 'rgb(a b c)', 'oklch(0.5 0.1)', 'color(rec2020 1 0 0)', 'color(display-p3 1 0)', 'foo(1 2 3)', '#12', '#1234567', 'rgb(1 2 3 / x)', null, undefined]) assert.equal(parseCssColor(bad), null, String(bad));
});

test('parseCssColor agrees with what CHROME paints, for every syntax never_red must read (independent oracle)', async t => {
  if (skipNoChrome(t)) return;
  const browser = await chromium.launch({ executablePath: findChrome() });
  try {
    const page = await browser.newPage();
    const paint = strs => page.evaluate(list => list.map(s => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { colorSpace: 'srgb' }); x.fillStyle = '#000'; x.fillStyle = s; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }), strs);
    const samples = ['oklch(0.7 0.15 180)', 'oklch(60% 0.2 30deg)', 'oklab(0.5 0.1 0.1)', 'oklab(0.8 -0.05 0.12)', 'lab(50% 40 59.5)', 'lab(70 -30 20)', 'lch(50 70 40)', 'lch(80 40 300)', 'color(display-p3 0.9 0.5 0.3)', 'color(display-p3 0.2 0.6 0.4)',
      'color(srgb 0.9 0.3 0.4)', 'color(srgb-linear 0.5 0.2 0.1)', 'color(xyz 0.4 0.3 0.2)', 'color(xyz-d50 0.4 0.3 0.2)', 'hsl(200 60% 40%)', 'hwb(30 20% 10%)', 'rgb(10 200 30)', '#c8a2c8'];
    const chrome = await paint(samples);
    samples.forEach((s, i) => {
      const mine = parseCssColor(s);
      assert.ok(near(mine, chrome[i], 2.5), `${s}: parser ${mine && mine.slice(0, 3).map(v => v.toFixed(1))} vs Chrome ${chrome[i]}`);
    });
  } finally { await browser.close(); }
});

test('the brand colours written in EVERY syntax parse back to the brand colour (+-3/255); the sun yellow never does', async t => {
  if (skipNoChrome(t)) return;
  const browser = await chromium.launch({ executablePath: findChrome() });
  try {
    const page = await browser.newPage();
    const paint = strs => page.evaluate(list => list.map(s => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { colorSpace: 'srgb' }); x.fillStyle = '#000'; x.fillStyle = s; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }), strs);
    for (const [name, rgb] of Object.entries(BRANDS)) {
      const forms = syntaxes(rgb);
      const painted = await paint(Object.values(forms));
      Object.entries(forms).forEach(([syntax, str], i) => {
        assert.ok(near(painted[i], rgb, 2), `${name} as ${syntax} = ${str}: CHROME paints ${painted[i]}, so the test's own conversion is wrong`); // the oracle
        const got = parseCssColor(str);
        assert.ok(near(got, rgb, 3), `${name} as ${syntax} = ${str}: parsed ${got && got.slice(0, 3).map(v => v.toFixed(1))}, want ${rgb}`);
      });
    }
    // and a safe colour is NOT mistaken for a brand colour in any syntax
    for (const [syntax, str] of Object.entries(syntaxes(BRANDS['sun-yellow (safe)']))) {
      const got = parseCssColor(str);
      for (const brand of [BRANDS.coral, BRANDS['minny-red']]) assert.ok(!near(got, brand, 3), `${syntax} ${str} (sun yellow) must not read as a brand red`);
    }
  } finally { await browser.close(); }
});
