/**
 * Kid view renderer for the unified profile page.
 * Extracted and adapted from the old hoc-sinh page (now deleted).
 */
import type { ProgressPayload } from './ho-so';
import { escapeHtml, firstName, qs } from './ho-so';

import { isV3Enabled } from '../../config/flags';
import { renderEggHtml } from '../../lib/egg-renderer';
import { renderGiftGoalCard, type GiftGoalItem, type GiftGoalRedemption } from '../../lib/gift-goal-card';
import { renderMonster, type EquippedDisplayItem } from '../../lib/monster-avatar';
import { monsterBuilderHtml, mountMonsterBuilder } from '../../lib/monster-builder';
import { showRankUpModal } from '../../lib/rank-up-celebration';
import { kidToast } from '../../scripts/r2l-kid-toast';
import { renderQuestPath, type QuestNode } from '../../scripts/r2l-quest-path';
import { isSeasonPayload, type SeasonPayload } from '../../components/read2lead/v3/rank/season-rank-ui';
import { HUB_TOPICS } from '../ho-so/ho-so-topics';

// ── Constants ──

const GEN_STORAGE_PREFIX = 'r2l_hub_gen_v1:';
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 5000;

const WAIT_STAGES = [
  'Minny đang chuẩn bị bài đọc cho con...',
  'Đang chuẩn bị phần nghe hay ho...',
  'Đang làm bài tập thú vị...',
  'Sắp xong rồi — Minny mở cửa nhé!',
];

const GREETINGS = [
  (name: string) => `Chào ${name}! Minny đồng hành cùng con hôm nay nhé.`,
  (name: string) => `${name} ơi, hôm nay con khám phá truyện gì nào?`,
  (name: string) => `Hey ${name}! Minny sẵn sàng cùng con luyện đọc.`,
];

// ── State ──

let currentAccessCode = '';
let dashboardData: ProgressPayload | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollAttempts = 0;
let pollInFlight = false;
let activeTaskId: string | null = null;
let generationComplete = false;
let waitStageIndex = 0;
let waitStageTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ──

function greetingLine(name: string) {
  const idx = new Date().getDate() % GREETINGS.length;
  return GREETINGS[idx](firstName(name));
}

function savePendingGeneration(code: string, taskId: string, topic: string) {
  try {
    sessionStorage.setItem(
      GEN_STORAGE_PREFIX + code,
      JSON.stringify({ taskId, topic, at: Date.now() }),
    );
  } catch { /* ignore */ }
}

function loadPendingGeneration(code: string): { taskId: string; topic?: string } | null {
  try {
    const raw = sessionStorage.getItem(GEN_STORAGE_PREFIX + code);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.taskId ? parsed : null;
  } catch { return null; }
}

function clearPendingGeneration(code: string) {
  try { sessionStorage.removeItem(GEN_STORAGE_PREFIX + code); } catch { /* ignore */ }
}

// ── Pack status ──

function statusMeta(state: string, pack: Record<string, unknown> | null | undefined) {
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

function buildHeroCta(
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

function missionNodes(pack: Record<string, unknown> | null | undefined, data: ProgressPayload): QuestNode[] {
  if (!pack) {
    return [
      { icon: '✨', label: 'Chọn chủ đề', state: 'current' },
      { icon: '📖', label: 'Đọc truyện', state: 'locked' },
      { icon: '🎯', label: 'Làm bài', state: 'locked' },
    ];
  }
  const step = statusMeta(data.state || '', pack).step;
  return [
    { icon: '✨', label: 'Chọn chủ đề', state: 'done' },
    { icon: '📖', label: 'Đọc truyện', state: step > 1 ? 'done' : step === 1 ? 'current' : 'locked' },
    { icon: '🎯', label: 'Làm bài', state: step > 2 ? 'done' : step === 2 ? 'current' : 'locked' },
  ];
}

function waitQuestNodes(stageIndex: number): QuestNode[] {
  return [
    { icon: '📚', label: 'Chọn truyện', state: stageIndex > 0 ? 'done' : 'current' },
    { icon: '🎧', label: 'Chuẩn bị', state: stageIndex > 1 ? 'done' : stageIndex === 1 ? 'current' : 'locked' },
    { icon: '🚀', label: 'Mở bài', state: stageIndex > 2 ? 'done' : stageIndex === 2 ? 'current' : 'locked' },
  ];
}

function nearMissLine(read2LeadState: Record<string, unknown>) {
  const ladder = read2LeadState.rank_ladder as Record<string, unknown> | undefined;
  if (ladder && !ladder.is_apex && typeof ladder.stars_to_next === 'number' && ladder.stars_to_next > 0)
    return `Còn ${ladder.stars_to_next} sao nữa lên ${ladder.next_label_vi || 'hạng mới'}!`;
  const packsUntil = read2LeadState.packs_until_level_up;
  if (typeof packsUntil === 'number' && packsUntil > 0 && packsUntil <= 2)
    return `Còn ${packsUntil} truyện nữa lên cấp tiếp!`;
  const streak = Number(read2LeadState.streak_days || 0);
  if (streak >= 3 && streak < 7) return `🔥 ${streak} ngày rồi — cố thêm chút nữa nhé!`;
  return '';
}

// ── Daily quests ──

type W2QuestRow = {
  id: string; label_vi: string; target: number; progress: number;
  reward_coins: number; reward_rp: number; claimed: boolean; complete: boolean;
};

function renderW2DailyQuestsHtml(state: Record<string, unknown>): string {
  const view = state?.daily_quests_view as { quests?: W2QuestRow[] } | undefined;
  const quests = Array.isArray(view?.quests) ? view!.quests! : [];
  if (quests.length === 0) return '';
  const cards = quests.map((q) => {
    const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
    const action = q.claimed
      ? '<span class="r2l-w2-quest-done">✓ Đã nhận</span>'
      : q.complete
        ? `<button type="button" class="r2l-w2-quest-claim" data-w2-quest-claim="${escapeHtml(q.id)}">Nhận thưởng</button>`
        : '<span class="r2l-w2-quest-progress-label">' + escapeHtml(`${q.progress}/${q.target}`) + '</span>';
    return `
      <article class="r2l-w2-quest-card" data-complete="${q.complete}" data-claimed="${q.claimed}">
        <p class="r2l-w2-quest-label">${escapeHtml(q.label_vi)}</p>
        <div class="r2l-w2-quest-bar"><div class="r2l-w2-quest-bar-fill" style="width:${pct}%"></div></div>
        <div class="r2l-w2-quest-foot">
          <span class="r2l-w2-quest-reward">🪙 +${q.reward_coins}${q.reward_rp > 0 ? ` · ⭐ +${q.reward_rp}` : ''}</span>
          ${action}
        </div>
      </article>`;
  }).join('');
  return `
    <section class="r2l-w2-quests">
      <p class="text-xs font-extrabold uppercase tracking-wide text-[var(--r2l-ink-soft)]">Thử thách hôm nay</p>
      <div class="r2l-w2-quests-grid">${cards}</div>
    </section>`;
}

function renderW2DailyChestHtml(state: Record<string, unknown>): string {
  const chest = state?.daily_login_chest as { available?: boolean; coins?: number } | undefined;
  if (!chest) return '';
  if (chest.available) {
    return `
      <button type="button" class="r2l-w2-daily-chest" data-w2-daily-chest>
        <span class="r2l-w2-daily-chest-icon" aria-hidden="true">🎁</span>
        <span>Quà hôm nay: +${Number(chest.coins) || 0} 🪙</span>
      </button>`;
  }
  return `
    <div class="r2l-w2-daily-chest r2l-w2-daily-chest--claimed" aria-disabled="true">
      <span aria-hidden="true">🎁</span>
      <span>Đã nhận hôm nay — quay lại mai nhé!</span>
    </div>`;
}

// ── Monster rendering ──

function renderHubMonster(slot: HTMLElement, state: Record<string, unknown>) {
  const avatar = state.avatar as { monster?: Parameters<typeof renderMonster>[1] } | undefined;
  if (!avatar?.monster) return;
  const monster = avatar.monster;
  const parts = state.monster_parts as Record<string, Array<{ id: string }>> | undefined;
  const renderConfig = monster.detail
    ? monster
    : { ...monster, detail: parts?.detail?.find((part) => part.id)?.id || 'default' };
  renderMonster(slot, renderConfig, {
    size: 'large',
    withCosmetics: true,
    equipped: state.equipped as Record<string, string>,
    equippedDisplay: state.equipped_display as EquippedDisplayItem[],
  });
  if (!monster.detail) {
    slot.querySelectorAll('[data-slot="detail"]').forEach((layer) => layer.remove());
  }
}

function showFirstHatchCeremony(accessCode: string) {
  const storageKey = `r2l-hatch-seen:${accessCode}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
    window.localStorage.setItem(storageKey, '1');
  } catch { /* Storage optional */ }

  const dialog = document.querySelector('.r2l-equip-ceremony') as HTMLDialogElement | null;
  if (!dialog) return;
  dialog.dataset.rarity = 'rare';
  const label = dialog.querySelector('.ceremony-label');
  if (label) label.textContent = '✨ Quái của con đã nở! ✨';
  if (dialog.open) dialog.close();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  try {
    const juiceWindow = window as Window & { __r2lJuice?: { playKenney?: (name: string) => unknown } };
    Promise.resolve(juiceWindow.__r2lJuice?.playKenney?.('quest-complete')).catch(() => {});
  } catch { /* Audio optional */ }
  window.setTimeout(() => {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }, 5000);
}

// ── Generation flow ──

function showError(message: string) {
  const el = qs('#ho-so-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showWaitScene() {
  const wait = qs('#ho-so-wait-scene');
  if (!wait) return;
  wait.classList.remove('hidden');
  waitStageIndex = 0;

  wait.innerHTML = `
    <div class="r2l-kid-card r2l-hub-wait">
      <button type="button" class="r2l-hub-minny" id="ho-so-minny-tap" aria-label="Minny">🐣</button>
      <p class="r2l-hub-wait-msg" id="ho-so-wait-msg">${escapeHtml(WAIT_STAGES[0])}</p>
      <ol class="r2l-kid-quest-path r2l-hub-wait-quest" data-ho-so-wait-path></ol>
      <a id="ho-so-read-now" href="#" class="r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--lg mt-4 hidden">Đọc ngay 🚀</a>
    </div>`;

  const pathEl = qs('[data-ho-so-wait-path]', wait);
  if (pathEl instanceof HTMLElement) renderQuestPath(pathEl, waitQuestNodes(0));

  if (waitStageTimer) clearInterval(waitStageTimer);
  waitStageTimer = setInterval(() => {
    waitStageIndex = Math.min(waitStageIndex + 1, WAIT_STAGES.length - 1);
    updateWaitUi();
  }, 15000);

  qs('#ho-so-minny-tap')?.addEventListener('click', () => {
    const minny = qs('#ho-so-minny-tap');
    minny?.classList.add('r2l-hub-minny--bounce');
    setTimeout(() => minny?.classList.remove('r2l-hub-minny--bounce'), 450);
  });
}

function updateWaitUi() {
  const msg = qs('#ho-so-wait-msg');
  if (msg) msg.textContent = WAIT_STAGES[waitStageIndex] || WAIT_STAGES[0];
  const pathEl = qs('[data-ho-so-wait-path]');
  if (pathEl instanceof HTMLElement) renderQuestPath(pathEl, waitQuestNodes(waitStageIndex));
}

function stopWaitScene() {
  if (waitStageTimer) { clearInterval(waitStageTimer); waitStageTimer = null; }
  qs('#ho-so-wait-scene')?.classList.add('hidden');
}

function showGenerationReady(lessonLink: string) {
  stopWaitScene();
  generationComplete = true;
  clearPendingGeneration(currentAccessCode);
  const wait = qs('#ho-so-wait-scene');
  if (!wait) return;
  wait.classList.remove('hidden');
  wait.innerHTML = `
    <div class="r2l-kid-card r2l-hub-wait">
      <p class="text-lg font-extrabold">Truyện sẵn sàng!</p>
      <p class="mt-2 text-sm r2l-kid-muted">Minny mở cửa cho con nhé.</p>
      <a href="${escapeHtml(lessonLink)}" class="r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--lg mt-4 inline-flex">Đọc ngay 🚀</a>
    </div>`;
}

async function pollGenerationStatus(accessCode: string, taskId: string) {
  if (generationComplete || activeTaskId !== taskId || pollInFlight) return;
  pollInFlight = true;
  try {
    const res = await fetch(
      `/api/check-generation-status?access_code=${encodeURIComponent(accessCode)}&task_id=${encodeURIComponent(taskId)}`,
    );
    const result = await res.json();
    if (generationComplete || activeTaskId !== taskId) return;
    if (result.status === 'pending') {
      pollAttempts += 1;
      if (pollAttempts >= MAX_POLL_ATTEMPTS) {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
        activeTaskId = null;
        showError('Tạo bài quá lâu. Vui lòng thử lại sau.');
        stopWaitScene();
      }
      return;
    }
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    activeTaskId = null;
    if (result.status === 'done' && result.lesson_link) {
      showGenerationReady(result.lesson_link);
    } else {
      clearPendingGeneration(accessCode);
      showError(result.message || result.error || 'Tạo bài thất bại.');
      stopWaitScene();
    }
  } catch {
    if (generationComplete || activeTaskId !== taskId) return;
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    activeTaskId = null;
    showError('Mất kết nối. Thử lại sau nhé.');
    stopWaitScene();
  } finally {
    pollInFlight = false;
  }
}

function resumePolling(accessCode: string, taskId: string) {
  if (pollInterval) clearInterval(pollInterval);
  generationComplete = false;
  pollAttempts = 0;
  activeTaskId = taskId;
  showWaitScene();
  void pollGenerationStatus(accessCode, taskId);
  pollInterval = setInterval(() => pollGenerationStatus(accessCode, taskId), POLL_INTERVAL_MS);
}

async function startGeneration(topic: string) {
  if (!currentAccessCode) return;
  const pack = (dashboardData?.progress as Record<string, unknown> | undefined)?.current_pack as
    Record<string, unknown> | undefined;
  const pending = loadPendingGeneration(currentAccessCode);
  const existingTask = (pack?.task_id as string) || (pack?.generation_task_id as string) || pending?.taskId || '';

  if (existingTask && (dashboardData?.state === 'generation_in_progress' || pack?.status === 'generation_in_progress')) {
    resumePolling(currentAccessCode, existingTask);
    return;
  }

  showWaitScene();
  generationComplete = false;
  pollAttempts = 0;

  try {
    const res = await fetch('/api/generate-read2lead-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: currentAccessCode, topic }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      showError(result.message || result.error || 'Không tạo được bài. Thử lại nhé.');
      stopWaitScene();
      return;
    }
    if (result.status === 'done' && result.lesson_link) {
      showGenerationReady(result.lesson_link);
      return;
    }
    if (!result.task_id) {
      showError('Chưa nhận phản hồi từ Minny. Thử lại nhé.');
      stopWaitScene();
      return;
    }
    savePendingGeneration(currentAccessCode, result.task_id, topic);
    activeTaskId = result.task_id;
    void pollGenerationStatus(currentAccessCode, result.task_id);
    pollInterval = setInterval(() => pollGenerationStatus(currentAccessCode, result.task_id), POLL_INTERVAL_MS);
  } catch {
    showError('Mạng không ổn. Thử lại sau ít phút nhé.');
    stopWaitScene();
  }
}

// ── Topic picker ──

function openCreateSheet() {
  const sheet = qs('#ho-so-create-sheet');
  if (!sheet) return;
  sheet.classList.remove('hidden');
  sheet.innerHTML = `
    <div class="r2l-hub-sheet-backdrop" data-hub-sheet-close>
      <div class="r2l-hub-sheet" role="dialog" aria-modal="true" aria-label="Chọn chủ đề">
        <h2 class="text-xl font-extrabold">Con thích chủ đề gì?</h2>
        <p class="mt-1 text-sm r2l-kid-muted">Chọn một thẻ chủ đề để bắt đầu.</p>
        <div class="r2l-hub-topic-grid">
          ${HUB_TOPICS.map(
            ([value, label, emoji]) => `
              <button type="button" class="r2l-hub-topic-card" data-hub-topic="${escapeHtml(value)}" aria-label="${escapeHtml(label)}">
                <span class="r2l-hub-topic-card__emoji" aria-hidden="true">${emoji}</span>
                <span class="r2l-hub-topic-card__label">${escapeHtml(label)}</span>
              </button>`,
          ).join('')}
        </div>
        <button type="button" class="r2l-kid-btn r2l-kid-btn--ghost r2l-kid-btn--md mt-4 w-full" data-hub-sheet-close>Đóng</button>
      </div>
    </div>`;

  sheet.querySelectorAll('[data-hub-topic]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const topic = btn.getAttribute('data-hub-topic') || '';
      if (!topic) return;
      sheet.classList.add('hidden');
      void startGeneration(topic);
    });
  });
  sheet.querySelector('.r2l-hub-sheet-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) sheet.classList.add('hidden');
  });
  sheet.querySelectorAll('[data-hub-sheet-close]').forEach((el) => {
    el.addEventListener('click', () => sheet.classList.add('hidden'));
  });
}

// ── W2 handlers ──

function wireW2Handlers(dash: HTMLElement, code: string) {
  dash.querySelectorAll<HTMLButtonElement>('[data-w2-quest-claim]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const questId = btn.dataset.w2QuestClaim;
      if (!questId) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/read2lead-quest-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, quest_id: questId }),
        });
        const data = await res.json();
        if (data.ok) btn.outerHTML = '<span class="r2l-w2-quest-done">✓ Đã nhận</span>';
        else btn.disabled = false;
      } catch { btn.disabled = false; }
    });
  });

  const dailyBtn = dash.querySelector<HTMLButtonElement>('[data-w2-daily-chest]');
  if (dailyBtn) {
    dailyBtn.addEventListener('click', async () => {
      dailyBtn.disabled = true;
      try {
        const res = await fetch('/api/read2lead-daily-chest-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (data.ok) {
          dailyBtn.outerHTML = '<div class="r2l-w2-daily-chest r2l-w2-daily-chest--claimed" aria-disabled="true"><span aria-hidden="true">🎁</span><span>Đã nhận hôm nay — quay lại mai nhé!</span></div>';
        } else dailyBtn.disabled = false;
      } catch { dailyBtn.disabled = false; }
    });
  }
}

// ── Redesigned dashboard rendering ──

const PROFILE_TIERS = [
  ['Đồng', 'var(--rank-bronze)', 'bronze'],
  ['Bạc', 'var(--rank-silver)', 'silver'],
  ['Vàng', 'var(--rank-gold)', 'gold'],
  ['Bạch Kim', 'var(--rank-silver)', 'silver'],
  ['Kim Cương', 'var(--rank-diamond)', 'diamond'],
  ['Tinh Anh', 'var(--rank-legend)', 'legend'],
  ['Cao Thủ', 'var(--rank-legend)', 'legend'],
  ['Thách Đấu', 'var(--rank-legend)', 'legend'],
] as const;

function defaultMonsterSvg() {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="hs-glow"><stop offset="0%" stop-color="#c89bff" stop-opacity=".45"/><stop offset="100%" stop-color="#c89bff" stop-opacity="0"/></radialGradient><linearGradient id="hs-body" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b08af0"/><stop offset="100%" stop-color="#7558c7"/></linearGradient></defs><circle cx="60" cy="64" r="46" fill="url(#hs-glow)"/><line x1="48" y1="42" x2="42" y2="22" stroke="#7558c7" stroke-width="3"/><circle cx="42" cy="20" r="3.5" fill="#f2cc7e"/><line x1="72" y1="42" x2="78" y2="22" stroke="#7558c7" stroke-width="3"/><circle cx="78" cy="20" r="3.5" fill="#f2cc7e"/><path d="M28 72Q28 38 60 38T92 72Q92 100 60 100T28 72Z" fill="url(#hs-body)"/><ellipse cx="60" cy="82" rx="20" ry="12" fill="#d6c1f7" opacity=".5"/><circle cx="48" cy="64" r="10" fill="#fff"/><circle cx="72" cy="64" r="10" fill="#fff"/><circle cx="50" cy="66" r="4.5" fill="#10273a"/><circle cx="74" cy="66" r="4.5" fill="#10273a"/><path d="M50 80Q60 88 70 80" stroke="#10273a" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
}

function renderSession(host: HTMLElement, name: string, code: string) {
  host.innerHTML = `<div class="ho-so-session"><div class="ho-so-session__identity"><span class="fx-eyebrow">Học sinh</span><span class="ho-so-session__name" data-clarity-mask="true">${escapeHtml(firstName(name))}</span><span class="ho-so-session__code" data-clarity-mask="true">${escapeHtml(code)}</span></div><div class="ho-so-session__actions"><button class="fx-btn fx-btn--ghost fx-btn--sm" type="button" data-ho-so-switch-role>Xem như phụ huynh</button><button class="fx-btn fx-btn--secondary fx-btn--sm" type="button" data-ho-so-change-code>Đổi mã</button></div></div>`;
}

function renderRankBoard(host: HTMLElement, state: Record<string, unknown>) {
  const ladder = (state.rank_ladder || {}) as Record<string, unknown>;
  const tierIndex = Math.max(0, Math.min(7, Number(ladder.tier_index) || 0));
  const stars = Number(ladder.stars || 0);
  const starsToNext = Number(ladder.stars_to_next || 0);
  const rankPoints = Number((state.season as Record<string, unknown> | undefined)?.rp || 0);
  const tierHtml = PROFILE_TIERS.map(([name, color], index) => {
    const current = index === tierIndex;
    const next = index === tierIndex + 1;
    const note = current ? 'Bạn đang ở đây' : next && starsToNext ? `còn ${starsToNext} sao` : index < tierIndex ? 'Đã qua' : 'Chưa mở';
    return `<div class="ho-so-tier" style="--tier-color:${color}" data-current="${current}" data-next="${next}"><span class="ho-so-tier__dot"></span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(note)}</small></div></div>`;
  }).join('');
  const progress = Number(ladder.stars_per_division) > 0 ? Math.round((stars / Number(ladder.stars_per_division)) * 100) : 0;
  host.innerHTML = `<div class="ho-so-card-head"><p class="fx-eyebrow ho-so-accent-eyebrow">Bậc hiện tại</p><small>${starsToNext ? `Còn ${starsToNext} sao đến ${escapeHtml(ladder.next_label_vi || 'bậc mới')}` : 'Đã ở đỉnh bảng hạng'}</small></div><div class="ho-so-rank-summary"><div class="ho-so-rank-orb">${stars || '★'}</div><div><h3>${escapeHtml(ladder.label_vi || PROFILE_TIERS[tierIndex][0])}</h3><p>${rankPoints} RP mùa này</p></div></div><span class="fx-progress" role="progressbar" aria-label="Tiến độ sao trong bậc" aria-valuenow="${Math.min(100, progress)}" aria-valuemin="0" aria-valuemax="100"><span class="fx-progress__fill fx-progress__fill--gradient" style="width:${Math.min(100, progress)}%"></span></span><div class="ho-so-ladder">${tierHtml}</div>`;
}

function renderBadges(host: HTMLElement, state: Record<string, unknown>) {
  const badges = Array.isArray(state.badges) ? state.badges as Array<Record<string, unknown>> : [];
  const unlocked = badges.filter((badge) => badge.unlocked === true).length;
  host.innerHTML = `<div class="ho-so-card-head"><h3>Huy hiệu</h3><small>${unlocked} / ${badges.length} đã mở</small></div><div class="ho-so-medals">${badges.map((badge) => `<article class="ho-so-medal" data-locked="${badge.unlocked !== true}" title="${escapeHtml(badge.description_vi || '')}"><span aria-hidden="true">${escapeHtml(badge.emoji || '🏅')}</span><strong>${escapeHtml(badge.label_vi || 'Huy hiệu')}</strong></article>`).join('')}</div>`;
}

function renderSeason(host: HTMLElement, state: Record<string, unknown>) {
  const candidate = state.season;
  if (!isSeasonPayload(candidate)) { host.innerHTML = ''; return; }
  const season = candidate as SeasonPayload;
  const end = new Date(`${season.ends_at}T23:59:59`);
  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  host.innerHTML = `<div class="fx-card ho-so-season"><div class="ho-so-season__icon" aria-hidden="true">${escapeHtml(season.emoji)}</div><div class="ho-so-season__copy"><p class="fx-eyebrow ho-so-accent-eyebrow">${escapeHtml(season.name_vi)}</p><h3>${escapeHtml(season.ladder.label_vi)} · ${Number(season.rp) || 0} RP</h3><p>Còn ${days} ngày — mỗi bài hoàn thành giúp con tiến gần bậc tiếp theo.</p></div><a class="fx-btn fx-btn--secondary" href="/read2lead/leaderboard">Xem bảng xếp hạng →</a></div>`;
}

function renderDailyExtras(state: Record<string, unknown>, pack: Record<string, unknown> | null | undefined, data: ProgressPayload, name: string, shopHref: string) {
  const quests = ((state.daily_quests_view as { quests?: W2QuestRow[] } | undefined)?.quests || []);
  const questHtml = quests.map((quest) => {
    const percent = quest.target > 0 ? Math.min(100, Math.round((quest.progress / quest.target) * 100)) : 0;
    const action = quest.claimed ? '<span>✓ Đã nhận</span>' : quest.complete ? `<button class="fx-btn fx-btn--secondary fx-btn--sm" type="button" data-w2-quest-claim="${escapeHtml(quest.id)}">Nhận thưởng</button>` : `<span>${quest.progress}/${quest.target}</span>`;
    return `<article class="ho-so-quest"><div class="ho-so-card-head"><strong>${escapeHtml(quest.label_vi)}</strong>${action}</div><div class="ho-so-quest__bar"><span style="width:${percent}%"></span></div><small>🪙 +${quest.reward_coins}${quest.reward_rp ? ` · ⭐ +${quest.reward_rp}` : ''}</small></article>`;
  }).join('');
  const chest = state.daily_login_chest as { available?: boolean; coins?: number } | undefined;
  const chestHtml = chest?.available ? `<button class="fx-btn fx-btn--secondary" type="button" data-w2-daily-chest>🎁 Nhận +${Number(chest.coins) || 0} xu hôm nay</button>` : chest ? '<span class="fx-badge fx-badge--neutral">🎁 Đã nhận quà hôm nay</span>' : '';
  const status = statusMeta(data.state || '', pack);
  const v3 = isV3Enabled();
  const avatarStage = String(state.avatar_stage || 'basic');
  const builder = v3 && avatarStage === 'custom' ? monsterBuilderHtml(name, shopHref) : '';
  return `<section class="fx-card ho-so-extra-card"><div class="ho-so-card-head"><h3>Nhiệm vụ hôm nay</h3>${chestHtml}</div>${questHtml ? `<div class="ho-so-quest-grid">${questHtml}</div>` : '<p class="ho-so-empty">Hoàn thành một bài để mở nhiệm vụ hôm nay.</p>'}${pack && !status.completed ? `<p class="ho-so-chart-note">${escapeHtml(pack.story_title || 'Bài đang mở')} · ${escapeHtml(status.label)}</p>` : ''}</section>${builder}<nav class="ho-so-extra-actions" aria-label="Tiện ích"><a class="fx-btn fx-btn--ghost" href="${shopHref}">🛒 Cửa hàng</a><a class="fx-btn fx-btn--ghost" href="/read2lead/games?code=${encodeURIComponent(currentAccessCode)}&v3=1">🎮 Mini game</a><a class="fx-btn fx-btn--ghost" href="/read2lead/leaderboard">🏆 Bảng hạng</a><a class="fx-btn fx-btn--ghost" href="/read2lead/gifts?code=${encodeURIComponent(currentAccessCode)}">🎁 Quà thật</a></nav>`;
}

// §4 GiftGoalCard — "Con đang tiết kiệm cho…". `state.gift_goal` is only a
// gift id (see functions/api/_read2lead-v2-state.js's publicProgressState);
// the name/photo/price live in the catalogue, so this fetches
// read2lead-gifts-list (the same endpoint the shop page itself uses) and
// prepends the rendered card once it resolves. Async and best-effort: it
// never blocks the synchronous render above it, and a failed fetch just
// leaves the card out — the rest of the profile must never wait on it.
// Guards against a stale response landing after the user has already
// switched away (or back) via `currentAccessCode`, which renderKidView
// re-stamps on every call.
async function loadGiftGoalCard(accessCode: string, extrasHost: HTMLElement, state: Record<string, unknown>) {
  const diamonds = Number(state.diamonds || 0);
  const redemptions = (Array.isArray(state.redemptions) ? state.redemptions : []) as GiftGoalRedemption[];
  const giftGoal = typeof state.gift_goal === 'string' && state.gift_goal ? state.gift_goal : null;

  if (!giftGoal) {
    extrasHost.insertAdjacentHTML('afterbegin', renderGiftGoalCard(null, diamonds, redemptions, { variant: 'narrow', code: accessCode }));
    return;
  }

  try {
    const res = await fetch('/api/read2lead-gifts-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: accessCode }),
    });
    const payload = (await res.json()) as { ok?: boolean; items?: GiftGoalItem[] };
    if (currentAccessCode !== accessCode || !payload?.ok) return;
    const item = (payload.items || []).find((entry) => entry.id === giftGoal) || null;
    extrasHost.insertAdjacentHTML('afterbegin', renderGiftGoalCard(item, diamonds, redemptions, { variant: 'narrow', code: accessCode }));
  } catch {
    // Best-effort — see doc comment above.
  }
}

function maybeShowRankUp(code: string, ladder: Record<string, unknown>, kidName: string) {
  const key = `r2l-rank-seen:${code}`;
  const current = Number(ladder.tier_index);
  if (!Number.isFinite(current)) return;
  let previous: number | null = null;
  try { const raw = localStorage.getItem(key); previous = raw == null ? null : Number(raw); localStorage.setItem(key, String(current)); } catch { /* optional */ }
  if (previous == null || !Number.isFinite(previous) || current <= previous) return;
  showRankUpModal({ changed: true, from_label: PROFILE_TIERS[Math.min(7, previous)]?.[0] || '', to_label: String(ladder.label_vi || PROFILE_TIERS[current]?.[0] || ''), tier_changed: true }, ladder as Parameters<typeof showRankUpModal>[1], { kidName });
}

export function renderKidView(_container: Element, data: ProgressPayload, accessCode: string) {
  currentAccessCode = accessCode;
  dashboardData = data;
  const progress = (data.progress || {}) as Record<string, unknown>;
  const state = (data.read2lead_state || {}) as Record<string, unknown>;
  const pack = progress.current_pack as Record<string, unknown> | null | undefined;
  const name = String(progress.student_name || state.student_name || 'Bé yêu');
  const first = firstName(name);
  const ladder = (state.rank_ladder || {}) as Record<string, unknown>;
  const cta = buildHeroCta(pack, data, accessCode);
  const shopHref = `/read2lead/shop?code=${encodeURIComponent(accessCode)}&v3=1`;

  const sessionHost = qs<HTMLElement>('#ho-so-kid-session');
  const heroHost = qs<HTMLElement>('#ho-so-kid-hero');
  const statsHost = qs<HTMLElement>('#ho-so-kid-stats');
  const rankHost = qs<HTMLElement>('#ho-so-kid-rank');
  const badgesHost = qs<HTMLElement>('#ho-so-kid-medals');
  const seasonHost = qs<HTMLElement>('#ho-so-kid-season');
  const extrasHost = qs<HTMLElement>('#ho-so-kid-extras');
  const ctaHost = qs<HTMLElement>('#ho-so-kid-cta');
  if (!sessionHost || !heroHost || !statsHost || !rankHost || !badgesHost || !seasonHost || !extrasHost || !ctaHost) return;

  renderSession(sessionHost, name, accessCode);
  heroHost.className = 'fx-card ho-so-hero-card';
  heroHost.innerHTML = `<div class="ho-so-hero"><div class="ho-so-hero__avatar" data-hub-monster>${defaultMonsterSvg()}</div><div><p class="fx-eyebrow">Hồ sơ của con</p><h1>${escapeHtml(name)}</h1><p>Đã đọc xong <strong>${Number(progress.completed_packs || state.completed_packs || 0)} truyện</strong> và giữ chuỗi <strong>${Number(state.streak_days || 0)} ngày</strong>.</p><div class="ho-so-pill-row"><span class="fx-rank fx-rank--${PROFILE_TIERS[Math.min(7, Number(ladder.tier_index) || 0)][2]}"><span class="fx-rank__dot"></span>${escapeHtml(ladder.label_vi || state.rank_title || 'Đồng')}</span><span class="fx-badge fx-badge--neutral">${escapeHtml((state.season as Record<string, unknown> | undefined)?.name_vi || 'Mùa hiện tại')}</span></div></div></div>`;
  statsHost.innerHTML = `<article class="fx-card ho-so-stat"><span class="fx-eyebrow">⭐ XP tổng</span><strong>${Number(state.total_xp || 0).toLocaleString('vi-VN')}</strong><small>${Number(state.xp_in_level || 0)} / ${Number(state.xp_to_next_level || 0)} XP cấp hiện tại</small></article><article class="fx-card ho-so-stat ho-so-stat--coins"><span class="fx-eyebrow">🪙 Xu</span><strong>${Number(state.coins || 0)}</strong><small>Dùng để trang trí quái vật</small></article><article class="fx-card ho-so-stat"><span class="fx-eyebrow">💎 Kim cương</span><strong>${Number(state.diamonds || 0)}</strong><small>Dùng để đổi quà thật</small></article><article class="fx-card ho-so-stat"><span class="fx-eyebrow">Chuỗi ngày</span><strong>🔥 ${Number(state.streak_days || 0)}</strong><small>Học thêm một bài để giữ nhịp</small></article>`;
  renderRankBoard(rankHost, state);
  renderBadges(badgesHost, state);
  renderSeason(seasonHost, state);
  extrasHost.innerHTML = renderDailyExtras(state, pack, data, name, shopHref);
  void loadGiftGoalCard(accessCode, extrasHost, state);

  const ctaHtml = cta.action === 'lesson' && cta.href ? `<a class="fx-btn fx-btn--primary fx-btn--lg fx-btn--block" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>` : `<button id="ho-so-hero-cta" class="fx-btn fx-btn--primary fx-btn--lg fx-btn--block" type="button" ${cta.action === 'wait' ? 'disabled' : ''}>${escapeHtml(cta.label)}</button>`;
  ctaHost.innerHTML = `<div class="ho-so-cta">${ctaHtml}<p>Mất khoảng 30 giây — Minny viết riêng một truyện theo chủ đề con chọn.</p></div>`;

  const monsterSlot = qs<HTMLElement>('[data-hub-monster]', heroHost);
  const v3 = isV3Enabled();
  const avatarStage = String(state.avatar_stage || 'basic');
  if (v3 && avatarStage === 'egg' && monsterSlot) {
    monsterSlot.innerHTML = renderEggHtml(name, String(state.current_level || 'L1'), Number(state.packs_until_level_up || 0));
    monsterSlot.querySelector('[data-r2l-egg]')?.addEventListener('click', () => kidToast('Con lên hạng Bạc thì trứng sẽ nở nhé!'));
  } else if (v3 && (state.avatar as { monster?: unknown } | undefined)?.monster && monsterSlot) renderHubMonster(monsterSlot, state);

  const builderRoot = extrasHost.querySelector('[data-r2l-monster-builder-root]');
  if (v3 && avatarStage === 'custom' && builderRoot instanceof HTMLElement) mountMonsterBuilder(builderRoot, accessCode, state, (nextState) => { if (monsterSlot && nextState.avatar?.monster) renderHubMonster(monsterSlot, nextState as Record<string, unknown>); });
  if (v3 && avatarStage === 'basic') showFirstHatchCeremony(accessCode);
  qs('#ho-so-hero-cta')?.addEventListener('click', () => { if (cta.action === 'create') openCreateSheet(); else if (cta.action === 'wait') showWaitScene(); });
  wireW2Handlers(extrasHost, accessCode);
  maybeShowRankUp(accessCode, ladder, first);

  const pending = loadPendingGeneration(accessCode);
  const taskId = (pack?.task_id as string) || (pack?.generation_task_id as string) || pending?.taskId || '';
  if ((data.state === 'generation_in_progress' || pack?.status === 'generation_in_progress') && taskId) resumePolling(accessCode, taskId);
}

export function cleanupKidView() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (waitStageTimer) { clearInterval(waitStageTimer); waitStageTimer = null; }
  activeTaskId = null;
  generationComplete = false;
  pollAttempts = 0;
  pollInFlight = false;
  qs('#ho-so-create-sheet')?.classList.add('hidden');
  qs('#ho-so-wait-scene')?.classList.add('hidden');
}
