import { renderMonster, type MonsterConfig } from '../lib/monster-avatar';
type Metric = 'xp' | 'diamonds';
type Row = { rank: number | null; display_name: string; total: number; is_self: boolean; avatar?: { monster?: MonsterConfig } };
type Data = { boards: Record<Metric, { leaders: Row[]; own: Row | null; participants: number }> };
const el = (id: string) => document.getElementById(id)!;
let data: Data | null = null, selected: Metric = 'xp';
const format = (n: number) => n.toLocaleString('vi-VN');
function node(tag: string, className: string, text?: string) {
  const item = document.createElement(tag); item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
const CROWN = '<svg aria-hidden="true" viewBox="0 0 24 24" width="100%" height="100%"><path d="M3 19l-1.2-11 5.2 4L12 4l5 8 5.2-4L21 19z" fill="#fff" stroke="#17324D" stroke-width="2" stroke-linejoin="round"/></svg>';
const unit = () => (selected === 'xp' ? ' XP' : ' 💎');
function portraitView(row: Row, className: string, size: 'large' | 'small') {
  const portrait = node('div', className);
  if (row.avatar?.monster) { const monster = node('div', ''); portrait.append(monster); renderMonster(monster, row.avatar.monster, { size, animate: false, withCosmetics: true, compactCosmetics: true }); }
  else portrait.textContent = '📖';
  return portrait;
}
function selfTag() { return node('span', 'r2l-tag r2l-tag-ink lb-self', 'Con đây!'); }
/* One podium column: crown (#1 only), avatar, name, then the coloured step with rank + total. */
function podiumView(row: Row) {
  const rank = row.rank || 0;
  const col = node('article', `lb-pcol lb-pcol--${rank}${row.is_self ? ' is-self' : ''}`);
  col.dataset.rank = String(rank);
  if (rank === 1) { const crown = node('span', 'lb-crown'); crown.innerHTML = CROWN; col.append(crown); }
  const portrait = portraitView(row, 'stars-portrait lb-pav' + (rank === 1 ? ' r2l-m-bob' : ''), 'large');
  if (rank === 1) portrait.dataset.design = 'lb.podium1.monster';
  const name = node('span', 'stars-name', row.display_name);
  const step = node('div', 'lb-step');
  step.append(node('b', 'r2l-d lb-step-rank', rank ? '#' + rank : '☆'), node('span', 'lb-step-total', format(row.total) + unit()));
  col.append(portrait, name);
  if (row.is_self) col.append(selfTag());
  col.append(step);
  return col;
}
function rowView(row: Row, zebra: boolean) {
  const rank = row.rank || 0;
  const item = node('li', `stars-card stars-row${zebra ? ' is-zebra' : ''}${row.is_self ? ' is-self r2l-m-pop' : ''}`);
  item.dataset.rank = String(rank);
  const portrait = portraitView(row, 'stars-portrait' + (row.is_self ? ' r2l-m-bob' : ''), 'small');
  const who = node('div', 'lb-who'); who.append(node('span', 'stars-name', row.display_name)); if (row.is_self) who.append(selfTag());
  item.append(node('b', 'r2l-d lb-rk', rank ? '#' + rank : '☆'), portrait, who, node('span', 'stars-total', format(row.total) + unit()));
  return item;
}
function render() {
  if (!data) return;
  const board = data.boards[selected];
  for (const metric of ['xp', 'diamonds'] as Metric[]) {
    const tab = el(metric + '-tab'); tab.setAttribute('aria-selected', String(metric === selected)); tab.tabIndex = metric === selected ? 0 : -1; tab.classList.toggle('r2l-tab-on', metric === selected);
  }
  el('stars-panel').setAttribute('aria-labelledby', selected + '-tab');
  const own = board.own;
  el('stars-personal').hidden = !own;
  el('stars-personal').textContent = own && own.rank ? `Con đang hạng #${own.rank} với ${format(own.total)}${selected === 'xp' ? ' XP' : ' 💎'}. Cố lên con nhé!` : 'Một câu chuyện đầu tiên đang chờ con. Đọc xong là con có tên trên bảng ngay!';
  el('stars-status').hidden = board.leaders.length > 0;
  el('stars-status').textContent = 'Chưa có bạn nào trên bảng này. Con đọc một truyện để là người đầu tiên nhé!';
  el('stars-panel').hidden = false;
  const podium = el('stars-podium'), list = el('stars-list'); podium.replaceChildren(); list.replaceChildren();
  const winners = board.leaders.filter(r => r.rank && r.rank <= 3);
  const three = winners.length === 3 && winners.every((r, i) => r.rank === i + 1);
  podium.classList.toggle('stars-podium--three', three);
  const ordered = three ? [winners[1], winners[0], winners[2]] : winners;
  for (const row of ordered) podium.append(podiumView(row));
  podium.hidden = winners.length === 0;
  board.leaders.filter(r => !r.rank || r.rank > 3).forEach((row, i) => list.append(rowView(row, i % 2 === 1)));
  const pinned = el('stars-own'); pinned.replaceChildren(); pinned.hidden = !board.own || board.leaders.some(r => r.is_self);
  if (!pinned.hidden && board.own) { const ol = node('ol', 'stars-list'); ol.append(rowView(board.own, false)); pinned.append(node('span', 'r2l-lab lb-pinned', 'Con ở đây'), ol); }
  // no rows below the podium (<=3 children, or a tie that fills it): hide the empty white card
  (list.closest('.stars-listcard') as HTMLElement).hidden = list.children.length === 0 && pinned.hidden;
}
async function load() {
  el('stars-retry').hidden = true; el('stars-status').hidden = false; el('stars-status').textContent = 'Đang mở bảng xếp hạng…';
  el('stars-panel').hidden = true; el('stars-podium').hidden = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const params = new URLSearchParams(location.search); let code = params.get('code') || '';
    if (params.has('t')) {
      const response = await fetch('/api/r2l-link?token=' + encodeURIComponent(params.get('t') || ''), { signal: controller.signal });
      const identity = await response.json(); if (!response.ok || !identity.access_code) throw Error('Link này chưa mở được. Ba mẹ nhắn Coach Felix nhé.'); code = identity.access_code;
    } else if (!params.has('code')) { try { code = sessionStorage.getItem('r2l_access_code') || ''; } catch { /* optional */ } }
    if (params.has('code') && !code) throw Error('Mở link riêng của con để xem bảng xếp hạng nhé.');
    if (code) { const home = '/read2lead?code=' + encodeURIComponent(code); (el('stars-home') as HTMLAnchorElement).href = home; (el('stars-cta') as HTMLAnchorElement).href = home; }
    const response = await fetch('/api/read2lead-leaderboard' + (code ? '?code=' + encodeURIComponent(code) : ''), { signal: controller.signal });
    const result = await response.json(); if (!response.ok || !result.ok) throw Error(result.message || 'Chưa mở được bảng thành tích. Con thử lại nhé.');
    data = result; render();
  } catch (error) {
    el('stars-status').textContent = error instanceof Error && error.name !== 'AbortError' && !(error instanceof TypeError) ? error.message : 'Kết nối đang chậm hoặc bị gián đoạn. Con thử lại nhé.';
    el('stars-retry').hidden = false;
  } finally { clearTimeout(timer); }
}
for (const metric of ['xp', 'diamonds'] as Metric[]) {
  const tab = el(metric + '-tab');
  tab.addEventListener('click', () => { selected = metric; render(); });
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); selected = event.key === 'Home' ? 'xp' : event.key === 'End' ? 'diamonds' : selected === 'xp' ? 'diamonds' : 'xp'; render(); el(selected + '-tab').focus(); } });
}
el('stars-retry').addEventListener('click', load);
void load();
