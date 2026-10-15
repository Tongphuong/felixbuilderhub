"""Local synthetic family UI journeys. Fake microphone only; no recording/provider/live-child data.
Uses an existing explicit QA host; expects one dropped create and recovery response for loss checks.
"""
import argparse,json,subprocess,time,urllib.request
from pathlib import Path
from urllib.parse import urlparse
p=argparse.ArgumentParser()
for name in ['url','config','evidence','screenshots','clock-offset']:p.add_argument('--'+name,required=True)
p.add_argument('--resume-after-microphone-fix')
a=p.parse_args();u=urlparse(a.url);assert u.scheme=='http' and u.hostname=='127.0.0.1' and u.path=='/read2lead/self-learn/'
ev=Path(a.evidence).resolve();out=Path(a.screenshots).resolve();ev.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
repo=Path(__file__).resolve().parents[3];lesson=json.loads((repo/'tests/fixtures/read2lead-self-learn/level-lessons.json').read_text())['lessons'][2]
stamp=str(time.time_ns());init=ev/'synthetic-microphone.js';init.write_text('''window.__micRequests=0;window.__stopped=0;window.__allowMic=false;
Object.defineProperty(MediaDevices.prototype,'getUserMedia',{configurable:true,value:async()=>{window.__micRequests++;if(!window.__allowMic)throw new DOMException('Synthetic denial','NotAllowedError');return {getTracks:()=>[{stop:()=>{window.__stopped++;}}]};}});
window.MediaRecorder=class{state='inactive';mimeType='audio/webm';start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}};
''')
cmd=['agent-browser','--session',a.resume_after_microphone_fix or 'r2l-family-ui-'+stamp,'--config',str(Path(a.config).resolve()),'--engine','chrome','--allowed-domains','127.0.0.1','--init-script',str(init),'--json','batch','--bail'];commands=[];receipts=json.loads((ev/'browser-receipt.json').read_text()) if a.resume_after_microphone_fix else []
def add(*v):commands.append(list(v))
def wait(s):add('wait','--fn',f'!!document.querySelector({json.dumps(s)})&&document.querySelector("main")?.getAttribute("aria-busy")==="false"')
def check(expr,name):add('eval',f'(()=>{{if(!({expr}))throw Error({json.dumps(name)});return {{check:{json.dumps(name)},passed:true}}}})()')
def click(s,target):add('eval','document.querySelector('+json.dumps(s)+').scrollIntoView({block:"center",behavior:"instant"})');add('click',s);wait(target)
def toggle(s):add('eval','document.querySelector('+json.dumps(s)+').scrollIntoView({block:"center",behavior:"instant"})');add('click',s)
def capture(name):
 for width in [390,768,1024,1280]:
  add('set','viewport',str(width),'900');check('document.documentElement.scrollWidth<=innerWidth',name+'-overflow-'+str(width))
  check("[...document.querySelectorAll('button,select,input,textarea,summary')].filter(x=>!x.disabled&&x.getClientRects().length).map(x=>(['checkbox','radio'].includes(x.type)?x.closest('label'):x).getBoundingClientRect()).every(r=>r.width>=44&&r.height>=44)",name+'-touch-'+str(width))
  add('screenshot','--full',str(out/(name+'-'+str(width)+'.png')))
 add('set','viewport','390','900')
def run(name):
 global commands
 centered=[]
 for command in commands:
  if command[0]=='check':centered.append(['eval','document.querySelector('+json.dumps(command[1])+').scrollIntoView({block:"center",behavior:"instant"})'])
  centered.append(command)
 r=subprocess.run(cmd,input=json.dumps(centered),text=True,capture_output=True);(ev/(name+'.json')).write_text(r.stdout);(ev/(name+'.stderr')).write_text(r.stderr)
 if r.returncode:print(r.stdout[-7500:]);print(r.stderr);raise SystemExit(r.returncode)
 rows=json.loads(r.stdout)
 for row in rows:
  if row['command'][0]=='errors':assert not row['result']['errors'],row['result']['errors']
 v={'phase':name,'status':'PASS','commands':len(rows),'screenshots':sum(x['command'][0]=='screenshot' for x in rows),'real_http':True,'real_audio':False,'independent':False};receipts.append(v);(ev/'browser-receipt.json').write_text(json.dumps(receipts,indent=2)+'\n');print(json.dumps(v),flush=True);commands=[]

def parent_call(changes):
 base=u.scheme+'://'+u.netloc+'/api/read2lead/self-learn/';cookie='';csrf=''
 def call(route,data=None):
  nonlocal cookie,csrf
  req=urllib.request.Request(base+route,data=None if data is None else json.dumps(data).encode(),headers={'Origin':u.scheme+'://'+u.netloc,'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {}),**({'X-R2L-CSRF':csrf} if csrf else {})})
  with urllib.request.urlopen(req) as res:
   v=json.load(res)
   if res.headers.get('Set-Cookie'):cookie=res.headers['Set-Cookie'].split(';')[0]
   if v.get('csrf'):csrf=v['csrf']
   return v
 call('login',{'access_code':'DEMO-FAMILY-A'});call('parent/enter',{'parent_secret':'DEMO-PARENT-A-ONLY'});c=next(c for c in call('parent/family')['children'] if c['id']=='synthetic-an')
 data={'request_id':'external-'+str(time.time_ns()),'child_id':c['id'],'expected_revision':c['revision'],'display_name':c['label_vi'],'archived':c['archived'],'learning_enabled':c['learning_enabled'],'recording_allowed':c['recording_allowed'],**changes};v=call('parent/update-child',data);call('logout',{});return v

auth='[data-action=parent-open]';profile='.family-profile:nth-child(3)';form=profile+' form';an='.family-profile[data-child="synthetic-an"]';binh='.family-profile[data-child="synthetic-binh"]'
if not a.resume_after_microphone_fix:
 add('open',a.url);wait('#login-form');click('#login-form button','[data-action=start]');click(auth,'#parent-entry-form');capture('parent-locked')
 add('fill','#parent-secret','INCORRECT-PARENT');click('#parent-entry-form button','#parent-entry-form');check('document.querySelector("#message").textContent.includes("chưa đúng")','wrong-parent-secret')
 add('fill','#parent-secret','DEMO-PARENT-A-ONLY');click('#parent-entry-form button','.family-grid');capture('family-summary')
 click(an+' .family-history summary',an+' .family-history');check('document.querySelector('+json.dumps(an+' .family-history')+').textContent.includes("Cần luyện cùng")&&document.querySelector('+json.dumps(an+' .family-history')+').textContent.includes("Gợi ý nội dung")','actual-supported-history')
 check('!document.querySelector("main").textContent.includes("Synthetic retell")&&!document.querySelector("main").textContent.includes("Synthetic prediction")','raw-child-text-not-parent-summary');capture('practice-evidence')
 add('fill','#new-child-name','Linh QA');click('#family-create-form button','#family-pending');capture('create-pending')
 check("[...Object.values(sessionStorage)].every(v=>!v.includes('Linh QA')&&!v.includes('DEMO-PARENT'))",'no-family-payload-in-browser-storage')
 add('reload');wait('[data-action=start]');click(auth,'.family-grid');check('document.querySelectorAll(".family-profile").length===3','postcommit-create-survives-reload');check('document.body.textContent.includes("Còn mã lượt gửi từ trước")','opaque-request-id-retained')
 add('fill','#new-child-name','Linh QA');click('#family-create-form button','.family-grid');check('document.querySelectorAll(".family-profile").length===3&&document.querySelector("#message").textContent.includes("một lần")','reloaded-create-replays-once')
 add('fill',form+' input[name=display_name]','Linh <QA>');check('document.querySelector('+json.dumps(form+' .profile-save-state')+').textContent.includes("Chưa lưu")','profile-draft-visible')
 toggle(form+' input[name=learning_enabled]');toggle(form+' input[name=recording_allowed]');click(form+' button[type=submit]','.family-grid')
 check('document.querySelector('+json.dumps(profile+' h2')+').textContent==="Linh <QA>"&&!document.querySelector("QA")','profile-name-escaped');capture('profile-saved')
 toggle(form+' input[name=archived]');click(form+' button[type=submit]','.family-grid');check('document.querySelector('+json.dumps(profile+' .tag')+').textContent.includes("Đang cất")','profile-archived');capture('profile-archived')
 toggle(form+' input[name=archived]');click(form+' button[type=submit]','.family-grid');check('document.querySelector('+json.dumps(profile)+').textContent.includes("0 kim cương mẫu")','restore-preserves-zero-wallet')
 for selector in [an,binh,profile]:toggle(selector+' input[name=learning_enabled]');click(selector+' form button[type=submit]','.family-grid')
 click('[data-action=parent-exit]','.empty');check('document.body.textContent.includes("chưa có hồ sơ được mở học")','no-enabled-child-explicit');capture('no-enabled-child')
 click(auth,'#parent-entry-form');add('fill','#parent-secret','DEMO-PARENT-A-ONLY');click('#parent-entry-form button','.family-grid')
 toggle(an+' input[name=learning_enabled]');toggle(an+' input[name=recording_allowed]');click(an+' form button[type=submit]','.family-grid');capture('recording-enabled')
 run('management')
 # A trusted test clock moves only this local server. It is reset before continuing.
 Path(a.clock_offset).write_text('900001')
 try:
  click('[data-action=family-check]','#parent-entry-form');capture('parent-expired');run('expiry')
 finally:Path(a.clock_offset).write_text('0')
 add('fill','#parent-secret','DEMO-PARENT-A-ONLY');click('#parent-entry-form button','.family-grid')
 # Stale form: another independently authenticated HTTP client changes the same synthetic profile.
 run('reenter')
 parent_call({'display_name':'An QA external'})
 add('fill',an+' input[name=display_name]','Stale overwrite refused');click(an+' form button[type=submit]','.family-grid');check('document.querySelector("#message").textContent.includes("Hồ sơ đã thay đổi")','stale-profile-refused');capture('stale-profile')
 click('[data-action=family-check]','.family-grid');check('document.querySelector('+json.dumps(an+' input[name=display_name]')+').value==="An QA external"','fresh-server-profile-restored')
 click('[data-action=parent-exit]','[data-action=start]')
 # Seed just the microphone target stage through the same real API with authored synthetic evidence.
 steps=[['prediction',{'text':''}],['input_complete',{'order':['read']}]]+[['answer',{'item_id':q['id'],'choice_index':q['correct_index'],'text':'','evidence_sentence_ids':[s['sentence_id'] for s in q['evidence_spans']],'support_used':[],'capture_status':'not_attempted'}] for q in lesson['questions']]+[['save_understand',{}],['begin_use',{}]]
 add('eval',"(async()=>{const base='/api/read2lead/self-learn/',me=await(await fetch(base+'me')).json();const call=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-R2L-CSRF':me.csrf},body:JSON.stringify(data)});const v=await r.json();if(!v.ok)throw Error(JSON.stringify(v));return v;};let r=await call('start',{request_id:"+json.dumps('family-mic-'+stamp)+",child_id:'synthetic-an',lesson_id:"+json.dumps(lesson['id'])+"});for(const [event,payload]of "+json.dumps(steps)+"){r=await call('event',{api_version:'1.2',request_id:'family-mic-'+crypto.randomUUID(),child_id:'synthetic-an',session_id:r.session.session_id,expected_revision:r.session.revision,event,payload});}return {synthetic_setup:true,stage:r.session.stage};})()")
 click('[data-action=home]','[data-action=open-session]');click('[data-action=open-session]','form[data-event=shadow_complete]')
 click('#microphone','#capture-status');add('wait','--fn','document.querySelector("#capture-status").textContent.includes("chưa được cho phép")');check('window.__micRequests===1','synthetic-denial-reached-only-with-permission');capture('microphone-denied')
 add('eval','window.__allowMic=true');click('#microphone','#stop-microphone');add('wait','--fn','!document.querySelector("#stop-microphone").hidden');check('window.__micRequests===2','synthetic-stream-active');run('microphone-start')
else:
 add('reload');wait('form[data-event=shadow_complete]')
 click('#microphone','#capture-status');add('wait','--fn','document.querySelector("#capture-status").textContent.includes("chưa được cho phép")');check('window.__micRequests===1','synthetic-denial-after-timer-repair');capture('microphone-denied')
 add('eval','window.__allowMic=true');click('#microphone','#stop-microphone');add('wait','--fn','!document.querySelector("#stop-microphone").hidden');check('window.__micRequests===2','synthetic-stream-active-after-timer-repair');run('microphone-start-restored')
parent_call({'recording_allowed':False})
add('wait','--fn','window.__stopped>0&&document.querySelector("#capture-status").textContent.includes("Micro đang được tắt")');capture('microphone-revoked');check('document.querySelector("form[data-event=shadow_complete]")!==null','typed-learning-preserved-after-revocation')
click('[data-action=logout]','#login-form');click('[data-action=recovery-open]','#recovery-form');capture('recovery-form')
fields={'#recovery-code':'INCORRECT-RECOVERY-TOKEN-2026','#new-access-code':'FAMILY-QA-NEW-A-2026','#new-parent-secret':'FAMILY-QA-PARENT-A-2026','#new-recovery-code':'FAMILY-QA-RECOVERY-A-2026'}
def fill_recovery():
 for selector,value in fields.items():add('fill',selector,value)
 add('check','input[name=saved_codes]')
fill_recovery();click('#recovery-form button','#recovery-form');check('document.querySelector("#message").textContent.includes("chưa đúng")','invalid-recovery-refused')
fields['#recovery-code']='DEMO-RECOVERY-FAMILY-A-2026';fill_recovery();click('#recovery-form button','#family-pending');capture('recovery-pending')
check("!JSON.stringify({...localStorage,...sessionStorage}).includes('FAMILY-QA-NEW')&&!JSON.stringify({...localStorage,...sessionStorage}).includes('FAMILY-QA-PARENT')&&!JSON.stringify({...localStorage,...sessionStorage}).includes('DEMO-RECOVERY')",'no-credential-storage')
click('[data-action=family-retry]','#login-form');check('document.querySelector("#message").textContent.includes("Đã đổi bộ mã")','recovery-exact-replay-confirmed');capture('recovered-login')
add('fill','#access-code','DEMO-FAMILY-A');click('#login-form button','#login-form');check('document.querySelector("#message").textContent.includes("chưa đúng")','old-access-refused')
add('fill','#access-code','FAMILY-QA-NEW-A-2026');click('#login-form button','[data-action=start]');click(auth,'#parent-entry-form');add('fill','#parent-secret','FAMILY-QA-PARENT-A-2026');click('#parent-entry-form button','.family-grid')
check('document.querySelectorAll(".family-profile").length===3&&document.querySelector('+json.dumps(an)+').textContent.includes("15 kim cương mẫu")','recovery-preserves-profiles-history-and-value');capture('recovered-family')
add('eval',"(async()=>{const values=[];for(const info of await indexedDB.databases()){const db=await new Promise((done,fail)=>{const r=indexedDB.open(info.name);r.onsuccess=()=>done(r.result);r.onerror=()=>fail(r.error);});for(const name of db.objectStoreNames){const rows=await new Promise((done,fail)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>done(r.result);r.onerror=()=>fail(r.error);});values.push(rows);}db.close();}const text=JSON.stringify(values);if(/FAMILY-QA-(?:NEW|PARENT|RECOVERY)|DEMO-PARENT|DEMO-RECOVERY/.test(text))throw Error('credential in IndexedDB');return {check:'no-family-credentials-in-indexeddb',passed:true};})()")
click('[data-action=logout]','#login-form');check('!document.querySelector("main").textContent.includes("Linh")&&!document.querySelector("main").textContent.includes("An QA external")','parent-private-view-cleared-on-logout')
add('errors');run('recovery-and-privacy')
closed=subprocess.run(cmd[:-2]+['close'],text=True,capture_output=True);(ev/'browser-close.json').write_text(closed.stdout);closed.check_returncode()
