import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ssim } from '../scripts/ssim.mjs';

const REPO_WEBP = new URL('../worker-assets/story-retell/sky/storyboard-v1.webp', import.meta.url).pathname;
// The original is NOT in the repo (it lives only in saved Worker releases). The quality check runs when it is on this machine.
const ORIGINAL = path.join(os.homedir(), 'work/r2l-releases/v109-20261021/assets/story-retell/sky/storyboard-v1.png');

test('light storyboard: under 400 KB and same pixel size', async () => {
  assert.ok(fs.statSync(REPO_WEBP).size < 400 * 1024);
  const m = await sharp(REPO_WEBP).metadata();
  assert.equal(m.format, 'webp');
  assert.deepEqual([m.width, m.height], [1672, 941]);
});

test('picture task points at the shipped file', () => {
  const src = fs.readFileSync(new URL('../functions/lib/read2lead/picture-retell.mjs', import.meta.url), 'utf8');
  assert.match(src, /picture:'\/story-retell\/sky\/storyboard-v1\.webp'/);
  assert.doesNotMatch(src, /storyboard-v1\.png/);
});

test('SSIM bite: a heavily blurred copy scores below 0.98 (and an identical copy scores 1)', async () => {
  const blurred = await sharp(REPO_WEBP).blur(3).png().toBuffer();
  const bad = await ssim(REPO_WEBP, blurred);
  assert.ok(bad.luma < 0.98 && bad.min < 0.98, `blurred scored ${bad.luma}`);
  const same = await ssim(REPO_WEBP, REPO_WEBP);
  assert.ok(same.min > 0.9999);
});

test('light storyboard is visually the same as the original (SSIM luma >= 0.98)', { skip: !fs.existsSync(ORIGINAL) && 'original release not on this machine' }, async () => {
  const r = await ssim(ORIGINAL, REPO_WEBP);
  assert.ok(r.luma >= 0.98, `luma SSIM ${r.luma}`);
});
