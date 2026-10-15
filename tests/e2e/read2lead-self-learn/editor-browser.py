"""Complete synthetic editor UI journey. Local fault control only; no live identities or external calls."""
import argparse,json,hashlib,sqlite3,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from urllib.parse import urlparse
p=argparse.ArgumentParser(description=__doc__)
for key in ['url','config','data-root','control','evidence','screenshots']:p.add_argument('--'+key,required=True)
a=p.parse_args();u=urlparse(a.url);assert u.scheme=='http' and u.hostname=='127.0.0.1' and u.port and u.path=='/read2lead/editor/' and not any([u.username,u.password,u.query,u.fragment]);origin=u.scheme+'://'+u.netloc
root=Path(a.data_root).resolve();assert json.loads((root/'synthetic-target.json').read_text())=={'format':1,'purpose':'read2lead-local-synthetic','database':'read2lead-synthetic.sqlite'}
with sqlite3.connect((root/'read2lead-synthetic.sqlite').as_uri()+'?mode=ro',uri=True) as db:
 assert db.execute('PRAGMA application_id').fetchone()[0]==0x52324c31;assert db.execute('SELECT count(*) FROM editor_documents').fetchone()[0]==0;assert all(x[0].startswith('synthetic-') for x in db.execute('SELECT id FROM children'))
control=Path(a.control).resolve();assert control.is_file() and json.loads(control.read_text())=={}
ev=Path(a.evidence).resolve();shots=Path(a.screenshots).resolve();ev.mkdir(parents=True,exist_ok=False);shots.mkdir(parents=True,exist_ok=False)
cmd=['agent-browser','--session','r2l-editor-ui-'+str(time.time_ns()),'--config',str(Path(a.config).resolve()),'--engine','chrome','--allowed-domains','127.0.0.1','--json'];(ev/'session.json').write_text(json.dumps(cmd,indent=2)+'\n');commands=[];receipts=[]
def add(*args):commands.append(list(args))
def wait(selector):add('wait','--fn','!!document.querySelector('+json.dumps(selector)+')&&document.querySelector("main")?.getAttribute("aria-busy")==="false"')
def check(js,name):add('eval','(()=>{if(!('+js+'))throw Error('+json.dumps(name)+');return {check:'+json.dumps(name)+',passed:true}})()')
def click(selector,target):add('eval','document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center",behavior:"instant"})');add('click',selector);wait(target)
def section(key):
 selector='details:has(textarea[data-section="'+key+'"])';add('eval','document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center",behavior:"instant"})');add('click',selector+':not([open]) > summary')
def capture(name):
 for width in [390,768,1024,1280]:
  add('set','viewport',str(width),'900');check('document.documentElement.scrollWidth<=innerWidth',name+'-overflow-'+str(width));check("[...document.querySelectorAll('button,input,select,textarea,summary,a')].filter(x=>!x.disabled&&x.getClientRects().length).every(x=>{const r=x.getBoundingClientRect();return r.width>=44&&r.height>=44})",name+'-targets-'+str(width));add('screenshot','--full',str(shots/(name+'-'+str(width)+'.png')))
 add('set','viewport','390','900')
def run(name):
 global commands
 r=subprocess.run(cmd+['batch','--bail'],input=json.dumps(commands),text=True,capture_output=True);(ev/(name+'.json')).write_text(r.stdout);(ev/(name+'.stderr')).write_text(r.stderr)
 if r.returncode:print(r.stdout[-7500:],r.stderr,flush=True);raise RuntimeError('browser phase failed: '+name)
 rows=json.loads(r.stdout);assert len(rows)==len(commands) and all(row['success'] for row in rows)
 for row in rows:
  if row['command'][0]=='errors':assert row['result']['errors']==[],row
 images=[Path(row['command'][-1]) for row in rows if row['command'][0]=='screenshot'];entry={'phase':name,'status':'PASS','commands':len(rows),'screenshots':len(images),'screenshot_sha256':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in images},'independent_review':False};receipts.append(entry);(ev/'receipts.json').write_text(json.dumps(receipts,indent=2)+'\n');print(json.dumps({k:v for k,v in entry.items() if k!='screenshot_sha256'}),flush=True);commands=[]
class Client:
 def __init__(self,family=False):self.prefix='/api/read2lead/self-learn/' if family else '/api/read2lead/editor/';self.header='X-R2L-CSRF' if family else 'X-R2L-Editor-CSRF';self.cookie='';self.csrf=''
 def call(self,route,data=None,expected=200):
  req=urllib.request.Request(origin+self.prefix+route,data=None if data is None else json.dumps(data,ensure_ascii=False).encode(),headers={'Origin':origin,'Content-Type':'application/json',**({'Cookie':self.cookie} if self.cookie else {}),**({self.header:self.csrf} if self.csrf else {})})
  try:r=urllib.request.urlopen(req,timeout=15)
  except urllib.error.HTTPError as error:r=error
  with r:
   value=json.load(r);assert r.status==expected,(route,r.status,value)
   if r.headers.get('Set-Cookie'):self.cookie=r.headers['Set-Cookie'].split(';')[0]
   if value.get('csrf'):self.csrf=value['csrf']
   return value
editor=Client();editor.call('login',{'editor_id':'synthetic-editor-qa','access_secret':'DEMO-EDITOR-LOCAL-ONLY'});templates=editor.call('templates')['templates'];lesson=next(l for l in templates if l['id']=='r2l-a-dry-place-for-the-map');title=lesson['title_en']+' — Editor QA';title2=title+' revised';serial=0
def rid():
 global serial
 serial+=1;return 'editor-ui-external-'+str(serial)
def document():return editor.call('document?lesson_id='+lesson['id'])['current_view']
add('open',a.url);wait('#editor-login-form');check('getComputedStyle(document.querySelector("a.brand")).minHeight==="48px"&&[...document.querySelectorAll("link[rel=stylesheet]")].some(x=>x.href.includes("read2lead-editor"))','external-editor-style-loaded');add('fill','#editor-secret','WRONG-DEMO-SECRET');click('#editor-login-form button','#editor-message');check('document.querySelector("#editor-message").textContent.includes("chưa đúng")&&!document.querySelector(".editor-layout")','wrong-login-private-content-hidden');capture('denied')
add('fill','#editor-secret','DEMO-EDITOR-LOCAL-ONLY');click('#editor-login-form button','#editor-template');check('document.querySelector(".editor-picker").textContent.includes("Chưa có bản lưu")','empty-editor');capture('empty');run('login-empty')
add('select','#editor-template',lesson['id']);click('[data-action=use-template]','input[data-path=title_en]');add('fill','input[data-path=title_en]',title);capture('local-draft');add('reload');wait('input[data-path=title_en]');check('document.querySelector("input[data-path=title_en]").value==='+json.dumps(title),'title-survives-reload');run('draft-reload')
section('questions');add('fill','textarea[data-section=questions]','{ invalid JSON');click('[data-action=preview]','#editor-message');check('document.querySelector("#editor-message").textContent.includes("JSON")','invalid-section-reported');capture('invalid');add('reload');wait('textarea[data-section=questions]');check('document.querySelector("textarea[data-section=questions]").value==="{ invalid JSON"','invalid-section-survives-reload');run('invalid-reload')
add('fill','textarea[data-section=questions]',json.dumps(lesson['questions'],ensure_ascii=False,indent=2));click('[data-action=preview]','.editor-preview');check('document.querySelector(".editor-preview").textContent.includes('+json.dumps(title)+')','preview-current-draft');capture('preview');run('preview')
control.write_text(json.dumps({'drop_route':'draft'})+'\n');click('[data-action=save-draft]','#editor-pending');check('document.querySelector("#editor-message").textContent.includes("kết nối")','lost-save-response-pending');capture('lost-save');add('reload');wait('#editor-pending');capture('pending-reloaded');run('lost-response')
dropped=json.loads(control.read_text());assert dropped.get('dropped',0)>=1;(ev/'dropped-acks.json').write_text(json.dumps(dropped,indent=2)+'\n');control.write_text('{}\n')
assert document()['document']['revision']==1
click('[data-action=retry]','.editor-workflow');check('!document.querySelector("#editor-pending")&&document.querySelector("#editor-message").textContent.includes("lượt cũ")','exact-retry-acknowledged');capture('saved');run('save-replayed')
assert document()['document']['revision']==1 and len(document()['revisions'])==1
click('[data-action=request-review]','#editor-review-form');add('select','#editor-review-form [name=decision]','changes_requested');add('fill','#editor-review-form [name=note]','Synthetic technical review asks for a clearer title.');click('#editor-review-form button','.editor-workflow');capture('changes-requested');run('review-changes')
assert document()['document']['workflow']=='changes_requested'
add('fill','input[data-path=title_en]',title2);check('document.querySelector(".editor-workflow fieldset").disabled','unsaved-draft-prevents-workflow');click('[data-action=save-draft]','.editor-workflow');click('[data-action=request-review]','#editor-review-form');add('select','#editor-review-form [name=decision]','qa_ready');add('fill','#editor-review-form [name=note]','Synthetic technical checks pass. Human and rights review remain pending.');click('#editor-review-form button','.editor-workflow');click('[data-action=publish]','.editor-workflow');capture('qa-published');run('publish')
assert document()['document']['workflow']=='qa_published' and document()['document']['head_revision']==2
family=Client(True);family.call('login',{'access_code':'DEMO-FAMILY-A'});practice=family.call('start',{'request_id':rid(),'child_id':'synthetic-an','lesson_id':lesson['id']})['session']['session_id']
add('select','#editor-quarantine-form [name=content_revision]','2');add('select','#editor-quarantine-form [name=blocked]','true');add('fill','#editor-quarantine-form [name=reason]','Synthetic exact-version quarantine.');click('#editor-quarantine-form button','.editor-workflow');capture('quarantined');run('quarantine')
assert document()['document']['published_available'] is False;assert family.call('session?session_id='+practice,expected=409)['code']=='content_unavailable'
add('select','#editor-quarantine-form [name=blocked]','false');add('fill','#editor-quarantine-form [name=reason]','Synthetic technical recheck and release.');click('#editor-quarantine-form button','.editor-workflow');capture('released');run('release')
assert document()['document']['published_available'] is True;assert family.call('session?session_id='+practice)['view']['lesson']['title_en']==title2
# Make a real competing editor change after this browser has read its revision.
current=document();outside=json.loads(json.dumps(current['lesson']));outside['title_en']=lesson['title_en']+' — Concurrent QA';editor.call('draft',{'request_id':rid(),'expected_revision':current['document']['revision'],'lesson':outside})
add('fill','input[data-path=title_en]',title2+' local unsaved');click('[data-action=save-draft]','#editor-pending');check('document.querySelector("#editor-message").textContent.includes("đã thay đổi")','stale-draft-conflict');capture('stale');click('[data-action=reconcile]','#editor-pending');click('[data-action=discard-pending]','#editor-confirm');click('[data-action=confirm]','input[data-path=title_en]');check('document.querySelector("input[data-path=title_en]").value.includes("local unsaved")','discard-operation-preserves-draft');click('[data-action=use-current]','#editor-confirm');click('[data-action=confirm]','input[data-path=title_en]');check('document.querySelector("input[data-path=title_en]").value==='+json.dumps(outside['title_en']),'explicit-current-version-adopted');capture('conflict-recovered');run('stale-recovery')
add('fill','input[data-path=title_en]',outside['title_en']+' unsaved before logout');click('[data-action=logout]','#editor-login-form');check('!document.body.textContent.includes("Concurrent QA")&&!document.querySelector(".editor-layout")','logout-clears-private-display');capture('logged-out');click('#editor-login-form button','input[data-path=title_en]');check('document.querySelector("input[data-path=title_en]").value.includes("unsaved before logout")','draft-restored-after-new-login');capture('reauthenticated');run('logout-recovery')
control.write_text(json.dumps({'clock_offset_ms':900001})+'\n');click('[data-action=refresh]','#editor-login-form');check('!document.querySelector(".editor-layout")&&!document.body.textContent.includes("Concurrent QA")','server-expiry-clears-private-display');capture('expired');run('expiry');control.write_text('{}\n')
add('eval',"(()=>{const link=[...document.querySelectorAll('link[rel=stylesheet]')].find(x=>x.href.includes('read2lead-editor')),brand=document.querySelector('a.brand');if(!link)throw Error('missing-style-control');const old=link.disabled;let caught=false;try{link.disabled=true;caught=brand.getBoundingClientRect().height<44;if(!caught)throw Error('style-control-not-detected');}finally{link.disabled=old;}return {known_bad:'editor-stylesheet-disabled',detected:caught,restoration_pending:true}})()");
add('wait','--fn','getComputedStyle(document.querySelector("a.brand")).minHeight==="48px"&&document.querySelector("a.brand").getBoundingClientRect().height>=44');check('getComputedStyle(document.querySelector("a.brand")).minHeight==="48px"','stylesheet-control-restored');
add('eval',"(()=>{const r=document.documentElement,s=r.getAttribute('style');try{r.style.minWidth='2000px';if(r.scrollWidth<=innerWidth)throw Error('missed-overflow');}finally{if(s===null)r.removeAttribute('style');else r.setAttribute('style',s);}if(r.scrollWidth>innerWidth)throw Error('overflow-not-restored');return {detected:true,restored:true}})()");add('errors');run('controls')
result={'status':'PASS','phases':len(receipts),'commands':sum(x['commands'] for x in receipts),'screenshots':sum(x['screenshots'] for x in receipts),'lost_committed_reply_replayed_once':True,'stale_recovery_preserved_draft':True,'editor_ui_controls_learner_availability':True,'synthetic_only':True,'independent_review':False};(ev/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
r=subprocess.run(cmd+['close'],text=True,capture_output=True);(ev/'close.json').write_text(r.stdout);r.check_returncode()
