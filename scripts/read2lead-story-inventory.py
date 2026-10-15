#!/usr/bin/env python3
"""Private, offline ZIP intake. File inventory is not a verified story catalogue.

Never executes members or publishes assets. Originals stay unchanged. Resume by
rerunning identical inputs; content-addressed objects are checked before reuse.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import zipfile

MAX_MEMBER = 512 * 1024 * 1024
MAX_TOTAL = 12 * 1024 * 1024 * 1024
MAX_ENTRIES = 10000


def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def require(ok, code):
    if not ok:
        raise ValueError(code)


def safe_member(info):
    name = info.filename
    require(name and '\\' not in name and '\x00' not in name and not re.match(r'^[A-Za-z]:', name), 'unsafe_member_path')
    require(not PurePosixPath(name).is_absolute() and all(p not in ('', '.', '..') for p in name.rstrip('/').split('/')), 'unsafe_member_path')
    mode = info.external_attr >> 16
    require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), 'unsafe_member_type')
    require(not info.flag_bits & 1, 'encrypted_member')
    require(0 <= info.file_size <= MAX_MEMBER, 'member_size_limit')
    require(info.file_size <= max(1, info.compress_size) * 1000, 'compression_ratio_limit')


def private_root(path):
    p = Path(path).absolute()
    require(p == p.resolve(), 'unsafe_output_path')
    # Do not put private intake in a static site/public tree.
    require(not {'public', 'dist', '.git'}.intersection(p.parts), 'public_output_refused')
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(p.is_dir() and not p.is_symlink(), 'unsafe_output_path')
    marker = p / '.r2l-private-intake'
    if marker.exists():
        require(not marker.is_symlink() and marker.read_text() == 'private-source-intake-v1\n', 'invalid_intake_root')
    else:
        require(not any(p.iterdir()), 'nonempty_unmarked_output')
        marker.write_text('private-source-intake-v1\n'); marker.chmod(0o600)
    return p


def atomic_json(path, data):
    require(not path.is_symlink(), 'unsafe_output_path')
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.report-')
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(data, out, indent=2, ensure_ascii=False); out.write('\n'); out.flush(); os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def classify(name):
    suffix = PurePosixPath(name).suffix.lower()
    return 'pdf' if suffix == '.pdf' else 'audio' if name.lower().endswith('.mp3') else 'ignored'


def locator(name):
    """Filename hints only, never text/edition/recording verification."""
    result = {}
    match = re.search(r'(?:PDF|Audio) Level ([123])', name, re.I)
    if match: result['collection_level_hint'] = int(match[1])
    if '/PDF Level ' in name:
        match = re.search(r'Book\s*(\d+)\.pdf$', name, re.I)
        if match: result['month_hint'] = int(match[1])
    match = re.search(r'/[bB](\d+)[sS](\d+)', name)
    if match:
        result.update(month_hint=int(match[1]), story_number_hint=int(match[2]))
    match = re.search(r'/A(\d{2})(\d{2})\s+(.+)\.mp3$', name, re.I)
    if match:
        result.update(collection_level_hint=1, month_hint=int(match[1]), story_number_hint=int(match[2]), title_hint=match[3])
    if 'Audio Level 2' in name:
        match = re.search(r'/([0-9]+)/[^/]*[tT]rack\s*([0-9]+)', name)
        if match: result.update(month_hint=int(match[1]), story_number_hint=int(match[2]))
    return result


def inventory(archives, output, extract=False):
    paths = [Path(p).absolute() for p in archives]
    require(paths and len(paths) == len(set(paths)), 'duplicate_archive_argument')
    # Validate all metadata before writing any member; unsafe sidecars also refuse intake.
    total = entries = 0
    for path in paths:
        require(path.is_file() and not path.is_symlink(), 'invalid_archive')
        with zipfile.ZipFile(path) as z:
            names = set()
            for info in z.infolist():
                safe_member(info)
                require(info.filename not in names, 'duplicate_member_name'); names.add(info.filename)
                entries += 1; total += info.file_size
                require(entries <= MAX_ENTRIES and total <= MAX_TOTAL, 'archive_size_limit')
    root = private_root(output)
    objects = root / 'objects'
    require(not objects.is_symlink(), 'unsafe_output_path')
    if extract: objects.mkdir(exist_ok=True, mode=0o700)
    report = {'format': 'r2l-private-source-inventory/1', 'private': True, 'story_counts_verified': False,
              'complete_lessons': 0, 'archives': [], 'members': [], 'physical_duplicates': [], 'errors': []}
    for path in paths:
        archive_hash = sha_file(path)
        archive = {'path': str(path), 'sha256': archive_hash, 'crc_status': 'pending'}
        report['archives'].append(archive)
        try:
            with zipfile.ZipFile(path) as z:
                for info in z.infolist():
                    if info.is_dir(): continue
                    kind = classify(info.filename); temp = None; out = None; h = hashlib.sha256(); size = 0
                    try:
                        if extract and kind != 'ignored':
                            fd, temp = tempfile.mkstemp(dir=objects, prefix='.partial-'); out = os.fdopen(fd, 'wb')
                        with z.open(info) as stream:
                            for block in iter(lambda: stream.read(1024 * 1024), b''):
                                size += len(block); require(size <= MAX_MEMBER, 'member_size_limit'); h.update(block)
                                if out: out.write(block)
                        require(size == info.file_size, 'member_size_mismatch')
                        digest = h.hexdigest(); object_path = None
                        if out:
                            out.flush(); os.fsync(out.fileno()); out.close(); out = None
                            target = objects / (digest + ('.pdf' if kind == 'pdf' else '.mp3'))
                            require(not target.is_symlink(), 'unsafe_output_path')
                            if target.exists(): require(sha_file(target) == digest, 'existing_object_hash_mismatch')
                            else:
                                # Atomic no-overwrite publish of a fully checked private object.
                                try: os.link(temp, target)
                                except FileExistsError: require(not target.is_symlink() and sha_file(target) == digest, 'existing_object_hash_mismatch')
                            object_path = str(target.relative_to(root))
                        report['members'].append({'archive_sha256': archive_hash, 'member': info.filename, 'sha256': digest,
                            'bytes': size, 'crc32': f'{info.CRC:08x}', 'kind': kind, 'private_object': object_path,
                            'hints': locator(info.filename), 'verification': 'bytes_and_crc_only'})
                    finally:
                        if out: out.close()
                        if temp and os.path.exists(temp): os.unlink(temp)
            require(sha_file(path) == archive_hash, 'archive_changed_during_read')
            archive['crc_status'] = 'pass'
        except (ValueError, OSError, zipfile.BadZipFile, RuntimeError) as exc:
            archive['crc_status'] = 'failed'; report['errors'].append({'archive': path.name, 'error': str(exc)})
        atomic_json(root / 'inventory.json', report)
    groups = {}
    for row in report['members']: groups.setdefault(row['sha256'], []).append({'archive_sha256': row['archive_sha256'], 'member': row['member']})
    report['physical_duplicates'] = [{'sha256': key, 'copies': value} for key, value in groups.items() if len(value) > 1]
    report['counts'] = {k: {'files': sum(r['kind'] == k for r in report['members']), 'distinct_hashes': len({r['sha256'] for r in report['members'] if r['kind'] == k})} for k in ['pdf', 'audio', 'ignored']}
    report['status'] = 'failed' if report['errors'] else 'pass'
    atomic_json(root / 'inventory.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', action='append', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--extract', action='store_true', help='Extract PDF/MP3 only into private hash-addressed objects; default validates without extraction.')
    args = parser.parse_args()
    try:
        report = inventory(args.archive, args.output, args.extract)
        print(json.dumps({k: report[k] for k in ['status', 'counts', 'complete_lessons', 'story_counts_verified', 'errors']}))
        return 1 if report['errors'] else 0
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({'status': 'refused', 'error': str(exc)})); return 2

if __name__ == '__main__': raise SystemExit(main())
