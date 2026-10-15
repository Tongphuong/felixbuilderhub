/** Owns one ephemeral capture. Interruption discards partial audio; no grading/provider calls. */
export class CaptureLifecycle {
  constructor({ getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices), Recorder = globalThis.MediaRecorder, setTimer = setTimeout, clearTimer = clearTimeout, maxMs = 60000, maxBytes = 5 * 1024 * 1024, onResult = () => {}, page = globalThis.window, document = globalThis.document } = {}) {
    if (!Number.isFinite(maxMs) || maxMs < 1 || maxMs > 60000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 5 * 1024 * 1024) throw new Error('invalid_capture_limit');
    Object.assign(this, { getUserMedia, Recorder, setTimer, clearTimer, maxMs, maxBytes, onResult, page, document });
    this.epoch = 0; this.state = 'idle'; this.disposed = false; this.active = null;
    this.onHide = () => this.cancel('interrupted');
    this.onVisibility = () => { if (this.document?.hidden) this.cancel('interrupted'); };
    page?.addEventListener('pagehide', this.onHide);
    document?.addEventListener('visibilitychange', this.onVisibility);
  }
  async start() {
    if (this.disposed) return { ok: false, reason: 'disposed' };
    this.cancel('replaced'); const token = ++this.epoch;
    if (!this.getUserMedia || !this.Recorder) { this.state = 'unavailable'; return { ok: false, reason: 'unsupported' }; }
    this.state = 'requesting';
    let stream;
    try {
      stream = await this.getUserMedia({ audio: true, video: false });
      if (token !== this.epoch || this.disposed) { stream.getTracks().forEach(t => t.stop()); return { ok: false, reason: 'cancelled' }; }
      const recorder = new this.Recorder(stream);
      const active = { token, stream, recorder, chunks: [], size: 0, timer: null, reason: 'complete' };
      this.active = active;
      recorder.ondataavailable = event => {
        if (this.active !== active || token !== this.epoch) return;
        active.size += event.data.size;
        if (active.size > this.maxBytes) { this.cancel('too_large'); return; }
        if (event.data.size) active.chunks.push(event.data);
      };
      recorder.onerror = () => this.cancel('capture_failed');
      recorder.onstop = () => {
        if (this.active !== active || token !== this.epoch) return;
        this.release(active); this.active = null; this.state = 'idle';
        const blob = new Blob(active.chunks, { type: recorder.mimeType || 'audio/webm' }); active.chunks = [];
        this.onResult({ reason: blob.size ? active.reason : 'silence', capture_status: blob.size ? 'pending' : 'unassessable', blob: blob.size ? blob : null });
      };
      recorder.start(250); this.state = 'recording';
      active.timer = this.setTimer(() => this.finish('duration_limit'), this.maxMs);
      return { ok: true };
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (token !== this.epoch) return { ok: false, reason: 'cancelled' };
      if (this.active) this.release(this.active); this.active = null; this.state = 'unavailable';
      return { ok: false, reason: error?.name === 'NotAllowedError' ? 'microphone_denied' : 'capture_failed' };
    }
  }
  release(active) {
    if (active.timer !== null) this.clearTimer(active.timer);
    active.stream.getTracks().forEach(t => t.stop());
  }
  finish(reason = 'complete') {
    const active = this.active;
    if (!active || active.recorder.state !== 'recording') return false;
    active.reason = reason; this.clearTimer(active.timer); active.timer = null;
    this.state = 'finishing';
    try { active.recorder.stop(); }
    catch {
      this.epoch++; this.active = null; this.state = 'idle'; active.chunks = [];
      this.onResult({ reason: 'capture_failed', capture_status: 'unassessable', blob: null });
    } finally { this.release(active); }
    return true;
  }
  cancel(reason = 'cancelled') {
    const wasActive = this.active || this.state === 'requesting'; this.epoch++;
    const active = this.active; this.active = null; this.state = 'idle';
    if (active) {
      this.release(active); active.chunks = [];
      if (active.recorder.state !== 'inactive') { try { active.recorder.stop(); } catch { /* Tracks are already released; no audio survives cancellation. */ } }
    }
    if (wasActive) this.onResult({ reason, capture_status: 'unassessable', blob: null });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.cancel('interrupted');
    this.page?.removeEventListener('pagehide', this.onHide);
    this.document?.removeEventListener('visibilitychange', this.onVisibility);
  }
}
