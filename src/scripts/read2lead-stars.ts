import { renderMonster, type MonsterConfig } from '../lib/monster-avatar';
type Metric = 'reading' | 'diamonds';
type Row = { rank: number | null; display_name: string; total: number; is_self: boolean; avatar?: { monster?: MonsterConfig } };
type Data = { active: boolean; starts_at: string | null; boards: Record<Metric, { leaders: Row[]; own: Row | null; participants: number }> };
const el = (id: string) => document.getElementById(id)!;
let data: Data | null = null, selected: Metric = 'reading';
const format = (n: number) => n.toLocaleString('vi-VN');
function node(tag: string, className: string, text?: string) {
  const item = document.createElement(tag); item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function rowView(row: Row, podium: boolean) {
  const rank = row.rank || 0;
  const item = node(podium ? 'article' : 'li', `stars-card ${podium ? 'stars-medal stars-medal--' + rank : 'stars-row'}${row.is_self ? ' is-self' : ''}`);
  item.dataset.rank = String(rank);
  item.append(node('span', 'stars-rank', rank ? '#' + rank : '☆'));
  if (podium) item.append(node('span', 'stars-emblem', rank === 1 ? '♛' : rank === 2 ? '✦' : '✧'));
  const portrait = node('div', 'stars-portrait');
  if (row.avatar?.monster) { const monster = node('div', ''); portrait.append(monster); renderMonster(monster, row.avatar.monster, { size: podium ? 'large' : 'small', animate: false, withCosmetics: true, compactCosmetics: true }); }
  else portrait.textContent = '📖';
  item.append(portrait, node('h2', 'stars-name', row.display_name + (row.is_self ? ' · Con ở đây' : '')),
    node('p', 'stars-total', format(row.total) + (selected === 'reading' ? ' truyện' : ' kim cương')));
  return item;
}
function render() {
  if (!data) return;
  const board = data.boards[selected];
  for (const metric of ['reading', 'diamonds'] as Metric[]) {
    const tab = el(metric + '-tab'); tab.setAttribute('aria-selected', String(metric === selected)); tab.tabIndex = metric === selected ? 0 : -1;
  }
  el('stars-panel').setAttribute('aria-labelledby', selected + '-tab');
  const own = data.boards.reading.own, earned = data.boards.diamonds.own;
  el('stars-personal').hidden = !own;
  el('stars-personal').textContent = own && own.total > 0 ? `Tuần này con đã hoàn thành ${format(own.total)} truyện và nhận ${format(earned?.total || 0)} kim cương từ học tập. Mỗi bước đều đáng vui!` : 'Một câu chuyện đầu tiên đang chờ con. Mình đọc theo nhịp của con nhé!';
  el('stars-status').hidden = board.leaders.length > 0;
  el('stars-status').textContent = data.active ? 'Tuần này chưa có thành tích được ghi nhận. Mình bắt đầu bằng một câu chuyện nhé!' : 'Bảng thành tích sẽ bắt đầu cùng phiên bản đọc sách mới. Bài đã lưu và kim cương của con vẫn còn.';
  el('stars-panel').hidden = false;
  const podium = el('stars-podium'), list = el('stars-list'); podium.replaceChildren(); list.replaceChildren();
  const winners = board.leaders.filter(r => r.rank && r.rank <= 3);
  podium.classList.toggle('stars-podium--three', winners.length === 3 && winners.every((r, i) => r.rank === i + 1));
  for (const row of winners) podium.append(rowView(row, true));
  for (const row of board.leaders.filter(r => !r.rank || r.rank > 3)) list.append(rowView(row, false));
  const pinned = el('stars-own'); pinned.replaceChildren(); pinned.hidden = !board.own || board.leaders.some(r => r.is_self);
  if (!pinned.hidden && board.own) { pinned.append(node('p', 'stars-kicker', 'CON Ở ĐÂY')); pinned.append(rowView(board.own, true)); }
  el('stars-start').textContent = data.starts_at ? 'Thành tích được ghi nhận từ ' + new Date(data.starts_at).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + '.' : '';
}
async function load() {
  el('stars-retry').hidden = true; el('stars-status').hidden = false; el('stars-status').textContent = 'Đang mở bảng thành tích…';
  el('stars-panel').hidden = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const params = new URLSearchParams(location.search); let code = params.get('code') || '';
    if (params.has('t')) {
      const response = await fetch('/api/r2l-link?token=' + encodeURIComponent(params.get('t') || ''), { signal: controller.signal });
      const identity = await response.json(); if (!response.ok || !identity.access_code) throw Error('Link này chưa mở được. Ba mẹ nhắn Coach Felix nhé.'); code = identity.access_code;
    } else if (!params.has('code')) { try { code = sessionStorage.getItem('r2l_access_code') || ''; } catch { /* optional */ } }
    if (params.has('code') && !code) throw Error('Mở link riêng của con để xem thành tích nhé.');
    if (code) (el('stars-home') as HTMLAnchorElement).href = '/read2lead?code=' + encodeURIComponent(code);
    const response = await fetch('/api/read2lead-leaderboard' + (code ? '?code=' + encodeURIComponent(code) : ''), { signal: controller.signal });
    const result = await response.json(); if (!response.ok || !result.ok) throw Error(result.message || 'Chưa mở được bảng thành tích. Con thử lại nhé.');
    data = result; render();
  } catch (error) {
    el('stars-status').textContent = error instanceof Error && error.name !== 'AbortError' && !(error instanceof TypeError) ? error.message : 'Kết nối đang chậm hoặc bị gián đoạn. Con thử lại nhé.';
    el('stars-retry').hidden = false;
  } finally { clearTimeout(timer); }
}
for (const metric of ['reading', 'diamonds'] as Metric[]) {
  const tab = el(metric + '-tab');
  tab.addEventListener('click', () => { selected = metric; render(); });
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); selected = event.key === 'Home' ? 'reading' : event.key === 'End' ? 'diamonds' : selected === 'reading' ? 'diamonds' : 'reading'; render(); el(selected + '-tab').focus(); } });
}
el('stars-retry').addEventListener('click', load);
void load();
