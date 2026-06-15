import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const avatarSource = readFileSync('src/lib/monster-avatar.ts', 'utf8');
const builderSource = readFileSync('src/lib/monster-builder.ts', 'utf8');
const shopSource = readFileSync('src/lib/shop-ux.ts', 'utf8');
const renderBlock = avatarSource.slice(
  avatarSource.indexOf('export function renderMonster'),
  avatarSource.indexOf('export function nameColorClassFromEquipped'),
);

test('render order is frame then monster stack then effects', () => {
  const frameIndex = renderBlock.indexOf(
    "renderDecorationLayer(container, 'frame', config.frame)",
  );
  const stackIndex = renderBlock.indexOf('container.appendChild(stack)');
  const effectsIndex = renderBlock.indexOf(
    "renderDecorationLayer(container, 'effects', config.effects)",
  );
  assert.ok(frameIndex >= 0);
  assert.ok(stackIndex > frameIndex);
  assert.ok(effectsIndex > stackIndex);
});

test('empty decoration ids render no DOM element', () => {
  const helper = avatarSource.slice(
    avatarSource.indexOf('function decorationFile'),
    avatarSource.indexOf('function geometryPart'),
  );
  assert.match(helper, /if \(!partId\) return null;/);
  assert.match(avatarSource, /if \(!src \|\| !partId\) return;/);
});

test('frame and effects use direct asset manifest paths', () => {
  assert.match(avatarSource, /file\.startsWith\('\/'\) \? file/);
  assert.match(avatarSource, /`\/assets\/\$\{slot\}\/\$\{file\}`/);
  assert.match(avatarSource, /img\.dataset\.slot = slot/);
});

test('frame stays behind the monster and effects stay in front', () => {
  assert.match(
    avatarSource,
    /\.r2l-monster__frame-layer \{[\s\S]*?z-index: 0;/,
  );
  assert.match(
    avatarSource,
    /\.r2l-monster__stack \{[\s\S]*?z-index: 1;/,
  );
  assert.match(
    avatarSource,
    /\.r2l-monster__effects-layer \{[\s\S]*?z-index: 2;/,
  );
});

test('decoration layers are non-interactive and scale beyond the portrait', () => {
  const sharedCssStart = avatarSource.indexOf('.r2l-monster__frame-layer,');
  const frameCssStart = avatarSource.indexOf('.r2l-monster__frame-layer {', sharedCssStart + 1);
  const effectsCssStart = avatarSource.indexOf('.r2l-monster__effects-layer {', frameCssStart + 1);
  const frameCss = avatarSource.slice(
    frameCssStart,
    effectsCssStart,
  );
  const effectsCss = avatarSource.slice(
    effectsCssStart,
    avatarSource.indexOf('.r2l-monster__effects-layer[data-rarity="rare"]'),
  );
  assert.match(
    avatarSource,
    /\.r2l-monster__frame-layer,[\s\S]*?pointer-events: none;/,
  );
  assert.match(frameCss, /left: 50%;[\s\S]*?top: 50%;/);
  assert.match(frameCss, /width: 124%;[\s\S]*?height: 124%;/);
  assert.match(frameCss, /translate: -50% -50%;/);
  assert.doesNotMatch(frameCss, /inset:/);
  assert.match(effectsCss, /left: 50%;[\s\S]*?top: 50%;/);
  assert.match(effectsCss, /width: 130%;[\s\S]*?height: 130%;/);
  assert.match(effectsCss, /translate: -50% -50%;/);
  assert.doesNotMatch(effectsCss, /inset:/);
});

test('common effects are static while rare and epic effects animate', () => {
  assert.doesNotMatch(
    avatarSource,
    /effects-layer\[data-rarity="common"\][\s\S]*?animation:/,
  );
  assert.match(
    avatarSource,
    /effects-layer\[data-rarity="rare"\][\s\S]*?r2l-decoration-float/,
  );
  assert.match(
    avatarSource,
    /effects-layer\[data-rarity="epic"\][\s\S]*?r2l-decoration-twinkle/,
  );
});

test('decoration motion honors prefers-reduced-motion', () => {
  assert.match(
    avatarSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?effects-layer \{ animation: none !important; \}/,
  );
});

test('builder exposes Vietnamese decoration rows with an empty option', () => {
  assert.match(builderSource, /effects: 'Hiệu ứng'/);
  assert.match(builderSource, /frame: 'Khung'/);
  assert.match(
    builderSource,
    /\['detail', 'effects', 'frame'\]\.includes\(slot\)[\s\S]*?\{ id: '', file: '' \}/,
  );
  assert.match(builderSource, /if \(partId === 'frame-rainbow'\) return 'Khung cầu vồng';/);
});

test('builder requires common decorations to be earned', () => {
  assert.match(builderSource, /const isDecoration = \['effects', 'frame'\]\.includes\(slot\);/);
  assert.match(
    builderSource,
    /\(isDecoration \|\| getPartRarity\(part\.id\) !== 'common'\)[\s\S]*?unlocked\.has\(part\.id\)/,
  );
});

test('shop uses direct decoration thumbnail paths', () => {
  assert.match(shopSource, /`\/assets\/effects\/\$\{partId\}\.webp`/);
  assert.match(shopSource, /`\/assets\/frames\/\$\{partId\}\.\$\{extension\}`/);
  assert.match(shopSource, /partId === 'frame-rainbow' \? 'svg' : 'png'/);
});

test('shop filter chips include all monster slots in Vietnamese', () => {
  for (const label of ['Tất cả', 'Thân', 'Tay', 'Mắt', 'Miệng', 'Chi tiết', 'Hiệu ứng', 'Khung']) {
    assert.match(shopSource, new RegExp(`label: '${label}'`));
  }
});

test('shop renders epic, rare, then common sections', () => {
  const block = shopSource.slice(
    shopSource.indexOf('const renderShop ='),
    shopSource.indexOf('const loadShop ='),
  );
  const epic = block.indexOf("renderSection('epic'");
  const rare = block.indexOf("renderSection('rare'");
  const common = block.indexOf("renderSection('common'");
  assert.ok(epic >= 0);
  assert.ok(rare > epic);
  assert.ok(common > rare);
  assert.match(block, /renderSection\('common', 'Thường', common\)/);
});

test('shop item DOM carries slot metadata for filtering', () => {
  assert.match(shopSource, /data-slot="\$\{escapeHtml\(item\.slot\)\}"/);
  assert.match(shopSource, /item\.slot === activeSlot/);
  assert.match(shopSource, /data-shop-filter="\$\{slot\}"/);
});
