// Token/font guard logic (used by tests/design-tokens.test.mjs; pure functions, root passed in
// so bite tests can feed scratch trees).
import fs from 'node:fs';
import path from 'node:path';

// ---- a small CSS block parser: custom-property declarations with their block context ----------
// Returns [{name, value, context:[prelude, prelude, ...]}]. Handles comments, strings, url()/parens.
export function parseCustomProps(css, prefix = '--r2l-') {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [];
  const stack = [];
  let buf = '';
  let paren = 0, quote = null;
  const flushDecl = () => {
    const m = new RegExp('^\\s*(' + prefix.replace(/[-]/g, '\\-') + '[\\w-]+)\\s*:\\s*([\\s\\S]*?)\\s*$').exec(buf);
    if (m) decls.push({ name: m[1], value: m[2].replace(/\s+/g, ' '), context: stack.slice() });
    buf = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) { buf += ch; if (ch === '\\') { buf += src[++i] || ''; } else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(') paren++;
    if (ch === ')') paren = Math.max(0, paren - 1);
    if (paren === 0 && ch === '{') { stack.push(buf.replace(/\s+/g, ' ').trim()); buf = ''; continue; }
    if (paren === 0 && ch === ';') { flushDecl(); continue; }
    if (paren === 0 && ch === '}') { if (buf.trim()) flushDecl(); buf = ''; stack.pop(); continue; }
    buf += ch;
  }
  return decls;
}

const isRootOnly = ctx => ctx.length === 1 && ctx[0] === ':root';

// Built tokens file vs design tokens.css: every design token declared EXACTLY ONCE, in a top-level
// :root (not in @media/@supports/any other block), with an identical value (whitespace-normalised).
export function tokenProblems(designCss, builtCss) {
  const want = new Map();
  for (const d of parseCustomProps(designCss)) if (!want.has(d.name)) want.set(d.name, d.value);
  const problems = [];
  if (want.size === 0) problems.push('design tokens.css declares no --r2l-* properties (parser broken?)');
  const have = parseCustomProps(builtCss);
  for (const [name, value] of want) {
    const mine = have.filter(d => d.name === name);
    if (!mine.length) { problems.push(`MISSING ${name}`); continue; }
    if (mine.length > 1) problems.push(`DECLARED ${mine.length}x ${name} (must be exactly once)`);
    for (const d of mine) {
      if (!isRootOnly(d.context)) problems.push(`WRONG CONTEXT ${name} is inside "${d.context.join(' { ')}" (must be a top-level :root)`);
      if (d.value !== value) problems.push(`DIFFERENT ${name}: design "${value}" vs built "${d.value}"`);
    }
  }
  return problems;
}

export function fontProblems(designFontsDir, builtFontsDir) {
  const names = fs.readdirSync(designFontsDir).filter(f => f.endsWith('.woff2'));
  const problems = [];
  if (!names.length) problems.push('design has no woff2 fonts (wrong dir?)');
  for (const n of names) {
    const b = path.join(builtFontsDir, n);
    if (!fs.existsSync(b)) problems.push(`MISSING font ${n}`);
    else if (!fs.readFileSync(b).equals(fs.readFileSync(path.join(designFontsDir, n)))) problems.push(`DIFFERENT bytes ${n}`);
  }
  return problems;
}

function walk(dir, exts, skipDirs = []) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return skipDirs.includes(e.name) ? [] : walk(p, exts, skipDirs);
    return exts.some(x => e.name.endsWith(x)) ? [p] : [];
  });
}

const SRC_EXTS = ['.css', '.astro', '.html', '.ts', '.tsx', '.js', '.mjs', '.svelte', '.scss'];

// Any redeclaration of a design token anywhere in shipped CSS/markup/script source, other than the
// one authoritative src/styles/r2l-tokens.css. `var(--r2l-x)` USES are fine; declarations are not:
//   `--r2l-x: ...` in any css/astro/html, `setProperty('--r2l-x', ...)`, and any style attribute.
// Built dist CSS/HTML is parsed properly: a token may appear only in a top-level :root with the
// design value, once per file (the bundled copy of r2l-tokens.css).
export function shippedProblems(root, designCss) {
  const names = new Set(parseCustomProps(designCss).map(d => d.name));
  const designValue = new Map(parseCustomProps(designCss).map(d => [d.name, d.value]));
  const problems = [];
  const tokensFile = path.join(root, 'src', 'styles', 'r2l-tokens.css');
  const nameAlt = [...names].map(n => n.replace(/[-]/g, '\\-')).join('|');
  const declRe = new RegExp('(?<!var\\(\\s*)(' + (nameAlt || '(?!)') + ')\\s*:', 'g');
  const setRe = new RegExp('setProperty\\(\\s*[\'"](' + (nameAlt || '(?!)') + ')[\'"]', 'g');

  const scanRaw = (file, text) => {
    const clean = file.endsWith('.css') || file.endsWith('.scss') ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text;
    for (const m of clean.matchAll(declRe)) problems.push(`OVERRIDE ${m[1]} declared in ${path.relative(root, file)}`);
    for (const m of clean.matchAll(setRe)) problems.push(`OVERRIDE ${m[1]} set via setProperty in ${path.relative(root, file)}`);
  };
  for (const dir of ['src', 'public']) {
    for (const f of walk(path.join(root, dir), SRC_EXTS, ['fonts'])) {
      if (path.resolve(f) === path.resolve(tokensFile)) continue;
      scanRaw(f, fs.readFileSync(f, 'utf8'));
    }
  }
  // dist
  const norm = v => v.replace(/\s+/g, '').toLowerCase();
  const checkParsed = (file, css) => {
    const seen = new Map();
    for (const d of parseCustomProps(css)) {
      if (!names.has(d.name)) continue;
      seen.set(d.name, (seen.get(d.name) || 0) + 1);
      if (!isRootOnly(d.context)) problems.push(`DIST ${d.name} declared inside "${d.context.join(' { ')}" in ${path.relative(root, file)}`);
      else if (norm(d.value) !== norm(designValue.get(d.name))) problems.push(`DIST ${d.name} has value "${d.value}" (design "${designValue.get(d.name)}") in ${path.relative(root, file)}`);
    }
    for (const [n, c] of seen) if (c > 1) problems.push(`DIST ${n} declared ${c}x in ${path.relative(root, file)}`);
  };
  const dist = path.join(root, 'dist');
  for (const f of walk(dist, ['.css'])) checkParsed(f, fs.readFileSync(f, 'utf8'));
  for (const f of walk(dist, ['.html'])) {
    const html = fs.readFileSync(f, 'utf8');
    let rest = html;
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) { checkParsed(f, m[1]); rest = rest.replace(m[0], ''); }
    scanRaw(f, rest);
  }
  return problems;
}

export function srcHasDataDesign(root) {
  return walk(path.join(root, 'src'), SRC_EXTS).some(f => /\bdata-design(?:-col)?\s*=/.test(fs.readFileSync(f, 'utf8')) || /['"]data-design['"]/.test(fs.readFileSync(f, 'utf8')));
}

// Skip expiry: the guards may skip ("not yet present") ONLY before the first screen lands.
export function guardsRequired(root, env = process.env) {
  return env.DESIGN_TOKENS_REQUIRED === '1' || srcHasDataDesign(root);
}
