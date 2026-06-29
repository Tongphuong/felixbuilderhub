/**
 * Read2Lead lesson builder — real generate/poll client.
 *
 * Drives the 4 phases of /read2lead/build (build → generating → result → error).
 * All phases live in the DOM at once; we only flip `data-phase` on <main> and
 * CSS reveals the matching `.phase-*` block.
 *
 * The generate/poll flow is ported from the proven create-lesson form on
 * src/pages/read2lead.astro: POST /api/generate-read2lead-pack, then either a
 * synchronous `done` payload or a `pending` task we poll via
 * /api/check-generation-status. The 4-stage label rotation is PURELY COSMETIC —
 * phase transitions are driven only by a real API `done`, never by the timer.
 */

type Phase = 'build' | 'generating' | 'result' | 'error';

const MAX_CODE_LENGTH = 16;
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
  message?: string;
  error?: string;
  queue_position?: number;
}

function initBuilder(): void {
  const mainEl = document.querySelector<HTMLElement>('main[data-phase]');
  if (!mainEl) return;

  const codeInput = document.querySelector<HTMLInputElement>('input[name="code"]');
  const interestsInput = document.querySelector<HTMLInputElement>('input[name="interests"]');
  const honeypotInput = document.querySelector<HTMLInputElement>('input[name="website"]');
  const generateBtn = document.querySelector<HTMLButtonElement>('#generate-btn');
  const resetBtn = document.querySelector<HTMLButtonElement>('#reset');
  const retryBtn = document.querySelector<HTMLButtonElement>('#retry');
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-topic]'));
  const stageLabel = document.querySelector<HTMLElement>('#stage-label');
  const genNote = document.querySelector<HTMLElement>('#gen-note');
  const progressFill = document.querySelector<HTMLElement>('#gen-progress .fx-progress__fill');
  const progressBar = document.querySelector<HTMLElement>('#gen-progress .fx-progress');
  const resultCode = document.querySelector<HTMLElement>('#result-code');
  const resultTopic = document.querySelector<HTMLElement>('#result-topic');
  const resultStory = document.querySelector<HTMLElement>('#result-story');
  const resultStoryTitle = document.querySelector<HTMLElement>('#result-story-title');
  const openLesson = document.querySelector<HTMLAnchorElement>('#open-lesson');
  const errorMessage = document.querySelector<HTMLElement>('#error-message');

  // Topic labels/values are read from the rendered tiles so they never drift.
  const topicLabels = tiles.map(
    (tile) => tile.querySelector('.fx-topic__label')?.textContent?.trim() ?? '',
  );
  const topicValues = tiles.map((tile) => tile.dataset.topic ?? '');

  let code = (codeInput?.value ?? '').toUpperCase();
  // Default to whichever tile rendered selected (the first), else index 0.
  let topicIndex = Math.max(
    0,
    tiles.findIndex((tile) => tile.classList.contains('fx-topic--selected')),
  );

  let stageTimer: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pollAttempts = 0;
  let pollInFlight = false;
  let activeTaskId: string | null = null;
  let generationComplete = false;

  function setPhase(phase: Phase): void {
    mainEl!.dataset.phase = phase;
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

  function syncGenerateBtn(): void {
    if (generateBtn) generateBtn.disabled = code.length === 0;
  }

  // ---- Cosmetic generating animation (decoupled from real completion) -------
  function startCosmeticStages(): void {
    let stage = 0;
    const render = (): void => {
      if (stageLabel) stageLabel.textContent = STAGE_LABELS[stage];
      const pct = Math.min(90, ((stage + 1) / STAGE_LABELS.length) * 90);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressBar) progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    };
    render();
    if (prefersReducedMotion()) return; // static label only; no rotation
    stageTimer = setInterval(() => {
      stage = Math.min(stage + 1, STAGE_LABELS.length - 1);
      render();
    }, STAGE_INTERVAL_MS);
  }

  // ---- Phase transitions ----------------------------------------------------
  function showResult(data: PackResult): void {
    clearStageTimer();
    clearPollTimer();
    generationComplete = true;
    activeTaskId = null;

    if (resultCode) resultCode.textContent = code;
    if (resultTopic) resultTopic.textContent = topicLabels[topicIndex] || (data.topic ?? '');
    if (data.story_title && resultStory && resultStoryTitle) {
      resultStoryTitle.textContent = data.story_title;
      resultStory.hidden = false;
    } else if (resultStory) {
      resultStory.hidden = true;
    }
    setPhase('result');

    // KV eventual-consistency gate: keep the "Mở bài học →" link inert until the
    // lesson endpoint can actually serve this freshly minted pack. A new pack_id
    // can read 404 pack_not_found / 409 generation_in_progress for a few seconds
    // after generation returns lesson_link.
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
    // Nothing to gate on (e.g. fallback link) — activate as-is.
    if (!gateCode || !gatePackId) {
      openLesson.href = lessonLink;
      return;
    }

    const restoreLabel = openLesson.textContent || 'Mở bài học →';
    const blockClick = (event: Event): void => event.preventDefault();
    openLesson.addEventListener('click', blockClick);
    openLesson.setAttribute('aria-disabled', 'true');
    openLesson.textContent = 'Đang hoàn tất bài học…';

    const deadline = Date.now() + 60000; // cap ~60s — never permanently block
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
        // 404 pack_not_found / 409 generation_in_progress = not ready, keep
        // waiting. Any other status is non-transient — stop and enable anyway.
        if (res.status !== 404 && res.status !== 409) break;
      } catch {
        // Network blip — keep trying within the budget.
      }
      if (Date.now() + wait >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(Math.round(wait * 1.4), 6000);
    }

    // Ready, capped, or non-transient: always activate — never block a valid pack.
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

  function showError(msg: string): void {
    if (generationComplete) return;
    clearStageTimer();
    clearPollTimer();
    activeTaskId = null;
    pollInFlight = false;
    if (errorMessage) {
      errorMessage.textContent = msg || 'Có lỗi xảy ra, vui lòng thử lại.';
    }
    setPhase('error');
  }

  function backToBuild(): void {
    clearStageTimer();
    clearPollTimer();
    pollInFlight = false;
    activeTaskId = null;
    generationComplete = false;
    pollAttempts = 0;
    setPhase('build');
  }

  function reset(): void {
    backToBuild();
    code = '';
    if (codeInput) codeInput.value = '';
    if (interestsInput) interestsInput.value = '';
    topicIndex = 0;
    tiles.forEach((tile, index) => {
      const selected = index === 0;
      tile.classList.toggle('fx-topic--selected', selected);
      if (tile.tagName === 'BUTTON') tile.setAttribute('aria-pressed', String(selected));
    });
    syncGenerateBtn();
  }

  // ---- Network: generate + poll (mirrors read2lead.astro) -------------------
  async function pollGenerationStatus(accessCode: string, taskId: string): Promise<void> {
    if (generationComplete || activeTaskId !== taskId || pollInFlight) return;
    pollInFlight = true;
    try {
      const res = await fetch(
        `/api/check-generation-status?access_code=${encodeURIComponent(accessCode)}&task_id=${encodeURIComponent(taskId)}`,
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
          showError('Tạo bài hơi lâu. Con thử lại hoặc nhắn Zalo Felix nhé.');
        }
        return;
      }

      clearPollTimer();
      activeTaskId = null;

      if (result.status === 'done' && result.lesson_link) {
        showResult(result);
      } else {
        showError(result.message || result.error || 'Tạo bài chưa thành công, con thử lại nhé.');
      }
    } catch (err) {
      if (generationComplete || activeTaskId !== taskId) return;
      clearPollTimer();
      activeTaskId = null;
      showError('Mất kết nối khi kiểm tra trạng thái. Con thử lại sau nhé.');
    } finally {
      pollInFlight = false;
    }
  }

  async function startGenerate(): Promise<void> {
    if (code.length === 0) return;

    // Honeypot: a bot filled the hidden field — silently ignore, no network.
    if (honeypotInput && honeypotInput.value) return;

    const accessCode = code.toUpperCase();
    const topic = topicValues[topicIndex] || '';
    const interests = interestsInput?.value.trim() ?? '';

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
        showError(
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
        showError('Chưa nhận được phản hồi từ hệ thống. Con thử lại nhé.');
        return;
      }

      activeTaskId = result.task_id;
      const taskId = result.task_id;
      pollGenerationStatus(accessCode, taskId);
      pollTimer = setInterval(() => pollGenerationStatus(accessCode, taskId), POLL_INTERVAL_MS);
    } catch (err) {
      showError('Mạng không ổn định. Con thử lại sau ít phút nhé.');
    } finally {
      if (generateBtn) generateBtn.disabled = false;
      syncGenerateBtn();
    }
  }

  // ---- Wiring ---------------------------------------------------------------
  codeInput?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    let value = target.value.toUpperCase();
    if (value.length > MAX_CODE_LENGTH) value = value.slice(0, MAX_CODE_LENGTH);
    target.value = value;
    code = value;
    syncGenerateBtn();
  });

  tiles.forEach((tile, index) => {
    tile.addEventListener('click', () => {
      topicIndex = index;
      tiles.forEach((other, otherIndex) => {
        const selected = otherIndex === index;
        other.classList.toggle('fx-topic--selected', selected);
        if (other.tagName === 'BUTTON') other.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  generateBtn?.addEventListener('click', startGenerate);
  resetBtn?.addEventListener('click', reset);
  retryBtn?.addEventListener('click', backToBuild);

  syncGenerateBtn();
  setPhase('build');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBuilder, { once: true });
} else {
  initBuilder();
}
