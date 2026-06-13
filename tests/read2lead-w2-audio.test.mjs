import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

const audioSource = readFileSync('src/lib/r2l-audio.ts', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const originalStorage = globalThis.localStorage;

afterEach(() => {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('Howler dependency and type package are installed', () => {
  assert.match(packageJson.dependencies.howler, /^\^2\.2\.4$/);
  assert.ok(packageJson.dependencies['@types/howler'] || packageJson.devDependencies?.['@types/howler']);
});

test('audio module loads without constructing Howl at module load', async () => {
  globalThis.localStorage = storage({ 'r2l-w2-muted': '1' });
  const module = await import('../src/lib/r2l-audio.ts');
  assert.equal(typeof module.play, 'function');
  assert.doesNotMatch(audioSource, /^import \{ Howl \} from 'howler';/m);
});

test('play returns early when muted before loading Howler', async () => {
  globalThis.localStorage = storage({ 'r2l-w2-muted': '1' });
  const { play } = await import('../src/lib/r2l-audio.ts');
  await play('coin-clink');
  assert.match(audioSource, /if \(isMuted\(\) \|\| !SOUND_PATHS\[name\]\) return/);
});

test('play uses one cache entry per sound', () => {
  assert.match(audioSource, /const cache = new Map<string, HowlType>\(\)/);
  assert.match(audioSource, /const cached = cache\.get\(name\)/);
  assert.match(audioSource, /cache\.set\(name, howl\)/);
});

test('concurrent first loads share one pending promise', () => {
  assert.match(audioSource, /const pending = new Map<string, Promise<HowlType \| null>>\(\)/);
  assert.match(audioSource, /const loading = pending\.get\(name\)/);
  assert.match(audioSource, /if \(loading\) return loading/);
});

test('setMuted persists to localStorage', async () => {
  globalThis.localStorage = storage();
  const { setMuted } = await import('../src/lib/r2l-audio.ts');
  setMuted(true);
  assert.equal(globalThis.localStorage.getItem('r2l-w2-muted'), '1');
});

test('setMuted mutes every cached Howl', () => {
  assert.match(audioSource, /for \(const howl of cache\.values\(\)\) howl\.mute\(muted\)/);
});

test('isMuted reads localStorage and defaults false if storage throws', async () => {
  const { isMuted } = await import('../src/lib/r2l-audio.ts');
  globalThis.localStorage = storage({ 'r2l-w2-muted': '1' });
  assert.equal(isMuted(), true);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.equal(isMuted(), false);
});

test('preload populates cache without playing', () => {
  const preloadBody = audioSource.match(/export function preload[\s\S]*?\n}/)?.[0] || '';
  assert.match(preloadBody, /loadSound\(name\)/);
  assert.doesNotMatch(preloadBody, /\.play\(/);
});

test('unknown sound names are no-op', async () => {
  globalThis.localStorage = storage();
  const { play, preload } = await import('../src/lib/r2l-audio.ts');
  await play('not-a-sound');
  preload('not-a-sound');
});

test('all eight named sounds map to committed MP3 paths', () => {
  for (const name of [
    'chest-shake', 'chest-crack', 'chest-burst', 'coin-clink',
    'quest-complete', 'combo-tick', 'near-miss', 'daily-chest-claim',
  ]) {
    assert.match(audioSource, new RegExp(`'${name}': '/audio/kenney/${name}\\.mp3'`));
  }
});

test('Howler is dynamically imported only when a sound loads', () => {
  assert.match(audioSource, /const promise = import\('howler'\)/);
});
