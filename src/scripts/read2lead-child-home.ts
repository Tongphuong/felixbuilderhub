import { requestLessonAssignment } from './read2lead-lesson-help.mjs';
import { buildHeroCta, statusMeta } from '../lib/r2l-hero';
import { renderMonster } from '../lib/monster-avatar';
import { renderBoards } from '../lib/r2l-ranks';
import { normalizeStudentCode, studentEntry } from '../lib/read2lead/student-entry.mjs';

const root = document.querySelector<HTMLElement>('[data-child-home]');
if (root) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const button = el<HTMLButtonElement>('home-open');
  let accessCode = '', busy = false, loadId = 0;
  const number = (value: unknown) => new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0));
  const phase = (name: string) => {
    for (const key of ['loading', 'ready', 'error', 'entry']) el('home-' + key).hidden = key !== name;
    root.setAttribute('aria-busy', String(name === 'loading'));
  };
  const error = (message: string, retry = true) => {
    el('home-error-message').textContent = message; el('home-retry').hidden = !retry; phase('error');
  };
  const entry = (message = '') => {
    accessCode = ''; el('home-wallet').hidden = true;
    el('home-entry-message').textContent = message;
    el<HTMLInputElement>('home-code').setAttribute('aria-invalid', String(Boolean(message)));
    phase('entry');
    void loadPublicRanks();
  };
  const readJson = async (response: Response) => {
    const data = await response.json();
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.message || 'Mình chưa mở được góc đọc sách. Con thử lại nhé.'), { status: response.status });
    return data;
  };
  // Rankings are decoration for the main flow: a failure here must never block reading.
  async function loadRanks(code: string) {
    try {
      const data = await readJson(await fetch('/api/read2lead-leaderboard?limit=3&code=' + code));
      const boards = data.boards || {};
      renderBoards(boards, el('home-rank-xp'), el('home-rank-diamonds'));
      const xp = boards.xp?.own, dia = boards.diamonds?.own, parts: string[] = [];
      if (xp?.rank) parts.push('XP #' + xp.rank);
      if (dia?.rank) parts.push('💎 #' + dia.rank);
      el('home-rank-own').textContent = parts.length ? 'Con đang hạng ' + parts.join(' · ') : 'Đọc truyện để lên bảng nhé!';
    } catch { /* keep the tappable card with its default text */ }
  }
  // Logged-out card: same renderer, no code. Empty or failed = card stays hidden; the page never blanks.
  let publicRanksLoaded = false;
  async function loadPublicRanks() {
    if (publicRanksLoaded) return;
    publicRanksLoaded = true;
    try {
      const data = await readJson(await fetch('/api/read2lead-leaderboard?limit=3'));
      const drawn = renderBoards(data.boards, el('entry-rank-xp'), el('entry-rank-diamonds'), null);
      // A board nobody is on yet is left out, so the other one fills the card.
      el('entry-col-xp').hidden = !(data.boards?.xp?.leaders || []).length;
      el('entry-col-diamonds').hidden = !(data.boards?.diamonds?.leaders || []).length;
      el('entry-rankings').hidden = drawn === 0;
    } catch { el('entry-rankings').hidden = true; publicRanksLoaded = false; }
  }
  async function load() {
    const id = ++loadId;
    let wasRemembered = false;
    phase('loading'); el('home-wallet').hidden = true;
    try {
      const params = new URLSearchParams(location.search);
      el('home-speaking-note').hidden = params.get('from') !== 'speaking';
      // Only the bare /read2lead address reopens the child THIS tab already signed in as;
      // /r2l/start and any explicit code or link never use a remembered identity.
      let remembered = '';
      try { remembered = sessionStorage.getItem('r2l_access_code') || ''; } catch { remembered = ''; }
      const requested = studentEntry(params, { allowRemembered: location.pathname.replace(/\/$/, '') === '/read2lead', remembered });
      wasRemembered = requested.kind === 'remembered';
      if (requested.kind === 'manual') {
        try { sessionStorage.removeItem('r2l_access_code'); } catch { /* Nothing stored to read. */ }
        entry(); return;
      }
      // Invalid explicit personal links never fall back to another stored identity.
      if (requested.kind === 'link') {
        if (!requested.token) { entry('Link này chưa đủ mã. Con nhập mã học sinh bên dưới nhé.'); return; }
        const identity = await readJson(await fetch('/api/r2l-link?token=' + encodeURIComponent(requested.token)));
        if (id !== loadId) return;
        accessCode = identity.access_code || '';
      } else accessCode = requested.code;
      if (!accessCode) { entry('Con kiểm tra lại mã học sinh nhé. Mã bắt đầu bằng R2L-.'); return; }
      const code = encodeURIComponent(accessCode);
      const data = await readJson(await fetch('/api/read2lead-progress?code=' + code));
      if (id !== loadId) return;
      try { sessionStorage.setItem('r2l_access_code', accessCode); } catch { /* Storage is optional. */ }
      const state = data.read2lead_state || {}, progress = data.progress || {};
      el('home-name').textContent = progress.student_name || data.student_name || 'con';
      el('home-diamonds').textContent = number(state.diamonds); el('home-wallet').hidden = false;
      const pack = progress.current_pack, cta = buildHeroCta(pack, data, accessCode, params.get('done') === '1');
      const resting = cta.action === 'rest';
      button.hidden = resting; el('home-steps').hidden = resting;
      const original = pack && pack.schema_version !== 'story-mission-v1';
      el('home-step-two').textContent = original ? 'Hiểu truyện' : 'Trả lời Minny';
      el('home-step-three').textContent = original ? 'Luyện nói' : 'Kể qua tranh';
      button.textContent = cta.action === 'lesson' ? 'Đọc tiếp →' : 'Mở truyện →'; button.disabled = cta.action === 'wait';
      el('home-heading').textContent = resting ? 'Con đã xong hôm nay!' : cta.action === 'lesson' ? pack.story_title || 'Truyện của con' : 'Hôm nay mình đọc nhé!';
      el('home-instruction').textContent = resting ? 'Kết quả đã được lưu. Con nghỉ nhé, hẹn gặp con lần sau!' : pack?.review_only ? 'Ôn lại truyện · Không cộng thêm thưởng' : cta.action === 'lesson' ? statusMeta(data.state, pack).label : cta.action === 'wait' ? 'Truyện đang được chuẩn bị. Con quay lại sau một chút nhé.' : 'Một câu chuyện đang chờ con.';
      const count = Number(progress.completed_packs || state.completed_packs || 0);
      el('home-personal-progress').textContent = count > 0 ? `Con đã đọc ${number(count)} truyện.${resting ? '' : ' Mình tiếp tục từng bước nhé!'}` : 'Bắt đầu câu chuyện đầu tiên của con nhé.';
      el<HTMLAnchorElement>('home-companion').href = '/read2lead/companion?code=' + code;
      el<HTMLAnchorElement>('home-rankings').href = '/read2lead/leaderboard?code=' + code;
      void loadRanks(code);
      el<HTMLAnchorElement>('home-parent').href = '/ho-so?code=' + code + '&role=parent';
      const monster = state.avatar?.monster;
      if (monster) {
        const child = document.createElement('div'); el('home-pet').replaceChildren(child);
        renderMonster(child, monster, { size: 'large', animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, withCosmetics: true, equipped: state.equipped, equippedDisplay: state.equipped_display });
      }
      phase('ready');
    } catch (cause: any) {
      if (id !== loadId) return;
      // A remembered child that the server no longer accepts: forget it, show the plain code form.
      if (wasRemembered && cause.status && cause.status < 500) { try { sessionStorage.removeItem('r2l_access_code'); } catch { /* ignore */ } entry(); return; }
      entry(cause instanceof TypeError ? 'Chưa kết nối được. Con kiểm tra mạng rồi thử lại nhé.' : [400,401,403,404,410].includes(cause.status) ? 'Mình chưa mở được bằng mã hoặc link này. Con kiểm tra lại mã, hoặc nhờ ba mẹ giúp nhé.' : 'Chưa mở được góc đọc sách. Con thử lại sau một chút nhé.');
    }
  }
  el('home-entry-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = el<HTMLButtonElement>('home-entry-submit');
    if (submit.disabled) return;
    const code = normalizeStudentCode(el<HTMLInputElement>('home-code').value);
    if (!code) { entry('Con kiểm tra lại mã học sinh nhé. Mã bắt đầu bằng R2L-.'); el('home-code').focus(); return; }
    el<HTMLInputElement>('home-code').value = code;
    submit.disabled = true;
    history.replaceState({}, '', '/read2lead?code=' + encodeURIComponent(code));
    try { await load(); } finally { submit.disabled = false; }
  });
  button.addEventListener('click', async () => {
    if (busy || !accessCode) return;
    busy = true; button.disabled = true; el('home-action-status').textContent = 'Đang mở truyện của con…';
    try {
      const data = await requestLessonAssignment({code:accessCode});
      if ((data.ok || data.error === 'previous_pack_needs_review') && data.lesson_link) {
        const target = new URL(data.lesson_link, location.origin);
        if (target.origin !== location.origin || target.pathname !== '/read2lead/lesson') throw Error('Chưa mở được truyện. Con thử lại nhé.');
        location.assign(target.href); return;
      }
      throw Error(data.message || 'Chưa có truyện phù hợp. Con quay lại sau một chút nhé.');
    } catch (cause: any) {
      el('home-action-status').textContent = cause instanceof TypeError ? 'Mất kết nối. Con thử lại nhé; bài đã lưu vẫn còn.' : cause.message;
      busy = false; button.disabled = false;
    }
  });
  el('home-retry').addEventListener('click', load);
  window.addEventListener('pageshow', event => {
    if (event.persisted) { busy = false; el('home-action-status').textContent = ''; void load(); }
  });
  void load();
}
