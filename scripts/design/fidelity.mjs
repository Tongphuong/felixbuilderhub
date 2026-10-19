#!/usr/bin/env node
// Fidelity harness: does the BUILT page match the LOCKED design? (R2L-ISLAND, rule 28.)
//
//   node scripts/design/fidelity.mjs --design <designDir> --contracts <contractsDir> \
//        --base <url-of-built-site> --out <dir> [--only <contractId>] [--state-driver <module>] \
//        [--token <magic-link-token> | --login-url <url>] [--chrome <path>] [--composites all|fail] [--require-anchors] [--concurrency N]
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
import { contractChecks, tapChecks, overflowCheck, motionCheck, addStillClass, fontCheck, fontUsage, mockBoxes, builtBoxes, scanText } from './lib/in-page.mjs';
import { diffPngs, writeComposite, padPng, cornerColor, pngHeight, fitWidth } from './lib/pixels.mjs';
import { analyseText, textOf, collapse } from './lib/text.mjs';

const OVERFLOW_WIDTHS = [360, 390, 768, 1024, 1280];
const BOOLEAN_FLAGS = new Set(['require-anchors']);
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

// A contract's width-keyed fields must all describe exactly the widths of the mocks it lists.
export function validateContract(c) {
  const set = o => Object.keys(o || {}).sort().join(',');
  const want = set(c.mock);
  if (!want) throw new InfraError(`contract ${c.id}: "mock" lists no widths`);
  for (const f of ['viewport', 'diff_ceiling', 'reference']) {
    if (f === 'reference' && !c.reference) continue;
    if (set(c[f]) !== want) throw new InfraError(`contract ${c.id}: "${f}" widths [${set(c[f])}] != mock widths [${want}]`);
  }
  const both = Object.keys(c.anchors || {}).filter(id => Object.prototype.hasOwnProperty.call(c.anchors_exempt || {}, id));
  if (both.length) throw new InfraError(`contract ${c.id}: id(s) listed in BOTH anchors and anchors_exempt: ${both.join(', ')}`);
  const widths = new Set(Object.keys(c.mock));
  for (const k of Object.keys(c)) {
    const m = /^(?:order|texts)_(\d+)$/.exec(k);
    if (m && !widths.has(m[1])) throw new InfraError(`contract ${c.id}: "${k}" is for a width with no mock`);
  }
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

const check = (name, pass, detail = '') => ({ name, pass: !!pass, detail });

async function settle(page, { network = true } = {}) {
  await page.waitForLoadState('load').catch(() => {});
  if (network) await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(network ? 250 : 80);
}

const shot = async (page, animations = 'disabled') => fitWidth(await page.screenshot({ fullPage: true, animations, caret: 'hide' }), page.viewportSize().width);

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
          const mockPng0 = await shot(mpage);
          const anchors = contract.anchors && Object.keys(contract.anchors).length ? contract.anchors : null;
          const exempt = contract.anchors_exempt || {};
          const mockGeo = anchors ? await mpage.evaluate(mockBoxes, anchors) : null;
          res.exempt = exempt;
          if (mockGeo) res.anchorBoxes = Object.fromEntries(Object.entries(mockGeo.boxes).map(([id, b]) => [id, b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }]));
          await mctx.close();

          // (b) built -----------------------------------------------------
          const bctx = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
          const page = await bctx.newPage();
          try {
            await driver(page, contract, base, { width: w, designDir, opts });
            await settle(page);
          } catch (e) {
            res.checks.push(check('state-driver', false, `could not reach state "${contract.built && contract.built.state}": ${e.message}`));
            await bctx.close();
            return;
          }
          res.checks.push(check('state-driver', true, `reached "${contract.built.state}" at ${page.url()}`));

          // reduced motion, behavioural half: two samples 600ms apart must be pixel-identical (JS/rAF motion)
          const s1 = await shot(page, 'allow');
          await page.waitForTimeout(600);
          const s2 = await shot(page, 'allow');
          let motionDetail = 'two samples 600ms apart identical';
          let motionOk = true;
          if (pngHeight(s1) !== pngHeight(s2)) { motionOk = false; motionDetail = 'page height changed between samples'; }
          else { const m = diffPngs(s1, s2, 0); if (m.count) { motionOk = false; motionDetail = `${m.count} pixels changed in 600ms with reduced motion on (JS/rAF/video motion)`; } }
          const builtPng0 = await shot(page);

          // (c) contract checks ------------------------------------------
          const orderIds = contract[`order_${w}`] || contract.order || [];
          const texts = [...(contract.texts || []), ...(contract[`texts_${w}`] || [])];
          const primary = contract.primary ? { id: contract.primary.id, text: contract.primary.text, minHeight: (contract.primary.min_height || {})[String(w)] ?? null } : null;
          const colsExpected = contract.layout && contract.layout[String(w)] && contract.layout[String(w)].columns;
          const cc = await page.evaluate(contractChecks, { order: orderIds, primary, columns: colsExpected ? { expected: colsExpected } : null });
          const optional = new Set(Object.keys(contract.optional || {}));
          const orderProblems = cc.order.problems.filter(p => {
            const m = /^(missing|present but not visible): (.+)$/.exec(p);
            return !(m && optional.has(m[2]));
          });
          res.checks.push(check('order', orderProblems.length === 0, orderProblems.length ? orderProblems.join('; ') : `${orderIds.length} ids in order (${cc.order.orderMode}), all >= 40x24`));

          const scan = await page.evaluate(scanText);
          const an = analyseText(scan.items, builtPng0);
          const missing = texts.filter(t => !an.stream.includes(collapse(t)));
          res.checks.push(check('texts', missing.length === 0, missing.length ? 'missing VISIBLE text: ' + missing.map(t => `"${t}"`).join(', ') : `${texts.length} strings present in visible text nodes`));

          if (cc.primary) {
            const probs = [...cc.primary.problems];
            if (!textOf(scan.items, primary.id).includes(collapse(primary.text))) probs.push(`primary visible text "${textOf(scan.items, primary.id)}" does not include "${primary.text}"`);
            res.checks.push(check('primary', probs.length === 0, probs.length ? probs.join('; ') : `"${primary.text}" ${cc.primary.height.toFixed(0)}px, only sun clickable`));
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
          const fu = await page.evaluate(fontUsage);
          fontProblems.push(...fu.bad.slice(0, 8));
          res.checks.push(check('fonts', fontProblems.length === 0, fontProblems.length ? fontProblems.join('; ') : `Baloo 2 on ${fu.headings} headings + ${fu.buttons} buttons, Nunito on body + ${fu.paras} paragraphs, faces loaded`));

          if (first) {
            const bad = [];
            for (const ow of OVERFLOW_WIDTHS) {
              await page.setViewportSize({ width: ow, height: viewport.height });
              await page.waitForTimeout(80);
              const o = await page.evaluate(overflowCheck);
              if (o.scrollWidth > o.innerWidth) bad.push(`${ow}px: content ${o.scrollWidth}px wide`);
            }
            await page.setViewportSize(viewport);
            await page.waitForTimeout(80);
            res.checks.push(check('no-h-scroll@360/390/768/1024/1280', bad.length === 0, bad.length ? bad.join('; ') : 'ok'));
          }

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
              const tol = Math.max(24, 0.04 * mockGeo.docH);
              const why = [];
              if (Math.abs(b.y - m.y) > tol) why.push(`top ${Math.round(b.y)} vs mock ${Math.round(m.y)} (+-${Math.round(tol)})`);
              if (Math.abs(b.h - m.h) > 0.30 * m.h) why.push(`height ${Math.round(b.h)} vs ${Math.round(m.h)} (+-30%)`);
              if (Math.abs(b.w - m.w) > 0.15 * m.w && !(w <= 430 && b.w >= 0.9 * w)) why.push(`width ${Math.round(b.w)} vs ${Math.round(m.w)} (+-15%)`);
              if (why.length) gp.push(`${id}: ${why.join(', ')}`);
            }
            res.checks.push(check('geometry', gp.length === 0, gp.length ? gp.join('; ') : `${Object.keys(anchors).length} sections within tolerance of the mock`));
          }

          // height (below-the-fold) + (d) pixel diff on the FULL page ----------
          const hM = pngHeight(mockPng0), hB = pngHeight(builtPng0);
          const allowed = Math.max(0.10 * hM, 120);
          res.checks.push(check('height', hB - hM <= allowed, `built page ${hB}px vs mock ${hM}px (built may exceed the mock by at most ${Math.round(allowed)}px)`));
          const H = Math.max(hM, hB);
          const mockPng = padPng(mockPng0, H, cornerColor(mockPng0));
          const builtPng = padPng(builtPng0, H, cornerColor(builtPng0));
          const d = diffPngs(mockPng, builtPng, 0.1);
          const ceiling = contract.diff_ceiling[String(w)];
          res.diff = { fraction: +d.fraction.toFixed(5), pixels: d.count, total: d.total, ceiling, pass: d.fraction <= ceiling, mockHeight: hM, builtHeight: hB };
          res.checks.push(check('pixel-diff', res.diff.pass, `${(d.fraction * 100).toFixed(2)}% differing over the full ${H}px page (ceiling ${(ceiling * 100).toFixed(1)}%)`));

          // .still twin: forcing the still class on the root must change nothing
          await page.evaluate(addStillClass);
          await page.waitForTimeout(120);
          const stillPng = await shot(page);
          let stillOk = pngHeight(stillPng) === hB;
          let stillDetail = '.still class on root renders identically';
          if (!stillOk) stillDetail = `.still changed the page height (${hB} -> ${pngHeight(stillPng)})`;
          else { const st = diffPngs(builtPng0, stillPng, 0); if (st.count) { stillOk = false; stillDetail = `.still changes ${st.count} pixels vs the reduced-motion render`; } }
          res.checks.push(check('still-twin', stillOk, stillDetail));
          await bctx.close();

          // (e) composite -------------------------------------------------
          const ok = res.checks.every(x => x.pass);
          if (ok && opts.composites === 'fail') return;
          const name = `${contract.id}-${w}.png`;
          await writeComposite(browser, path.join(out, name), { title: `${contract.id} @ ${w}px  diff ${(d.fraction * 100).toFixed(2)}%`, ok, design: mockPng, built: builtPng, diff: d.diffPng });
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
    if (r.exempt && Object.keys(r.exempt).length) { L.push('', 'Geometry NOT checked (anchors_exempt):'); for (const [id, why] of Object.entries(r.exempt)) L.push(`- ${id}: ${why || '(NO REASON GIVEN)'}`); }
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
