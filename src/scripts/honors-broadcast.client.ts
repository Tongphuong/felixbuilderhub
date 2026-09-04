/**
 * Season Honors broadcast popup — client logic.
 *
 * A one-time, site-wide celebration for the frozen "Amazing Summer" season:
 * top-3 podium + a group thank-you. Reads ONLY the public
 * /api/read2lead-honors endpoint (functions/api/read2lead-honors.js) —
 * NEVER /api/read2lead-leaderboard (5-minute cached; the page announcing the
 * winners must not risk showing stale numbers).
 *
 * Ten of thirteen participants did NOT place, and every one of them sees
 * this popup. It shows ZERO personalization and must never reveal a
 * viewer's own rank or position — only the public podium (already public on
 * /read2lead/leaderboard) and a group thank-you. See the packet "Season
 * Honors celebration UI" for the founder-approved copy this mirrors.
 *
 * Gate order (cheapest first — the goal is zero work on ~99% of loads):
 *   1. localStorage 'seen' flag for this season   -> bail
 *   2. navigator.connection.saveData               -> bail
 *   3. surface check (kid/parent R2L pages only)   -> bail
 *   4. fetch; published !== true                   -> bail silently
 * Only after all four pass do we open the dialog and fire confetti.
 */
import { fireRankUpConfetti } from '../lib/rank-up-celebration';

// Hardcoded to match functions/api/_read2lead-honors.js's HONORS_KV_KEY
// ('honors:2026-S1') — this is a one-off broadcast for the single frozen
// "Amazing Summer" season, not a general recurring mechanism. Update by
// hand alongside that constant if a future season ships the same way.
const SEASON_ID = '2026-S1';
const SEEN_KEY = `r2l_honors_seen:${SEASON_ID}`;

interface HonorsSeason {
  id: string | null;
  name_vi: string | null;
  emoji: string | null;
  window: { from: string; to: string } | null;
}

interface HonorsPodiumRow {
  student_name: string;
  masked_code: string;
  rank: number | null;
  prize_diamonds: number | null;
  completed_books: number;
  completed_packs: number;
  pronunciation_percent: number | null;
}

interface HonorsPayload {
  ok: boolean;
  published: boolean;
  season?: HonorsSeason;
  frozen_at?: string | null;
  podium?: HonorsPodiumRow[];
  participants_count?: number;
}

let bound = false;

function hasSeenAlready(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Safari private mode (or storage disabled) throws on access. Fail
    // open — the popup is allowed to show rather than silently vanish for
    // every visitor in private browsing.
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* Safari private mode — nothing we can persist, nothing to crash on. */
  }
}

function prefersReducedData(): boolean {
  const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

/**
 * Kid/parent R2L surface only — a stranger landing on the marketing
 * homepage or the coaching booking page must never get a full-screen
 * popup about children they don't know (founder's explicit call).
 */
function onEligibleSurface(): boolean {
  const { pathname, search } = window.location;
  if (
    pathname.startsWith('/read2lead')
    || pathname.startsWith('/ho-so')
    || pathname.startsWith('/r2l')
  ) {
    return true;
  }
  if (new URLSearchParams(search).has('code')) return true;
  try {
    // Same key r2l-start.client.ts writes and ho-so.ts reads — a visitor
    // who has ever entered their access code this session counts as "on
    // the R2L surface" even from an unprefixed path.
    if (sessionStorage.getItem('r2l_access_code')) return true;
  } catch {
    /* Safari private mode */
  }
  return false;
}

function shouldAttempt(): boolean {
  if (hasSeenAlready()) return false;
  if (prefersReducedData()) return false;
  if (!onEligibleSurface()) return false;
  return true;
}

function scheduleIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(fn, { timeout: 4000 });
  } else {
    // Safari has no requestIdleCallback — a short timeout still keeps this
    // off the critical render path.
    window.setTimeout(fn, 1);
  }
}

async function loadAndMaybeShow(): Promise<void> {
  let data: HonorsPayload | null = null;
  try {
    const res = await fetch('/api/read2lead-honors');
    const body = (await res.json()) as HonorsPayload;
    if (res.ok && body?.ok) data = body;
  } catch {
    return; // network hiccup — bail silently, never surface an error to a kid
  }
  if (!data || data.published !== true) return;
  if (!Array.isArray(data.podium) || data.podium.length === 0) return;
  renderAndOpen(data);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderAndOpen(data: HonorsPayload): void {
  const dialog = document.getElementById('honors-broadcast');
  const seasonEl = document.getElementById('honors-broadcast-season');
  const titleEl = document.getElementById('honors-broadcast-title');
  const podiumEl = document.getElementById('honors-broadcast-podium');
  if (!(dialog instanceof HTMLDialogElement) || !seasonEl || !titleEl || !podiumEl) return;

  const season = data.season || { id: null, name_vi: null, emoji: null, window: null };
  const emoji = season.emoji || '🌞';
  const nameVi = season.name_vi || 'mùa này';

  seasonEl.textContent = `${emoji} ${nameVi}`;
  titleEl.textContent = `Mùa ${nameVi} ${emoji} đã khép lại!`;

  const podium = [...(data.podium || [])]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 3);
  podiumEl.innerHTML = podium
    .map((row, index) => `<span>${MEDALS[index] || '🏅'} ${escapeHtml(row.student_name || '—')}</span>`)
    .join('<span aria-hidden="true"> · </span>');

  bindDialogOnce(dialog);
  dialog.showModal();
  void fireRankUpConfetti(undefined, true);
}

function bindDialogOnce(dialog: HTMLDialogElement): void {
  if (bound) return;
  bound = true;

  // Covers Escape (native 'cancel' -> 'close'), the "Đóng" button below,
  // and the backdrop click below — one listener, every dismissal path,
  // per the packet: "Write it on any dismissal."
  dialog.addEventListener('close', markSeen);

  // Native <dialog> does not close on backdrop click by itself. Same idiom
  // as RankUpModal's closeRankUpModal: a click whose target IS the dialog
  // element (not a descendant) landed on the backdrop, not the card.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.getElementById('honors-broadcast-close')?.addEventListener('click', () => dialog.close());

  // Click-through to the honour page is also a dismissal (spec: "Write it
  // on any dismissal ... click-through") — mark seen synchronously so the
  // write lands before the page navigates away.
  document.getElementById('honors-broadcast-view')?.addEventListener('click', markSeen);
}

if (shouldAttempt()) {
  scheduleIdle(() => {
    void loadAndMaybeShow();
  });
}
