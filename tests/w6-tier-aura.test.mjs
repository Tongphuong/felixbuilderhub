import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

/** @type {import('vite').ViteDevServer | undefined} */
let viteServer;
/** @type {import('astro/container').experimental_AstroContainer | undefined} */
let container;

async function ensureHarness() {
  if (container) return;
  const configFn = getViteConfig({}, { root: process.cwd() });
  const config = await configFn({ command: 'serve', mode: 'development' });
  viteServer = await createServer({
    ...config,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  await viteServer.pluginContainer.buildStart({});
  container = await AstroContainer.create();
}

async function renderComponent(modulePath, props) {
  await ensureHarness();
  const Component = (await viteServer.ssrLoadModule(modulePath)).default;
  return container.renderToString(Component, { props });
}

test.before(ensureHarness);
test.after(async () => {
  if (viteServer) await viteServer.close();
});

const css = readFileSync('src/styles/r2l-w6-tiers.css', 'utf8');
const cssLines = css.split(/\r?\n/).length;
const shopPage = readFileSync('src/pages/read2lead/shop.astro', 'utf8');

test('tier stylesheet defines the four approved color tokens under 200 lines', () => {
  assert.match(css, /--w6-common:\s*#94a3b8/);
  assert.match(css, /--w6-rare:\s*#3b82f6/);
  assert.match(css, /--w6-epic:\s*#a855f7/);
  assert.match(css, /--w6-legendary:\s*#fbbf24/);
  assert.ok(cssLines < 200, `tier CSS has ${cssLines} lines`);
});

test('tier stylesheet respects reduced motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation:\s*none !important/);
});

test('common TierAura is a no-op without aura wrapper', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/TierAura.astro', {
    rarity: 'common',
  });
  assert.doesNotMatch(html, /w6-tier-aura/);
});

test('rare TierAura renders two CSS sparkles and no magic ring', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/TierAura.astro', {
    rarity: 'rare',
  });
  assert.match(html, /data-rarity="?rare"?/);
  assert.equal((html.match(/w6-tier-aura__spark"/g) || []).length, 2);
  assert.doesNotMatch(html, /w6-tier-aura__ring/);
});

test('epic TierAura renders six sparkles and a magic ring', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/TierAura.astro', {
    rarity: 'epic',
  });
  assert.equal((html.match(/w6-tier-aura__spark"/g) || []).length, 6);
  assert.match(html, /w6-tier-aura__ring/);
});

test('legendary TierAura uses the gold layer with eight sparkles', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/TierAura.astro', {
    rarity: 'legendary',
  });
  assert.match(html, /data-rarity="?legendary"?/);
  assert.equal((html.match(/w6-tier-aura__spark"/g) || []).length, 8);
});

test('RarityBadge reads the shared W6 token with its approved fallback', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/RarityBadge.astro', {
    rarity: 'epic',
  });
  assert.match(html, /var\(--w6-epic, #a855f7\)/);
  assert.match(html, /✨/);
});

test('live shop keeps shared W6 rarity tokens and reduced-motion styling', () => {
  assert.match(shopPage, /r2l-w6-tiers\.css/);
  assert.match(shopPage, /var\(--w6-rare\)/);
  assert.match(shopPage, /var\(--w6-epic\)/);
  assert.match(shopPage, /prefers-reduced-motion: reduce/);
});
