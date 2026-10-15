/** Narration only. No microphone, provider, assessment or reward authority. */
export class NarrationLifecycle {
  #audio; #document; #notify; #listeners = []; #generation = 0; #disposed = false;
  #media = null; #segment = null; #state = 'empty'; #error = null; #position = 0;
  constructor({audio, document = null, onChange = () => {}}) {
    if (!audio?.addEventListener || !audio?.play || !audio?.pause) throw Error('audio_required');
    this.#audio = audio; this.#document = document; this.#notify = onChange;
    const listen = (target, name, handler) => { target.addEventListener(name, handler); this.#listeners.push([target,name,handler]); };
    listen(audio, 'loadedmetadata', () => {
      if (!this.#media || this.#disposed) return;
      if (!Number.isFinite(audio.duration) || Math.abs(audio.duration-this.#media.duration_seconds)>0.25) return this.#fail('duration_mismatch');
      if (this.#state === 'loading') this.#state = 'paused';
      this.#emit();
    });
    listen(audio, 'playing', () => { if (this.#active()) { this.#state='playing'; this.#emit(); } else audio.pause(); });
    listen(audio, 'waiting', () => { if (this.#active()) { this.#state='buffering'; this.#emit(); } });
    listen(audio, 'pause', () => { if (this.#active()) { this.#generation++; this.#state='paused'; this.#emit(); } });
    listen(audio, 'timeupdate', () => {
      if (!this.#media || this.#disposed || this.#state === 'error') return;
      this.#position = Math.min(this.#media.duration_seconds, Math.max(0, audio.currentTime || 0));
      if (this.#segment && this.#position >= this.#segment.end_seconds) {
        const end=this.#segment.end_seconds; this.pause(); audio.currentTime=end; this.#position=end; this.#segment=null;
      }
      this.#emit();
    });
    listen(audio, 'ended', () => { if (this.#media && this.#state !== 'error' && !this.#disposed) { this.#generation++; this.#segment=null; this.#state='ended'; this.#position=this.#media.duration_seconds; this.#emit(); } });
    listen(audio, 'error', () => { if (this.#media && !this.#disposed) this.#fail('media_load_failed'); });
    if (document) listen(document, 'visibilitychange', () => { if (document.hidden) this.pause(); });
  }
  get snapshot() { return Object.freeze({state:this.#state,error:this.#error,position_seconds:this.#position,duration_seconds:this.#media?.duration_seconds || 0,segment_id:this.#segment?.id || null}); }
  #active() { return !!this.#media && !this.#disposed && ['loading','playing','buffering'].includes(this.#state); }
  #emit() { this.#notify(this.snapshot); }
  #fail(code) { this.#generation++; this.#state='error'; this.#error=code; this.#segment=null; this.#audio.pause(); this.#emit(); }
  load(media) {
    if (this.#disposed) throw Error('narration_disposed');
    // Server supplies a hash-addressed, authenticated local route, never a private path or remote URL.
    if (!media || !/^\/api\/read2lead\/self-learn\/media\/[a-f0-9]{64}\.(mp3|wav|ogg)$/.test(media.url) || !Number.isFinite(media.duration_seconds) || media.duration_seconds<=0 || media.duration_seconds>3600 || typeof media.timing_verified!=='boolean' || !Array.isArray(media.segments)) throw Error('invalid_narration');
    const ids=new Set();
    for(const s of media.segments) {
      if (!s || typeof s.id!=='string' || !s.id || ids.has(s.id) || !Number.isFinite(s.start_seconds) || !Number.isFinite(s.end_seconds) || s.start_seconds<0 || s.start_seconds>=s.end_seconds || s.end_seconds>media.duration_seconds) throw Error('invalid_narration_segment');
      ids.add(s.id);
    }
    this.#generation++; this.#state='empty'; this.#audio.pause(); this.#segment=null;
    this.#media=structuredClone(media); this.#position=0; this.#error=null; this.#state='loading';
    this.#audio.preload='metadata'; this.#audio.src=media.url; this.#audio.load(); this.#emit();
  }
  async play(segmentId = null) {
    if (this.#disposed || !this.#media || this.#state==='error') return false;
    if (this.#document?.hidden) return false;
    let segment=null;
    if (segmentId!==null) {
      if (!this.#media.timing_verified) throw Error('timing_not_verified');
      segment=this.#media.segments.find(s=>s.id===segmentId);
      if (!segment) throw Error('unknown_narration_segment');
    }
    const token=++this.#generation;
    this.#segment=segment;
    try {
      if(segment) this.#audio.currentTime=segment.start_seconds;
      else if(this.#state==='ended') this.#audio.currentTime=0;
      this.#error=null; this.#state='loading'; this.#emit();
      await this.#audio.play();
      // A late play promise must not restart a paused/replaced/disposed lesson.
      if(token!==this.#generation || this.#disposed) return false;
      this.#state='playing'; this.#emit(); return true;
    } catch(e) {
      if(token===this.#generation && !this.#disposed) this.#fail(e?.name==='NotAllowedError'?'playback_not_allowed':'playback_failed');
      return false;
    }
  }
  pause() {
    if(this.#disposed || !this.#media) return;
    this.#generation++; if(this.#state!=='error' && this.#state!=='ended') this.#state='paused';
    this.#audio.pause(); this.#emit();
  }
  seek(seconds) {
    if(this.#disposed || !this.#media || this.#state==='error') return false;
    if(!Number.isFinite(seconds) || seconds<0 || seconds>this.#media.duration_seconds) throw Error('invalid_seek');
    this.#segment=null; this.#audio.currentTime=seconds; this.#position=seconds;
    if(this.#state==='ended') this.#state='paused'; this.#emit(); return true;
  }
  retry() { if(this.#disposed || !this.#media) return false; this.load(this.#media); return true; }
  dispose() {
    if(this.#disposed) return;
    this.#generation++; this.#disposed=true;
    for(const [target,name,fn] of this.#listeners) target.removeEventListener(name,fn);
    this.#listeners=[]; this.#audio.pause(); this.#audio.removeAttribute('src'); this.#audio.load();
    this.#media=null; this.#segment=null; this.#state='disposed'; this.#position=0; this.#error=null; this.#emit();
  }
}
