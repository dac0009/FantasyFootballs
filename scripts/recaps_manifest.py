#!/usr/bin/env python3
"""Build the recap archive from whatever PDFs are in web/public/recaps.

Publishing an issue is: put the PDF in that folder. This script does the rest,
and the deploy workflow runs it before every build:

  * reads season and week from the filename  (FFBFFL_2026_Week_7_Recap.pdf)
  * pulls the headline and date off the PDF's first page
  * renders a cover thumbnail if one is not there already
  * notices a .docx with the same name
  * applies any hand corrections from issues.json
  * writes index.json, which the site reads

It never fails the build: a PDF it cannot read still gets a plain entry.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECAPS = ROOT / "web" / "public" / "recaps"
OVERRIDES = RECAPS / "issues.json"
# Not index.json: GitHub Pages would serve that as the directory index for
# /recaps/, hijacking the archive route before the app could load.
OUT = RECAPS / "archive.json"

try:
    import fitz  # PyMuPDF
except ImportError:  # covers and headlines are skipped, the manifest still builds
    fitz = None

SEASON_RE = re.compile(r"\b(20\d{2})\b")
# "Week 7", "Weeks 5 and 6", "weeks-5-6", "Wk 3". A second number only counts
# when it directly follows (with or without "and"), so a trailing year is safe.
WEEK_RE = re.compile(
    r"\bw(?:ee)?ks?[\s_.-]*(\d{1,2})\b(?:[\s_.-]*(?:and|&|\+|to)?[\s_.-]*(\d{1,2})\b)?", re.I
)
MONTHS = ("January|February|March|April|May|June|July|August|September|October|November|December")
DATE_RE = re.compile(rf"\b({MONTHS})\s+(?:(\d{{1,2}})(?:st|nd|rd|th)?,?\s+)?(20\d{{2}})\b")
LABELS = [
    ("preseason", "Preseason preview"), ("preview", "Preseason preview"),
    ("draft", "Draft issue"), ("playoff", "Playoffs"), ("champ", "Championship"),
]


def parse_name(stem: str) -> tuple[int | None, list[int], str | None]:
    text = stem.replace("_", " ")
    season = int(m.group(1)) if (m := SEASON_RE.search(text)) else None
    weeks: list[int] = []
    if m := WEEK_RE.search(text):
        weeks = [int(m.group(1))] + ([int(m.group(2))] if m.group(2) else [])
    label = None
    if not weeks:
        low = text.lower()
        label = next((name for key, name in LABELS if key in low), None)
    return season, weeks, label


def slug_for(stem: str, season: int | None, weeks: list[int]) -> str:
    if season and weeks:
        part = f"week-{weeks[0]}" if len(weeks) == 1 else "weeks-" + "-".join(map(str, weeks))
        return f"ffbffl-{season}-{part}"
    base = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return base if base.startswith("ffbffl") else f"ffbffl-{base}"


def titlecase(text: str) -> str:
    if not text.isupper():
        return text
    small = {"a", "an", "and", "the", "of", "to", "in", "on", "at", "for", "or", "it", "is"}
    words = text.lower().split()
    out = [w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words)]
    return " ".join(out)


def read_page_one(pdf: Path) -> tuple[str, str | None, int]:
    """Headline guess, printed date, page count. Empty values when unreadable."""
    if fitz is None:
        return "", None, 0
    doc = fitz.open(pdf)
    page = doc[0]
    best_size, best_text = 0.0, ""
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(s.get("text", "") for s in spans).strip()
            size = max((float(s.get("size", 0)) for s in spans), default=0.0)
            if len(text) < 4 or not re.search(r"[a-z]", text, re.I):
                continue
            if re.fullmatch(r"(?i)f\s*f\s*b\s*f\s*f\s*l", text):
                continue
            if size > best_size:
                best_size, best_text = size, text
    plain = page.get_text()
    date = None
    if m := DATE_RE.search(plain):
        month, day, year = m.groups()
        date = f"{month} {int(day)}, {year}" if day else f"{month} {year}"
    return titlecase(best_text), date, doc.page_count


def ensure_cover(pdf: Path, slug: str) -> str | None:
    cover = RECAPS / f"{slug}-cover.png"
    if cover.exists():
        return cover.name
    if fitz is None:
        return None
    try:
        fitz.open(pdf)[0].get_pixmap(dpi=58).save(cover)
        return cover.name
    except Exception as error:  # a bad cover should not block the issue
        print(f"  cover failed for {pdf.name}: {error}", file=sys.stderr)
        return None


def find_docx(pdf: Path, slug: str) -> str | None:
    for candidate in (RECAPS / f"{slug}.docx", pdf.with_suffix(".docx")):
        if candidate.exists():
            return candidate.name
    return None


def build() -> list[dict]:
    overrides: dict[str, dict] = {}
    if OVERRIDES.exists():
        try:
            overrides = json.loads(OVERRIDES.read_text())
        except json.JSONDecodeError as error:
            print(f"issues.json is not valid JSON, ignoring it: {error}", file=sys.stderr)

    issues = []
    for pdf in sorted(RECAPS.glob("*.pdf")):
        stem = pdf.stem
        season, weeks, label = parse_name(stem)
        slug = slug_for(stem, season, weeks)
        try:
            headline, date, pages = read_page_one(pdf)
        except Exception as error:
            print(f"  could not read {pdf.name}: {error}", file=sys.stderr)
            headline, date, pages = "", None, 0

        issue = {
            "slug": slug,
            "season": season or dt.date.today().year,
            "weeks": weeks,
            "title": headline or (f"Week {' & '.join(map(str, weeks))}" if weeks else stem),
            "dek": "",
            "dateLabel": date,
            "label": label,
            "pdf": pdf.name,
            "cover": ensure_cover(pdf, slug),
            "docx": find_docx(pdf, slug),
            "pages": pages,
        }
        for key, value in overrides.get(slug, {}).items():
            if key in issue and value not in (None, ""):
                issue[key] = value
        issues.append(issue)
        print(f"  {slug:34} {issue['title']}")

    last_week = lambda i: i["weeks"][-1] if i["weeks"] else 0  # noqa: E731
    issues.sort(key=lambda i: (-i["season"], -last_week(i)))
    return issues


def main() -> int:
    RECAPS.mkdir(parents=True, exist_ok=True)
    print(f"Building recap archive from {RECAPS.relative_to(ROOT)}")
    if fitz is None:
        print("  PyMuPDF not installed: skipping covers and headlines (pip install pymupdf)")
    issues = build()
    OUT.write_text(json.dumps({
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "issues": issues,
    }, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(issues)} issues to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
