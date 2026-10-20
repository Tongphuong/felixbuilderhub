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

TOOL = Path(os.environ.get("R2L_RELEASE_TOOL") or Path(__file__).resolve().parent.parent / "scripts/r2l-release/build_candidate.py")
UNSAFE = "R2L_RELEASE_UNSAFE_WRITE_THROUGH_FOR_BITE_TEST"
NO_VERBATIM = "R2L_RELEASE_NO_VERBATIM_FOR_BITE_TEST"
LIB_REL = ("assets/read2lead/library-assets/library.mjs", "assets/read2lead/library-assets/library.css")
LIB_SRC = ("src/scripts/read2lead-book-library.mjs", "src/styles/read2lead-book-library.css")


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

    def __init__(self, with_voice=False):
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
        # the base's library files are WRONG on purpose (stale/foreign content): a candidate must not inherit them
        w(self.base / LIB_REL[0], "export const WRONG_R2_LIBRARY_JS=1")
        w(self.base / LIB_REL[1], ".wrong-r2-library-css{}")
        w(a / "__private/media/pic.bin", b"\x00\x01ILLUSTRATION\x02")
        w(a / "__private/book-parts/p1.json", '{"part":1}')
        manifest = {
            "format": "synthetic-v1", "pages": {"/read2lead": "/read2lead/index.html"},
            "publicAssets": ["/_astro/app.OLD.js", "/read2lead/library-assets/library.mjs", "/read2lead/library-assets/library.css"], "scriptHashes": [],
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
            "durable_objects": {"bindings": [{"name": "R2L_PREVIEW_STATE", "class_name": "Read2LeadPrivatePreview"}]},
            "vars": {"R2L_PREVIEW_PACKAGE_SHA256": "old", "KEEP": "me"},
        }))
        # --- repo (a git repo with the 5 source dirs and a fresh dist/)
        r = self.repo
        w(r / "cloudflare/read2lead-private-preview/worker.mjs", "import {h} from './helper.mjs';export default {h,v:2};")
        w(r / "cloudflare/read2lead-private-preview/helper.mjs", "export const h=2;")
        w(r / "functions/lib/x.mjs", "export const x=1;")
        for d in ("schemas", "scripts", "src"):
            w(r / d / "keep.txt", d)
        w(r / LIB_SRC[0], "export const library = 'repo source js';\n")
        w(r / LIB_SRC[1], ".library{color:#17324D}\n")
        if with_voice:
            self._add_voice(w)
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
        w(r / "dist/read2lead/index.html", PAGE_NEW)
        w(r / "dist/_astro/app.NEW.js", "console.log('new')")
        w(r / "dist/_astro/flags.abc.js", 'function e(){return typeof window<"u"?new URLSearchParams(window.location.search).get("v3")==="1":!1}export{e as i};')
        w(r / "dist/read2lead/lesson/index.html", '<main data-r2l-w1-ssr="0" data-r2l-v21-ssr="0"></main>')
        self.build_env = t / "build-env.json"
        self.build_env.write_text("{}")
        # dist must be newer than the commit
        future = Path(r / "dist")
        os.utime(future, (future.stat().st_atime, future.stat().st_mtime + 5))

    def _add_voice(self, w):
        """Give base + repo the REAL student-voice loader (and its import closure), a batch-grant manifest and a
        matching R2L_STUDENT_VOICE_CONFIG var, so the real JS loader can be run against the candidate."""
        sys.path.insert(0, str(TOOL.parent))
        import build_candidate as bc  # noqa: E402
        real = Path(__file__).resolve().parent.parent
        files, unresolved = bc.import_closure(real, "functions/lib/read2lead/student-voice.mjs")
        assert not unresolved, unresolved
        for rel in sorted(files):
            data = (real / rel).read_bytes()
            for root in (self.base / "source", self.repo):
                w(root / rel, data)
        lessons = [{"id": "story-1", "version": "1.2.9", "packageSha256": "e" * 64}]
        cat = subprocess.run(["node", "--input-type=module", "-e",
            "import {verifiedLessonCatalogue as v} from %s;const c=await v({voiceVerificationLessons:%s});console.log(c.sha256)" % (
                json.dumps((real / "functions/lib/read2lead/private-voice.mjs").as_uri()), json.dumps(lessons))],
            capture_output=True, text=True, check=True).stdout.strip()
        self.source_pkg_sha = "b" * 64
        self.old_sha = "679110ea3d967c81b563717ea6f46cbf21ee5414dbda1b31681cc0691be113b2"
        self.old_budget = {"scope": "batch", "batchId": "r2l-student-launch-" + self.old_sha[:32], "expiresAt": "2026-10-22T14:38:23.828Z",
                           "approvedVoiceMicroUsd": 5000000, "worstCaseTurnMicroUsd": 70000, "maxTurns": 32}
        mp = self.base / "assets/__private/package.json"
        m = json.loads(mp.read_text())
        m["sourcePackageSha256"] = self.source_pkg_sha
        m["voiceVerificationLessons"] = lessons
        m["studentRelease"] = {"format": "read2lead-student-release-v1", "records": [], "voiceVerificationLessons": lessons,
                               "approvedGrant": {"approvalSha256": self.old_sha, "budget": dict(self.old_budget)}}
        mp.write_text(json.dumps(m, separators=(",", ":")))
        self.old_pricing = "dda818671ac0d87a5a00d697c552cff91fc6718b1527a786b26c4f1facb6af09"
        var = {"format": "read2lead-student-voice-v1", "audience": "enrolled-students", "mode": "assessed",
               "providerRoute": "cloudflare-only", "assessorModel": "gpt-oss-120b", "packageSha256": self.source_pkg_sha,
               "processingApproved": True, "spendingApproved": True, "approvalSha256": self.old_sha,
               "budget": dict(self.old_budget), "pricingEvidenceSha256": self.old_pricing,
               "verification": {"provider": True, "assessor": True, "evidenceSha256": "d" * 64, "catalogueSha256": cat}}
        self.var_before = json.dumps(var, separators=(",", ":"))
        c = json.loads(self.base_config.read_text())
        c["vars"]["R2L_STUDENT_VOICE_CONFIG"] = self.var_before
        self.base_config.write_text(json.dumps(c))

    def write_approval(self, **over):
        ap = {"format": "read2lead-voice-approval-v1", "id": "x",
              "budget": {"scope": "pool", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 15000000, "maxTurns": 32},
              "pricingEvidenceSha256": "f" * 64}
        ap.update(over)
        p = self.tmp / "approval.json"
        p.write_text(json.dumps(ap, indent=2))
        return p

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

    def test_library_files_come_from_repo_source_not_base(self):
        # Buffet R2 HIGH-1: library.mjs/.css are verbatim copies of repo source served from the Worker's assets, not build output.
        # The base's copies are WRONG here; hard-link a sibling release to them too (as v99-v106 were) and prove nothing leaks either way.
        sibling = self.f.tmp / "sibling"
        shutil.copytree(self.f.base, sibling, symlinks=True, copy_function=os.link)
        for rel in LIB_REL:
            self.assertTrue(os.path.samefile(sibling / rel, self.f.base / rel))
        base_before = {rel: ((self.f.base / rel).read_bytes(), os.stat(self.f.base / rel).st_ino) for rel in LIB_REL}
        sib_before = {rel: (sibling / rel).read_bytes() for rel in LIB_REL}
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        proof = json.loads((self.f.out / "candidate-proof.json").read_text())
        for rel, src in zip(LIB_REL, LIB_SRC):
            self.assertEqual(sha(self.f.out / rel), sha(self.f.repo / src), rel + " must equal the repo source")
            self.assertIn(rel, proof["changedAssets"])
            self.assertFalse(os.path.samefile(self.f.out / rel, self.f.base / rel), "candidate must not share an inode with the base copy")
            # (b) base AND every release hard-linked to it: content and inode unchanged
            self.assertEqual((self.f.base / rel).read_bytes(), base_before[rel][0])
            self.assertEqual(os.stat(self.f.base / rel).st_ino, base_before[rel][1])
            self.assertEqual((sibling / rel).read_bytes(), sib_before[rel])
        m = json.loads((self.f.out / "assets/__private/package.json").read_text())
        for pub in ("/read2lead/library-assets/library.mjs", "/read2lead/library-assets/library.css"):
            self.assertIn(pub, m["publicAssets"])

    def test_library_bite_without_the_fix_the_candidate_keeps_the_wrong_files(self):
        # (c) the pre-fix behaviour (no verbatim step): the candidate inherits the base's WRONG files, so the equality
        # assertion in test_library_files_come_from_repo_source_not_base discriminates.
        r = self.f.run(extra_env={NO_VERBATIM: "1"})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for rel, src in zip(LIB_REL, LIB_SRC):
            self.assertNotEqual(sha(self.f.out / rel), sha(self.f.repo / src))

    def test_bite_hook_in_a_run_is_loud_and_never_a_pass(self):
        # a real release must not pass silently with a test hook set
        r = self.f.run(extra_env={NO_VERBATIM: "1"})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("TEST BITE HOOKS ACTIVE", r.stderr)
        self.assertNotIn("versions upload", r.stdout)
        proof = json.loads((self.f.out / "candidate-proof.json").read_text())
        self.assertEqual(proof["biteHooksActive"], [NO_VERBATIM])
        self.assertNotEqual(proof["status"], "PASS")

    def test_clean_run_records_no_bite_hooks(self):
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        proof = json.loads((self.f.out / "candidate-proof.json").read_text())
        self.assertEqual((proof["biteHooksActive"], proof["status"]), ([], "PASS"))

    def test_library_source_missing_from_repo_fails(self):
        (self.f.repo / LIB_SRC[0]).unlink()
        f = self.f
        r = subprocess.run([sys.executable, str(TOOL), "--base", str(f.base), "--base-config", str(f.base_config), "--repo", str(f.repo),
                            "--out", str(f.out), "--build-env", str(f.build_env), "--allow-dirty"], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("verbatim asset source missing", r.stderr)
        self.assertFalse(f.out.exists())

    def test_library_identical_to_base_is_not_reported_changed(self):
        for rel, src in zip(LIB_REL, LIB_SRC):
            (self.f.base / rel).write_bytes((self.f.repo / src).read_bytes())
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        proof = json.loads((self.f.out / "candidate-proof.json").read_text())
        for rel in LIB_REL:
            self.assertNotIn(rel, proof["changedAssets"])
            self.assertEqual(sha(self.f.out / rel), sha(self.f.base / rel))

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
        for p in (self.f.repo / "dist").rglob("*"):
            os.utime(p, (old, old))
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

    def _set_lesson_w1(self, marker):
        (self.f.repo / "dist/read2lead/lesson/index.html").write_text(
            '<main data-r2l-w1-ssr="%s" data-r2l-v21-ssr="0"></main>' % marker)

    def test_build_env_w1_on_matching_dist_accepted(self):
        # the Worker env (W1=1) with a dist whose lesson page was built W1-on must pass
        self.f.build_env.write_text(json.dumps({"PUBLIC_R2L_W1": "1"}))
        self._set_lesson_w1("1")
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_build_env_w1_on_but_dist_built_off_fails(self):
        # env says W1=1, dist was built without it (blank-book-lesson build): refuse
        self.f.build_env.write_text(json.dumps({"PUBLIC_R2L_W1": "1"}))
        self._set_lesson_w1("0")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("PUBLIC_R2L_W1 implies data-r2l-w1-ssr=1", r.stderr)

    def test_build_env_w1_unset_but_dist_built_on_fails(self):
        # env empty, dist built with W1=1: refuse
        self.f.build_env.write_text("{}")
        self._set_lesson_w1("1")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("PUBLIC_R2L_W1 implies data-r2l-w1-ssr=0", r.stderr)

    def test_shipped_worker_build_env_has_w1_on_v3_off(self):
        env = json.loads((TOOL.parent / "build-env.worker.json").read_text())
        self.assertEqual(env.get("PUBLIC_R2L_W1"), "1")
        self.assertNotIn("PUBLIC_R2L_W1", env["_unset"])
        self.assertNotIn("PUBLIC_R2L_V3", env)
        self.assertIn("PUBLIC_R2L_V3", env["_unset"])

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


    def test_two_generations_do_not_touch_release_one(self):
        # Release 2 is built with --base = release 1 (the runbook's normal path). Release 1's rollback
        # config and proof are hard-linked into release 2 and must be REPLACED, never written through.
        r1 = self.f.run()
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        out1 = self.f.out
        names = ("wrangler.release.json", "candidate-proof.json")
        before = {n: ((out1 / n).read_bytes(), os.stat(out1 / n).st_ino) for n in names}
        before_all = tree_hashes(out1)
        out2 = self.f.tmp / "out2"
        (self.f.repo / "dist/read2lead/index.html").write_text(PAGE_NEW.replace("window.a=2", "window.a=3"))
        r2 = self.f.run(base=out1, base_config=out1 / "wrangler.release.json", out=out2)
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
        for n in names:
            self.assertEqual((out1 / n).read_bytes(), before[n][0], n + " of release 1 was rewritten")
            self.assertEqual(os.stat(out1 / n).st_ino, before[n][1])
        self.assertEqual(tree_hashes(out1), before_all)
        cfg1 = json.loads((out1 / "wrangler.release.json").read_text())
        cfg2 = json.loads((out2 / "wrangler.release.json").read_text())
        self.assertEqual(cfg1["main"], str(out1 / "source/cloudflare/read2lead-private-preview/worker.mjs"))
        self.assertEqual(cfg2["main"], str(out2 / "source/cloudflare/read2lead-private-preview/worker.mjs"))
        self.assertFalse(os.path.samefile(out1 / "wrangler.release.json", out2 / "wrangler.release.json"))

    def test_stub_base_config_rejected(self):
        # a candidate's own wrangler.json is a local stub: wrong name / no durable object binding
        self.f.base_config.write_text(json.dumps({"name": "local-stub", "assets": {"directory": "x"}, "vars": {}}))
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not the production Worker config", r.stderr)
        cfg = json.loads(self.f.base_config.read_text())
        cfg["name"] = "read2lead-story-private-preview"
        self.f.base_config.write_text(json.dumps(cfg))
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("R2L_PREVIEW_STATE", r.stderr)

    def test_build_env_unverifiable_dist_fails(self):
        (self.f.repo / "dist/_astro/flags.abc.js").unlink()
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("flags", r.stderr)
        (self.f.repo / "dist/_astro/flags.abc.js").write_text('get("v3")==="1"')
        (self.f.repo / "dist/read2lead/lesson/index.html").write_text("<main></main>")
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("marker data-r2l-w1-ssr not found", r.stderr)
        (self.f.repo / "dist/read2lead/lesson/index.html").unlink()
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("lesson/index.html not found", r.stderr)

    def test_stale_dist_uses_newest_file_not_dir_mtime(self):
        old = 1_000_000_000
        for p in (self.f.repo / "dist").rglob("*"):
            os.utime(p, (old, old))
        # directory mtime is fresh but every file is old: must still be refused
        os.utime(self.f.repo / "dist", None)
        r = self.f.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("older than the repo HEAD", r.stderr)


class StudentVoiceGrantTests(unittest.TestCase):
    """--student-voice-grant: the one narrow exception to 'the manifest never changes'."""

    def setUp(self):
        self.f = Fixture(with_voice=True)
        self.addCleanup(self.f.cleanup)

    def load(self, root):
        m = json.loads((root / "assets/__private/package.json").read_text())
        c = json.loads((root / "wrangler.release.json").read_text())
        return m, c, json.loads(c["vars"]["R2L_STUDENT_VOICE_CONFIG"])

    def refused(self, approval, needle):
        before = tree_hashes(self.f.base)
        r = self.f.run(student_voice_grant=approval)
        self.assertNotEqual(r.returncode, 0, "must be refused")
        self.assertIn(needle, r.stderr)
        self.assertFalse(self.f.out.exists(), "refused run must not leave a candidate")
        self.assertEqual(tree_hashes(self.f.base), before)

    def test_without_flag_nothing_about_the_grant_changes(self):
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        m, cfg, var = self.load(self.f.out)
        base_m = json.loads((self.f.base / "assets/__private/package.json").read_text())
        self.assertEqual(m["studentRelease"], base_m["studentRelease"])
        self.assertEqual(cfg["vars"]["R2L_STUDENT_VOICE_CONFIG"], self.f.var_before)
        self.assertNotIn("studentVoiceGrant", json.loads((self.f.out / "candidate-proof.json").read_text()))

    def test_with_flag_only_the_grant_changes(self):
        ap = self.f.write_approval()
        r = self.f.run(student_voice_grant=ap)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        approval_sha = sha(ap)
        pool = {"scope": "pool", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 15000000, "maxTurns": 32}
        m, cfg, var = self.load(self.f.out)
        base_m = json.loads((self.f.base / "assets/__private/package.json").read_text())
        # manifest: ONLY studentRelease.approvedGrant (plus the usual publicAssets/scriptHashes) differs
        self.assertEqual(m["studentRelease"]["approvedGrant"], {"approvalSha256": approval_sha, "budget": pool})
        self.assertEqual(list(m["studentRelease"]["approvedGrant"]["budget"]), ["scope", "poolId", "approvedVoiceMicroUsd", "maxTurns"])
        for k in base_m:
            if k in ("publicAssets", "scriptHashes", "studentRelease"):
                continue
            self.assertEqual(m[k], base_m[k], k)
        self.assertEqual({k: v for k, v in m["studentRelease"].items() if k != "approvedGrant"},
                         {k: v for k, v in base_m["studentRelease"].items() if k != "approvedGrant"})
        # var: budget, approvalSha256, pricingEvidenceSha256 changed; every other field identical, same key order
        old = json.loads(self.f.var_before)
        self.assertEqual(list(var), list(old))
        for k in old:
            if k in ("budget", "approvalSha256", "pricingEvidenceSha256"):
                continue
            self.assertEqual(var[k], old[k], k)
        self.assertEqual(var["budget"], pool)
        self.assertEqual(var["approvalSha256"], approval_sha)
        self.assertEqual(var["pricingEvidenceSha256"], "f" * 64)
        self.assertEqual(cfg["vars"]["R2L_PREVIEW_PACKAGE_SHA256"], sha(self.f.out / "assets/__private/package.json"))
        self.assertEqual(cfg["vars"]["KEEP"], "me")
        # proof
        proof = json.loads((self.f.out / "candidate-proof.json").read_text())
        g = proof["studentVoiceGrant"]
        self.assertEqual((g["approvalSha256"], g["budget"], g["previousApprovalSha256"]), (approval_sha, pool, self.f.old_sha))
        self.assertEqual(g["approvalFile"], str(ap.resolve()))
        self.assertTrue(g["loaderCheck"]["enabled"])
        # the real JS loader says enabled with the pool, long after the old batch expiry (2026-10-22)
        c = subprocess.run(["node", str(TOOL.parent / "check_student_grant.mjs"), "--source-root", str(self.f.out / "source"),
                            "--manifest", str(self.f.out / "assets/__private/package.json"),
                            "--config", str(self.f.out / "wrangler.release.json")], capture_output=True, text=True)
        res = json.loads(c.stdout)
        self.assertTrue(res["ok"], c.stdout)
        self.assertEqual({k: res["budget"][k] for k in pool}, pool)
        # base untouched
        self.assertEqual(json.loads(self.f.base_config.read_text())["vars"]["R2L_STUDENT_VOICE_CONFIG"], self.f.var_before)

    def test_loader_check_bites_when_var_and_grant_disagree(self):
        # Bite for the end-to-end check itself: a var left on the OLD approval (grant swapped, var not) must fail.
        r = self.f.run(student_voice_grant=self.f.write_approval())
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        mp = self.f.out / "assets/__private/package.json"
        m = json.loads(mp.read_text())
        m["studentRelease"]["approvedGrant"]["approvalSha256"] = "9" * 64  # grant no longer matches the var
        tmp_m = self.f.tmp / "m.json"
        tmp_m.write_text(json.dumps(m))
        c = subprocess.run(["node", str(TOOL.parent / "check_student_grant.mjs"), "--source-root", str(self.f.out / "source"),
                            "--manifest", str(tmp_m), "--config", str(self.f.out / "wrangler.release.json")], capture_output=True, text=True)
        self.assertNotEqual(c.returncode, 0)
        self.assertIn("grant_mismatch", c.stdout)

    def test_refuses_batch_budget(self):
        ap = self.f.write_approval(budget=dict(self.f.old_budget))
        self.refused(ap, "approval budget must be exactly the pool shape")

    def test_refuses_batch_scope_with_pool_keys(self):
        ap = self.f.write_approval(budget={"scope": "batch", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 5000000, "maxTurns": 32})
        self.refused(ap, "scope must be 'pool'")

    def test_refuses_extra_budget_key(self):
        ap = self.f.write_approval(budget={"scope": "pool", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 15000000,
                                           "maxTurns": 32, "expiresAt": "2027-01-01T00:00:00.000Z"})
        self.refused(ap, "approval budget must be exactly the pool shape")

    def test_refuses_cap_over_fifteen_dollars(self):
        ap = self.f.write_approval(budget={"scope": "pool", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 15000001, "maxTurns": 32})
        self.refused(ap, "approvedVoiceMicroUsd must be an integer in 1..15000000")

    def test_refuses_wrong_format_pool_id_and_turns(self):
        self.refused(self.f.write_approval(format="read2lead-voice-approval-v0"), "approval format must be")
        self.refused(self.f.write_approval(budget={"scope": "pool", "poolId": "other", "approvedVoiceMicroUsd": 1, "maxTurns": 32}), "poolId must be")
        self.refused(self.f.write_approval(budget={"scope": "pool", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 1, "maxTurns": 31}), "maxTurns must be exactly 32")

    def test_other_manifest_key_change_still_refused_with_flag(self):
        # The tool never edits other keys itself, so provoke it: patch the grant step to ALSO touch other manifest fields.
        sys.path.insert(0, str(TOOL.parent))
        import build_candidate as bc
        real = bc.apply_grant_to_manifest
        for mutate in (lambda m: m["pages"].update({"/x": "/read2lead/index.html"}),
                       lambda m: m["studentRelease"].update({"records": [{"id": "sneaky"}]}),
                       lambda m: m["studentRelease"].update({"extra": 1}),
                       lambda m: m.update({"newKey": 1})):
            def evil(manifest, sha_, budget, mutate=mutate):
                prev = real(manifest, sha_, budget)
                mutate(manifest)
                return prev
            bc.apply_grant_to_manifest = evil
            try:
                ns = type("A", (), dict(base=self.f.base, base_config=self.f.base_config, repo=self.f.repo, out=self.f.out,
                                        build_env=self.f.build_env, full_verify=False, allow_dirty=False, keep_failed=False,
                                        student_voice_grant=str(self.f.write_approval())))
                with self.assertRaises(bc.ReleaseError) as cm:
                    bc.build(ns)
                self.assertRegex(str(cm.exception), "protected manifest field changed|manifest keys changed")
                self.assertFalse(self.f.out.exists())
            finally:
                bc.apply_grant_to_manifest = real


class StudentVoiceAssessorTests(unittest.TestCase):
    """--student-voice-assessor: rewrites ONLY assessorModel in R2L_STUDENT_VOICE_CONFIG (T3, prepared but off)."""

    POOL = {"scope": "pool", "poolId": "r2l-student-pool", "approvedVoiceMicroUsd": 15000000, "maxTurns": 32}

    def setUp(self):
        self.f = Fixture(with_voice=True)
        self.addCleanup(self.f.cleanup)
        # make the BASE already carry a pool grant, as production does, so the loader check passes with no grant flag
        sha_ = "a" * 64
        mp = self.f.base / "assets/__private/package.json"
        m = json.loads(mp.read_text())
        m["studentRelease"]["approvedGrant"] = {"approvalSha256": sha_, "budget": dict(self.POOL)}
        mp.write_text(json.dumps(m, separators=(",", ":")))
        c = json.loads(self.f.base_config.read_text())
        v = json.loads(c["vars"]["R2L_STUDENT_VOICE_CONFIG"])
        v["approvalSha256"] = sha_
        v["budget"] = dict(self.POOL)
        self.f.var_before = json.dumps(v, separators=(",", ":"))
        c["vars"]["R2L_STUDENT_VOICE_CONFIG"] = self.f.var_before
        self.f.base_config.write_text(json.dumps(c))

    def var_out(self):
        c = json.loads((self.f.out / "wrangler.release.json").read_text())
        return c["vars"]["R2L_STUDENT_VOICE_CONFIG"]

    def test_without_flag_output_unchanged(self):
        r = self.f.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.var_out(), self.f.var_before)
        self.assertNotIn("studentVoiceAssessor", json.loads((self.f.out / "candidate-proof.json").read_text()))

    def test_with_flag_only_that_field_changes(self):
        r = self.f.run(student_voice_assessor="gpt-oss-20b")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        old, new = json.loads(self.f.var_before), json.loads(self.var_out())
        self.assertEqual(list(new), list(old))
        self.assertEqual(new["assessorModel"], "gpt-oss-20b")
        self.assertEqual({k: v for k, v in new.items() if k != "assessorModel"}, {k: v for k, v in old.items() if k != "assessorModel"})
        # manifest untouched apart from the usual publicAssets/scriptHashes
        m = json.loads((self.f.out / "assets/__private/package.json").read_text())
        bm = json.loads((self.f.base / "assets/__private/package.json").read_text())
        for k in bm:
            if k not in ("publicAssets", "scriptHashes"):
                self.assertEqual(m[k], bm[k], k)
        p = json.loads((self.f.out / "candidate-proof.json").read_text())["studentVoiceAssessor"]
        self.assertEqual((p["assessorModel"], p["previousAssessorModel"], p["loaderCheck"]["enabled"]), ("gpt-oss-20b", "gpt-oss-120b", True))
        self.assertEqual(json.loads(self.f.base_config.read_text())["vars"]["R2L_STUDENT_VOICE_CONFIG"], self.f.var_before)

    def test_unknown_model_refused(self):
        before = tree_hashes(self.f.base)
        r = self.f.run(student_voice_assessor="gpt-oss-1b")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("invalid choice", r.stderr)
        self.assertFalse(self.f.out.exists())
        self.assertEqual(tree_hashes(self.f.base), before)

    def test_real_loader_refuses_an_unsupported_model_in_the_var(self):
        # Bite for the loader itself: a var carrying an unknown grader must come back disabled.
        r = self.f.run(student_voice_assessor="gpt-oss-20b")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        cfgp = self.f.out / "wrangler.release.json"
        c = json.loads(cfgp.read_text())
        v = json.loads(c["vars"]["R2L_STUDENT_VOICE_CONFIG"])
        v["assessorModel"] = "gpt-oss-1b"
        c["vars"]["R2L_STUDENT_VOICE_CONFIG"] = json.dumps(v, separators=(",", ":"))
        cfgp.write_text(json.dumps(c))
        out = subprocess.run(["node", str(TOOL.parent / "check_student_grant.mjs"), "--source-root", str(self.f.out / "source"),
                              "--manifest", str(self.f.out / "assets/__private/package.json"), "--config", str(cfgp)],
                             capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)
        self.assertEqual(json.loads(out.stdout)["reason"], "package_or_policy_mismatch")


if __name__ == "__main__":
    unittest.main()
