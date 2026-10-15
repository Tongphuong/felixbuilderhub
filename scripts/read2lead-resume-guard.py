#!/usr/bin/env python3
"""Opt-in Read2Lead resume preflight. Not a sandbox, authorization grant or global hook.

Capture only after reconciling ownership and dirty files. Commands inherit a local
Git-common-directory flock. Unknown source changes are detected, never undone.
An interrupted owner is not expired by time; explicit matching acknowledgement
is required after the OS lock is released. No cleanup/reset/stash is performed.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import uuid
from contextlib import contextmanager

CONTROL = '.founder-os/products/read2lead/CONTROL.md'
KEYS = {'format', 'repo', 'common_dir', 'branch', 'head', 'index_sha256',
        'task', 'session', 'owner', 'owned', 'baseline'}


class Refusal(Exception):
    def __init__(self, reason, detail=''):
        self.reason, self.detail = reason, detail
        super().__init__(reason + (': ' + detail if detail else ''))


def require(ok, reason, detail=''):
    if not ok:
        raise Refusal(reason, detail)


def git(repo, *args):
    result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(repo), *args],
                            capture_output=True, check=False)
    require(result.returncode == 0, 'git_failed', args[0])
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def literal_path(value):
    # Square brackets are literal route filenames (e.g. [id].js), never globbed.
    require(isinstance(value, str) and value and not any(c in value for c in '\\*?\x00\n\r'), 'invalid_scope')
    p = PurePosixPath(value)
    require(not p.is_absolute() and p.as_posix() == value and
            not any(c in {'.', '..', '.git'} for c in value.split('/')), 'invalid_scope', value)
    return value


def inspect_file(repo, name):
    p = repo / name
    # Never follow a symlinked parent outside the checkout during inventory.
    require(p.parent.resolve().is_relative_to(repo), 'escaped_path', name)
    if not p.exists() and not p.is_symlink():
        return {'kind': 'missing'}
    mode = p.lstat().st_mode
    if stat.S_ISLNK(mode):
        return {'kind': 'symlink', 'target': os.readlink(p)}
    require(stat.S_ISREG(mode), 'unsupported_path', name)
    return {'kind': 'file', 'sha256': digest(p.read_bytes()), 'mode': stat.S_IMODE(mode)}


def inventory(repo):
    names = git(repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')
    return {name: inspect_file(repo, name) for name in sorted(set(names)) if name}


def identity(repo):
    require(repo.is_absolute() and repo.is_dir(), 'wrong_worktree')
    root = Path(git(repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    require(repo == root, 'wrong_worktree', str(repo))
    return {'repo': str(root),
            'common_dir': str(Path(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip()).resolve()),
            'branch': git(repo, 'branch', '--show-current').decode().strip(),
            'head': git(repo, 'rev-parse', 'HEAD').decode().strip(),
            'index_sha256': digest(git(repo, 'ls-files', '--stage', '-z'))}


def check_task(repo, manifest):
    p = repo / CONTROL
    require(p.is_file() and not p.is_symlink(), 'control_missing')
    text = p.read_text()
    # The repository preserves old controls verbatim after this explicit boundary.
    boundary = '## Historical control record — preserved verbatim below'
    text = text.split(boundary, 1)[0]
    sections = re.findall(r'^## Current task\s*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    require(len(sections) == 1, 'ambiguous_current_task')
    fields = {}
    for name, value in re.findall(r'^- ([^:\n]+):\s*([^\n]*)', sections[0], re.M):
        require(name not in fields, 'duplicate_control_field', name)
        fields[name] = value.strip()
    expected = {'Task ID': manifest['task'], 'Session ID': manifest['session'],
                'Owner': 'Codex', 'Status': 'active', 'Branch': manifest['branch'],
                'Worktree': manifest['repo'], 'Starting commit': manifest['head']}
    for key, value in expected.items():
        require(fields.get(key) == value, 'task_mismatch', key)
    declared = {part.strip() for part in fields.get('Files owned', '').split(';')}
    for name in manifest['owned']:
        require(name in declared, 'scope_not_recorded', name)
    workers = re.search(r'^- Active workers:\s*(\d+)', text[:text.index('## Current task')], re.M)
    require(workers is not None and workers.group(1) == '0', 'conflicting_workers')


def validate_manifest(m):
    require(isinstance(m, dict) and set(m) == KEYS and m['format'] == 1, 'invalid_manifest')
    require(m['owner'] == 'Codex' and all(isinstance(m[k], str) and m[k] for k in
            ['repo', 'common_dir', 'branch', 'head', 'task', 'session']), 'invalid_manifest')
    require(re.fullmatch(r'[0-9a-f]{40}', m['head']) is not None, 'invalid_manifest')
    require(re.fullmatch(r'[0-9a-f]{64}', m['index_sha256']) is not None, 'invalid_manifest')
    require(isinstance(m['owned'], list) and m['owned'] and len(m['owned']) == len(set(m['owned'])), 'invalid_scope')
    for name in m['owned']:
        literal_path(name)
    require(isinstance(m['baseline'], dict) and m['baseline'], 'invalid_manifest')
    for name, data in m['baseline'].items():
        literal_path(name)
        require(isinstance(data, dict) and data.get('kind') in {'file', 'missing', 'symlink'}, 'invalid_manifest')


def preflight(repo, m):
    validate_manifest(m)
    require(str(repo) == m['repo'] and repo.resolve() == repo, 'wrong_worktree')
    actual = identity(repo)
    for key, reason in [('repo', 'wrong_worktree'), ('common_dir', 'wrong_git_common_dir'),
                        ('branch', 'wrong_branch'), ('head', 'wrong_sha'), ('index_sha256', 'index_changed')]:
        require(actual[key] == m[key], reason)
    check_task(repo, m)
    for name in m['owned']:
        p = repo / name
        require(not p.is_dir(), 'scope_is_directory', name)
        # A same-checkout symlink is still refused for owned files.
        while p != repo:
            require(not p.is_symlink(), 'scope_symlink', name)
            p = p.parent
    now = inventory(repo)
    for name in sorted(set(now) | set(m['baseline'])):
        if name not in m['owned']:
            require(now.get(name) == m['baseline'].get(name), 'foreign_change', name)
    return {'status': 'PASS', 'task': m['task'], 'session': m['session'], 'files_checked': len(now)}


def capture(repo, task, session, owned):
    m = {'format': 1, **identity(repo), 'task': task, 'session': session, 'owner': 'Codex',
         'owned': owned, 'baseline': inventory(repo)}
    preflight(repo, m)
    return m


def safe_open(path, flags):
    try:
        fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    except OSError as exc:
        raise Refusal('unsafe_lock_metadata', path.name) from exc
    require(stat.S_ISREG(os.fstat(fd).st_mode), 'unsafe_lock_metadata')
    return fd


@contextmanager
def locked(common):
    fd = safe_open(common / 'read2lead-resume.lock', os.O_CREAT | os.O_RDWR)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Refusal('live_conflicting_owner') from exc
        yield fd
    finally:
        # close, not LOCK_UN: inherited child descriptor keeps a crashed guard's lock.
        os.close(fd)


def journal_read(common):
    path = common / 'read2lead-resume.jsonl'
    if not path.exists() and not path.is_symlink():
        return None
    fd = safe_open(path, os.O_RDONLY)
    with os.fdopen(fd) as stream:
        rows = stream.read().splitlines()
    try:
        data = [json.loads(row) for row in rows]
        require(all(isinstance(row, dict) and row.get('status') in {'active', 'finished', 'acknowledged'} for row in data), 'invalid_lock_journal')
        return data[-1] if data else None
    except (ValueError, TypeError) as exc:
        raise Refusal('invalid_lock_journal') from exc


def journal_append(common, data):
    fd = safe_open(common / 'read2lead-resume.jsonl', os.O_CREAT | os.O_WRONLY | os.O_APPEND)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(data, sort_keys=True) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def guard(repo, m, command=None, acknowledgement=None):
    preflight(repo, m)
    common = Path(m['common_dir'])
    with locked(common) as fd:
        last = journal_read(common)
        if last and last['status'] == 'active':
            require(acknowledgement and acknowledgement == last.get('token') and
                    last.get('task') == m['task'] and last.get('session') == m['session'],
                    'interrupted_owner', str(last.get('token', 'unknown')))
            journal_append(common, {**last, 'status': 'acknowledged'})
        elif acknowledgement:
            raise Refusal('unexpected_acknowledgement')
        result = preflight(repo, m)
        if command is None:
            return result, 0
        require(isinstance(command, list) and command and all(isinstance(s, str) for s in command), 'invalid_command')
        run = {'task': m['task'], 'session': m['session'], 'pid': os.getpid(), 'token': uuid.uuid4().hex}
        journal_append(common, {**run, 'status': 'active'})
        code = None
        try:
            code = subprocess.run(command, cwd=repo, pass_fds=(fd,), check=False).returncode
            post = preflight(repo, m)
            return {**post, 'command_exit': code, 'token': run['token']}, code if code >= 0 else 128 - code
        finally:
            # A normal exception is recorded; a hard process kill leaves active evidence.
            journal_append(common, {**run, 'status': 'finished', 'command_exit': code})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    cap = sub.add_parser('capture', help='Record an explicitly reconciled baseline; never grants authority.')
    cap.add_argument('--repo', required=True); cap.add_argument('--task', required=True)
    cap.add_argument('--session', required=True); cap.add_argument('--owned', nargs='+', required=True)
    cap.add_argument('--out', required=True)
    for mode in ['check', 'run']:
        cmd = sub.add_parser(mode); cmd.add_argument('--manifest', required=True)
        cmd.add_argument('--acknowledge-interruption')
        if mode == 'run':
            cmd.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.mode == 'capture':
            m = capture(Path(args.repo), args.task, args.session, args.owned)
            with open(args.out, 'x') as stream:
                json.dump(m, stream, indent=2)
            result, code = {'status': 'CAPTURED', 'files': len(m['baseline']), 'manifest': args.out}, 0
        else:
            with open(args.manifest) as stream:
                m = json.load(stream)
            command = None if args.mode == 'check' else args.command
            if command and command[0] == '--':
                command = command[1:]
            result, code = guard(Path.cwd(), m, command, args.acknowledge_interruption)
        print(json.dumps(result, sort_keys=True))
        return code
    except Refusal as exc:
        print(json.dumps({'status': 'REFUSED', 'reason': exc.reason, 'detail': exc.detail}), file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'status': 'REFUSED', 'reason': 'invalid_input_or_io', 'type': type(exc).__name__}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
