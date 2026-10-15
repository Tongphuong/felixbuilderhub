"""Actual 30-lesson catalogue sweep and six new-content full journeys. Synthetic data only.
Requires installed agent-browser, a fresh marked synthetic QA server and explicit output paths.
"""
import argparse, json, subprocess, time
from pathlib import Path
from urllib.parse import urlparse

p = argparse.ArgumentParser()
for name in ['url', 'config', 'evidence', 'screenshots']:
    p.add_argument('--' + name, required=True)
p.add_argument('--sweep-only', action='store_true')
a = p.parse_args(); url = urlparse(a.url)
assert url.scheme == 'http' and url.hostname == '127.0.0.1' and url.path == '/read2lead/self-learn/'
repo = Path(__file__).resolve().parents[3]
added = json.loads((repo / 'tests/fixtures/read2lead-self-learn/library-lessons.json').read_text())['lessons']
all_lessons = json.loads((repo / 'tests/fixtures/read2lead-self-learn/level-lessons.json').read_text())['lessons'] + added
lessons = {level: next(l for l in added if l['level'] == level) for level in ['L0','L1','L2','L3','L4','L5']}
ev = Path(a.evidence).resolve(); out = Path(a.screenshots).resolve()
ev.mkdir(parents=True, exist_ok=True); out.mkdir(parents=True, exist_ok=True)
receipts = json.loads((ev/'browser-receipt.json').read_text()) if a.sweep_only else []; stamp = str(time.time_ns())
def add(*args): commands.append(list(args))
def wait(selector): add('wait', '--fn', f'!!document.querySelector({json.dumps(selector)}) && document.querySelector("main")?.getAttribute("aria-busy")==="false"')
def check(expr, name): add('eval', f'(()=>{{if(!({expr}))throw Error({json.dumps(name)});return {{check:{json.dumps(name)},passed:true}}}})()')
def click(selector, target):
    add('eval', 'document.querySelector(' + json.dumps(selector) + ').scrollIntoView({block:"center",behavior:"instant"})')
    add('click', selector); wait(target)
def capture(name, all_widths=False):
    for width in ([390, 768, 1024, 1280] if all_widths else [390, 1280]):
        add('set', 'viewport', str(width), '900')
        check('document.documentElement.scrollWidth<=innerWidth', name+'-overflow-'+str(width))
        add('eval', "(()=>{const bad=[...document.querySelectorAll('button,select,input,textarea,summary')].filter(x=>!x.disabled&&x.getClientRects().length).map(x=>(['checkbox','radio'].includes(x.type)?x.closest('label'):x).getBoundingClientRect()).filter(r=>r.width<44||r.height<44);if(bad.length)throw Error('small targets');return {check:'touch-targets',passed:true}})()")
        add('screenshot', '--full', str(out / (level+'-'+name+'-'+str(width)+'.png')))
    add('set', 'viewport', '390', '900')
for level in ([] if a.sweep_only else ['L0', 'L5', 'L1', 'L3', 'L4', 'L2']):
    l = lessons[level]; commands = []
    add('open', a.url); wait('#login-form')
    if level == 'L5': add('fill', '#access-code', 'DEMO-FAMILY-B')
    click('#login-form button', '[data-action=start]')
    if level == 'L0': add('select', '#child-select', 'synthetic-binh'); wait('[data-action=start]')
    add('select', '#level-filter', level)
    click('[data-action=start][data-lesson="'+l['id']+'"]', '[data-stage=pre_read]')
    check('document.querySelector(".tag").textContent.includes('+json.dumps(level)+')', 'requested-level')
    add('fill', '#response-text', 'Synthetic prediction for ' + level)
    click('form[data-event=prediction] button[type=submit]', '[data-stage=input]')
    check('document.querySelectorAll(".reading-group").length===2', 'authored-reading-groups')
    if level == 'L0':
        check('[...document.querySelectorAll(".reading-group")].every(g=>g.querySelectorAll("p").length===3)', 'l0-three-sentence-groups')
        check('document.body.textContent.includes("chưa thay thế lượt nghe")', 'l0-degraded-audio-explicit')
    capture('input', True)
    click('[data-action=input-complete]', 'form[data-event=answer]')
    for i, q in enumerate(l['questions']):
        if q['kind'] == 'picture_choice':
            check('document.querySelectorAll(".choice-picture").length===3', 'l0-three-real-pictures')
            add('wait', '--fn', '[...document.querySelectorAll(".choice-picture")].every(i=>i.complete&&i.naturalWidth>0)')
            capture('picture-question', True)
        if i == 0 and level == 'L5': capture('evidence-question', True)
        add('check', 'input[name=choice][value="'+str(q['correct_index'])+'"]')
        for span in q['evidence_spans']: add('check', 'input[name=evidence][value="'+span['sentence_id']+'"]')
        click('form[data-event=answer] button[type=submit]', 'form[data-item="'+l['questions'][i+1]['id']+'"]' if i<2 else '[data-action=save-understand]')
    click('[data-action=save-understand]', '[data-stage=understand_saved]')
    add('reload'); wait('[data-stage=understand_saved]')
    click('[data-action=begin-use]', 'form[data-event=shadow_complete]')
    click('.shadow-script summary', 'form[data-event=shadow_complete]')
    check('document.querySelector(".shadow-script").open===false', 'can-fade-script')
    click('form[data-event=shadow_complete] button[type=submit]', 'form[data-event=minny_turn]')
    for i, turn in enumerate(l['minny']['turns']):
        add('fill', '#response-text', 'Synthetic practice turn '+str(i+1))
        click('form[data-event=minny_turn] button[type=submit]', 'form[data-item="'+l['minny']['turns'][i+1]['id']+'"]' if i+1<len(l['minny']['turns']) else 'form[data-event=retell]')
    check('!document.querySelector(".story-panel")', 'retell-no-script')
    if level in ['L0','L1']:
        check('!document.querySelector(".picture-sequence")', 'pictures-not-exposed-before-support')
        click('[data-action=frame][data-item=retell]', '.picture-sequence')
        check('document.querySelectorAll(".retell-pictures img").length===3', 'three-sequence-pictures')
        add('select','select[name=picture0]',l['id']+'-retell-1')
        add('select','select[name=picture1]',l['id']+'-retell-1')
        add('select','select[name=picture2]',l['id']+'-retell-3')
        click('form[data-event=retell] button[type=submit]', '.picture-sequence')
        check('document.querySelector("#message").textContent.includes("mỗi tranh một lần")', 'duplicate-picture-order-refused')
        add('select','select[name=picture1]',l['id']+'-retell-2')
        check('!document.querySelector("#message").textContent.trim()', 'picture-error-clears-on-correction')
    else:
        add('fill','#response-text','Synthetic claim with selected evidence and a reason. An alternative may work, but some information is still unknown.')
    if level == 'L5':
        check('[...document.querySelectorAll(".planning-headings li")].map(x=>x.textContent).join("|")==="Claim|Evidence|Reason|Alternative|What is still unknown?"', 'l5-independent-planning-headings')
    capture('retell', True)
    click('form[data-event=retell] button[type=submit]', 'form[data-event=followup_answer]')
    add('check', 'input[name=choice][value="'+str(l['independent_followup']['correct_index'])+'"]')
    click('form[data-event=followup_answer] button[type=submit]', '[data-action=complete]')
    click('[data-action=complete]', '.summary-grid')
    capture('summary', True)
    add('reload'); wait('.summary-grid')
    add('eval', "(async()=>{const id=new URL(location.href).searchParams.get('session');const r=await(await fetch('/api/read2lead/self-learn/session?session_id='+id)).json();if(r.view.lesson.level!=="+json.dumps(level)+"||r.view.lesson.version!=='1.1.0'||r.view.session.stage!=='complete'||r.view.summary.reading.length!==3||!r.view.summary.reading.every(x=>x.status==='provisional')||r.view.summary.speech.length!=="+str(l['minny']['max_turns']+2)+"||!r.view.summary.speech.every(x=>x.oral_language_state==='unassessable')||r.view.summary.automatic_mastery!==false)throw Error('level evidence mismatch');"+("if(!r.view.summary.speech.at(-1).support_used.includes('frame'))throw Error('picture support lost');" if level in ['L0','L1'] else '')+"return {check:'actual-level-evidence',passed:true,level:r.view.lesson.level,session:r.view.session,summary:r.view.summary,wallet:r.wallet}})()")
    add('errors')
    cmd=['agent-browser','--session','r2l-library-'+level.lower()+'-'+stamp,'--config',str(Path(a.config).resolve()),'--engine','chrome','--allowed-domains','127.0.0.1','--json','batch','--bail']
    r=subprocess.run(cmd,input=json.dumps(commands),text=True,capture_output=True)
    (ev/(level+'-browser.json')).write_text(r.stdout);(ev/(level+'-browser.stderr')).write_text(r.stderr)
    if r.returncode:
        print(r.stdout[-7000:]);print(r.stderr);raise SystemExit(r.returncode)
    rows=json.loads(r.stdout)
    for row in rows:
        if row['command'][0]=='errors':assert not row['result']['errors'],row['result']['errors']
    receipt={'level':level,'status':'PASS','commands':len(rows),'screenshots':sum(row['command'][0]=='screenshot' for row in rows),'real_http':True,'real_audio':False,'independent':False}
    receipts.append(receipt);print(json.dumps(receipt),flush=True)
    (ev/'browser-receipt.json').write_text(json.dumps(receipts,indent=2)+'\n')
    closed=subprocess.run(cmd[:-2]+['close'],text=True,capture_output=True)
    (ev/(level+('-sweep' if receipt.get('kind') else '-journey')+'-close.json')).write_text(closed.stdout)
    closed.check_returncode()

# Sweep every card through the actual page/API into its authored input and first question.
for level in ['L0','L1','L2','L3','L4','L5']:
    commands=[]
    add('open',a.url);wait('#login-form')
    click('#login-form button','[data-action=start]')
    check('document.querySelectorAll("[data-action=start]").length===30','all-thirty-cards')
    for l in [x for x in all_lessons if x['level']==level]:
        add('open',a.url);wait('[data-action=start]')
        add('select','#level-filter',level)
        check('document.querySelectorAll("[data-action=start]").length===5','five-per-level')
        click('[data-action=start][data-lesson="'+l['id']+'"]','[data-stage=pre_read]')
        check('document.querySelector("h1.lesson-title [lang=en]").textContent==='+json.dumps(l['title_en']),'exact-title')
        click('form[data-event=prediction] button[type=submit]','[data-stage=input]')
        add('wait','--fn','[...document.querySelectorAll("main img")].every(i=>i.complete&&i.naturalWidth>0)')
        check('document.querySelectorAll(".reading-group").length===2','authored-chunks')
        check('document.documentElement.scrollWidth<=innerWidth','input-no-overflow')
        add('screenshot','--full',str(out/(l['id']+'-input.png')))
        click('[data-action=input-complete]','form[data-event=answer]')
        if level=='L0':
            add('wait','--fn','document.querySelectorAll(".choice-picture").length===3&&[...document.querySelectorAll(".choice-picture")].every(i=>i.complete&&i.naturalWidth>0)')
            add('screenshot','--full',str(out/(l['id']+'-choices.png')))
        add('eval','(async()=>{const id=new URL(location.href).searchParams.get("session");const r=await(await fetch("/api/read2lead/self-learn/session?session_id="+id)).json();if(r.view.lesson.id!=='+json.dumps(l['id'])+'||r.view.lesson.version!=="1.1.0"||r.view.lesson.level!=='+json.dumps(level)+')throw Error("wrong lesson");return {check:"catalogue-pin",session:r.view.session,lesson:r.view.lesson}})()')
    add('errors')
    cmd=['agent-browser','--session','r2l-sweep-'+level.lower()+'-'+stamp,'--config',str(Path(a.config).resolve()),'--engine','chrome','--allowed-domains','127.0.0.1','--json','batch','--bail']
    r=subprocess.run(cmd,input=json.dumps(commands),text=True,capture_output=True)
    (ev/(level+'-sweep.json')).write_text(r.stdout);(ev/(level+'-sweep.stderr')).write_text(r.stderr)
    if r.returncode:
        print(r.stdout[-7000:]);print(r.stderr);raise SystemExit(r.returncode)
    rows=json.loads(r.stdout)
    for row in rows:
        if row['command'][0]=='errors':assert not row['result']['errors'],row['result']['errors']
    receipt={'level':level,'kind':'all-five-catalogue-sweep','status':'PASS','commands':len(rows),'screenshots':sum(row['command'][0]=='screenshot' for row in rows),'real_http':True,'real_audio':False,'independent':False}
    receipts.append(receipt);print(json.dumps(receipt),flush=True)
    (ev/'browser-receipt.json').write_text(json.dumps(receipts,indent=2)+'\n')
    closed=subprocess.run(cmd[:-2]+['close'],text=True,capture_output=True)
    (ev/(level+('-sweep' if receipt.get('kind') else '-journey')+'-close.json')).write_text(closed.stdout)
    closed.check_returncode()
