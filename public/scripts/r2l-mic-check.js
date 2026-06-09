/**
 * Read2Lead microphone check — browser + OS permission help, level meter, test recording.
 */
(function initR2LMicCheck(global) {
  const STORAGE_KEY = 'r2l_mic_ok_v1';
  const STORAGE_PARENT_SKIP = 'r2l_mic_parent_skip_v1';
  const MIC_WARMUP_SECONDS = 3;
  const LEVEL_SAMPLE_MS = 100;
  const TEST_SECONDS = 3;
  const SILENT_LEVEL = 4;
  const MIN_BLOB_BYTES = 280;

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Mac/i.test(ua)) return 'mac';
    if (/Win/i.test(ua)) return 'windows';
    return 'other';
  }

  function detectBrowser() {
    const ua = navigator.userAgent || '';
    if (/Edg\//i.test(ua)) return 'edge';
    if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'chrome';
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'safari';
    if (/Firefox/i.test(ua)) return 'firefox';
    return 'other';
  }

  function isInAppBrowser() {
    const ua = navigator.userAgent || '';
    if (/FBAN|FBAV|Instagram|Line\/|Zalo|MicroMessenger|Twitter|TikTok|Snapchat/i.test(ua)) {
      return true;
    }
    if (/Android/i.test(ua) && /\bwv\b/i.test(ua)) return true;
    return false;
  }

  function isSecureContextOk() {
    try {
      return global.isSecureContext === true;
    } catch {
      return false;
    }
  }

  function isPermissionError(err) {
    const name = err?.name || '';
    return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
  }

  function hostLabel() {
    try {
      return global.location?.hostname || 'felixbuilderhub.com';
    } catch {
      return 'felixbuilderhub.com';
    }
  }

  function browserSteps(platform, browser) {
    const host = hostLabel();
    if (browser === 'safari' || platform === 'ios') {
      return [
        `Safari → Cài đặt (⚙️) → Websites → Microphone → chọn Allow cho ${host}`,
        'iPhone/iPad: Cài đặt → Safari → Microphone → Bật',
        'Bấm aA trên thanh địa chỉ → Cài đặt trang web → Micro → Cho phép',
        'Tắt chế độ ẩn danh — micro thường bị chặn',
        'Không mở link trong Zalo/Facebook — copy link và mở bằng Safari',
      ];
    }
    if (browser === 'edge') {
      return [
        'Bấm 🔒 bên trái thanh địa chỉ → Quyền cho trang này → Microphone → Cho phép',
        `Edge → Cài đặt → Cookies và quyền trang → ${host} → Micro → Cho phép`,
        'Nếu vẫn lỗi: tắt extension chặn quyền (adblock, privacy)',
      ];
    }
    return [
      'Bấm 🔒 / ⓘ bên trái thanh địa chỉ → Microphone → Cho phép',
      `Chrome → Cài đặt → Quyền riêng tư → Cài đặt trang → ${host} → Micro → Cho phép`,
      'Không mở trong Zalo/Facebook — copy link, dán vào Chrome hoặc Safari',
      'Tắt tab ẩn danh nếu đang dùng',
    ];
  }

  function osSteps(platform) {
    if (platform === 'windows') {
      return [
        'Windows → Cài đặt → Quyền riêng tư và bảo mật → Microphone',
        'Bật "Quyền truy cập micro"',
        'Bật "Cho phép ứng dụng truy cập micro"',
        'Bật "Cho phép ứng dụng desktop truy cập micro" (bắt buộc cho Chrome/Edge)',
        'Cài đặt → Hệ thống → Âm thanh → Input: chọn đúng micro, nói thử xem thanh có nhảy',
        'Nếu dùng tai nghe Bluetooth: ngắt/kết nối lại rồi chọn lại micro trong danh sách',
      ];
    }
    if (platform === 'mac' || platform === 'ios') {
      return [
        'Mac → Cài đặt hệ thống → Quyền riêng tư và bảo mật → Microphone',
        'Bật quyền cho Safari hoặc Google Chrome (đúng app con đang dùng)',
        'Mac → Cài đặt hệ thống → Âm thanh → Đầu vào: chọn micro đúng, nói thử',
        'Nếu dùng tai nghe: chọn micro tai nghe trong danh sách micro của trang',
        'Tắt Screen Time / Giới hạn nếu có chặn micro',
      ];
    }
    if (platform === 'android') {
      return [
        'Cài đặt → Ứng dụng → Chrome → Quyền → Microphone → Cho phép',
        'Mở bằng Chrome, không mở trong app Zalo/Facebook',
      ];
    }
    return [
      'Kiểm tra Cài đặt hệ thống → Quyền riêng tư → Microphone',
      'Đảm bảo trình duyệt được phép dùng micro',
    ];
  }

  function fullHelpText(platform, browser) {
    const lines = [
      'Hướng dẫn bật micro — Read2Lead',
      `Trình duyệt: ${browser} · Máy: ${platform}`,
      '',
      'Trong trình duyệt:',
      ...browserSteps(platform, browser).map((s, i) => `${i + 1}. ${s}`),
      '',
      'Trong Windows / Mac:',
      ...osSteps(platform).map((s, i) => `${i + 1}. ${s}`),
    ];
    return lines.join('\n');
  }

  function helpMessage(error) {
    if (isInAppBrowser()) {
      return 'App Zalo/Facebook thường chặn micro. Ba mẹ copy link và mở bằng Chrome hoặc Safari nhé.';
    }
    if (!isSecureContextOk()) {
      return 'Trang cần mở bằng https (không phải http) thì micro mới hoạt động.';
    }
    if (error && isPermissionError(error)) {
      return 'Trình duyệt hoặc Windows/Mac đang chặn micro. Ba mẹ làm theo hướng dẫn bên dưới rồi bấm Thử lại.';
    }
    if (error?.name === 'NotFoundError') {
      return 'Không tìm thấy micro. Con thử cắm tai nghe hoặc kiểm tra micro laptop.';
    }
    if (error?.message === 'silent' || error?.name === 'silent') {
      return 'Micro có thể bị tắt trong Windows/Mac, hoặc đang chọn nhầm thiết bị âm thanh.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'Trình duyệt này chưa hỗ trợ micro. Con mở bằng Chrome hoặc Safari mới nhất nhé.';
    }
    if (typeof MediaRecorder === 'undefined') {
      return 'Trình duyệt chưa hỗ trợ thu âm. Con thử Safari hoặc Chrome trên máy tính nhé.';
    }
    return 'Không mở được micro. Ba mẹ kiểm tra quyền micro trong Cài đặt máy và trình duyệt.';
  }

  function hasRecordingCapability() {
    return !!(navigator.mediaDevices?.getUserMedia && global.MediaRecorder && isSecureContextOk());
  }

  function sessionPassed() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1' || sessionStorage.getItem(STORAGE_PARENT_SKIP) === '1';
    } catch {
      return false;
    }
  }

  function markSessionPassed() {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function markParentSkip() {
    try {
      sessionStorage.setItem(STORAGE_PARENT_SKIP, '1');
    } catch {
      /* ignore */
    }
  }

  function pickMimeType() {
    const candidates = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
    for (const mimeType of candidates) {
      try {
        if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(mimeType)) {
          continue;
        }
        return mimeType;
      } catch {
        /* try next */
      }
    }
    return '';
  }

  function createMediaRecorder(stream) {
    const mimeType = pickMimeType();
    if (mimeType) {
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      return { mediaRecorder, mimeType: mediaRecorder.mimeType || mimeType };
    }
    const mediaRecorder = new MediaRecorder(stream);
    return { mediaRecorder, mimeType: mediaRecorder.mimeType || 'audio/mp4' };
  }

  function stopMediaRecorder(mediaRecorder) {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    try {
      mediaRecorder.requestData();
    } catch {
      /* optional */
    }
    mediaRecorder.stop();
  }

  function readPeakLevel(analyser, buffer) {
    analyser.getByteTimeDomainData(buffer);
    let peak = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const amp = Math.abs(buffer[i] - 128);
      if (amp > peak) peak = amp;
    }
    return peak;
  }

  async function listAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  async function probePermission() {
    if (!navigator.permissions?.query) return 'unknown';
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => global.setTimeout(resolve, ms));
  }

  /**
   * iOS/Safari often drops the first syllable unless the audio pipeline warms up first.
   * Call after getUserMedia, before MediaRecorder.start().
   */
  async function runMicWarmupCountdown(options = {}) {
    const total = Number(options.seconds) > 0 ? Number(options.seconds) : MIC_WARMUP_SECONDS;
    const onMessage = typeof options.onMessage === 'function' ? options.onMessage : () => {};

    for (let left = total; left >= 1; left -= 1) {
      if (left === total) {
        onMessage(`Micro đã bật — chờ ${left} giây rồi mới nói nhé…`, left);
      } else if (left === 1) {
        onMessage(`Còn ${left} giây… sắp bắt đầu!`, left);
      } else {
        onMessage(`Còn ${left} giây… chưa nói vội nhé`, left);
      }
      await sleep(1000);
    }
    onMessage('Bắt đầu nói!', 0);
  }

  async function primeAudioPipeline(stream) {
    if (!stream) return null;
    try {
      const audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buffer);
      return audioContext;
    } catch {
      return null;
    }
  }

  async function openMicStream(deviceId) {
    const base = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    const audio = deviceId
      ? { ...base, deviceId: { ideal: deviceId } }
      : base;
    return navigator.mediaDevices.getUserMedia({ audio });
  }

  function renderHelpList(steps) {
    return `<ol class="r2l-mic-check__steps">${steps
      .map((step) => `<li>${step}</li>`)
      .join('')}</ol>`;
  }

  function scrollToPanel(root) {
    if (!root) return;
    root.classList.add('r2l-mic-check--attention');
    global.setTimeout(() => root.classList.remove('r2l-mic-check--attention'), 2400);
    try {
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      root.scrollIntoView();
    }
  }

  function mount(root, options = {}) {
    if (!root || root.dataset.r2lMicMounted === 'true') return;
    root.dataset.r2lMicMounted = 'true';

    const platform = detectPlatform();
    const browser = detectBrowser();
    const onPass = typeof options.onPass === 'function' ? options.onPass : () => {};
    const onFail = typeof options.onFail === 'function' ? options.onFail : () => {};
    const blockUntilPass = options.blockUntilPass !== false;

    const statusEl = root.querySelector('[data-mic-status]');
    const meterBar = root.querySelector('[data-mic-meter-bar]');
    const meterWrap = root.querySelector('[data-mic-meter]');
    const testBtn = root.querySelector('[data-mic-test]');
    const playBtn = root.querySelector('[data-mic-play]');
    const retryBtn = root.querySelector('[data-mic-retry]');
    const helpEl = root.querySelector('[data-mic-help]');
    const deviceSelect = root.querySelector('[data-mic-device]');
    const passBadge = root.querySelector('[data-mic-pass]');
    const envWarnEl = root.querySelector('[data-mic-env-warn]');
    const parentSkipBtn = root.querySelector('[data-mic-parent-skip]');
    const copyHelpBtn = root.querySelector('[data-mic-copy-help]');

    let activeStream = null;
    let testBlobUrl = '';
    let testAudio = null;
    let running = false;
    let failCount = 0;

    function setStatus(text, tone = 'neutral') {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.dataset.tone = tone;
    }

    function setMeterLevel(level) {
      if (!meterBar) return;
      const pct = Math.min(100, Math.round((level / 128) * 100));
      meterBar.style.width = `${pct}%`;
      meterBar.dataset.hot = level >= SILENT_LEVEL ? 'true' : 'false';
    }

    function showHelp(error) {
      if (!helpEl) return;
      helpEl.innerHTML = `
        <p class="r2l-mic-check__help-title">${helpMessage(error)}</p>
        <p class="r2l-mic-check__help-sub">Trình duyệt (${browser}) · Máy (${platform})</p>
        <details class="r2l-mic-check__details" open>
          <summary>Bước trong trình duyệt</summary>
          ${renderHelpList(browserSteps(platform, browser))}
        </details>
        <details class="r2l-mic-check__details" open>
          <summary>Bước trong Windows / Mac</summary>
          ${renderHelpList(osSteps(platform))}
        </details>
      `;
      helpEl.hidden = false;
      scrollToPanel(root);
    }

    function hideHelp() {
      if (helpEl) helpEl.hidden = true;
    }

    function cleanupStream() {
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
        activeStream = null;
      }
    }

    function showParentSkip() {
      if (!parentSkipBtn || failCount < 1) return;
      parentSkipBtn.hidden = false;
    }

    function setPassed(kind = 'test') {
      root.dataset.state = 'passed';
      if (kind === 'test') markSessionPassed();
      if (passBadge) passBadge.hidden = false;
      if (testBtn) testBtn.hidden = kind === 'test';
      if (retryBtn) retryBtn.hidden = true;
      if (parentSkipBtn) parentSkipBtn.hidden = true;
      if (meterWrap) meterWrap.hidden = true;
      hideHelp();
      if (envWarnEl) envWarnEl.hidden = true;
      setStatus(
        kind === 'parent'
          ? 'Ba mẹ xác nhận micro OK. Con thử bấm Con nói — nếu vẫn lỗi, làm lại Kiểm tra micro.'
          : 'Micro hoạt động tốt! Con có thể bấm Con nói nhé.',
        'ok',
      );
      onPass();
      applyBlockedUi(false);
    }

    function applyBlockedUi(blocked) {
      root.dataset.blocked = blocked ? 'true' : 'false';
      document.dispatchEvent(
        new CustomEvent('r2l-mic-gate', { detail: { ready: !blocked, root } }),
      );
    }

    async function populateDevices() {
      if (!deviceSelect) return;
      const inputs = await listAudioInputs();
      const withLabels = inputs.filter((d) => d.label);
      if (withLabels.length < 2) {
        deviceSelect.hidden = true;
        return;
      }
      deviceSelect.hidden = false;
      deviceSelect.innerHTML = withLabels
        .map(
          (d, i) =>
            `<option value="${d.deviceId}"${i === 0 ? ' selected' : ''}>${d.label}</option>`,
        )
        .join('');
    }

    function showEnvironmentBlockers() {
      if (isInAppBrowser()) {
        if (envWarnEl) {
          envWarnEl.hidden = false;
          envWarnEl.textContent =
            '⚠️ Đang mở trong app (Zalo/Facebook…). Micro thường không hoạt động. Ba mẹ copy link trang và mở bằng Chrome hoặc Safari.';
        }
        setStatus('Cần mở bằng Chrome hoặc Safari — không dùng app Zalo/Facebook.', 'error');
        showHelp({ name: 'NotAllowedError' });
        applyBlockedUi(blockUntilPass);
        return true;
      }
      if (!isSecureContextOk()) {
        setStatus('Trang chưa mở bằng https — micro sẽ không hoạt động.', 'error');
        showHelp(new Error('insecure'));
        applyBlockedUi(blockUntilPass);
        return true;
      }
      if (!hasRecordingCapability()) {
        setStatus('Trình duyệt chưa hỗ trợ thu âm.', 'error');
        showHelp(new Error('unsupported'));
        applyBlockedUi(blockUntilPass);
        return true;
      }
      return false;
    }

    async function runTest() {
      if (running) return;
      if (showEnvironmentBlockers()) {
        onFail({ reason: 'environment' });
        return;
      }

      running = true;
      hideHelp();
      if (testBlobUrl) {
        URL.revokeObjectURL(testBlobUrl);
        testBlobUrl = '';
      }
      if (playBtn) playBtn.hidden = true;
      if (passBadge) passBadge.hidden = true;
      if (testBtn) testBtn.disabled = true;
      if (retryBtn) retryBtn.hidden = true;
      root.dataset.state = 'testing';
      setStatus('Cho phép micro nếu trình duyệt hỏi...', 'active');
      if (meterWrap) meterWrap.hidden = false;
      setMeterLevel(0);

      let peak = 0;
      let audioContext = null;
      let meterTimer = null;

      try {
        const deviceId = deviceSelect?.value || '';
        const stream = await openMicStream(deviceId || undefined);
        activeStream = stream;
        await populateDevices();

        if (audioContext && audioContext.state !== 'closed') {
          await audioContext.close().catch(() => {});
        }
        audioContext = new AudioContext();
        if (audioContext.state === 'suspended') {
          await audioContext.resume().catch(() => {});
        }
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);

        meterTimer = global.setInterval(() => {
          const level = readPeakLevel(analyser, buffer);
          if (level > peak) peak = level;
          setMeterLevel(level);
        }, LEVEL_SAMPLE_MS);

        await runMicWarmupCountdown({
          onMessage: (msg) => setStatus(msg, 'active'),
        });
        setStatus('Giờ nói "Hello Minny" to và rõ nhé...', 'active');

        const { mediaRecorder, mimeType } = createMediaRecorder(stream);
        const chunks = [];
        mediaRecorder.addEventListener('dataavailable', (e) => {
          if (e.data?.size > 0) chunks.push(e.data);
        });

        const blobPromise = new Promise((resolve) => {
          mediaRecorder.addEventListener('stop', () => {
            resolve(new Blob(chunks, { type: mediaRecorder.mimeType || mimeType || 'audio/mp4' }));
          });
        });

        mediaRecorder.start(250);
        await new Promise((r) => global.setTimeout(r, TEST_SECONDS * 1000));
        stopMediaRecorder(mediaRecorder);
        const blob = await blobPromise;

        global.clearInterval(meterTimer);
        meterTimer = null;
        cleanupStream();
        if (audioContext) {
          await audioContext.close().catch(() => {});
        }

        if (blob.size < MIN_BLOB_BYTES) {
          failCount += 1;
          setStatus('Chưa thu được tiếng. Ba mẹ kiểm tra micro trong Windows/Mac (xem hướng dẫn).', 'error');
          showHelp(new Error('empty_blob'));
          if (retryBtn) retryBtn.hidden = false;
          showParentSkip();
          applyBlockedUi(blockUntilPass);
          onFail({ reason: 'empty_blob', peak });
          return;
        }

        if (peak < SILENT_LEVEL) {
          failCount += 1;
          setStatus('Thanh âm lượng không nhảy — micro có thể bị tắt ở Windows/Mac hoặc chọn nhầm thiết bị.', 'error');
          showHelp({ name: 'silent' });
          if (retryBtn) retryBtn.hidden = false;
          showParentSkip();
          applyBlockedUi(blockUntilPass);
          onFail({ reason: 'silent', peak });
          return;
        }

        testBlobUrl = URL.createObjectURL(blob);
        if (playBtn) playBtn.hidden = false;
        failCount = 0;
        setPassed('test');
      } catch (error) {
        failCount += 1;
        if (meterTimer) global.clearInterval(meterTimer);
        cleanupStream();
        setStatus(helpMessage(error), 'error');
        showHelp(error);
        if (retryBtn) retryBtn.hidden = false;
        showParentSkip();
        applyBlockedUi(blockUntilPass);
        onFail({ reason: 'error', error });
      } finally {
        running = false;
        if (testBtn) testBtn.disabled = false;
      }
    }

    testBtn?.addEventListener('click', () => runTest());
    retryBtn?.addEventListener('click', () => runTest());
    playBtn?.addEventListener('click', () => {
      if (!testBlobUrl) return;
      if (testAudio) {
        testAudio.pause();
        testAudio = null;
      }
      testAudio = new Audio(testBlobUrl);
      testAudio.play().catch(() => {});
    });

    parentSkipBtn?.addEventListener('click', () => {
      markParentSkip();
      setPassed('parent');
    });

    copyHelpBtn?.addEventListener('click', async () => {
      const text = fullHelpText(platform, browser);
      try {
        await navigator.clipboard.writeText(text);
        if (copyHelpBtn) copyHelpBtn.textContent = 'Đã copy!';
        global.setTimeout(() => {
          if (copyHelpBtn) copyHelpBtn.textContent = 'Copy hướng dẫn cho ba mẹ';
        }, 2000);
      } catch {
        global.prompt('Copy hướng dẫn này gửi cho ba mẹ:', text);
      }
    });

    if (sessionPassed()) {
      setPassed(sessionStorage.getItem(STORAGE_KEY) === '1' ? 'test' : 'parent');
    } else {
      root.dataset.state = 'idle';
      setStatus('Bước đầu: bấm Kiểm tra micro. Nếu Windows/Mac chặn, ba mẹ xem hướng dẫn bên dưới.');
      applyBlockedUi(blockUntilPass);
      if (showEnvironmentBlockers()) {
        onFail({ reason: 'environment' });
      } else {
        probePermission().then((perm) => {
          if (perm === 'denied' && !sessionPassed()) {
            setStatus('Trình duyệt đang chặn micro. Ba mẹ làm theo hướng dẫn bên dưới.', 'error');
            showHelp({ name: 'NotAllowedError' });
          }
        });
      }
    }
  }

  function mountAll(selector, options) {
    document.querySelectorAll(selector).forEach((el) => mount(el, options));
  }

  function focusMicHelpInShell(shell) {
    const panel = shell?.querySelector?.('[data-r2l-mic-check]') || shell;
    scrollToPanel(panel);
    const help = panel?.querySelector?.('[data-mic-help]');
    if (help) help.hidden = false;
  }

  global.R2LMicCheck = {
    STORAGE_KEY,
    STORAGE_PARENT_SKIP,
    detectPlatform,
    detectBrowser,
    isInAppBrowser,
    isSecureContextOk,
    helpMessage,
    browserSteps,
    osSteps,
    fullHelpText,
    hasRecordingCapability,
    sessionPassed,
    markSessionPassed,
    markParentSkip,
    MIC_WARMUP_SECONDS,
    openMicStream,
    getMicStream: openMicStream,
    runMicWarmupCountdown,
    primeAudioPipeline,
    mount,
    mountAll,
    scrollToPanel,
    focusMicHelpInShell,
    isPermissionError,
  };
})(window);
