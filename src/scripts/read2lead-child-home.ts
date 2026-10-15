import { requestLessonAssignment } from './read2lead-lesson-help.mjs';
import { buildHeroCta, statusMeta } from '../lib/r2l-hero';
import { renderMonster } from '../lib/monster-avatar';

const root = document.querySelector<HTMLElement>('[data-child-home]');
if (root) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const button = el<HTMLButtonElement>('home-open');
  let accessCode = '', busy = false;
  const number = (value: unknown) => new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0));
  const phase = (name: string) => {
    for (const key of ['loading', 'ready', 'error']) el('home-' + key).hidden = key !== name;
    root.setAttribute('aria-busy', String(name === 'loading'));
  };
  const error = (message: string, retry = true) => {
    el('home-error-message').textContent = message; el('home-retry').hidden = !retry; phase('error');
  };
  const readJson = async (response: Response) => {
    const data = await response.json();
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.message || 'Mình chưa mở được góc đọc sách. Con thử lại nhé.'), { status: response.status });
    return data;
  };
  async function load() {
    phase('loading'); el('home-wallet').hidden = true;
    try {
      const params = new URLSearchParams(location.search);
      el('home-speaking-note').hidden = params.get('from') !== 'speaking';
      // Invalid explicit personal links never fall back to another stored identity.
      if (params.has('t') || location.pathname.replace(/\/$/, '') === '/r2l/start') {
        const token = params.get('t');
        if (!token) { error('Link này thiếu mã. Ba mẹ nhắn Coach Felix để nhận link của con nhé.', false); return; }
        const identity = await readJson(await fetch('/api/r2l-link?token=' + encodeURIComponent(token)));
        accessCode = identity.access_code || '';
      } else if (params.has('code')) accessCode = (params.get('code') || '').trim();
      else { try { accessCode = sessionStorage.getItem('r2l_access_code') || ''; } catch { accessCode = ''; } }
      if (!accessCode) { error('Mở link riêng của con để bắt đầu đọc nhé.', false); return; }
      const code = encodeURIComponent(accessCode);
      const data = await readJson(await fetch('/api/read2lead-progress?code=' + code));
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
      el<HTMLAnchorElement>('home-parent').href = '/ho-so?code=' + code + '&role=parent';
      const monster = state.avatar?.monster;
      if (monster) {
        const child = document.createElement('div'); el('home-pet').replaceChildren(child);
        renderMonster(child, monster, { size: 'large', animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, withCosmetics: true, equipped: state.equipped, equippedDisplay: state.equipped_display });
      }
      phase('ready');
    } catch (cause: any) {
      error(cause instanceof TypeError ? 'Mất kết nối. Con kiểm tra mạng rồi thử lại nhé.' : cause.message, ![400,401,403,404,410].includes(cause.status));
    }
  }
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
