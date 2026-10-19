// R2L-ISLAND R1-B: the kid home, reward and rank-up carry the design ids the screen contracts name,
// keep every element/action of the old screens, and use only the design's motion classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync('src/components/Read2LeadChildHome.astro', 'utf8');
const rankUp = readFileSync('src/components/read2lead/v3/rank/RankUpModal.astro', 'utf8');
const voice = readFileSync('src/scripts/read2lead-story-voice.mjs', 'utf8');
const homeScript = readFileSync('src/scripts/read2lead-child-home.ts', 'utf8');
const ready = home.slice(home.indexOf('id="home-ready"'));

test('home carries every design id from the home contracts, in contract order', () => {
  const ids = ['home.topbar', 'home.hero', 'home.story', 'home.map', 'home.leaderboard', 'home.companion', 'home.parents'];
  let last = -1;
  for (const id of ids) {
    const at = ready.indexOf(`data-design="${id}"`);
    assert.ok(at > last, `${id} present and after the previous id`);
    last = at;
  }
  assert.equal((ready.match(/data-design-col/g) || []).length, 3, 'three top-level columns');
  // Rank progress is built from the real ladder: stars / stars_per_division / next_label_vi (never invented XP).
  assert.ok(ready.indexOf('data-design="home.map"') < ready.indexOf('data-design="home.rank-progress"'));
  assert.ok(ready.indexOf('data-design="home.rank-progress"') < ready.indexOf('data-design="home.leaderboard"'));
  assert.match(homeScript, /stars_per_division/); assert.match(homeScript, /next_label_vi/); assert.doesNotMatch(homeScript, /XP-to-next/);
});

test('home primary id is moved onto exactly one control by the script', () => {
  assert.match(homeScript, /setAttribute\('data-design', 'home\.primary'\)/);
  assert.doesNotMatch(ready, /data-design="home\.primary"[\s\S]*data-design="home\.primary"[\s\S]*data-design="home\.primary"/);
});

test('home keeps today\'s elements and actions', () => {
  for (const id of ['home-open', 'home-name', 'home-diamonds', 'home-action-status', 'home-steps', 'home-rank-xp', 'home-rank-diamonds', 'home-rank-own', 'home-personal-progress', 'home-companion', 'home-parent']) {
    assert.ok(ready.includes(`id="${id}"`), id);
  }
  assert.match(ready, /Xem cả bảng/);
  assert.match(ready, /Đọc truyện để lên bảng nhé!/);
  assert.match(home, /home-speaking-note/);
});

test('home uses real motion classes only (r2l-m-*) and ships no mock monster pictures', () => {
  assert.match(ready, /r2l-m-bob/);
  assert.doesNotMatch(home + homeScript + voice + rankUp, /monsters-mock|mon-[a-z]+\.png/);
});

test('reward screen: ids, strings and both actions with their old handlers', () => {
  for (const id of ['reward.hero', 'reward.title', 'reward.tiles', 'reward.finish', 'reward.actions', 'reward.primary']) assert.ok(voice.includes(`data-design="${id}"`) || voice.includes(`'${id}'`), id);
  for (const text of ['Con đã đọc xong', 'kim cương', 'Về đích!', 'Cả 3 bước đã xong', 'Xong hôm nay', 'Đọc thêm truyện']) assert.ok(voice.includes(text), text);
  assert.match(voice, /done:'1'/);
  assert.match(voice, /await openAnother\(\)/);
});

test('rank-up modal keeps the ids the celebration script drives and adds the design ids', () => {
  for (const id of ['rank-up-modal', 'rank-up-title', 'rank-up-name', 'rank-up-label', 'rank-up-minny-copy', 'rank-up-old', 'rank-up-new', 'rank-up-rewards', 'rank-up-share', 'rank-up-close', 'rank-up-status']) assert.ok(rankUp.includes(`id="${id}"`), id);
  for (const id of ['rankup.label', 'rankup.shield', 'rankup.name', 'rankup.line', 'rankup.monster', 'rankup.primary']) assert.ok(rankUp.includes(`data-design="${id}"`), id);
  for (const text of ['HẠNG MỚI CỦA CON', 'Sao mới!', 'Con lên hạng rồi! Bạn đồng hành đang nhảy mừng con đó.', 'Tuyệt vời!']) assert.ok(rankUp.includes(text), text);
});
