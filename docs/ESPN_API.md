# ESPN Fantasy Football API notes

Undocumented, unversioned, and inconsistent across seasons. These are the observations the
pipeline is built on. Verify them against your own league with:

```bash
python -m pipeline probe --out probe-report.json
```

## Endpoints

**Current and historical seasons** (works for every season the authenticated account can see —
confirmed for 2019–2026 on league 61253603):

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{leagueId}
```

**Completed-season fallback** — returns a *list* rather than an object:

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/{leagueId}?seasonId={year}
```

`espn_client.py` tries the first and falls back to the second on a 404, unwrapping the list
either way. Which one answered is reported as `endpoint` so a probe run shows the difference.

## Authentication

Two cookies, `SWID` and `espn_s2`. A private league returns 401 or 403 without them.

The failure mode that matters: an expired cookie does not always produce a clean 401. Sometimes
ESPN returns **HTTP 200 with an HTML login page**, and sometimes a structurally valid but hollow
JSON body. The client raises a distinct `AuthError` on 401/403 and on a non-JSON body, and the
pipeline's regression guard catches the hollow-body case.

## Views

Passed as repeated `view` query parameters. Several can be combined in one request.

| View | Returns | Reliability |
|---|---|---|
| `mTeam` | `teams[]` and `members[]` — ids, names, owners, records, logos, seeds, final rank | High, all seasons |
| `mMatchupScore` | `schedule[]` with scores and winners | High, all seasons |
| `mSettings` | Schedule length, playoff format, roster slots, scoring type | High |
| `mStatus` | Current matchup period, latest scoring period, `previousSeasons` | High |
| `mRoster` | Current rosters | Current season |
| `mBoxscore` | Per-week lineups and player scores — **needs `scoringPeriodId`** | **Varies by season.** Often unavailable for older seasons |
| `mDraftDetail` | `draftDetail.picks[]` | Usually available; confirm per season |
| `mTransactions2` | Adds, drops, waivers, trades — needs an `x-fantasy-filter` header | **Low.** Frequently empty historically |
| `kona_player_info` | Player metadata by id, via `x-fantasy-filter` | Used only to resolve drafted-then-dropped players |

## Field notes that cost time to work out

**`settings.scheduleSettings.matchupPeriodCount` is the regular-season length**, not the total
number of weeks. Playoff matchup periods are numbered after it. Getting this wrong means
playoff games get counted as regular-season games — which is exactly what the original notebook
did.

**Team names moved fields.** Older seasons use `location` + `nickname`; newer ones use a single
`name`. `owners.team_display_name` tries `name`, then `location + nickname`, then `abbrev`, then
`Team {id}`.

**`winner`** is `HOME`, `AWAY`, `TIE`, `UNDECIDED`, or `BYE`. Only the first three are completed
games. `UNDECIDED` is how future games appear, and filtering on it is essential.

**Playoff byes** appear as schedule entries with only a `home` side. They are not games.

**`playoffTierType`** is `NONE`, `WINNERS_BRACKET`, `LOSERS_CONSOLATION_LADDER` or
`WINNERS_CONSOLATION_LADDER`. In older seasons it can be missing entirely, which is why
classification falls back to playoff seeds.

**Multi-week playoff matchups.** When `playoffMatchupPeriodLength > 1`, one matchup period spans
two scoring periods. `totalPoints` is the accumulated total, which is what decided the game, so
that is what is used. `pointsByScoringPeriod` holds the split if you need it.

**`team_id` is reused across seasons** and is not stable as an identity. Use `members[].id`,
which is. (And see `docs/SECURITY.md` — that value is the member's SWID and must not be
published.)

**Player scores in `mBoxscore`.** The actual score is
`entry.playerPoolEntry.appliedStatTotal`. Projections require scanning
`player.stats[]` for `statSourceId == 1`, `statSplitTypeId == 1`, and the matching
`scoringPeriodId`. `statSourceId == 0` is actual.

**Lineup slots.** `20` is bench, `21` is IR; everything else is a starter. The id-to-name and
id-to-eligibility maps are in `pipeline/constants.py`.

**No forward projections.** ESPN publishes projected team totals only while a week is live, and
not for future weeks or historically. Any feature claiming to project a future matchup from ESPN
data is fabricating it. See the Game of the Week section in `docs/METRICS.md` for what this
project does instead.

## Etiquette

The client throttles to roughly 2.5 requests per second, retries 429 and 5xx with exponential
backoff and jitter, sends a descriptive User-Agent, and caches every raw response in `.cache/`
so reruns and local development cost ESPN nothing.
