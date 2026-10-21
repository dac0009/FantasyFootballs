# Publishing a recap

Put the PDF in this folder. That is the whole job.

On GitHub: open this folder, **Add file → Upload files**, drop the PDF,
**Commit changes**. The site rebuilds and the issue appears in the Recaps tab
a couple of minutes later, with a cover thumbnail made from its first page.

Name the file with the season and week so it sorts itself:

    FFBFFL_2026_Week_7_Recap.pdf
    FFBFFL_2026_Weeks_8_and_9_Recap.pdf
    FFBFFL_2026_Preseason_Preview.pdf

The headline is read off the first page. If it guesses wrong, or you want a
one-line summary under the title, add an entry to `issues.json` using the
slug shown in the site's URL, for example:

    "ffbffl-2026-week-7": {
      "title": "The Title You Actually Want",
      "dek": "One line that appears under it.",
      "dateLabel": "October 28, 2026"
    }

Drop a `.docx` with the same name next to the PDF and a Word download appears too.

`archive.json` is generated. Do not edit it.
