"""Sanitize a Jupyter notebook for public archival.

Removes:
  * all cell outputs (ESPN responses can contain member GUIDs / SWIDs)
  * execution counts
  * anything that looks like an ESPN auth cookie

Usage:
    python scripts/scrub_notebook.py notebooks/archive/"New Notebook.ipynb"
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# {8-4-4-4-12} GUID in braces -> SWID shape
SWID_RE = re.compile(r"\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}")
# espn_s2 is a long URL-encoded blob; match any 80+ char run of cookie-ish chars
S2_RE = re.compile(r"[A-Za-z0-9%+/=_-]{80,}")

PLACEHOLDER_SWID = "{REDACTED-SWID-SEE-DOTENV-EXAMPLE}"
PLACEHOLDER_S2 = "REDACTED_ESPN_S2_SEE_DOTENV_EXAMPLE"


def redact(text: str) -> str:
    text = SWID_RE.sub(PLACEHOLDER_SWID, text)
    return S2_RE.sub(PLACEHOLDER_S2, text)


def scrub(path: Path) -> int:
    nb = json.loads(path.read_text(encoding="utf-8"))
    hits = 0
    for cell in nb.get("cells", []):
        source = cell.get("source", [])
        new_source = []
        for line in source:
            cleaned = redact(line)
            if cleaned != line:
                hits += 1
            new_source.append(cleaned)
        cell["source"] = new_source
        if "outputs" in cell:
            if cell["outputs"]:
                hits += 1
            cell["outputs"] = []
        if "execution_count" in cell:
            cell["execution_count"] = None
    nb.setdefault("metadata", {})["scrubbed"] = True
    path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return hits


if __name__ == "__main__":
    targets = [Path(a) for a in sys.argv[1:]] or sorted(
        Path("notebooks").rglob("*.ipynb")
    )
    total = 0
    for target in targets:
        n = scrub(target)
        total += n
        print(f"scrubbed {target} ({n} redactions/outputs removed)")
    print(f"total: {total}")
    sys.exit(0)
