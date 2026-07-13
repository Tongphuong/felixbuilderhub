/**
 * Read2Lead student home hub — client.
 *
 * Drives the phases of /r2l/start: resolving → ready → generating → result / error.
 * All phases live in the DOM at once; we flip `data-phase` on <main> and CSS reveals the
 * matching `.phase-*` block.
 *
 * On top of that it renders "the child's world": their real pet, rank medal, streak and
 * coins, and decides whether the biggest button invites them to CONTINUE the book they
 * have open or to CREATE a new one. That decision is `buildHeroCta()` from lib/r2l-hero —
 * the same function the profile page uses, so the two screens can never disagree.
 *
 * The generate/poll flow is unchanged from the topic-picker version that preceded this.
 */
import { buildHeroCta, bookPct, medalFor, statusMeta } from '../lib/r2l-hero';
import { renderMonster, type EquippedDisplayItem } from '../lib/monster-avatar';

type Phase = 'resolving' | 'error' | 'ready' | 'generating' | 'result' | 'gen-error';

const STAGE_INTERVAL_MS = 15000;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const STAGE_LABELS = [
  'Đang chọn truyện phù hợp với con…',
  'Đang chuẩn bị phần nghe…',
  'Đang ghi âm các cụm câu…',
  'Đang chuẩn bị nhiệm vụ đọc…',
];

interface PackResult {
  ok?: boolean;
  status?: string;
  task_id?: string;
  lesson_link?: string;
  review_link?: string;
  story_title?: string;
  topic?: string;
  child_name?: string;
  message?: string;
  error?: string;
  queue_position?: number;
}

interface TokenResult {
  ok: boolean;
  access_code?: string;
  student_name?: string;
  level?: string;
  error?: string;
  message?: string;
}

function initStart(): void {
  const mainEl = document.querySelector<HTMLElement>('main[data-phase]');
  if (!mainEl) return;

  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

  const greetingName = $('#greeting-name');
  const greetingLevel = $('#greeting-level');
  const errorMessage = $('#error-message');
  const genErrorMessage = $('#gen-error-message');
  const honeypotInput = $<HTMLInputElement>('input[name="website"]');
  const generateBtn = $<HTMLButtonElement>('#generate-btn');
  const generateBtnCreate = $<HTMLButtonElement>('#generate-btn-create');
  const resetBtn = $<HTMLButtonElement>('#reset');
  const retryBtn = $<HTMLButtonElement>('#retry');
  const stageLabel = $('#stage-label');
  const genNote = $('#gen-note');
  const progressFill = $('#gen-progress .fx-progress__fill');
  const progressBar = $('#gen-progress .fx-progress');
  const resultName = $('#result-name');
  const resultStory = $('#result-story');
  const resultStoryTitle = $('#result-story-title');
  const openLesson = $<HTMLAnchorElement>('#open-lesson');

  // The child's world + the wired destinations.
  const speakLink = $<HTMLAnchorElement>('#speak-link');
  const hosoLink = $<HTMLAnchorElement>('#hoso-link');
  const shopLink = $<HTMLAnchorElement>('#shop-link');
  const continueLink = $<HTMLAnchorElement>('#continue-link');
  const ctaContinue = $('#cta-continue');
  const ctaCreate = $('#cta-create');
  const createSub = $('#create-sub');
  const petSlot = $('#pet-slot');
  const rankMedal = $<HTMLImageElement>('#rank-medal');
  const rankLabelEl = $('#rank-label');
  const statStreak = $('#stat-streak');
  const statCoins = $('#stat-coins');
  const shopCoins = $('#shop-coins');
  const bookTitleEl = $('#book-title');
  const bookPctEl = $('#book-pct');
  const bookFill = $('#cta-continue .fx-progress__fill');
  const bookBar = $('#cta-continue .fx-progress');

  let accessCode = '';
  let studentName = '';

  let stageTimer: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pollAttempts = 0;
  let pollInFlight = false;
  let activeTaskId: string | null = null;
  let generationComplete = false;

  function setPhase(phase: Phase): void {
    mainEl!.dataset.phase = phase;
    if (phase === 'ready' || phase === 'resolving') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  function clearStageTimer(): void {
    if (stageTimer !== undefined) {
      clearInterval(stageTimer);
      stageTimer = undefined;
    }
  }

  function clearPollTimer(): void {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  // ---- The child's world ------------------------------------------------------------

  /** Which primary card the child sees. Falls back to "create" — never to nothing. */
  function showCreateCta(waiting = false): void {
    if (ctaContinue) ctaContinue.hidden = true;
    if (ctaCreate) ctaCreate.hidden = false;
    if (generateBtnCreate) generateBtnCreate.disabled = waiting;
    if (createSub && waiting) createSub.textContent = 'Đang chuẩn bị bài đọc cho con…';
  }

  /** The child's own monster, if they have made one. Falls back to the starter pet. */
  function renderPet(state: Record<string, any>): void {
    const monster = state?.avatar?.monster;
    if (!monster || !petSlot) return;
    // renderMonster() takes ownership of the element it is given (it rewrites className),
    // so hand it a child and keep our animated wrapper intact.
    const inner = document.createElement('div');
    petSlot.replaceChildren(inner);
    const parts = state.monster_parts as Record<string, Array<{ id: string }>> | undefined;
    const config = monster.detail
      ? monster
      : { ...monster, detail: parts?.detail?.find((p) => p.id)?.id || 'default' };
    renderMonster(inner, config, {
      size: 'large',
      withCosmetics: true,
      animate: !prefersReducedMotion(),
      equipped: state.equipped as Record<string, string>,
      equippedDisplay: state.equipped_display as EquippedDisplayItem[],
    });
    if (!monster.detail) {
      inner.querySelectorAll('[data-slot="detail"]').forEach((layer) => layer.remove());
    }
  }

  function renderWorld(data: any): void {
    const progress = data?.progress || {};
    const state = data?.read2lead_state || {};
    const ladder = state.rank_ladder || {};

    renderPet(state);

    if (rankMedal) rankMedal.src = medalFor(ladder.tier_index);
    if (rankLabelEl) rankLabelEl.textContent = ladder.label_vi || state.rank_title || 'Đồng';

    const coins = String(Number(state.coins) || 0);
    if (statStreak) statStreak.textContent = String(Number(state.streak_days) || 0);
    if (statCoins) statCoins.textContent = coins;
    if (shopCoins) shopCoins.textContent = coins;

    const pack = progress.current_pack;
    const cta = buildHeroCta(pack, data, accessCode);

    if (cta.action === 'lesson' && cta.href && pack) {
      const pct = bookPct(statusMeta(data.state || '', pack).step);
      if (bookTitleEl) bookTitleEl.textContent = pack.story_title || 'Truyện của con';
      if (bookPctEl) bookPctEl.textContent = `${pct}%`;
      if (bookFill) bookFill.style.width = `${pct}%`;
      if (bookBar) bookBar.setAttribute('aria-valuenow', String(pct));
      if (continueLink) continueLink.href = cta.href;
      if (ctaCreate) ctaCreate.hidden = true;
      if (ctaContinue) ctaContinue.hidden = false;
      return;
    }

    // 'create', or 'wait' while a pack is still being generated.
    showCreateCta(cta.action === 'wait');
  }

  // ---- Token resolution -------------------------------------------------------------
  async function resolveToken(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('t');

    if (!token) {
      if (errorMessage) errorMessage.textContent = 'Link thiếu mã. Nhắn Zalo Felix để nhận link mới.';
      setPhase('error');
      return;
    }

    try {
      const res = await fetch(`/api/r2l-link?token=${encodeURIComponent(token)}`);
      const data: TokenResult = await res.json();

      if (!res.ok || !data.ok) {
        if (errorMessage) errorMessage.textContent = data.message || 'Link không hợp lệ. Nhắn Zalo Felix để nhận link mới.';
        setPhase('error');
        return;
      }

      accessCode = data.access_code || '';
      studentName = data.student_name || '';

      try {
        sessionStorage.setItem('r2l_access_code', accessCode);
      } catch { /* private browsing — continue without storage */ }

      const code = encodeURIComponent(accessCode);
      if (greetingName) greetingName.textContent = studentName || 'bạn nhỏ';
      if (greetingLevel) greetingLevel.textContent = data.level || 'L1';
      if (speakLink) speakLink.href = `/speak-up?code=${code}`;
      if (hosoLink) hosoLink.href = `/ho-so?code=${code}`;
      if (shopLink) shopLink.href = `/read2lead/shop?code=${code}&v3=1`;

      setPhase('ready');

      // The world is a second, non-blocking call. If it fails the child still gets a
      // working home screen with the create button — never a dead one.
      try {
        const pRes = await fetch(`/api/read2lead-progress?code=${code}`);
        if (pRes.ok) {
          renderWorld(await pRes.json());
          return;
        }
      } catch { /* fall through */ }
      showCreateCta();
    } catch {
      if (errorMessage) errorMessage.textContent = 'Mất kết nối. Kiểm tra mạng rồi thử mở lại link.';
      setPhase('error');
    }
  }

  // ---- Cosmetic generating animation ------------------------------------------------
  function startCosmeticStages(): void {
    let stage = 0;
    const render = (): void => {
      if (stageLabel) stageLabel.textContent = STAGE_LABELS[stage];
      const pct = Math.min(90, ((stage + 1) / STAGE_LABELS.length) * 90);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressBar) progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    };
    render();
    if (prefersReducedMotion()) return;
    stageTimer = setInterval(() => {
      stage = Math.min(stage + 1, STAGE_LABELS.length - 1);
      render();
    }, STAGE_INTERVAL_MS);
  }

  // ---- Phase transitions ------------------------------------------------------------
  function showResult(data: PackResult): void {
    clearStageTimer();
    clearPollTimer();
    generationComplete = true;
    activeTaskId = null;

    if (resultName) resultName.textContent = studentName || data.child_name || '';
    if (data.story_title && resultStory && resultStoryTitle) {
      resultStoryTitle.textContent = data.story_title;
      resultStory.hidden = false;
    } else if (resultStory) {
      resultStory.hidden = true;
    }
    setPhase('result');

    void activateOpenLessonWhenReady(data.lesson_link || '/read2lead/lesson');
  }

  async function activateOpenLessonWhenReady(lessonLink: string): Promise<void> {
    if (!openLesson) return;

    let target: URL;
    try {
      target = new URL(lessonLink, window.location.origin);
    } catch {
      openLesson.href = lessonLink;
      return;
    }
    const gateCode = target.searchParams.get('code');
    const gatePackId = target.searchParams.get('pack_id');
    if (!gateCode || !gatePackId) {
      openLesson.href = lessonLink;
      return;
    }

    const restoreLabel = openLesson.textContent || 'Mở bài học →';
    const blockClick = (event: Event): void => event.preventDefault();
    openLesson.addEventListener('click', blockClick);
    openLesson.setAttribute('aria-disabled', 'true');
    openLesson.textContent = 'Đang hoàn tất bài học…';

    const deadline = Date.now() + 60000;
    let wait = 1800;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(
          `/api/read2lead-lesson?code=${encodeURIComponent(gateCode)}&pack_id=${encodeURIComponent(gatePackId)}`,
        );
        if (res.ok) {
          ready = true;
          break;
        }
        if (res.status !== 404 && res.status !== 409) break;
      } catch {
        // Network blip — keep trying.
      }
      if (Date.now() + wait >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(Math.round(wait * 1.4), 6000);
    }

    openLesson.removeEventListener('click', blockClick);
    openLesson.removeAttribute('aria-disabled');
    openLesson.href = lessonLink;
    openLesson.textContent = restoreLabel;
    if (!ready) {
      const actions = openLesson.closest('.r2l-result__actions');
      if (actions && !actions.parentElement?.querySelector('.r2l-open-hint')) {
        const hint = document.createElement('p');
        hint.className = 'r2l-state-note r2l-open-hint';
        hint.textContent = 'Nếu bài chưa mở ngay, con đợi vài giây rồi bấm lại nhé.';
        actions.insertAdjacentElement('afterend', hint);
      }
    }
  }

  function showGenError(msg: string): void {
    if (generationComplete) return;
    clearStageTimer();
    clearPollTimer();
    activeTaskId = null;
    pollInFlight = false;
    if (genErrorMessage) {
      genErrorMessage.textContent = msg || 'Có lỗi xảy ra, vui lòng thử lại.';
    }
    setPhase('gen-error');
  }

  function backToReady(): void {
    clearStageTimer();
    clearPollTimer();
    pollInFlight = false;
    activeTaskId = null;
    generationComplete = false;
    pollAttempts = 0;
    setPhase('ready');
  }

  // ---- Network: generate + poll ------------------------------------------------------
  async function pollGenerationStatus(code: string, taskId: string): Promise<void> {
    if (generationComplete || activeTaskId !== taskId || pollInFlight) return;
    pollInFlight = true;
    try {
      const res = await fetch(
        `/api/check-generation-status?access_code=${encodeURIComponent(code)}&task_id=${encodeURIComponent(taskId)}`,
      );
      const result: PackResult = await res.json();

      if (generationComplete || activeTaskId !== taskId) return;

      if (result.status === 'pending') {
        pollAttempts += 1;
        if (genNote) {
          const pos = typeof result.queue_position === 'number' ? result.queue_position : null;
          if (pos && pos > 3) {
            const ahead = pos - 3;
            genNote.textContent = `Hệ thống đang bận: còn ${ahead} bài trước con. Con đợi thêm một chút nhé…`;
          } else if (pos && pos > 0) {
            genNote.textContent = 'Bài của con đang được tạo. Đợi khoảng 1 phút nữa thôi…';
          } else {
            genNote.textContent = 'Vẫn đang chuẩn bị bài cho con, đợi một chút nhé…';
          }
        }
        if (pollAttempts >= MAX_POLL_ATTEMPTS) {
          clearPollTimer();
          activeTaskId = null;
          showGenError('Tạo bài hơi lâu. Con thử lại hoặc nhắn Zalo Felix nhé.');
        }
        return;
      }

      clearPollTimer();
      activeTaskId = null;

      if (result.status === 'done' && result.lesson_link) {
        showResult(result);
      } else {
        showGenError(result.message || result.error || 'Tạo bài chưa thành công, con thử lại nhé.');
      }
    } catch {
      if (generationComplete || activeTaskId !== taskId) return;
      clearPollTimer();
      activeTaskId = null;
      showGenError('Mất kết nối khi kiểm tra trạng thái. Con thử lại sau nhé.');
    } finally {
      pollInFlight = false;
    }
  }

  async function startGenerate(): Promise<void> {
    if (!accessCode) return;

    if (honeypotInput && honeypotInput.value) return;

    generationComplete = false;
    activeTaskId = null;
    pollAttempts = 0;
    pollInFlight = false;
    if (generateBtn) generateBtn.disabled = true;
    if (generateBtnCreate) generateBtnCreate.disabled = true;

    setPhase('generating');
    if (genNote) {
      genNote.textContent = 'Lần đầu có thể chậm hơn một chút vì máy chủ cần khởi động.';
    }
    startCosmeticStages();

    try {
      // The book pool picks the story, so there is no topic to send.
      const res = await fetch('/api/generate-read2lead-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode, topic: '', interests: '', website: '' }),
      });
      const result: PackResult = await res.json();

      if (!res.ok || !result.ok) {
        showGenError(
          result.review_link
            ? `${result.message || result.error || 'Có lỗi xảy ra.'} Mở hồ sơ: ${result.review_link}`
            : result.message || result.error || 'Có lỗi xảy ra, con thử lại nhé.',
        );
        return;
      }

      if (result.status === 'done' && result.lesson_link) {
        showResult(result);
        return;
      }

      if (!result.task_id) {
        showGenError('Chưa nhận được phản hồi từ hệ thống. Con thử lại nhé.');
        return;
      }

      activeTaskId = result.task_id;
      const taskId = result.task_id;
      pollGenerationStatus(accessCode, taskId);
      pollTimer = setInterval(() => pollGenerationStatus(accessCode, taskId), POLL_INTERVAL_MS);
    } catch {
      showGenError('Mạng không ổn định. Con thử lại sau ít phút nhé.');
    } finally {
      if (generateBtn) generateBtn.disabled = false;
      if (generateBtnCreate) generateBtnCreate.disabled = false;
    }
  }

  // ---- Wiring ------------------------------------------------------------------------
  // Only one of the two cards is visible, but both buttons start the same flow.
  generateBtn?.addEventListener('click', startGenerate);
  generateBtnCreate?.addEventListener('click', startGenerate);
  resetBtn?.addEventListener('click', backToReady);
  retryBtn?.addEventListener('click', backToReady);

  setPhase('resolving');
  void resolveToken();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStart, { once: true });
} else {
  initStart();
}
