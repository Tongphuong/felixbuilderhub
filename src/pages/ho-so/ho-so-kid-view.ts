/**
 * Kid view renderer for the unified profile page.
 * Extracted and adapted from the old hoc-sinh page (now deleted).
 */
import type { ProgressPayload } from './ho-so';
import { escapeHtml, firstName, qs } from './ho-so';

import { isV3Enabled } from '../../config/flags';
import { renderEggHtml } from '../../lib/egg-renderer';
import { renderMonster, type EquippedDisplayItem } from '../../lib/monster-avatar';
import { monsterBuilderHtml, mountMonsterBuilder } from '../../lib/monster-builder';
import { rankBadgeHtml } from '../../lib/rank-ladder-ui';
import { kidToast } from '../../scripts/r2l-kid-toast';
import { renderQuestPath, type QuestNode } from '../../scripts/r2l-quest-path';
import {
  detectSeasonRankJump,
  isSeasonPayload,
  newestMedalForCongrats,
  parseMedals,
  renderCapLockHintHtml,
  renderMedalCabinetHtml,
  renderMedalCongratsHtml,
  renderSeasonBannerHtml,
  setLastSeenMedalTs,
  showSeasonRankJumpModal,
  type MedalPayload,
  type SeasonPayload,
} from '../../components/read2lead/v3/rank/season-rank-ui';
import { HUB_TOPICS } from '../ho-so/ho-so-topics';

// ── Constants ──

const GEN_STORAGE_PREFIX = 'r2l_hub_gen_v1:';
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 5000;

const WAIT_STAGES = [
  'Minny đang viết truyện riêng cho con...',
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
  if (!pack) return { label: 'Tạo truyện mới ✨', action: 'create' as const, href: null };
  if (data.state === 'generation_in_progress' || pack.status === 'generation_in_progress')
    return { label: 'Minny đang viết...', action: 'wait' as const, href: null };
  if (
    data.state === 'reviewed' ||
    pack.status === 'reviewed_pass' ||
    pack.status === 'reviewed_pass_web' ||
    pack.status === 'reviewed_pass_web_v2'
  ) return { label: 'Tạo truyện mới ✨', action: 'create' as const, href: null };
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
    { icon: '✍️', label: 'Viết truyện', state: stageIndex > 0 ? 'done' : 'current' },
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

// ── Season chrome ──

function clearSeasonChrome() {
  ['#hub-season-banner', '#hub-medal-cabinet', '#hub-medal-congrats'].forEach((selector) => {
    const host = qs<HTMLElement>(selector);
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('hidden');
  });
}

function renderSeasonChrome(read2LeadState: Record<string, unknown>) {
  const seasonRaw = read2LeadState.season;
  if (!isSeasonPayload(seasonRaw)) { clearSeasonChrome(); return; }

  const season = seasonRaw as SeasonPayload;
  const medals = parseMedals(read2LeadState.medals) as MedalPayload[];
  const bannerHost = qs<HTMLElement>('#hub-season-banner');
  const cabinetHost = qs<HTMLElement>('#hub-medal-cabinet');
  const congratsHost = qs<HTMLElement>('#hub-medal-congrats');

  if (bannerHost) {
    bannerHost.innerHTML = renderSeasonBannerHtml(season) + renderCapLockHintHtml(season);
    bannerHost.classList.remove('hidden');
  }
  if (cabinetHost) {
    cabinetHost.innerHTML = renderMedalCabinetHtml(medals);
    cabinetHost.classList.remove('hidden');
  }

  const newestMedal = newestMedalForCongrats(medals);
  if (congratsHost && newestMedal) {
    congratsHost.innerHTML = renderMedalCongratsHtml(newestMedal);
    congratsHost.classList.remove('hidden');
    setLastSeenMedalTs(newestMedal.ts);
    congratsHost.querySelector('[data-r2l-medal-congrats-dismiss]')?.addEventListener('click', () => {
      congratsHost.innerHTML = '';
      congratsHost.classList.add('hidden');
    });
  } else if (congratsHost) {
    congratsHost.innerHTML = '';
    congratsHost.classList.add('hidden');
  }

  const rankJump = detectSeasonRankJump(currentAccessCode, season);
  if (rankJump.jumped) showSeasonRankJumpModal(rankJump.label);
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

// ── Main render ──

export function renderKidView(
  container: Element,
  data: ProgressPayload,
  accessCode: string,
) {
  currentAccessCode = accessCode;
  dashboardData = data;

  const progress = (data.progress || {}) as Record<string, unknown>;
  const read2LeadState = (data.read2lead_state || {}) as Record<string, unknown>;
  const pack = progress.current_pack as Record<string, unknown> | null | undefined;
  const code = accessCode;
  const name = String(progress.student_name || 'Bé yêu');
  const status = statusMeta(data.state || '', pack);
  const cta = buildHeroCta(pack, data, code);
  const nearMiss = nearMissLine(read2LeadState);
  const v3 = isV3Enabled();
  const avatarStage = String(read2LeadState.avatar_stage || 'basic');
  const shopHref = `/read2lead/shop?code=${encodeURIComponent(code)}&v3=1`;
  const ladder = read2LeadState.rank_ladder as Record<string, unknown> | undefined;
  const rankLabel = ladder
    ? String(ladder.label_vi || read2LeadState.rank_title || 'Đồng')
    : String(read2LeadState.rank_title || 'Đồng');

  const ctaHtml = cta.action === 'lesson' && cta.href
    ? `<a href="${escapeHtml(cta.href)}" class="r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--lg r2l-hub-hero-cta">${escapeHtml(cta.label)}</a>`
    : `<button type="button" id="ho-so-hero-cta" class="r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--lg r2l-hub-hero-cta" ${cta.action === 'wait' ? 'disabled' : ''}>${escapeHtml(cta.label)}</button>`;

  renderSeasonChrome(read2LeadState);

  container.innerHTML = `
    <section class="r2l-hub-hook">
      <div class="r2l-hub-hook__top">
        <div class="r2l-hub-monster-slot r2l-hub-monster-slot--pop" data-hub-monster aria-hidden="true"></div>
        <p class="r2l-hub-bubble" data-clarity-mask="true">${escapeHtml(greetingLine(name))}</p>
      </div>
      <div class="r2l-hub-strip">
        <span class="r2l-hub-strip-pill">🔥 ${Number(read2LeadState.streak_days || 0)} ngày</span>
        <span class="r2l-hub-strip-pill">🏅 ${escapeHtml(rankLabel)}</span>
        <span class="r2l-hub-strip-pill">🪙 ${Number(read2LeadState.coins || 0)}</span>
        ${nearMiss ? `<p class="r2l-hub-near-miss">${escapeHtml(nearMiss)}</p>` : ''}
      </div>
      ${ctaHtml}
      <div>
        <p class="text-xs font-extrabold uppercase tracking-wide text-[var(--r2l-ink-soft)]">Nhiệm vụ hôm nay</p>
        <ol class="r2l-kid-quest-path mt-2" data-hub-mission-path></ol>
      </div>
      ${renderW2DailyQuestsHtml(read2LeadState)}
      ${renderW2DailyChestHtml(read2LeadState)}
      ${
        pack && !status.completed
          ? `<div class="r2l-kid-card mt-1">
              <p class="text-sm font-bold">${escapeHtml(String(pack.story_title || 'Bài đang mở'))}</p>
              <p class="mt-1 text-xs r2l-kid-muted">${escapeHtml(status.label)}</p>
            </div>`
          : ''
      }
      ${v3 && avatarStage === 'custom' ? monsterBuilderHtml(name, shopHref) : ''}
      ${
        v3 && avatarStage === 'basic'
          ? `<section class="r2l-kid-card text-center" data-r2l-basic-avatar-cta>
              <p class="text-sm font-bold">Quái của con đã nở!</p>
              <a href="${shopHref}" class="r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--lg mt-3">🛒 Trang trí ở Cửa hàng</a>
            </section>`
          : ''
      }
      <div class="r2l-hub-kid-links">
        <a href="${shopHref}" class="r2l-kid-btn r2l-kid-btn--ghost r2l-kid-btn--md">🛒 Cửa hàng</a>
        <a href="/read2lead/games?code=${encodeURIComponent(code)}&v3=1" class="r2l-kid-btn r2l-kid-btn--ghost r2l-kid-btn--md">🎮 Mini game</a>
        <a href="/read2lead/leaderboard" class="r2l-kid-btn r2l-kid-btn--ghost r2l-kid-btn--md">🏆 Bảng hạng</a>
      </div>
      ${
        data.is_test || data.is_shared
          ? '<p class="r2l-kid-card text-sm r2l-kid-muted">Mã test — con có thể tạo bài mới bất cứ lúc nào.</p>'
          : ''
      }
    </section>`;

  // Quest path
  const missionEl = qs('[data-hub-mission-path]', container);
  if (missionEl instanceof HTMLElement) renderQuestPath(missionEl, missionNodes(pack, data));

  // Monster / egg / rank badge
  const monsterSlot = qs('[data-hub-monster]', container);
  if (v3 && avatarStage === 'egg' && monsterSlot instanceof HTMLElement) {
    monsterSlot.removeAttribute('aria-hidden');
    monsterSlot.innerHTML = renderEggHtml(
      name,
      String(read2LeadState.current_level || 'L1'),
      Number(read2LeadState.packs_until_level_up || 0),
    );
    monsterSlot.querySelector('[data-r2l-egg]')?.addEventListener('click', () => {
      kidToast('Con lên hạng Bạc thì trứng sẽ nở nhé!');
    });
  } else if (v3 && read2LeadState.avatar && monsterSlot instanceof HTMLElement) {
    const avatar = read2LeadState.avatar as { monster?: unknown };
    if (avatar.monster) renderHubMonster(monsterSlot, read2LeadState);
    else if (ladder) monsterSlot.innerHTML = rankBadgeHtml(ladder as Parameters<typeof rankBadgeHtml>[0], 'large');
  } else if (ladder && monsterSlot) {
    monsterSlot.innerHTML = rankBadgeHtml(ladder as Parameters<typeof rankBadgeHtml>[0], 'large');
  }

  // Monster builder
  const builderRoot = container.querySelector('[data-r2l-monster-builder-root]');
  if (v3 && avatarStage === 'custom' && builderRoot instanceof HTMLElement) {
    mountMonsterBuilder(builderRoot, code, read2LeadState, (nextState) => {
      const slot = container.querySelector('[data-hub-monster]');
      if (slot instanceof HTMLElement && nextState.avatar?.monster)
        renderHubMonster(slot, nextState as Record<string, unknown>);
    });
  }
  if (v3 && avatarStage === 'basic') showFirstHatchCeremony(code);

  // CTA handler
  qs('#ho-so-hero-cta')?.addEventListener('click', () => {
    if (cta.action === 'create') openCreateSheet();
    else if (cta.action === 'wait') showWaitScene();
  });

  wireW2Handlers(container as HTMLElement, code);

  // Resume generation polling if in progress
  const pending = loadPendingGeneration(code);
  const taskId = (pack?.task_id as string) || (pack?.generation_task_id as string) || pending?.taskId || '';
  if ((data.state === 'generation_in_progress' || pack?.status === 'generation_in_progress') && taskId) {
    resumePolling(code, taskId);
  }
}

export function cleanupKidView() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (waitStageTimer) { clearInterval(waitStageTimer); waitStageTimer = null; }
  activeTaskId = null;
  generationComplete = false;
  pollAttempts = 0;
  pollInFlight = false;
  clearSeasonChrome();
  qs('#ho-so-create-sheet')?.classList.add('hidden');
  qs('#ho-so-wait-scene')?.classList.add('hidden');
}
