// R2L-ISLAND release 3, packet C: the parents' public page, the flat Minny art swap and the R2 backlog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const read = p => readFileSync(p, 'utf8');
const home = read('src/components/Read2LeadChildHome.astro');
const entry = home.slice(home.indexOf('<section id="home-entry"'), home.indexOf('<section id="home-error"'));
const errorSection = home.slice(home.indexOf('<section id="home-error"'), home.indexOf('<!-- Logged-in kid home'));
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ---------------------------------------------------------------- parents' page
test('parents: hero copy is the approved wording at every width (no "10–15 phút", no "Read2Lead —" in the H1)', () => {
  assert.match(entry, /<h1 id="home-entry-hero"[^>]*>Con đọc truyện và luyện nói cùng Minny<\/h1>/);
  assert.ok(text(entry).includes('Read2Lead là góc đọc truyện tiếng Anh miễn phí, bổ trợ cho việc học tại nhà. Mỗi ngày 3 bước:'));
  assert.doesNotMatch(home, /10–15|10-15 phút/);
  assert.doesNotMatch(entry, /qua các bức tranh/);
  for (const s of ['Đọc', 'Con đọc truyện tranh từng trang.', 'Trả lời Minny', 'Minny hỏi, con trả lời bằng giọng nói.', 'Kể qua tranh', 'Con kể lại câu chuyện qua tranh.']) {
    assert.ok(entry.includes(s), s);
  }
});

test('parents: every marker of the contract is present once, in contract order', () => {
  const order = ['parents.header', 'parents.hero', 'parents.steps', 'parents.top3', 'parents.code', 'parents.signup', 'parents.donate'];
  const page = home.slice(0, home.indexOf('<!-- Logged-in kid home'));
  const at = order.map(id => page.indexOf(`data-design="${id}"`));
  assert.ok(at.every(i => i >= 0), 'all markers: ' + at.join(','));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'DOM order');
  for (const id of ['parents.minny', 'parents.jump', 'parents.primary', 'parents.turnstile']) {
    assert.equal(page.split(`data-design="${id}"`).length - 1, 1, id);
  }
  // exactly two layout columns are marked: the code card and the sign-up card
  assert.equal(page.split('data-design-col').length - 1, 2);
});

test('parents: the 390 sun "Nhập mã ↓" is an in-page anchor to #home-code; "Mở góc đọc sách" is THE primary', () => {
  assert.match(entry, /<a class="[^"]*r2l-btn-sun[^"]*ph-jump"[^>]*href="#home-code"[^>]*data-design="parents\.jump">Nhập mã/);
  assert.match(entry, /<button id="home-entry-submit" class="r2l-btn r2l-btn-sun r2l-btn-w" type="submit" data-design="parents\.primary">Mở góc đọc sách/);
  assert.match(home, /<a id="ph-header-code" class="ph-header-code" href="#home-code">Nhập mã<\/a>/);
  assert.equal(entry.split('r2l-btn-sun').length - 1, 2, 'only the jump anchor and the code button are sun');
  assert.doesNotMatch(entry, /signup-submit" class="[^"]*sun/);
});

test('parents: Minny is the flat face in a red-ring porthole, 96px minimum', () => {
  assert.match(entry, /data-design="parents\.minny"><img src="\/assets\/minny\/vector\/minny-face\.svg"/);
  const css = read('src/styles/read2lead-home-island.css');
  assert.match(css, /\.ph-minny \{[^}]*width: 96px; height: 96px; border-radius: 50%; border: 4px solid var\(--r2l-minny\)/);
  assert.match(css, /\.ph-minny \{ width: 220px; height: 220px; border-width: 6px; \}/);
  assert.doesNotMatch(entry, /defaultMonsterSvg\(\)\}>?\s*<\/div>\s*<h1/);
});

test('parents: code card, sign-up card and donation keep every existing id, field, string and the live QR / account lines', () => {
  for (const id of ['home-entry-form', 'home-code', 'home-entry-message', 'home-entry-submit', 'signup-card', 'signup-title', 'signup-form', 'signup-name', 'signup-name-note', 'signup-age', 'signup-gender-boy', 'signup-gender-girl', 'signup-turnstile', 'signup-message', 'signup-submit', 'donate-card', 'donate-title', 'donate-account-name', 'donate-bank', 'entry-rankings', 'entry-col-xp', 'entry-col-diamonds', 'entry-rank-xp', 'entry-rank-diamonds', 'entry-steps']) {
    assert.ok(entry.includes(`id="${id}"`), id);
  }
  for (const s of ['Góc đọc sách đang chờ con', 'Nhập mã học sinh để mở truyện của con nhé.', 'Mã học sinh của con', 'Mở góc đọc sách', 'Con cũng có thể mở link riêng Coach Felix đã gửi.', 'Nhờ ba mẹ nhận mã từ Coach Felix', 'Chưa có mã? Tạo mã miễn phí', 'Con điền vài thông tin nhỏ, Minny sẽ mở góc đọc sách cho con ngay.', 'Tên của con', 'Tên con sẽ hiện trên bảng xếp hạng công khai.', 'Con mấy tuổi?', 'Chọn tuổi của con', 'Con là', 'Bé trai', 'Bé gái', 'Tạo mã miễn phí', 'Dành cho ba mẹ', 'Bảng xếp hạng', 'Kim cương', 'XP']) {
    assert.ok(entry.includes(s), s);
  }
  assert.match(entry, /<span id="donate-account-name">TONG MINH PHUONG<\/span>/);
  assert.match(entry, /<span id="donate-bank">MB Bank · 0396868675<\/span>/);
  assert.match(entry, /<img class="ph-qr" src="\/donate-qr\.png" width="240" height="240" alt="Mã QR chuyển khoản ủng hộ Read2Lead"/);
  assert.ok(text(entry).includes('Read2Lead miễn phí cho mọi bạn nhỏ. Nếu ba mẹ thấy hữu ích, có thể ủng hộ để duy trì trang.'));
  // role=alert lines survive
  assert.match(entry, /<p id="home-entry-message" class="ph-alert" role="alert">/);
  assert.match(entry, /<p id="signup-message" class="ph-alert" role="alert">/);
});

test('parents: the sign-up card is still gated on the Turnstile site key, and its box carries the design marker', () => {
  assert.match(home, /\{TURNSTILE_SITE_KEY && <div id="signup-card"/);
  assert.match(entry, /<div id="signup-turnstile" class="ph-turnstile" data-design="parents\.turnstile"><\/div>/);
  assert.match(entry, /data-turnstile-sitekey=\{TURNSTILE_SITE_KEY\}/);
  assert.match(home, /const TURNSTILE_SITE_KEY = String\(import\.meta\.env\.PUBLIC_TURNSTILE_SITE_KEY \|\| ''\)\.trim\(\);/);
});

test('parents: the loading notice, the error card (retry + Zalo link) and the speaking note are kept', () => {
  assert.ok(home.includes('<section id="home-loading" class="reading-home__notice" role="status">Đang mở góc đọc sách của con…</section>'));
  assert.ok(errorSection.includes('Mình cùng mở góc đọc sách nhé'));
  assert.ok(errorSection.includes('id="home-error-message" role="alert"'));
  assert.ok(errorSection.includes('<button id="home-retry"') && errorSection.includes('>Thử lại</button>'));
  assert.ok(errorSection.includes('Nhắn Coach Felix để nhận link của con') && errorSection.includes('href={ZALO_URL}'));
  assert.ok(home.includes('id="home-speaking-note"') && home.includes('Minny luyện nói cùng con trong mỗi câu chuyện. Bài đã lưu của con vẫn còn.'));
});

test('parents: the logged-in kid home (#home-ready) is byte-identical to main', async () => {
  const { execFileSync } = await import('node:child_process');
  const before = execFileSync('git', ['show', 'HEAD:src/components/Read2LeadChildHome.astro'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const cut = s => s.slice(s.indexOf('<!-- Logged-in kid home'));
  // HEAD may be this branch's own commits: the kid-home block must equal the one on the base commit
  let base = before;
  try { base = execFileSync('git', ['show', '6540dc8:src/components/Read2LeadChildHome.astro'], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { /* base commit not in this clone */ }
  assert.equal(cut(home), cut(base));
});

test('parents: only the monster bob animates on the logged-out page, and no white text sits on sun/sky/coral/hill', () => {
  const css = read('src/styles/read2lead-home-island.css');
  const ph = css.slice(css.indexOf('R2L-ISLAND R3: the logged-out'));
  const animated = [...entry.matchAll(/class="[^"]*r2l-m-([a-z]+)/g)].map(m => m[1]);
  assert.deepEqual(animated, ['bob']);
  assert.doesNotMatch(ph, /(?:^|[;{\s])color:\s*#fff[^;]*;[^}]*background:\s*var\(--r2l-(sun|sky|coral|hill)/);
  assert.doesNotMatch(entry, /r2l-m-(ring|halo|pop|tw|drift)/);
});

// ---------------------------------------------------------------- flat Minny
const DESIGN = '_design/read2lead-dao-phieu-luu/assets/minny/';
test('Minny: all 6 locked SVGs are in public/assets/minny/vector, byte-identical with the design folder', () => {
  for (const n of ['minny-face', 'minny-face-talk', 'minny-face-sleep', 'minny-idle', 'minny-listen', 'minny-cheer']) {
    assert.ok(existsSync(`public/assets/minny/vector/${n}.svg`), n);
    assert.equal(createHash('sha256').update(readFileSync(`public/assets/minny/vector/${n}.svg`)).digest('hex'), createHash('sha256').update(readFileSync(`${DESIGN}${n}.svg`)).digest('hex'), n);
  }
});

const { PNG } = require('pngjs');
const SIZES = {
  'public/assets/minny/minny.png': [288, 512, false], 'public/assets/minny/minny_full.png': [288, 512, false],
  'public/assets/minny/minny_idle.png': [288, 512, false], 'public/assets/minny/minny_listen.png': [288, 512, false],
  'public/assets/minny/minny_celebrate.png': [288, 512, false], 'public/assets/minny/minny_encourage.png': [288, 512, false],
  'public/assets/minny/minny_bust.png': [400, 400, true], 'public/assets/minny/minny_face.png': [400, 400, true],
  'public/assets/r2l/minny/idle.png': [512, 512, true], 'public/assets/r2l/minny/clap.png': [512, 512, true],
  'public/assets/r2l/minny/dance.png': [512, 512, true], 'public/assets/r2l/minny/smile.png': [512, 512, true],
  'public/assets/r2l/minny/wink.png': [512, 512, true], 'public/assets/r2l/minny/thinking.png': [512, 512, true],
};
test('Minny: every PNG keeps its name and pixel size, is flat vector art (few colours), and is transparent where the original was', () => {
  for (const [file, [w, h, transparent]] of Object.entries(SIZES)) {
    const png = PNG.sync.read(readFileSync(file));
    assert.equal(png.width, w, file); assert.equal(png.height, h, file);
    const colours = new Set(); let clear = 0;
    for (let i = 0; i < png.data.length; i += 4 * 7) { colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]); if (png.data[i + 3] === 0) clear++; }
    // the old 3D renders held tens of thousands of colours; flat vector art with antialiasing stays far below that
    assert.ok(colours.size < 4000, `${file} has ${colours.size} sampled colours: not flat art`);
    if (transparent) assert.equal(png.data[3], 0, `${file}: top-left corner must be transparent`);
    else assert.equal(png.data[3], 255, `${file}: opaque as the original`);
    if (transparent) assert.ok(clear > 0, file);
  }
});

test('Minny: README documents the flat art and says the videos were left alone', () => {
  const readme = read('public/assets/minny/README.md');
  assert.match(readme, /flat vector/);
  assert.match(readme, /minny-cheer/);
  assert.match(readme, /mp4.*NOT replaced/s);
});

// ---------------------------------------------------------------- R2 backlog
test('backlog 1: the library "today" card has a near-square drawing for the 1100px+ side card (sun and cloud not sliced off)', () => {
  const js = read('src/scripts/read2lead-book-library.mjs');
  const css = read('src/styles/read2lead-book-library.css');
  assert.match(js, /SCENE_ART_WIDE='<svg class="art-wide"[^']*viewBox="0 0 112 112"[^']*<circle cx="82" cy="30" r="16"/);
  assert.match(js, /const SCENE_ART=SCENE_ART_WIDE\+'<svg class="art-strip"/);
  assert.match(css, /@media\(min-width:1100px\)\{\.scene \.art-strip\{display:none\}\.scene \.art-wide\{display:block\}/);
  assert.match(css, /\.scene \.art-wide\{display:none\}/);
});

test('backlog 2: both ARIA toolbars move focus with Up/Down as well as Left/Right (+ Home/End)', () => {
  const lib = read('src/scripts/read2lead-book-library.mjs');
  const mb = read('src/lib/monster-builder.ts');
  for (const src of [lib, mb]) {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) assert.ok(src.includes(`'${k}'`), k);
    assert.match(src, /e\.key\s*===\s*'ArrowLeft'\s*\|\|\s*e\.key\s*===\s*'ArrowUp'/);
  }
});

test('backlog 3: the option toolbar is named after its category ("Chọn kiểu · Mắt")', () => {
  const mb = read('src/lib/monster-builder.ts');
  assert.match(mb, /tiles\.setAttribute\('aria-label', `Chọn kiểu · \$\{SLOT_LABELS_VI\[selectedSlot\]\}`\)/);
});

function loadNames() {
  const src = read('src/lib/monster-builder.ts');
  const labels = src.slice(src.indexOf('const SLOT_LABELS_VI'), src.indexOf('};', src.indexOf('const SLOT_LABELS_VI')) + 2);
  const fn = src.slice(src.indexOf('function partNameVi('), src.indexOf('function defaultDraft('));
  const js = stripTypeScriptTypes(`type MonsterSlot = string;\n${labels}\n${fn}`);
  return new Function(js + '\nreturn partNameVi;')();
}
test('backlog 4: every option name inside a slot is unique, meaningful Vietnamese, and ids/saved data are untouched', () => {
  const partNameVi = loadNames();
  const parts = JSON.parse(read('src/data/monster-parts.json'));
  const slots = Object.keys(parts);
  assert.ok(slots.length >= 10);
  for (const slot of slots) {
    const names = parts[slot].map(p => partNameVi(slot, p.id));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, [], `${slot}: duplicate names ${[...new Set(dupes)].join(' | ')}`);
    for (const n of names) assert.match(n, /\p{L}/u);
  }
  // the old colour-only names are gone
  assert.notEqual(partNameVi('body', 'png-default-body-darka'), partNameVi('body', 'png-default-body-darkb'));
  assert.equal(partNameVi('body', 'png-default-body-darka'), 'Thân đen · kiểu 1');
  assert.equal(partNameVi('mouth', 'png-default-mouth-closed-happy'), 'Miệng cười');
  assert.equal(partNameVi('', ''), 'Không dùng');
  // an id the manifest does not know keeps the old, plain behaviour (no crash)
  assert.equal(typeof partNameVi('body', 'something-new'), 'string');
  // ids in the file are not rewritten
  assert.ok(parts.body.some(p => p.id === 'png-default-body-darka'));
});

test('backlog 5: no inline onerror/onload on the gift photo; a capture-phase listener does the same job', () => {
  const src = read('src/lib/gift-ux.ts');
  assert.doesNotMatch(src, /onerror="|onload="/);
  assert.match(src, /data-qt-photo/);
  const start = src.indexOf('export function applyPhotoWellState');
  const end = src.indexOf('/** GiftPhotoWell (HANDOFF');
  const js = stripTypeScriptTypes(src.slice(start, end).replace(/export function/g, 'function')) + '\nreturn { installPhotoWellFallback, applyPhotoWellState };';
  const { installPhotoWellFallback } = new Function(js)();
  // a fake document: records the listeners and the swept images
  const handlers = {};
  let swept = 0;
  const doc = { addEventListener: (t, fn, capture) => { handlers[t] = { fn, capture }; }, querySelectorAll: () => { swept++; return []; } };
  installPhotoWellFallback(doc); installPhotoWellFallback(doc);
  assert.equal(swept, 1, 'installs once');
  assert.equal(handlers.error.capture, true); assert.equal(handlers.load.capture, true);
  const mk = (marked) => { const log = []; const well = { classList: { add: c => log.push(c) } }; return { log, el: { tagName: 'IMG', hasAttribute: a => marked && a === 'data-qt-photo', remove: () => log.push('removed'), closest: () => well } }; };
  const failed = mk(true); handlers.error.fn({ target: failed.el });
  assert.deepEqual(failed.log, ['removed']);
  const ok = mk(true); handlers.load.fn({ target: ok.el });
  assert.deepEqual(ok.log, ['qt-photo-well--has-img']);
  const other = mk(false); handlers.error.fn({ target: other.el }); handlers.load.fn({ target: other.el });
  assert.deepEqual(other.log, [], 'unmarked images are left alone');
});
