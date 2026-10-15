import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.R2L_MIC_TEST_SOURCE||'public/scripts/r2l-mic-check.js','utf8');
function setup() {
 const memory=new Map(),events=[],listeners=new Map(),settings={fail:false,peak:12,bytes:600,opens:0,wait:null};
 class Element {
  constructor(){this.dataset={};this.hidden=true;this.disabled=false;this.textContent='';this.value='';this.style={};this.handlers=new Map();this.isConnected=true;this.classList={add(){},remove(){}};}
  addEventListener(name,fn){this.handlers.set(name,fn);}
  click(){if(!this.disabled)return this.handlers.get('click')?.();}
  scrollIntoView(){}
 }
 function panel(){const root=new Element(),children=new Map();root.querySelector=key=>{if(!children.has(key))children.set(key,new Element());return children.get(key);};root.child=key=>root.querySelector('[data-mic-'+key+']');root.child('test').hidden=false;return root;}
 const stream={getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{getSettings:()=>({deviceId:'fixture-mic'}),label:'Fixture microphone'}]};
 class Recorder {
  static isTypeSupported(){return true;}
  constructor(){this.handlers=new Map();this.state='inactive';this.mimeType='audio/webm';}
  addEventListener(n,f){this.handlers.set(n,f);}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.handlers.get('dataavailable')?.({data:new Blob([new Uint8Array(settings.bytes)])});this.handlers.get('stop')?.();}
 }
 class AudioContext {
  constructor(){this.state='running';}
  createMediaStreamSource(){return {connect(){}};}
  createAnalyser(){return {fftSize:2048,getByteTimeDomainData:a=>a.fill(128+settings.peak)};}
  close(){return Promise.resolve();}
 }
 const document={addEventListener(n,f){if(!listeners.has(n))listeners.set(n,[]);listeners.get(n).push(f);},dispatchEvent(e){events.push(e);for(const f of listeners.get(e.type)||[])f(e);},querySelectorAll:()=>[]};
 const ctx={document,navigator:{userAgent:'Chrome/123',mediaDevices:{getUserMedia:async()=>stream,enumerateDevices:async()=>[]}},sessionStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},isSecureContext:true,MediaRecorder:Recorder,AudioContext,Blob,Uint8Array,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail;}},Audio:class {play(){return Promise.resolve();}pause(){}},setTimeout:f=>{queueMicrotask(f);return 1;},clearTimeout(){},setInterval:f=>{f();return 1;},clearInterval(){},R2LRecorder:{getStream:async()=>{settings.opens++;if(settings.wait)await settings.wait;if(settings.fail)throw Object.assign(Error('permission denied'),{name:'NotAllowedError'});return stream;},saveDevicePref(){}},console};ctx.window=ctx;vm.runInNewContext(source,ctx);
 return {api:ctx.R2LMicCheck,panel,events,settings,memory};
}
test('one actual microphone test synchronizes both panels without a rebroadcast loop',async()=>{
 const s=setup(),a=s.panel(),b=s.panel();s.api.mount(a);s.api.mount(b);await a.child('test').click();
 assert.equal(s.settings.opens,1);assert.equal(s.api.sessionPassed(),true);
 for(const p of [a,b]){assert.equal(p.dataset.state,'passed');assert.equal(p.dataset.blocked,'false');assert.equal(p.child('pass').hidden,false);assert.equal(p.child('test').disabled,false);assert.match(p.child('status').textContent,/Micro/);}
 assert.ok(s.events.length<=5,'peer updates must not repeatedly broadcast');assert.equal(a.child('play').hidden,false);assert.equal(b.child('play').hidden,true,'other panel must not invent a recording');
});
test('failed retest clears old permission success across both panels and fresh retry restores it',async()=>{
 const s=setup(),a=s.panel(),b=s.panel();s.api.mount(a);s.api.mount(b);await a.child('test').click();s.settings.fail=true;await b.child('test').click();
 assert.equal(s.api.sessionPassed(),false);for(const p of [a,b]){assert.equal(p.dataset.blocked,'true');assert.equal(p.dataset.state,'blocked');assert.equal(p.child('pass').hidden,true);assert.equal(p.child('test').disabled,false);}
 s.settings.fail=false;await b.child('test').click();assert.equal(s.api.sessionPassed(),true);assert.equal(a.dataset.state,'passed');assert.equal(b.dataset.state,'passed');
});
test('simultaneous panel tests open only one microphone and block previous success while testing',async()=>{
 const s=setup(),a=s.panel(),b=s.panel();s.api.mount(a);s.api.mount(b);await a.child('test').click();let release;s.settings.wait=new Promise(r=>{release=r;});const pending=a.child('test').click();
 assert.equal(s.api.sessionPassed(),false);assert.equal(b.dataset.state,'waiting');assert.equal(b.child('test').disabled,true);await b.child('test').handlers.get('click')();assert.equal(s.settings.opens,2,'only prior test plus current test');release();await pending;assert.equal(b.dataset.state,'passed');assert.equal(b.child('test').disabled,false);
});
test('optional panel readiness is never treated as an actual microphone pass',()=>{
 const s=setup(),a=s.panel(),b=s.panel();s.api.mount(a);s.api.mount(b,{blockUntilPass:false});assert.equal(s.api.sessionPassed(),false);assert.notEqual(a.dataset.state,'passed');assert.equal(a.child('pass').hidden,true);assert.equal(s.settings.opens,0);
});
test('silent and empty retests revoke previous success and preserve per-panel skip rules',async()=>{
 for(const reason of ['silent','empty']){
  const s=setup(),a=s.panel(),b=s.panel();s.api.mount(a,{allowLessonSkip:true});s.api.mount(b);await a.child('test').click();if(reason==='silent')s.settings.peak=0;else s.settings.bytes=0;
  await a.child('test').click();assert.equal(s.api.sessionPassed(),false);assert.equal(b.dataset.blocked,'true');assert.equal(a.child('skip-lesson').hidden,true);
  await a.child('test').click();assert.equal(a.child('skip-lesson').hidden,false);assert.equal(b.child('skip-lesson').hidden,true);assert.equal(b.dataset.state,'blocked');
 }
});
