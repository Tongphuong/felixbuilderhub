"""Actual synthetic learner UI checks for editorial publication/quarantine. Fake microphone only."""
import argparse, hashlib, json, sqlite3, subprocess, time, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import urlparse
p = argparse.ArgumentParser(description=__doc__)
for name in ['url', 'config', 'data-root', 'evidence', 'screenshots']:
    p.add_argument('--' + name, required=True)
a = p.parse_args(); u = urlparse(a.url)
assert u.scheme == 'http' and u.hostname == '127.0.0.1' and u.port and u.path == '/read2lead/self-learn/' and not any([u.username,u.password,u.query,u.fragment]), 'explicit loopback URL required'
origin = u.scheme + '://' + u.netloc
data_root = Path(a.data_root); assert data_root.is_absolute() and data_root.resolve() == data_root and not (data_root/'synthetic-target.json').is_symlink()
assert json.loads((data_root/'synthetic-target.json').read_text()) == {'format':1,'purpose':'read2lead-local-synthetic','database':'read2lead-synthetic.sqlite'}
with sqlite3.connect((data_root/'read2lead-synthetic.sqlite').as_uri()+'?mode=ro',uri=True) as db:
    assert db.execute('PRAGMA application_id').fetchone()[0] == 0x52324c31
    assert db.execute("SELECT value FROM r2l_meta WHERE key='environment'").fetchone()[0] == 'synthetic'
    assert all(row[0].startswith('synthetic-') for row in db.execute('SELECT id FROM children'))
    assert all(db.execute('SELECT count(*) FROM '+name).fetchone()[0] == 0 for name in ['sessions','library_readings','editor_documents'])
    assert db.execute('SELECT sum(balance) FROM wallets').fetchone()[0] == 0
repo = Path(__file__).resolve().parents[3]
lesson = json.loads((repo/'tests/fixtures/read2lead-self-learn/level-lessons.json').read_text())['lessons'][2]
revised = json.loads(json.dumps(lesson)); revised['title_en'] += ' — QA revision'
ev, out = Path(a.evidence).resolve(), Path(a.screenshots).resolve(); ev.mkdir(parents=True,exist_ok=False); out.mkdir(parents=True,exist_ok=False)
init = ev/'synthetic-microphone.js'; init.write_text('''window.__micRequests=0;window.__stopped=0;
Object.defineProperty(MediaDevices.prototype,'getUserMedia',{configurable:true,value:async()=>{window.__micRequests++;return {getTracks:()=>[{stop:()=>{window.__stopped++;}}]};}});
window.MediaRecorder=class{state='inactive';mimeType='audio/webm';start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}};
''')
session = 'r2l-editor-content-' + str(time.time_ns())
browser = ['agent-browser','--session',session,'--config',str(Path(a.config).resolve()),'--engine','chrome','--allowed-domains','127.0.0.1','--init-script',str(init),'--json']
(ev/'browser-session.json').write_text(json.dumps({'session':session,'command':browser},indent=2)+'\n')
commands, receipts = [], []
def add(*values): commands.append(list(values))
def wait(selector): add('wait','--fn','!!document.querySelector('+json.dumps(selector)+')&&document.querySelector("main")?.getAttribute("aria-busy")==="false"')
def check(expression,name): add('eval','(()=>{if(!('+expression+'))throw Error('+json.dumps(name)+');return {check:'+json.dumps(name)+',passed:true}})()')
def click(selector,target):
    add('eval','document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center",behavior:"instant"})'); add('click',selector); wait(target)
def capture(name):
    for width in [390,768,1024,1280]:
        add('set','viewport',str(width),'900'); check('document.documentElement.scrollWidth<=innerWidth',name+'-overflow-'+str(width))
        check("[...document.querySelectorAll('button,select,input,textarea,summary')].filter(x=>!x.disabled&&x.getClientRects().length).map(x=>(['checkbox','radio'].includes(x.type)?x.closest('label'):x).getBoundingClientRect()).every(r=>r.width>=44&&r.height>=44)",name+'-targets-'+str(width))
        add('screenshot','--full',str(out/(name+'-'+str(width)+'.png')))
    add('set','viewport','390','900')
def run(name):
    global commands
    r = subprocess.run(browser+['batch','--bail'],input=json.dumps(commands),text=True,capture_output=True)
    (ev/(name+'.json')).write_text(r.stdout); (ev/(name+'.stderr')).write_text(r.stderr)
    if r.returncode: print(r.stdout[-7500:],r.stderr,flush=True); raise RuntimeError('browser phase failed: '+name)
    rows = json.loads(r.stdout); assert len(rows) == len(commands)
    for row in rows:
        assert row.get('success',True),row
        if row['command'][0] == 'errors': assert not row['result']['errors'],row['result']['errors']
    shots = [Path(row['command'][-1]) for row in rows if row['command'][0]=='screenshot']
    receipt = {'phase':name,'status':'PASS','commands':len(rows),'screenshots':len(shots),'screenshot_sha256':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in shots},'real_http':True,'real_audio':False,'independent_review':False}
    receipts.append(receipt); (ev/'browser-receipt.json').write_text(json.dumps(receipts,indent=2)+'\n'); print(json.dumps({k:v for k,v in receipt.items() if k!='screenshot_sha256'}),flush=True); commands=[]
class Client:
    def __init__(self,editor=False): self.prefix='/api/read2lead/editor/' if editor else '/api/read2lead/self-learn/';self.header='X-R2L-Editor-CSRF' if editor else 'X-R2L-CSRF';self.cookie='';self.csrf=''
    def call(self,route,data=None):
        request=urllib.request.Request(origin+self.prefix+route,data=None if data is None else json.dumps(data,ensure_ascii=False).encode(),headers={'Origin':origin,'Content-Type':'application/json',**({'Cookie':self.cookie} if self.cookie else {}),**({self.header:self.csrf} if self.csrf else {})})
        with urllib.request.urlopen(request,timeout=15) as response:
            value=json.load(response);assert value.get('ok') is True,(route,value)
            if response.headers.get('Set-Cookie'):self.cookie=response.headers['Set-Cookie'].split(';')[0]
            if value.get('csrf'):self.csrf=value['csrf']
            return value
editor, family = Client(True),Client(); editor.call('login',{'editor_id':'synthetic-editor-qa','access_secret':'DEMO-EDITOR-LOCAL-ONLY'}); family.call('login',{'access_code':'DEMO-FAMILY-A'})
assert not editor.call('documents')['documents'] and not family.call('library')['library']['reading_history'] and not family.call('lessons')['sessions']
serial=0
def rid():
    global serial
    serial+=1;return 'editor-browser-'+str(serial)
def draft(value):
    docs=editor.call('documents')['documents'];old=next((d for d in docs if d['lesson_id']==value['id']),None)
    return editor.call('draft',{'request_id':rid(),'expected_revision':old['revision'] if old else 0,'lesson':value})['document']
def publish(value):
    doc=draft(value)
    for route,extra in [('request-review',{}),('review',{'decision':'qa_ready','note':'Synthetic browser technical review.'}),('publish-qa',{})]:
        doc=editor.call(route,{'request_id':rid(),'lesson_id':value['id'],'expected_revision':doc['revision'],**extra})['document']
    return doc
def quarantine(blocked,version=1):
    doc=editor.call('document?lesson_id='+lesson['id'])['current_view']['document']
    return editor.call('quarantine',{'request_id':rid(),'lesson_id':lesson['id'],'content_revision':version,'expected_revision':doc['revision'],'blocked':blocked,'reason':'Synthetic browser availability check.'})
family.call('parent/enter',{'parent_secret':'DEMO-PARENT-A-ONLY'})
profile=next(c for c in family.call('parent/family')['children'] if c['id']=='synthetic-an')
family.call('parent/update-child',{'request_id':rid(),'child_id':'synthetic-an','expected_revision':profile['revision'],'display_name':profile['label_vi'],'archived':False,'learning_enabled':True,'recording_allowed':True})
family.call('parent/exit',{})
add('open',a.url); wait('#login-form'); click('#login-form button','[data-action=start]'); click('.header-tools [data-action=library-open]','.library-intro')
click('[data-action=library-read][data-lesson='+json.dumps(lesson['id'])+']','#free-position-form')
check('document.querySelector(".free-reader").textContent.includes('+json.dumps(lesson['title_en'])+')','original-free-reading'); capture('original-pin'); run('original-pin')
old_reading=family.call('library')['library']['reading_history'][0]['reading_id']
publish(revised)
add('reload');wait('#free-position-form');check('document.querySelector(".free-reader").textContent.includes('+json.dumps(lesson['title_en'])+')&&!document.querySelector(".free-reader").textContent.includes("QA revision")','old-pin-survives-new-publication')
capture('old-pin-after-publication');click('.header-tools [data-action=library-open]','.library-intro');check('document.querySelector('+json.dumps('[data-library-lesson="'+lesson['id']+'"]')+').textContent.includes("QA revision")','new-catalogue-title')
click('[data-action=library-read][data-lesson='+json.dumps(lesson['id'])+']','#free-position-form');check('document.querySelector(".free-reader").textContent.includes("QA revision")','new-free-reading-pin');run('new-publication')
new_reading=family.call('library')['library']['reading_history'][0]['reading_id'];assert new_reading!=old_reading
quarantine(True)
add('select','#free-position',lesson['story']['sentences'][1]['id']);click('#free-save-position','#message')
check('document.querySelector("#message").textContent.includes("chưa mở được")&&!document.querySelector(".free-reader")&&!document.querySelector("form[data-event]")','blocked-free-content-cleared')
check('sessionStorage.getItem("r2l-library-pending:synthetic-an")!==null','free-pending-preserved');capture('free-quarantined');run('free-quarantined')
quarantine(False)
click('.header-tools [data-action=library-open]','#library-pending');click('[data-action=library-retry]','#free-position-form')
check('document.querySelector("#free-position").value==='+json.dumps(lesson['story']['sentences'][1]['id'])+'&&sessionStorage.getItem("r2l-library-pending:synthetic-an")===null','released-free-pending-acknowledged');capture('free-released');run('free-released')
click('.header-tools [data-action=home]','[data-action=start]');click('[data-action=start][data-lesson='+json.dumps(lesson['id'])+']','form[data-event=prediction]');run('practice-open')
practice=family.call('lessons')['sessions'][0]['session_id'];quarantine(True)
add('fill','#response-text','Synthetic pending prediction.');click('form[data-event=prediction] button[type=submit]','#message')
check('document.querySelector("#message").textContent.includes("chưa mở được")&&!document.querySelector("form[data-event]")&&!document.querySelector(".story-panel")','blocked-practice-cleared');capture('practice-quarantined');run('practice-quarantined')
quarantine(False)
click('.header-tools [data-action=home]','[data-action=open-session]');click('[data-action=open-session][data-session='+json.dumps(practice)+']','[data-action=retry]')
capture('practice-pending-after-release');click('[data-action=retry]','[data-stage=input]');check('!document.querySelector("[data-action=retry]")','practice-pending-acknowledged');capture('practice-released');run('practice-released')
assert family.call('session?session_id='+practice)['view']['session']['revision']==1
# Import the original pin as another draft, then quarantine only that exact hash.
draft(lesson);quarantine(True,2)
click('.header-tools [data-action=library-open]','.library-intro');click('[data-action=library-resume][data-reading='+json.dumps(old_reading)+']','#message')
check('document.querySelector("#message").textContent.includes("chưa mở được")&&!document.querySelector(".free-reader")','old-pin-blocked-without-repinning');capture('old-pin-quarantined');run('old-pin-quarantined')
# Move a separate synthetic session to the microphone stage through the real authorized API.
s=family.call('start',{'request_id':rid(),'child_id':'synthetic-an','lesson_id':lesson['id']})['session']
steps=[('prediction',{'text':'Synthetic microphone-stage preparation.'}),('input_complete',{'order':['read']})]+[('answer',{'item_id':q['id'],'choice_index':q['correct_index'],'text':'','evidence_sentence_ids':[e['sentence_id'] for e in q['evidence_spans']],'support_used':[],'capture_status':'not_attempted'}) for q in lesson['questions']]+[('save_understand',{}),('begin_use',{})]
for event,payload in steps:s=family.call('event',{'api_version':'1.2','request_id':rid(),'child_id':'synthetic-an','session_id':s['session_id'],'expected_revision':s['revision'],'event':event,'payload':payload})['session']
mic_session=s['session_id'];add('open',a.url+'?session='+mic_session);wait('form[data-event=shadow_complete]');click('#microphone','#stop-microphone');add('wait','--fn','!document.querySelector("#stop-microphone").hidden')
check('window.__micRequests===1','fake-capture-started');capture('microphone-active');run('microphone-active')
quarantine(True)
add('wait','--fn','window.__stopped>0&&!document.querySelector("#microphone")&&document.querySelector("#message")?.textContent.includes("chưa mở được")')
check('!document.querySelector("form[data-event]")&&!document.querySelector(".story-panel")','quarantine-stops-capture-and-hides-lesson');capture('microphone-quarantined');run('microphone-quarantined')
quarantine(False)
add('open',a.url+'?session='+mic_session);wait('form[data-event=shadow_complete]');click('#microphone','#stop-microphone');add('wait','--fn','!document.querySelector("#stop-microphone").hidden');click('#stop-microphone','#microphone')
check('window.__stopped>0&&window.__micRequests===1','capture-resumes-only-after-release');capture('microphone-released')
add('eval',"(()=>{const root=document.documentElement,before=root.getAttribute('style');let caught=false;try{root.style.minWidth='2000px';caught=root.scrollWidth>innerWidth;if(!caught)throw Error('overflow-control-not-detected');}finally{if(before===null)root.removeAttribute('style');else root.setAttribute('style',before);}if(root.scrollWidth>innerWidth)throw Error('overflow-control-not-restored');return {known_bad:'forced-horizontal-overflow',detected:caught,restored:true}})()")
add('errors');run('microphone-released')
final=family.call('session?session_id='+mic_session);assert final['view']['session']['stage']=='shadowing' and final['wallet']['balance']==5
assert len(family.call('library')['library']['reading_history'])==2
summary={'status':'PASS','phases':len(receipts),'commands':sum(r['commands'] for r in receipts),'screenshots':sum(r['screenshots'] for r in receipts),'known_bad_layout_control':'detected_and_restored','synthetic_only':True,'real_audio':False,'independent_review':False,'old_reading_id':old_reading,'new_reading_id':new_reading,'practice_session':practice,'microphone_session':mic_session,'wallet_balance':5,'old_original_hash_quarantined':True,'published_qa_revision_available':True}
(ev/'result.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)
closed=subprocess.run(browser+['close'],text=True,capture_output=True);(ev/'browser-close.json').write_text(closed.stdout);(ev/'browser-close.stderr').write_text(closed.stderr);closed.check_returncode()
