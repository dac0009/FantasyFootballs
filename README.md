# FFBFFL Archive

The permanent record book and analytics site for our ESPN fantasy football league, covering
every season from 2019 onward.

**Live site:** https://dac0009.github.io/FantasyFootballs/

---

## Read this first if you have just cloned the repo

The old version of this repository contained live ESPN login cookies in a notebook. **If you
have not already rotated them, do that now** — see [docs/SECURITY.md](docs/SECURITY.md#if-credentials-have-leaked).
Everything else here can wait.

---

## What this is

Two pieces that barely know about each other:

1. **A Python pipeline** that logs into ESPN, downloads the league's entire history, works out
   every statistic, checks the results, and saves them as a set of plain `.json` files in the
   `data/` folder.
2. **A website** that reads those `.json` files and draws tables and charts. It does no maths of
   its own, and it never talks to ESPN.

That separation is the whole design. It means the public site can never leak your ESPN login,
it works as a plain folder of files (so free GitHub Pages hosting is enough), and if a number
looks wrong you can open the relevant `.json` file and see it.

### What the site contains

| Section | What's in it |
|---|---|
| This week | What just happened, who scored most, the Game of the Week, standings |
| Season | Current-season analytics: all-play, expected wins, schedule luck, consistency |
| Archive | Every season rebuilt: standings, brackets, champions, week-by-week |
| Records | All-time record book — single game, season, career, players |
| Owners | A profile per person: career record, every team name they've used, highs and lows |
| Head to head | Any two owners, their full series history and a rivalry page |
| Drafts | Draft boards for each season ESPN still has |
| Methodology | Every custom statistic defined, with its formula and its limitations |

---

## How the data flows

```
         ESPN Fantasy API
                 |
                 |  SWID + ESPN_S2 cookies (GitHub Secrets only)
                 v
      pipeline/espn_client.py        fetch, retry, cache raw responses
                 |
                 v
      pipeline/extract.py            flatten ESPN's nested JSON into rows
      pipeline/owners.py             work out WHO owned each team
                 |
                 v
      pipeline/metrics.py            all-play, expected wins, luck, SOS...
      pipeline/records.py            the record book
      pipeline/head_to_head.py       rivalries
      pipeline/gotw.py               Game of the Week
                 |
                 v
      pipeline/validate.py           refuse to publish broken or shrinking data
                 |
                 v
            data/*.json              public, safe, no credentials
                 |
                 v
          web/  (React + Vite)       tables and charts only
                 |
                 v
           GitHub Pages              static files, fully public
```

The important part is `validate.py`. Expired ESPN cookies sometimes return a *successful* but
empty response, which would otherwise wipe out good data. The pipeline computes everything in
memory first, and refuses to write anything if the new dataset would contain fewer completed
games than the last one. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning.

---

## Setting up ESPN credentials

The pipeline needs two browser cookies from your ESPN account. They are not passwords, but they
*are* a working login session, so treat them like one.

### Getting them

1. Log in at <https://fantasy.espn.com> in Chrome or Firefox.
2. Press `F12` to open developer tools.
3. Go to **Application** (Chrome) or **Storage** (Firefox) → **Cookies** → `https://fantasy.espn.com`.
4. Find these two rows and copy their values:
   - `SWID` — looks like `{1A2B3C4D-5E6F-...}`, braces included
   - `espn_s2` — a very long string of letters, numbers and `%` signs

### Storing them for GitHub (this is what the automation uses)

1. In this repository on GitHub: **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**, twice:
   - Name `SWID`, value the SWID cookie
   - Name `ESPN_S2`, value the espn_s2 cookie
3. That's it. Secrets are write-only — GitHub will never show them again, and they are not
   visible to anyone who forks or reads the repository.

### Storing them for your own computer (only if you want to run it locally)

```bash
cp .env.example .env
# open .env in a text editor and paste the two values
```

`.env` is in `.gitignore`, so git will not commit it. **Never** put these values in
`config/league.yml`, a notebook, or any file that gets committed.

---

## Running it yourself

You need Python 3.11+ and Node 20+.

```bash
# one-time setup
pip install -r requirements-dev.txt
cd web && npm install && cd ..
```

### Refresh the data from ESPN

```bash
python -m pipeline refresh
```

Useful variations:

```bash
python -m pipeline refresh --season 2026          # just one season
python -m pipeline refresh --no-cache             # ignore cached responses, refetch everything
python -m pipeline refresh --skip-rosters         # much faster; skips per-week lineup data
python -m pipeline inspect                        # summarise what is currently in data/
python -m pipeline owners                         # show the owner identity map
python -m pipeline probe                          # report what ESPN exposes, season by season
```

### Look at the site locally

```bash
cd web
npm run dev
```

Then open the address it prints (usually <http://localhost:5173/FantasyFootballs/>). It reads
straight from the `data/` folder, so re-running the pipeline and refreshing the page is enough
to see new numbers.

### Work without ESPN credentials

```bash
python -m pipeline sample
```

This generates a complete fictional 8-season league and writes it to `data/`. Every page works,
and the site shows a banner saying the data is not real. It's how you can develop or review the
site without touching ESPN, and the committed `data/` folder starts out this way.

### Build it as one self-contained file

```bash
python scripts/build_single_file.py
```

Produces `web/standalone/index.html`: the entire site, with the data baked in,
as a single file with no external dependencies. Useful for previewing before
deploying, emailing to a league member, or keeping a frozen snapshot of a season.
It opens by double-clicking, works offline, and routes on the URL hash.

Rosters are left out by default because they are half the payload and only power
per-week player highlights; use `--skip` to control that, e.g.
`--skip rosters drafts` to trim further, or `--skip` with no values to include
everything.

### Run the tests

```bash
python -m pytest tests -q      # 144 tests, mostly statistical correctness
ruff check pipeline tests      # style
cd web && npm run build        # typecheck + build the site
```

---

## The automatic Tuesday update

**What happens:** every Tuesday at 6:00 AM Eastern, GitHub downloads fresh data from ESPN,
validates it, commits it, and rebuilds the website. You don't have to do anything.

**Why there are two schedules in the workflow file:** GitHub's scheduler only understands UTC
and knows nothing about daylight saving. 6 AM in New York is 11:00 UTC in winter and 10:00 UTC
in summer. So `.github/workflows/update-data.yml` schedules *both* hours, and the first step
checks the real local time:

```bash
LOCAL_HOUR=$(TZ="America/New_York" date +%-H)
```

If it isn't the 6 AM hour locally, that run stops immediately. Exactly one of the two fires
properly each week, year-round, with no changes needed when the clocks move.

### Running it by hand

GitHub → **Actions** tab → **Refresh ESPN data** → **Run workflow**. You can optionally limit it
to particular seasons or skip the slow lineup data. A manual run skips the time check.

### What it does in order

1. Check the local time (unless you triggered it manually).
2. Run the full test suite — if the maths is broken, nothing gets published.
3. Check that `SWID` and `ESPN_S2` secrets exist, and fail with a clear message if not.
4. Pull every season from ESPN.
5. Validate: team counts, no null scores, sensible weeks, no duplicate matchups, every team
   linked to an owner, and a cross-check of our point totals against ESPN's own.
6. Refuse to publish if the dataset would shrink.
7. Scan the generated files for anything credential-shaped, as a backstop.
8. Commit `data/` and rebuild the site.

---

## Deploying to GitHub Pages

This only needs doing once:

1. GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**. (Not "Deploy from a
   branch" — this project builds the site in Actions.)
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow by hand.

The site is served from `https://<user>.github.io/<repo>/`, so every link has to include the
repository name. That is handled automatically: the deploy workflow passes the repository name
in as the base path, so renaming the repo or forking it needs no code change.

GitHub Pages has no concept of an app that handles its own URLs, so visiting a deep link like
`/owners/avery-lind` directly would normally 404. `web/public/404.html` catches that, encodes
the path, and bounces to the app, which restores the real URL before anything renders. You'll
see a brief flicker on a direct deep link; normal clicking around is unaffected.

---

## When something goes wrong

### A workflow failed

Actions tab → click the failed run → click the red step. The pipeline tries to fail with an
explanation rather than a stack trace.

| Message | What it means | Fix |
|---|---|---|
| `ESPN rejected the request with HTTP 401/403` | Your cookies expired | Get new ones and update the secrets (below) |
| `SWID and/or ESPN_S2 repository secrets are missing` | Secrets were never added, or the names are misspelled | Re-add them; names are case-sensitive |
| `published dataset would shrink` | The ESPN pull partly failed. **Your existing data is untouched** | Re-run the workflow. If it is genuinely correct, re-run with "Allow publishing a SMALLER dataset" ticked |
| `ESPN returned a non-JSON body` | ESPN served a login page — an auth problem wearing a disguise | Refresh the cookies |
| `season N: ESPN returned no teams` | ESPN has nothing for that season | Usually a brand-new season before the draft; it will resolve itself |
| `data/meta.json is missing` | Trying to deploy with no data | Run the refresh workflow, or commit sample data |
| `teams without a resolved owner` | A team has no ESPN account attached | See "owner identity" below |

### ESPN cookies have expired

They last a few weeks to a few months, and logging out of ESPN invalidates them immediately.
When the Tuesday job starts failing with a 401 or 403, get fresh cookie values as described
above and update the two repository secrets. Nothing else needs to change, and the existing
published data stays live in the meantime.

### Finding out what ESPN will actually give you

```bash
python -m pipeline probe --out probe-report.json
```

This walks every season and every ESPN view and prints what came back. Use it before assuming a
feature is impossible — ESPN's coverage of lineups, drafts and transactions varies a lot by
season. Details in [docs/ESPN_API.md](docs/ESPN_API.md).

---

## How owner identity works

**This is the most important modelling decision in the project.** Team names change constantly.
The same person might be "4 for4" for four years and then "Bring Back The 4 for 4". If records
were tracked by team name, that person's career would be split in two and every all-time list
would be wrong.

So: **people are the permanent identity, teams are not.**

ESPN gives every member account a GUID that stays the same across every season of the league.
That is what the pipeline keys on, which means **a team rename needs no configuration at all** —
it is handled automatically.

Each owner gets:

- a stable URL like `/owners/avery-lind`
- a career record aggregated across every team name they've used
- a timeline showing exactly what they were called each season

Historical pages always show the team name as it was *that season*, never the current one.

### The three cases that need a manual nudge

Run `python -m pipeline owners` to see the current map, then edit `config/owners.yml`:

```yaml
owners:
  # 1. Someone rebuilt their ESPN account and now has two GUIDs
  - owner_id: jane-doe
    name: Jane Doe
    espn_member_ids:
      - "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"
      - "{11111111-2222-3333-4444-555555555555}"

  # 2. ESPN's display name is unhelpful and you want a real one
  - owner_id: mike-smith
    name: Mike Smith
    espn_member_ids: ["{99999999-8888-7777-6666-555555555555}"]
```

The third case is a team ESPN never attached to an account. Those show up as owners called
`unlinked-<season>-<team>`, the validator warns about them, and the Owners page lists them
separately. Add their GUID to a real owner to merge the history.

### A privacy note

An ESPN member GUID is the same value as that person's `SWID` — i.e. their session identifier.
The published datasets therefore contain only a one-way hash of it, never the GUID itself. There
is a test that fails if anything GUID-shaped ever reaches `data/`, and the refresh workflow
checks again before committing.

---

## Adding a new statistic

The pattern is the same every time, and the Python layer does all the work:

1. **Write the function** in `pipeline/metrics.py`. It takes `team_week` rows (one per team per
   game) and returns a dict keyed by `owner_id`. Document the formula *and the limitations* in
   the docstring — this is a hard rule in this project.
2. **Write a test** in `tests/test_metrics.py` with hand-calculated expected values, so a
   failure tells you which definition changed rather than just that a number moved.
3. **Merge it into the output** in `pipeline/transform.py` (`build_standings` for per-season,
   `build_careers` for all-time).
4. **Add the type** in `web/src/lib/types.ts`.
5. **Add a definition** to `web/src/lib/metricDefinitions.ts`. It then appears automatically on
   the Methodology page and in the tooltip wherever you use `<Metric name="your_metric" />`.
6. **Show it** — usually one more entry in the column list in
   `web/src/components/StandingsTable.tsx`.

Then `python -m pipeline sample && cd web && npm run dev` to see it.

---

## Repository layout

```
config/           league settings and owner overrides (no secrets)
pipeline/         the Python data pipeline
  espn_client.py    talking to ESPN: retries, fallbacks, caching
  extract.py        ESPN's nested JSON -> flat rows
  owners.py         owner identity across renames
  metrics.py        the statistical engine
  records.py        the record book
  head_to_head.py   rivalries
  gotw.py           Game of the Week model
  transform.py      assembling the public payloads
  validate.py       the gate before anything is published
  build.py          orchestration
  sample.py         fictional league, in ESPN's own response shape
  cli.py            the command line interface
data/             generated public datasets (committed, safe to read)
web/              the website (React + Vite + TypeScript)
tests/            144 tests, mostly about statistical correctness
docs/             architecture, data model, metrics, security, ESPN API notes
notebooks/        the original exploratory notebook, archived and sanitised
scripts/          maintenance utilities
```

### The leftover ArcGIS files

This repository began as an ArcGIS Pro workspace, and `MyProject.aprx`, `MyProject.gdb/`,
`ffbffl.aprx`, `MyProject.atbx` and `ImportLog/` are still from that. They have nothing to do
with the application. To remove them:

```bash
bash scripts/remove_legacy_arcgis.sh
```

The original notebook has been kept at `notebooks/archive/`, with its credentials and all of its
saved output stripped out, because the ESPN endpoint discovery in it is genuinely useful history.

---

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — why it is built this way, and what was rejected
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — every file in `data/` and every field
- [docs/METRICS.md](docs/METRICS.md) — formulas and limitations for all derived statistics
- [docs/ESPN_API.md](docs/ESPN_API.md) — which ESPN endpoints work, and which are unreliable
- [docs/SECURITY.md](docs/SECURITY.md) — credential handling and what to do about a leak
