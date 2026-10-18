// Shared rankings renderer: the kid home card and the public (logged-out) card use this one path.
import { renderMonster } from './monster-avatar';

export type RankRow = { rank: number | null; display_name: string; total: number; is_self: boolean; avatar?: { monster?: any } };
const MEDALS = ['🥇', '🥈', '🥉'];
const number = (value: unknown) => new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0));

// Returns how many rows were drawn. `emptyText` null = leave the list empty (the caller hides the card).
export function rankList(target: HTMLElement, rows: RankRow[], unit: string, emptyText: string | null = 'Chưa có bạn nào. Con đọc truyện để lên bảng nhé!'): number {
  target.replaceChildren();
  if (!rows.length) {
    if (emptyText) { const empty = document.createElement('span'); empty.className = 'reading-home__rank-empty'; empty.textContent = emptyText; target.append(empty); }
    return 0;
  }
  for (const row of rows) {
    const item = document.createElement('span'); item.className = 'reading-home__rank-row' + (row.is_self ? ' is-self' : '');
    const medal = document.createElement('span'); medal.className = 'reading-home__rank-medal'; medal.textContent = MEDALS[(row.rank || 1) - 1] || '#' + row.rank;
    const face = document.createElement('span'); face.className = 'reading-home__rank-face';
    if (row.avatar?.monster && Object.keys(row.avatar.monster).length) { const holder = document.createElement('div'); face.append(holder); try { renderMonster(holder, row.avatar.monster, { size: 'small', animate: false, withCosmetics: true, compactCosmetics: true }); } catch { face.textContent = '📖'; } } else face.textContent = '📖';
    const name = document.createElement('span'); name.className = 'reading-home__rank-name'; name.textContent = row.display_name;
    const value = document.createElement('span'); value.className = 'reading-home__rank-value'; value.textContent = number(row.total) + unit;
    item.append(medal, face, name, value); target.append(item);
  }
  return rows.length;
}

// Draws top 3 XP + diamonds from a /api/read2lead-leaderboard payload. Returns the drawn row count.
export function renderBoards(boards: any, xpTarget: HTMLElement, diamondTarget: HTMLElement, emptyText?: string | null): number {
  const b = boards || {};
  return rankList(xpTarget, (b.xp?.leaders || []).slice(0, 3), '', emptyText) + rankList(diamondTarget, (b.diamonds?.leaders || []).slice(0, 3), '', emptyText);
}
