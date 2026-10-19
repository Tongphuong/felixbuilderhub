// Draws the child's REAL saved companion (never a stand-in picture) into a holder element.
// Used by the reward screen and the rank-up modal. Reads the same progress endpoint the home uses.
// Failure is silent: the holder keeps whatever fallback it already contains.
import { renderMonster } from './monster-avatar';

function rememberedCode(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('code');
    if (fromUrl) return fromUrl.trim();
  } catch { /* ignore */ }
  try { return sessionStorage.getItem('r2l_access_code') || ''; } catch { return ''; }
}

export async function mountChildAvatar(holder: HTMLElement, code = rememberedCode()): Promise<boolean> {
  if (!holder || !code) return false;
  try {
    const response = await fetch('/api/read2lead-progress?code=' + encodeURIComponent(code), { credentials: 'same-origin' });
    if (!response.ok) return false;
    const state = (await response.json())?.read2lead_state || {};
    const monster = state.avatar?.monster;
    if (!monster) return false;
    const child = document.createElement('div');
    holder.replaceChildren(child);
    // The design's r2l-m-* class on the holder does the moving, so the renderer's own float stays off.
    renderMonster(child, monster, { size: 'large', animate: false, withCosmetics: true, equipped: state.equipped, equippedDisplay: state.equipped_display });
    child.style.width = '100%'; child.style.height = '100%'; child.style.transform = 'scale(.78)';
    return true;
  } catch { return false; }
}
