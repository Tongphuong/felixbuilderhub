/**
 * Read2Lead lesson builder — vanilla-TS simulator state machine.
 *
 * Drives the 3 phases of /read2lead/build (build → generating → result).
 * No backend, no framework: all three phases live in the DOM and we only
 * flip `data-phase` on <main>; CSS reveals the matching `.phase-*` block.
 */

type Phase = 'build' | 'generating' | 'result';

interface BuilderState {
  phase: Phase;
  code: string;
  topic: number | null;
  stage: number;
}

const MAX_CODE_LENGTH = 16;
const STAGE_INTERVAL_MS = 1300;
const RESULT_DELAY_MS = 900;
const REDUCED_MOTION_DELAY_MS = 200;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const STAGE_LABELS = [
  'Đang viết câu chuyện riêng cho con…',
  'Đang chuẩn bị phần nghe…',
  'Đang ghi âm các cụm câu…',
  'Đang chuẩn bị nhiệm vụ web…',
];

function initBuilder(): void {
  const mainQuery = document.querySelector<HTMLElement>('main[data-phase]');
  if (!mainQuery) return;
  const mainEl: HTMLElement = mainQuery;

  const codeInput = document.querySelector<HTMLInputElement>('input[name="code"]');
  const generateBtn = document.querySelector<HTMLButtonElement>('#generate-btn');
  const resetBtn = document.querySelector<HTMLButtonElement>('#reset');
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-topic]'));
  const stageLabel = document.querySelector<HTMLElement>('#stage-label');
  const progressFill = document.querySelector<HTMLElement>('#gen-progress .fx-progress__fill');
  const progressBar = document.querySelector<HTMLElement>('#gen-progress .fx-progress');
  const resultCode = document.querySelector<HTMLElement>('#result-code');
  const resultTopic = document.querySelector<HTMLElement>('#result-topic');

  // Topic labels are read from the rendered tiles so they never drift from markup.
  const topicLabels = tiles.map(
    (tile) => tile.querySelector('.fx-topic__label')?.textContent?.trim() ?? '',
  );

  const state: BuilderState = { phase: 'build', code: '', topic: null, stage: 0 };
  let timer: ReturnType<typeof setInterval> | undefined;
  let resultTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    if (resultTimer !== undefined) {
      clearTimeout(resultTimer);
      resultTimer = undefined;
    }
  }

  function setPhase(phase: Phase): void {
    state.phase = phase;
    mainEl.dataset.phase = phase;
  }

  function syncGenerateBtn(): void {
    if (generateBtn) generateBtn.disabled = state.code.length === 0;
  }

  function renderStage(): void {
    if (stageLabel) stageLabel.textContent = STAGE_LABELS[state.stage];
    const pct = ((state.stage + 1) / 4) * 100;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function switchToResult(): void {
    clearTimers();
    if (resultCode) resultCode.textContent = state.code;
    if (resultTopic) {
      resultTopic.textContent = state.topic !== null ? topicLabels[state.topic] : '';
    }
    setPhase('result');
  }

  function advanceStage(): void {
    if (state.stage >= STAGE_LABELS.length - 1) {
      clearTimers();
      resultTimer = setTimeout(switchToResult, RESULT_DELAY_MS);
      return;
    }
    state.stage += 1;
    renderStage();
  }

  function startGenerate(): void {
    if (state.code.length === 0) return;
    state.stage = 0;
    // Reduced motion: skip the animated generating phase, jump straight to result.
    if (prefersReducedMotion()) {
      resultTimer = setTimeout(switchToResult, REDUCED_MOTION_DELAY_MS);
      return;
    }
    setPhase('generating');
    renderStage();
    timer = setInterval(advanceStage, STAGE_INTERVAL_MS);
  }

  function reset(): void {
    clearTimers();
    state.code = '';
    state.topic = null;
    state.stage = 0;
    if (codeInput) codeInput.value = '';
    tiles.forEach((tile) => {
      tile.classList.remove('fx-topic--selected');
      if (tile.tagName === 'BUTTON') tile.setAttribute('aria-pressed', 'false');
    });
    syncGenerateBtn();
    setPhase('build');
  }

  codeInput?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    let value = target.value.toUpperCase();
    if (value.length > MAX_CODE_LENGTH) value = value.slice(0, MAX_CODE_LENGTH);
    target.value = value;
    state.code = value;
    syncGenerateBtn();
  });

  tiles.forEach((tile, index) => {
    tile.addEventListener('click', () => {
      state.topic = index;
      tiles.forEach((other, otherIndex) => {
        const selected = otherIndex === index;
        other.classList.toggle('fx-topic--selected', selected);
        if (other.tagName === 'BUTTON') other.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  generateBtn?.addEventListener('click', startGenerate);
  resetBtn?.addEventListener('click', reset);

  syncGenerateBtn();
  setPhase('build');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBuilder, { once: true });
} else {
  initBuilder();
}
