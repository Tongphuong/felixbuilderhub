// R2L-PUBLIC-HOME: the logged-out /read2lead page explains the product and shows the live rankings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as entryModule from '../src/lib/read2lead/student-entry.mjs';

const transpile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function element() {
  const events = {}, el = { events, hidden: false, disabled: false, value: '', textContent: '', className: '', children: [],
    classList: { toggle() {}, add() {}, remove() {} }, style: {}, dataset: {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, closest() { return element(); },
    addEventListener: (k, f) => { events[k] = f; },
    append(...kids) { this.children.push(...kids); }, replaceChildren() { this.children = []; this.textContent = ''; }, focus() {}, querySelector() { return element(); } };
  return el;
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
const leader = (rank, name, total) => ({ rank, display_name: name, total, is_self: false, avatar: { monster: { body: 'png-default-body-whitea' } } });
const board = { ok: true, boards: { xp: { leaders: [leader(1, 'An', 40), leader(2, 'Bảo', 30)], own: null }, diamonds: { leaders: [leader(1, 'Bình', 270)], own: null } } };

function page({ leaderboard }) {
  const nodes = new Map(), calls = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const location = { search: '', pathname: '/read2lead', href: 'https://app.test/read2lead', assign() {}, replace() {} };
  const exportsRanks = {};
  const document = { querySelector: s => get(s === '[data-child-home]' ? 'root' : s.replace(/^#/, '')), getElementById: get, createElement: element, querySelectorAll: () => [], addEventListener() {} };
  const base = { document, Intl, Number, String, Error, TypeError, Promise, console };
  const rankModule = { exports: exportsRanks };
  vm.runInNewContext(transpile('src/lib/r2l-ranks.ts'), { ...base, exports: exportsRanks, require: p => { if (p.includes('monster-avatar')) return { renderMonster() {} }; throw Error(p); } });
  const fetcher = async url => {
    calls.push(String(url));
    if (String(url).includes('read2lead-leaderboard')) return leaderboard(String(url));
    if (String(url).includes('read2lead-progress')) return Response.json({ ok: true, student_name: 'Mai', progress: { student_name: 'Mai', current_pack: { story_title: 'Saved' } }, read2lead_state: { diamonds: 5 } });
    return Response.json({ ok: false }, { status: 404 });
  };
  const context = { ...base, location, sessionStorage: memory(), localStorage: memory(), exports: {}, URL, URLSearchParams, matchMedia: () => ({ matches: true }), fetch: fetcher,
    history: { replaceState(_, __, url) { const u = new URL(url, location.href); location.search = u.search; location.pathname = u.pathname; } },
    window: { location, addEventListener() {} },
    require: p => { if (p.includes('student-entry')) return entryModule; if (p.includes('r2l-ranks')) return exportsRanks; if (p.includes('r2l-hero')) return { buildHeroCta: () => ({ action: 'lesson' }), statusMeta: () => ({ label: 'Saved' }) }; if (p.includes('monster-avatar')) return { renderMonster() {} }; if (p.includes('lesson-help')) return { requestLessonAssignment: async () => ({}) }; throw Error(p); } };
  vm.runInNewContext(transpile('src/scripts/read2lead-child-home.ts'), context);
  return { get, calls, async submit(code) { get('home-code').value = code; await get('home-entry-form').events.submit({ preventDefault() {} }); await settle(); } };
}

test('logged out: the rankings card fills from an anonymous (code-less) fetch', async () => {
  const p = page({ leaderboard: async () => Response.json(board) });
  await settle();
  assert.equal(p.get('home-entry').hidden, false);
  const lb = p.calls.filter(u => u.includes('read2lead-leaderboard'));
  assert.deepEqual(lb, ['/api/read2lead-leaderboard?limit=3']);
  assert.equal(p.get('entry-rankings').hidden, false);
  assert.equal(p.get('entry-rank-xp').children.length, 2);
  assert.equal(p.get('entry-rank-diamonds').children.length, 1);
  assert.equal(p.get('entry-rank-xp').children[0].children[2].textContent, 'An');
});

test('logged out: a board nobody is on yet is left out, the other fills the card', async () => {
  const p = page({ leaderboard: async () => Response.json({ ok: true, boards: { xp: { leaders: [] }, diamonds: board.boards.diamonds } }) });
  await settle();
  assert.equal(p.get('entry-rankings').hidden, false);
  assert.equal(p.get('entry-col-xp').hidden, true);
  assert.equal(p.get('entry-col-diamonds').hidden, false);
});

test('logged out: empty rankings hide the card, the page still shows the code box', async () => {
  const p = page({ leaderboard: async () => Response.json({ ok: true, boards: { xp: { leaders: [] }, diamonds: { leaders: [] } } }) });
  await settle();
  assert.equal(p.get('entry-rankings').hidden, true);
  assert.equal(p.get('home-entry').hidden, false);
});

test('logged out: a failing leaderboard (503 / network error) still leaves the hero and code box', async () => {
  for (const leaderboard of [async () => Response.json({ ok: false }, { status: 503 }), async () => { throw new TypeError('offline'); }]) {
    const p = page({ leaderboard });
    await settle();
    assert.equal(p.get('home-entry').hidden, false);
    assert.equal(p.get('entry-rankings').hidden, true);
    assert.equal(p.get('home-error').hidden, true);
  }
});

test('code entry still works and the kid home still loads its own ranks with the code', async () => {
  const p = page({ leaderboard: async () => Response.json(board) });
  await settle();
  await p.submit('r2l-abc');
  assert.equal(p.get('home-ready').hidden, false);
  assert.equal(p.get('home-entry').hidden, true);
  assert.equal(p.get('home-name').textContent, 'Mai');
  assert.ok(p.calls.some(u => u === '/api/read2lead-leaderboard?limit=3&code=R2L-ABC'));
  assert.equal(p.get('home-rank-xp').children.length, 2);
});

test('code entry: an empty code shows the same Vietnamese message and fetches nothing', async () => {
  const p = page({ leaderboard: async () => Response.json(board) });
  await settle();
  const before = p.calls.length;
  await p.submit('   ');
  assert.match(p.get('home-entry-message').textContent, /Mã bắt đầu bằng R2L-/);
  assert.equal(p.calls.length, before);
});

test('markup: hero copy is the approved text, code box and logged-in card are unchanged, one shared renderer', () => {
  const astro = readFileSync('src/components/Read2LeadChildHome.astro', 'utf8');
  const entry = astro.slice(astro.indexOf('id="home-entry"'), astro.indexOf('id="home-error"'));
  assert.match(entry, />Con đọc truyện và luyện nói cùng Minny</); // R3: "Read2Lead — " dropped from the H1 (mock 09, founder-approved wording)
  assert.match(entry, /bổ trợ cho việc học tại nhà/);
  assert.match(entry, /<ol id="entry-steps"[\s\S]*Đọc[\s\S]*Trả lời Minny[\s\S]*Kể qua tranh/);
  assert.match(entry, /href="#home-code"[^>]*>Nhập mã/);
  for (const keep of ['Góc đọc sách đang chờ con', 'Nhập mã học sinh để mở truyện của con nhé.', 'Mã học sinh của con', 'Mở góc đọc sách', 'Con cũng có thể mở link riêng Coach Felix đã gửi.']) assert.ok(entry.includes(keep), keep);
  // The full board needs a code (401 without one), so the public card is NOT a link.
  assert.doesNotMatch(entry.slice(entry.indexOf('id="entry-rankings"'), entry.indexOf('reading-home__codebox')), /<a\b|href=/);
  // Hero comes before the code box; code box anchor is reachable.
  assert.ok(entry.indexOf('entry-steps') < entry.indexOf('id="home-entry-form"'));
  assert.match(astro, /<a id="home-board-link"[^>]*href="\/read2lead\/leaderboard"/);
  const script = readFileSync('src/scripts/read2lead-child-home.ts', 'utf8');
  assert.match(script, /from '\.\.\/lib\/r2l-ranks'/);
  assert.doesNotMatch(script, /function rankList/);
});
