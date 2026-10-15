import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOL = Path(__file__).resolve().parents[1] / 'scripts/read2lead-project-snapshot.py'
spec = importlib.util.spec_from_file_location('snapshot', TOOL)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class ProjectSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r2l-project-snapshot-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'original'
        self.source.mkdir()
        self.files = {
            'app/main.py': (b'print("synthetic recovery only")\n', 'app'),
            'app/package.json': (b'{"name":"synthetic"}', 'config'),
            'sources/book.zip': (b'Unexecuted synthetic source archive bytes', 'sources'),
            'masters/scene.bin': (bytes(range(256)) * 8193, 'masters'),
            'ocr/page.json': (b'{"text":"unverified synthetic OCR"}', 'ocr'),
        }
        for name, (data, _) in self.files.items():
            p = self.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        (self.source / 'app/main.py').chmod(0o755)
        self.selection = {'format': snapshot.SELECTION, 'checkpoint': {'synthetic_only': True, 'head': 'fixture'},
                          'components': [{'name': name, 'role': role, 'status': 'included', 'note': 'Synthetic recovery check'} for name, role in [('app', 'application'), ('config', 'configuration'), ('sources', 'source'), ('masters', 'master'), ('ocr', 'ocr')]] +
                          [{'name': 'rights', 'role': 'rights', 'status': 'unavailable', 'note': 'No genuine permission grant available'}],
                          'files': [{'source': str(self.source / n), 'path': n, 'component': c} for n, (_, c) in self.files.items()]}

    def plan(self):
        return snapshot.make_plan(self.selection)

    def create(self):
        result = snapshot.create_snapshot(self.plan(), str(self.root / 'backup'))
        return self.root / 'backup', result['manifest_sha256']

    def test_complete_roundtrip_preserves_bytes_modes_components_and_originals(self):
        before = {n: (self.source / n).read_bytes() for n in self.files}
        backup, sha = self.create()
        result = snapshot.restore_snapshot(str(backup), str(self.root / 'restored'), sha)
        self.assertFalse(result['active_store_switched'])
        self.assertEqual(result['files'], 5)
        self.assertEqual(result['components'][-1]['status'], 'unavailable')
        for n, data in before.items():
            target = self.root / 'restored/payload' / n
            self.assertEqual(target.read_bytes(), data)
            self.assertEqual((self.source / n).read_bytes(), data)
            self.assertEqual(target.stat().st_mode & 0o777, 0o700 if n.endswith('main.py') else 0o600)
        self.assertNotIn(str(self.source), (backup / 'manifest.json').read_text())

    def test_internal_command_link_is_preserved_and_external_link_is_refused(self):
        p = self.source / 'app/bin/launch'
        p.parent.mkdir()
        p.symlink_to('../main.py')
        self.selection['files'].append({'source': str(p), 'path': 'app/bin/launch', 'component': 'app'})
        backup, sha = self.create()
        snapshot.restore_snapshot(str(backup), str(self.root / 'restored'), sha)
        restored = self.root / 'restored/payload/app/bin/launch'
        self.assertEqual(os.readlink(restored), '../main.py')
        self.assertEqual(restored.read_bytes(), self.files['app/main.py'][0])
        p.unlink(); p.symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'unsafe_link'):
            self.plan()

    def test_source_change_refuses_creation_and_leaves_no_completed_manifest(self):
        plan = self.plan()
        (self.source / 'app/main.py').write_text('changed after planning')
        with self.assertRaisesRegex(ValueError, 'source_or_backup_hash_mismatch'):
            snapshot.create_snapshot(plan, str(self.root / 'partial'))
        self.assertTrue((self.root / 'partial').exists())
        self.assertFalse((self.root / 'partial/manifest.json').exists())
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            snapshot.verify_snapshot(str(self.root / 'partial'), 'a' * 64)

    def test_change_after_copy_is_detected_before_sealing(self):
        plan = self.plan()
        original = snapshot.copy_checked
        def change_after(source, destination, expected):
            original(source, destination, expected)
            if expected['path'] == 'app/main.py':
                Path(source).write_text('mutated after its copy')
        with patch.object(snapshot, 'copy_checked', change_after):
            with self.assertRaisesRegex(ValueError, 'source_changed_after_copy'):
                snapshot.create_snapshot(plan, str(self.root / 'partial'))
        self.assertFalse((self.root / 'partial/manifest.json').exists())

    def test_corrupt_payload_and_missing_file_are_refused(self):
        backup, sha = self.create()
        p = backup / 'payload/app/package.json'
        data = p.read_bytes()
        p.write_bytes(b'X' * len(data))
        with self.assertRaisesRegex(ValueError, 'backup_hash_mismatch'):
            snapshot.verify_snapshot(str(backup), sha)
        with self.assertRaises(ValueError):
            snapshot.restore_snapshot(str(backup), str(self.root / 'refused'), sha)
        self.assertFalse((self.root / 'refused').exists())
        p.write_bytes(data); p.unlink()
        with self.assertRaisesRegex(ValueError, 'snapshot_inventory_mismatch'):
            snapshot.verify_snapshot(str(backup), sha)

    def test_manifest_digest_and_complete_inventory_are_required(self):
        backup, sha = self.create()
        with self.assertRaisesRegex(ValueError, 'trusted_manifest_digest_required'):
            snapshot.verify_snapshot(str(backup), '')
        with self.assertRaisesRegex(ValueError, 'manifest_hash_mismatch'):
            snapshot.verify_snapshot(str(backup), '0' * 64)
        extra = backup / 'payload/unlisted-secret.txt'; extra.write_text('synthetic unlisted data')
        with self.assertRaisesRegex(ValueError, 'unexpected_snapshot_file'):
            snapshot.verify_snapshot(str(backup), sha)
        extra.unlink(); (backup / 'payload/extra-directory').mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'snapshot_inventory_mismatch'):
            snapshot.verify_snapshot(str(backup), sha)

    def test_traversal_duplicates_parent_collisions_and_missing_component_are_refused(self):
        original = copy.deepcopy(self.selection)
        for name in ['../outside', '/absolute', 'app/../outside', 'app\\outside', '.git/config']:
            self.selection = copy.deepcopy(original); self.selection['files'][0]['path'] = name
            with self.assertRaises(ValueError): self.plan()
        self.selection = copy.deepcopy(original); self.selection['files'].append(self.selection['files'][0])
        with self.assertRaisesRegex(ValueError, 'duplicate'): self.plan()
        self.selection = copy.deepcopy(original); self.selection['files'][0]['path'] = 'app'
        with self.assertRaisesRegex(ValueError, 'file_parent_collision'): self.plan()
        self.selection = copy.deepcopy(original); self.selection['components'][-1]['status'] = 'included'
        with self.assertRaisesRegex(ValueError, 'component_coverage_mismatch'): self.plan()

    def test_restore_never_overwrites_or_follows_a_destination_parent_link(self):
        backup, sha = self.create()
        target = self.root / 'existing'; target.mkdir(); (target / 'keep').write_text('keep me')
        with self.assertRaises(FileExistsError): snapshot.restore_snapshot(str(backup), str(target), sha)
        self.assertEqual((target / 'keep').read_text(), 'keep me')
        link = self.root / 'linked'; link.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink_parent_refused'):
            snapshot.restore_snapshot(str(backup), str(link / 'escape'), sha)
        self.assertFalse((target / 'escape').exists())

    def test_frozen_sqlite_backup_reopens_with_identical_rows(self):
        p = self.source / 'state.sqlite'
        with sqlite3.connect(p) as db:
            db.execute('CREATE TABLE receipts(id TEXT PRIMARY KEY, diamonds INTEGER)')
            db.execute("INSERT INTO receipts VALUES('synthetic-receipt',30)")
        self.selection['components'].append({'name': 'state', 'role': 'state_snapshot', 'status': 'included', 'note': 'Closed synthetic SQLite snapshot'})
        self.selection['files'].append({'source': str(p), 'path': 'state/learner.sqlite', 'component': 'state'})
        backup, sha = self.create(); snapshot.restore_snapshot(str(backup), str(self.root / 'restored'), sha)
        with sqlite3.connect('file:' + str(self.root / 'restored/payload/state/learner.sqlite') + '?mode=ro', uri=True) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(), ('ok',))
            self.assertEqual(db.execute('SELECT * FROM receipts').fetchall(), [('synthetic-receipt', 30)])

    def test_loosened_snapshot_permissions_are_refused(self):
        backup, sha = self.create()
        p = backup / 'payload/app/package.json'; p.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private_permissions_required'):
            snapshot.verify_snapshot(str(backup), sha)
        p.chmod(0o600); backup.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'private_permissions_required'):
            snapshot.verify_snapshot(str(backup), sha)

    def test_nonregular_source_is_refused_without_opening_a_pipe(self):
        p = self.source / 'fifo'; os.mkfifo(p)
        self.selection['files'][0]['source'] = str(p)
        with self.assertRaisesRegex(ValueError, 'regular_source_required'):
            self.plan()

    def test_real_cli_plan_create_verify_restore_and_wrong_hash(self):
        selection = self.root / 'selection.json'; selection.write_text(json.dumps(self.selection))
        plan = self.root / 'plan.json'
        def run(*args):
            result = subprocess.run([sys.executable, '-B', str(TOOL), *args], capture_output=True, text=True, timeout=20)
            return result.returncode, json.loads(result.stdout)
        self.assertEqual(run('plan', '--selection', str(selection), '--out', str(plan))[0], 0)
        code, report = run('create', '--plan', str(plan), '--destination', str(self.root / 'backup'))
        self.assertEqual(code, 0); sha = report['manifest_sha256']
        self.assertEqual(run('verify', '--source', str(self.root / 'backup'), '--manifest-sha256', sha)[0], 0)
        self.assertEqual(run('restore', '--source', str(self.root / 'backup'), '--manifest-sha256', sha, '--destination', str(self.root / 'restored'))[0], 0)
        self.assertEqual(run('verify', '--source', str(self.root / 'backup'), '--manifest-sha256', '0' * 64)[0], 1)


if __name__ == '__main__':
    unittest.main()
