// R2L-ISLAND release 3 (packet B): reading page, Minny voice, Minny resting, friendly error.
// lesson.astro is protected: only presentation may change. These tests pin that promise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VOICE_POOL_REST_VI } from '../src/lib/read2lead-minny-notes.mjs';

const lesson = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');
const voice = readFileSync('src/scripts/read2lead-story-voice.mjs', 'utf8');
const css = readFileSync('src/styles/r2l-reading.css', 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');

// sha256 of every <script> block of lesson.astro as it was on main 6540dc8 (frontmatter excluded: its comment names "<script is:inline>")
const scripts = s => [...s.replace(/^---\n[\s\S]*?\n---\n/, '').matchAll(/<script\b[^>]*?(?:\/>|>[\s\S]*?<\/script>)/g)].map(m => m[0]);

test('lesson.astro: all six <script> blocks are byte-identical to main 6540dc8', () => {
  const blocks = scripts(lesson);
  assert.equal(blocks.length, 6);
  // order on main: recorder src, mic-check src, two inlined helpers, the big inline script, the module script
  const expected = ['c48a50b70e07e503', 'f43d3e7ec79c4006', 'a1ae2cb2c0bb6ecb', '875cefa7e88b0655', '0371eccedfdc2321', 'f97f8116edd95ec9'];
  assert.deepEqual(blocks.map(b => sha(b).slice(0, 16)), expected);
});

test('lesson.astro: every id the script reads is still there, in its original parent order', () => {
  for (const id of ['lesson-home', 'error-card', 'error-message', 'error-retry', 'w1-book-reader-phase', 'book-reader-trail-header', 'book-reader-page-shell',
    'book-reader-audio-gate', 'book-reader-listen-btn', 'book-reader-story-next', 'book-reader-question-stage', 'book-reader-question-options', 'book-reader-question-retry',
    'book-reader-shadow-stage', 'book-reader-next-stage', 'book-reader-next', 'book-reader-stage-stepper', 'book-reader-trail', 'book-reader-img']) {
    assert.equal((lesson.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  // reader flow order kept: audio gate, then questions, then read-aloud, then page star
  const at = id => lesson.indexOf(`id="${id}"`);
  assert.ok(at('book-reader-audio-gate') < at('book-reader-question-stage') && at('book-reader-question-stage') < at('book-reader-shadow-stage') && at('book-reader-shadow-stage') < at('book-reader-next-stage'));
});

test('lesson.astro: contract markers and the two 1280 columns', () => {
  // #lesson-home is shared by the reading, voice, resting and error contracts, so it carries no data-design (each contract's `locate` finds it)
  assert.doesNotMatch(lesson, /id="lesson-home"[^>]*data-design/);
  for (const id of ['read.top', 'read.picture', 'read.text', 'read.listen', 'read.listen-btn', 'read.question', 'read.speak', 'read.done', 'read.next', 'error.monster']) {
    assert.equal((lesson.match(new RegExp(`data-design="${id.replace('.', '\\.')}"`, 'g')) || []).length, 1, id);
  }
  assert.equal((lesson.match(/data-design-col/g) || []).length, 2);
});

test('friendly error: approved wording, real message slot and retry kept, no red classes', () => {
  const card = lesson.slice(lesson.indexOf('<div id="error-card"'), lesson.indexOf('<div id="v21-maintenance"'));
  for (const t of ['Ối!', 'Trang sách bị gió thổi bay mất rồi!', 'Chưa mở được bài học', 'Bài con đã đọc vẫn được giữ nguyên.', 'Thử lại', 'Thử mấy lần vẫn chưa được? Ba mẹ nhắn Coach Felix nhé.']) assert.ok(card.includes(t), t);
  assert.match(card, /<p id="error-message">/);
  assert.match(card, /<button id="error-retry" class="r2l-primary" type="button">Thử lại<\/button>/);
  assert.doesNotMatch(card, /text-(gold|red)|bg-(gold|red)/);
});

test('css: never red on a wrong answer, resting or error card; reading text is 25px phone / 32px desktop', () => {
  const wrong = [...css.matchAll(/\.r2l-book-guided-option\[data-state='retry'\][^{]*\{[^}]*}/g)].map(m => m[0]).find(r => /background/.test(r));
  assert.doesNotMatch(wrong, /FF7A3D|E0362C|coral|minny/i);
  assert.match(wrong, /--r2l-sand/);
  for (const sel of ['.minny-rest__card', '.minny-rest__info', '.r2l-err__card']) {
    const rule = css.match(new RegExp(sel.replace(/\./g, '\\.') + ' \\{[^}]*}'))[0];
    assert.doesNotMatch(rule.slice(rule.indexOf('{')), /FF7A3D|E0362C|coral|--r2l-minny/i, sel);
  }
  assert.match(css, /--r2l-fs-story\)/);
  assert.match(css, /--r2l-fs-story-lg\)/);
});

test('css: no text below 15px (labels) anywhere, and every animation has a still twin', () => {
  assert.doesNotMatch(css, /font-size:\s*(1[0-4]|[0-9])px/);
  const animated = [...css.matchAll(/animation:\s*([a-z0-9-]+)/gi)].map(m => m[1]).filter(n => n !== 'none');
  assert.ok(animated.length >= 4);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.still body #w1-book-reader-phase/);
  // only transform / opacity keyframes
  for (const m of css.matchAll(/@keyframes (rd-[a-z-]+|r-wave|r-zz) \{([^]*?)\n?\}\s*(?=\n|body|@)/g)) assert.doesNotMatch(m[2].replace(/transform|opacity/g, ''), /(width|height|top|left|box-shadow|background)\s*:/, m[1]);
});

test('css: the listen play button, next buttons and the read stage primary are the sun style; the answer stage has none', () => {
  assert.match(css, /\.r2l-book-next-cta, body #w1-book-reader-phase \.r2l-book-audio__button, body #w1-book-reader-phase \.r2l-primary \{[^}]*background: var\(--r2l-sun\)/);
  assert.match(css, /min-height: 72px/);
  assert.doesNotMatch(css.match(/\.r2l-book-guided-option \{[^}]*}/)[0], /--r2l-sun/);
});

test('voice: the rest card splits VOICE_POOL_REST_VI verbatim into its sentences, middle one bold; the constant is imported, never retyped', () => {
  assert.match(voice, /import \{[^}]*VOICE_POOL_REST_VI[^}]*\} from '\.\.\/lib\/read2lead-minny-notes\.mjs'/);
  assert.equal(voice.includes('đầu tháng sau'), false);
  const parts = (VOICE_POOL_REST_VI.match(/[^.!?]+[.!?]+/g) || []).map(t => t.trim());
  assert.equal(parts.length, 3);
  assert.equal(parts[1], 'Bài của con đã được lưu.');
  assert.equal(parts.join(' '), VOICE_POOL_REST_VI);
  assert.match(voice, /parts\.length===3&&i===1\?node\('b',t\)/);
});

test('voice: markers, 12 dots, the log stays a role=log, the mic keeps its aria-label and the approved caption', () => {
  for (const id of ['voice.progress', 'voice.minny', 'voice.question', 'voice.primary', 'voice.mic', 'voice.feedback', 'rest.minny', 'rest.card', 'rest.info', 'rest.monster', 'rest.primary', 'story.primary', 'story.controls']) {
    assert.ok(voice.includes(`'${id}'`), id);
  }
  assert.match(voice, /setAttribute\('role','log'\)/);
  assert.match(voice, /microphoneButton\('🎙 Bấm để trả lời',recordVoice\)/);
  assert.match(voice, /'Bấm rồi nói câu trả lời','story-mission-mic-caption'/);
  assert.match(voice, /Array\.from\(\{length:Math\.max\(0,Number\(s\.totalQuestions\)\|\|0\)\}/);
  assert.equal(voice.includes("'Nhấn để nói'"), false);
});

test('voice: the face follows root.dataset.voiceState through CSS only (talk while Minny speaks, listen while the child records)', () => {
  assert.match(css, /\[data-voice-state='listening'\] \.minny-face--talk/);
  assert.match(css, /\[data-voice-state='recording'\] \.minny-face--listen \{ display: block; \}/);
  assert.match(css, /\[data-rest='1'\] \.minny-face--sleep \{ display: block; \}/);
  for (const f of ['minny-face.svg', 'minny-face-talk.svg', 'minny-listen.svg', 'minny-face-sleep.svg']) assert.ok(voice.includes(f) || lesson.includes(f), f);
});

test('follow-up: the story stays available while answering, and sits AFTER the voice block', () => {
  assert.doesNotMatch(css, /\[data-stage='understand'\] :is\([^)]*\.story-mission-book/);
  assert.match(css, /data-stage='understand'\] \.story-mission-chat \{ order: 1; \}/);
  assert.match(css, /data-stage='understand'\] \.story-mission-book \{ order: 2;/);
});

test("follow-up: the child's own companion comes from the existing helper (no fetch added) in the feedback row and the resting screen", () => {
  assert.match(voice, /loadAvatarModule\(\)\.then\(async m=>\(\{m,state:await m\.loadChildState\(/);
  assert.match(voice, /drawCompanion\(monsterHolder\)/);
  assert.match(voice, /drawCompanion\(monster\)/);
  const helper = voice.slice(voice.indexOf('const drawCompanion='), voice.indexOf('panel.replaceChildren(progressWrap'));
  assert.doesNotMatch(helper, /fetch\(/);
});

test('round 4 R1: the reader root keeps a real box, so scrollBookReaderToTop (root.scrollIntoView) still lands at the reader top', async () => {
  // no CSS rule may give the root (or the shell rule that targets it) display: contents
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, sel, body] = m;
    if (!/display:\s*contents/.test(body)) continue;
    for (const one of sel.split(',')) assert.doesNotMatch(one.trim(), /#w1-book-reader-phase(\.r2l-book-reader|\[[^\]]*\])*\s*$/, 'root must keep a box: ' + one.trim());
  }
  // the real helper, against the structure lesson.astro builds (root = #w1-book-reader-phase, inside #lesson-shell)
  const { scrollBookReaderToTop, BOOK_READER_SCROLL_ANCHOR_ID } = await import('../src/lib/read2lead-book-flow.mjs');
  assert.equal(BOOK_READER_SCROLL_ANCHOR_ID, 'w1-book-reader-phase');
  assert.match(lesson, /<section id="w1-book-reader-phase" class="r2l-book-reader/);
  const calls = [];
  const root = { scrollIntoView: o => calls.push(o) };
  const doc = { querySelector: s => (s === '#w1-book-reader-phase' ? root : null) };
  assert.equal(scrollBookReaderToTop(doc), root);
  assert.deepEqual(calls, [{ behavior: 'smooth', block: 'start' }]);
});

test('round 4: nothing in r2l-reading.css reaches the rank-up modal (a direct child of <main>), the reward overlay or other overlays', () => {
  // the modal is `main > section#rank-up-modal`: a bare `#main > section` would restyle it (padding, wrapping): it must target the content section only
  assert.doesNotMatch(css, /#main > section(?!\.max-w-6xl)[\s,{]/);
  assert.doesNotMatch(css, /#main :is\(\.text-xs/);
  assert.doesNotMatch(css, /(^|[,}\n])\s*(?!\.still)(button|\.r2l-btn|\.r2l-btn-sun|\.r2l-m-ring)[\s,{:]/m);
});

test('round 5: latest reply in the monster bubble, full log in a details; no local named `history` (render() calls window.history)', () => {
  assert.doesNotMatch(voice, /(const|let|var)\s+history\b/);
  assert.match(voice, /Xem lại các câu đã trả lời/);
  assert.match(voice, /feedback\.append\(monsterHolder,latest,replyLog\)/);
  assert.match(voice, /replyLog\.append\(node\('summary'[^)]*\),conversation\)/);
  assert.match(voice, /setAttribute\('role','log'\)/);
  assert.match(css, /\.story-mission-latest__great \{ color: var\(--r2l-leaf-deep\)/);
});

test('round 5: the 380-767px question-screen sizing never reaches the resting screen', () => {
  const block = css.slice(css.indexOf('/* 390 to 767: the progress'), css.indexOf('/* the label\'s font is Baloo 2'));
  const sels = [...block.matchAll(/(body[^{}]*?)\s*\{/g)].map(m => m[1]).filter(s => s.includes("[data-stage='understand']"));
  assert.ok(sels.length >= 6);
  for (const s of sels) assert.match(s, /:not\(\[data-rest='1'\]\)/, s);
  assert.match(css.match(/body:has\([^{]*\) #main \{ margin-top: -72px[^}]*}/)[0], /:not\(\[data-rest='1'\]\)/);
});

test('round 6: every /assets path the packet-B code references exists under public/ (Minny faces must not 404)', async () => {
  const { existsSync } = await import('node:fs');
  const missing = paths => paths.filter(p => !existsSync('public' + p));
  // bite: a deliberately missing path must be reported
  assert.deepEqual(missing(['/assets/minny/vector/does-not-exist.svg']), ['/assets/minny/vector/does-not-exist.svg']);
  const refs = new Set();
  for (const src of [voice, css]) for (const m of src.matchAll(/\/assets\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:svg|png|webp|jpg|mp3|mp4)/g)) refs.add(m[0]);
  // the faces are built as '/assets/minny/vector/' + file name
  for (const m of voice.matchAll(/faceOf\('[a-z]+','([a-z-]+\.svg)'\)/g)) refs.add('/assets/minny/vector/' + m[1]);
  assert.ok(refs.has('/assets/minny/vector/minny-face-talk.svg') && refs.has('/assets/minny/vector/minny-listen.svg') && refs.has('/assets/minny/vector/minny-face-sleep.svg'));
  // presentation markup added to lesson.astro: the question-card face
  const face = lesson.match(/class="r2l-book-q-face" src="([^"]+)"/);
  assert.ok(face);
  refs.add(face[1]);
  assert.deepEqual(missing([...refs]), []);
  // byte-identical to the locked design copies
  for (const f of ['minny-face-talk.svg', 'minny-listen.svg', 'minny-face-sleep.svg', 'minny-face.svg']) {
    assert.equal(sha(readFileSync('public/assets/minny/vector/' + f)), sha(readFileSync('_design/read2lead-dao-phieu-luu/assets/minny/' + f)), f);
  }
});

test('round 4 R2: voice DOM order is progress, Minny, question, MIC, latest reply, notice; label is Baloo 2', () => {
  assert.match(voice, /panel\.replaceChildren\(progressWrap,hero,qcard,controls,feedback,notice\)/);
  // the mic wrapper really is appended (a `//` comment once swallowed this call on the same line)
  const line = voice.split('\n').find(l => l.includes('controls.append(wrap)'));
  assert.ok(line && !/\/\/[^\n]*controls\.append\(wrap\)/.test(line));
  assert.match(voice, /node\('span','Bấm rồi nói câu trả lời','story-mission-mic-caption'\)/);
  const cap = css.match(/\.story-mission-mic-caption \{[^}]*font-family: var\(--r2l-font-display\)[^}]*}/);
  assert.ok(cap);
});

test('round 4 R3: a non-interview (tap-answer) session shows no empty question card, log row or progress line', () => {
  assert.match(voice, /feedback\.hidden=conversation\.hidden;qcard\.hidden=!interview\|\|s\.stage!=='understand'\|\|!!s\.feedbackPending;progressWrap\.hidden=!interview\|\|s\.stage!=='understand';/);
  // runs in render() for every session, ahead of the interview-only renderConversation()
  const render = voice.slice(voice.indexOf('function render()'));
  assert.ok(render.indexOf('qcard.hidden=!interview') > 0 && render.indexOf('qcard.hidden=!interview') < render.indexOf('renderConversation()'));
});

test('follow-up: r2lCdPop (mic countdown number) has a still twin for reduced motion and .still', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.r2l-cd-pop[^}]*animation: none !important/);
  assert.match(css, /\.still \.r2l-cd-pop[^}]*animation: none !important/);
});
