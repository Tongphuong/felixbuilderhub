"""Real local fixtures; never touches a product checkout or invokes its hooks."""
from pathlib import Path
import copy
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts/read2lead-resume-guard.py'
spec = importlib.util.spec_from_file_location('resume_guard', SCRIPT)
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)


class ResumeCases(unittest.TestCase):
    def setUp(self):
        # Evidence retained; no destructive fixture cleanup.
        root = Path.cwd() / '.r2l-resume-proofs'; root.mkdir(exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix='synthetic-', dir=root))
        self.repo = self.root / 'repo'; self.repo.mkdir()
        self.env = {**os.environ, 'HOME': str(self.root), 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
        self.git('init', '-b', 'codex/synthetic')
        (self.repo / 'known.txt').write_text('preserve me\n')
        (self.repo / 'owned.txt').write_text('initial\n')
        (self.repo / '[id].js').write_text('// literal dynamic route\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@invalid', 'commit', '-m', 'synthetic baseline')
        self.head = self.git('rev-parse', 'HEAD').strip()
        p = self.repo / g.CONTROL; p.parent.mkdir(parents=True)
        p.write_text(f'''# Synthetic control
- Active workers: 0

## Current task
- Task ID: R2L-SYNTHETIC
- Session ID: synthetic-owner
- Owner: Codex
- Status: active
- Branch: codex/synthetic
- Worktree: {self.repo}
- Starting commit: {self.head}
- Files owned: owned.txt; new.txt; alias/future.txt
''')
        self.m = g.capture(self.repo, 'R2L-SYNTHETIC', 'synthetic-owner', ['owned.txt', 'new.txt'])
        self.manifest = self.root / 'manifest.json'; self.save()

    def git(self, *args):
        return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', str(self.repo), *args], env=self.env, stderr=subprocess.DEVNULL, text=True)

    def save(self):
        self.manifest.write_text(json.dumps(self.m))

    def cli(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd or self.repo, capture_output=True, text=True, env=self.env)

    def refused(self, reason, m=None):
        with self.assertRaises(g.Refusal) as caught:
            g.guard(self.repo, m or self.m, [sys.executable, '-c', 'from pathlib import Path; Path("owned.txt").write_text("BAD")'])
        self.assertEqual(caught.exception.reason, reason)
        self.assertEqual((self.repo / 'owned.txt').read_text(), 'initial\n')

    def test_positive_read_and_owned_write(self):
        r = self.cli('check', '--manifest', str(self.manifest)); self.assertEqual(r.returncode, 0, r.stderr)
        r = self.cli('run', '--manifest', str(self.manifest), '--', sys.executable, '-c', 'from pathlib import Path; Path("owned.txt").write_text("new"); Path("new.txt").write_text("new")')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.repo / 'known.txt').read_text(), 'preserve me\n')
        self.assertEqual(g.journal_read(Path(self.m['common_dir']))['status'], 'finished')

    def test_wrong_sha(self):
        self.m['head'] = '0' * 40; self.refused('wrong_sha')

    def test_wrong_branch(self):
        self.m['branch'] = 'main'; self.refused('wrong_branch')

    def test_wrong_worktree_before_command(self):
        r = self.cli('run', '--manifest', str(self.manifest), '--', sys.executable, '-c', 'raise RuntimeError("executed")', cwd=self.root)
        self.assertEqual(r.returncode, 2); self.assertIn('wrong_worktree', r.stderr); self.assertNotIn('executed', r.stderr)

    def test_subdirectory_is_wrong_worktree(self):
        r = self.cli('check', '--manifest', str(self.manifest), cwd=self.repo / '.founder-os')
        self.assertIn('wrong_worktree', r.stderr)

    def test_changed_common_dir(self):
        self.m['common_dir'] = str(self.root); self.refused('wrong_git_common_dir')

    def test_foreign_dirty_file(self):
        (self.repo / 'known.txt').write_text('foreign edit'); self.refused('foreign_change')

    def test_foreign_new_file(self):
        (self.repo / 'foreign.txt').write_text('unrelated'); self.refused('foreign_change')

    def test_foreign_deleted_file(self):
        (self.repo / 'known.txt').rename(self.root / 'retained-known.txt'); self.refused('foreign_change')

    def test_foreign_mode_change(self):
        (self.repo / 'known.txt').chmod(0o755); self.refused('foreign_change')

    def test_index_changed_even_owned(self):
        (self.repo / 'new.txt').write_text('stage'); self.git('add', 'new.txt'); self.refused('index_changed')

    def test_owner_changed(self):
        p = self.repo / g.CONTROL; p.write_text(p.read_text().replace('Owner: Codex', 'Owner: somebody-else')); self.refused('task_mismatch')

    def test_session_changed(self):
        p = self.repo / g.CONTROL; p.write_text(p.read_text().replace('synthetic-owner', 'foreign-owner')); self.refused('task_mismatch')

    def test_duplicate_current_task(self):
        p = self.repo / g.CONTROL; p.write_text(p.read_text() + '\n## Current task\n- Task ID: R2L-FOREIGN\n'); self.refused('ambiguous_current_task')

    def test_explicit_historical_boundary_preserves_old_control(self):
        p = self.repo / g.CONTROL
        p.write_text(p.read_text() + '\n## Historical control record — preserved verbatim below\n\n# Old control\n- Active workers: 2\n## Current task\n- Owner: historical\n')
        m = g.capture(self.repo, self.m['task'], self.m['session'], self.m['owned'])
        self.assertEqual(g.guard(self.repo, m)[0]['status'], 'PASS')

    def test_conflicting_worker(self):
        p = self.repo / g.CONTROL; p.write_text(p.read_text().replace('Active workers: 0', 'Active workers: 1')); self.refused('conflicting_workers')

    def test_owned_path_traversal_and_glob(self):
        for path in ['../known.txt', 'src/*', '/tmp/file', '.git/config', 'src//file']:
            with self.subTest(path=path):
                m = copy.deepcopy(self.m); m['owned'] = [path]; self.refused('invalid_scope', m)

    def test_manifest_cannot_expand_recorded_scope(self):
        self.m['owned'].append('known.txt'); self.refused('scope_not_recorded')

    def test_owned_symlink(self):
        (self.repo / 'new.txt').symlink_to(self.repo / 'known.txt'); self.refused('scope_symlink')

    def test_parent_symlink(self):
        (self.repo / 'alias').symlink_to(self.root, target_is_directory=True)
        self.m['owned'].append('alias/future.txt'); self.refused('scope_symlink')

    def test_foreign_change_during_command_detected_without_undo(self):
        with self.assertRaises(g.Refusal) as caught:
            g.guard(self.repo, self.m, [sys.executable, '-c', 'from pathlib import Path; Path("known.txt").write_text("unexpected edit")'])
        self.assertEqual(caught.exception.reason, 'foreign_change')
        self.assertEqual((self.repo / 'known.txt').read_text(), 'unexpected edit')

    def test_child_failure_propagates(self):
        r = self.cli('run', '--manifest', str(self.manifest), '--', sys.executable, '-c', 'raise SystemExit(7)')
        self.assertEqual(r.returncode, 7); self.assertEqual(json.loads(r.stdout)['command_exit'], 7)

    def test_live_owner_and_hard_crash_require_ack(self):
        ready, release = self.root / 'ready', self.root / 'release'
        child = f'import pathlib,time; pathlib.Path({str(ready)!r}).write_text("ready");\nwhile not pathlib.Path({str(release)!r}).exists(): time.sleep(0.01)'
        proc = subprocess.Popen([sys.executable, str(SCRIPT), 'run', '--manifest', str(self.manifest), '--', sys.executable, '-c', child], cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline: time.sleep(0.01)
            self.assertTrue(ready.exists())
            self.refused('live_conflicting_owner')
            lease = g.journal_read(Path(self.m['common_dir']))
            os.kill(proc.pid, signal.SIGKILL); proc.wait(timeout=3)
            # Child inherited the descriptor: killing only the wrapper cannot steal its lock.
            self.refused('live_conflicting_owner')
            release.write_text('release')
            proc.communicate(timeout=5)
            self.refused('interrupted_owner')
            r = self.cli('check', '--manifest', str(self.manifest), '--acknowledge-interruption', 'wrong')
            self.assertIn('interrupted_owner', r.stderr)
            r = self.cli('check', '--manifest', str(self.manifest), '--acknowledge-interruption', lease['token'])
            self.assertEqual(r.returncode, 0, r.stderr)
            rows = (Path(self.m['common_dir']) / 'read2lead-resume.jsonl').read_text().splitlines()
            self.assertEqual([json.loads(x)['status'] for x in rows], ['active', 'acknowledged'])
        finally:
            release.write_text('release')
            if proc.poll() is None: proc.kill()
            proc.communicate(timeout=5)

    def test_old_active_record_never_expires(self):
        g.journal_append(Path(self.m['common_dir']), {'status': 'active', 'token': 'old', 'task': self.m['task'], 'session': 'other', 'timestamp': 0})
        self.refused('interrupted_owner')

    def test_corrupt_journal_refuses(self):
        (Path(self.m['common_dir']) / 'read2lead-resume.jsonl').write_text('{truncated')
        self.refused('invalid_lock_journal')

    def test_lock_symlink_refuses_without_target_write(self):
        sentinel = self.root / 'sentinel'; sentinel.write_text('preserve')
        (Path(self.m['common_dir']) / 'read2lead-resume.lock').symlink_to(sentinel)
        self.refused('unsafe_lock_metadata'); self.assertEqual(sentinel.read_text(), 'preserve')

    def test_capture_never_overwrites_manifest(self):
        r = self.cli('capture', '--repo', str(self.repo), '--task', self.m['task'], '--session', self.m['session'], '--owned', 'owned.txt', '--out', str(self.manifest))
        self.assertEqual(r.returncode, 2); self.assertEqual(json.loads(self.manifest.read_text()), self.m)


if __name__ == '__main__':
    unittest.main()
