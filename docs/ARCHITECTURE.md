# Architecture

## The shape

```
ESPN API  ->  Python pipeline  ->  data/*.json  ->  static site  ->  GitHub Pages
```

Three properties follow from this and all three were requirements:

- **The site can be fully public** without exposing ESPN credentials, because the credentials
  only ever exist inside a GitHub Actions runner.
- **Hosting is free and trivial.** The output is a folder of files.
- **Statistics are reproducible and debuggable.** Every number on the site exists in a JSON file
  you can open, which means "this looks wrong" is an investigable claim.

## Decisions, and what was rejected

### Static site, not a server

Rejected: a small API in front of ESPN. It would require hosting, caching, rate-limit handling,
and it would put credentials in a place that serves public traffic. Nothing on this site needs
to be fresher than weekly, so there is no benefit to pay for.

### GitHub Pages, not Vercel/Cloudflare/Render

GitHub Pages creates no real constraint here. The full dataset is **about 0.5 MB gzipped**, and
individual pages load 4–30 KB each. The two things Pages cannot do are server-side rendering
(irrelevant — this is a logged-in-free data browser, not a content site needing SEO) and URL
rewrites. The second is handled with the standard `404.html` bounce described in the README.

If the project later needed redirects, edge functions, or preview deployments per pull request,
Cloudflare Pages would be the natural move: same build output, same base-path handling, no code
change beyond `BASE_PATH`.

### All statistics in Python, none in the browser

The frontend formats and charts; it does not compute. This was explicit in the brief and it is
also what makes the test suite meaningful: a statistical function that runs in the pipeline can
be unit-tested against hand-calculated values, whereas the same logic spread through React
components cannot.

### Two Python dependencies

`requests` and `PyYAML`, nothing else. No pandas.

A job that runs unattended every Tuesday should have the smallest possible dependency surface,
and the statistical functions are clearer and far easier to test operating on lists of plain
dicts — the same shape they have in JSON — than on DataFrames. The original notebook's pandas
`groupby` chains are exactly where its bugs were.

I did briefly write a hand-rolled YAML parser to get to a single dependency, and threw it away.
A bespoke parser in the path of "never publish corrupted data" is a liability, not a saving.

### Compute everything, validate, then write

`build.py` holds the entire dataset in memory, runs validation, and only then touches `data/`.
A failed or partial run leaves the previously published data exactly as it was.

### The regression guard

The single most important safety feature. Expired ESPN cookies do not always produce a clean
401 — sometimes you get a 200 with a structurally valid but hollow body. Naively that publishes
an empty league over eight years of history.

So `validate.check_no_regression` compares the new dataset's counts against `data/meta.json`
from the previous run and **errors** if completed games, team-weeks, owners or seasons would
decrease. Overriding it requires `--allow-shrink` explicitly.

### Owners as the primary key

See the README section on owner identity. The short version: ESPN member GUIDs are stable
across seasons, team names are not, and the original notebook's `groupby("Team")` silently split
careers in half. Everything career- or all-time-scoped keys on `owner_id`.

### Regular season as the default scope

Records, rate statistics and all-play default to regular-season games only. A 12-team league's
consolation ladder mixed into a career win percentage produces a number nobody can interpret.
Playoff and consolation games are classified separately and surfaced on their own, and the
record book offers an explicit "All games" scope.

### A synthetic league in ESPN's response shape

`pipeline/sample.py` emits payloads shaped like ESPN's, not normalized rows. That costs more
code but means running it exercises the real `extract.py` path — matchup classification, owner
resolution, bye handling, tie handling. A bug there shows up in the sample build.

It also deliberately includes the awkward cases: a league that grew from 10 to 12 teams, owners
joining and leaving, renames almost every year, one tie, playoff byes, and a current season
that is only partly played.

## Data volume

| File | Raw | Gzipped |
|---|---|---|
| Everything | 6.6 MB | ~0.5 MB |
| `current.json` (homepage) | 28 KB | 4 KB |
| `seasons/2024.json` | 175 KB | 16 KB |
| `rosters/2024.json` | 410 KB | 31 KB |

Per-season and per-owner files are separate so nothing large loads until a page needs it. The
record book, rosters and drafts are the big files and most visits never request them.

## Testing strategy

Two layers:

**Unit tests** on each statistical function, with expected values worked out by hand in the test
docstring, so a failure identifies which definition changed.

**Invariant tests** over the whole generated dataset — properties that must hold for any correct
league, which is what catches the subtle errors:

- league-wide points for equals points against
- wins equal losses
- schedule luck sums to zero in every season
- expected wins sum to actual wins
- championships are conserved (one per completed season)
- every team-week has a mirror with the scores swapped
- career totals equal the sum of the season rows
- starter points reconcile to team scores
- no NaN or GUID reaches any published file

Every one of these would have failed against the original notebook's output.
