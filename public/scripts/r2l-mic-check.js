/**
 * Read2Lead microphone check — browser + OS permission help, level meter, test recording.
 * Loaded on lesson (speak activities) and /read2lead/speaking.
 */
(function initR2LMicCheck(global) {
  const STORAGE_KEY = 'r2l_mic_ok_v1';
  const LEVEL_SAMPLE_MS = 120;
  const TEST_SECONDS = 4;
  const SILENT_LEVEL = 6;
  const MIN_BLOB_BYTES = 400;

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
        'Hoặc bấm aA trên thanh địa chỉ → Cài đặt trang web → Micro → Cho phép',
        'Tắt chế độ ẩn danh nếu đang dùng — micro thường bị chặn',
      ];
    }
    if (browser === 'edge') {
      return [
        `Bấm 🔒 bên trái thanh địa chỉ → Quyền cho trang này → Microphone → Cho phép`,
        `Edge → Cài đặt → Cookies và quyền trang → ${host} → Micro → Cho phép`,
      ];
    }
    return [
      `Bấm 🔒 / ⓘ bên trái thanh địa chỉ → Microphone → Cho phép`,
      `Chrome → Cài đặt → Quyền riêng tư và bảo mật → Cài đặt trang → ${host} → Micro → Cho phép`,
      'Không mở trong Zalo/Facebook — hãy mở bằng Chrome hoặc Safari',
    ];
  }

  function osSteps(platform) {
    if (platform === 'windows') {
      return [
        'Windows → Cài đặt → Quyền riêng tư và bảo mật → Microphone',
        'Bật "Quyền truy cập micro" và "Cho phép ứng dụng truy cập micro"',
        'Bật "Cho phép ứng dụng desktop truy cập micro" (quan trọng cho Chrome/Edge)',
        'Kiểm tra micro mặc định: Cài đặt → Hệ thống → Âm thanh → Input — nói thử xem thanh có nhảy không',
      ];
    }
    if (platform === 'mac' || platform === 'ios') {
      return [
        'Mac → Cài đặt hệ thống → Quyền riêng tư và bảo mật → Microphone',
        'Bật quyền cho Safari hoặc Chrome (tên app con đang dùng)',
        'Nếu dùng tai nghe/USB: chọn đúng micro trong Cài đặt → Âm thanh → Đầu vào',
      ];
    }
    if (platform === 'android') {
      return [
        'Cài đặt → Ứng dụng → Chrome → Quyền → Microphone → Cho phép',
        'Tắt tiết kiệm pin cho Chrome nếu micro hay bị tắt giữa chừng',
      ];
    }
    return [
      'Kiểm tra micro trong Cài đặt hệ thống → Quyền riêng tư → Microphone',
      'Đảm bảo trình duyệt (Chrome/Safari) được phép dùng micro',
    ];
  }

  function helpMessage(error) {
    if (error && isPermissionError(error)) {
      return 'Trình duyệt đang chặn micro. Ba mẹ làm theo hướng dẫn bên dưới rồi bấm Thử lại nhé.';
    }
    if (error?.name === 'NotFoundError') {
      return 'Không tìm thấy micro. Con thử cắm tai nghe hoặc kiểm tra micro laptop có bị tắt không.';
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
    return !!(navigator.mediaDevices?.getUserMedia && global.MediaRecorder);
  }

  function sessionPassed() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
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

  function pickMimeType() {
    const candidates = [
      'audio/mp4',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
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

  async function openMicStream(deviceId) {
    const audio = deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    return navigator.mediaDevices.getUserMedia({ audio });
  }

  function renderHelpList(steps) {
    return `<ol class="r2l-mic-check__steps">${steps
      .map((step) => `<li>${step}</li>`)
      .join('')}</ol>`;
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

    let activeStream = null;
    let testBlobUrl = '';
    let testAudio = null;
    let running = false;

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
      const steps = [
        ...browserSteps(platform, browser),
        ...osSteps(platform),
      ];
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

    function setPassed() {
      root.dataset.state = 'passed';
      markSessionPassed();
      if (passBadge) passBadge.hidden = false;
      if (testBtn) testBtn.hidden = true;
      if (retryBtn) retryBtn.hidden = true;
      if (meterWrap) meterWrap.hidden = true;
      hideHelp();
      setStatus('Micro hoạt động tốt! Con có thể bấm Con nói nhé.', 'ok');
      onPass();
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

    async function runTest() {
      if (running) return;
      if (!hasRecordingCapability()) {
        setStatus('Trình duyệt chưa hỗ trợ thu âm.', 'error');
        showHelp(new Error('unsupported'));
        onFail({ reason: 'unsupported' });
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
      setStatus('Con nói "Hello Minny" to và rõ nhé...', 'active');
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

        audioContext = new AudioContext();
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
          setStatus('Chưa thu được tiếng. Con thử micro khác hoặc nói sát mic hơn.', 'error');
          showHelp(new Error('empty_blob'));
          if (retryBtn) retryBtn.hidden = false;
          applyBlockedUi(blockUntilPass);
          onFail({ reason: 'empty_blob', peak });
          return;
        }

        if (peak < SILENT_LEVEL) {
          setStatus(
            'Micro có thể đang bị tắt trong Cài đặt Windows/Mac, hoặc chọn nhầm thiết bị.',
            'error',
          );
          showHelp(new Error('silent'));
          if (retryBtn) retryBtn.hidden = false;
          applyBlockedUi(blockUntilPass);
          onFail({ reason: 'silent', peak });
          return;
        }

        testBlobUrl = URL.createObjectURL(blob);
        if (playBtn) playBtn.hidden = false;
        setPassed();
        applyBlockedUi(false);
      } catch (error) {
        if (meterTimer) global.clearInterval(meterTimer);
        cleanupStream();
        setStatus(helpMessage(error), 'error');
        showHelp(error);
        if (retryBtn) retryBtn.hidden = false;
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

    if (sessionPassed()) {
      setPassed();
      applyBlockedUi(false);
    } else {
      root.dataset.state = 'idle';
      setStatus('Bước đầu: kiểm tra micro trước khi nói với Minny.');
      applyBlockedUi(blockUntilPass);
    }

    probePermission().then((perm) => {
      if (perm === 'denied' && !sessionPassed()) {
        setStatus('Trình duyệt đang chặn micro. Ba mẹ xem hướng dẫn bên dưới.', 'error');
        showHelp({ name: 'NotAllowedError' });
      }
    });
  }

  function mountAll(selector, options) {
    document.querySelectorAll(selector).forEach((el) => mount(el, options));
  }

  global.R2LMicCheck = {
    STORAGE_KEY,
    detectPlatform,
    detectBrowser,
    helpMessage,
    browserSteps,
    osSteps,
    hasRecordingCapability,
    sessionPassed,
    markSessionPassed,
    mount,
    mountAll,
    isPermissionError,
  };
})(window);
