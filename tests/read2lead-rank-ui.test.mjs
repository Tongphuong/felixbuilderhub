import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MEDALS_FIXTURE,
  SEASON_FIXTURE,
  LAST_MEDAL_SEEN_KEY,
  daysUntilSeasonEnd,
  isSeasonPayload,
  newestMedalForCongrats,
  renderCapLockHintHtml,
  renderMedalCabinetHtml,
  renderMedalCongratsHtml,
  renderSeasonBannerHtml,
} from '../src/components/read2lead/v3/rank/season-rank-render.mjs';

const kidHub = readFileSync('src/pages/hoc-sinh/_KidHubW1.astro', 'utf-8');
const seasonBanner = readFileSync('src/components/read2lead/v3/rank/SeasonBanner.astro', 'utf-8');
const medalCabinet = readFileSync('src/components/read2lead/v3/rank/MedalCabinet.astro', 'utf-8');
const w1Script = readFileSync('src/pages/hoc-sinh/hoc-sinh-w1.ts', 'utf-8');
const w1Page = readFileSync('src/scripts/r2l-w1-page.ts', 'utf-8');

test('W1 kid hub mounts season banner and medal cabinet hooks', () => {
  assert.match(kidHub, /SeasonBanner/);
  assert.match(kidHub, /MedalCabinet/);
  assert.match(kidHub, /RankUpModal/);
  assert.match(seasonBanner, /hub-season-banner/);
  assert.match(seasonBanner, /data-r2l-season-banner-host/);
  assert.match(medalCabinet, /hub-medal-congrats/);
  assert.match(medalCabinet, /data-r2l-medal-congrats-host/);
});

test('W1 script guards season UI on payload shape', () => {
  assert.match(w1Script, /isSeasonPayload/);
  assert.match(w1Script, /renderSeasonChrome/);
  assert.match(w1Script, /clearSeasonChrome/);
  assert.match(w1Script, /detectSeasonRankJump/);
  assert.match(w1Script, /showSeasonRankJumpModal/);
  assert.doesNotMatch(w1Script, /mất|tụt hạng|bị reset/);
});

test('season banner renders compact line with rank pill from fixture', () => {
  const html = renderSeasonBannerHtml(SEASON_FIXTURE);
  assert.match(html, /data-r2l-season-banner/);
  assert.match(html, /Amazing Summer/);
  assert.match(html, /🌞/);
  assert.match(html, /còn \d+ ngày/);
  assert.match(html, /Bạc II/);
});

test('capped ladder shows gold lock hint; uncapped hides it', () => {
  const capped = {
    ...SEASON_FIXTURE,
    ladder: {
      ...SEASON_FIXTURE.ladder,
      capped: true,
      cap_unlock_hint_vi: 'Lên Level 2 để mở khoá rank Bạch Kim!',
    },
  };
  const cappedHtml = renderCapLockHintHtml(capped);
  assert.match(cappedHtml, /data-r2l-season-cap-hint/);
  assert.match(cappedHtml, /Lên Level 2 để mở khoá rank Bạch Kim!/);
  assert.doesNotMatch(cappedHtml, /color:\s*red|#f00|rgb\(255,\s*0,\s*0\)/i);

  const uncappedHtml = renderCapLockHintHtml(SEASON_FIXTURE);
  assert.equal(uncappedHtml, '');
});

test('medal cabinet renders cards newest-first and empty state copy', () => {
  const withMedals = renderMedalCabinetHtml([...MEDALS_FIXTURE]);
  assert.match(withMedals, /data-r2l-medal-cabinet/);
  assert.match(withMedals, /Tủ huy chương/);
  assert.match(withMedals, /Mùa Khởi Đầu/);
  assert.match(withMedals, /Vàng II/);
  assert.match(withMedals, /🪙 35/);

  const empty = renderMedalCabinetHtml([]);
  assert.match(empty, /Mùa đầu tiên của con đang diễn ra/);
});

test('missing season payload guard degrades invisibly', () => {
  assert.equal(isSeasonPayload(null), false);
  assert.equal(isSeasonPayload({}), false);
  assert.equal(isSeasonPayload({ id: 'x' }), false);
  assert.match(w1Script, /if \(!isSeasonPayload\(seasonRaw\)\)/);
  assert.match(w1Script, /clearSeasonChrome/);
});

test('medal congrats uses localStorage last-seen guard', () => {
  const medal = { ...MEDALS_FIXTURE[0], ts: '2026-06-10T08:00:00.000Z' };
  const html = renderMedalCongratsHtml(medal);
  assert.match(html, /data-r2l-medal-congrats/);
  assert.match(html, /khép lại/);
  assert.match(html, /35 xu/);

  assert.match(w1Script, /newestMedalForCongrats/);
  assert.match(w1Script, /setLastSeenMedalTs/);
  assert.match(w1Page, /bindRankUpModalClose/);

  const original = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (key === LAST_MEDAL_SEEN_KEY ? store.get(key) ?? null : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };

  try {
    assert.equal(newestMedalForCongrats([medal])?.ts, medal.ts);
    globalThis.localStorage.setItem(LAST_MEDAL_SEEN_KEY, medal.ts);
    assert.equal(newestMedalForCongrats([medal]), null);
  } finally {
    globalThis.localStorage = original;
  }
});

test('days until season end is non-negative', () => {
  assert.ok(daysUntilSeasonEnd('2026-08-31', new Date('2026-06-11')) > 0);
  assert.equal(daysUntilSeasonEnd('2020-01-01', new Date('2026-06-11')), 0);
});
