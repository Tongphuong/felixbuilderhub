import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const avatarSource = readFileSync('src/lib/monster-avatar.ts', 'utf8');
const builderSource = readFileSync('src/lib/monster-builder.ts', 'utf8');
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
  assert.match(
    avatarSource,
    /\.r2l-monster__frame-layer,[\s\S]*?pointer-events: none;/,
  );
  assert.match(avatarSource, /width: 124%;/);
  assert.match(avatarSource, /width: 130%;/);
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
