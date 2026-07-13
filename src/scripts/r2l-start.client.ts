/**
 * Magic link start page — resolve token, then generate/poll.
 *
 * Drives the phases of /r2l/start: resolving → ready → generating → result / error.
 * All phases live in the DOM at once; we flip `data-phase` on <main> and CSS
 * reveals the matching `.phase-*` block.
 *
 * The generate/poll flow mirrors src/scripts/r2l-builder.client.ts.
 */

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
  'Đang chuẩn bị nhiệm vụ web…',
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

  const greetingName = document.querySelector<HTMLElement>('#greeting-name');
  const greetingLevel = document.querySelector<HTMLElement>('#greeting-level');
  const errorMessage = document.querySelector<HTMLElement>('#error-message');
  const genErrorMessage = document.querySelector<HTMLElement>('#gen-error-message');
  const honeypotInput = document.querySelector<HTMLInputElement>('input[name="website"]');
  const generateBtn = document.querySelector<HTMLButtonElement>('#generate-btn');
  const resetBtn = document.querySelector<HTMLButtonElement>('#reset');
  const retryBtn = document.querySelector<HTMLButtonElement>('#retry');
  const stageLabel = document.querySelector<HTMLElement>('#stage-label');
  const genNote = document.querySelector<HTMLElement>('#gen-note');
  const progressFill = document.querySelector<HTMLElement>('#gen-progress .fx-progress__fill');
  const progressBar = document.querySelector<HTMLElement>('#gen-progress .fx-progress');
  const resultName = document.querySelector<HTMLElement>('#result-name');
  const resultTopicWrap = document.querySelector<HTMLElement>('#result-topic-wrap');
  const resultTopic = document.querySelector<HTMLElement>('#result-topic');
  const resultStory = document.querySelector<HTMLElement>('#result-story');
  const resultStoryTitle = document.querySelector<HTMLElement>('#result-story-title');
  const openLesson = document.querySelector<HTMLAnchorElement>('#open-lesson');
  const hosoLink = document.querySelector<HTMLAnchorElement>('#hoso-link');
  const speakLink = document.querySelector<HTMLAnchorElement>('#speak-link');
  const shopLink = document.querySelector<HTMLAnchorElement>('#shop-link');

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

  // ---- Token resolution -------------------------------------------------------
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

      if (greetingName) greetingName.textContent = studentName || 'bạn nhỏ';
      if (greetingLevel) greetingLevel.textContent = data.level || 'L1';
      if (hosoLink) hosoLink.href = `/ho-so?code=${encodeURIComponent(accessCode)}`;
      if (speakLink) speakLink.href = `/speak-up?code=${encodeURIComponent(accessCode)}`;
      if (shopLink) shopLink.href = `/read2lead/shop?code=${encodeURIComponent(accessCode)}&v3=1`;

      setPhase('ready');
    } catch {
      if (errorMessage) errorMessage.textContent = 'Mất kết nối. Kiểm tra mạng rồi thử mở lại link.';
      setPhase('error');
    }
  }

  // ---- Cosmetic generating animation ------------------------------------------
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

  // ---- Phase transitions ------------------------------------------------------
  function showResult(data: PackResult): void {
    clearStageTimer();
    clearPollTimer();
    generationComplete = true;
    activeTaskId = null;

    if (resultName) resultName.textContent = studentName || data.child_name || '';
    if (data.topic && resultTopic && resultTopicWrap) {
      resultTopic.textContent = data.topic;
      resultTopicWrap.hidden = false;
    } else if (resultTopicWrap) {
      resultTopicWrap.hidden = true;
    }
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
      const actions = openLesson.closest('.r2l-result-actions');
      if (actions && !actions.parentElement?.querySelector('.r2l-open-hint')) {
        const hint = document.createElement('p');
        hint.className = 'r2l-gen-note r2l-open-hint';
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

  // ---- Network: generate + poll -----------------------------------------------
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
            genNote.textContent = 'Minny vẫn đang chuẩn bị bài cho con, đợi một chút nhé…';
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

    const topic = '';
    const interests = '';

    generationComplete = false;
    activeTaskId = null;
    pollAttempts = 0;
    pollInFlight = false;
    if (generateBtn) generateBtn.disabled = true;

    setPhase('generating');
    if (genNote) {
      genNote.textContent = 'Lần đầu có thể chậm hơn một chút vì máy chủ cần khởi động.';
    }
    startCosmeticStages();

    try {
      const res = await fetch('/api/generate-read2lead-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode, topic, interests, website: '' }),
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
    }
  }

  // ---- Wiring -----------------------------------------------------------------
  generateBtn?.addEventListener('click', startGenerate);
  resetBtn?.addEventListener('click', backToReady);
  retryBtn?.addEventListener('click', backToReady);

  // Kick off token resolution
  setPhase('resolving');
  void resolveToken();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStart, { once: true });
} else {
  initStart();
}
