import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const comps = ['ReadAloud', 'ListenAndSpeak'].map((n) => [n, read(`src/components/read2lead/v2/${n}.astro`)]);
const lesson = read('src/pages/read2lead/lesson.astro');

for (const [name, src] of comps) {
  test(`${name}: no <video>, flat still Minny stays visible with its hooks`, () => {
    assert.doesNotMatch(src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), /<video|data-minny-video|\.mp4/);
    assert.match(src, /data-minny-hero="/);
    assert.match(src, /<img[^>]*data-minny-fallback[^>]*src="\/assets\/minny\/minny_idle\.png"/s);
    assert.doesNotMatch(src.match(/<img[\s\S]*?\/>/)[0], /\bhidden\b/, 'the still must not start hidden');
  });
}

test('lesson.astro still handles a hero with no video (so the markup change is safe)', () => {
  const setMood = lesson.slice(lesson.indexOf('function _r2lSetMinnyMood'), lesson.indexOf('function _r2lInitMinnyHero'));
  assert.match(setMood, /if \(!video\) \{\s*_r2lShowMinnyPng\(mood, heroEl\);\s*return;/);
  const showPng = lesson.slice(lesson.indexOf('function _r2lShowMinnyPng'), lesson.indexOf('function _r2lSetMinnyMood'));
  assert.match(showPng, /if \(video\) video\.classList\.add\('hidden'\)/);
  // the only consumers of [data-minny-video] are those two null-safe functions
  const uses = lesson.split('\n').filter((l) => l.includes('data-minny-video'));
  assert.equal(uses.length, 2);
});
