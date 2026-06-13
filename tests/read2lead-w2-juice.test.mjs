import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');
const juiceSource = readFileSync('src/lib/lesson-juice.ts', 'utf8');
const chestSource = readFileSync('src/lib/lesson-result-chest.ts', 'utf8');

const original = {
  document: globalThis.document,
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  window: globalThis.window,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('window.__r2lJuice keeps existing keys and registers every W2 key', () => {
  assert.match(lessonPage, /playSynthTone,\s*fireStreakConfetti,\s*fireLessonPassConfetti,/s);
  for (const key of [
    'playKenney', 'showXpTicker', 'showComboBadge', 'openChest',
    'showNearMissBanner', 'setMuted', 'isMuted', 'claimDailyChest',
  ]) {
    assert.match(lessonPage, new RegExp(`\\b${key}\\b`));
  }
});

test('lesson page adds no more than five W2 hook lines', () => {
  const hooks = lessonPage.match(/window\.__r2lJuice\?\.(?:showComboBadge|showXpTicker|openChest|showNearMissBanner)|playKenney, showXpTicker/g) || [];
  assert.equal(hooks.length, 5);
});

test('showXpTicker creates a status ticker at the requested anchor', async () => {
  const children = [];
  const anchor = { appendChild: (child) => children.push(child) };
  globalThis.document = {
    querySelector: () => anchor,
    createElement: () => ({ className: '', dataset: {}, setAttribute() {}, remove() {} }),
  };
  globalThis.window = { setTimeout: () => 1 };
  globalThis.requestAnimationFrame = (callback) => callback();
  const { showXpTicker } = await import('../src/lib/lesson-juice.ts');
  showXpTicker(12, '#score');
  assert.equal(children.length, 1);
  assert.equal(children[0].textContent, '+12 XP');
  assert.equal(children[0].dataset.visible, 'true');
});

test('showXpTicker ignores zero rewards and missing anchors', async () => {
  let created = 0;
  globalThis.document = {
    querySelector: () => null,
    createElement: () => {
      created += 1;
      return {};
    },
  };
  const { showXpTicker } = await import('../src/lib/lesson-juice.ts');
  showXpTicker(0, '#score');
  showXpTicker(5, '#missing');
  assert.equal(created, 0);
});

test('showComboBadge sets level, visibility, and badge text', async () => {
  const badge = { textContent: '' };
  const counter = {
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    querySelector: () => badge,
  };
  globalThis.document = { querySelector: () => counter };
  const { showComboBadge } = await import('../src/lib/lesson-juice.ts');
  showComboBadge(3);
  assert.deepEqual(counter.dataset, { level: '3', visible: 'true' });
  assert.equal(counter['aria-hidden'], 'false');
  assert.equal(badge.textContent, 'x3 COMBO');
});

test('showNearMissBanner displays text and schedules a three-second hide', async () => {
  const message = { textContent: '' };
  const banner = { dataset: {}, querySelector: () => message };
  let delay = 0;
  globalThis.document = { querySelector: () => banner };
  globalThis.window = {
    clearTimeout() {},
    setTimeout(callback, ms) {
      delay = ms;
      callback();
      return 1;
    },
  };
  const { showNearMissBanner } = await import('../src/lib/lesson-juice.ts');
  showNearMissBanner('Còn 1 sao nữa!');
  assert.equal(message.textContent, 'Còn 1 sao nữa!');
  assert.equal(delay, 3000);
  assert.equal(banner.dataset.visible, 'false');
});

test('setMuted persists the mute preference', async () => {
  globalThis.localStorage = storage();
  const { setMuted } = await import('../src/lib/lesson-juice.ts');
  setMuted(true);
  assert.equal(globalThis.localStorage.getItem('r2l-w2-muted'), '1');
  setMuted(false);
  assert.equal(globalThis.localStorage.getItem('r2l-w2-muted'), '0');
});

test('isMuted reads persisted preference and tolerates blocked storage', async () => {
  const { isMuted } = await import('../src/lib/lesson-juice.ts');
  globalThis.localStorage = storage({ 'r2l-w2-muted': '1' });
  assert.equal(isMuted(), true);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.equal(isMuted(), false);
});

test('claimDailyChest posts to the daily claim endpoint and returns reward', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/read2lead-daily-chest-claim');
    assert.equal(init.method, 'POST');
    return { ok: true, json: async () => ({ ok: true, reward: { coins: 17 } }) };
  };
  globalThis.localStorage = storage({ 'r2l-w2-muted': '1' });
  const { claimDailyChest } = await import('../src/lib/lesson-juice.ts');
  assert.deepEqual(await claimDailyChest(), { ok: true, reward: { coins: 17 } });
});

test('claimDailyChest gracefully returns ok false on network failure', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const { claimDailyChest } = await import('../src/lib/lesson-juice.ts');
  assert.deepEqual(await claimDailyChest(), { ok: false });
});

test('openChest driver sequences closed, cracking, and burst stages', () => {
  const closed = chestSource.indexOf("setStage(dialog, 'closed')");
  const cracking = chestSource.indexOf("setStage(dialog, 'cracking')");
  const burst = chestSource.indexOf("setStage(dialog, 'burst')");
  assert.ok(closed > -1 && closed < cracking && cracking < burst);
  assert.match(chestSource, /wait\(1500\)/);
  assert.match(chestSource, /wait\(800\)/);
});

test('chest driver keeps visual sequence alive when audio fails', () => {
  assert.match(chestSource, /async function playSafely/);
  assert.match(chestSource, /visual sequence continues without audio/);
});

test('juice audio and chest code are dynamically imported', () => {
  assert.match(juiceSource, /import\('\.\/r2l-audio'\)/);
  assert.match(juiceSource, /import\('\.\/lesson-result-chest'\)/);
});
