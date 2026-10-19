// Reads the child's saved state (read-only, same endpoint the home uses) for the reward screen and the
// rank-up modal: the REAL companion drawing and the REAL rank ladder (stars). Failure is silent: the caller
// keeps whatever fallback it already shows. Never invents a number.
import { renderMonster } from './monster-avatar';

function rememberedCode(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('code');
    if (fromUrl) return fromUrl.trim();
  } catch { /* ignore */ }
  try { return sessionStorage.getItem('r2l_access_code') || ''; } catch { return ''; }
}

export type RankLadderProgress = { stars: number; perDivision: number; nextLabel: string; apex: boolean };

export async function loadChildState(code = rememberedCode()): Promise<Record<string, any> | null> {
  if (!code) return null;
  try {
    const response = await fetch('/api/read2lead-progress?code=' + encodeURIComponent(code), { credentials: 'same-origin' });
    if (!response.ok) return null;
    return (await response.json())?.read2lead_state || null;
  } catch { return null; }
}

/** stars / stars_per_division / next_label_vi from rank_ladder, or null when the ladder does not say. */
export function ladderProgress(state: Record<string, any> | null): RankLadderProgress | null {
  const ladder = state?.rank_ladder;
  const perDivision = Number(ladder?.stars_per_division) || 0;
  if (!ladder || !perDivision) return null;
  return { stars: Math.max(0, Math.min(perDivision, Number(ladder.stars) || 0)), perDivision, nextLabel: String(ladder.next_label_vi || ''), apex: ladder.is_apex === true };
}

export function drawChildAvatar(holder: HTMLElement, state: Record<string, any> | null): boolean {
  const monster = state?.avatar?.monster;
  if (!holder || !monster) return false;
  try {
    const child = document.createElement('div');
    holder.replaceChildren(child);
    // The design's r2l-m-* class on the holder does the moving, so the renderer's own float stays off.
    renderMonster(child, monster, { size: 'large', animate: false, withCosmetics: true, equipped: state?.equipped, equippedDisplay: state?.equipped_display });
    child.style.width = '100%'; child.style.height = '100%'; child.style.transform = 'scale(.62)';
    return true;
  } catch { return false; }
}

export async function mountChildAvatar(holder: HTMLElement, code = rememberedCode()): Promise<boolean> {
  return drawChildAvatar(holder, await loadChildState(code));
}
