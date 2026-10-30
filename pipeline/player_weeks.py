"""Complete weekly lines for every player who was on a league roster.

The weekly roster pull only sees a player while he sits on a league roster,
so a streamed defense or a back who was cut and re-added has holes in his
weeks. Fourteen and Fantasy needs every week for anyone you can draft, so
this step asks ESPN for the full weekly stat lines (real points, projection,
NFL team) of every player who was on a league roster at any point in a
completed season, and writes ``data/player_weeks/<season>.json``:

    {"season": 2023, "weeks": [1..14],
     "players": {"<id>": [[points...], [projected...], [team...]]}}

Each list is indexed by week; null means no stat line that week (a bye or
an inactive game). Team is the ESPN abbreviation he played for that week.

Safety:
* Completed seasons only, and once per season: a finished season's numbers
  don't change, so an existing file is kept.
* ESPN's numbers are checked against the league's own roster rows for every
  week we already have. If they don't agree (a scoring mismatch), the season
  is not written and the game keeps using roster data.
* It runs after the main dataset is published and never raises, so it cannot
  break a data refresh.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from pathlib import Path

from .config import write_json
from .constants import STAT_SOURCE_ACTUAL, STAT_SOURCE_PROJECTED, STAT_SPLIT_WEEK, pro_team

log = logging.getLogger(__name__)

TOLERANCE = 0.06
MIN_AGREEMENT = 0.95
MIN_COMPARED = 25


def _num(value) -> float | None:
    try:
        return None if value is None else round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _int(value) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def parse_player(player: dict, season: int, weeks: Iterable[int]) -> tuple[dict, dict, dict]:
    """(points, projected, team) by week for one ESPN player object, this season only."""
    wanted = set(weeks)
    points: dict[int, float] = {}
    projected: dict[int, float] = {}
    team: dict[int, str] = {}
    for stat in player.get("stats") or []:
        if _int(stat.get("statSplitTypeId")) != STAT_SPLIT_WEEK:
            continue
        if stat.get("seasonId") is not None and _int(stat.get("seasonId")) != season:
            continue
        week = _int(stat.get("scoringPeriodId"))
        if week not in wanted:
            continue
        value = _num(stat.get("appliedTotal"))
        if value is None:
            continue
        source = _int(stat.get("statSourceId"))
        if source == STAT_SOURCE_ACTUAL:
            points[week] = value
            abbr = pro_team(stat.get("proTeamId")) if stat.get("proTeamId") is not None else None
            if abbr and abbr != "FA":
                team[week] = abbr
        elif source == STAT_SOURCE_PROJECTED:
            projected[week] = value
            if week not in team and stat.get("proTeamId") is not None:
                abbr = pro_team(stat.get("proTeamId"))
                if abbr != "FA":
                    team[week] = abbr
    return points, projected, team


def build_payload(season: int, weeks: Sequence[int], players: Sequence[dict]) -> dict:
    weeks = sorted(weeks)
    out: dict[str, list[list]] = {}
    for player in players:
        pid = player.get("id")
        if pid is None:
            continue
        points, projected, team = parse_player(player, season, weeks)
        if not points and not projected:
            continue
        out[str(int(pid))] = [
            [points.get(w) for w in weeks],
            [projected.get(w) for w in weeks],
            [team.get(w) for w in weeks],
        ]
    return {"season": season, "weeks": weeks, "players": out}


def agreement(payload: dict, roster_rows: Sequence[dict]) -> tuple[int, int]:
    """(matching, compared): ESPN's weekly points against the league's roster rows."""
    index = {w: i for i, w in enumerate(payload["weeks"])}
    compared = matched = 0
    for row in roster_rows:
        week = row.get("week")
        if row.get("points") is None or week not in index:
            continue
        entry = payload["players"].get(str(row.get("player_id")))
        if not entry:
            continue
        espn = entry[0][index[week]]
        if espn is None:
            # ESPN has no line where the league recorded a nonzero score: a disagreement.
            if row["points"] != 0:
                compared += 1
            continue
        compared += 1
        if abs(espn - row["points"]) <= TOLERANCE:
            matched += 1
    return matched, compared


def refresh(client, assembled: dict, data_dir: Path, *, force: bool = False) -> dict[int, str]:
    """Write player_weeks/<season>.json for completed seasons. Never raises."""
    results: dict[int, str] = {}
    try:
        current = assembled.get("current_season")
        rosters: dict[int, list[dict]] = {}
        for row in assembled.get("rosters") or []:
            rosters.setdefault(row["season"], []).append(row)
        for season, payload in sorted((assembled.get("season_payloads") or {}).items()):
            if season == current:
                continue
            try:
                target = data_dir / "player_weeks" / f"{season}.json"
                if target.exists() and not force:
                    results[season] = "kept"
                    continue
                weeks_total = int((payload.get("meta") or {}).get("regular_season_weeks") or 0)
                weeks = list(range(1, weeks_total + 1))
                rows = [r for r in rosters.get(season) or [] if r.get("week") in weeks]
                if not rows or not weeks:
                    results[season] = "skipped: no roster rows"
                    continue
                cards = client.fetch_player_cards(season, [r["player_id"] for r in rows])
                built = build_payload(season, weeks, cards)
                matched, compared = agreement(built, rows)
                if compared < MIN_COMPARED or matched / compared < MIN_AGREEMENT:
                    results[season] = f"skipped: ESPN agreed on {matched} of {compared} player-weeks"
                    log.warning("player_weeks %s %s", season, results[season])
                    continue
                write_json(target, built)
                results[season] = f"written: {len(built['players'])} players, {matched}/{compared} agree"
                log.info("player_weeks %s %s", season, results[season])
            except Exception as exc:  # noqa: BLE001 - one season failing must not stop the rest
                results[season] = f"error: {exc}"
                log.warning("player_weeks %s failed: %s", season, exc)
    except Exception as exc:  # noqa: BLE001 - this extra step must never break a refresh
        results[-1] = f"error: {exc}"
        log.warning("player_weeks step stopped early: %s", exc)
    return results
