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
//   first-visit / mid-story / no-story  progress response edited, home verified (primary label, logged in)
//   reward   a REAL story mission is driven through the rehearsal API to stage=reward; the session
//            responses carry the sample reward (+35 diamonds / +20 XP); the real reward view renders it
//   rank-up  the REAL RankUpModal markup on the reward page is shown with the sample rank label
// Login: the rehearsal synthetic magic link (--token, default 32 x "b"). Needs the rehearsal Worker
// (scripts/r2l-release/rehearse.mjs --serve); it is a synthetic, offline server, never production.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyHomeState } from './default.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'mock-sample.json'), 'utf8'));
const DEFAULT_TOKEN = 'b'.repeat(32);
const missionCache = new Map();

// ---- value replacement (shape-preserving) ----------------------------------------------------
function packFor(state) {
  const base = { pack_id: 'p1', story_title: SAMPLE.story.title, level: SAMPLE.story.level, schema_version: 'story-mission-v1' };
  return state === 'first-visit' ? { ...base, story_session: null }
    : state === 'mid-story' ? { ...base, story_session: { stage: 'read', complete: false } }
      : null;
}
export function sampleProgress(json, state) {
  const j = json, s = j.read2lead_state || (j.read2lead_state = {});
  j.progress = j.progress || {};
  j.progress.student_name = SAMPLE.child.name;
  j.progress.current_pack = packFor(state);
  j.state = state === 'no-story' ? 'no_pack' : 'awaiting_review';
  s.diamonds = SAMPLE.child.diamonds;
  s.streak_days = SAMPLE.child.streak_days;
  j.progress.streak_days = SAMPLE.child.streak_days;
  s.rank_ladder = { ...(s.rank_ladder || {}), ...SAMPLE.rank };
  return j;
}
export function sampleBoards(json) {
  const boards = json.boards || (json.boards = {});
  for (const kind of ['xp', 'diamonds']) {
    const board = boards[kind] || (boards[kind] = {});
    const template = (board.leaders && board.leaders[0]) || (boards.xp?.leaders || [])[0] || (boards.diamonds?.leaders || [])[0] || { avatar: {} };
    board.leaders = SAMPLE.leaderboard[kind].map((row, i) => ({ ...template, rank: i + 1, display_name: row.display_name, total: row.total, is_self: false }));
    board.participants = Math.max(board.participants || 0, board.leaders.length);
    if (board.own) board.own = { ...board.own, rank: null };
  }
  return json;
}
export function sampleSession(json) {
  const view = json.view || json;
  const s = view && view.session;
  if (!s) return json;
  s.awarded = { ...(s.awarded || {}), diamonds: SAMPLE.reward.diamonds, xp: SAMPLE.reward.xp };
  if (s.pictureRetell && s.pictureRetell.status === 'complete') s.pictureRetell.award = { ...(s.pictureRetell.award || {}), diamonds: 0 };
  return json;
}

async function installRoutes(page, state) {
  // The rehearsal Worker appends its own "LOCAL REHEARSAL ... Not production" banner; it is the test rig, not the product.
  await page.addInitScript(() => { const st = document.createElement('style'); st.textContent = 'aside[data-synthetic-rehearsal]{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.append(st)); });
  await page.route('**/api/read2lead-progress*', async r => {
    const res = await r.fetch();
    let j; try { j = await res.json(); } catch { return r.fulfill({ response: res }); }
    await r.fulfill({ response: res, json: sampleProgress(j, state) });
  });
  await page.route('**/api/read2lead-leaderboard*', async r => {
    const res = await r.fetch();
    let j; try { j = await res.json(); } catch { return r.fulfill({ response: res }); }
    await r.fulfill({ response: res, json: sampleBoards(j) });
  });
  if (state === 'no-story') {
    await page.route('**/api/generate-read2lead-pack', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'account_generation_job_not_integrated', message: SAMPLE.no_story_message }) }));
  }
  if (state === 'reward' || state === 'rank-up') {
    for (const pattern of ['**/api/read2lead-story-session*', '**/api/read2lead-story-turn*']) {
      await page.route(pattern, async r => {
        const res = await r.fetch();
        let j; try { j = await res.json(); } catch { return r.fulfill({ response: res }); }
        await r.fulfill({ response: res, json: sampleSession(j) });
      });
    }
  }
}

// ---- a real story mission against the rehearsal API (pattern: Steve's scratch driver, v104/mission.mjs) ----
function wav() {
  const b = new Uint8Array(32044), v = new DataView(b.buffer);
  const tag = (at, s) => [...s].forEach((c, i) => { b[at + i] = c.charCodeAt(0); });
  tag(0, 'RIFF'); v.setUint32(4, b.length - 8, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, 32000, true);
  for (let i = 44; i < b.length; i += 2) v.setInt16(i, i % 4 ? 1000 : -1000, true);
  return b;
}
async function runMission(base) {
  const code = 'R2L-SYNTHETIC-DESKTOP';
  const H = { Origin: base, 'Sec-Fetch-Site': 'same-origin', 'X-Read2Lead-Code': code };
  const J = async (route, body) => (await fetch(base + route, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const gen = await J('/api/generate-read2lead-pack', { access_code: code, collection: 'auto' });
  if (!gen.pack_id) throw new Error('mission: pack was not generated: ' + JSON.stringify(gen).slice(0, 200));
  let view = await J('/api/read2lead-story-session', { action: 'open_assigned', packId: gen.pack_id });
  const ev = async e => { view = await J('/api/read2lead-story-session', { action: 'event', sessionId: view.session.id, requestId: randomUUID(), revision: view.session.revision, event: e }); };
  const turn = async () => {
    const fd = new FormData();
    fd.set('audio', new Blob([wav()], { type: 'audio/wav' }), 'a.wav'); fd.set('requestId', randomUUID()); fd.set('revision', String(view.session.revision)); fd.set('sessionId', view.session.id);
    const j = await (await fetch(base + '/api/read2lead-story-turn', { method: 'POST', headers: H, body: fd })).json();
    if (j.view) view = j.view;
    return j;
  };
  await ev({ type: 'audio_started' }); await ev({ type: 'read_complete' });
  for (let i = 0; i < 40 && !view.session.complete; i++) {
    await J('/api/read2lead-story-turn', { action: 'prompt', sessionId: view.session.id, requestId: randomUUID(), revision: view.session.revision });
    await turn();
    if (view.session.feedbackPending) await ev({ type: 'continue_voice' });
  }
  if (!view.session.complete) throw new Error('mission did not complete');
  await ev({ type: 'start_picture_retell' }); await turn();
  if (view.session.pictureRetell?.status !== 'complete') throw new Error('picture retell did not complete');
  return `/read2lead/lesson?code=${code}&pack_id=${gen.pack_id}&mission=story-mission-v1&session=${view.session.id}`;
}

async function expectVisibleText(page, selector, text, what) {
  const got = await page.evaluate(({ selector, text }) => [...document.querySelectorAll(selector)].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.textContent || '').includes(text); }), { selector, text });
  if (!got) throw new Error(`wrong state: ${what} (a visible "${text}" in ${selector}) is not on the page`);
}

export default async function r2lDriver(page, contract, base, ctx = {}) {
  const opts = ctx.opts || {};
  const state = contract.built.state;
  if (!['first-visit', 'mid-story', 'no-story', 'reward', 'rank-up'].includes(state)) throw new Error(`r2l driver: unknown state "${state}"`);
  await installRoutes(page, state);
  const loginUrl = opts.loginUrl || `${base}/r2l/start/?t=${encodeURIComponent(opts.token || DEFAULT_TOKEN)}`;

  if (state === 'first-visit' || state === 'mid-story' || state === 'no-story') {
    await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
    await page.goto(base + contract.built.path, { waitUntil: 'networkidle' });
    await page.waitForSelector('#home-ready:not([hidden])', { timeout: 10000 }).catch(() => { throw new Error('home never became ready (not logged in, or the page failed to load)'); });
    if (state === 'no-story') { await page.click('#home-open'); await page.waitForSelector('#home-library:not([hidden])', { timeout: 6000 }).catch(() => { throw new Error('wrong state: the empty (no story) screen did not appear after "Mở truyện"'); }); }
    await verifyHomeState(page, contract, state, opts);
    await page.waitForTimeout(600);
    return;
  }

  // reward / rank-up share one real mission
  await page.goto(loginUrl, { waitUntil: 'networkidle' }).catch(() => {});
  if (!missionCache.has(base)) missionCache.set(base, runMission(base));
  const lessonUrl = await missionCache.get(base);
  await page.goto(base + lessonUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.rw', { timeout: 15000 }).catch(() => { throw new Error('wrong state: the reward screen (.rw) never appeared'); });
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('.rw__monster img')]; return i.length > 0 && i.every(x => x.complete) && !!document.querySelector('.rw__monster .r2l-monster'); }, null, { timeout: 8000 }).catch(() => {});
  if (state === 'reward') {
    await expectVisibleText(page, '[data-design="reward.primary"]', contract.primary?.text || 'Xong hôm nay', 'reward primary');
    await page.waitForTimeout(800);
    return;
  }
  // rank-up: show the real modal markup the way showRankUpModal does (label, name), reward screen stepped aside
  await page.evaluate(({ label, name }) => {
    document.querySelector('.rw')?.remove();
    const shell = document.getElementById('lesson-shell'); if (shell) shell.inert = false;
    const modal = document.getElementById('rank-up-modal');
    if (!modal) throw new Error('rank-up modal markup not on the page');
    document.body.append(modal);
    document.documentElement.classList.add('rw-open');
    for (const e of document.body.children) if (e !== modal && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE') e.style.display = 'none';
    document.getElementById('rank-up-label').textContent = label;
    document.getElementById('rank-up-name').textContent = name;
    modal.classList.remove('hidden'); modal.classList.add('flex');
  }, SAMPLE.rank_up).catch(e => { throw new Error('wrong state: ' + e.message); });
  await expectVisibleText(page, '[data-design="rankup.primary"], #rank-up-close', contract.primary?.text || 'Tuyệt vời!', 'rank-up primary');
  await page.waitForTimeout(800);
}
