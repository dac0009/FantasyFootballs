# Publishing a recap

## The normal way: Google Docs

Write the recap in Google Docs. When it is ready:

1. In the Doc: **Share → General access → Anyone with the link** (Viewer).
   Copy the link.
2. On the site, signed in as commissioner, open **Recaps** and click
   **Add a recap from Google Docs**. Paste the link, type the week, save.

That is all. The issue appears in the archive at once, readers get it in the
browser with a **Download PDF** button that always exports the current Doc,
and **editing the Doc edits the site** — no upload, no commit, no deploy.

Next week: *File → Make a copy* of the last issue, write, share, paste.

To change the headline or summary shown in the archive, open the same form and
use **Details** on the issue. **Remove** takes it out of the archive without
touching the Doc.

## The other way: drop a PDF here

Put a PDF in this folder (on GitHub: **Add file → Upload files**, commit). The
next deploy reads season and week from the filename, pulls the headline and
date off the first page, renders a cover thumbnail, and adds it to the archive.

    FFBFFL_2026_Week_7_Recap.pdf
    FFBFFL_2026_Weeks_8_and_9_Recap.pdf

Corrections to a PDF's title, summary or date go in `issues.json`, keyed by the
slug shown in the site's URL. A `.docx` with the same name adds a Word download.

If a Google Doc and a PDF cover the same week, the Doc is shown.

`archive.json` is generated. Do not edit it.
