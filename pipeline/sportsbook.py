"""FFBucks sportsbook lines and lock times.

Writes ``data/sportsbook/lines.json``, which the separate sportsbook app reads.
Nothing here touches any other published file. The weekly step runs after the
main dataset is published and never raises, so the sportsbook can never break
a data refresh. The midweek ``locks`` command only rewrites this one file.

Line model (play money; documented so it can be argued with)
------------------------------------------------------------
Each team's expected score is the same shrunk season average the playoff
simulation uses (``playoffs.scoring_models``), nudged by recent form the same
way Game of the Week measures it (``gotw.recent_form``):

    expected = shrunk season mean + FORM_WEIGHT * form z-score * pooled sd

A multi-week playoff matchup scales the mean by the number of NFL weeks and the
spread of outcomes by its square root.

* Spread  = difference in expected scores, rounded to the nearest half point.
* Total   = sum of expected scores, rounded to the nearest half point.
  Both are priced at -110 on each side.
* Moneyline: win probability from two independent normals, then a margin
  added so the two sides add up to the same overround as -110/-110, then
  converted to American odds and rounded to the nearest 5.

Lines are posted after the Tuesday refresh and are frozen for the week: a later
run reuses the posted numbers for any matchup it has already lined.

Lock times
----------
A matchup locks at the earliest NFL kickoff among both teams' *current*
rosters (bench and IR included), using the nflverse schedule. ``python -m
pipeline locks`` recomputes only the lock times midweek, so a Thursday pickup
moves the lock earlier. A lock that has already passed is never moved, so a
locked game can't reopen. If rosters can't be read the lock falls back to the
first kickoff of that NFL week, which is the earliest it could possibly be.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import math
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import gotw, playoffs
from .config import DATA_DIR, write_json
from .constants import pro_team

log = logging.getLogger(__name__)

SCHEMA = 1
LINES_FILE = Path("sportsbook") / "lines.json"
NFLVERSE_GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
NFLVERSE_CREDIT = "NFL schedule data: nflverse (CC-BY 4.0)"
EASTERN = ZoneInfo("America/New_York")

#: How much recent form moves a team's expected score, in standard deviations
#: per unit of form z-score. 0.25 means a team scoring one sd above the league
#: over its last three weeks is expected about a quarter sd higher.
FORM_WEIGHT = 0.25
#: Standard -110 pricing for spreads and totals.
STANDARD_PRICE = -110
#: The overround of a -110/-110 market (about 4.76%), applied to moneylines.
OVERROUND = 2 * (110 / 210) - 1
PROB_FLOOR = 0.02
MAX_IMPLIED = 0.99

#: nflverse team codes that differ from ESPN's.
NFLVERSE_TO_ESPN = {"LA": "LAR", "WAS": "WSH", "STL": "LAR", "SD": "LAC", "OAK": "LV"}

ODDS_FIELDS = (
    "home_expected",
    "away_expected",
    "home_win_prob",
    "home_spread",
    "total",
    "home_ml",
    "away_ml",
    "spread_price",
    "total_price",
    "posted_at",
)
LOCK_FIELDS = ("lock_at", "lock_game", "lock_source")


# ---------------------------------------------------------------------------
# Odds math
# ---------------------------------------------------------------------------


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def round_half(value: float) -> float:
    """Nearest half point, halves rounded away from zero (6.25 -> 6.5)."""
    scaled = abs(value) * 2
    rounded = math.floor(scaled + 0.5) / 2
    return math.copysign(rounded, value) if rounded else 0.0


def american_from_probability(prob: float) -> int:
    """American odds for an implied probability, rounded to the nearest 5."""
    prob = min(max(prob, 1e-6), 1 - 1e-6)
    if prob >= 0.5:
        raw = -100 * prob / (1 - prob)
    else:
        raw = 100 * (1 - prob) / prob
    rounded = int(5 * math.floor(abs(raw) / 5 + 0.5)) * (1 if raw > 0 else -1)
    if -100 < rounded < 100:
        # -100 and +100 are the same price; nothing in between exists.
        return 100 if prob < 0.5 else -100
    return rounded


def decimal_from_american(price: int) -> float:
    if price == 0:
        raise ValueError("0 is not a valid American price")
    return 1 + (price / 100 if price > 0 else 100 / abs(price))


def moneylines(home_win_prob: float) -> tuple[int, int]:
    """(home, away) American moneylines with the house margin built in."""
    p = min(max(home_win_prob, PROB_FLOOR), 1 - PROB_FLOOR)
    home = min(p * (1 + OVERROUND), MAX_IMPLIED)
    away = min((1 - p) * (1 + OVERROUND), MAX_IMPLIED)
    return american_from_probability(home), american_from_probability(away)


# ---------------------------------------------------------------------------
# Team scoring model
# ---------------------------------------------------------------------------


def team_models(team_weeks: Sequence[dict], season: int, owners: Sequence[str]) -> dict:
    """Expected weekly score and sd per owner: shrunk season mean plus form."""
    base = playoffs.scoring_models(team_weeks, season, owners)
    form = gotw.recent_form(team_weeks, season)
    league = base["_league"]
    out: dict[str, dict] = {}
    for owner in owners:
        model = base[owner]
        z = form.get(owner, 0.0)
        out[owner] = {
            "games": model["games"],
            "season_mean": model["mean"],
            "form_z": round(z, 3),
            "expected": model["mean"] + FORM_WEIGHT * z * model["sd"],
            "sd": model["sd"],
        }
    out["_league"] = league
    return out


def price_matchup(home: dict, away: dict, periods: int = 1) -> dict:
    """Spread, total and moneylines for one matchup from two team models."""
    periods = max(1, int(periods))
    home_exp = home["expected"] * periods
    away_exp = away["expected"] * periods
    sd = home["sd"] * math.sqrt(periods)
    diff_sd = math.sqrt(2) * sd
    home_win = _normal_cdf((home_exp - away_exp) / diff_sd) if diff_sd > 0 else 0.5
    home_ml, away_ml = moneylines(home_win)
    return {
        "home_expected": round(home_exp, 2),
        "away_expected": round(away_exp, 2),
        "home_win_prob": round(home_win, 4),
        # Home team's spread: negative when home is favored (home -6.5).
        "home_spread": round_half(away_exp - home_exp),
        "total": round_half(home_exp + away_exp),
        "home_ml": home_ml,
        "away_ml": away_ml,
        "spread_price": STANDARD_PRICE,
        "total_price": STANDARD_PRICE,
    }


# ---------------------------------------------------------------------------
# NFL schedule (nflverse) and lock times
# ---------------------------------------------------------------------------


def parse_schedule(csv_text: str, season: int) -> list[dict]:
    """Kickoffs for one season from nflverse games.csv, in UTC."""
    games = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        try:
            if int(row.get("season") or 0) != season:
                continue
            week = int(row["week"])
            day = datetime.strptime(row["gameday"], "%Y-%m-%d")
        except (KeyError, TypeError, ValueError):
            continue
        clock = (row.get("gametime") or "").strip()
        try:
            hour, minute = (int(part) for part in clock.split(":")[:2])
        except ValueError:
            # Unknown kickoff time: midnight Eastern is the safe (early) choice.
            hour, minute = 0, 0
        local = day.replace(hour=hour, minute=minute, tzinfo=EASTERN)
        home = NFLVERSE_TO_ESPN.get(row.get("home_team", ""), row.get("home_team", ""))
        away = NFLVERSE_TO_ESPN.get(row.get("away_team", ""), row.get("away_team", ""))
        games.append(
            {
                "nfl_week": week,
                "kickoff": local.astimezone(UTC),
                "home": home,
                "away": away,
                "label": f"{away} @ {home}",
            }
        )
    return games


def fetch_schedule(season: int, session=None) -> list[dict]:
    import requests

    getter = session or requests
    response = getter.get(NFLVERSE_GAMES_URL, timeout=30)
    response.raise_for_status()
    games = parse_schedule(response.text, season)
    if not games:
        raise ValueError(f"nflverse schedule has no games for {season}")
    return games


def extract_current_rosters(payload: dict) -> dict[int, list[str]]:
    """NFL team code of every player on each fantasy team, from ``mRoster``."""
    out: dict[int, list[str]] = {}
    for team in payload.get("teams") or []:
        try:
            team_id = int(team.get("id"))
        except (TypeError, ValueError):
            continue
        entries = (team.get("roster") or {}).get("entries") or []
        codes = []
        for entry in entries:
            player = (entry.get("playerPoolEntry") or {}).get("player") or {}
            code = pro_team(player.get("proTeamId"))
            if code != "FA":
                codes.append(code)
        out[team_id] = codes
    return out


def _iso(moment: datetime | None) -> str | None:
    if not moment:
        return None
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_iso(text: str | None) -> datetime | None:
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def compute_lock(
    line: dict,
    schedule: Sequence[dict] | None,
    rosters: dict[int, list[str]] | None,
    now: datetime,
) -> dict:
    """Lock fields for one line. Never reopens a lock that has passed."""
    previous = _parse_iso(line.get("lock_at"))
    if previous is not None and previous <= now:
        return {k: line.get(k) for k in LOCK_FIELDS}
    if not schedule:
        if previous is not None:
            return {k: line.get(k) for k in LOCK_FIELDS}
        return {"lock_at": None, "lock_game": None, "lock_source": None}

    weeks = set(line.get("nfl_weeks") or [line["week"]])
    week_games = sorted((g for g in schedule if g["nfl_week"] in weeks), key=lambda g: g["kickoff"])
    if not week_games:
        return {"lock_at": None, "lock_game": None, "lock_source": None}

    team_ids = (line.get("home_team_id"), line.get("away_team_id"))
    have_rosters = rosters is not None and all(rosters.get(t) for t in team_ids)
    if have_rosters:
        codes = {code for t in team_ids for code in rosters[t]}
        playing = [g for g in week_games if g["home"] in codes or g["away"] in codes]
        if playing:
            first = playing[0]
            return {
                "lock_at": _iso(first["kickoff"]),
                "lock_game": first["label"],
                "lock_source": "rosters",
            }
    first = week_games[0]
    return {
        "lock_at": _iso(first["kickoff"]),
        "lock_game": first["label"],
        "lock_source": "week_start",
    }


def apply_locks(payload: dict, schedule, rosters, now: datetime) -> int:
    """Update every line's lock in place; returns how many lines changed."""
    changed = 0
    for line in payload.get("lines") or []:
        lock = compute_lock(line, schedule, rosters, now)
        if any(line.get(k) != v for k, v in lock.items()):
            changed += 1
        line.update(lock)
    if changed:
        payload["locks_updated_at"] = _iso(now)
    return changed


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------


def _season_complete(season_matchups: Sequence[dict], meta: dict) -> bool:
    games = [m for m in season_matchups if not m.get("is_bye")]
    if not games or any(not m["completed"] for m in games):
        return False
    final_period = meta.get("final_scoring_period")
    periods = meta.get("matchup_period_scoring_periods") or {}
    final_week = next(
        (int(week) for week, scoring in periods.items() if final_period in (scoring or [])),
        None,
    )
    if final_week is None:
        return False
    return max(m["week"] for m in games) >= final_week


def build_lines(assembled: dict, previous: dict | None = None, now: datetime | None = None) -> dict:
    """The week's lines, without lock times. Pure apart from the clock."""
    now = now or datetime.now(UTC)
    season = assembled["current_season"]
    current = assembled["current"]
    meta = assembled["season_data"][season]["meta"]
    owners_by_id = assembled["owners_by_id"]
    season_matchups = [m for m in assembled["matchups"] if m["season"] == season]
    week = current.get("upcoming_week")

    upcoming = [
        m
        for m in season_matchups
        if week
        and m["week"] == week
        and not m["is_bye"]
        and not m["completed"]
        and m["home_owner_id"]
        and m["away_owner_id"]
    ]
    owner_ids = sorted({o for m in upcoming for o in (m["home_owner_id"], m["away_owner_id"])})
    models = team_models(assembled["team_weeks"], season, owner_ids)
    periods = meta.get("matchup_period_scoring_periods") or {}

    previous_lines = {
        line["line_id"]: line
        for line in (previous or {}).get("lines") or []
        if (previous or {}).get("season") == season
    }

    lines = []
    for m in sorted(upcoming, key=lambda m: m["matchup_id"]):
        nfl_weeks = [int(p) for p in periods.get(str(m["week"])) or [m["week"]]]
        line = {
            "line_id": m["matchup_id"],
            "matchup_id": m["matchup_id"],
            "season": season,
            "week": m["week"],
            "nfl_weeks": nfl_weeks,
            "game_type": m["game_type"],
            "playoff_tier": m.get("playoff_tier"),
            "home_team_id": m["home_team_id"],
            "away_team_id": m["away_team_id"],
            "home_owner_id": m["home_owner_id"],
            "away_owner_id": m["away_owner_id"],
            "home_team_name": m["home_team_name"],
            "away_team_name": m["away_team_name"],
        }
        old = previous_lines.get(m["matchup_id"])
        if old and all(old.get(k) is not None for k in ODDS_FIELDS):
            # Lines are fixed for the week once posted.
            line.update({k: old[k] for k in ODDS_FIELDS})
            line.update({k: old.get(k) for k in LOCK_FIELDS})
        else:
            line.update(
                price_matchup(
                    models[m["home_owner_id"]], models[m["away_owner_id"]], len(nfl_weeks)
                )
            )
            line["posted_at"] = _iso(now)
            line.update({"lock_at": None, "lock_game": None, "lock_source": None})
        lines.append(line)

    results = [
        {
            "matchup_id": m["matchup_id"],
            "week": m["week"],
            "home_score": m["home_score"],
            "away_score": m["away_score"],
            "winner": m["winner"],
        }
        for m in sorted(season_matchups, key=lambda m: (m["week"], m["matchup_id"]))
        if m["completed"] and not m["is_bye"]
    ]

    teams = assembled["season_data"][season]["teams"]
    owners = sorted(
        (
            {
                "owner_id": t["owner_id"],
                "name": (owners_by_id.get(t["owner_id"]) or {}).get("name"),
                "team_name": t.get("team_name"),
                "team_id": t.get("team_id"),
            }
            for t in teams
            if t.get("owner_id")
        ),
        key=lambda o: o["name"] or o["owner_id"],
    )

    league = models.get("_league") or {}
    return {
        "schema": SCHEMA,
        "generated_at": _iso(now),
        "season": season,
        "week": week if lines else None,
        "season_complete": _season_complete(season_matchups, meta),
        "credit": NFLVERSE_CREDIT,
        "model": {
            "basis": "shrunk season scoring average plus recent form",
            "form_weight_sd": FORM_WEIGHT,
            "form_window_weeks": gotw.FORM_WINDOW,
            "shrinkage_games": playoffs.SHRINKAGE_GAMES,
            "league_mean": league.get("mean"),
            "pooled_sd": league.get("sd"),
            "spread_and_total_price": STANDARD_PRICE,
            "moneyline_overround": round(OVERROUND, 4),
        },
        "owners": owners,
        "lines": lines,
        "results": results,
        "locks_updated_at": (previous or {}).get("locks_updated_at"),
    }


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _fetch_rosters(client, season: int, scoring_period: int | None) -> dict[int, list[str]] | None:
    """Current rosters, always fetched fresh: a cached roster would hide a pickup."""
    saved = getattr(client, "use_cache", None)
    if saved is not None:
        client.use_cache = False
    try:
        payload = client.fetch_league(
            season,
            ["mRoster"],
            scoring_period=scoring_period,
            cache_key=f"{season}/sportsbook_rosters",
        ).payload
    finally:
        if saved is not None:
            client.use_cache = saved
    rosters = extract_current_rosters(payload)
    return rosters if any(rosters.values()) else None


def refresh(
    client,
    assembled: dict,
    data_dir: Path | None = None,
    *,
    schedule_loader=fetch_schedule,
    now: datetime | None = None,
) -> str:
    """Post the week's lines with lock times. Never raises."""
    data_dir = data_dir or DATA_DIR
    target = data_dir / LINES_FILE
    try:
        now = now or datetime.now(UTC)
        payload = build_lines(assembled, _read(target), now)
        if payload["lines"]:
            season = payload["season"]
            schedule = rosters = None
            try:
                schedule = schedule_loader(season)
            except Exception as exc:  # noqa: BLE001
                log.warning("sportsbook: NFL schedule unavailable (%s)", exc)
            try:
                first_period = min(payload["lines"][0]["nfl_weeks"])
                rosters = _fetch_rosters(client, season, first_period)
            except Exception as exc:  # noqa: BLE001
                log.warning("sportsbook: current rosters unavailable (%s)", exc)
            apply_locks(payload, schedule, rosters, now)
        write_json(target, payload, pretty=True)
        locked = sum(1 for line in payload["lines"] if line.get("lock_at"))
        return f"{len(payload['lines'])} lines for week {payload['week']}, {locked} with lock times"
    except Exception as exc:  # noqa: BLE001 - must never break a refresh
        log.warning("sportsbook step failed: %s", exc)
        return f"error: {exc}"


def refresh_locks(
    client,
    data_dir: Path | None = None,
    *,
    schedule_loader=fetch_schedule,
    now: datetime | None = None,
) -> str:
    """Recompute only the lock times in an existing lines file."""
    data_dir = data_dir or DATA_DIR
    target = data_dir / LINES_FILE
    payload = _read(target)
    if not payload or not payload.get("lines"):
        return "no lines posted; nothing to do"
    now = now or datetime.now(UTC)
    season = payload["season"]
    schedule = schedule_loader(season)
    first_period = min(min(line["nfl_weeks"]) for line in payload["lines"])
    rosters = _fetch_rosters(client, season, first_period)
    changed = apply_locks(payload, schedule, rosters, now)
    if not changed:
        return "lock times unchanged"
    write_json(target, payload, pretty=True)
    return f"lock times updated for {changed} of {len(payload['lines'])} lines"


def summarize(payload: dict) -> Iterable[str]:
    for line in payload.get("lines") or []:
        yield (
            f"{line['away_team_name']} @ {line['home_team_name']}: "
            f"home {line['home_spread']:+g}, total {line['total']:g}, "
            f"ML {line['home_ml']:+d}/{line['away_ml']:+d}, locks {line.get('lock_at')}"
        )
