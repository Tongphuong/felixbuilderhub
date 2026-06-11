/**
 * R2LRecorder — shared, battle-tested microphone capture engine for Read2Lead.
 *
 * Patterns borrowed from production voice apps:
 *  - Google Meet: a live AnalyserNode runs in parallel with every recording, so
 *    "no sound is reaching the mic" is detected ON THE CHILD'S MACHINE in real
 *    time (Meet's "Are you talking? You're muted" hint) — never discovered late
 *    by the ASR server returning an empty transcript.
 *  - Zoom: the microphone that passed the mic test is REMEMBERED and used for
 *    every later recording (deviceId persisted), so the test and the lesson can
 *    never silently record from two different devices.
 *  - Whisper-based voice apps: when the OS audio encoder is the broken link
 *    (analyser hears speech, server hears nothing) we fall back to capturing
 *    raw PCM and uploading WAV — no MediaRecorder, no platform codec involved.
 *
 * Self-healing ladder, persisted per machine in localStorage:
 *  profile 0: echoCancellation+noiseSuppression+autoGainControl (default)
 *  profile 1: noiseSuppression/echoCancellation OFF (Realtek NS gates kid voices)
 *  profile 2: all processing OFF (raw mic)
 *  engine 'wav': raw-PCM WAV capture instead of MediaRecorder.
 */
(function initR2LRecorder(global) {
  const DEVICE_KEY = 'r2l_mic_device_v1';
  const PROFILE_KEY = 'r2l_mic_profile_v1';
  const ENGINE_KEY = 'r2l_rec_engine_v1';
  const LEVEL_SAMPLE_MS = 100;
  // Same threshold the mic-check meter uses: byte-domain amplitude (0..128).
  const SILENT_LEVEL = 4;
  // If the blob is this large, trust MediaRecorder even when the level meter read 0
  // (iOS can leave AudioContext suspended so the analyser never moves).
  const TRUST_BLOB_BYTES = 20000;
  // Warn the child if this much recording time passed with no signal at all.
  const SILENCE_HINT_MS = 3000;
  const WAV_TARGET_RATE = 16000; // Whisper's native rate; keeps uploads small.
  const WAV_MAX_SECONDS = 120;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }

  /* ---------- device memory (Zoom pattern) ---------- */

  function saveDevicePref(deviceId, label) {
    if (!deviceId) return;
    safeSet(DEVICE_KEY, JSON.stringify({ deviceId, label: label || '' }));
  }

  function getDevicePref() {
    try {
      const raw = safeGet(DEVICE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.deviceId ? parsed : null;
    } catch {
      return null;
    }
  }

  function clearDevicePref() {
    safeRemove(DEVICE_KEY);
  }

  /* ---------- constraint ladder (self-healing) ---------- */

  const PROFILES = [
    { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  ];

  function getProfile() {
    const n = Number(safeGet(PROFILE_KEY) || 0);
    return Number.isFinite(n) && n >= 0 && n < PROFILES.length ? n : 0;
  }

  // Called after a recording came back silent though the track was live —
  // next attempt automatically relaxes the audio processing that may be
  // gating the child's voice (Realtek noiseSuppression is the usual culprit).
  function bumpProfile() {
    const next = Math.min(getProfile() + 1, PROFILES.length - 1);
    safeSet(PROFILE_KEY, String(next));
    return next;
  }

  function resetProfile() {
    safeRemove(PROFILE_KEY);
  }

  /* ---------- engine choice (MediaRecorder vs raw-PCM WAV) ---------- */

  function engineChoice() {
    return safeGet(ENGINE_KEY) === 'wav' ? 'wav' : 'mr';
  }

  // Called when the analyser HEARD speech but the server transcribed nothing —
  // that means the platform encoder is producing garbage; from now on this
  // machine records raw PCM and uploads WAV (no OS codec in the path).
  function useWavEngine() {
    safeSet(ENGINE_KEY, 'wav');
  }

  function resetEngine() {
    safeRemove(ENGINE_KEY);
  }

  /* ---------- stream opening ---------- */

  function constraintsFor(profileIndex, deviceId) {
    const base = { ...PROFILES[profileIndex] };
    if (deviceId) base.deviceId = { ideal: deviceId };
    return { audio: base };
  }

  async function getStream(options = {}) {
    const pref = options.deviceId ? { deviceId: options.deviceId } : getDevicePref();
    const profile = typeof options.profile === 'number' ? options.profile : getProfile();
    const constraints = constraintsFor(profile, pref?.deviceId);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // A remembered deviceId can go stale (USB mic unplugged). Retry without it
      // rather than failing the child.
      if (pref?.deviceId && err?.name === 'OverconstrainedError') {
        clearDevicePref();
        stream = await navigator.mediaDevices.getUserMedia(constraintsFor(profile, null));
      } else {
        throw err;
      }
    }
    return stream;
  }

  function trackInfo(stream) {
    const track = stream?.getAudioTracks?.()[0];
    if (!track) return { live: false, muted: false, label: '' };
    return {
      live: track.readyState === 'live',
      muted: track.muted === true,
      label: track.label || '',
    };
  }

  // Windows mutes a track (without ending it) when another app grabs the mic
  // (Zoom call, Zalo…). Surface that the moment it happens instead of
  // uploading a perfectly-valid silent file.
  function watchTrack(stream, onIssue) {
    const track = stream?.getAudioTracks?.()[0];
    if (!track || typeof onIssue !== 'function') return () => {};
    const onMute = () => onIssue('muted');
    const onEnded = () => onIssue('ended');
    track.addEventListener('mute', onMute);
    track.addEventListener('ended', onEnded);
    return () => {
      track.removeEventListener('mute', onMute);
      track.removeEventListener('ended', onEnded);
    };
  }

  /* ---------- live level monitor (Meet pattern) ---------- */

  // Opens an AudioContext + Analyser on the stream and KEEPS IT OPEN for the
  // whole recording (this mirrors the mic-test pipeline — the one path proven
  // to work on every machine, including Realtek/Windows). Closed only after
  // the recording stops.
  // True when we should upload/score — meter heard voice OR blob is big enough to
  // trust the encoder (safety valve when the analyser mis-reads on iOS).
  function recordingLooksVoiced(monitor, blobSize) {
    if (!monitor?.available) return true;
    if (monitor.voiced()) return true;
    return Number(blobSize) >= TRUST_BLOB_BYTES;
  }

  async function startMonitor(stream, options = {}) {
    const onLevel = typeof options.onLevel === 'function' ? options.onLevel : null;
    const onSilenceHint = typeof options.onSilenceHint === 'function' ? options.onSilenceHint : null;
    let ctx = null;
    let timer = null;
    let peak = 0;
    let voicedMs = 0;
    let startedAt = Date.now();
    let hinted = false;

    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      ctx = new Ctx();
      // Must await on iOS — fire-and-forget resume leaves peak at 0 forever.
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      startedAt = Date.now();
      timer = global.setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        let levelPeak = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const amp = Math.abs(buffer[i] - 128);
          if (amp > levelPeak) levelPeak = amp;
        }
        if (levelPeak > peak) peak = levelPeak;
        if (levelPeak >= SILENT_LEVEL) voicedMs += LEVEL_SAMPLE_MS;
        if (onLevel) onLevel(levelPeak);
        if (
          onSilenceHint && !hinted
          && Date.now() - startedAt >= SILENCE_HINT_MS
          && peak < SILENT_LEVEL
        ) {
          hinted = true;
          onSilenceHint();
        }
      }, LEVEL_SAMPLE_MS);
    } catch {
      // Monitoring is diagnostic, never block recording. peak stays 0 but we
      // mark the monitor as unavailable so callers don't treat it as silence.
      return {
        available: false,
        peak: () => -1,
        voiced: () => true,
        stop: () => {},
      };
    }

    return {
      available: true,
      peak: () => peak,
      voiced: () => peak >= SILENT_LEVEL,
      voicedMs: () => voicedMs,
      stop: () => {
        if (timer) global.clearInterval(timer);
        timer = null;
        if (ctx) ctx.close().catch(() => {});
        ctx = null;
      },
    };
  }

  /* ---------- mime selection (browser-aware) ---------- */

  function isSafariFamily() {
    const ua = navigator.userAgent || '';
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|Android/i.test(ua);
    return isIos || isSafari;
  }

  // Chromium's webm/opus encoder is pure software — identical on every machine.
  // audio/mp4 routes through platform AAC encoders which are driver-dependent
  // (the "valid-size garbage blob" failure class). Safari needs mp4 first.
  function mimeCandidates() {
    if (isSafariFamily()) {
      return ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
    }
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
  }

  function createMediaRecorder(stream) {
    for (const mimeType of mimeCandidates()) {
      try {
        if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(mimeType)) {
          continue;
        }
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        return { mediaRecorder, mimeType: mediaRecorder.mimeType || mimeType };
      } catch {
        /* try next */
      }
    }
    const mediaRecorder = new MediaRecorder(stream);
    return { mediaRecorder, mimeType: mediaRecorder.mimeType || 'audio/mp4' };
  }

  /* ---------- raw-PCM WAV engine (no OS codec in the path) ---------- */

  function downsampleTo(buffers, fromRate, toRate) {
    const total = buffers.reduce((sum, b) => sum + b.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const b of buffers) {
      merged.set(b, offset);
      offset += b.length;
    }
    if (fromRate <= toRate) return merged;
    const ratio = fromRate / toRate;
    const outLength = Math.floor(merged.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i += 1) {
      // Average the source window — cheap anti-aliasing, fine for speech.
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), merged.length);
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += merged[j];
      out[i] = end > start ? sum / (end - start) : 0;
    }
    return out;
  }

  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (off, str) => {
      for (let i = 0; i < str.length; i += 1) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function createWavRecorder(stream) {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but universally supported and needs no
    // separate worklet file — the same approach RecordRTC has shipped for a
    // decade. 4096 frames ≈ 85ms at 48kHz.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const buffers = [];
    let recording = false;
    const maxSamples = ctx.sampleRate * WAV_MAX_SECONDS;
    let collected = 0;
    processor.onaudioprocess = (event) => {
      if (!recording || collected >= maxSamples) return;
      const data = event.inputBuffer.getChannelData(0);
      buffers.push(new Float32Array(data));
      collected += data.length;
    };
    source.connect(processor);
    // A muted sink keeps the node pulling data without audible feedback.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    processor.connect(sink).connect(ctx.destination);

    return {
      engine: 'wav',
      mimeType: 'audio/wav',
      start() { recording = true; },
      stop() {
        recording = false;
        const fromRate = ctx.sampleRate;
        try { processor.disconnect(); } catch { /* already gone */ }
        try { source.disconnect(); } catch { /* already gone */ }
        const closing = ctx.close().catch(() => {});
        const samples = downsampleTo(buffers, fromRate, WAV_TARGET_RATE);
        const rate = fromRate <= WAV_TARGET_RATE ? fromRate : WAV_TARGET_RATE;
        const blob = encodeWav(samples, rate);
        return closing.then(() => blob);
      },
    };
  }

  /* ---------- unified recorder ---------- */

  // One API for both engines: start() begins capture, stop() resolves the blob.
  function createRecorder(stream, options = {}) {
    const wanted = options.engine || engineChoice();
    if (wanted === 'wav') {
      try {
        return createWavRecorder(stream);
      } catch {
        /* WAV engine unavailable — fall through to MediaRecorder */
      }
    }
    const { mediaRecorder, mimeType } = createMediaRecorder(stream);
    const chunks = [];
    let stopResolve = null;
    const stopped = new Promise((resolve) => { stopResolve = resolve; });
    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });
    mediaRecorder.addEventListener('stop', () => {
      const type = mediaRecorder.mimeType || mimeType || 'audio/mp4';
      stopResolve(new Blob(chunks, { type }));
    });
    return {
      engine: 'mr',
      mimeType,
      start() { mediaRecorder.start(250); },
      stop() {
        if (mediaRecorder.state === 'recording') {
          try { mediaRecorder.requestData(); } catch { /* optional */ }
          mediaRecorder.stop();
        } else {
          // Never strand the caller: resolve with what we have.
          const type = mediaRecorder.mimeType || mimeType || 'audio/mp4';
          stopResolve(new Blob(chunks, { type }));
        }
        return stopped;
      },
    };
  }

  /* ---------- telemetry helper ---------- */

  // Appended to the speaking-check upload so the server-side error ring can
  // tell apart "mic was silent" / "codec produced garbage" / "kid didn't speak"
  // without anyone touching the child's machine.
  function appendTelemetry(formData, info = {}) {
    try {
      if (typeof info.peak === 'number') formData.append('peak_level', String(info.peak));
      if (info.deviceLabel) formData.append('device_label', String(info.deviceLabel).slice(0, 80));
      if (info.engine) formData.append('rec_engine', info.engine);
      if (info.mimeType) formData.append('rec_mime', info.mimeType);
      formData.append('mic_profile', String(getProfile()));
    } catch { /* telemetry must never break the upload */ }
  }

  global.R2LRecorder = {
    SILENT_LEVEL,
    TRUST_BLOB_BYTES,
    recordingLooksVoiced,
    PROFILES,
    saveDevicePref,
    getDevicePref,
    clearDevicePref,
    getProfile,
    bumpProfile,
    resetProfile,
    engineChoice,
    useWavEngine,
    resetEngine,
    getStream,
    trackInfo,
    watchTrack,
    startMonitor,
    mimeCandidates,
    createMediaRecorder,
    createRecorder,
    encodeWav,
    appendTelemetry,
  };
})(window);
