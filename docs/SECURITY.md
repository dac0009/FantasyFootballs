# Security

This repository is public. The ESPN cookies it uses are a working login session for an ESPN
account, so they are treated as secrets throughout.

## The rules

1. `SWID` and `ESPN_S2` exist **only** in GitHub repository secrets and in a local `.env` that
   git ignores. They appear in no tracked file, ever.
2. The browser never receives them. The website is static files reading pre-generated JSON; it
   has no code path that talks to ESPN.
3. Raw ESPN responses are cached in `.cache/`, which is gitignored. They contain fields the
   public datasets deliberately omit.
4. `pipeline.config.Credentials.__repr__` reports only whether credentials are present, so an
   unhandled exception cannot print them into an Actions log.
5. ESPN member GUIDs are never published. See below.

## Why member GUIDs are hashed

ESPN identifies each league member with a GUID in the `members[].id` field. **That value is the
same as that person's `SWID`** — their session identifier. Publishing it would expose every
league member's ESPN account identifier on a public website.

The pipeline therefore publishes a salted SHA-256 hash, truncated to 12 characters, as
`member_hash`. It is stable across runs, so owner history stays linked, and it is not useful to
anyone reading the files.

Three layers enforce this:

- `pipeline/owners.py` only ever emits the hash.
- `tests/test_owners.py::TestPrivacy` and
  `tests/test_pipeline_integration.py::TestPublishing::test_no_espn_guid_leaks_into_published_files`
  fail if a GUID-shaped string appears anywhere in the output.
- The refresh workflow greps `data/` for GUID-shaped strings and for the `ESPN_S2` value before
  committing, and fails the run if either is found.

## Refreshing expired cookies

ESPN sessions last weeks to months, and logging out of ESPN invalidates them immediately. When
the scheduled run starts failing with `AuthError`:

1. Log in at <https://fantasy.espn.com>.
2. `F12` → **Application**/**Storage** → **Cookies** → `https://fantasy.espn.com`.
3. Copy `SWID` (with braces) and `espn_s2`.
4. GitHub → **Settings** → **Secrets and variables** → **Actions** → update both secrets.
5. Re-run the **Refresh ESPN data** workflow.

Published data stays live and correct while the cookies are stale — the pipeline fails loudly
rather than publishing nothing.

## If credentials have leaked

This happened in this repository's own history: commits `53ba17d`, `d0c6c84` and `4168550`
contained a live `SWID` and `ESPN_S2` in `New Notebook.ipynb`. If you are reading this and it
has not been dealt with:

1. **Invalidate the session first.** On ESPN, sign out of all devices, then sign back in. This
   is the only step that actually stops the leaked cookie working. Do it before anything else —
   rewriting git history does not help while the token is still valid.
2. **Remove it from history.** Force-pushing a fix is not enough; the old blobs stay reachable
   by their SHA. Either recreate the repository, or:
   ```bash
   git checkout --orphan clean-main
   git add -A && git commit -m "Rebuild repository without credential history"
   git branch -D main && git branch -m main
   git push --force origin main
   ```
   For a surgical rewrite instead, `git filter-repo --path "New Notebook.ipynb" --invert-paths`.
3. **Ask GitHub Support to purge cached views**, since old commits remain accessible by SHA
   through the web interface even after a force push.
4. **Re-check for other leaks.** The same notebook also contained a local filesystem path
   exposing a Windows username.

## Keeping notebooks safe

Notebook *output* is as dangerous as notebook source: a saved ESPN response contains every
member GUID in the league. `scripts/scrub_notebook.py` strips all outputs and redacts anything
cookie-shaped:

```bash
python scripts/scrub_notebook.py notebooks/archive/*.ipynb
```

Run it before committing any notebook. The archived notebook in this repository has already been
through it.
