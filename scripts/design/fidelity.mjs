#!/usr/bin/env node
// Fidelity harness: does the BUILT page match the LOCKED design? (R2L-ISLAND, rule 28.)
//
//   node scripts/design/fidelity.mjs --design <designDir> --contracts <contractsDir> \
//        --base <url-of-built-site> --out <dir> [--only <contractId>] [--state-driver <module>] \
//        [--token <magic-link-token> | --login-url <url>] [--chrome <path>] [--composites all|fail] [--require-anchors] [--concurrency N] [--binding-only] [--sample <json>]
//
// For each contract x viewport width:
//   (a) render the mock (file://, fonts included) at width x contract.viewport[width], FULL-PAGE screenshot it
//   (b) render the built page at the same viewport and let the state driver reach built.state
//   (c) CONTRACT CHECKS on the built DOM (order, texts, primary, columns, overflow at 5 widths,
//       contrast, tap targets, reduced-motion animations)
//   (d) pixelmatch (threshold 0.1) mock vs built, fraction vs diff_ceiling
//   (e) composite PNG (design | built | diff) + report.json + report.md in --out
// Exit codes: 0 all pass, 1 some check failed, 2 usage / infrastructure error (a crash is not a verdict).
//
// Everything runs with prefers-reduced-motion emulated, so screenshots are deterministic and the
// "no running animation" check is meaningful.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { resolveLocate, neverRedCheck, contractChecks, tapChecks, overflowCheck, motionCheck, addStillClass, removeStillClass, layoutSanity, fontCheck, fontUsage, mockBalooClasses, mockBoxes, builtBoxes, scanText } from './lib/in-page.mjs';
import { diffPngs, writeComposite, padPng, cornerColor, pngHeight, fitWidth, maskPng, maskFraction, MASK_MAX_FRACTION } from './lib/pixels.mjs';
import { analyseText, textOf, collapse, containsToken } from './lib/text.mjs';
import { classifyDataBound } from './lib/binding.mjs';
import { compareRegion, ownPixelFraction, OWN_MIN_FRACTION } from './lib/regions.mjs';

const OVERFLOW_WIDTHS = [360, 390, 768, 1024, 1280];
const LAYOUT_WIDTHS = [360, 768, 1024]; // plus every width the contract has a mock for
const BOOLEAN_FLAGS = new Set(['require-anchors', 'binding-only']);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export class InfraError extends Error {}

export function findChrome(explicit) {
  const list = explicit ? [explicit] : CHROME_CANDIDATES;
  const hit = list.find(p => fs.existsSync(p));
  if (!hit) throw new InfraError('no Chrome/Chromium found; set CHROME_PATH or pass --chrome (tried: ' + list.join(', ') + ')');
  return hit;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new InfraError('unexpected argument: ' + a);
    const k = a.slice(2);
    if (BOOLEAN_FLAGS.has(k)) { o[k] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new InfraError('missing value for --' + k);
    o[k] = v; i++;
  }
  return o;
}

// Anchors in force at one width: the base maps, overridden per width by anchors_<w> / anchors_exempt_<w>.
// In anchors_<w>, a null value REMOVES the base anchor for that width (same for anchors_exempt_<w>).
export function effectiveAnchors(c, w) {
  const merge = (base, over) => {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(over || {})) { if (v === null) delete out[k]; else out[k] = v; }
    return out;
  };
  return { anchors: merge(c.anchors, c[`anchors_${w}`]), exempt: merge(c.anchors_exempt, c[`anchors_exempt_${w}`]) };
}

// A contract's width-keyed fields must all describe exactly the widths of the mocks it lists.
export function validateContract(c) {
  // Release 3: wording that still waits on the founder. Elon resolves it BEFORE dispatch; a pending contract is never run.
  if (Object.prototype.hasOwnProperty.call(c, 'pending_founder')) throw new InfraError(`contract ${c.id}: still carries "pending_founder" (wording waiting on Phương); refusing to run an unresolved contract`);
  const set = o => Object.keys(o || {}).sort().join(',');
  const want = set(c.mock);
  if (!want) throw new InfraError(`contract ${c.id}: "mock" lists no widths`);
  for (const f of ['viewport', 'diff_ceiling', 'reference']) {
    if (f === 'reference' && !c.reference) continue;
    if (set(c[f]) !== want) throw new InfraError(`contract ${c.id}: "${f}" widths [${set(c[f])}] != mock widths [${want}]`);
  }
  const widths0 = Object.keys(c.mock);
  for (const k of Object.keys(c)) {
    const m = /^anchors(?:_exempt)?_(\d+)$/.exec(k);
    if (m && !widths0.includes(m[1])) throw new InfraError(`contract ${c.id}: "${k}" is for a width with no mock`);
  }
  for (const w of widths0) {
    const { anchors, exempt } = effectiveAnchors(c, w);
    const both = Object.keys(anchors).filter(id => Object.prototype.hasOwnProperty.call(exempt, id));
    if (both.length) throw new InfraError(`contract ${c.id}: id(s) listed in BOTH anchors and anchors_exempt at ${w}px: ${both.join(', ')}`);
  }
  const widths = new Set(Object.keys(c.mock));
  if (c.capture != null && c.capture !== 'viewport' && c.capture !== 'full') throw new InfraError(`contract ${c.id}: capture must be "viewport" or "full"`);
  for (const r of c.regions || []) {
    if (!r.id || typeof r.ceiling !== 'number' || !r.mock_box || typeof r.mock_box !== 'object') throw new InfraError(`contract ${c.id}: each region needs id, mock_box {width:[x,y,w,h]} and a numeric ceiling`);
    for (const [rw, b] of Object.entries(r.mock_box)) {
      if (!widths.has(rw)) throw new InfraError(`contract ${c.id}: region ${r.id} mock_box.${rw} is for a width with no mock`);
      if (!Array.isArray(b) || b.length !== 4 || b.some(n => typeof n !== 'number') || b[2] <= 0 || b[3] <= 0) throw new InfraError(`contract ${c.id}: region ${r.id} mock_box.${rw} must be [x, y, w, h]`);
    }
  }
  if (c.overflow_allow != null && (!Array.isArray(c.overflow_allow) || c.overflow_allow.some(x => typeof x !== 'string'))) throw new InfraError(`contract ${c.id}: overflow_allow must be a list of data-design ids or CSS selectors`);
  for (const [id, sz] of Object.entries(c.min_size || {})) if (!Array.isArray(sz) || sz.length !== 2 || sz.some(n => typeof n !== 'number')) throw new InfraError(`contract ${c.id}: min_size.${id} must be [w, h]`);
  for (const k of Object.keys(c)) {
    const m = /^(?:order|texts)_(\d+)$/.exec(k);
    if (m && !widths.has(m[1])) throw new InfraError(`contract ${c.id}: "${k}" is for a width with no mock`);
  }
  // Release 3 fields
  const strList = (v, what) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x)) throw new InfraError(`contract ${c.id}: ${what} must be a list of non-empty strings`); };
  for (const [id, sel] of Object.entries(c.locate || {})) if (typeof sel !== 'string' || !sel.trim()) throw new InfraError(`contract ${c.id}: locate.${id} must be a CSS selector string`);
  for (const [w, list] of Object.entries(c.locate_cols || {})) { if (!widths.has(w)) throw new InfraError(`contract ${c.id}: "locate_cols.${w}" is for a width with no mock`); strList(list, `locate_cols.${w}`); }
  if (c.never_red != null) strList(c.never_red, 'never_red');
  for (const k of Object.keys(c)) {
    const m = /^sun_also_(\d+)$/.exec(k);
    if (m) { if (!widths.has(m[1])) throw new InfraError(`contract ${c.id}: "${k}" is for a width with no mock`); strList(c[k], k); }
  }
  for (const [w, boxes] of Object.entries(c.mask || {})) {
    if (!widths.has(w)) throw new InfraError(`contract ${c.id}: "mask.${w}" is for a width with no mock`);
    if (!Array.isArray(boxes) || boxes.some(b => !Array.isArray(b) || b.length !== 4 || b.some(n => typeof n !== 'number') || b[2] <= 0 || b[3] <= 0)) throw new InfraError(`contract ${c.id}: mask.${w} must be a list of [x, y, w, h] boxes`);
  }
  if (c.primary && c.primary.none && (c.primary.id || c.primary.text)) throw new InfraError(`contract ${c.id}: primary.none cannot also name an id or text`);
  for (const f of ['layout']) for (const w of Object.keys(c[f] || {})) if (!widths.has(w)) throw new InfraError(`contract ${c.id}: "${f}.${w}" is for a width with no mock`);
  if (c.primary && c.primary.min_height) for (const w of Object.keys(c.primary.min_height)) if (!widths.has(w)) throw new InfraError(`contract ${c.id}: "primary.min_height.${w}" is for a width with no mock`);
}

export function loadContracts(dir, only) {
  if (!fs.existsSync(dir)) throw new InfraError('contracts dir not found: ' + dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const all = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const picked = only ? all.filter(c => c.id === only) : all;
  if (!picked.length) throw new InfraError(only ? `no contract with id "${only}" in ${dir}` : `no *.json contracts in ${dir}`);
  picked.forEach(validateContract);
  return picked;
}

// Classes the DESIGN's own stylesheet sets in Baloo 2 (single-class selectors only), read from <design>/design-system/r2l.css.
// Falls back to the known set when the folder has no r2l.css (the harness's own synthetic designs).
export function designBalooClasses(designDir) {
  const fallback = ['d', 'btn', 'chip', 'bubble', 'back'];
  let css;
  try { css = fs.readFileSync(path.join(designDir, 'design-system', 'r2l.css'), 'utf8'); } catch { return fallback; }
  const found = new Set();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/font-family\s*:[^;}]*Baloo/i.test(m[2])) continue;
    for (const sel of m[1].split(',')) { const c = sel.trim().match(/^\.([\w-]+)$/); if (c) found.add(c[1]); }
  }
  return found.size ? [...found] : fallback;
}

const check = (name, pass, detail = '') => ({ name, pass: !!pass, detail });

async function settle(page, { network = true } = {}) {
  await page.waitForLoadState('load').catch(() => {});
  if (network) await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(network ? 250 : 80);
}

const shot = async (page, animations = 'disabled', full = true) => fitWidth(await page.screenshot({ fullPage: full, animations, caret: 'hide' }), page.viewportSize().width);

export async function runFidelity(opts) {
  const { design, contracts: contractsDir, base: baseRaw, out } = opts;
  for (const [k, v] of Object.entries({ design, contracts: contractsDir, base: baseRaw, out })) if (!v) throw new InfraError(`--${k} is required`);
  if (!fs.existsSync(design)) throw new InfraError('design dir not found: ' + design);
  const base = baseRaw.replace(/\/$/, '');
  const designDir = path.resolve(design);
  const contracts = loadContracts(path.resolve(contractsDir), opts.only);
  fs.mkdirSync(out, { recursive: true });

  let driver;
  if (opts['state-driver']) {
    const p = path.resolve(opts['state-driver']);
    if (!fs.existsSync(p)) throw new InfraError('state driver not found: ' + p);
    driver = (await import(pathToFileURL(p).href)).default;
  } else {
    driver = (await import('./drivers/default.mjs')).default;
  }
  if (typeof driver !== 'function') throw new InfraError('state driver must export a default function');

  const browser = await chromium.launch({ executablePath: findChrome(opts.chrome), args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  const results = [];
  try {
    const tasks = [];
    for (const contract of contracts) {
      const widths = Object.keys(contract.mock).map(Number).sort((a, b) => a - b);
      widths.forEach((w, i) => {
        const res = { contract: contract.id, width: w, checks: [], diff: null, composite: null, warnings: [] };
        results.push(res);
        tasks.push({ contract, w, res, first: i === 0 });
      });
    }
    const runTask = async ({ contract, w, res, first }) => {
      // contract "capture":"viewport": single-screen snapshots/overlays compare the viewport only.
      const full = contract.capture !== 'viewport';
      const sh = (pg, anim = 'disabled') => shot(pg, anim, full);
      {
        const viewport = { width: w, height: contract.viewport[String(w)] };
        try {
          // (a) mock ------------------------------------------------------
          const mockPath = path.join(designDir, contract.mock[String(w)]);
          if (!fs.existsSync(mockPath)) throw new InfraError('mock file missing: ' + mockPath);
          const mctx = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
          const mpage = await mctx.newPage();
          await mpage.goto(pathToFileURL(mockPath).href, { waitUntil: 'load' });
          await settle(mpage, { network: false });
          const badFonts = (await mpage.evaluate(fontCheck)).filter(f => f.status === 'error');
          if (badFonts.length) throw new InfraError('mock fonts failed to load: ' + badFonts.map(f => f.family).join(', '));
          const mockPng0 = await sh(mpage);
          const maskBudget = ((contract.mask || {})[String(w)] || []);
          if (maskBudget.length) {
            const frac = maskFraction(maskBudget, w, pngHeight(mockPng0));
            if (frac > MASK_MAX_FRACTION) throw new InfraError(`contract ${contract.id} @ ${w}px: mask covers ${(frac * 100).toFixed(1)}% of the capture (max ${MASK_MAX_FRACTION * 100}%); a mask this large would hide the design`);
          }
          const mockStream = analyseText((await mpage.evaluate(scanText)).items, null).stream; // what THIS width's mock shows
          const eff = effectiveAnchors(contract, w);
          const anchors = Object.keys(eff.anchors).length ? eff.anchors : null;
          const exempt = eff.exempt;
          const mockGeo = anchors ? await mpage.evaluate(mockBoxes, anchors) : null;
          res.exempt = exempt;
          if (mockGeo) res.anchorBoxes = Object.fromEntries(Object.entries(mockGeo.boxes).map(([id, b]) => [id, b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }]));
          const balooClasses = await mpage.evaluate(mockBalooClasses, designBalooClasses(designDir));
          await mctx.close();

          // (b) built -----------------------------------------------------
          const bctx = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
          const page = await bctx.newPage();
          let drvRes;
          try {
            drvRes = await driver(page, contract, base, { width: w, designDir, opts });
            await settle(page);
          } catch (e) {
            res.checks.push(check('state-driver', false, `could not reach state "${contract.built && contract.built.state}": ${e.message}`));
            await bctx.close();
            return;
          }
          res.checks.push(check('state-driver', true, `reached "${contract.built.state}" at ${page.url()}`));
          // data-binding: the driver (given an alternate sample) says which values the page MUST show and which old ones must be gone.
          const bindingOf = (db, stream, label = '') => {
            if (!db) return null;
            const miss = db.expect.filter(t => !containsToken(stream, t));
            const stale = (db.absent || []).filter(t => containsToken(stream, t));
            const bad = [];
            if (miss.length) bad.push('does not show: ' + miss.map(t => `"${t}"`).join(', '));
            if (stale.length) bad.push('still shows the OLD value (hard-coded?): ' + stale.map(t => `"${t}"`).join(', '));
            // every data_bound value that THIS width's mock shows must be bound (covered by an expectation above) or declared `unbound`
            const here = { ...contract, data_bound: (contract.data_bound || []).filter(v => containsToken(mockStream, v)) };
            const cls = classifyDataBound(here, db);
            if (cls.undeclared.length) bad.push('data_bound value not bound and not declared unbound: ' + cls.undeclared.map(t => `"${t}"`).join(', '));
            if (cls.noReason.length) bad.push('unbound without a reason: ' + cls.noReason.map(t => `"${t}"`).join(', '));
            const tally = here.data_bound.length ? `; data_bound: ${cls.bound.length} bound, ${cls.declared.length} declared unbound` : '';
            return check('data-binding', bad.length === 0, bad.length ? bad.join('; ') + label : `${db.expect.length} bound values shown${db.absent && db.absent.length ? `, ${db.absent.length} old values gone` : ''}${tally}${label}`);
          };
          const bindingCheck = stream => bindingOf(drvRes && drvRes.dataBinding, stream);
          if (opts['binding-only']) {
            const an0 = analyseText((await page.evaluate(scanText)).items, null);
            const bc = bindingCheck(an0.stream);
            res.checks.push(bc || check('data-binding', false, 'the state driver provided no dataBinding expectations (use --state-driver scripts/design/drivers/r2l.mjs)'));
            await bctx.close();
            return;
          }

          // reduced motion, behavioural half (JS/rAF/video motion). Three full-page samples: t0, +600ms, +~370ms.
          // The last two must be pixel-identical. The odd second interval stops a looping mover whose period
          // is ~600ms from aliasing to "identical"; a page that merely finished settling between t0 and +600ms
          // (late font swap, slow image) still passes, which the detail text says.
          const s1 = await sh(page, 'allow');
          await page.waitForTimeout(600);
          const s2 = await sh(page, 'allow');
          await page.waitForTimeout(370);
          const s3 = await sh(page, 'allow');
          const moved = (a, b) => (pngHeight(a) !== pngHeight(b) ? -1 : diffPngs(a, b, 0).count);
          const mv = moved(s2, s3), early = moved(s1, s2);
          let motionOk = true;
          let motionDetail = early === 0 ? 'three samples over ~1s identical' : 'page settled after the first sample, then identical';
          if (mv === -1) { motionOk = false; motionDetail = 'page height changed between samples'; }
          else if (mv > 0) { motionOk = false; motionDetail = `${mv} pixels still changing between samples with reduced motion on (JS/rAF/video motion)`; }
          const builtPng0 = await sh(page);

          // (c) contract checks ------------------------------------------
          const orderIds = contract[`order_${w}`] || contract.order || [];
          const texts = [...(contract.texts || []), ...(contract[`texts_${w}`] || [])];
          const primary = contract.primary && !contract.primary.none ? { id: contract.primary.id, text: contract.primary.text, minHeight: (contract.primary.min_height || {})[String(w)] ?? null } : null;
          const colsExpected = contract.layout && contract.layout[String(w)] && contract.layout[String(w)].columns;
          const minSize = contract.min_size || {};
          // ids the MOCK itself shows below the fold of a viewport snapshot (the only ones allowed to be off-screen)
          const mockBelowFold = [];
          if (!full) {
            for (const [id, b] of Object.entries((mockGeo && mockGeo.boxes) || {})) if (b && b.y >= viewport.height) mockBelowFold.push(id);
            for (const r of contract.regions || []) { const mb = r.mock_box && r.mock_box[String(w)]; if (mb && mb[1] >= viewport.height) mockBelowFold.push(r.id); }
          }
          const optional = new Set(Object.keys(contract.optional || {}));
          // Release 3 `locate`: stamp data-design onto the BUILT page's protected-file elements (never the mock). Only ids this width
          // actually needs can fail the locate check (a step the state does not show is not a failure).
          const sunAlso = contract[`sun_also_${w}`] || [];
          const neverRed = contract.never_red || [];
          if (contract.locate || contract.locate_cols) {
            const needed = new Set([...orderIds.filter(id => !optional.has(id)), ...Object.keys(minSize), ...Object.keys(anchors || {}), ...neverRed, ...sunAlso,
              ...(primary ? [primary.id] : []), ...(contract.regions || []).filter(r => r.mock_box && r.mock_box[String(w)]).map(r => r.id)]);
            const loc = await page.evaluate(resolveLocate, { locate: contract.locate || {}, cols: (contract.locate_cols || {})[String(w)] || [], needed: [...needed] });
            res.checks.push(check('locate', loc.problems.length === 0, loc.problems.length ? loc.problems.join('; ') : `${Object.keys(contract.locate || {}).length} ids resolved (data-design first, else selector), ${loc.cols} column elements`));
          }
          const cc = await page.evaluate(contractChecks, { order: orderIds, primary, noPrimary: !!(contract.primary && contract.primary.none), sunAlso, columns: colsExpected ? { expected: colsExpected } : null, minSize, viewportOnly: !full, mockBelowFold });
          if (neverRed.length) {
            const nr = await page.evaluate(neverRedCheck, { ids: neverRed });
            res.checks.push(check('never-red', nr.length === 0, nr.length ? nr.slice(0, 8).join('; ') + (nr.length > 8 ? ` ... +${nr.length - 8} more` : '') : `no coral #FF7A3D / Minny red #E0362C in text, background or border inside ${neverRed.join(', ')}`));
          }
          const orderProblems = cc.order.problems.filter(p => {
            const m = /^(missing|present but not visible): (.+)$/.exec(p);
            return !(m && optional.has(m[2]));
          });
          res.checks.push(check('order', orderProblems.length === 0, orderProblems.length ? orderProblems.join('; ') : `${orderIds.length} ids in order (${cc.order.orderMode}), all >= 40x24`));

          const scan = await page.evaluate(scanText);
          const an = analyseText(scan.items, builtPng0);
          const missing = texts.filter(t => !an.stream.includes(collapse(t)));
          res.checks.push(check('texts', missing.length === 0, missing.length ? 'missing VISIBLE text: ' + missing.map(t => `"${t}"`).join(', ') : `${texts.length} strings present in visible text nodes`));

          {
            // data-binding runs AUTOMATICALLY: when the driver offers an alternate sample, a second pass loads the page with it and the
            // page must show the alternate values (and none of the mock's). A contract with data_bound values but no such pass FAILS.
            let bc = null;
            if (drvRes && drvRes.altSample) {
              const ctx2 = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
              try {
                const pg2 = await ctx2.newPage();
                const r2 = await driver(pg2, contract, base, { width: w, designDir, opts: { ...opts, sample: drvRes.altSample } });
                await settle(pg2);
                const an2 = analyseText((await pg2.evaluate(scanText)).items, null);
                bc = bindingOf(r2 && r2.dataBinding, an2.stream, ' (alternate-sample pass)') || check('data-binding', false, 'alternate-sample pass: the driver returned no expectations');
              } catch (e) {
                bc = check('data-binding', false, 'alternate-sample pass could not run: ' + e.message);
              } finally { await ctx2.close(); }
            } else bc = bindingCheck(an.stream);
            if (!bc && contract.data_bound && contract.data_bound.length) bc = check('data-binding', false, 'binding not run: the contract has data_bound values but the driver offers no alternate sample to test them against');
            if (bc) res.checks.push(bc);
          }
          if (cc.primary) {
            const probs = [...cc.primary.problems];
            if (primary && !textOf(scan.items, primary.id).includes(collapse(primary.text))) probs.push(`primary visible text "${textOf(scan.items, primary.id)}" does not include "${primary.text}"`);
            res.checks.push(check('primary', probs.length === 0, probs.length ? probs.join('; ') : primary ? `"${primary.text}" ${cc.primary.height.toFixed(0)}px, only sun clickable` : 'primary.none: no sun-filled clickable control'));
          }
          if (cc.columns) res.checks.push(check('columns', cc.columns.actual === cc.columns.expected, `expected ${cc.columns.expected}, found ${cc.columns.actual} [data-design-col]`));

          const c = an.contrast;
          const indetBad = c.indeterminate > 3 || (c.measured > 0 && c.indeterminate / c.measured > 0.10);
          const cDetail = [];
          if (c.fails.length) cDetail.push(c.fails.slice(0, 12).map(f => `"${f.text}" ${f.ratio}:1 (${f.tag})`).join('; ') + (c.fails.length > 12 ? ` ... +${c.fails.length - 12} more` : ''));
          if (indetBad) cDetail.push(`${c.indeterminate} of ${c.measured} text items could not be measured even by pixel sampling (limit: 3 and 10%)`);
          res.checks.push(check('contrast>=4.5', !c.fails.length && !indetBad, cDetail.length ? cDetail.join('; ') : `${c.measured} text items ok (${c.sampled} via pixel sampling, ${c.indeterminate} unmeasurable)`));

          const tap = await page.evaluate(tapChecks, { minTap: 48 });
          res.checks.push(check('tap>=48px', tap.fails.length === 0,
            tap.fails.length ? tap.fails.slice(0, 12).map(f => `${f.el} "${f.text}" ${f.height}px`).join('; ') + (tap.fails.length > 12 ? ` ... +${tap.fails.length - 12} more` : '') : `${tap.checked} targets ok`));

          const mo = await page.evaluate(motionCheck, { allow: contract.reduced_motion_allow || [] });
          const moProblems = [];
          if (mo.running.length) moProblems.push('still running: ' + mo.running.slice(0, 8).join(', '));
          if (mo.named.length) moProblems.push('animation-name still set under reduced motion: ' + [...new Set(mo.named)].slice(0, 8).join(', '));
          if (!motionOk) moProblems.push(motionDetail);
          res.checks.push(check('reduced-motion', moProblems.length === 0, moProblems.length ? moProblems.join('; ') : 'no running animations; ' + motionDetail));

          // fonts: Baloo 2 headings/buttons, Nunito body, all loaded
          const faces = await page.evaluate(fontCheck);
          const fontProblems = [];
          for (const fam of ['Baloo 2', 'Nunito']) {
            const fs_ = faces.filter(f => f.family === fam);
            if (!fs_.length) fontProblems.push(`no @font-face for ${fam}`);
            else if (fs_.some(f => f.status === 'error')) fontProblems.push(`${fam} failed to load`);
            else if (!fs_.some(f => f.status === 'loaded')) fontProblems.push(`${fam} declared but no face is loaded`);
          }
          const fu = await page.evaluate(fontUsage, { balooClasses });
          fontProblems.push(...fu.bad.slice(0, 8));
          res.checks.push(check('fonts', fontProblems.length === 0, fontProblems.length ? fontProblems.join('; ') : `Baloo 2 on ${fu.headings} headings + ${fu.buttons} buttons, Nunito on body + ${fu.paras} paragraphs, faces loaded`));

          // geometry against the mock (anchors)
          if (opts['require-anchors']) {
            const noReason = Object.entries(exempt).filter(([, r]) => typeof r !== 'string' || !r.trim()).map(([id]) => id);
            const need = orderIds.filter(id => !optional.has(id) && !(anchors && anchors[id]) && !(typeof exempt[id] === 'string' && exempt[id].trim()));
            const probs = [];
            if (noReason.length) probs.push('exempt without a reason: ' + noReason.join(', '));
            if (need.length) probs.push('order ids neither anchored nor exempt: ' + need.join(', '));
            const nA = anchors ? Object.keys(anchors).length : 0, nE = Object.keys(exempt).length;
            res.checks.push(check('anchors-present', probs.length === 0, probs.length ? probs.join('; ') : `${nA} anchored, ${nE} exempt${nA === 0 ? ' (geometry: pixel-only)' : ''}`));
            if (nA === 0 && probs.length === 0) res.warnings.push('geometry: pixel-only (every order id is exempt from anchors)');
          }
          if (anchors) {
            const bg = await page.evaluate(builtBoxes, Object.keys(anchors));
            const gp = [];
            for (const [id, m] of Object.entries(mockGeo.boxes)) {
              const b = bg.boxes[id];
              if (!m) { gp.push(`${id}: anchor text "${anchors[id]}" not found in the MOCK (contract bug)`); continue; }
              if (!b) { if (!optional.has(id)) gp.push(`${id}: no visible built element`); continue; }
              if (!full && m.y >= viewport.height) continue; // the MOCK has it below the fold of a viewport snapshot
              if (!full && (b.y >= viewport.height || b.y + b.h <= 0)) { gp.push(`${id}: pushed below the fold (built y ${Math.round(b.y)}, viewport ${viewport.height}px) but the mock shows it on screen`); continue; }
              const tol = Math.max(24, 0.04 * mockGeo.docH);
              const why = [];
              if (Math.abs(b.y - m.y) > tol) why.push(`top ${Math.round(b.y)} vs mock ${Math.round(m.y)} (+-${Math.round(tol)})`);
              if (Math.abs(b.h - m.h) > 0.30 * m.h) why.push(`height ${Math.round(b.h)} vs ${Math.round(m.h)} (+-30%)`);
              if (Math.abs(b.w - m.w) > 0.15 * m.w && !(w <= 430 && b.w >= 0.9 * w)) why.push(`width ${Math.round(b.w)} vs ${Math.round(m.w)} (+-15%)`);
              if (why.length) gp.push(`${id}: ${why.join(', ')}`);
            }
            res.checks.push(check('geometry', gp.length === 0, gp.length ? gp.join('; ') : `${Object.keys(anchors).length} sections within tolerance of the mock`));
          }

          // regions: per-box comparison against the mock (catches an empty monster box a whole-screen ceiling hides)
          const regionOut = [];
          const regionJobs = [];
          const regions = (contract.regions || []).filter(r => r.mock_box && r.mock_box[String(w)]);
          if (regions.length) {
            const rb = await page.evaluate(builtBoxes, regions.map(r => r.id));
            for (const r of regions) {
              const mb = r.mock_box[String(w)];
              const b = rb.boxes[r.id];
              if (!b) { res.checks.push(check('region:' + r.id, false, 'no visible built element')); continue; }
              const cmp = compareRegion(mockPng0, builtPng0, { x: mb[0], y: mb[1], w: mb[2], h: mb[3] }, b, r.ceiling, r.min_edge_ratio);
              regionJobs.push({ r, b, cmp }); // own pixels are measured AFTER still-twin (see below): hiding and un-hiding re-rasterises the page
            }
          }

          // height (below-the-fold) + (d) pixel diff on the FULL page ----------
          const hM = pngHeight(mockPng0), hB = pngHeight(builtPng0);
          const allowed = Math.max(0.10 * hM, 120);
          if (full) res.checks.push(check('height', hB - hM <= allowed, `built page ${hB}px vs mock ${hM}px (built may exceed the mock by at most ${Math.round(allowed)}px)`));
          const H = Math.max(hM, hB);
          // mask: third-party boxes (Turnstile) painted the same in BOTH captures, so only the pixel diff ignores them
          const maskBoxes = (contract.mask || {})[String(w)] || [];
          const mockPng = maskPng(padPng(mockPng0, H, cornerColor(mockPng0)), maskBoxes);
          const builtPng = maskPng(padPng(builtPng0, H, cornerColor(builtPng0)), maskBoxes);
          const d = diffPngs(mockPng, builtPng, 0.1);
          const ceiling = contract.diff_ceiling[String(w)];
          res.diff = { fraction: +d.fraction.toFixed(5), pixels: d.count, total: d.total, ceiling, pass: d.fraction <= ceiling, mockHeight: hM, builtHeight: hB };
          res.checks.push(check('pixel-diff', res.diff.pass, `${(d.fraction * 100).toFixed(2)}% differing over the ${full ? 'full' : 'viewport'} ${H}px ${full ? 'page' : 'capture'} (ceiling ${(ceiling * 100).toFixed(1)}%)`));

          // .still twin: forcing the still class on the root must change nothing
          await page.evaluate(addStillClass);
          await page.waitForTimeout(120);
          const stillPng = await sh(page);
          let stillOk = pngHeight(stillPng) === hB;
          let stillDetail = '.still class on root renders identically';
          if (!stillOk) stillDetail = `.still changed the page height (${hB} -> ${pngHeight(stillPng)})`;
          else { const st = diffPngs(builtPng0, stillPng, 0); if (st.count) { stillOk = false; stillDetail = `.still changes ${st.count} pixels vs the reduced-motion render`; } }
          res.checks.push(check('still-twin', stillOk, stillDetail));
          await page.evaluate(removeStillClass);

          // Region own pixels: hide each region's element and count how much of its box changes (an element that renders nothing
          // changes ~0%, whatever the backdrop is). Done AFTER still-twin because hiding and un-hiding re-rasterises the page, which
          // made still-twin differ by 4-68px on every contract that has regions. A fresh "with" screenshot is taken right before each
          // hide, so any rasterisation noise cancels out.
          for (const { r, b, cmp } of regionJobs) {
            const sel = `[data-design="${String(r.id).replace(/"/g, '\\"')}"]`;
            const withBuf = await sh(page);
            const handle = await page.addStyleTag({ content: `${sel}, ${sel} * { visibility: hidden !important; }` });
            await page.waitForTimeout(60);
            const without = await sh(page);
            await handle.evaluate(n => n.remove());
            cmp.own = ownPixelFraction(withBuf, without, b);
            const ownMin = r.min_own_pixels ?? OWN_MIN_FRACTION;
            if (cmp.own < ownMin) { cmp.pass = false; cmp.problems.push(`region empty: hiding the element changes only ${(cmp.own * 100).toFixed(1)}% of its box (min ${(ownMin * 100).toFixed(1)}%): it renders nothing visible`); }
            res.checks.push(check('region:' + r.id, cmp.pass, cmp.pass ? `${(cmp.fraction * 100).toFixed(1)}% differing (ceiling ${(r.ceiling * 100).toFixed(1)}%), edges ${(cmp.edgeRatio * 100).toFixed(0)}% of the mock's, own pixels ${(cmp.own * 100).toFixed(0)}%` : cmp.problems.join('; ')));
            regionOut.push({ id: r.id, ok: cmp.pass, label: `${r.id} ${(cmp.fraction * 100).toFixed(1)}%`, mock: cmp.mock, built: cmp.built, diff: cmp.diff });
            (res.regions = res.regions || []).push({ id: r.id, pass: cmp.pass, fraction: +cmp.fraction.toFixed(4), ceiling: r.ceiling, builtStddev: +cmp.builtSd.toFixed(1), edgeRatio: +cmp.edgeRatio.toFixed(3), ownPixels: +cmp.own.toFixed(3) });
          }

          // Width cycle LAST (it re-rasterises the page, which is what used to make still-twin fail): horizontal scroll at the five
          // widths, and layout sanity at 360 / 768 / 1024 + the contract's own widths, in the same state (once per contract).
          if (first) {
            const layoutWidths = new Set([...LAYOUT_WIDTHS, ...Object.keys(contract.mock).map(Number)]);
            const bad = [], layoutBad = [];
            res.layout = {};
            for (const vw of [...new Set([...OVERFLOW_WIDTHS, ...layoutWidths])].sort((x, y) => x - y)) {
              await page.setViewportSize({ width: vw, height: viewport.height });
              await page.waitForTimeout(120);
              if (OVERFLOW_WIDTHS.includes(vw)) {
                const o = await page.evaluate(overflowCheck);
                if (o.scrollWidth > o.innerWidth) bad.push(`${vw}px: content ${o.scrollWidth}px wide`);
              }
              if (layoutWidths.has(vw)) {
                const offenders = await page.evaluate(layoutSanity, { allow: contract.overflow_allow || [], texts: [...(contract.texts || []), ...(contract['texts_' + w] || []), ...(contract.primary && contract.primary.text ? [contract.primary.text] : [])] });
                if (offenders.length) {
                  res.layout[vw] = offenders;
                  const shotName = `${contract.id}-layout-${vw}.png`;
                  await page.screenshot({ path: path.join(out, shotName), fullPage: full, animations: 'disabled', caret: 'hide' });
                  layoutBad.push(`${vw}px: ` + offenders.slice(0, 4).map(o => `${o.kind} ${o.sel}: ${o.detail}`).join(' | ') + (offenders.length > 4 ? ` (+${offenders.length - 4} more)` : '') + ` [${shotName}]`);
                }
              }
            }
            await page.setViewportSize(viewport);
            res.checks.push(check('no-h-scroll@360/390/768/1024/1280', bad.length === 0, bad.length ? bad.join('; ') : 'ok'));
            res.checks.push(check('layout-sanity', layoutBad.length === 0, layoutBad.length ? layoutBad.join('; ') : `no overlapping text, escaping control, split word or clipped text at ${[...layoutWidths].sort((x, y) => x - y).join('/')}px`));
          }
          await bctx.close();

          // (e) composite -------------------------------------------------
          const ok = res.checks.every(x => x.pass);
          if (ok && opts.composites === 'fail') return;
          const name = `${contract.id}-${w}.png`;
          await writeComposite(browser, path.join(out, name), { title: `${contract.id} @ ${w}px  diff ${(d.fraction * 100).toFixed(2)}%`, ok, design: mockPng, built: builtPng, diff: d.diffPng, regions: regionOut });
          res.composite = name;
        } catch (e) {
          if (e instanceof InfraError) throw e;
          res.checks.push(check('harness-error', false, e.stack || e.message));
        }
      }
    };
    // Bounded concurrency (each task has its own browser contexts). Default 1 = fully sequential.
    const limit = Math.max(1, parseInt(opts.concurrency || '1', 10));
    let next = 0, infra = null;
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length && !infra) {
        const t = tasks[next++];
        try { await runTask(t); } catch (e) { infra = infra || e; }
      }
    }));
    if (infra) throw infra;
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => r.checks.some(c => !c.pass));
  const report = { generated: new Date().toISOString(), base, design: designDir, ok: failed.length === 0, results };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'report.md'), renderMd(report));
  return report;
}

function renderMd(report) {
  const L = [`# Fidelity report`, '', `- base: ${report.base}`, `- design: ${report.design}`, `- generated: ${report.generated}`, `- verdict: **${report.ok ? 'PASS' : 'FAIL'}**`, ''];
  for (const r of report.results) {
    const ok = r.checks.every(c => c.pass);
    L.push(`## ${ok ? 'PASS' : 'FAIL'} ${r.contract} @ ${r.width}px`, '');
    if (r.composite) L.push(`Composite: \`${r.composite}\``, '');
    for (const c of r.checks) L.push(`- ${c.pass ? 'PASS' : 'FAIL'} **${c.name}** ${c.detail}`);
    for (const w of r.warnings) L.push(`- WARN ${w}`);
    if (r.layout && Object.keys(r.layout).length) { L.push('', 'Layout-sanity offenders:'); for (const [vw, list] of Object.entries(r.layout)) for (const o of list) L.push(`- @${vw}px ${o.kind} ${o.sel}: ${o.detail}`); }
    if (r.regions) { L.push('', 'Regions:'); for (const g of r.regions) L.push(`- ${g.pass ? 'PASS' : 'FAIL'} ${g.id}: ${(g.fraction * 100).toFixed(1)}% differing (ceiling ${(g.ceiling * 100).toFixed(1)}%), built stddev ${g.builtStddev}, edge ${(g.edgeRatio * 100).toFixed(0)}% of the mock's, own pixels ${(g.ownPixels * 100).toFixed(0)}%`); }
    if (r.exempt && Object.keys(r.exempt).length) { L.push('', 'Geometry NOT checked (anchors_exempt, as in force at this width):'); for (const [id, why] of Object.entries(r.exempt)) L.push(`- ${id}: ${why || '(NO REASON GIVEN)'}`); }
    if (r.anchorBoxes) { L.push('', 'Anchored mock boxes (x, y, w, h):'); for (const [id, b] of Object.entries(r.anchorBoxes)) L.push(`- ${id}: ${b ? `${b.x}, ${b.y}, ${b.w}, ${b.h}` : 'ANCHOR TEXT NOT FOUND'}`); }
    L.push('');
  }
  return L.join('\n');
}

// ---- CLI ---------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = await runFidelity(opts);
    for (const r of report.results) {
      const ok = r.checks.every(c => c.pass);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.contract} @ ${r.width}`);
      for (const c of r.checks) if (!c.pass) console.log(`        x ${c.name}: ${c.detail}`);
    }
    console.log(`\n${report.ok ? 'PASS' : 'FAIL'} - report: ${path.join(opts.out, 'report.md')}`);
    process.exit(report.ok ? 0 : 1);
  } catch (e) {
    console.error((e instanceof InfraError ? 'ERROR: ' : 'CRASH: ') + (e.stack && !(e instanceof InfraError) ? e.stack : e.message));
    process.exit(2);
  }
}
