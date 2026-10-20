// Release-3 states of the Read2Lead fidelity driver (called from ./r2l.mjs; do not pass --token).
//
// States (contract built.state): book-page-listen, book-page-question-correct, book-page-question-near-miss, book-page-read-aloud,
// book-page-done, book-last-page-done, story-mission-read, story-mission-understand, story-mission-pool-rest, lesson-open-error, logged-out.
//
// REAL (through the rehearsal Worker, scripts/r2l-release/rehearse.mjs --serve): the logged-in child, the BOOK pack (generate-read2lead-pack
// collection "read2lead" on the synthetic L0 child: a genuine page-by-page book lesson, NOT a story mission) or the One Story a Day session
// (open_assigned, events, a real prompt and a real voice turn), the page's own scripts and DOM. If the rehearsal cannot give a real
// BOOK pack, the book states FAIL LOUDLY (never a faked pack, rule 28b).
// FABRICATED (every one is declared here):
//  1. VALUES inside real response shapes: the lesson (title, 6 page texts, one question per page, 6 art/audio URLs, image credits, vocabulary),
//     the progress/leaderboard values (as R1/R2), the story session's `lastVoice.reply` and the prompt text (voice states).
//  2. `web_session_checkpoint` on the lesson response (real value is null): the page's OWN save format (flowVersion 2) that puts a child on page 3
//     (pages 1-2 done) or on page 6 with every page done. It replaces play-through of earlier pages; the page restores it with its own code.
//  3. Page art and page audio: same-origin stand-ins (`/__fidelity/sky.svg`, a silent wav) replace the book's remote pictures/audio so no run
//     depends on a remote host. The mock's art is a data stand-in too (region ceilings are loose for it).
//  4. `/api/read2lead-checkpoint-save` answers {ok:true,stored:true} locally (the rehearsal server's saved state is never touched).
//  5. book-page-done: the read-aloud is passed through the page's own recorder using Chrome's fake microphone; the scoring call
//     `/api/read2lead-speaking-check` is answered with a passing result in the real response shape (the rehearsal has no speech model).
//  6. story-mission-pool-rest: the question-audio request (`/api/read2lead-story-turn`, the prompt call) answers {code:'voice_pool_exhausted',phase:'budget'}
//     with status 503, the real error shape (the rehearsal pool is never empty).
//  7. lesson-open-error: `/api/read2lead-lesson` answers a 503 {ok:false,error,message} (like R1's no-story) so lesson.astro shows #error-card.
//  8. book-page-question-correct: the page clock is frozen (Playwright page.clock) right after the right answer, before lesson.astro's 1.2 s
//     re-render, so the feedback stays on screen.
//  9. LESSON-DOCUMENT CSP: the rehearsal Worker's CSP carries a STALE script-hash list (from the v90 fixture), which blocks lesson.astro's own big
//     inline script. The driver adds the sha256 of the served document's inline scripts to that header (production computes it from the build).
//  8b. Story states: title, story sentences (the mock's page-3 text), the saved turn's `lastVoice.reply` and the question text are VALUES put into the real
//     session/turn views. understand / pool-rest start from a REAL answered turn with feedback pending; the page's own "Câu hỏi tiếp theo →" button is
//     clicked, and its `continue_voice` event is answered LOCALLY with the last real view (feedbackPending false), so the server session never advances.
//     The question-2 prompt call (story-mission-understand) is FABRICATED: it is answered in the real shape {prompt, audio:{audio_b64,content_type}, replayed}
//     with a locally built 1-second wav (the driver's own wav(), a tone), NOT the rehearsal's prompt audio: the real server refuses a question-2 prompt
//     while feedback is pending (409). Chrome runs with --autoplay-policy=no-user-gesture-required so it plays to its end (cue "ready").
//  9b. Book states: the driver waits for the page's own 4 s "Con tiếp tục bài đang làm" resume toast (a side effect of restoring the checkpoint in (2))
//     to fade, and scrolls the window to 0 before the capture (the reader scrolls itself to the top of the reader; the mocks show the page top).
// 10. logged-out: no login. The public top-3 boards are replaced with the mock sample (Hoang/Hieuenzo/Percy) in the real response shape. The sign-up
//     card needs a build with Cloudflare's PUBLIC Turnstile TEST site key 1x00000000000000000000AA (PUBLIC_TURNSTILE_SITE_KEY); never the real key.
import crypto from 'node:crypto';
import { SAMPLE, loadSample, ALT_SAMPLE_PATH, installRoutes, ensurePack, sampleBoards, sampleSession, replaceStrings, api, wav } from './r2l.mjs';

export const R3_STATES = ['book-page-listen', 'book-page-question-correct', 'book-page-question-near-miss', 'book-page-read-aloud', 'book-page-done', 'book-last-page-done',
  'story-mission-read', 'story-mission-understand', 'story-mission-pool-rest', 'lesson-open-error', 'logged-out'];
const BOOK_STATES = R3_STATES.filter(s => s.startsWith('book-'));
const BOOK_ACCOUNT = ['R2L-SYNTHETIC-L0', 'd'];
const STORY_ACCOUNT = { 'story-mission-read': ['R2L-SYNTHETIC-FOURTH', 'f'], 'story-mission-understand': ['R2L-SYNTHETIC-PHONE', 'b'], 'story-mission-pool-rest': ['R2L-SYNTHETIC-PHONE', 'b'], 'lesson-open-error': ['R2L-SYNTHETIC-THIRD', 'e'] };
const vn = n => new Intl.NumberFormat('vi-VN').format(n);

const SKY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6EC6FF"/><stop offset="1" stop-color="#CFEFFF"/></linearGradient></defs><rect width="600" height="420" fill="url(#g)"/><circle cx="470" cy="90" r="42" fill="#FFC83D"/><ellipse cx="170" cy="120" rx="80" ry="30" fill="#fff"/><path d="M300 250 q30 -40 60 0 q-30 -12 -60 0z" fill="#2A9D4A"/></svg>';

// ---- book lesson values (shape-preserving) ------------------------------------------------------
const sentencesOf = text => (String(text).match(/[^.!?]+[.!?]+/g) || [String(text)]).map(x => x.trim()).filter(Boolean);
export function sampleBookLesson(json, S, media) {
  const L = json.lesson, B = S.book, n = B.page_texts.length;
  L.topic = B.title; L.story.title = B.title;
  const sentences = []; const firstOfPage = [];
  B.page_texts.forEach((t, i) => { firstOfPage[i] = sentences.length; sentencesOf(t).forEach(s => sentences.push({ text_en: s, paragraph_index: i, audio_url: media.audio, text_vi: '' })); });
  L.story.paragraphs_en = [...B.page_texts]; L.story.sentences = sentences; L.story.full_audio_url = '';
  const ra = (L.activities || []).find(a => a.type === 'read_aloud');
  if (ra) ra.items = sentences.map((s, i) => ({ id: 'ra_' + i, text_en: s.text_en, audio_url: media.audio }));
  L.book_images = B.page_texts.map(() => media.image);
  L.book_page_audio = B.page_texts.map(() => media.audio);
  if (L.book_attribution) { L.book_attribution.title = B.title; L.book_attribution.image_credits = B.page_texts.map((_, i) => ({ page_index: i, credit_text: 'Minh hoạ mẫu trang ' + (i + 1) })); }
  L.guided_listening = B.page_texts.map((_, i) => {
    const q = i === B.page - 1 || i === n - 1 ? B.question : B.other_question;
    return { paragraph_index: i, questions: [{ id: `gl_p${i}_q1`, type: 'choice', question_en: q.text, options_en: [...q.options], correct_index: q.correct_index, sentence_index: firstOfPage[i] }] };
  });
  L.vocabulary = [{ word_en: 'sky', meaning_vi: 'bầu trời', paragraph_index: B.page - 1 }, { word_en: 'bird', meaning_vi: 'con chim', paragraph_index: B.page - 1 }];
  L.parent_note_vi = `Con vừa đọc truyện '${B.title}'.`;
  return json;
}
// The page's OWN save format (flowVersion 2). `done` pages are fully finished; `upto` (optional) is the page that has listened + answered.
export function bookCheckpoint(S, state) {
  const n = S.book.page_texts.length;
  const done = i => ({ page_index: i, audio_completed: true, question_results: [{ question_id: `gl_p${i}_q1`, correct: true, attempts: 1 }], page_reads: [{ read_id: `p${i}_r0`, status: 'passed', attempts: 1, score_percent: 90, technical_failures: 0 }] });
  const cur = S.book.page - 1;
  let pages, pageIndex, stage = 'story';
  if (state === 'book-last-page-done') { pages = Array.from({ length: n }, (_, i) => done(i)); pageIndex = n - 1; stage = 'next'; }
  else {
    pages = Array.from({ length: cur }, (_, i) => done(i));
    if (state === 'book-page-question-correct' || state === 'book-page-question-near-miss') pages.push({ page_index: cur, audio_completed: true });
    if (state === 'book-page-read-aloud' || state === 'book-page-done') pages.push({ page_index: cur, audio_completed: true, question_results: [{ question_id: `gl_p${cur}_q1`, correct: true, attempts: 1 }] });
    pageIndex = cur;
  }
  return { snapshot: { schema_version: 2, saved_at: new Date().toISOString(), activity_index: 0, completed_types: [], activity_results: {}, activity_progress: {}, w1_phase: 'book_reader', w1_max_unlocked: 0, w1_midpoint_celebrated: false,
    story_gate: { read_done: true, listen_done: true, paragraphs_played: [], card_index: 0 }, question_outcomes: {},
    book_reader: { flowVersion: 2, pageIndex, stage, story_completed: false, questionIndex: 0, chunkIndex: 0, pages } } };
}

// ---- data-binding expectations: what the page MUST show for this sample (only what the STEP can show) ----------------
export function r3Binding(S, state, Base = null) {
  const expect = [], absent = [];
  const both = (get, fmt = x => x) => { const v = fmt(get(S)); if (v) expect.push(String(v)); if (Base && String(get(Base)) !== String(get(S))) { const o = fmt(get(Base)); if (o) absent.push(String(o)); } };
  const pageNo = s => (state === 'book-last-page-done' ? s.book.page_texts.length : s.book.page);
  if (BOOK_STATES.includes(state)) {
    both(s => s.book.title);
    both(s => `Trang ${pageNo(s)} / ${s.book.page_texts.length}`);
    if (state !== 'book-page-done' && state !== 'book-last-page-done') both(s => s.book.page_texts[pageNo(s) - 1]);
    if (state === 'book-last-page-done') both(s => s.book.page_texts[s.book.page_texts.length - 1]);
    if (state === 'book-page-question-correct' || state === 'book-page-question-near-miss') { both(s => s.book.question.text); both(s => s.book.question.options[0]); both(s => s.book.question.options[1]); }
  }
  if (state === 'story-mission-read') { both(s => s.book.title); both(s => s.book.page_texts[s.book.page - 1]); }
  if (state === 'story-mission-understand') { both(s => s.voice.turn_reply); both(s => s.voice.question_text); }
  if (state === 'lesson-open-error') both(s => s.error_message);
  if (state === 'logged-out') for (const kind of ['xp', 'diamonds']) S.public_top3[kind].forEach((row, i) => { expect.push(row.display_name, vn(row.total)); if (Base) { const o = Base.public_top3[kind][i]; if (o.display_name !== row.display_name) absent.push(o.display_name); if (o.total !== row.total) absent.push(vn(o.total)); } });
  return { expect: [...new Set(expect)], absent: [...new Set(absent)] };
}

// ---- accounts ------------------------------------------------------------------------------------------------------
const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
async function ensureBookPack(base, code) {
  const { J, progress } = api(base, code);
  const have = (await progress()).progress?.current_pack;
  const gen = have?.pack_id ? { pack_id: have.pack_id } : await J('/api/generate-read2lead-pack', { access_code: code, collection: 'read2lead' });
  let packId = gen.pack_id;
  if (!packId && gen.error === 'previous_pack_needs_review' && gen.lesson_link) packId = new URL(gen.lesson_link, base).searchParams.get('pack_id');
  if (!packId) throw new Error(`the rehearsal could not produce a real BOOK pack for ${code} (generate-read2lead-pack collection "read2lead" answered ${JSON.stringify(gen).slice(0, 220)}); the book states cannot be driven and no pack is faked`);
  const lesson = await (await fetch(`${base}/api/read2lead-lesson?code=${code}&pack_id=${packId}`, { headers: api(base, code).H })).json();
  if (!lesson?.lesson?.book_images?.length || !lesson.lesson.guided_listening) throw new Error(`pack ${packId} for ${code} is not a BOOK pack (no book_images / guided_listening): refusing to drive the book states with a story pack`);
  return packId;
}
async function prepareStory(base, state) {
  const [code] = STORY_ACCOUNT[state];
  const { J } = api(base, code);
  const packId = await ensurePack(base, code);
  if (state === 'lesson-open-error') return { code, packId };
  const open = await J('/api/read2lead-story-session', { action: 'open_assigned', packId });
  if (!open.session) throw new Error(`could not open a real story session for ${code}: ${JSON.stringify(open).slice(0, 200)}`);
  let view = open;
  const ev = async e => { view = await J('/api/read2lead-story-session', { action: 'event', sessionId: view.session.id, requestId: crypto.randomUUID(), revision: view.session.revision, event: e }); };
  if (state === 'story-mission-read') { if (view.session.stage === 'read' && view.session.revision === 0) await ev({ type: 'audio_started' }); return { code, packId, sessionId: view.session.id }; }
  // understand / pool-rest: one REAL answered question (a real prompt + a real voice turn), then the feedback is dismissed so question 2 is asked
  if (view.session.stage === 'read') { await ev({ type: 'audio_started' }); await ev({ type: 'read_complete' }); }
  if (view.session.stage === 'understand' && view.session.answered === 0 && !view.session.feedbackPending) {
    await J('/api/read2lead-story-turn', { action: 'prompt', sessionId: view.session.id, requestId: crypto.randomUUID(), revision: view.session.revision });
    const fd = new FormData();
    fd.set('audio', new Blob([wav()], { type: 'audio/wav' }), 'a.wav'); fd.set('requestId', crypto.randomUUID()); fd.set('revision', String(view.session.revision)); fd.set('sessionId', view.session.id);
    const j = await (await fetch(base + '/api/read2lead-story-turn', { method: 'POST', headers: api(base, code).H, body: fd })).json();
    if (j.view) view = j.view;
  }
  // The session is left at "one real turn answered, its feedback pending": the page's own client history (the saved-turn row) only exists for a
  // turn whose feedback it has rendered. "Câu hỏi tiếp theo" is then clicked in the page and its event answered locally (see below), so no run
  // advances the server session and every run starts from the same state.
  if (!(view.session.stage === 'understand' && view.session.feedbackPending)) throw new Error(`story session for ${code} is not "one turn answered, feedback pending" (stage ${view.session.stage}, answered ${view.session.answered}, feedbackPending ${view.session.feedbackPending}); restart the rehearsal server for a clean session`);
  return { code, packId, sessionId: view.session.id };
}

// ---- routes shared by the lesson states -------------------------------------------------------------------------------
async function lessonRoutes(page, S) {
  const mediaOrigin = '/__fidelity/';
  const silent = Buffer.from(wav());
  await page.route('**/__fidelity/**', r => (r.request().url().endsWith('.svg') ? r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SKY_SVG }) : r.fulfill({ status: 200, contentType: 'audio/wav', body: silent })));
  // (9) stale-CSP shim for the lesson DOCUMENT only
  await page.route('**/read2lead/lesson?*', async r => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const res = await r.fetch(); const body = await res.text();
    const hashes = [...body.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    const headers = { ...res.headers() };
    if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace("script-src 'self'", "script-src 'self' " + hashes.join(' '));
    await r.fulfill({ response: res, headers, body });
  });
  await page.route('**/api/read2lead-checkpoint-save*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stored: true }) }));
  return { image: mediaOrigin + 'sky.svg', audio: mediaOrigin + 'silence.wav' };
}
const valueRoute = (page, pattern, mutate) => page.route(pattern, async r => {
  try { const res = await r.fetch(); let j; try { j = await res.json(); } catch { return await r.fulfill({ response: res }); } await r.fulfill({ response: res, json: mutate(j) }); } catch { /* page closed mid-request */ }
});
const waitText = async (page, selector, text, what) => {
  await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.textContent || '').includes(text); }), { selector, text }, { timeout: 15000 })
    .catch(() => { throw new Error(`wrong state: ${what} (a visible "${text}" in ${selector}) never appeared`); });
};

export async function r3Driver(page, contract, base, ctx = {}) {
  const opts = ctx.opts || {};
  const state = contract.built.state;
  const S = opts.sample ? loadSample(opts.sample) : SAMPLE;
  const Base = opts.sample ? SAMPLE : null;
  const binding = r3Binding(S, state, Base);
  const ret = { dataBinding: binding, altSample: opts.sample ? undefined : ALT_SAMPLE_PATH };
  await installRoutes(page, 'first-visit', S, ctx.width || 1280); // banner hide + progress/leaderboard VALUES (as R1)
  const login = async token => { await page.goto(`${base}/r2l/start/?t=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' }).catch(() => {}); };

  if (state === 'logged-out') {
    await valueRoute(page, '**/api/read2lead-leaderboard*', j => sampleBoards(j, { ...S, leaderboard: S.public_top3 }));
    await page.goto(base + contract.built.path, { waitUntil: 'networkidle' });
    await page.waitForSelector('#home-ready:not([hidden])', { timeout: 3000, state: 'attached' }).then(() => { throw new Error('wrong state: the page shows the logged-in kid home (a session is present)'); }, () => {});
    if (!(await page.locator('#signup-card').count())) throw new Error('wrong state: the sign-up card (#signup-card) is not rendered. Build the rehearsal pages with PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA (Cloudflare PUBLIC test key)');
    await page.waitForTimeout(800);
    return ret;
  }

  if (state === 'lesson-open-error') {
    const prep = await once(base + '|' + state, () => prepareStory(base, state));
    await lessonRoutes(page, S);
    await login(STORY_ACCOUNT[state][1].repeat(32));
    await page.route('**/api/read2lead-lesson*', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'lesson_unavailable', message: S.error_message }) }));
    await page.goto(`${base}/read2lead/lesson?code=${prep.code}&pack_id=${prep.packId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#error-card:not(.hidden)', { timeout: 15000 }).catch(() => { throw new Error('wrong state: #error-card never appeared'); });
    await page.waitForTimeout(600);
    return ret;
  }

  if (state.startsWith('story-mission')) {
    const prep = await once(base + '|' + state.replace('pool-rest', 'understand'), () => prepareStory(base, state));
    const media = await lessonRoutes(page, S);
    await login(STORY_ACCOUNT[state][1].repeat(32));
    const url = `${base}/read2lead/lesson?code=${prep.code}&pack_id=${prep.packId}&mission=story-mission-v1&session=${prep.sessionId}`;
    void media;
    // VALUES in the real shapes: the story's title and text (the page-3 sentences of the mock), the saved turn's reply, the question text.
    const storySentences = sentencesOf(S.book.page_texts[S.book.page - 1]).map((text, i) => ({ id: 's' + (i + 1), text }));
    let viewSeen = null;
    const fixView = j => {
      const v = j.view || j;
      if (v?.lesson) { v.lesson.title = S.book.title; v.lesson.sentences = storySentences; }
      const s = v?.session; if (s?.lastVoice) s.lastVoice.reply = S.voice.turn_reply;
      if (v?.lesson?.question) v.lesson.question.prompt = S.voice.question_text;
      if (j.prompt) j.prompt = S.voice.question_text;
      if (v?.session && v?.lesson) viewSeen = structuredClone(v);
      return j;
    };
    const understand = state !== 'story-mission-read';
    for (const p of ['**/api/read2lead-story-session*', '**/api/read2lead-story-turn*']) await valueRoute(page, p, fixView);
    if (understand) {
      // "Câu hỏi tiếp theo" sends a continue_voice event. It is answered locally with the last real view, feedback dismissed (declared in the header),
      // so the server session is never advanced.
      await page.route('**/api/read2lead-story-session*', async r => {
        if (r.request().method() === 'POST' && (r.request().postData() || '').includes('continue_voice') && viewSeen) {
          const v = structuredClone(viewSeen); v.session.feedbackPending = false;
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
        }
        return r.fallback();
      });
    }
    if (state === 'story-mission-understand') {
      // The real server refuses a question-2 prompt while the session is "feedback pending" (409 voice_stage_conflict), and we never advance it.
      // So the prompt call is answered in the real shape {prompt, audio:{audio_b64,content_type}, replayed} with a locally built wav (declared in the header, 8b).
      const wavB64 = Buffer.from(wav()).toString('base64');
      await page.route('**/api/read2lead-story-turn*', r => (r.request().method() === 'POST' && (r.request().postData() || '').includes('"prompt"')
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prompt: S.voice.question_text, audio: { audio_b64: wavB64, content_type: 'audio/wav' }, replayed: false }) }) : r.fallback()));
    }
    if (state === 'story-mission-pool-rest') await page.route('**/api/read2lead-story-turn*', r => (r.request().method() === 'POST' && (r.request().postData() || '').includes('"prompt"')
      ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'voice_pool_exhausted', phase: 'budget' }) }) : r.fallback()));
    await page.goto(url, { waitUntil: 'networkidle' });
    if (understand) {
      await page.getByRole('button', { name: /Câu hỏi tiếp theo/ }).click({ timeout: 25000 }).catch(() => { throw new Error('wrong state: the saved-turn feedback with "Câu hỏi tiếp theo →" never appeared'); });
    }
    const mark = { 'story-mission-read': '[data-voice-state="read"]', 'story-mission-understand': '[data-voice-state="ready"]', 'story-mission-pool-rest': '[data-voice-state="retry"]' }[state];
    await page.waitForSelector(mark, { timeout: 25000 }).catch(() => { throw new Error(`wrong state: ${mark} never appeared on the story mission page`); });
    if (state === 'story-mission-understand') {
      const bad = await page.evaluate(() => (document.body.textContent || '').includes('Chưa phát được câu hỏi') || (document.body.textContent || '').includes('Con bấm Nghe lại câu hỏi, hoặc đọc câu hỏi'));
      if (bad) throw new Error('wrong state: the question audio failed (prompt error notice is showing); the capture would not be the "audio finished, cue ready" state');
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => /Dừng nghe/.test(x.textContent || '')); return !b || b.hidden || b.getBoundingClientRect().width === 0; }, null, { timeout: 8000 }).catch(() => { throw new Error('wrong state: the "Dừng nghe" halt button is still showing (the question audio has not finished)'); });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    return ret;
  }

  // ---- book states -------------------------------------------------------------------------------------------------
  const code = BOOK_ACCOUNT[0];
  const packId = await once(base + '|book', () => ensureBookPack(base, code));
  const media = await lessonRoutes(page, S);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 160)));
  page.on('response', r => { if (r.status() >= 400) pageErrors.push(`HTTP ${r.status()} ${r.url().replace(base, '').slice(0, 90)}`); });
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text().slice(-160)); });
  await valueRoute(page, '**/api/read2lead-lesson*', j => { if (!j.lesson) return j; sampleBookLesson(j, S, media); j.lesson.web_session_checkpoint = bookCheckpoint(S, state); return j; });
  if (state === 'book-page-done') await page.route('**/api/read2lead-speaking-check*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, score_percent: 92, exact_count: 9, close_count: 0, total_count: 9, feedback_vi: 'Con đọc rất rõ!', transcript: S.book.page_texts[S.book.page - 1] }) }));
  if (state === 'book-page-question-correct') await page.clock.install();
  await login(BOOK_ACCOUNT[1].repeat(32));
  await page.goto(`${base}/read2lead/lesson?code=${code}&pack_id=${packId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#w1-book-reader-phase:not(.hidden)', { timeout: 20000 }).catch(() => { throw new Error('wrong state: the page-by-page book reader (#w1-book-reader-phase) never opened. Is this build W1 (PUBLIC_R2L_W1=1)? page errors: ' + (pageErrors.join(' | ') || 'none')); });
  const want = { 'book-page-listen': ['#book-reader-title', S.book.title], 'book-last-page-done': ['#book-reader-page-counter', `Trang ${S.book.page_texts.length} / ${S.book.page_texts.length}`] }[state] || ['#book-reader-page-counter', `Trang ${S.book.page} / ${S.book.page_texts.length}`];
  await waitText(page, want[0], want[1], 'the book page');
  // The page's own "Con tiếp tục bài đang làm" resume toast shows for 4 s after a restored checkpoint: let it fade BEFORE anything is clicked
  // (a frozen clock would keep it on screen).
  await page.waitForFunction(() => { const t = document.querySelector('#r2l-toast'); return !t || t.style.opacity === '0' || !t.textContent; }, null, { timeout: 9000 }).catch(() => {});
  if (state === 'book-page-listen') await waitText(page, '#book-reader-listen-btn', '', 'the listen button');
  if (state === 'book-page-question-correct' || state === 'book-page-question-near-miss') {
    await page.waitForSelector('#book-reader-question-options button', { timeout: 10000 }).catch(() => { throw new Error('wrong state: the question step (#book-reader-question-options) is not showing'); });
    const right = state === 'book-page-question-correct';
    const label = right ? S.book.question.options[S.book.question.correct_index] : S.book.question.options.find((_, i) => i !== S.book.question.correct_index);
    await page.locator('#book-reader-question-options button', { hasText: label }).first().click();
    if (right) { const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(now + 30); } // (8) freeze before the 1.2 s re-render
    await page.waitForSelector(right ? '#book-reader-question-feedback[data-state="correct"]' : '#book-reader-question-feedback[data-state="retry"]', { timeout: 5000 }).catch(() => { throw new Error('wrong state: the answer feedback did not show'); });
  }
  if (state === 'book-page-read-aloud' || state === 'book-page-done') {
    await page.waitForSelector('#book-reader-shadow-stage:not(.hidden) [data-speak-record]', { timeout: 10000 }).catch(() => { throw new Error('wrong state: the read-aloud step (Đọc trang) is not showing'); });
  }
  if (state === 'book-page-done') {
    await page.waitForFunction(() => { const b = document.querySelector('[data-speak-record]'); return b && !b.disabled; }, null, { timeout: 15000 }).catch(() => { throw new Error('the mic gate never passed (is the fake microphone available? launch Chrome with --use-fake-device-for-media-stream --use-fake-ui-for-media-stream)'); });
    await page.click('[data-speak-record]'); await page.waitForTimeout(2500); await page.click('[data-speak-record]');
    await page.waitForSelector('[data-book-shadow-continue]:not(.hidden)', { timeout: 15000 }).catch(() => { throw new Error('wrong state: the scored read-aloud never offered the continue button'); });
    await page.click('[data-book-shadow-continue]');
    await page.waitForSelector('#book-reader-next-stage:not(.hidden)', { timeout: 10000 }).catch(() => { throw new Error('wrong state: the page-star card (#book-reader-next-stage) did not open'); });
  }
  if (state === 'book-last-page-done') await page.waitForSelector('#book-reader-next-stage:not(.hidden)', { timeout: 10000 }).catch(() => { throw new Error('wrong state: the last page card (#book-reader-next-stage) is not showing'); });
  // The reader scrolls itself to the top of the reader on every page change; the mocks show the page from its very top, so the capture starts at 0.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  return ret;
}
