"""Library UI QA against a fresh marked synthetic host, never a deployed service.

Requires installed agent-browser and a trusted server fixture which delays only
the FIRST successful POST library/position response by 12000 ms after commit.
The client times out at 10000 ms. No HTTP fault-injection endpoint is needed.
This file alone is a prepared test, not evidence that a browser run passed.
"""
import argparse
import hashlib
import json
import subprocess
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
for name in ['url', 'config', 'evidence', 'screenshots']:
    parser.add_argument('--' + name, required=True)
parser.add_argument('--resume-from', help='Prior evidence directory with the first three passing phases; preserves their synthetic data.')
args = parser.parse_args()
url = urlparse(args.url)
if not (url.scheme == 'http' and url.hostname == '127.0.0.1'
        and url.path == '/read2lead/self-learn/' and url.port
        and not url.username and not url.password and not url.query and not url.fragment):
    parser.error('An explicit loopback QA URL with a port and no credentials/query is required.')
origin = url.scheme + '://' + url.netloc
evidence = Path(args.evidence).resolve()
screenshots = Path(args.screenshots).resolve()
evidence.mkdir(parents=True, exist_ok=False)
screenshots.mkdir(parents=True, exist_ok=False)
repo = Path(__file__).resolve().parents[3]
lessons = json.loads((repo / 'tests/fixtures/read2lead-self-learn/level-lessons.json').read_text())['lessons']
by_level = {lesson['level']: lesson for lesson in lessons}
lesson = by_level['L2']
session = 'r2l-library-features-' + str(time.time_ns())
browser = ['agent-browser', '--session', session, '--config', str(Path(args.config).resolve()),
           '--engine', 'chrome', '--allowed-domains', '127.0.0.1', '--json']
commands, receipts = [], []


def add(*command):
    commands.append(list(command))


def wait(selector):
    add('wait', '--fn', '!!document.querySelector(' + json.dumps(selector)
        + ')&&document.querySelector("main")?.getAttribute("aria-busy")==="false"')


def check(expression, name):
    add('eval', '(()=>{if(!(' + expression + '))throw Error(' + json.dumps(name)
        + ');return {check:' + json.dumps(name) + ',passed:true}})()')


def center(selector):
    add('eval', 'document.querySelector(' + json.dumps(selector)
        + ').scrollIntoView({block:"center",behavior:"instant"})')


def click(selector, target):
    center(selector)
    add('click', selector)
    wait(target)


def choose(selector, value, target='.library-intro'):
    center(selector)
    add('select', selector, value)
    wait(target)


def toggle(selector, enabled=True):
    center(selector)
    add('check' if enabled else 'uncheck', selector)


def capture(name):
    for width in [390, 768, 1024, 1280]:
        add('set', 'viewport', str(width), '900')
        check('document.documentElement.scrollWidth<=innerWidth', name + '-overflow-' + str(width))
        check("[...document.querySelectorAll('button,select,input,textarea,summary')].filter(x=>!x.disabled&&x.getClientRects().length).map(x=>(['checkbox','radio'].includes(x.type)?x.closest('label'):x).getBoundingClientRect()).every(r=>r.width>=44&&r.height>=44)", name + '-targets-' + str(width))
        add('screenshot', '--full', str(screenshots / (name + '-' + str(width) + '.png')))
    add('set', 'viewport', '390', '900')


def run(name):
    global commands
    result = subprocess.run(browser + ['batch', '--bail'], input=json.dumps(commands),
                            text=True, capture_output=True)
    (evidence / (name + '.json')).write_text(result.stdout)
    (evidence / (name + '.stderr')).write_text(result.stderr)
    if result.returncode:
        print(result.stdout[-7000:], result.stderr, flush=True)
        raise RuntimeError('Browser phase failed: ' + name)
    rows = json.loads(result.stdout)
    assert len(rows) == len(commands), 'Incomplete browser receipt: ' + name
    for row in rows:
        if row['command'][0] == 'errors':
            assert not row['result']['errors'], row['result']['errors']
    receipt = {'phase': name, 'status': 'PASS', 'commands': len(rows),
               'screenshots': sum(row['command'][0] == 'screenshot' for row in rows),
               'real_http': True, 'synthetic_only': True, 'independent_review': False}
    receipts.append(receipt)
    (evidence / 'browser-receipt.json').write_text(json.dumps(receipts, indent=2) + '\n')
    print(json.dumps(receipt), flush=True)
    commands = []


@contextmanager
def api(parent=False):
    """Separate authenticated synthetic A session; no use of browser credentials."""
    cookie = csrf = ''

    def call(route, data=None):
        nonlocal cookie, csrf
        request = urllib.request.Request(origin + '/api/read2lead/self-learn/' + route,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Origin': origin, 'Content-Type': 'application/json',
                     **({'Cookie': cookie} if cookie else {}),
                     **({'X-R2L-CSRF': csrf} if csrf else {})})
        with urllib.request.urlopen(request, timeout=25) as response:
            value = json.load(response)
            if response.headers.get('Set-Cookie'):
                cookie = response.headers['Set-Cookie'].split(';')[0]
            if value.get('csrf'):
                csrf = value['csrf']
            assert value.get('ok') is True, value
            return value

    call('login', {'access_code': 'DEMO-FAMILY-A'})
    try:
        if parent:
            call('parent/enter', {'parent_secret': 'DEMO-PARENT-A-ONLY'})
        yield call
    finally:
        call('logout', {})


def profile_change(enabled):
    with api(parent=True) as call:
        child = next(c for c in call('parent/family')['children'] if c['id'] == 'synthetic-an')
        call('parent/update-child', {'request_id': 'library-parent-' + str(time.time_ns()),
            'child_id': child['id'], 'expected_revision': child['revision'],
            'display_name': child['label_vi'], 'archived': child['archived'],
            'learning_enabled': enabled, 'recording_allowed': child['recording_allowed']})


def parent_values():
    with api(parent=True) as call:
        return {c['id']: {'level': c['level'], 'balance': c['wallet']['balance']}
                for c in call('parent/family')['children']}


before = parent_values()
with api() as call:
    initial = call('library')['library']
    if not args.resume_from:
        assert not initial['favorites'] and not initial['reading_history'], 'A fresh synthetic root is required.'
        assert initial['preferences']['revision'] == 0, 'Do not reuse another QA data root.'
    else:
        prior = Path(args.resume_from).resolve()
        prior_receipts = json.loads((prior / 'browser-receipt.json').read_text())
        phases = [('preferences-and-bookmark', 220, 28), ('conflict-history-and-sibling', 146, 20), ('access-revoked', 21, 4)]
        assert len(prior_receipts) == len(phases), 'Resume requires exactly three completed phases.'
        hashes = {}
        for receipt, (phase, count, shots) in zip(prior_receipts, phases):
            assert receipt == {'phase': phase, 'status': 'PASS', 'commands': count, 'screenshots': shots,
                               'real_http': True, 'synthetic_only': True, 'independent_review': False}
            path = prior / (phase + '.json')
            rows = json.loads(path.read_text())
            assert len(rows) == count and all(row['success'] is True and row['error'] is None for row in rows)
            assert sum(row['command'][0] == 'screenshot' for row in rows) == shots
            for row in rows:
                if row['command'][0] == 'screenshot':
                    image = Path(row['result']['path'])
                    assert image.exists() and image.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
                    hashes[str(image)] = hashlib.sha256(image.read_bytes()).hexdigest()
            hashes[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        assert before == {'synthetic-an': {'level': 'L2', 'balance': 0}, 'synthetic-binh': {'level': 'L0', 'balance': 0}}
        assert initial['child_id'] == 'synthetic-an'
        assert [f['lesson_id'] for f in initial['favorites']] == [lesson['id']]
        assert sorted(initial['preferences']['interest_ids']) == ['everyday', 'nature', 'together']
        history = initial['reading_history']
        assert len(history) == 2 and all(r['lesson_id'] == lesson['id'] and not r['rewards_awarded'] for r in history)
        finished = next(r for r in history if r['marked_finished'])
        unfinished = next(r for r in history if not r['marked_finished'])
        assert (finished['revision'], finished['sentence_id']) == (3, 's4')
        assert (unfinished['revision'], unfinished['sentence_id']) == (0, 's1')
        reading_id = finished['reading_id']
        (evidence / 'resume-provenance.json').write_text(json.dumps({'prior': str(prior), 'sha256': hashes,
            'completed_phases': prior_receipts, 'current_library': initial, 'levels_wallets': before,
            'status': 'PRECONDITIONS_PASS'}, indent=2) + '\n')
card = '.catalogue [data-library-lesson="' + lesson['id'] + '"]'
favorite = card + ' [data-action=library-favorite]'
read = card + ' [data-action=library-read]'
pattern = '**/api/read2lead/self-learn/library/favorite'
disabled = False
try:
    add('open', args.url)
    wait('#login-form')
    add('fill', '#access-code', 'DEMO-FAMILY-A')
    click('#login-form button', '[data-action=start]')
    click('[data-action=library-open]', '.library-intro')
    if not args.resume_from:
        check('document.querySelectorAll(".catalogue .library-card").length===5&&document.querySelectorAll(".suggestions .library-card").length===3', 'initial-level-and-suggestions')
        add('focus', '#library-level-filter')
        check('document.activeElement.id==="library-level-filter"', 'keyboard-filter-focus')
        capture('library-initial')
        click('#library-interests summary', '#library-interests-form')
        for interest in ['nature', 'together', 'everyday', 'create']:
            toggle('input[name=interest][value=' + interest + ']')
        click('#library-interests-form button', '.library-intro')
        check('document.querySelector("#message").textContent.includes("tối đa 3")', 'four-interests-refused')
        click('#library-interests summary', '#library-interests-form')
        toggle('input[name=interest][value=create]', False)
        click('#library-interests-form button', '.library-intro')
        add('reload')
        wait('.library-intro')
        click('#library-interests summary', '#library-interests-form')
        check('document.querySelectorAll("input[name=interest]:checked").length===3', 'three-interests-survive-reload')
        capture('interests-saved')
        choose('#library-interest-filter', 'nature', '#library-no-results')
        capture('filter-empty')
        click('[data-action=library-reset-filters]', '.library-intro')
        check('document.querySelectorAll(".catalogue .library-card").length===30', 'reset-shows-full-catalogue')
        choose('#library-level-filter', 'L2')
        choose('#library-interest-filter', 'together')
        check('document.querySelectorAll(".catalogue .library-card").length===2', 'combined-level-interest-filter')
        choose('#library-interest-filter', '')
        add('network', 'route', pattern, '--abort')
        click(favorite, '#library-pending')
        capture('favorite-pending')
        add('eval', "(()=>{const key='r2l-library-pending:synthetic-an';sessionStorage.setItem(key,JSON.stringify(JSON.parse(sessionStorage.getItem(key)),null,2)+'\\n');return {synthetic_pending_reformatted:true}})()")
        add('reload')
        wait('#library-pending')
        add('network', 'unroute', pattern)
        click('[data-action=library-retry]', '.library-intro')
        check('!document.querySelector("#library-pending")&&document.querySelector(' + json.dumps(favorite) + ').getAttribute("aria-pressed")==="true"', 'favorite-retry-saved-once')
        toggle('#library-favorites-filter')
        wait('.library-intro')
        check('document.querySelectorAll(".catalogue .library-card").length===1', 'favorite-filter')
        click(favorite, '#library-no-results')
        capture('favorite-removed')
        toggle('#library-favorites-filter', False)
        wait('.library-intro')
        click(favorite, '.library-intro')
        click(read, '.free-reader')
        check('!document.querySelector("#microphone,form[data-event=answer]")', 'free-reader-no-microphone-or-questions')
        add('wait', '--fn', '[...document.querySelectorAll(".scene")].every(i=>i.complete&&i.naturalWidth>0)')
        capture('free-reader-l2')
        choose('#free-position', 's3', '.free-reader')
        click('#free-save-position', '#library-pending')
        capture('position-uncertain')
        add('reload')
        wait('#library-pending')
        check('document.querySelector("#free-sentence-s3").classList.contains("is-bookmark")', 'committed-position-survives-lost-response')
        click('[data-action=library-retry]', '.free-reader')
        check('!document.querySelector("#library-pending")&&document.querySelector("#message").textContent.includes("một lần")', 'position-exact-replay')
        run('preferences-and-bookmark')

        with api() as call:
            current = call('library')['library']
            assert len(current['favorites']) == 1 and len(current['reading_history']) == 1
            reading = current['reading_history'][0]
            assert reading['revision'] == 1 and reading['sentence_id'] == 's3'
            reading_id = reading['reading_id']
            call('library/position', {'request_id': 'library-external-' + str(time.time_ns()),
                 'child_id': 'synthetic-an', 'reading_id': reading_id, 'expected_revision': 1,
                 'sentence_id': 's4', 'marked_finished': False})
        choose('#free-position', 's5', '.free-reader')
        click('#free-save-position', '#library-pending')
        check('document.querySelector("#message").textContent.includes("đã đổi")', 'stale-bookmark-refused')
        click('[data-action=library-check]', '#library-pending')
        check('document.querySelector("#free-sentence-s4").classList.contains("is-bookmark")', 'reconciliation-loads-current-bookmark')
        capture('position-conflict')
        click('[data-action=library-discard]', '.free-reader')
        click('#free-mark-finished', '.free-reader')
        check('!document.querySelector("#free-position-form")&&document.querySelector("#free-reading-save-status").textContent.includes("tự đánh dấu")', 'self-reported-finish')
        add('reload')
        wait('.free-reader')
        capture('free-reading-finished')
        click('.free-reader [data-action=library-read]', '#free-position-form')
        check('new URL(location.href).searchParams.get("reading")!==' + json.dumps(reading_id), 'reread-is-a-new-visit')
        check('document.querySelector("#free-sentence-s1").classList.contains("is-bookmark")', 'reread-starts-at-first-sentence')
        click('.free-reader [data-action=library-open]', '.library-intro')
        check('document.querySelectorAll(".free-reading-history [data-reading-history]").length===2', 'both-visits-preserved')
        capture('free-reading-history')
        add('select', '#child-select', 'synthetic-binh')
        wait('[data-action=start]')
        click('[data-action=library-open]', '.library-intro')
        check('!document.querySelector(".free-reading-history")&&document.querySelectorAll(".catalogue [aria-pressed=true]").length===0', 'sibling-has-own-history-and-favorites')
        click('.catalogue [data-action=library-read][data-lesson="' + by_level['L0']['id'] + '"]', '.free-reader')
        capture('free-reader-l0')
        add('select', '#child-select', 'synthetic-an')
        wait('[data-action=start]')
        click('[data-action=library-open]', '.library-intro')
        click(card + ' [data-action=start]', '[data-stage=pre_read]')
        click('[data-action=pause]', '[data-action=resume]')
        click('[data-action=library-open]', '.library-intro')
        check('!!document.querySelector("#library-practice-heading")', 'practice-history-linked')
        add('eval', "sessionStorage.setItem('r2l-library-pending:synthetic-an','{SYNTHETIC_MALFORMED_RECORD')")
        add('reload')
        wait('#library-pending')
        check('!document.querySelector("[data-action=library-retry]")&&!document.body.textContent.includes("SYNTHETIC_MALFORMED_RECORD")', 'malformed-record-is-not-resent-or-exposed')
        capture('malformed-pending-recovery')
        click('[data-action=library-discard]', '.library-intro')
        check('!document.querySelector("#library-pending")&&document.querySelectorAll(".free-reading-history [data-reading-history]").length===2', 'explicit-recovery-keeps-server-history')
        run('conflict-history-and-sibling')

        profile_change(False)
        disabled = True
        click('[data-action=library-open]', '.empty')
        check('!document.querySelector(".library-intro,.free-reader,.free-reading-history")&&document.body.textContent.includes("Hồ sơ trước chưa được mở học")', 'revocation-clears-private-library')
        capture('library-access-revoked')
        run('access-revoked')
        profile_change(True)
        disabled = False
    add('open', args.url)
    add('reload')
    wait('[data-action=start]')
    click('[data-action=library-open]', '.library-intro')
    add('network', 'route', pattern, '--abort')
    click(favorite, '#library-pending')
    click('[data-action=logout]', '#login-form')
    check("sessionStorage.getItem('r2l-library-pending:synthetic-an')===null", 'logout-clears-child-pending')
    add('network', 'unroute', pattern)
    add('fill', '#access-code', 'DEMO-FAMILY-B')
    click('#login-form button', '[data-action=start]')
    add('open', args.url + '?view=library&reading=' + reading_id)
    wait('.library-intro')
    check('!document.querySelector(".free-reader,.free-reading-history")', 'other-family-reading-link-refused')
    check('document.querySelectorAll(".catalogue [aria-pressed=true]").length===0', 'other-family-favorites-private')
    capture('other-family-library')
    click('.catalogue [data-action=library-read][data-lesson="' + by_level['L5']['id'] + '"]', '.free-reader')
    capture('free-reader-l5')
    click('[data-action=logout]', '#login-form')
    check('!document.querySelector(".free-reader,.free-reading-history")', 'logout-clears-visible-reading')
    add('errors')
    run('logout-and-family-privacy')
    after = parent_values()
    assert after == before, 'Library actions must not change any child level or wallet.'
    (evidence / 'value-preservation.json').write_text(json.dumps({'before': before, 'after': after, 'status': 'PASS'}, indent=2) + '\n')
finally:
    try:
        if disabled:
            profile_change(True)
    finally:
        result = subprocess.run(browser + ['close'], text=True, capture_output=True)
        (evidence / 'browser-close.json').write_text(result.stdout)
        (evidence / 'browser-close.stderr').write_text(result.stderr)
