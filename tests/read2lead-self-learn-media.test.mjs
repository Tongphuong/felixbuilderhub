import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureLifecycle } from '../src/lib/read2lead/self-learn/media-lifecycle.mjs';
function fake(options = {}) {
  const track = { stopped: false, stop() { this.stopped = true; } }, stream = { getTracks: () => [track] }, results = [], timers = new Map();let serial=0;
  class Recorder {
    constructor() { this.state='inactive';this.mimeType='audio/webm'; }
    start() { this.state='recording'; }
    stop() { this.state='inactive';queueMicrotask(()=>this.onstop?.()); }
    chunk(bytes=3) { this.ondataavailable?.({ data:new Blob([new Uint8Array(bytes)]) }); }
  }
  const page=new EventTarget(), document=new EventTarget();document.hidden=false;
  const media=new CaptureLifecycle({getUserMedia:async()=>stream, Recorder,setTimer:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id),onResult:x=>results.push(x),page,document,...options});
  return { media, track, stream, results, timers, page, document, Recorder };
}
test('permission resolving after cancellation stops tracks and cannot revive recording',async()=>{
  let resolve;const f=fake({getUserMedia:()=>new Promise(r=>resolve=r)});const pending=f.media.start();f.media.cancel('interrupted');resolve(f.stream);
  assert.deepEqual(await pending,{ok:false,reason:'cancelled'});assert.equal(f.track.stopped,true);assert.equal(f.media.active,null);assert.equal(f.results[0].capture_status,'unassessable');
});
test('denied/unsupported capture returns recoverable reason',async()=>{
  const f=fake({getUserMedia:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'})}});assert.equal((await f.media.start()).reason,'microphone_denied');
  const unsupported=fake({Recorder:null});assert.equal((await unsupported.media.start()).reason,'unsupported');
});
for(const reason of ['pagehide','visibilitychange','dispose'])test(`${reason} discards partial capture and releases tracks/timer`,async()=>{
  const f=fake();await f.media.start();f.media.active.recorder.chunk();
  if(reason==='pagehide')f.page.dispatchEvent(new Event('pagehide'));else if(reason==='visibilitychange'){f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));}else f.media.dispose();
  await Promise.resolve();assert.equal(f.track.stopped,true);assert.equal(f.timers.size,0);assert.equal(f.media.active,null);assert.equal(f.results.length,1);assert.equal(f.results[0].blob,null);assert.equal(f.results[0].capture_status,'unassessable');
});
test('manual finish yields ephemeral pending clip, never a grade; silence unassessable',async()=>{
  for(const bytes of [0,10]){const f=fake();await f.media.start();f.media.active.recorder.chunk(bytes);assert.equal(f.media.finish(),true);await Promise.resolve();assert.equal(f.track.stopped,true);assert.equal(f.results[0].capture_status,bytes?'pending':'unassessable');assert.equal(f.results[0].blob?.size??0,bytes);assert.equal(f.timers.size,0);assert.equal(f.media.finish(),false);}
});
test('duration and byte budgets stop recording; oversized chunk discarded',async()=>{
  const f=fake();await f.media.start();f.media.active.recorder.chunk();[...f.timers.values()][0]();await Promise.resolve();assert.equal(f.results[0].reason,'duration_limit');assert.equal(f.track.stopped,true);
  const g=fake({maxBytes:2});await g.media.start();g.media.active.recorder.chunk(3);await Promise.resolve();assert.equal(g.results[0].reason,'too_large');assert.equal(g.results[0].blob,null);assert.equal(g.track.stopped,true);
});
test('recorder construction and start failure release acquired stream',async()=>{
  for(const Recorder of [class{constructor(){throw Error('ctor')}},class{start(){throw Error('start')}}]){const f=fake({Recorder});assert.equal((await f.media.start()).reason,'capture_failed');assert.equal(f.track.stopped,true);assert.equal(f.media.active,null);}
});
test('dispose removes listeners and prevents future acquisition',async()=>{
  const f=fake();await f.media.start();f.media.dispose();f.media.dispose();f.page.dispatchEvent(new Event('pagehide'));assert.equal(f.results.length,1);assert.equal((await f.media.start()).reason,'disposed');
});
test('recorder stop exception must still release tracks and reset lifecycle',async()=>{
  const f=fake();await f.media.start();f.media.active.recorder.stop=()=>{throw Error('driver_failure')};
  assert.doesNotThrow(()=>f.media.finish());assert.equal(f.track.stopped,true);assert.equal(f.media.active,null);assert.equal(f.media.state,'idle');assert.equal(f.results[0].capture_status,'unassessable');
});
