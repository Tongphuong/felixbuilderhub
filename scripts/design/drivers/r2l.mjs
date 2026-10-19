// Read2Lead state driver for the fidelity harness:  --state-driver scripts/design/drivers/r2l.mjs
//
// Puts the page into each contract state and makes it render the MOCK SAMPLE DATA (Minh, 55 diamonds,
// Bạc ★★, streak 3, the Hoang/Hieuenzo/Percy boards, "The Sky Is Blue!", reward +35/+20) so the pixel
// diff measures design, not data. It never invents new response shapes: every account API response is
// FETCHED from the real server first and only VALUES are replaced, so the page's own code renders them.
// The values live in ../fixtures/mock-sample.json (sourced from the mocks). Real avatars stay real: the
// only data difference left.
//
// States (contract built.state): first-visit, mid-story, no-story, reward, rank-up, and (Release 2) companion, leaderboard-xp, library, shop-goal.
// The account state is REAL, produced through the rehearsal API (one synthetic child per state, see ACCOUNTS):
//   first-visit  a real generated pack, never opened          mid-story  a real pack with an opened session + audio_started
//   reward       a real, completed story mission               rank-up    a real opened lesson; the PRODUCT's own showRankUpModal
//                                                              (window.__r2lV3.showRankUp, enabled by ?v3=1) opens and fills the real modal
// FABRICATED (the rehearsal cannot reach it for real): no-story (the real server would generate a story, so the generate call
// is answered with the real 503 the live site gives); and all VALUES (name, diamonds, streak, rank ladder, boards, reward) are
// replaced inside real response shapes. Rank-up limits: no completed-lesson submit is replayed (the real trigger is a submit
// response `rank_up`), and the modal shows "Con" not the child's name because the product helper passes no kid name.
// `--sample <json>` swaps in another sample (fixtures/mock-sample-alt.json) for the data-binding run; the driver then returns
// `dataBinding {expect, absent}` for the harness `data-binding` check.
// Re-runs: the driver is idempotent against a rehearsal server that has already been used (see ensurePack); it never resets or restarts
// the server. To start from clean state, restart the rehearsal server yourself.
// Login: the rehearsal synthetic magic link (letter x 32 per account, or --token). Needs the rehearsal Worker
// (scripts/r2l-release/rehearse.mjs --serve); a synthetic, offline server, never production.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyHomeState } from './default.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'mock-sample.json'), 'utf8'));

// ---- value replacement (shape-preserving) ----------------------------------------------------
// The REAL pack / session state comes from the rehearsal API (see prepare*). Only VALUES are replaced here.
const SAMPLE_DIR = path.join(here, '..', 'fixtures');
export const ALT_SAMPLE_PATH = path.join(here, '..', 'fixtures', 'mock-sample-alt.json');
export function loadSample(file) { return JSON.parse(fs.readFileSync(path.resolve(file || path.join(SAMPLE_DIR, 'mock-sample.json')), 'utf8')); }

// Replace every string equal to `from` with `to`, anywhere in a JSON value (shape untouched).
export function replaceStrings(v, from, to) {
  if (typeof v === 'string') return v === from ? to : v;
  if (Array.isArray(v)) return v.map(x => replaceStrings(x, from, to));
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = replaceStrings(v[k], from, to); return v; }
  return v;
}
export function sampleProgress(json, state, S = SAMPLE, seen = null) {
  const j = json, s = j.read2lead_state || (j.read2lead_state = {});
  j.progress = j.progress || {};
  j.progress.student_name = S.child.name;
  const pack = j.progress.current_pack;
  if (pack) {
    const real = pack.story_title;
    if (seen && real) seen.title = real;
    if (real) replaceStrings(j, real, S.story.title); // the real title appears several times (title, topic, ...): all of them
    pack.story_title = S.story.title; pack.level = S.story.level;
  }
  // no-story is the one state the rehearsal cannot reach for real (it would generate a story): fabricated.
  if (state === 'no-story') { j.progress.current_pack = null; j.state = 'no_pack'; }
  s.diamonds = S.child.diamonds;
  s.streak_days = S.child.streak_days;
  j.progress.streak_days = S.child.streak_days;
  s.rank_ladder = { ...(s.rank_ladder || {}), ...S.rank };
  return j;
}
export function sampleBoards(json, S = SAMPLE, skip = []) {
  const boards = json.boards || (json.boards = {});
  for (const kind of ['xp', 'diamonds']) {
    if (skip.includes(kind)) continue;
    const board = boards[kind] || (boards[kind] = {});
    const template = (board.leaders && board.leaders[0]) || (boards.xp?.leaders || [])[0] || (boards.diamonds?.leaders || [])[0] || { avatar: {} };
    board.leaders = S.leaderboard[kind].map((row, i) => ({ ...template, rank: i + 1, display_name: row.display_name, total: row.total, is_self: false }));
    board.participants = Math.max(board.participants || 0, board.leaders.length);
    if (board.own) board.own = { ...board.own, rank: null };
  }
  return json;
}
export function sampleSession(json, S = SAMPLE, realTitle = null) {
  if (realTitle) replaceStrings(json, realTitle, S.story.title);
  const view = json.view || json;
  const s = view && view.session;
  if (!s) return json;
  s.awarded = { ...(s.awarded || {}), diamonds: S.reward.diamonds, xp: S.reward.xp };
  if (s.pictureRetell && s.pictureRetell.status === 'complete') s.pictureRetell.award = { ...(s.pictureRetell.award || {}), diamonds: 0 };
  return json;
}

// ---- data-binding expectations: what the page MUST show for a given sample ----------------------
const vn = n => new Intl.NumberFormat('vi-VN').format(n);
export function bindingExpectations(S, state, Base = null, width = 1280) {
  const expect = [], absent = [];
  const add = (list, v) => { if (v != null && v !== '') list.push(String(v)); };
  const both = (get, fmt = x => x) => { // expect the sample's value, and (against another sample) that the mock's differing value is gone
    add(expect, fmt(get(S)));
    if (Base && String(get(S)) !== String(get(Base))) add(absent, fmt(get(Base)));
  };
  const stars = r => '★'.repeat(Math.max(0, Number(r.stars) || 0));
  const isHome = state === 'first-visit' || state === 'mid-story' || state === 'no-story';
  if (isHome) {
    both(s => s.child.name, n => `Chào ${n}!`);
    both(s => s.child.diamonds, vn);
    both(s => s.child.streak_days, n => `${n} ngày`);
    both(s => `${s.rank.label_vi} ${stars(s.rank)}`);                       // the rank chip: "Bạc ★★"
  }
  if (state === 'first-visit' || state === 'mid-story') {
    both(s => s.story.title);
    both(s => `Sắp lên ${s.rank.next_label_vi}`);                           // the rank-progress card
    both(s => `${s.rank.stars} / ${s.rank.stars_per_division} ★`);          // its stars line
    for (const kind of ['xp', 'diamonds']) S.leaderboard[kind].forEach((row, i) => {
      add(expect, row.display_name); add(expect, vn(row.total));
      if (Base) { const o = Base.leaderboard[kind][i]; if (o.display_name !== row.display_name) add(absent, o.display_name); if (o.total !== row.total) add(absent, vn(o.total)); }
    });
  }
  if (state === 'first-visit') both(s => s.story.level);                      // the level tag (hidden once the story is started)
  if (state === 'reward') {
    both(s => s.reward.diamonds, n => `+${vn(n)}`);
    both(s => s.reward.xp, n => `+${vn(n)}`);
    both(s => s.story.title, t => `“${t}”`);
  }
  if (state === 'rank-up') both(s => s.rank_up.label);
  if (state === 'leaderboard-xp') S.leaderboard_full.xp.forEach(([name, total], i) => {
    add(expect, name); add(expect, `${vn(total)} XP`); add(expect, `#${i + 1}`);
    if (Base) { const [bn, bt] = Base.leaderboard_full.xp[i]; if (bn !== name) add(absent, bn); if (bt !== total) add(absent, `${vn(bt)} XP`); }
  });
  if (state === 'library') {
    both(s => `${s.library.counts.stories} câu chuyện · ${s.library.counts.books} quyển sách`);
    const label = (s, st) => { const b = s.library.books.find(x => x.id === st.bookId); return `Quyển ${b.month} · Bài ${st.number}`; };
    S.library.stories.forEach((st, i) => {
      add(expect, st.title); add(expect, label(S, st));
      if (Base) { const o = Base.library.stories[i]; if (o.title !== st.title) add(absent, o.title); if (label(Base, o) !== label(S, st)) add(absent, label(Base, o)); }
    });
    S.library.books.forEach((b, i) => { add(expect, `Quyển ${b.month}`); if (Base && Base.library.books[i].month !== b.month) add(absent, `Quyển ${Base.library.books[i].month}`); });
  }
  if (state === 'shop-goal') {
    const w = width || 1280;
    const goal = s => s.shop.gifts.find(g => g.id === s.shop.goal_id);
    const strings = s => {
      const V = shopView(s, w), g = goal(s), list = [];
      list.push(vn(s.shop.diamonds), `${vn(g.price_diamonds)} kim cương`, `${pct(s.shop.diamonds, g.price_diamonds)}%`, vn(g.price_diamonds - s.shop.diamonds));
      for (const x of V.gifts) list.push(x.name_vi);                                           // every card shows its name
      for (const x of V.priced) list.push(`${vn(x.price_diamonds)} kim cương`);                // ordinary cards show a price; received / pending cards do not
      const near = V.priced.find(x => x.id !== s.shop.goal_id && x.price_diamonds > s.shop.diamonds && pct(s.shop.diamonds, x.price_diamonds) >= 90);
      if (near) list.push(`Còn thiếu ${vn(near.price_diamonds - s.shop.diamonds)} kim cương`);
      return list;
    };
    const mine = strings(S), theirs = Base ? strings(Base) : [];
    for (const x of mine) add(expect, x);
    for (const x of theirs) if (!mine.includes(x)) add(absent, x);
    const V = shopView(S, w);
    const near = V.priced.find(x => x.id !== S.shop.goal_id && x.price_diamonds > S.shop.diamonds && pct(S.shop.diamonds, x.price_diamonds) >= 90);
    if (near) add(expect, 'Sắp đổi được!');
    if (V.redemptions.some(r => r.status === 'delivered')) { add(expect, '✓ Đã nhận quà'); add(expect, 'Con đã nhận từ Coach Felix ở lớp'); }
    if (V.redemptions.some(r => r.status === 'requested')) { add(expect, 'Đang chờ Coach Felix duyệt'); add(expect, 'Con đã gửi yêu cầu. Coach Felix sẽ xem nhé.'); }
    add(expect, 'Đặt làm mục tiêu ★');
  }
  // companion: the option lists and counter ("N / 21") are the product's own catalogue; the contract declares them `unbound`.
  return { expect, absent };
}

// ---- Release-2 screens: values replaced inside the REAL response shapes -----------------------
const pct = (have, price) => Math.max(0, Math.min(100, Math.round((have / price) * 100)));
export const R2_STATES = ['companion', 'leaderboard-xp', 'library', 'shop-goal'];

// GET /api/read2lead-leaderboard : boards.xp.leaders = the FULL board, the sample child inside it at its rank (is_self)
export function sampleLeaderboardFull(json, S = SAMPLE) {
  const boards = json.boards || (json.boards = {});
  const xp = boards.xp || (boards.xp = {});
  const template = (xp.leaders || [])[0] || (boards.diamonds?.leaders || [])[0] || xp.own || { avatar: {} };
  const rows = S.leaderboard_full.xp.map(([name, total], i) => ({ ...template, rank: i + 1, display_name: name, total, is_self: i + 1 === S.leaderboard_full.own_rank }));
  xp.leaders = rows;
  xp.participants = rows.length;
  xp.own = { ...(xp.own || template), ...rows[S.leaderboard_full.own_rank - 1] };
  return sampleBoards(json, S, ['xp']); // the XP board is the one just built; the diamonds tab gets the home sample
}
// GET /api/read2lead-library : catalogue {books, stories, counts}; story = {id, bookId, number, title, pages[], audio[]}
export function sampleLibrary(json, S = SAMPLE) {
  const L = S.library;
  const book = b => ({ pages: 60, pdf: '/api/read2lead-library-media/sample', tracks: [], ...b });
  json.books = L.books.map(book);
  json.stories = L.stories.map(st => ({ id: st.id, bookId: st.bookId, number: st.number, title: st.title, pages: [1, 2, 3, 4, 5, 6], audio: st.audio ? ['/api/read2lead-library-media/sample-audio'] : [] }));
  json.counts = { ...(json.counts || {}), ...L.counts };
  return json;
}
// POST /api/read2lead-gifts-list : {items[], diamonds, redemptions[], gift_goal}
// What the mock shows at a width: the pending card only at 1280 (a redemption may carry min_width), a received gift ONCE (as its
// received card, so it is left out of `items`: a delivered gift would otherwise also render as an ordinary card), prices only on
// ordinary cards (the received and pending cards show none).
export function shopView(S, width = 1280) {
  const G = S.shop;
  const redemptions = G.redemptions.filter(r => (r.min_width || 0) <= width);
  const hidden = new Set(G.redemptions.filter(r => (r.min_width || 0) > width).map(r => r.gift_id));
  const gifts = G.gifts.filter(g => !hidden.has(g.id));
  const status = id => (redemptions.find(r => r.gift_id === id) || {}).status || null;
  return {
    redemptions, gifts, status,
    items: gifts.filter(g => status(g.id) !== 'delivered'),   // the API's gift list
    priced: gifts.filter(g => !status(g.id)),                  // cards that show a price
  };
}
export function sampleGifts(json, S = SAMPLE, width = 1280) {
  const G = S.shop;
  const V = shopView(S, width);
  const template = (json.items || [])[0] || {};
  json.items = V.items.map(g => ({
    ...template, id: g.id, name_vi: g.name_vi, emoji: g.emoji, image_key: null, image_url: null, price_diamonds: g.price_diamonds,
    limit_total: null, redeemed_count: 0, active: true, available: true, can_afford: G.diamonds >= g.price_diamonds, progress_percent: pct(G.diamonds, g.price_diamonds),
  }));
  json.diamonds = G.diamonds;
  json.redemptions = V.redemptions.map((r, i) => {
    const g = G.gifts.find(x => x.id === r.gift_id);
    return { id: 'r' + (i + 1), gift_id: r.gift_id, name_vi: g.name_vi, price_diamonds: g.price_diamonds, status: r.status, ts: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-02T09:00:00.000Z' };
  });
  json.gift_goal = G.goal_id;
  return json;
}
// POST /api/read2lead-shop {action:list} : read2lead_state carries the child's name and wallet
export function sampleCompanion(json, S = SAMPLE) {
  const st = json.read2lead_state || (json.read2lead_state = {});
  st.student_name = S.companion.name;
  st.diamonds = S.child.diamonds;
  return json;
}

const SAMPLE_REAL_TITLE = 'The Sky Is Blue!'; // the rehearsal's generated story
// companion: select the hat category ("Mũ") and step to option 2 with the NEXT button: either the "→" text button or the icon
// button whose accessible name is "Lựa chọn tiếp". Nothing is saved.
export async function previewHatOption2(page) {
  await page.getByRole('button', { name: 'Mũ', exact: true }).first().click({ timeout: 8000 }).catch(() => { throw new Error('wrong state: no "Mũ" category button on the companion page'); });
  await page.getByRole('button', { name: /→|Lựa chọn tiếp/ }).first().click({ timeout: 5000 }).catch(() => { throw new Error('wrong state: no next-option button ("→" or "Lựa chọn tiếp") on the companion page'); });
}

export async function installRoutes(page, state, S, width = 1280) {
  const seen = { title: null }; // the REAL pack title, learned from the progress response
  // The rehearsal Worker appends its own "LOCAL REHEARSAL ... Not production" banner; it is the test rig, not the product.
  await page.addInitScript(() => { const st = document.createElement('style'); st.textContent = 'aside[data-synthetic-rehearsal]{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.append(st)); });
  // Fetch the REAL response, replace values only. Errors after the page closed (a request still in flight) are ignored.
  const valueRoute = (pattern, mutate) => page.route(pattern, async r => {
    try {
      const res = await r.fetch();
      let j; try { j = await res.json(); } catch { return await r.fulfill({ response: res }); }
      await r.fulfill({ response: res, json: mutate(j) });
    } catch { /* page or context closed mid-request */ }
  });
  await valueRoute('**/api/read2lead-progress*', j => sampleProgress(j, R2_STATES.includes(state) ? 'first-visit' : state, S, seen));
  if (state !== 'leaderboard-xp') await valueRoute('**/api/read2lead-leaderboard*', j => sampleBoards(j, S));
  if (state === 'leaderboard-xp') await valueRoute('**/api/read2lead-leaderboard*', j => sampleLeaderboardFull(j, S));
  if (state === 'library') await valueRoute('**/api/read2lead-library', j => sampleLibrary(j, S));
  if (state === 'shop-goal') await valueRoute('**/api/read2lead-gifts-list*', j => sampleGifts(j, S, width));
  if (state === 'companion') await valueRoute('**/api/read2lead-shop*', j => sampleCompanion(j, S));
  if (state === 'no-story') {
    await page.route('**/api/generate-read2lead-pack', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'account_generation_job_not_integrated', message: S.no_story_message }) }));
  }
  if (state === 'reward') {
    for (const pattern of ['**/api/read2lead-story-session*', '**/api/read2lead-story-turn*']) await valueRoute(pattern, j => sampleSession(j, S, seen.title || SAMPLE_REAL_TITLE));
  }
}

// ---- REAL account state through the rehearsal API -----------------------------------------------
// One synthetic child per state, so concurrent contracts never fight over one account:
//   first-visit THIRD (pack generated, never opened)     mid-story FOURTH (pack opened + audio started)
//   no-story    PHONE (no pack)                          reward    DESKTOP (a full mission completed)
//   rank-up     FOURTH too (its opened, unfinished lesson page; the real modal is then triggered on it)
const ACCOUNTS = {
  'first-visit': ['THIRD', 'e'], 'mid-story': ['FOURTH', 'f'],
  // Release 2: pages that need only a logged-in child with today's story (the pack on THIRD)
  companion: ['THIRD', 'e'], 'leaderboard-xp': ['THIRD', 'e'], library: ['THIRD', 'e'], 'shop-goal': ['THIRD', 'e'], 'no-story': ['PHONE', 'b'], reward: ['DESKTOP', 'c'], 'rank-up': ['FOURTH', 'f'],
};
function wav() {
  const b = new Uint8Array(32044), v = new DataView(b.buffer);
  const tag = (at, s) => [...s].forEach((c, i) => { b[at + i] = c.charCodeAt(0); });
  tag(0, 'RIFF'); v.setUint32(4, b.length - 8, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, 32000, true);
  for (let i = 44; i < b.length; i += 2) v.setInt16(i, i % 4 ? 1000 : -1000, true);
  return b;
}
function api(base, code) {
  const H = { Origin: base, 'Sec-Fetch-Site': 'same-origin', 'X-Read2Lead-Code': code };
  const J = async (route, body) => (await fetch(base + route, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const progress = async () => (await fetch(base + '/api/read2lead-progress?code=' + code, { headers: H })).json();
  return { H, J, progress };
}
// IDEMPOTENT (this is how a second run against the SAME rehearsal server works; the server is never reset or restarted):
// an account that already has a pack keeps it (first-visit / mid-story / reward accounts are reused, nothing is generated twice),
// and a `previous_pack_needs_review` answer from the generator is turned into the pack it points at.
export async function ensurePack(base, code) {
  const { J, progress } = api(base, code);
  const have = (await progress()).progress?.current_pack;
  if (have?.pack_id) return have.pack_id;
  const gen = await J('/api/generate-read2lead-pack', { access_code: code, collection: 'auto' });
  if (gen.pack_id) return gen.pack_id;
  if (gen.error === 'previous_pack_needs_review' && gen.lesson_link) {
    const id = new URL(gen.lesson_link, base).searchParams.get('pack_id');
    if (id) return id;
  }
  throw new Error(`could not generate a real pack for ${code}: ${JSON.stringify(gen).slice(0, 200)}`);
}
async function openSession(base, code, packId) {
  const { J } = api(base, code);
  const view = await J('/api/read2lead-story-session', { action: 'open_assigned', packId });
  if (!view.session) throw new Error(`could not open a real story session for ${code}: ${JSON.stringify(view).slice(0, 200)}`);
  return view;
}
async function prepare(base, state) {
  const code = 'R2L-SYNTHETIC-' + ACCOUNTS[state][0];
  const { J } = api(base, code);
  const packId = await ensurePack(base, code);
  if (state === 'first-visit' || state === 'no-story') return { code, packId };
  let view = await openSession(base, code, packId);
  const ev = async e => { view = await J('/api/read2lead-story-session', { action: 'event', sessionId: view.session.id, requestId: randomUUID(), revision: view.session.revision, event: e }); };
  if (state === 'mid-story' || state === 'rank-up') { if (view.session.stage === 'read' && view.session.revision === 0) await ev({ type: 'audio_started' }); return { code, packId, sessionId: view.session.id }; }
  // reward: a full mission
  const turn = async () => {
    const fd = new FormData();
    fd.set('audio', new Blob([wav()], { type: 'audio/wav' }), 'a.wav'); fd.set('requestId', randomUUID()); fd.set('revision', String(view.session.revision)); fd.set('sessionId', view.session.id);
    const j = await (await fetch(base + '/api/read2lead-story-turn', { method: 'POST', headers: api(base, code).H, body: fd })).json();
    if (j.view) view = j.view;
    return j;
  };
  if (!view.session.complete) {
    await ev({ type: 'audio_started' }); await ev({ type: 'read_complete' });
    for (let i = 0; i < 40 && !view.session.complete; i++) {
      await J('/api/read2lead-story-turn', { action: 'prompt', sessionId: view.session.id, requestId: randomUUID(), revision: view.session.revision });
      await turn();
      if (view.session.feedbackPending) await ev({ type: 'continue_voice' });
    }
    if (!view.session.complete) throw new Error('mission did not complete');
    await ev({ type: 'start_picture_retell' }); await turn();
    if (view.session.pictureRetell?.status !== 'complete') throw new Error('picture retell did not complete');
  }
  return { code, packId, sessionId: view.session.id };
}
const prepared = new Map();
const lessonUrl = p => `/read2lead/lesson?code=${p.code}&pack_id=${p.packId}&mission=story-mission-v1&session=${p.sessionId}`;

// text present in a VISIBLE text node anywhere on the page (ancestors' textContent would also count hidden descendants)
async function expectTextOnPage(page, text, what) {
  const got = await page.evaluate(t => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.nodeValue.replace(/\s+/g, ' ').includes(t)) continue;
      const e = n.parentElement; if (!e) continue;
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') return true;
    }
    return false;
  }, text);
  if (!got) throw new Error(`wrong state: ${what} ("${text}") is not visible on the page`);
}
async function expectVisibleText(page, selector, text, what) {
  const got = await page.evaluate(({ selector, text }) => [...document.querySelectorAll(selector)].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.textContent || '').includes(text); }), { selector, text });
  if (!got) throw new Error(`wrong state: ${what} (a visible "${text}" in ${selector}) is not on the page`);
}

export default async function r2lDriver(page, contract, base, ctx = {}) {
  const opts = ctx.opts || {};
  const state = contract.built.state;
  if (!ACCOUNTS[state]) throw new Error(`r2l driver: unknown state "${state}"`);
  const S = opts.sample ? loadSample(opts.sample) : SAMPLE;
  const Base = opts.sample ? SAMPLE : null;
  await installRoutes(page, state, S, ctx.width || 1280);
  const progressState = R2_STATES.includes(state) ? 'first-visit' : state;
  const letter = ACCOUNTS[state][1];
  const loginUrl = opts.loginUrl || `${base}/r2l/start/?t=${encodeURIComponent(opts.token || letter.repeat(32))}`;
  // rank-up shares mid-story's account and preparation, so concurrent contracts never prepare one account twice
  const prepState = state === 'rank-up' ? 'mid-story' : R2_STATES.includes(state) ? 'first-visit' : state;
  const key = base + '|' + prepState;
  if (!prepared.has(key)) prepared.set(key, prepare(base, prepState));
  const prep = await prepared.get(key);
  const binding = bindingExpectations(S, state, Base, ctx.width || 1280);

  if (state === 'first-visit' || state === 'mid-story' || state === 'no-story') {
    await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
    await page.goto(base + contract.built.path, { waitUntil: 'networkidle' });
    await page.waitForSelector('#home-ready:not([hidden])', { timeout: 10000 }).catch(() => { throw new Error('home never became ready (not logged in, or the page failed to load)'); });
    if (state === 'no-story') { await page.click('#home-open'); await page.waitForSelector('#home-library:not([hidden])', { timeout: 6000 }).catch(() => { throw new Error('wrong state: the empty (no story) screen did not appear after "Mở truyện"'); }); }
    await verifyHomeState(page, contract, state, opts);
    await page.waitForTimeout(600);
    return { dataBinding: binding, altSample: opts.sample ? undefined : ALT_SAMPLE_PATH };
  }

  if (R2_STATES.includes(state)) {
    // Release-2 screens: log in (sets the session), then open the page for that child. All values are replaced in the real responses.
    await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
    const url = base + contract.built.path + (contract.built.path.includes('?') ? '&' : '?') + 'code=' + encodeURIComponent(prep.code);
    await page.goto(url, { waitUntil: 'networkidle' });
    if (state === 'companion') {
      // hat category selected, option 2 previewed, NOT saved
      await previewHatOption2(page);
      await page.waitForTimeout(400);
      await expectTextOnPage(page, '2 / ', 'option counter "2 / N"');
      await expectTextOnPage(page, 'Chưa lưu', 'the unsaved hint');
    }
    const MUST = { companion: ['Lưu bạn đồng hành'], 'leaderboard-xp': ['Con đây!'], library: ['Truyện hôm nay'], 'shop-goal': ['★ Mục tiêu của con'] }[state];
    for (const t of [contract.primary?.text, ...MUST]) if (t) await expectTextOnPage(page, t, `marker "${t}"`);
    await page.waitForTimeout(600);
    return { dataBinding: binding, altSample: opts.sample ? undefined : ALT_SAMPLE_PATH };
  }

  await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
  if (state === 'reward') {
    await page.goto(base + lessonUrl(prep), { waitUntil: 'networkidle' });
    await page.waitForSelector('.rw', { timeout: 15000 }).catch(() => { throw new Error('wrong state: the reward screen (.rw) never appeared'); });
    await page.waitForFunction(() => { const i = [...document.querySelectorAll('.rw__monster img')]; return i.length > 0 && i.every(x => x.complete) && !!document.querySelector('.rw__monster .r2l-monster'); }, null, { timeout: 8000 }).catch(() => {});
    await expectVisibleText(page, '[data-design="reward.primary"]', contract.primary?.text || 'Xong hôm nay', 'reward primary');
    await page.waitForTimeout(800);
    return { dataBinding: binding, altSample: opts.sample ? undefined : ALT_SAMPLE_PATH };
  }

  // rank-up: the PRODUCT's own showRankUpModal (via window.__r2lV3.showRankUp, enabled by ?v3=1) opens and fills the real modal.
  await page.goto(base + lessonUrl(prep) + '&v3=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window.__r2lV3 && window.__r2lV3.showRankUp && document.getElementById('rank-up-modal')), null, { timeout: 15000 }).catch(() => { throw new Error('wrong state: the lesson page has no window.__r2lV3.showRankUp / #rank-up-modal (is the build V3?)'); });
  // The overlay is the screen under test: the lesson page beneath it is out of scope, so it is hidden (the modal itself is untouched).
  await page.evaluate(() => {
    const modal = document.getElementById('rank-up-modal');
    for (let n = modal; n && n !== document.body; n = n.parentElement) for (const sib of n.parentElement.children) if (sib !== n && !['SCRIPT', 'STYLE', 'LINK'].includes(sib.tagName)) sib.style.display = 'none';
  });
  await page.evaluate(({ from, to, tier }) => window.__r2lV3.showRankUp({ changed: true, from_label: from, to_label: to, tier_changed: false }, { tier_color: tier }), { from: SAMPLE.rank_up.from_label, to: S.rank_up.label, tier: S.rank_up.tier_color });
  await expectVisibleText(page, '#rank-up-close, [data-design="rankup.primary"]', contract.primary?.text || 'Tuyệt vời!', 'rank-up primary');
  await page.waitForTimeout(800);
  return { dataBinding: binding, altSample: opts.sample ? undefined : ALT_SAMPLE_PATH };
}
