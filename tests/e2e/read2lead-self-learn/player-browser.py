"""Actual built-page/HTTP browser journey. Requires the installed agent-browser; no downloads.
Usage: python3 .../player-browser.py --url http://127.0.0.1:8770/read2lead/self-learn/ --evidence ABS_DIR --screenshots ABS_DIR --config ABS_EMPTY_JSON
Only public synthetic access and authored test responses. Microphone is disabled by the synthetic parent policy; no real audio is captured.
"""
import argparse, json, subprocess, time
from pathlib import Path
from urllib.parse import urlparse

p = argparse.ArgumentParser()
p.add_argument('--url', required=True); p.add_argument('--evidence', type=Path, required=True)
p.add_argument('--screenshots', type=Path, required=True); p.add_argument('--config', type=Path, required=True)
a = p.parse_args()
url = urlparse(a.url)
assert url.scheme == 'http' and url.hostname == '127.0.0.1' and url.path == '/read2lead/self-learn/'
for target in [a.evidence, a.screenshots]: target.mkdir(parents=True, exist_ok=True)
stamp = str(time.time_ns())
init = a.evidence / ('denied-microphone-' + stamp + '.js')
init.write_text("if (globalThis.MediaDevices) Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {configurable:true,value:async()=>{throw new DOMException('Synthetic denial','NotAllowedError')}});\n")
commands = []
def add(*args): commands.append(list(args))
def wait(selector): add('wait', '--fn', f'!!document.querySelector({json.dumps(selector)}) && document.querySelector("main")?.getAttribute("aria-busy") === "false"')
def click(selector, next_selector): add('click', selector); wait(next_selector)
def check(expression, label): add('eval', f'(() => {{ if (!({expression})) throw Error({json.dumps(label)}); return {{check:{json.dumps(label)},passed:true}}; }})()')
def capture(name):
    for width in [390, 768, 1024, 1280]:
        add('set', 'viewport', str(width), '900')
        check('document.documentElement.scrollWidth <= innerWidth', name + '-no-overflow-' + str(width))
        add('eval', "(() => {const bad=[...document.querySelectorAll('button,select,input,textarea,summary')].filter(x=>!x.disabled&&x.getClientRects().length).map(x=>({x,r:(['radio','checkbox'].includes(x.type)?x.closest('label'):x).getBoundingClientRect()})).filter(({r})=>r.width<44||r.height<44).map(({x,r})=>({tag:x.tagName,name:x.name||x.textContent,width:r.width,height:r.height}));if(bad.length)throw Error('Small targets '+JSON.stringify(bad));return {check:'touch-targets',passed:true};})()")
        add('screenshot', '--full', str((a.screenshots / (name + '-' + str(width) + '.png')).resolve()))
    add('set', 'viewport', '390', '900')

add('open', a.url); wait('#login-form'); capture('login')
add('fill', '#access-code', 'WRONG-DEMO'); click('#login-form button', '#login-form')
check('document.querySelector("#message").textContent.includes("chưa đúng")', 'invalid-login')
add('fill', '#access-code', 'DEMO-FAMILY-A'); click('#login-form button', '[data-action="start"]'); capture('home')
add('select', '#level-filter', 'L2'); check('document.querySelectorAll("[data-action=start]").length===5', 'library-filter')
click('[data-action="start"]', '[data-stage="pre_read"]'); capture('pre-read')
add('fill', '#response-text', 'Synthetic prediction: the map needs a dry place.')
add('network', 'route', '**/api/read2lead/self-learn/event', '--abort')
click('form[data-event="prediction"] button[type="submit"]', '#pending-notice')
check('document.querySelector("#save-status").textContent.includes("Chưa xác nhận")', 'pending-is-not-saved')
capture('pending')
add('reload'); wait('#pending-notice')
check('document.querySelector("#pending-notice").textContent.includes("Synthetic prediction")', 'pending-survives-reload')
add('network', 'unroute', '**/api/read2lead/self-learn/event')
click('[data-action="retry"]', '[data-stage="input"]'); capture('input')
check('!document.querySelector("#pending-notice")', 'retry-acknowledged')
click('[data-action="pause"]', '[data-action="resume"]'); capture('paused')
add('reload'); wait('[data-action="resume"]')
click('[data-action="resume"]', '[data-action="input-complete"]')
click('[data-action="input-complete"]', 'form[data-event="answer"]')
# A wrong choice deliberately opens the bounded repair; no fabricated good response.
add('check', 'input[name="choice"][value="0"]')
add('fill', '#response-text', 'Synthetic wrong answer: the bench stays dry.')
click('[data-action="hint"]', '.helper')
check('document.querySelector("#response-text").value.includes("Synthetic wrong")', 'draft-survives-hint')
capture('question-hint')
click('form[data-event="answer"] button[type="submit"]', 'form[data-item="r2l-a-dry-place-for-the-map-q2"]')
check('document.activeElement.id === "activity-heading"', 'new-question-keyboard-focus')
add('check', 'input[name="choice"][value="0"]'); add('check', 'input[name="evidence"][value="s9"]')
click('form[data-event="answer"] button[type="submit"]', 'form[data-item="r2l-a-dry-place-for-the-map-q3"]')
add('check', 'input[name="choice"][value="1"]')
click('form[data-event="answer"] button[type="submit"]', '[data-action="begin-repair"]')
click('[data-action="begin-repair"]', 'form[data-event="repair_answer"]'); capture('repair')
add('reload'); wait('form[data-event="repair_answer"]')
add('check', 'input[name="choice"][value="1"]')
click('form[data-event="repair_answer"] button[type="submit"]', '[data-action="save-understand"]')
click('[data-action="save-understand"]', '[data-stage="understand_saved"]'); capture('understand-saved')
add('reload'); wait('[data-stage="understand_saved"]')
click('[data-action="begin-use"]', 'form[data-event="shadow_complete"]'); capture('shadow')
check('document.querySelector("#microphone").disabled && document.querySelector("#capture-status").textContent.includes("Micro đang được tắt")', 'parent-recording-off-enforced')
capture('microphone-disabled')
click('form[data-event="shadow_complete"] button[type="submit"]', 'form[data-event="minny_turn"]'); capture('minny')
for i in range(4):
    if i == 0:
        click('[data-action="frame"]', '.helper')
        check('document.body.textContent.includes("Minny là bạn luyện tập AI")', 'explicit-ai-identity')
    add('fill', '#response-text', ['A treasure map.', 'A tree and a bridge.', 'A drop of water.', 'Smooth stones.'][i])
    target = 'form[data-item="r2l-a-dry-place-for-the-map-m' + str(i + 2) + '"]' if i < 3 else 'form[data-event="retell"]'
    click('form[data-event="minny_turn"] button[type="submit"]', target)
check('!document.querySelector(".story-panel")', 'retell-hides-script'); capture('retell')
add('fill', '#response-text', 'Synthetic retell: Mai and Tom made a map. Mai closed it in a box, so they could use it after the rain.')
click('form[data-event="retell"] button[type="submit"]', 'form[data-event="followup_answer"]'); capture('followup')
add('reload'); wait('form[data-event="followup_answer"]')
add('check', 'input[name="choice"][value="0"]')
click('form[data-event="followup_answer"] button[type="submit"]', '[data-action="complete"]')
click('[data-action="complete"]', '.summary-grid'); capture('summary')
add('reload'); wait('.summary-grid')
check('document.body.textContent.includes("10 kim cương mẫu")', 'exactly-ten-synthetic-credits')
check('document.body.textContent.includes("Không tự lên cấp") && document.body.textContent.includes("Đọc và nói được theo dõi riêng")', 'no-mastery-separate-reading')
add('eval', "(async()=>{const id=new URL(location.href).searchParams.get('session');const r=await(await fetch('/api/read2lead/self-learn/session?session_id='+id)).json();if(r.view.session.stage!=='complete'||r.view.summary.reading.length!==3||r.view.summary.speech.length!==6||r.view.summary.automatic_mastery!==false||r.view.summary.reading[0].support_used.indexOf('revealing_hint')<0||r.view.summary.speech[0].oral_language_state!=='unassessable'||r.view.summary.fresh_probes.length!==2)throw Error('Server evidence mismatch');return {check:'actual-server-evidence',passed:true,session:r.view.session,summary:r.view.summary,wallet:r.wallet};})()")
add('select', '#child-select', 'synthetic-binh'); wait('[data-action="start"]')
check('!document.querySelector("[data-action=open-session]") && document.querySelector("h1").textContent.includes("Bình")', 'sibling-history-isolated')
add('select', '#child-select', 'synthetic-an'); wait('[data-action="open-session"]')
click('[data-action="open-session"]', '.summary-grid')
add('set', 'media', 'light', 'reduced-motion')
check('matchMedia("(prefers-reduced-motion: reduce)").matches', 'reduced-motion')
click('[data-action="logout"]', '#login-form')
add('eval', "(async()=>{if((await fetch('/api/read2lead/self-learn/me')).status!==401)throw Error('Logout not revoked');return {check:'logout-revoked',passed:true};})()")
add('press', 'Tab'); check('document.activeElement !== document.body', 'keyboard-focus-visible-path')
add('errors')
cmd = ['agent-browser', '--session', 'r2l-player-proof-' + stamp, '--config', str(a.config.resolve()), '--engine', 'chrome', '--allowed-domains', '127.0.0.1', '--init-script', str(init.resolve()), '--json', 'batch', '--bail']
# Explicitly center native click/check targets: this CLI can click outside the viewport
# when only a small edge of a tall control is visible. This does not submit forms.
centered = []
for command in commands:
    if command[0] in ['click', 'check']:
        centered.append(['eval', 'document.querySelector(' + json.dumps(command[1]) + ').scrollIntoView({block:"center",behavior:"instant"})'])
    centered.append(command)
r = subprocess.run(cmd, input=json.dumps(centered), text=True, capture_output=True)
(a.evidence / 'browser-journey.json').write_text(r.stdout); (a.evidence / 'browser-journey.stderr').write_text(r.stderr)
if r.returncode:
    print(r.stdout[-7000:]); print(r.stderr); raise SystemExit(r.returncode)
rows = json.loads(r.stdout)
for row in rows:
    if row['command'][0] == 'errors': assert not row['result']['errors'], row['result']['errors']
checks = [row['result'].get('result') for row in rows if row['command'][0] == 'eval']
receipt = {'status': 'PASS', 'commands': len(rows), 'checks': len(checks), 'screenshots': sum(row['command'][0]=='screenshot' for row in rows), 'real_http_sqlite': True, 'capture': 'parent recording preference off; no real acoustic test', 'independent': False}
(a.evidence / 'browser-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n'); print(json.dumps(receipt))

closed = subprocess.run(cmd[:-2]+["close"], text=True, capture_output=True)
(a.evidence/"browser-close.json").write_text(closed.stdout)
closed.check_returncode()
