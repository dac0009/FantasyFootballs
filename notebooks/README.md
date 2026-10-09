# Archived exploratory work

`archive/2026-10-espn-exploration.ipynb` is the original notebook this project grew out of. It
is kept for one reason: it is the record of how the working ESPN endpoints and views were
discovered, and `python -m pipeline probe` is the direct descendant of its season-by-season
status checks.

**It has been sanitised.** The live `SWID` and `ESPN_S2` values it contained are redacted, and
every saved output has been stripped — ESPN responses include member GUIDs, which must not be
published (see `../docs/SECURITY.md`). It went from 1.8 MB to 56 KB in the process.

**It is not production code and should not be run as-is.** Its statistics contain known errors
that the pipeline fixes:

- aggregating by team name, which splits an owner's career in half whenever they rename
- capturing `playoffTierType` but never using it, so playoff and consolation games are mixed
  into regular-season records
- never reading `matchupPeriodCount`, so there is no regular-season boundary
- population rather than sample standard deviation, and `0` reported for a single game
- no handling of ties, byes, or duplicate schedule entries

The working equivalents live in `pipeline/metrics.py` and `pipeline/records.py`, with tests.

If you want to explore interactively, work against the published datasets instead — no
credentials needed:

```python
import json
team_weeks = json.load(open("data/team_weeks.json"))
owners = json.load(open("data/owners.json"))
```

Before committing any new notebook, run:

```bash
python scripts/scrub_notebook.py notebooks/**/*.ipynb
```
