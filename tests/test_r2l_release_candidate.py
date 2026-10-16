"""Tests for scripts/r2l-release/build_candidate.py.

Run:  python3 -m unittest tests/test_r2l_release_candidate.py -v
(`npm test` only runs tests/*.test.mjs; Python tests are run separately, like the
other tests/test_*.py files in this repo.)

Uses a TINY synthetic base candidate in a temp dir. Never touches the real 6 GB one.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent / "scripts/r2l-release/build_candidate.py"
UNSAFE = "R2L_RELEASE_UNSAFE_WRITE_THROUGH_FOR_BITE_TEST"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def tree_hashes(root):
    return {p.relative_to(root).as_posix(): sha(p) for p in Path(root).rglob("*") if p.is_file()}


def tree_inodes(root):
    return {p.relative_to(root).as_posix(): (os.stat(p).st_ino, os.stat(p).st_mtime_ns) for p in Path(root).rglob("*") if p.is_file()}


PAGE_OLD = '<html><head><script src="/_astro/app.OLD.js"></script><script>window.a=1</script></head><body>old</body></html>'
PAGE_NEW = '<html><head><script src="/_astro/app.NEW.js"></script><script>window.a=2</script></head><body>new</body></html>'


class Fixture:
    """base candidate + repo (git, with dist/) + build-env + base wrangler config, all in a temp dir."""

    def __init__(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="r2l-rel-test-"))
        t = self.tmp
        self.base = t / "base"
        self.repo = t / "repo"
        self.out = t / "out"
        # --- base candidate
        w = lambda p, s: (p.parent.mkdir(parents=True, exist_ok=True), p.write_text(s) if isinstance(s, str) else p.write_bytes(s))
        a = self.base / "assets"
        w(a / "read2lead/index.html", PAGE_OLD)
        w(a / "_astro/app.OLD.js", "console.log('old')")
        w(a / "__private/media/pic.bin", b"\x00\x01ILLUSTRATION\x02")
        w(a / "__private/book-parts/p1.json", '{"part":1}')
        manifest = {
            "format": "synthetic-v1", "pages": {"/read2lead": "/read2lead/index.html"},
            "publicAssets": ["/_astro/app.OLD.js"], "scriptHashes": [],
            "packages": [{"id": "story-1"}], "existingTestAccount": {"x": 1},
        }
        w(a / "__private/package.json", json.dumps(manifest, separators=(",", ":")))
        s = self.base / "source"
        w(s / "cloudflare/read2lead-private-preview/worker.mjs", "import {h} from './helper.mjs';export default {h};")
        w(s / "cloudflare/read2lead-private-preview/helper.mjs", "export const h=1;")
        w(s / "functions/lib/x.mjs", "export const x=1;")
        for d in ("schemas", "scripts", "src"):
            w(s / d / "keep.txt", d)
        self.base_config = t / "base-wrangler.json"
        self.base_config.write_text(json.dumps({
            "name": "read2lead-story-private-preview", "main": "/old/worker.mjs",
            "assets": {"directory": "/old/assets", "binding": "ASSETS"},
            "vars": {"R2L_PREVIEW_PACKAGE_SHA256": "old", "KEEP": "me"},
        }))
        # --- repo (a git repo with the 5 source dirs and a fresh dist/)
        r = self.repo
        w(r / "cloudflare/read2lead-private-preview/worker.mjs", "import {h} from './helper.mjs';export default {h,v:2};")
        w(r / "cloudflare/read2lead-private-preview/helper.mjs", "export const h=2;")
        w(r / "functions/lib/x.mjs", "export const x=1;")
        for d in ("schemas", "scripts", "src"):
            w(r / d / "keep.txt", d)
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
        w(r / "dist/read2lead/index.html", PAGE_NEW)
        w(r / "dist/_astro/app.NEW.js", "console.log('new')")
        w(r / "dist/_astro/flags.abc.js", 'function e(){return typeof window<"u"?new URLSearchParams(window.location.search).get("v3")==="1":!1}export{e as i};')
        self.build_env = t / "build-env.json"
        self.build_env.write_text("{}")
        # dist must be newer than the commit
        future = Path(r / "dist")
        os.utime(future, (future.stat().st_atime, future.stat().st_mtime + 5))

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def run(self, extra_env=None, **over):
        args = {"base": self.base, "base-config": self.base_config, "repo": self.repo, "out": self.out, "build-env": self.build_env}
        args.update({k.replace("_", "-"): v for k, v in over.items()})
        cmd = [sys.executable, str(TOOL)] + [x for k, v in args.items() for x in (f"--{k}", str(v))]
        env = dict(os.environ, **(extra_env or {}))
        return subprocess.run(cmd, capture_output=True, text=True, env=env)

    def cleanup(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class ReleaseCandidateTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.cleanup)

    def test_good_case(self):
        before = tree_hashes(self.f.base)
        before_ino = tree_inodes(self.f.base)
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("NOT UPLOADED. NOT DEPLOYED", r.stdout)
        self.assertIn("versions upload --config", r.stdout)
        out = self.f.out
        # base is byte- and inode-identical afterwards
        self.assertEqual(tree_hashes(self.f.base), before)
        self.assertEqual(tree_inodes(self.f.base), before_ino)
        # new page + chunk landed, allow-listed, hash added
        self.assertEqual((out / "assets/read2lead/index.html").read_text(), PAGE_NEW)
        m = json.loads((out / "assets/__private/package.json").read_text())
        self.assertIn("/_astro/app.NEW.js", m["publicAssets"])
        self.assertIn("/_astro/app.OLD.js", m["publicAssets"])  # old chunks kept for old cached pages
        self.assertEqual(len(m["scriptHashes"]), 1)
        self.assertEqual(m["packages"], [{"id": "story-1"}])
        # protected content is the SAME FILES (hard links), not copies
        self.assertTrue(os.path.samefile(out / "assets/__private/media/pic.bin", self.f.base / "assets/__private/media/pic.bin"))
        # server source replaced from repo
        self.assertIn("v:2", (out / "source/cloudflare/read2lead-private-preview/worker.mjs").read_text())
        # config
        cfg = json.loads((out / "wrangler.release.json").read_text())
        self.assertEqual(cfg["main"], str(out / "source/cloudflare/read2lead-private-preview/worker.mjs"))
        self.assertEqual(cfg["assets"]["directory"], str(out / "assets"))
        self.assertEqual(cfg["vars"]["R2L_PREVIEW_PACKAGE_SHA256"], sha(out / "assets/__private/package.json"))
        self.assertEqual(cfg["vars"]["KEEP"], "me")
        proof = json.loads((out / "candidate-proof.json").read_text())
        self.assertEqual(proof["status"], "PASS")
        self.assertEqual(proof["protectedFilesVerified"], 2)
        self.assertIn("assets/read2lead/index.html", proof["changedAssets"])
        self.assertIn("cloudflare/read2lead-private-preview/helper.mjs", proof["sourceChanged"])

    def test_good_case_full_verify(self):
        r = subprocess.run(
            [sys.executable, str(TOOL), "--base", str(self.f.base), "--base-config", str(self.f.base_config), "--repo", str(self.f.repo),
             "--out", str(self.f.out), "--build-env", str(self.f.build_env), "--full-verify"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(json.loads((self.f.out / "candidate-proof.json").read_text())["baseFullShaVerified"])

    def test_altered_private_file_fails(self):
        # Bite: if a protected __private file ends up different in the new candidate, the run must FAIL.
        # Trigger: a manifest page entry points INTO __private and dist has different bytes for it.
        m_path = self.f.base / "assets/__private/package.json"
        m = json.loads(m_path.read_text())
        m["pages"]["/leak"] = "/__private/media/pic.bin"
        m_path.write_text(json.dumps(m, separators=(",", ":")))
        (self.f.repo / "dist/__private/media").mkdir(parents=True)
        (self.f.repo / "dist/__private/media/pic.bin").write_bytes(b"TAMPERED")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("protected file differs from base", r.stderr)
        self.assertFalse(self.f.out.exists(), "failed run must not leave a candidate behind")
        self.assertEqual((self.f.base / "assets/__private/media/pic.bin").read_bytes(), b"\x00\x01ILLUSTRATION\x02")

    def test_page_referencing_astro_file_missing_from_manifest_fails(self):
        # Bite (the v93 lesson): a page references a chunk that exists in dist but the
        # tool is not able to allow-list -> simulate by a page referencing a chunk that dist lacks.
        (self.f.repo / "dist/read2lead/index.html").write_text(PAGE_NEW.replace("app.NEW.js", "ghost.js"))
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("/_astro/ghost.js which does not exist", r.stderr)
        self.assertFalse(self.f.out.exists())

    def test_chunk_dependency_missing_fails(self):
        # a chunk imports another chunk that was never shipped -> would 404 in the browser
        (self.f.repo / "dist/_astro/app.NEW.js").write_text('import"./dep.ZZZ.js";')
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("dep.ZZZ.js", r.stderr)

    def test_missing_base_fails(self):
        shutil.rmtree(self.f.base / "assets/__private")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("base manifest missing", r.stderr)

    def test_missing_base_dir_fails(self):
        r = self.f.run(base=self.f.tmp / "nope")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("base candidate dir missing", r.stderr)

    def test_out_exists_fails(self):
        self.f.out.mkdir()
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("out already exists", r.stderr)

    def test_stale_dist_fails(self):
        old = 1_000_000_000
        os.utime(self.f.repo / "dist", (old, old))
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("older than the repo HEAD", r.stderr)

    def test_missing_dist_fails(self):
        shutil.rmtree(self.f.repo / "dist")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("dist/ missing", r.stderr)

    def test_build_env_mismatch_fails(self):
        # dist flags chunk is v3-gated (off); an env that claims V3 was ON must be refused
        self.f.build_env.write_text(json.dumps({"PUBLIC_R2L_V3": "1"}))
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("PUBLIC_R2L_V3=1", r.stderr)

    def test_build_env_rejects_non_public_keys(self):
        self.f.build_env.write_text(json.dumps({"OPENAI_API_KEY": "x"}))
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("only hold PUBLIC_", r.stderr)

    def test_dirty_source_refused(self):
        (self.f.repo / "functions/lib/x.mjs").write_text("export const x=999;")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("uncommitted changes", r.stderr)

    def test_write_through_hard_link_is_caught_and_base_unchanged_normally(self):
        # Normal run never writes through a link (covered by test_good_case inode/hash equality).
        # Bite: force the tool to write THROUGH a link; the guard must detect the corrupted base and FAIL.
        r = self.f.run(extra_env={UNSAFE: "1"})
        self.assertNotEqual(r.returncode, 0, "write-through must not pass silently")
        self.assertIn("BASE", r.stderr)
        self.assertFalse(self.f.out.exists())


if __name__ == "__main__":
    unittest.main()
