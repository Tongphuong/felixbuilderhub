/**
 * REFERENCE IMPLEMENTATION — client script for the Read2Lead home hub.
 * Adapt from / replace src/scripts/r2l-start.client.ts.
 *
 * What changed vs the old topic-picker script:
 *   - Removed all topic-tile / interests logic (topic picker is gone).
 *   - After token resolve, fetch /api/read2lead-progress and render the child's world
 *     (rank medal + label, streak, coins, current book) and decide continue-vs-create.
 *   - startGenerate() posts topic:'' (server ignores it).
 *   - Fills #speak-link / #hoso-link / #shop-link / #continue-link hrefs with the code.
 *   - The generate + poll + result/error flow is unchanged from the original.
 *
 * The three helpers below (buildHeroCta / statusMeta / rankMeta) are trimmed copies of the
 * canonical logic in src/pages/ho-so/ho-so-kid-view.ts. PREFER extracting the real ones into
 * a shared module (e.g. src/lib/r2l-progress.ts) and importing them in both places.
 */

type Phase = 'resolving' | 'error' | 'ready' | 'generating' | 'result' | 'gen-error';

const STAGE_INTERVAL_MS = 15000;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

const STAGE_LABELS = [
  'Đang chọn truyện phù hợp với con…',
  'Đang chuẩn bị phần nghe…',
  'Đang ghi âm các cụm câu…',
  'Đang chuẩn bị nhiệm vụ đọc…',
];

// tier_index (0..7) → { label, medal }. Mirrors PROFILE_TIERS in ho-so-kid-view.ts.
const TIERS = [
  { label: 'Đồng',       medal: 'rank-l1-bronze.svg' },
  { label: 'Bạc',        medal: 'rank-l2-silver.svg' },
  { label: 'Vàng',       medal: 'rank-l3-gold.svg' },
  { label: 'Bạch Kim',   medal: 'rank-l2-silver.svg' },
  { label: 'Kim Cương',  medal: 'rank-l4-diamond.svg' },
  { label: 'Tinh Anh',   medal: 'rank-l5-legend.svg' },
  { label: 'Cao Thủ',    medal: 'rank-l5-legend.svg' },
  { label: 'Thách Đấu',  medal: 'rank-l5-legend.svg' },
];

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---- Trimmed copies of ho-so logic (prefer importing the canonical versions) ---------------
function statusMeta(state: string, pack: any): { label: string; completed: boolean; step: number } {
  if (!pack) return { label: 'Chưa có bài', completed: false, step: 0 };
  if (state === 'generation_in_progress' || pack.status === 'generation_in_progress')
    return { label: 'Đang tạo', completed: false, step: 0 };
  if (['reviewed'].includes(state) || String(pack.status || '').startsWith('reviewed_pass'))
    return { label: 'Đã xong', completed: true, step: 3 };
  const steps = pack.web_lesson_steps || {};
  if (steps.read_completed_at) return { label: 'Làm bài', completed: false, step: 2 };
  if (steps.listen_completed_at) return { label: 'Đang nghe', completed: false, step: 1 };
  return { label: 'Sẵn sàng', completed: false, step: 1 };
}

function buildHeroCta(pack: any, data: any, code: string):
  { action: 'lesson' | 'create'; href: string | null } {
  const encoded = encodeURIComponent(code);
  if (!pack) return { action: 'create', href: null };
  if (data.state === 'generation_in_progress' || pack.status === 'generation_in_progress')
    return { action: 'create', href: null }; // treat "still generating" as create-able here
  if (String(pack.status || '').startsWith('reviewed_pass') || data.state === 'reviewed')
    return { action: 'create', href: null };
  return {
    action: 'lesson',
    href: `/read2lead/lesson?code=${encoded}&pack_id=${encodeURIComponent(String(pack.pack_id || ''))}`,
  };
}
// -------------------------------------------------------------------------------------------

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

  // world + links
  const speakLink = $<HTMLAnchorElement>('#speak-link');
  const hosoLink = $<HTMLAnchorElement>('#hoso-link');
  const shopLink = $<HTMLAnchorElement>('#shop-link');
  const continueLink = $<HTMLAnchorElement>('#continue-link');
  const ctaContinue = $('#cta-continue');
  const ctaCreate = $('#cta-create');
  const rankMedal = $<HTMLImageElement>('#rank-medal');
  const rankLabelEl = $('#rank-label');
  const statStreak = $('#stat-streak');
  const statCoins = $('#stat-coins');
  const shopCoins = $('#shop-coins');
  const bookTitle = $('#book-title');
  const bookPct = $('#book-pct');
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
    if (phase === 'ready' || phase === 'resolving') window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const clearStageTimer = () => { if (stageTimer) { clearInterval(stageTimer); stageTimer = undefined; } };
  const clearPollTimer = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; } };

  // ---- Render the child's world from the progress payload ----------------------------------
  function renderWorld(data: any): void {
    const progress = data?.progress || {};
    const stateObj = data?.read2lead_state || {};
    const ladder = stateObj.rank_ladder || {};
    const tierIndex = Math.max(0, Math.min(7, Number(ladder.tier_index) || 0));
    const tier = TIERS[tierIndex];

    if (rankMedal) rankMedal.src = `/assets/r2l/ranks/${tier.medal}`;
    if (rankLabelEl) rankLabelEl.textContent = ladder.label_vi || stateObj.rank_title || tier.label;
    if (statStreak) statStreak.textContent = String(Number(stateObj.streak_days || 0));
    if (statCoins) statCoins.textContent = String(Number(stateObj.coins || 0));
    if (shopCoins) shopCoins.textContent = String(Number(stateObj.coins || 0));

    // OPTIONAL: render the real pet if the child has one (see monster-avatar.ts / ho-so).
    // const monster = stateObj.avatar?.monster;
    // if (monster) renderMonster(document.querySelector('#pet-slot'), monster, { size: 'large' });

    // Contextual primary
    const pack = progress.current_pack;
    const cta = buildHeroCta(pack, data, accessCode);
    if (cta.action === 'lesson' && pack) {
      const pct = Math.round((statusMeta(data.state || '', pack).step / 3) * 100);
      if (bookTitle) bookTitle.textContent = pack.story_title || 'Truyện của con';
      if (bookPct) bookPct.textContent = `${pct}%`;
      if (bookFill) (bookFill as HTMLElement).style.width = `${pct}%`;
      if (bookBar) bookBar.setAttribute('aria-valuenow', String(pct));
      if (continueLink && cta.href) continueLink.href = cta.href;
      if (ctaContinue) ctaContinue.hidden = false;
      if (ctaCreate) ctaCreate.hidden = true;
    } else {
      if (ctaContinue) ctaContinue.hidden = true;
      if (ctaCreate) ctaCreate.hidden = false;
    }
  }

  // ---- Token resolution --------------------------------------------------------------------
  async function resolveToken(): Promise<void> {
    const token = new URLSearchParams(window.location.search).get('t');
    if (!token) {
      if (errorMessage) errorMessage.textContent = 'Link thiếu mã. Nhờ bố mẹ mở lại giúp con nhé.';
      setPhase('error');
      return;
    }
    try {
      const res = await fetch(`/api/r2l-link?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (errorMessage) errorMessage.textContent = data.message || 'Link không hợp lệ hoặc đã hết hạn.';
        setPhase('error');
        return;
      }
      accessCode = data.access_code || '';
      studentName = data.student_name || '';
      try { sessionStorage.setItem('r2l_access_code', accessCode); } catch { /* private mode */ }

      if (greetingName) greetingName.textContent = studentName || 'bạn nhỏ';
      if (greetingLevel) greetingLevel.textContent = data.level || 'L1';
      const c = encodeURIComponent(accessCode);
      if (speakLink) speakLink.href = `/speak-up?code=${c}`;
      if (hosoLink) hosoLink.href = `/ho-so?code=${c}`;
      if (shopLink) shopLink.href = `/read2lead/shop?code=${c}&v3=1`;

      setPhase('ready');

      // Fetch the world data (rank / streak / coins / current book). Non-blocking.
      try {
        const pRes = await fetch(`/api/read2lead-progress?code=${c}`);
        if (pRes.ok) renderWorld(await pRes.json());
      } catch { /* keep the default 'create' CTA if progress can't load */ }
    } catch {
      if (errorMessage) errorMessage.textContent = 'Mất kết nối. Kiểm tra mạng rồi thử mở lại link.';
      setPhase('error');
    }
  }

  // ---- Generate + poll (unchanged flow) ----------------------------------------------------
  function startCosmeticStages(): void {
    let stage = 0;
    const render = () => {
      if (stageLabel) stageLabel.textContent = STAGE_LABELS[stage];
      const pct = Math.min(90, ((stage + 1) / STAGE_LABELS.length) * 90);
      if (progressFill) (progressFill as HTMLElement).style.width = `${pct}%`;
      if (progressBar) progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    };
    render();
    if (prefersReducedMotion()) return;
    stageTimer = setInterval(() => { stage = Math.min(stage + 1, STAGE_LABELS.length - 1); render(); }, STAGE_INTERVAL_MS);
  }

  function showResult(data: any): void {
    clearStageTimer(); clearPollTimer(); generationComplete = true; activeTaskId = null;
    if (resultName) resultName.textContent = studentName || data.child_name || '';
    if (data.story_title && resultStory && resultStoryTitle) {
      resultStoryTitle.textContent = data.story_title;
      (resultStory as HTMLElement).hidden = false;
    } else if (resultStory) { (resultStory as HTMLElement).hidden = true; }
    setPhase('result');
    if (openLesson) openLesson.href = data.lesson_link || '/read2lead/lesson';
    // (Keep the original activateOpenLessonWhenReady() gate here if you had it.)
  }

  function showGenError(msg: string): void {
    if (generationComplete) return;
    clearStageTimer(); clearPollTimer(); activeTaskId = null; pollInFlight = false;
    if (genErrorMessage) genErrorMessage.textContent = msg || 'Có lỗi xảy ra, con thử lại nhé.';
    setPhase('gen-error');
  }

  function backToReady(): void {
    clearStageTimer(); clearPollTimer(); pollInFlight = false; activeTaskId = null;
    generationComplete = false; pollAttempts = 0; setPhase('ready');
  }

  async function pollGenerationStatus(code: string, taskId: string): Promise<void> {
    if (generationComplete || activeTaskId !== taskId || pollInFlight) return;
    pollInFlight = true;
    try {
      const res = await fetch(`/api/check-generation-status?access_code=${encodeURIComponent(code)}&task_id=${encodeURIComponent(taskId)}`);
      const result = await res.json();
      if (generationComplete || activeTaskId !== taskId) return;
      if (result.status === 'pending') {
        pollAttempts += 1;
        if (genNote) genNote.textContent = 'Minny vẫn đang chuẩn bị bài cho con, đợi một chút nhé…';
        if (pollAttempts >= MAX_POLL_ATTEMPTS) {
          clearPollTimer(); activeTaskId = null;
          showGenError('Tạo bài hơi lâu. Con thử lại hoặc nhắn Zalo Felix nhé.');
        }
        return;
      }
      clearPollTimer(); activeTaskId = null;
      if (result.status === 'done' && result.lesson_link) showResult(result);
      else showGenError(result.message || result.error || 'Tạo bài chưa thành công, con thử lại nhé.');
    } catch {
      if (generationComplete || activeTaskId !== taskId) return;
      clearPollTimer(); activeTaskId = null;
      showGenError('Mất kết nối khi kiểm tra trạng thái. Con thử lại sau nhé.');
    } finally { pollInFlight = false; }
  }

  async function startGenerate(): Promise<void> {
    if (!accessCode) return;
    if (honeypotInput && honeypotInput.value) return; // bot

    generationComplete = false; activeTaskId = null; pollAttempts = 0; pollInFlight = false;
    if (generateBtn) generateBtn.disabled = true;
    if (generateBtnCreate) generateBtnCreate.disabled = true;

    setPhase('generating');
    if (genNote) genNote.textContent = 'Lần đầu có thể chậm hơn một chút vì máy chủ cần khởi động.';
    startCosmeticStages();

    try {
      const res = await fetch('/api/generate-read2lead-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode, topic: '', interests: '', website: '' }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) { showGenError(result.message || result.error || 'Có lỗi xảy ra, con thử lại nhé.'); return; }
      if (result.status === 'done' && result.lesson_link) { showResult(result); return; }
      if (!result.task_id) { showGenError('Chưa nhận được phản hồi từ hệ thống. Con thử lại nhé.'); return; }
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

  // ---- Wiring ------------------------------------------------------------------------------
  generateBtn?.addEventListener('click', startGenerate);
  generateBtnCreate?.addEventListener('click', startGenerate);
  resetBtn?.addEventListener('click', backToReady);
  retryBtn?.addEventListener('click', backToReady);

  setPhase('resolving');
  void resolveToken();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStart, { once: true });
else initStart();
