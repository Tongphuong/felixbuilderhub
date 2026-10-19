import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as entryModule from '../src/lib/read2lead/student-entry.mjs';

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
}
function element() {
  const events = {}, attrs = {};
  return { events, attrs, hidden:false, disabled:false, value:'', textContent:'', innerHTML:'',
    classList:{toggle(){}}, setAttribute:(k,v)=>{attrs[k]=v;}, addEventListener:(k,f)=>{events[k]=f;},
    replaceChildren(){this.textContent='';}, focus(){this.focused=true;}, querySelector(){return element();},
    closest(){return element();}, removeAttribute(){}, toggleAttribute(){}, style:{}, dataset:{} };
}
const settle = async () => { for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };
const idCalls=f=>f.calls.filter(c=>!String(c[0]).includes('leaderboard'));
function controller(kind,{search='',path,fetcher,storage=memory({'r2l_access_code':'R2L-OLD-A','unrelated':'keep'})}={}) {
  const nodes = new Map(), events = {}, calls = [], get = key => {if(!nodes.has(key)){const node=element();node.querySelector=s=>get(s);nodes.set(key,node);}return nodes.get(key);};
  const location={search,pathname:path||(kind==='home'?'/read2lead':'/ho-so'),href:'https://app.test'+(path||(kind==='home'?'/read2lead':'/ho-so'))+search,
    replace(url){this.replaced=url;},assign(url){this.assigned=url;},reload(){}};
  const document={querySelector:s=>get(s==="[data-child-home]"?'root':s.replace(/^#/,'')),getElementById:get,createElement:element,
    querySelectorAll:()=>[],addEventListener:(k,f)=>{events[k]=f;}};
  const exports={};
  const context={document,location,sessionStorage:storage,localStorage:memory(),exports,URL,URLSearchParams,Intl,Number,String,Error,TypeError,console,
    matchMedia:()=>({matches:true}),fetch:async(...args)=>{calls.push(args);return fetcher(...args);},
    history:{replaceState(_,__,url){const u=new URL(url,location.href);location.search=u.search;location.href=u.href;location.pathname=u.pathname;}},
    require(path){if(path.includes('student-entry'))return entryModule;if(path.includes('r2l-hero'))return {buildHeroCta:()=>({action:'lesson'}),statusMeta:()=>({label:'Saved'})};if(path.includes('monster-avatar'))return {renderMonster(){}};if(path.includes('r2l-ranks')){const m={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/r2l-ranks.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:m,document,Intl,Number,String,Promise,require:()=>({renderMonster(){}})});return m;}if(path.includes('lesson-help'))return {requestLessonAssignment:async()=>({})};if(path.includes('parent-view'))return {invalidateParentCache(){},renderParentView:async(root,data,code)=>{root.textContent=code;}};throw Error(path);}};
  context.window={location,history:context.history,scrollTo(){},addEventListener:(k,f)=>{events[k]=f;}};
  const file=kind==='home'?'src/scripts/read2lead-child-home.ts':'src/pages/ho-so/ho-so.ts';
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  if(kind==='parent')exports.initHoSo();
  return {get,events,calls,location,storage,async submit(code){get('home-code').value=code;await get('home-entry-form').events.submit({preventDefault(){}});await settle();},async switchStudent(){events.click({target:{closest:sel=>sel==='[data-ho-so-change-code]'?{}:null}});await settle();}};
}
const progress=code=>Response.json({ok:true,student_name:code,progress:{student_name:code,current_pack:{story_title:'Saved story'}},read2lead_state:{diamonds:250}});

test('manual and explicit entry never choose a remembered identity',()=>{
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams()),{kind:'manual'});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams(),{remembered:'R2L-A'}),{kind:'manual'});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams(),{allowRemembered:true,remembered:' r2l-a '}),{kind:'remembered',code:'R2L-A'});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams(),{allowRemembered:true,remembered:'garbage'}),{kind:'manual'});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams('code=bad'),{allowRemembered:true,remembered:'R2L-A'}),{kind:'code',code:''});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams('t=x'),{allowRemembered:true,remembered:'R2L-A'}),{kind:'link',token:'x'});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams('code= r2l-b-2 ')),{kind:'code',code:'R2L-B-2'});
  assert.deepEqual(entryModule.studentEntry(new URLSearchParams('t=&code=R2L-B-2')),{kind:'link',token:''});
  for(const code of ['', 'hello', '<script>', 'R2L-'+ 'A'.repeat(101)])assert.equal(entryModule.normalizeStudentCode(code),'');
});
test('reset failure never claims success or erases unrelated browser work',async()=>{
  const storage=memory({r2l_access_code:'R2L-A',draft:'saved'});
  await assert.rejects(()=>entryModule.resetStudentSession(async()=>new Response(null,{status:503}),storage));
  assert.equal(storage.getItem('r2l_access_code'),'R2L-A');
  await entryModule.resetStudentSession(async(url,options)=>{assert.equal(url,'/api/read2lead-session-reset');assert.equal(options.method,'POST');return new Response(null,{status:204});},storage);
  assert.equal(storage.getItem('r2l_access_code'),null);assert.equal(storage.getItem('draft'),'saved');
  await assert.rejects(()=>entryModule.resetStudentSession(async()=>new Response(null,{status:204}),{removeItem(){throw Error('blocked');}}));
});
test('E1: home with NO remembered child shows the code form with zero requests',async()=>{
  const f=controller('home',{storage:memory({unrelated:'keep'}),fetcher:()=>{throw Error('unexpected request');}});await settle();
  assert.equal(f.get('home-entry').hidden,false);assert.equal(f.get('home-ready').hidden,true);assert.equal(idCalls(f).length,0);assert.equal(f.storage.getItem('unrelated'),'keep');
});
test('E1: /r2l/start (personal-link shell) without a token never uses a remembered child',async()=>{
  const f=controller('home',{path:'/r2l/start',fetcher:()=>{throw Error('unexpected request');}});await settle();
  assert.equal(f.get('home-entry').hidden,false);assert.equal(f.get('home-ready').hidden,true);assert.equal(idCalls(f).length,0);assert.equal(f.storage.getItem('r2l_access_code'),null);assert.equal(f.storage.getItem('unrelated'),'keep');
});
test('E3: bare /read2lead with this tab\'s remembered child A opens A\'s home with no typing',async()=>{
  const f=controller('home',{fetcher:async url=>progress(new URL(url,'https://app.test').searchParams.get('code'))});await settle();
  assert.equal(f.get('home-ready').hidden,false);assert.equal(f.get('home-entry').hidden,true);assert.equal(f.get('home-name').textContent,'R2L-OLD-A');
  assert.deepEqual(idCalls(f).map(c=>c[0]),['/api/read2lead-progress?code=R2L-OLD-A']);
});
test('a remembered child the server rejects is forgotten and the plain code form shows (no scary error)',async()=>{
  const f=controller('home',{fetcher:async()=>Response.json({ok:false},{status:404})});await settle();
  assert.equal(f.get('home-entry').hidden,false);assert.equal(f.get('home-ready').hidden,true);assert.equal(f.storage.getItem('r2l_access_code'),null);assert.equal(f.get('home-entry-message').textContent,'');
});
test('E2: an invalid explicit code never falls back to the remembered child',async()=>{
  const f=controller('home',{search:'?code=nope',fetcher:()=>{throw Error('unexpected request');}});await settle();
  assert.equal(f.get('home-entry').hidden,false);assert.equal(idCalls(f).length,0);assert.ok(f.get('home-entry-message').textContent);
});
test('actual code form normalizes B, loads only B and retains saved results',async()=>{
  const f=controller('home',{storage:memory(),fetcher:async url=>progress(new URL(url,'https://app.test').searchParams.get('code'))});
  await f.submit('  r2l-b-2  ');assert.equal(idCalls(f).length,1);assert.match(idCalls(f)[0][0],/code=R2L-B-2$/);
  assert.equal(f.get('home-name').textContent,'R2L-B-2');assert.equal(f.get('home-diamonds').textContent,'250');assert.equal(f.get('home-heading').textContent,'Saved story');assert.equal(f.storage.getItem('r2l_access_code'),'R2L-B-2');
});
test('invalid manual code does not call API; invalid personal link offers code entry without fallback',async()=>{
  const f=controller('home',{storage:memory(),fetcher:()=>{throw Error('unexpected');}});await f.submit('bad');assert.equal(idCalls(f).length,0);assert.ok(f.get('home-entry-message').textContent);
  const g=controller('home',{search:'?t=invalid',fetcher:async()=>Response.json({ok:false},{status:404})});await settle();
  assert.equal(idCalls(g).length,1);assert.match(idCalls(g)[0][0],/^\/api\/r2l-link/);assert.equal(g.get('home-entry').hidden,false);assert.equal(g.get('home-ready').hidden,true);
});
test('personal link resolves before progress and does not use remembered A',async()=>{
  const f=controller('home',{search:'?t=valid',fetcher:async url=>url.startsWith('/api/r2l-link')?Response.json({access_code:'R2L-B-2'}):progress('B')});await settle();
  assert.equal(idCalls(f).length,2);assert.match(idCalls(f)[1][0],/code=R2L-B-2$/);assert.equal(f.get('home-name').textContent,'B');
});
test('network and unknown-code errors retain manual retry with button enabled',async()=>{
  let fails=true;const f=controller('home',{storage:memory(),fetcher:async()=>{if(fails)throw new TypeError('network');return progress('B');}});
  await f.submit('R2L-B-2');assert.equal(f.get('home-entry').hidden,false);assert.equal(f.get('home-entry-submit').disabled,false);
  fails=false;await f.submit('R2L-B-2');assert.equal(f.get('home-name').textContent,'B');
  const g=controller('home',{storage:memory(),fetcher:async()=>Response.json({ok:false},{status:404})});await g.submit('R2L-UNKNOWN');assert.equal(g.get('home-entry').hidden,false);assert.equal(g.get('home-ready').hidden,true);
});
test('parent reset waits for server success, clears identity and hides old results; failure retry works',async()=>{
  let fail=true;const f=controller('parent',{search:'?code=R2L-OLD-A&role=parent',fetcher:async url=>url.includes('reset')?new Response(null,{status:fail?503:204}):progress('A')});await settle();
  assert.equal(f.get('ho-so-parent').textContent,'R2L-OLD-A');await f.switchStudent();assert.equal(f.storage.getItem('r2l_access_code'),'R2L-OLD-A');assert.ok(f.get('[data-ho-so-error-message]').textContent);
  fail=false;await f.switchStudent();assert.equal(f.storage.getItem('r2l_access_code'),null);assert.equal(f.get('ho-so-parent').textContent,'');assert.equal(new URL(f.location.href).searchParams.has('code'),false);
});
test('delayed parent response cannot restore identity after switch',async()=>{
  let resolve;const pending=new Promise(r=>{resolve=r;});
  const f=controller('parent',{search:'?code=R2L-OLD-A&role=parent',fetcher:async url=>url.includes('reset')?new Response(null,{status:204}):pending});
  await f.switchStudent();resolve(progress('A'));await settle();assert.equal(f.get('ho-so-parent').textContent,'');assert.equal(f.storage.getItem('r2l_access_code'),null);assert.equal(new URL(f.location.href).searchParams.has('code'),false);
});
test('E4 end to end: bare parent page reopens the tab child; after the switch POST the next bare open asks for a code (zero requests)',async()=>{
  const storage=memory({r2l_access_code:'R2L-OLD-A'});
  const a=controller('parent',{storage,fetcher:async url=>url.includes('reset')?new Response(null,{status:204}):progress('A')});await settle();
  assert.ok(a.calls.some(c=>String(c[0]).includes('code=R2L-OLD-A')),'remembered child reopens');
  await a.switchStudent();assert.ok(a.calls.some(c=>c[0]==='/api/read2lead-session-reset'&&c[1].method==='POST'));
  const b=controller('parent',{storage,fetcher:()=>{throw Error('unexpected request');}});await settle();
  assert.equal(b.calls.length,0);assert.equal(storage.getItem('r2l_access_code'),null);
});
