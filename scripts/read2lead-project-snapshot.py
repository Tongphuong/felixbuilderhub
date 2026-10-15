#!/usr/bin/env python3
"""Explicit private file snapshots. No discovery, archive execution or active-store switch.

Snapshot only frozen database backups, never a collection of independently copied
live SQLite files. Credentials are outside the intended selection; this tool
copies only the explicit selection and cannot infer whether arbitrary bytes are secret.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat

FORMAT = 'read2lead-project-snapshot/1'
PLAN = 'read2lead-project-snapshot-plan/1'
SELECTION = 'read2lead-project-snapshot-selection/1'
ROLES = {'application', 'configuration', 'source', 'ocr', 'master', 'rights',
         'dependencies', 'runtime', 'state_snapshot', 'delivery', 'records'}
LIMIT = 200000


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def relative(value):
    require(isinstance(value, str) and value and len(value) <= 4096 and
            not any(c in value for c in '\\\x00\n\r'), 'unsafe_relative_path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and p.as_posix() == value and
            not any(x in {'.', '..', '.git'} for x in value.split('/')), 'unsafe_relative_path')
    return value


def absolute(value):
    require(isinstance(value, str) and value and not any(c in value for c in '\x00\n\r'), 'absolute_path_required')
    p = Path(value)
    require(p.is_absolute() and str(p) == value and os.path.normpath(value) == value, 'absolute_path_required')
    require(p.parent.resolve(strict=True) == p.parent, 'symlink_parent_refused')
    return p


def private_root(value, create=False):
    p = absolute(value)
    require(not any(x in {'public', 'dist', '.git'} for x in p.parts), 'private_destination_required')
    if create:
        p.mkdir(mode=0o700)  # No exist_ok: never adopts or overwrites another directory.
    require(p.resolve(strict=True) == p and p.is_dir() and not p.is_symlink(), 'unsafe_snapshot_root')
    require(p.stat().st_uid == os.getuid() and p.stat().st_mode & 0o077 == 0, 'private_permissions_required')
    return p


def json_read(filename):
    p = absolute(str(filename))
    with p.open('rb') as stream:
        data = stream.read(128 * 1024 * 1024 + 1)
    require(len(data) <= 128 * 1024 * 1024, 'manifest_limit')
    return json.loads(data)


def metadata(value):
    require(isinstance(value, dict) and len(json.dumps(value).encode()) <= 32768, 'invalid_checkpoint')


def components(value):
    require(isinstance(value, list) and 0 < len(value) <= 100, 'invalid_components')
    names = set()
    for c in value:
        require(exact(c, ['name', 'role', 'status', 'note']) and isinstance(c['name'], str) and
                re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', c['name']) and c['name'] not in names and
                c['role'] in ROLES and c['status'] in {'included', 'unavailable', 'excluded'} and
                isinstance(c['note'], str) and 0 < len(c['note']) <= 2000, 'invalid_component')
        names.add(c['name'])
    return {c['name']: c for c in value}


def inspect_file(filename, output=None):
    p = absolute(str(filename))
    require(stat.S_ISREG(os.lstat(p).st_mode), 'regular_source_required')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), 'regular_source_required')
        sha = hashlib.sha256()
        size = 0
        with os.fdopen(fd, 'rb', closefd=False) as source:
            while data := source.read(1024 * 1024):
                sha.update(data)
                size += len(data)
                if output is not None:
                    output.write(data)
        after = os.fstat(fd)
        current = os.lstat(p)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
                (current.st_dev, current.st_ino) == (after.st_dev, after.st_ino), 'source_changed_during_read')
        return {'kind': 'file', 'bytes': size, 'sha256': sha.hexdigest(), 'executable': bool(before.st_mode & 0o111)}
    finally:
        os.close(fd)


def inspect_source(filename):
    p = absolute(filename)
    if p.is_symlink():
        target = os.readlink(p)
        require(isinstance(target, str) and target and not target.startswith('/') and
                not any(c in target for c in '\\\x00\n\r'), 'unsafe_link')
        return {'kind': 'symlink', 'target': target, 'sha256': digest(target.encode())}
    return inspect_file(p)


def validate_entries(entries, group, sources=False):
    require(isinstance(entries, list) and 0 < len(entries) <= LIMIT, 'invalid_entries')
    by_path, counts = {}, {name: 0 for name in group}
    for entry in entries:
        require(isinstance(entry, dict), 'invalid_entry')
        base = ['path', 'component'] + (['source'] if sources else [])
        keys = base + (['kind', 'bytes', 'sha256', 'executable'] if entry.get('kind') == 'file' else ['kind', 'target', 'sha256'])
        require(exact(entry, keys) and entry.get('kind') in {'file', 'symlink'}, 'invalid_entry')
        name = relative(entry['path'])
        require(name not in by_path and entry['component'] in group and group[entry['component']]['status'] == 'included', 'duplicate_or_invalid_component')
        require(isinstance(entry['sha256'], str) and re.fullmatch('[a-f0-9]{64}', entry['sha256']), 'invalid_digest')
        if entry['kind'] == 'file':
            require(type(entry['bytes']) is int and 0 <= entry['bytes'] <= 10**13 and type(entry['executable']) is bool, 'invalid_file_entry')
        else:
            target = entry['target']
            require(isinstance(target, str) and target and not target.startswith('/') and not any(c in target for c in '\\\x00\n\r') and digest(target.encode()) == entry['sha256'], 'unsafe_link')
        if sources:
            absolute(entry['source'])
        by_path[name] = entry
        counts[entry['component']] += 1
    for name, entry in by_path.items():
        require(all(str(p) not in by_path for p in PurePosixPath(name).parents if str(p) != '.'), 'file_parent_collision')
        if entry['kind'] == 'symlink':
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), entry['target']))
            require(target in by_path and by_path[target]['kind'] == 'file', 'link_target_outside_snapshot')
            if sources:
                require(Path(entry['source']).resolve(strict=True) == Path(by_path[target]['source']).resolve(strict=True), 'link_source_binding_mismatch')
    require(all((c['status'] == 'included') == (counts[name] > 0) for name, c in group.items()), 'component_coverage_mismatch')
    return by_path


def make_plan(selection):
    require(exact(selection, ['format', 'checkpoint', 'components', 'files']) and selection['format'] == SELECTION, 'invalid_selection')
    metadata(selection['checkpoint'])
    group = components(selection['components'])
    require(isinstance(selection['files'], list) and 0 < len(selection['files']) <= LIMIT, 'invalid_selection_files')
    entries = []
    for item in selection['files']:
        require(exact(item, ['source', 'path', 'component']), 'invalid_selection_file')
        relative(item['path'])
        entries.append({**item, **inspect_source(item['source'])})
    entries.sort(key=lambda e: e['path'])
    validate_entries(entries, group, sources=True)
    return {'format': PLAN, 'checkpoint': selection['checkpoint'], 'components': selection['components'], 'files': entries}


def write_new(p, data):
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def copy_checked(source, destination, expected):
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            actual = inspect_file(source, stream)
            require(actual == {k: expected[k] for k in ['kind', 'bytes', 'sha256', 'executable']}, 'source_or_backup_hash_mismatch')
            stream.flush()
            os.fchmod(fd, 0o700 if expected['executable'] else 0o600)
            os.fsync(fd)
    finally:
        os.close(fd)


def directories(root, entries):
    required = {root / 'payload'}
    for entry in entries:
        required.update((root / 'payload' / entry['path']).parents)
    required = {p for p in required if p == root / 'payload' or root / 'payload' in p.parents}
    for p in sorted(required, key=lambda p: len(p.parts)):
        p.mkdir(mode=0o700)
    return required


def seal(root, manifest, dirs):
    for p in sorted(dirs, key=lambda p: len(p.parts), reverse=True):
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    raw = (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + '\n').encode()
    write_new(root / 'manifest.json', raw)  # Commit marker written last.
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return digest(raw)


def create_snapshot(plan, destination):
    require(exact(plan, ['format', 'checkpoint', 'components', 'files']) and plan['format'] == PLAN, 'invalid_plan')
    metadata(plan['checkpoint'])
    validate_entries(plan['files'], components(plan['components']), sources=True)
    root = private_root(destination, create=True)
    dirs = directories(root, plan['files'])
    for entry in plan['files']:
        target = root / 'payload' / entry['path']
        if entry['kind'] == 'file':
            copy_checked(entry['source'], target, entry)
        else:
            require(inspect_source(entry['source']) == {k: entry[k] for k in ['kind', 'target', 'sha256']}, 'source_link_changed')
            os.symlink(entry['target'], target)
    # A change after a file's copy still refuses the whole checkpoint.
    for entry in plan['files']:
        require(inspect_source(entry['source']) == {k: v for k, v in entry.items() if k not in {'source', 'path', 'component'}}, 'source_changed_after_copy')
    manifest = {'format': FORMAT, 'created_at': datetime.now(timezone.utc).isoformat(), 'checkpoint': plan['checkpoint'], 'components': plan['components'],
                'files': [{k: v for k, v in entry.items() if k != 'source'} for entry in plan['files']]}
    sha = seal(root, manifest, dirs)
    return verify_snapshot(str(root), sha)


def verify_snapshot(directory, expected_manifest_sha256):
    require(isinstance(expected_manifest_sha256, str) and re.fullmatch('[a-f0-9]{64}', expected_manifest_sha256), 'trusted_manifest_digest_required')
    root = private_root(directory)
    require({p.name for p in root.iterdir()} == {'manifest.json', 'payload'}, 'incomplete_or_unexpected_snapshot')
    manifest_path = root / 'manifest.json'
    require(not manifest_path.is_symlink() and manifest_path.stat().st_size <= 128 * 1024 * 1024, 'unsafe_manifest')
    require(manifest_path.stat().st_uid == os.getuid() and manifest_path.stat().st_mode & 0o077 == 0, 'private_permissions_required')
    raw = manifest_path.read_bytes()
    require(digest(raw) == expected_manifest_sha256, 'manifest_hash_mismatch')
    manifest = json.loads(raw)
    require(exact(manifest, ['format', 'created_at', 'checkpoint', 'components', 'files']) and manifest['format'] == FORMAT and isinstance(manifest['created_at'], str), 'invalid_manifest')
    metadata(manifest['checkpoint'])
    entries = validate_entries(manifest['files'], components(manifest['components']))
    payload = root / 'payload'
    require(payload.is_dir() and not payload.is_symlink(), 'unsafe_payload')
    require(payload.stat().st_uid == os.getuid() and payload.stat().st_mode & 0o077 == 0, 'private_permissions_required')
    expected_dirs = {str(p) for name in entries for p in PurePosixPath(name).parents if str(p) != '.'}
    found, found_dirs = set(), set()
    for current, dirs, files in os.walk(payload, followlinks=False):
        for name in list(dirs):
            p = Path(current) / name
            if p.is_symlink():
                dirs.remove(name)
                files.append(name)
            else:
                require(p.stat().st_uid == os.getuid() and p.stat().st_mode & 0o077 == 0, 'private_permissions_required')
                found_dirs.add(p.relative_to(payload).as_posix())
        for name in files:
            p = Path(current) / name
            rel = p.relative_to(payload).as_posix()
            require(rel in entries, 'unexpected_snapshot_file')
            entry = entries[rel]
            if entry['kind'] == 'file':
                st = p.lstat()
                require(st.st_uid == os.getuid() and st.st_nlink == 1 and st.st_mode & 0o077 == 0, 'private_permissions_required')
            require(inspect_source(str(p)) == {k: v for k, v in entry.items() if k not in {'path', 'component'}}, 'backup_hash_mismatch')
            found.add(rel)
    require(found == set(entries) and found_dirs == expected_dirs, 'snapshot_inventory_mismatch')
    require(digest(manifest_path.read_bytes()) == expected_manifest_sha256, 'manifest_changed_during_verify')
    return {'status': 'pass', 'verified': True, 'directory': str(root), 'manifest_sha256': expected_manifest_sha256, 'files': len(entries),
            'bytes': sum(e.get('bytes', 0) for e in entries.values()), 'components': manifest['components'], 'active_store_switched': False}


def restore_snapshot(source, destination, expected_manifest_sha256):
    verified = verify_snapshot(source, expected_manifest_sha256)
    origin = Path(verified['directory'])
    manifest = json_read(origin / 'manifest.json')
    root = private_root(destination, create=True)
    dirs = directories(root, manifest['files'])
    for entry in manifest['files']:
        target = root / 'payload' / entry['path']
        if entry['kind'] == 'file':
            copy_checked(origin / 'payload' / entry['path'], target, entry)
        else:
            require(os.readlink(origin / 'payload' / entry['path']) == entry['target'], 'backup_link_changed')
            os.symlink(entry['target'], target)
    sha = seal(root, manifest, dirs)
    require(sha == expected_manifest_sha256, 'restored_manifest_mismatch')
    return verify_snapshot(str(root), sha)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('plan'); p.add_argument('--selection', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('create'); p.add_argument('--plan', required=True); p.add_argument('--destination', required=True)
    for action in ['verify', 'restore']:
        p = sub.add_parser(action); p.add_argument('--source', required=True); p.add_argument('--manifest-sha256', required=True)
        if action == 'restore': p.add_argument('--destination', required=True)
    args = parser.parse_args()
    try:
        if args.action == 'plan':
            plan = make_plan(json_read(args.selection)); target = absolute(args.out)
            require(not any(x in {'public', 'dist', '.git'} for x in target.parts), 'private_destination_required')
            write_new(target, (json.dumps(plan, indent=2, ensure_ascii=False) + '\n').encode())
            result = {'status': 'planned', 'files': len(plan['files']), 'plan': str(target), 'source_writes': 0}
        elif args.action == 'create': result = create_snapshot(json_read(args.plan), args.destination)
        elif args.action == 'verify': result = verify_snapshot(args.source, args.manifest_sha256)
        else: result = restore_snapshot(args.source, args.destination, args.manifest_sha256)
        print(json.dumps(result))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'refused', 'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
