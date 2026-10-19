#!/usr/bin/env node
// Fidelity harness: does the BUILT page match the LOCKED design? (R2L-ISLAND, rule 28.)
//
//   node scripts/design/fidelity.mjs --design <designDir> --contracts <contractsDir> \
//        --base <url-of-built-site> --out <dir> [--only <contractId>] [--state-driver <module>] \
//        [--token <magic-link-token> | --login-url <url>] [--chrome <path>] [--composites all|fail]
//
// For each contract x viewport width:
//   (a) render the mock (file://, fonts included) at width x contract.viewport[width], screenshot it
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
import { contractChecks, a11yChecks, overflowCheck, animationCheck, fontCheck } from './lib/in-page.mjs';
import { diffPngs, writeComposite } from './lib/pixels.mjs';

const OVERFLOW_WIDTHS = [360, 390, 768, 1024, 1280];
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findChrome(explicit) {
  const list = explicit ? [explicit] : CHROME_CANDIDATES;
  const hit = list.find(p => fs.existsSync(p));
  if (!hit) throw new InfraError('no Chrome/Chromium found; set CHROME_PATH or pass --chrome (tried: ' + list.join(', ') + ')');
  return hit;
}

class InfraError extends Error {}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new InfraError('unexpected argument: ' + a);
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new InfraError('missing value for --' + k);
    o[k] = v; i++;
  }
  return o;
}

export function loadContracts(dir, only) {
  if (!fs.existsSync(dir)) throw new InfraError('contracts dir not found: ' + dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const all = files.map(f => ({ file: f, ...{ c: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } })).map(x => x.c);
  const picked = only ? all.filter(c => c.id === only) : all;
  if (!picked.length) throw new InfraError(only ? `no contract with id "${only}" in ${dir}` : `no *.json contracts in ${dir}`);
  return picked;
}

const check = (name, pass, detail = '') => ({ name, pass: !!pass, detail });
const collapse = s => String(s).normalize('NFC').replace(/[\s ]+/g, ' ').trim();

async function settle(page, { network = true } = {}) {
  await page.waitForLoadState('load').catch(() => {});
  if (network) await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(network ? 250 : 80);
}

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
    for (const contract of contracts) {
      const widths = Object.keys(contract.mock || {}).map(Number).sort((a, b) => a - b);
      if (!widths.length) throw new InfraError(`contract ${contract.id} has no "mock" widths`);
      let overflowDone = false;
      for (const w of widths) {
        const res = { contract: contract.id, width: w, checks: [], diff: null, composite: null, warnings: [] };
        results.push(res);
        const h = contract.viewport && contract.viewport[String(w)];
        if (!h) throw new InfraError(`contract ${contract.id} has no viewport height for ${w}`);
        const viewport = { width: w, height: h };
        try {
          // (a) mock ------------------------------------------------------
          const mockRel = contract.mock[String(w)];
          const mockPath = path.join(designDir, mockRel);
          if (!fs.existsSync(mockPath)) throw new InfraError('mock file missing: ' + mockPath);
          const mctx = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
          const mpage = await mctx.newPage();
          await mpage.goto(pathToFileURL(mockPath).href, { waitUntil: 'load' });
          await settle(mpage, { network: false });
          const badFonts = (await mpage.evaluate(fontCheck)).filter(f => f.status === 'error');
          if (badFonts.length) throw new InfraError('mock fonts failed to load: ' + badFonts.map(f => f.family).join(', '));
          const mockPng = await mpage.screenshot({ animations: 'disabled', caret: 'hide' });
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
            continue;
          }
          res.checks.push(check('state-driver', true, `reached "${contract.built.state}" at ${page.url()}`));
          const builtPng = await page.screenshot({ animations: 'disabled', caret: 'hide' });

          // (c) contract checks ------------------------------------------
          const orderIds = (contract[`order_${w}`] || contract.order || []);
          const texts = [...(contract.texts || []), ...(contract[`texts_${w}`] || [])];
          const primary = contract.primary ? { id: contract.primary.id, text: contract.primary.text, minHeight: (contract.primary.min_height || {})[String(w)] ?? null } : null;
          const colsExpected = contract.layout && contract.layout[String(w)] && contract.layout[String(w)].columns;
          const cc = await page.evaluate(contractChecks, { order: orderIds, texts, primary, columns: colsExpected ? { expected: colsExpected } : null });
          const optional = new Set(Object.keys(contract.optional || {}));
          const orderProblems = cc.order.problems.filter(p => {
            const id = p.replace(/^(missing|present but not visible): /, '');
            return !(optional.has(id) && /^(missing|present but not visible):/.test(p));
          });
          res.checks.push(check('order', orderProblems.length === 0, orderProblems.length ? orderProblems.join('; ') : `${orderIds.length} ids in order (${cc.order.orderMode})`));
          res.checks.push(check('texts', cc.texts.missing.length === 0, cc.texts.missing.length ? 'missing visible text: ' + cc.texts.missing.map(t => `"${t}"`).join(', ') : `${texts.length} strings present`));
          if (cc.primary) {
            res.checks.push(check('primary', cc.primary.problems.length === 0, cc.primary.problems.length ? cc.primary.problems.join('; ') : `"${cc.primary.text}" ${cc.primary.height.toFixed(0)}px`));
          }
          if (cc.columns) res.checks.push(check('columns', cc.columns.actual === cc.columns.expected, `expected ${cc.columns.expected}, found ${cc.columns.actual} [data-design-col]`));

          const a11y = await page.evaluate(a11yChecks, { minRatio: 4.5, minTap: 48 });
          res.checks.push(check('contrast>=4.5', a11y.contrast.fails.length === 0,
            a11y.contrast.fails.length ? a11y.contrast.fails.slice(0, 12).map(f => `"${f.text}" ${f.ratio}:1 (${f.tag})`).join('; ') + (a11y.contrast.fails.length > 12 ? ` ... +${a11y.contrast.fails.length - 12} more` : '')
              : `${a11y.contrast.checked} text elements ok`));
          if (a11y.contrast.indeterminate) res.warnings.push(`contrast: ${a11y.contrast.indeterminate} text elements sit on gradient/image backgrounds and were NOT measured`);
          res.checks.push(check('tap>=48px', a11y.tap.fails.length === 0,
            a11y.tap.fails.length ? a11y.tap.fails.slice(0, 12).map(f => `${f.el} "${f.text}" ${f.height}px`).join('; ') + (a11y.tap.fails.length > 12 ? ` ... +${a11y.tap.fails.length - 12} more` : '') : `${a11y.tap.checked} targets ok`));

          const anim = await page.evaluate(animationCheck);
          res.checks.push(check('reduced-motion', anim.running.length === 0, anim.running.length ? 'still running: ' + anim.running.slice(0, 8).join(', ') : 'no running animations'));

          if (!overflowDone) {
            overflowDone = true;
            const bad = [];
            for (const ow of OVERFLOW_WIDTHS) {
              await page.setViewportSize({ width: ow, height: h });
              await page.waitForTimeout(80);
              const o = await page.evaluate(overflowCheck);
              if (o.scrollWidth > o.innerWidth) bad.push(`${ow}px: content ${o.scrollWidth}px wide`);
            }
            await page.setViewportSize(viewport);
            res.checks.push(check('no-h-scroll@360/390/768/1024/1280', bad.length === 0, bad.length ? bad.join('; ') : 'ok'));
          }
          await bctx.close();

          // (d) pixel diff ------------------------------------------------
          const d = diffPngs(mockPng, builtPng, 0.1);
          const ceiling = (contract.diff_ceiling || {})[String(w)];
          if (ceiling == null) throw new InfraError(`contract ${contract.id} has no diff_ceiling for ${w}`);
          res.diff = { fraction: +d.fraction.toFixed(5), pixels: d.count, total: d.total, ceiling, pass: d.fraction <= ceiling };
          res.checks.push(check('pixel-diff', res.diff.pass, `${(d.fraction * 100).toFixed(2)}% differing (ceiling ${(ceiling * 100).toFixed(1)}%)`));

          // (e) composite -------------------------------------------------
          const ok = res.checks.every(c => c.pass);
          if (ok && opts.composites === 'fail') continue;
          const name = `${contract.id}-${w}.png`;
          await writeComposite(browser, path.join(out, name), { title: `${contract.id} @ ${w}px  diff ${(d.fraction * 100).toFixed(2)}%`, ok, design: mockPng, built: builtPng, diff: d.diffPng });
          res.composite = name;
        } catch (e) {
          if (e instanceof InfraError) throw e;
          res.checks.push(check('harness-error', false, e.stack || e.message));
        }
      }
    }
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
