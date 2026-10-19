// Read2Lead state driver for the fidelity harness:  --state-driver scripts/design/drivers/r2l.mjs
//
// Puts the page into each contract state and makes it render the MOCK SAMPLE DATA (Minh, 55 diamonds,
// Bạc ★★, streak 3, the Hoang/Hieuenzo/Percy boards, "The Sky Is Blue!", reward +35/+20) so the pixel
// diff measures design, not data. It never invents new response shapes: every account API response is
// FETCHED from the real server first and only VALUES are replaced, so the page's own code renders them.
// The values live in ../fixtures/mock-sample.json (sourced from the mocks). Real avatars stay real: the
// only data difference left.
//
// States (contract built.state): first-visit, mid-story, no-story, reward, rank-up.
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
export function loadSample(file) { return JSON.parse(fs.readFileSync(path.resolve(file || path.join(SAMPLE_DIR, 'mock-sample.json')), 'utf8')); }

export function sampleProgress(json, state, S = SAMPLE) {
  const j = json, s = j.read2lead_state || (j.read2lead_state = {});
  j.progress = j.progress || {};
  j.progress.student_name = S.child.name;
  const pack = j.progress.current_pack;
  if (pack) { pack.story_title = S.story.title; pack.level = S.story.level; }
  // no-story is the one state the rehearsal cannot reach for real (it would generate a story): fabricated.
  if (state === 'no-story') { j.progress.current_pack = null; j.state = 'no_pack'; }
  s.diamonds = S.child.diamonds;
  s.streak_days = S.child.streak_days;
  j.progress.streak_days = S.child.streak_days;
  s.rank_ladder = { ...(s.rank_ladder || {}), ...S.rank };
  return j;
}
export function sampleBoards(json, S = SAMPLE) {
  const boards = json.boards || (json.boards = {});
  for (const kind of ['xp', 'diamonds']) {
    const board = boards[kind] || (boards[kind] = {});
    const template = (board.leaders && board.leaders[0]) || (boards.xp?.leaders || [])[0] || (boards.diamonds?.leaders || [])[0] || { avatar: {} };
    board.leaders = S.leaderboard[kind].map((row, i) => ({ ...template, rank: i + 1, display_name: row.display_name, total: row.total, is_self: false }));
    board.participants = Math.max(board.participants || 0, board.leaders.length);
    if (board.own) board.own = { ...board.own, rank: null };
  }
  return json;
}
export function sampleSession(json, S = SAMPLE) {
  const view = json.view || json;
  const s = view && view.session;
  if (!s) return json;
  s.awarded = { ...(s.awarded || {}), diamonds: S.reward.diamonds, xp: S.reward.xp };
  if (s.pictureRetell && s.pictureRetell.status === 'complete') s.pictureRetell.award = { ...(s.pictureRetell.award || {}), diamonds: 0 };
  return json;
}

// ---- data-binding expectations: what the page MUST show for a given sample ----------------------
const vn = n => new Intl.NumberFormat('vi-VN').format(n);
export function bindingExpectations(S, state, Base = null) {
  const expect = [], absent = [];
  const add = (list, v) => { if (v != null && v !== '') list.push(String(v)); };
  if (state === 'first-visit' || state === 'mid-story' || state === 'no-story') {
    add(expect, `Chào ${S.child.name}!`); add(expect, vn(S.child.diamonds)); add(expect, `${S.child.streak_days} ngày`);
  }
  if (state === 'first-visit' || state === 'mid-story') {
    add(expect, S.story.title);
    for (const kind of ['xp', 'diamonds']) for (const row of S.leaderboard[kind]) { add(expect, row.display_name); add(expect, vn(row.total)); }
  }
  // (the reward title comes from the real pack, not from the sample, so it is not asserted)
  if (state === 'reward') { add(expect, `+${vn(S.reward.diamonds)}`); add(expect, `+${vn(S.reward.xp)}`); }
  // Against another sample: the BASE sample's values that differ must be gone (a hard-coded "Minh" or "55" fails here).
  if (Base) {
    const gone = (a, b, fmt = x => x) => { if (String(a) !== String(b)) add(absent, fmt(b)); };
    if (state === 'first-visit' || state === 'mid-story' || state === 'no-story') { gone(S.child.name, Base.child.name, n => `Chào ${n}!`); gone(S.child.diamonds, Base.child.diamonds, vn); }
    if (state === 'first-visit' || state === 'mid-story') {
      for (const kind of ['xp', 'diamonds']) Base.leaderboard[kind].forEach((row, i) => { gone(S.leaderboard[kind][i].display_name, row.display_name); gone(S.leaderboard[kind][i].total, row.total, vn); });
    }
    if (state === 'reward') { gone(S.reward.diamonds, Base.reward.diamonds, n => `+${vn(n)}`); gone(S.reward.xp, Base.reward.xp, n => `+${vn(n)}`); }
  }
  return { expect, absent };
}

async function installRoutes(page, state, S) {
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
  await valueRoute('**/api/read2lead-progress*', j => sampleProgress(j, state, S));
  await valueRoute('**/api/read2lead-leaderboard*', j => sampleBoards(j, S));
  if (state === 'no-story') {
    await page.route('**/api/generate-read2lead-pack', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'account_generation_job_not_integrated', message: S.no_story_message }) }));
  }
  if (state === 'reward') {
    for (const pattern of ['**/api/read2lead-story-session*', '**/api/read2lead-story-turn*']) await valueRoute(pattern, j => sampleSession(j, S));
  }
}

// ---- REAL account state through the rehearsal API -----------------------------------------------
// One synthetic child per state, so concurrent contracts never fight over one account:
//   first-visit THIRD (pack generated, never opened)     mid-story FOURTH (pack opened + audio started)
//   no-story    PHONE (no pack)                          reward    DESKTOP (a full mission completed)
//   rank-up     FOURTH too (its opened, unfinished lesson page; the real modal is then triggered on it)
const ACCOUNTS = {
  'first-visit': ['THIRD', 'e'], 'mid-story': ['FOURTH', 'f'], 'no-story': ['PHONE', 'b'], reward: ['DESKTOP', 'c'], 'rank-up': ['FOURTH', 'f'],
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
async function ensurePack(base, code) {
  const { J, progress } = api(base, code);
  const have = (await progress()).progress?.current_pack;
  if (have?.pack_id) return have.pack_id;
  const gen = await J('/api/generate-read2lead-pack', { access_code: code, collection: 'auto' });
  if (!gen.pack_id) throw new Error(`could not generate a real pack for ${code}: ${JSON.stringify(gen).slice(0, 200)}`);
  return gen.pack_id;
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
  await installRoutes(page, state, S);
  const letter = ACCOUNTS[state][1];
  const loginUrl = opts.loginUrl || `${base}/r2l/start/?t=${encodeURIComponent(opts.token || letter.repeat(32))}`;
  // rank-up shares mid-story's account and preparation, so concurrent contracts never prepare one account twice
  const prepState = state === 'rank-up' ? 'mid-story' : state;
  const key = base + '|' + prepState;
  if (!prepared.has(key)) prepared.set(key, prepare(base, prepState));
  const prep = await prepared.get(key);
  const binding = bindingExpectations(S, state, Base);

  if (state === 'first-visit' || state === 'mid-story' || state === 'no-story') {
    await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
    await page.goto(base + contract.built.path, { waitUntil: 'networkidle' });
    await page.waitForSelector('#home-ready:not([hidden])', { timeout: 10000 }).catch(() => { throw new Error('home never became ready (not logged in, or the page failed to load)'); });
    if (state === 'no-story') { await page.click('#home-open'); await page.waitForSelector('#home-library:not([hidden])', { timeout: 6000 }).catch(() => { throw new Error('wrong state: the empty (no story) screen did not appear after "Mở truyện"'); }); }
    await verifyHomeState(page, contract, state, opts);
    await page.waitForTimeout(600);
    return { dataBinding: binding };
  }

  await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
  if (state === 'reward') {
    await page.goto(base + lessonUrl(prep), { waitUntil: 'networkidle' });
    await page.waitForSelector('.rw', { timeout: 15000 }).catch(() => { throw new Error('wrong state: the reward screen (.rw) never appeared'); });
    await page.waitForFunction(() => { const i = [...document.querySelectorAll('.rw__monster img')]; return i.length > 0 && i.every(x => x.complete) && !!document.querySelector('.rw__monster .r2l-monster'); }, null, { timeout: 8000 }).catch(() => {});
    await expectVisibleText(page, '[data-design="reward.primary"]', contract.primary?.text || 'Xong hôm nay', 'reward primary');
    await page.waitForTimeout(800);
    return { dataBinding: binding };
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
  return { dataBinding: binding };
}
