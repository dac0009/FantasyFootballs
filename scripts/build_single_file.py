"""Build the whole site as one self-contained HTML file.

Why this exists
---------------
The normal build produces a folder (`web/dist/`) that GitHub Pages serves, with
the datasets fetched as separate files. That is the right shape for the
deployed site.

Sometimes you want the site as a *single file* instead: to preview it before
deploying, to email it to a league member, to open it from a USB stick, or to
keep a frozen snapshot of a season. This script inlines the CSS, the JavaScript
and every dataset into one HTML document with no external dependencies beyond
the Google Fonts stylesheet (which degrades to system fonts offline).

Usage
-----
    python scripts/build_single_file.py
    python scripts/build_single_file.py --skip rosters --out /tmp/preview.html

Datasets are embedded on `window.__LEAGUE_DATA__`; `web/src/lib/data.ts` reads
from there when it is present instead of fetching.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web"
DATA = REPO / "data"
DIST = WEB / "dist-standalone"

#: Browsers slow down badly on very large inline scripts, and the artifact
#: hosting limit is 16 MB. Warn well before either becomes a problem.
SIZE_WARN_MB = 12.0


def run_build() -> None:
    print("building the app (standalone mode)...")
    result = subprocess.run(
        ["npx", "vite", "build", "--outDir", "dist-standalone", "--base", "./"],
        cwd=WEB,
        env={
            **__import__("os").environ,
            "VITE_STANDALONE": "true",
            "BASE_PATH": "./",
        },
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit("vite build failed")
    print(result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "built")


def collect_data(skip: set[str]) -> dict[str, object]:
    """Load every dataset, keyed by the path the frontend would request."""
    if not DATA.exists():
        raise SystemExit(
            "No data/ directory. Run `python -m pipeline sample` or "
            "`python -m pipeline refresh` first."
        )
    bundle: dict[str, object] = {}
    for path in sorted(DATA.rglob("*.json")):
        key = path.relative_to(DATA).as_posix()
        top = key.split("/")[0].removesuffix(".json")
        if top in skip:
            continue
        bundle[key] = json.loads(path.read_text(encoding="utf-8"))
    return bundle


def inline(bundle: dict[str, object], out_path: Path) -> None:
    index = DIST / "index.html"
    if not index.exists():
        raise SystemExit(f"expected {index} to exist after the build")
    html = index.read_text(encoding="utf-8")

    # Inline stylesheets.
    def replace_css(match: re.Match) -> str:
        href = match.group(1)
        if href.startswith("http"):
            return match.group(0)  # leave Google Fonts alone
        asset = DIST / href.lstrip("./")
        if not asset.exists():
            return match.group(0)
        return f"<style>\n{asset.read_text(encoding='utf-8')}\n</style>"

    html = re.sub(
        r'<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', replace_css, html
    )
    html = re.sub(
        r'<link[^>]+href="([^"]+)"[^>]*rel="stylesheet"[^>]*>', replace_css, html
    )

    # Inline the script. The standalone build is emitted as a classic IIFE
    # (see vite.config.ts), so the type="module" attribute is dropped: module
    # scripts are blocked by CORS when a file is opened over file://.
    def replace_js(match: re.Match) -> str:
        src = match.group(1)
        if src.startswith("http"):
            return match.group(0)
        asset = DIST / src.lstrip("./")
        if not asset.exists():
            return match.group(0)
        code = asset.read_text(encoding="utf-8")
        # Vite emits the entry chunk importing the shared chunk by relative
        # path. Both are inlined, so strip those imports and concatenate.
        return f"<script>\n{code}\n</script>"

    scripts = re.findall(r'<script[^>]*src="([^"]+)"[^>]*>\s*</script>', html)
    local = [name for name in scripts if not name.startswith("http")]
    if len(local) != 1:
        raise SystemExit(
            f"expected exactly one local script to inline, found {len(local)}: "
            f"{local}. The standalone build must be a single chunk."
        )
    # Vite places an IIFE entry tag in <head>, where #root does not exist yet.
    # Remove the tag wherever it is and re-add the code immediately before
    # </body> so the DOM is ready when it runs.
    bundle_code = (DIST / local[0].lstrip("./")).read_text(encoding="utf-8")
    html = re.sub(r'<script[^>]*src="[^"]+"[^>]*>\s*</script>', "", html)

    # Drop modulepreload hints: the files they point at no longer exist.
    html = re.sub(r'<link[^>]+rel="modulepreload"[^>]*>', "", html)

    payload = json.dumps(bundle, separators=(",", ":"), ensure_ascii=False)
    # </script> inside JSON would terminate the block early.
    payload = payload.replace("</", "<\\/")
    data_script = (
        '<script id="league-data" type="application/json">' + payload + "</script>\n"
        "<script>window.__LEAGUE_DATA__ = JSON.parse("
        'document.getElementById("league-data").textContent);</script>'
    )
    # Datasets go in <head> so they are parsed before the app starts.
    html = html.replace("</head>", data_script + "\n</head>", 1)
    app_script = "<script>\n" + bundle_code + "\n</script>"
    if "</body>" not in html:
        raise SystemExit("index.html has no </body> to append the app script to")
    html = html.replace("</body>", app_script + "\n</body>", 1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=str(REPO / "web" / "standalone" / "index.html"),
        help="output HTML path",
    )
    parser.add_argument(
        "--skip",
        nargs="*",
        default=["rosters"],
        help=(
            "top-level dataset folders to leave out (default: rosters, which is "
            "half the payload and only powers per-week player highlights)"
        ),
    )
    parser.add_argument("--keep-dist", action="store_true", help="keep the intermediate build")
    args = parser.parse_args()

    run_build()
    skip = set(args.skip or [])
    bundle = collect_data(skip)
    out_path = Path(args.out)
    inline(bundle, out_path)

    if not args.keep_dist and DIST.exists():
        shutil.rmtree(DIST)

    size_mb = out_path.stat().st_size / 1_048_576
    print(f"\nwrote {out_path} ({size_mb:.1f} MB, {len(bundle)} datasets embedded)")
    if skip:
        print(f"omitted: {', '.join(sorted(skip))}")
    if size_mb > SIZE_WARN_MB:
        print(
            f"warning: {size_mb:.1f} MB is large for a single page. Consider "
            "--skip rosters drafts to trim it."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
