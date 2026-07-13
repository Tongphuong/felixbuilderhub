/** Shared Read2Lead "what does this child see first" logic.
 *
 * These four helpers used to live privately inside `ho-so/ho-so-kid-view.ts`. The student
 * home hub (`/r2l/start`) needs the exact same rules — which book is open, how far through
 * it the child is, what their rank looks like, what their pet looks like — so they were
 * extracted here rather than copied.
 *
 * `buildHeroCta()` in particular decides whether a child is invited to CONTINUE their open
 * book or to CREATE a new one. That decision drives the biggest thing on both screens, so it
 * must have exactly one definition. (The design handoff shipped a trimmed copy of it; that
 * copy was deliberately not used.)
 */
import type { ProgressPayload } from '../pages/ho-so/ho-so';

// ── Pack status ──────────────────────────────────────────────────────────────────────

/** Where the child is inside the current pack: step 0-3, plus a Vietnamese label. */
export function statusMeta(state: string, pack: Record<string, unknown> | null | undefined) {
  if (!pack) return { label: 'Chưa có bài', completed: false, step: 0 };
  if (state === 'generation_in_progress' || pack.status === 'generation_in_progress')
    return { label: 'Đang tạo', completed: false, step: 0 };
  if (
    state === 'reviewed' ||
    pack.status === 'reviewed_pass' ||
    pack.status === 'reviewed_pass_web' ||
    pack.status === 'reviewed_pass_web_v2'
  ) return { label: 'Đã xong', completed: true, step: 3 };
  const steps = (pack.web_lesson_steps as Record<string, unknown>) || {};
  if (steps.read_completed_at) return { label: 'Làm bài', completed: false, step: 2 };
  if (steps.listen_completed_at) return { label: 'Đang nghe', completed: false, step: 1 };
  return { label: 'Sẵn sàng', completed: false, step: 1 };
}

/** Continue the open book, create a new one, or wait for one being generated. */
export function buildHeroCta(
  pack: Record<string, unknown> | null | undefined,
  data: ProgressPayload,
  code: string,
) {
  const encoded = encodeURIComponent(code);
  if (!pack) return { label: 'Tạo bài đọc mới ✨', action: 'create' as const, href: null };
  if (data.state === 'generation_in_progress' || pack.status === 'generation_in_progress')
    return { label: 'Minny đang chuẩn bị...', action: 'wait' as const, href: null };
  if (
    data.state === 'reviewed' ||
    pack.status === 'reviewed_pass' ||
    pack.status === 'reviewed_pass_web' ||
    pack.status === 'reviewed_pass_web_v2'
  ) return { label: 'Tạo bài đọc mới ✨', action: 'create' as const, href: null };
  return {
    label: 'Đọc tiếp 📖',
    action: 'lesson' as const,
    href: `/read2lead/lesson?code=${encoded}&pack_id=${encodeURIComponent(String(pack.pack_id || ''))}`,
  };
}

// ── Rank ─────────────────────────────────────────────────────────────────────────────

/** tier_index → [Vietnamese name, CSS colour var, medal slug]. */
export const PROFILE_TIERS = [
  ['Đồng', 'var(--rank-bronze)', 'bronze'],
  ['Bạc', 'var(--rank-silver)', 'silver'],
  ['Vàng', 'var(--rank-gold)', 'gold'],
  ['Bạch Kim', 'var(--rank-silver)', 'silver'],
  ['Kim Cương', 'var(--rank-diamond)', 'diamond'],
  ['Tinh Anh', 'var(--rank-legend)', 'legend'],
  ['Cao Thủ', 'var(--rank-legend)', 'legend'],
  ['Thách Đấu', 'var(--rank-legend)', 'legend'],
] as const;

const MEDAL_BY_SLUG: Record<string, string> = {
  bronze: '/assets/r2l/ranks/rank-l1-bronze.svg',
  silver: '/assets/r2l/ranks/rank-l2-silver.svg',
  gold: '/assets/r2l/ranks/rank-l3-gold.svg',
  diamond: '/assets/r2l/ranks/rank-l4-diamond.svg',
  legend: '/assets/r2l/ranks/rank-l5-legend.svg',
};

/** The rank medal SVG that sits on the pet's shoulder. Defaults to bronze. */
export function medalFor(tierIndex: unknown): string {
  const i = Number(tierIndex);
  const tier = PROFILE_TIERS[Number.isFinite(i) ? Math.max(0, Math.min(PROFILE_TIERS.length - 1, i)) : 0];
  return MEDAL_BY_SLUG[tier[2]] ?? MEDAL_BY_SLUG.bronze;
}

// ── Book progress ────────────────────────────────────────────────────────────────────

/** The API gives a step (0-3), not a percentage — the progress bar needs one. */
export function bookPct(step: number): number {
  const s = Math.max(0, Math.min(3, Number(step) || 0));
  return Math.round((s / 3) * 100);
}

// ── Pet ──────────────────────────────────────────────────────────────────────────────

/** Fallback pet, for a child who has not customised a monster yet. */
export function defaultMonsterSvg() {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="hs-glow"><stop offset="0%" stop-color="#c89bff" stop-opacity=".45"/><stop offset="100%" stop-color="#c89bff" stop-opacity="0"/></radialGradient><linearGradient id="hs-body" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b08af0"/><stop offset="100%" stop-color="#7558c7"/></linearGradient></defs><circle cx="60" cy="64" r="46" fill="url(#hs-glow)"/><line x1="48" y1="42" x2="42" y2="22" stroke="#7558c7" stroke-width="3"/><circle cx="42" cy="20" r="3.5" fill="#f2cc7e"/><line x1="72" y1="42" x2="78" y2="22" stroke="#7558c7" stroke-width="3"/><circle cx="78" cy="20" r="3.5" fill="#f2cc7e"/><path d="M28 72Q28 38 60 38T92 72Q92 100 60 100T28 72Z" fill="url(#hs-body)"/><ellipse cx="60" cy="82" rx="20" ry="12" fill="#d6c1f7" opacity=".5"/><circle cx="48" cy="64" r="10" fill="#fff"/><circle cx="72" cy="64" r="10" fill="#fff"/><circle cx="50" cy="66" r="4.5" fill="#10273a"/><circle cx="74" cy="66" r="4.5" fill="#10273a"/><path d="M50 80Q60 88 70 80" stroke="#10273a" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
}
