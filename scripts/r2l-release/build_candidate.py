#!/usr/bin/env python3
"""Prepare (never upload, never deploy) a Read2Lead Worker release candidate.

Production Read2Lead = Cloudflare Pages + the Worker `read2lead-story-private-preview`.
The Worker serves its OWN asset bundle (pages built locally, plus a checksum-pinned
manifest `assets/__private/package.json`) and its own server source. This tool turns
the previous live candidate (the BASE) plus a freshly built `dist/` and the repo's
current server source into a NEW candidate directory, using hard links so it costs
almost no disk, and proves nothing protected was touched.

It only prepares and prints. The upload / deploy commands are printed for Elon to run.

Usage:
  build_candidate.py --base <candidate dir> --base-config <wrangler json> \
      --repo <repo root with fresh dist/> --out <new candidate dir> \
      --build-env <json recording PUBLIC_* used for the build> [--full-verify] [--allow-dirty]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

WRANGLER = "wrangler@4.129.0"
SOURCE_DIRS = ["cloudflare", "functions", "schemas", "scripts", "src"]
WORKER_ENTRY = "cloudflare/read2lead-private-preview/worker.mjs"
MANIFEST_REL = "assets/__private/package.json"
MUTABLE_MANIFEST_KEYS = {"publicAssets", "scriptHashes"}
LOCAL_FILE_EXT = r"(?:js|mjs|css|png|jpe?g|webp|svg|woff2?|mp3|mp4|json|ico)"
# Test hook: makes put() write THROUGH hard links so the guard can be proven to bite.
UNSAFE_ENV = "R2L_RELEASE_UNSAFE_WRITE_THROUGH_FOR_BITE_TEST"


class ReleaseError(Exception):
    pass


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def walk_files(root):
    """Yield relative posix paths of every regular file (symlinks included as entries)."""
    root = Path(root)
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            yield (Path(dirpath) / f).relative_to(root).as_posix()


def snapshot_stat(root):
    snap = {}
    for rel in walk_files(root):
        st = os.lstat(Path(root) / rel)
        snap[rel] = (st.st_ino, st.st_size, st.st_mtime_ns)
    return snap


def put(path, data):
    """Write `data` to `path` by REPLACING the (possibly hard-linked) file with a fresh one.

    Never writes through an existing link, which would corrupt the base candidate.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.environ.get(UNSAFE_ENV) and path.exists():
        path.write_bytes(data)  # deliberately unsafe: used only by the bite test
        return
    tmp = path.with_name(path.name + ".r2lnew")
    if tmp.exists():
        tmp.unlink()
    tmp.write_bytes(data)
    os.replace(tmp, path)


def git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise ReleaseError("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout.strip()


def load_json(p, what):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        raise ReleaseError("%s not found: %s" % (what, p))
    except json.JSONDecodeError as e:
        raise ReleaseError("%s is not valid JSON (%s): %s" % (what, e, p))


# ---------------------------------------------------------------- build env

def check_build_env(env_file, dist):
    env = load_json(env_file, "--build-env file")
    if not isinstance(env, dict):
        raise ReleaseError("--build-env must be a JSON object of PUBLIC_* name -> string")
    values = {k: v for k, v in env.items() if not k.startswith("_")}
    for k, v in values.items():
        if not k.startswith("PUBLIC_") or not isinstance(v, str):
            raise ReleaseError("--build-env may only hold PUBLIC_* string values; bad key %r" % k)
    verified, notes = [], []
    # PUBLIC_R2L_V3: compiled flags chunk is `return!0` when on, `?v3=1`-gated when off.
    flags = sorted((dist / "_astro").glob("flags.*.js"))
    if flags:
        compiled_on = any("return!0" in f.read_text() for f in flags)
        compiled_gated = any('get("v3")==="1"' in f.read_text() for f in flags)
        want_on = values.get("PUBLIC_R2L_V3") == "1"
        if want_on and not compiled_on:
            raise ReleaseError("build-env says PUBLIC_R2L_V3=1 but dist flags chunk is v3-gated: dist was built with a different env")
        if not want_on and compiled_on and not compiled_gated:
            raise ReleaseError("build-env has PUBLIC_R2L_V3 unset but dist flags chunk is hard-ON: dist was built with a different env")
        verified.append("PUBLIC_R2L_V3")
    else:
        notes.append("no dist/_astro/flags.*.js found; PUBLIC_R2L_V3 not verifiable")
    lesson = dist / "read2lead/lesson/index.html"
    if lesson.exists():
        t = lesson.read_text()
        for var, attr in (("PUBLIC_R2L_W1", "data-r2l-w1-ssr"), ("PUBLIC_R2L_V21", "data-r2l-v21-ssr")):
            m = re.search(attr + r'="([01])"', t)
            if m:
                want = "1" if values.get(var) == "1" else "0"
                if m.group(1) != want:
                    raise ReleaseError("build-env %s implies %s=%s but dist lesson page has %s: dist built with a different env" % (var, attr, want, m.group(1)))
                verified.append(var)
    return {"env": values, "verifiedAgainstDist": verified, "notes": notes, "file": str(env_file)}


# ---------------------------------------------------------------- page checks

ASTRO_REF = re.compile(r'''(?:src|href)=["'](/_astro/[^"'?#]+)''')
LOCAL_REF = re.compile(r'''(?:src|href)=["'](/[^"'?#<>]+\.''' + LOCAL_FILE_EXT + r''')["'?#]''')
INLINE_SCRIPT = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S)


def script_hashes_for(text):
    out = set()
    for attrs, script in INLINE_SCRIPT.findall(text):
        if script.strip() and not re.search(r"\bsrc\s*=", attrs):
            out.add("sha256-" + base64.b64encode(hashlib.sha256(script.encode()).digest()).decode())
    return out


JS_REF = re.compile(r'''["'`](?:\./|/_astro/)([\w.\-]+\.(?:js|mjs|css|woff2?))["'`]''')
CSS_URL = re.compile(r'''url\(\s*["']?([^)"']+)''')


def chunk_deps(assets, rel):
    """Return /_astro/ paths that file `rel` (an /_astro/ asset) refers to."""
    p = assets / rel.lstrip("/")
    if not p.is_file():
        return set()
    try:
        t = p.read_text(errors="replace")
    except OSError:
        return set()
    deps = set()
    if rel.endswith((".js", ".mjs")):
        for name in JS_REF.findall(t):
            deps.add("/_astro/" + name)
    elif rel.endswith(".css"):
        for u in CSS_URL.findall(t):
            if u.startswith("data:") or u.startswith("http"):
                continue
            if u.startswith("/_astro/"):
                deps.add(u.split("?")[0].split("#")[0])
            elif u.startswith("./") or re.match(r"^[\w.\-]+\.(woff2?|png|svg|jpe?g|webp)", u):
                deps.add("/_astro/" + u.lstrip("./").split("?")[0].split("#")[0])
    return deps


def check_astro_refs(assets, manifest):
    """Every /_astro/ file a page (or a chunk it loads) references must exist AND be allow-listed."""
    public = set(manifest["publicAssets"])
    problems = []
    for url in sorted(set(manifest["pages"].values())):
        page = assets / url.lstrip("/")
        if not page.is_file():
            problems.append("page file missing from candidate: %s" % url)
            continue
        text = page.read_text(errors="replace")
        seen, stack = set(), list(dict.fromkeys(ASTRO_REF.findall(text)))
        while stack:
            ref = stack.pop()
            if ref in seen:
                continue
            seen.add(ref)
            if not (assets / ref.lstrip("/")).is_file():
                problems.append("%s references %s which does not exist" % (url, ref))
                continue
            if ref not in public:
                problems.append("%s references %s which is NOT in publicAssets (it would 404)" % (url, ref))
            stack.extend(chunk_deps(assets, ref))
    if problems:
        raise ReleaseError("asset reference check failed:\n  - " + "\n  - ".join(problems))


# ---------------------------------------------------------------- source sync

IMPORT_RE = re.compile(r'''(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]''')


def import_closure(root, entry):
    """Relative-import closure of `entry` inside tree `root`. Returns (found, unresolved)."""
    seen, unresolved, stack = set(), [], [entry]
    while stack:
        f = stack.pop()
        if f in seen:
            continue
        seen.add(f)
        p = root / f
        if not p.is_file() or p.suffix not in (".mjs", ".js", ".ts"):
            continue
        for m in IMPORT_RE.findall(p.read_text(errors="replace")):
            rel = os.path.normpath(os.path.join(os.path.dirname(f), m.split("?")[0])).replace(os.sep, "/")
            if (root / rel).is_file():
                stack.append(rel)
            else:
                unresolved.append((f, m))
    return seen, unresolved


def sync_source(repo, out, base_sha_log):
    base_files = [r for r in walk_files(out / "source")]
    changed, kept_base_only = [], []
    for rel in sorted(base_files):
        dst = out / "source" / rel
        src = repo / rel
        top = rel.split("/")[0]
        if top not in SOURCE_DIRS:
            continue
        if not src.is_file():
            kept_base_only.append(rel)
            continue
        if sha256_file(src) != sha256_file(dst):
            base_sha_log["source/" + rel] = sha256_file(dst)
            put(dst, src.read_bytes())
            changed.append(rel)
    # Pull in any file the current worker now imports that the base did not carry.
    added = []
    for _ in range(20):
        closure, unresolved = import_closure(out / "source", WORKER_ENTRY)
        todo = []
        for f, m in unresolved:
            rel = os.path.normpath(os.path.join(os.path.dirname(f), m.split("?")[0])).replace(os.sep, "/")
            if (repo / rel).is_file() and rel.split("/")[0] in SOURCE_DIRS:
                todo.append(rel)
        if not todo:
            break
        for rel in sorted(set(todo)):
            put(out / "source" / rel, (repo / rel).read_bytes())
            added.append(rel)
    closure, unresolved = import_closure(out / "source", WORKER_ENTRY)
    if unresolved:
        raise ReleaseError("worker source has unresolved relative imports: %s" % unresolved[:5])
    return changed, added, kept_base_only


# ---------------------------------------------------------------- main build

def build(a):
    base = Path(a.base).resolve()
    out = Path(a.out).resolve()
    repo = Path(a.repo).resolve()
    base_cfg = Path(a.base_config).resolve()
    dist = repo / "dist"

    if not base.is_dir():
        raise ReleaseError("base candidate dir missing: %s" % base)
    if not (base / MANIFEST_REL).is_file():
        raise ReleaseError("base manifest missing: %s" % (base / MANIFEST_REL))
    if not base_cfg.is_file():
        raise ReleaseError("base wrangler config missing: %s" % base_cfg)
    if out.exists():
        raise ReleaseError("out already exists (refusing to overwrite): %s" % out)
    if out == base or base in out.parents or out in base.parents:
        raise ReleaseError("out and base must be separate directories")
    if not (out.parent.is_dir()):
        raise ReleaseError("parent of out does not exist: %s" % out.parent)
    if not dist.is_dir():
        raise ReleaseError("repo dist/ missing: run the build first (%s)" % dist)
    head_time = int(git(repo, "log", "-1", "--format=%ct"))
    if dist.stat().st_mtime < head_time:
        raise ReleaseError("dist/ is older than the repo HEAD commit: rebuild it (dist %s < HEAD %s)" % (
            time.strftime("%F %T", time.localtime(dist.stat().st_mtime)), time.strftime("%F %T", time.localtime(head_time))))
    head = git(repo, "rev-parse", "HEAD")
    if not a.allow_dirty:
        dirty = git(repo, "status", "--porcelain", "--untracked-files=no", "--", *SOURCE_DIRS)
        if dirty:
            raise ReleaseError("repo has uncommitted changes in server source dirs (release from a clean commit, or pass --allow-dirty):\n" + dirty)
    build_env = check_build_env(a.build_env, dist)

    base_manifest = json.loads((base / MANIFEST_REL).read_text())
    for k in ("pages", "publicAssets", "scriptHashes"):
        if k not in base_manifest:
            raise ReleaseError("base manifest lacks %r" % k)

    # --- guard snapshot of the base BEFORE we touch anything
    before = snapshot_stat(base)
    base_sha_log = {}  # rel (candidate-relative) -> sha of the base file we are about to replace
    full_before = {r: sha256_file(base / r) for r in before} if a.full_verify else None

    try:
        try:
            shutil.copytree(base, out, symlinks=True, copy_function=os.link)
        except OSError as e:
            raise ReleaseError("hard-link copy failed (out must be on the same filesystem as base): %s" % e)

        manifest = json.loads(json.dumps(base_manifest))
        assets = out / "assets"
        changed_assets, missing_pages = [], []

        # pages
        for url in sorted(set(manifest["pages"].values())):
            src = dist / url.lstrip("/")
            dst = assets / url.lstrip("/")
            if not src.is_file():
                missing_pages.append(url)
                continue
            if not dst.is_file() or src.read_bytes() != dst.read_bytes():
                if dst.is_file():
                    base_sha_log["assets" + url] = sha256_file(dst)
                put(dst, src.read_bytes())
                changed_assets.append("assets" + url)

        # _astro chunks
        added_public = []
        if (dist / "_astro").is_dir():
            for p in sorted((dist / "_astro").rglob("*")):
                if not p.is_file():
                    continue
                rel = "/" + p.relative_to(dist).as_posix()
                dst = assets / rel.lstrip("/")
                if not dst.is_file() or p.read_bytes() != dst.read_bytes():
                    if dst.is_file():
                        base_sha_log["assets" + rel] = sha256_file(dst)
                    put(dst, p.read_bytes())
                    changed_assets.append("assets" + rel)
                if rel not in manifest["publicAssets"]:
                    manifest["publicAssets"].append(rel)
                    added_public.append(rel)
        manifest["publicAssets"] = sorted(set(manifest["publicAssets"]))

        # CSP script hashes (add-only, exactly as the previous releases did)
        hashes = set(manifest["scriptHashes"])
        for url in set(manifest["pages"].values()):
            pg = assets / url.lstrip("/")
            if pg.is_file():
                hashes |= script_hashes_for(pg.read_text(errors="replace"))
        added_hashes = sorted(hashes - set(base_manifest["scriptHashes"]))
        manifest["scriptHashes"] = sorted(hashes)

        check_astro_refs(assets, manifest)

        # protected manifest fields
        for k in base_manifest:
            if k not in MUTABLE_MANIFEST_KEYS and manifest[k] != base_manifest[k]:
                raise ReleaseError("protected manifest field changed: %s" % k)
        if set(manifest) != set(base_manifest):
            raise ReleaseError("manifest keys changed")

        manifest_changed = (manifest["publicAssets"] != base_manifest["publicAssets"]
                            or manifest["scriptHashes"] != base_manifest["scriptHashes"])
        if manifest_changed:
            base_sha_log[MANIFEST_REL] = sha256_file(out / MANIFEST_REL)
            put(out / MANIFEST_REL, json.dumps(manifest, separators=(",", ":")).encode())

        # server source
        src_changed, src_added, src_base_only = sync_source(repo, out, base_sha_log)

        # soft check: other local files pages reference but the bundle lacks
        unresolved_local = []
        for url in sorted(set(manifest["pages"].values())):
            pg = assets / url.lstrip("/")
            if pg.is_file():
                for ref in set(LOCAL_REF.findall(pg.read_text(errors="replace"))):
                    if not ref.startswith("/_astro/") and not (assets / ref.lstrip("/")).is_file():
                        unresolved_local.append("%s -> %s" % (url, ref))
        stale_public = [r for r in manifest["publicAssets"] if not (assets / r.lstrip("/")).is_file()]

        # --- protected content: everything under assets/__private except package.json
        protected_count = 0
        priv = out / "assets/__private"
        for rel in walk_files(priv):
            if rel == "package.json":
                continue
            o, b = priv / rel, base / "assets/__private" / rel
            if not b.is_file():
                raise ReleaseError("protected file appeared that is not in base: __private/%s" % rel)
            if not os.path.samefile(o, b) and sha256_file(o) != sha256_file(b):
                raise ReleaseError("protected file differs from base: __private/%s" % rel)
            protected_count += 1
        base_priv = {r for r in walk_files(base / "assets/__private") if r != "package.json"}
        out_priv = {r for r in walk_files(priv) if r != "package.json"}
        if base_priv != out_priv:
            raise ReleaseError("protected file set changed: %s" % sorted(base_priv ^ out_priv)[:5])

        # --- base guard: nothing in base moved, changed or appeared
        after = snapshot_stat(base)
        if after != before:
            moved = sorted(set(before) ^ set(after)) + sorted(k for k in before if k in after and before[k] != after[k])
            raise ReleaseError("BASE CANDIDATE WAS MODIFIED (hard-link write-through?): %s" % moved[:10])
        for rel, h in base_sha_log.items():
            if sha256_file(base / rel) != h:
                raise ReleaseError("BASE FILE CONTENT CHANGED for %s" % rel)
        if full_before is not None:
            for r, h in full_before.items():
                if sha256_file(base / r) != h:
                    raise ReleaseError("BASE FILE CONTENT CHANGED (full verify) for %s" % r)

        # --- wrangler config
        cfg = load_json(base_cfg, "base wrangler config")
        manifest_sha = sha256_file(out / MANIFEST_REL)
        cfg["main"] = str(out / "source" / WORKER_ENTRY)
        cfg["assets"]["directory"] = str(out / "assets")
        cfg.setdefault("vars", {})["R2L_PREVIEW_PACKAGE_SHA256"] = manifest_sha
        cfg_path = out / "wrangler.release.json"
        cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")

        proof = {
            "status": "PASS",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "base": str(base),
            "baseManifestSha256": sha256_file(base / MANIFEST_REL),
            "repo": str(repo),
            "repoCommit": head,
            "buildEnv": build_env,
            "changedAssets": changed_assets,
            "pagesMissingFromDistKeptFromBase": missing_pages,
            "publicAssetsAdded": added_public,
            "scriptHashesAdded": added_hashes,
            "manifestChanged": manifest_changed,
            "manifestSha256": manifest_sha,
            "sourceChanged": src_changed,
            "sourceAdded": src_added,
            "sourceBaseOnlyKept": src_base_only,
            "protectedFilesVerified": protected_count,
            "baseFilesStatChecked": len(before),
            "baseFullShaVerified": bool(a.full_verify),
            "warnings": {
                "localRefsNotInBundle": unresolved_local,
                "publicAssetsWithoutFile": len(stale_public),
            },
            "wranglerConfig": str(cfg_path),
        }
        (out / "candidate-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
        return proof, cfg_path
    except BaseException:
        if out.exists() and not a.keep_failed:
            shutil.rmtree(out)  # hard links only; never touches the base files' data
        raise


def print_next(proof, cfg_path):
    short = proof["repoCommit"][:8]
    print("\nNOT UPLOADED. NOT DEPLOYED. Next steps (Elon runs these; this tool does not):\n")
    print("  1. Rehearse locally:  node scripts/r2l-release/rehearse.mjs --candidate %s --repo %s" % (Path(proof["wranglerConfig"]).parent, proof["repo"]))
    print("  2. Upload a version (does NOT change live traffic):")
    print("       npx %s versions upload --config %s --message \"R2L %s\"" % (WRANGLER, cfg_path, short))
    print("  3. Deploy it at 100% (this IS the production switch):")
    print("       npx %s versions deploy <NEW_VERSION_ID>@100%% --config %s -y" % (WRANGLER, cfg_path))
    print("  4. Rollback = deploy the previous version id again (see docs/R2L_WORKER_RELEASE.md):")
    print("       npx %s versions deploy <PREVIOUS_VERSION_ID>@100%% --config %s -y" % (WRANGLER, cfg_path))
    print("     (find it first: npx %s deployments list --config %s)" % (WRANGLER, cfg_path))
    print("     NEVER roll back to pre-SQL versions c98c2283 / fb68ea38.")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--base-config", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--build-env", required=True)
    ap.add_argument("--full-verify", action="store_true", help="sha256 every base file before and after (slow on the real 6 GB base)")
    ap.add_argument("--allow-dirty", action="store_true")
    ap.add_argument("--keep-failed", action="store_true", help="keep the out dir when the run fails")
    a = ap.parse_args(argv)
    try:
        proof, cfg_path = build(a)
    except ReleaseError as e:
        print("FAIL: %s" % e, file=sys.stderr)
        return 1
    summary = {k: (len(v) if isinstance(v, list) else v) for k, v in proof.items()
               if k in ("status", "repoCommit", "changedAssets", "publicAssetsAdded", "scriptHashesAdded", "sourceChanged",
                        "sourceAdded", "protectedFilesVerified", "baseFilesStatChecked", "manifestChanged", "manifestSha256")}
    print("PASS " + json.dumps(summary, indent=2))
    print("changed assets:", proof["changedAssets"][:40])
    print("changed source:", proof["sourceChanged"], proof["sourceAdded"])
    print("proof: %s" % (Path(cfg_path).parent / "candidate-proof.json"))
    print_next(proof, cfg_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
