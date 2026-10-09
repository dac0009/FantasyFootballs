"""Turn raw ESPN payloads into flat, normalized tables.

Nothing in here computes statistics. The only job of this module is to make
ESPN's deeply nested, inconsistently-populated JSON boring and rectangular so
that :mod:`pipeline.metrics` and :mod:`pipeline.records` can be simple and
testable.

Output tables (lists of plain dicts):
    seasons, teams, matchups, team_weeks, rosters, players, drafts, transactions
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from .constants import (
    GAME_CONSOLATION,
    GAME_PLAYOFF,
    GAME_POSTSEASON_UNKNOWN,
    GAME_REGULAR,
    NON_STARTER_SLOT_IDS,
    PLAYOFF_TIER_CONSOLATION,
    PLAYOFF_TIER_WINNERS,
    RESULT_LOSS,
    RESULT_TIE,
    RESULT_WIN,
    STAT_SOURCE_ACTUAL,
    STAT_SOURCE_PROJECTED,
    STAT_SPLIT_WEEK,
    position_name,
    pro_team,
    slot_name,
)
from .espn_client import EspnApiError, EspnClient, NotAvailableError
from .owners import OwnerRegistry, team_display_name

log = logging.getLogger(__name__)

SEASON_VIEWS = ["mTeam", "mMatchupScore", "mSettings", "mStatus"]


def _num(value, default=None):
    try:
        if value is None:
            return default
        out = float(value)
        if out != out or out in (float("inf"), float("-inf")):  # NaN / inf
            return default
        return round(out, 2)
    except (TypeError, ValueError):
        return default


def _int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Season metadata
# ---------------------------------------------------------------------------


def extract_season_meta(season: int, payload: dict) -> dict:
    settings = payload.get("settings") or {}
    schedule_settings = settings.get("scheduleSettings") or {}
    status = payload.get("status") or {}

    # ESPN semantics: ``matchupPeriodCount`` is the count of REGULAR SEASON
    # matchup periods. Playoff matchup periods are numbered after it.
    regular_weeks = _int(schedule_settings.get("matchupPeriodCount"))
    matchup_periods = schedule_settings.get("matchupPeriods") or {}

    schedule = payload.get("schedule") or []
    observed_weeks = sorted(
        {w for w in (_int(g.get("matchupPeriodId")) for g in schedule) if w}
    )
    if not regular_weeks and observed_weeks:
        # Fall back: assume everything flagged as a bracket game is postseason.
        bracket_weeks = {
            _int(g.get("matchupPeriodId"))
            for g in schedule
            if (g.get("playoffTierType") or "NONE") != "NONE"
        }
        regular_weeks = (
            min(w for w in bracket_weeks if w) - 1 if any(bracket_weeks) else max(observed_weeks)
        )

    return {
        "season": int(season),
        "league_name": (settings.get("name") or "").strip() or None,
        "team_count": _int(settings.get("size")) or len(payload.get("teams") or []),
        "regular_season_weeks": regular_weeks,
        "total_matchup_periods": max(observed_weeks) if observed_weeks else regular_weeks,
        "playoff_team_count": _int(schedule_settings.get("playoffTeamCount")),
        "playoff_matchup_length": _int(schedule_settings.get("playoffMatchupPeriodLength"), 1),
        "scoring_type": ((settings.get("scoringSettings") or {}).get("scoringType")),
        "current_matchup_period": _int(status.get("currentMatchupPeriod")),
        "latest_scoring_period": _int(status.get("latestScoringPeriod")),
        "final_scoring_period": _int(status.get("finalScoringPeriod")),
        "is_active": bool(status.get("isActive")),
        "matchup_period_scoring_periods": {
            str(k): [int(v) for v in (vals or [])] for k, vals in matchup_periods.items()
        },
        "lineup_slot_counts": {
            str(slot): int(count)
            for slot, count in (
                (settings.get("rosterSettings") or {}).get("lineupSlotCounts") or {}
            ).items()
            if int(count or 0) > 0
        },
        "weeks_observed": observed_weeks,
    }


def extract_teams(season: int, payload: dict, team_to_owner: dict[int, str]) -> list[dict]:
    rows = []
    for team in payload.get("teams") or []:
        team_id = _int(team.get("id"))
        if team_id is None:
            continue
        record = ((team.get("record") or {}).get("overall")) or {}
        logo = (team.get("logo") or "").strip() or None
        rows.append(
            {
                "season": int(season),
                "team_id": team_id,
                "owner_id": team_to_owner.get(team_id),
                "team_name": team_display_name(team),
                "abbrev": (team.get("abbrev") or "").strip() or None,
                # ESPN-hosted logos are hotlinkable but frequently 404 for old
                # seasons; the frontend treats this as best-effort.
                "logo": logo if logo and logo.startswith("http") else None,
                "espn_wins": _int(record.get("wins"), 0),
                "espn_losses": _int(record.get("losses"), 0),
                "espn_ties": _int(record.get("ties"), 0),
                "espn_points_for": _num(record.get("pointsFor")),
                "espn_points_against": _num(record.get("pointsAgainst")),
                "playoff_seed": _int(team.get("playoffSeed")),
                "final_rank": _int(team.get("rankCalculatedFinal")) or None,
                "division_id": _int(team.get("divisionId")),
            }
        )
    return sorted(rows, key=lambda r: r["team_id"])


# ---------------------------------------------------------------------------
# Matchups / team-weeks
# ---------------------------------------------------------------------------


def classify_game(
    week: int,
    tier: str | None,
    regular_weeks: int | None,
    playoff_seeds: dict[int, int | None],
    playoff_team_count: int | None,
    home_id: int,
    away_id: int,
) -> str:
    tier = (tier or "NONE").upper()
    if regular_weeks and week <= regular_weeks:
        return GAME_REGULAR
    if tier == PLAYOFF_TIER_WINNERS:
        return GAME_PLAYOFF
    if tier in PLAYOFF_TIER_CONSOLATION:
        return GAME_CONSOLATION
    if not regular_weeks:
        return GAME_REGULAR
    # Postseason week with no usable tier flag (older seasons). Infer from
    # whether both teams made the bracket.
    if playoff_team_count:
        home_seed = playoff_seeds.get(home_id)
        away_seed = playoff_seeds.get(away_id)
        if home_seed and away_seed:
            if home_seed <= playoff_team_count and away_seed <= playoff_team_count:
                return GAME_PLAYOFF
            return GAME_CONSOLATION
    return GAME_POSTSEASON_UNKNOWN


def _side_score(side: dict, week: int, meta: dict) -> float | None:
    """Score for one side of a matchup.

    ``totalPoints`` is authoritative. For multi-week playoff matchups ESPN
    accumulates into ``totalPoints`` and exposes the split in
    ``pointsByScoringPeriod``; we keep the accumulated value because that is
    what decided the game.
    """
    total = _num(side.get("totalPoints"))
    if total is not None:
        return total
    by_period = side.get("pointsByScoringPeriod") or {}
    if by_period:
        return _num(sum(float(v or 0) for v in by_period.values()))
    cumulative = (side.get("cumulativeScore") or {}).get("score")
    return _num(cumulative)


def extract_matchups(
    season: int,
    payload: dict,
    meta: dict,
    teams: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Return ``(matchups, team_weeks)``.

    A matchup is "completed" only when ESPN has declared a winner. Scheduled
    future games are retained with ``completed=False`` and zero-ish scores so
    the frontend can render upcoming weeks, but every statistic downstream
    filters on ``completed``.
    """
    regular_weeks = meta.get("regular_season_weeks")
    playoff_team_count = meta.get("playoff_team_count")
    playoff_seeds = {t["team_id"]: t.get("playoff_seed") for t in teams}
    owner_by_team = {t["team_id"]: t.get("owner_id") for t in teams}
    name_by_team = {t["team_id"]: t.get("team_name") for t in teams}

    matchups: list[dict] = []
    team_weeks: list[dict] = []
    seen_keys: set[tuple] = set()

    for game in payload.get("schedule") or []:
        week = _int(game.get("matchupPeriodId"))
        if week is None:
            continue
        home = game.get("home") or {}
        away = game.get("away") or {}
        home_id = _int(home.get("teamId"))
        away_id = _int(away.get("teamId"))

        if home_id is None and away_id is None:
            continue
        if home_id is None or away_id is None:
            # Playoff bye: one side only. Recorded so the bracket renders,
            # but it is not a game and never feeds statistics.
            present = home_id if home_id is not None else away_id
            matchups.append(
                {
                    "matchup_id": f"{season}-{week}-bye-{present}",
                    "season": int(season),
                    "week": week,
                    "espn_matchup_id": _int(game.get("id")),
                    "game_type": GAME_PLAYOFF if (regular_weeks or 0) < week else GAME_REGULAR,
                    "playoff_tier": game.get("playoffTierType"),
                    "is_bye": True,
                    "completed": False,
                    "home_team_id": present,
                    "away_team_id": None,
                    "home_owner_id": owner_by_team.get(present),
                    "away_owner_id": None,
                    "home_team_name": name_by_team.get(present),
                    "away_team_name": None,
                    "home_score": None,
                    "away_score": None,
                    "winner": "BYE",
                    "margin": None,
                    "combined": None,
                }
            )
            continue

        winner = (game.get("winner") or "UNDECIDED").upper()
        home_score = _side_score(home, week, meta)
        away_score = _side_score(away, week, meta)
        completed = winner in {"HOME", "AWAY", "TIE"} and home_score is not None and away_score is not None

        # ESPN very occasionally repeats a schedule entry across views.
        key = (week, min(home_id, away_id), max(home_id, away_id), _int(game.get("id")))
        if key in seen_keys:
            log.warning("duplicate schedule entry skipped: season=%s %s", season, key)
            continue
        seen_keys.add(key)

        game_type = classify_game(
            week,
            game.get("playoffTierType"),
            regular_weeks,
            playoff_seeds,
            playoff_team_count,
            home_id,
            away_id,
        )

        matchup_id = f"{season}-{week}-{min(home_id, away_id)}-{max(home_id, away_id)}"
        margin = (
            _num(abs(home_score - away_score)) if completed else None
        )
        combined = _num(home_score + away_score) if completed else None

        matchups.append(
            {
                "matchup_id": matchup_id,
                "season": int(season),
                "week": week,
                "espn_matchup_id": _int(game.get("id")),
                "game_type": game_type,
                "playoff_tier": game.get("playoffTierType"),
                "is_bye": False,
                "completed": completed,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "home_owner_id": owner_by_team.get(home_id),
                "away_owner_id": owner_by_team.get(away_id),
                "home_team_name": name_by_team.get(home_id),
                "away_team_name": name_by_team.get(away_id),
                "home_score": home_score,
                "away_score": away_score,
                "winner": winner,
                "margin": margin,
                "combined": combined,
            }
        )

        if not completed:
            continue

        for team_id, opp_id, score, opp_score in (
            (home_id, away_id, home_score, away_score),
            (away_id, home_id, away_score, home_score),
        ):
            if score > opp_score:
                result = RESULT_WIN
            elif score < opp_score:
                result = RESULT_LOSS
            else:
                result = RESULT_TIE
            team_weeks.append(
                {
                    "season": int(season),
                    "week": week,
                    "matchup_id": matchup_id,
                    "game_type": game_type,
                    "team_id": team_id,
                    "owner_id": owner_by_team.get(team_id),
                    "team_name": name_by_team.get(team_id),
                    "score": score,
                    "opponent_team_id": opp_id,
                    "opponent_owner_id": owner_by_team.get(opp_id),
                    "opponent_team_name": name_by_team.get(opp_id),
                    "opponent_score": opp_score,
                    "differential": _num(score - opp_score),
                    "result": result,
                    "is_home": team_id == home_id,
                }
            )

    matchups.sort(key=lambda r: (r["week"], r["home_team_id"] or 0, r["away_team_id"] or 0))
    team_weeks.sort(key=lambda r: (r["week"], r["team_id"]))
    return matchups, team_weeks


def determine_champion(season_meta: dict, matchups: list[dict], teams: list[dict]) -> dict:
    """Champion, runner-up and last place, with an explicit provenance field."""
    result = {
        "season": season_meta["season"],
        "champion_team_id": None,
        "runner_up_team_id": None,
        "third_place_team_id": None,
        "last_place_team_id": None,
        "source": None,
    }
    final_games = [
        m
        for m in matchups
        if m["game_type"] == GAME_PLAYOFF and m["completed"] and not m["is_bye"]
    ]
    if final_games:
        last_week = max(m["week"] for m in final_games)
        finals = [m for m in final_games if m["week"] == last_week]
        if len(finals) >= 1:
            # If several winners-bracket games share the final week, the
            # championship is the one with the highest combined seed quality;
            # in practice ESPN leaves exactly one.
            final = max(finals, key=lambda m: (m["combined"] or 0))
            if final["winner"] == "HOME":
                result["champion_team_id"] = final["home_team_id"]
                result["runner_up_team_id"] = final["away_team_id"]
            elif final["winner"] == "AWAY":
                result["champion_team_id"] = final["away_team_id"]
                result["runner_up_team_id"] = final["home_team_id"]
            result["source"] = "winners_bracket_final"

    ranked = [t for t in teams if t.get("final_rank")]
    if ranked:
        by_rank = sorted(ranked, key=lambda t: t["final_rank"])
        if result["champion_team_id"] is None:
            result["champion_team_id"] = by_rank[0]["team_id"]
            result["source"] = "rankCalculatedFinal"
        if result["runner_up_team_id"] is None and len(by_rank) > 1:
            result["runner_up_team_id"] = by_rank[1]["team_id"]
        if len(by_rank) > 2:
            result["third_place_team_id"] = by_rank[2]["team_id"]
        result["last_place_team_id"] = by_rank[-1]["team_id"]
        result["final_ranks"] = {str(t["team_id"]): t["final_rank"] for t in by_rank}
    return result


# ---------------------------------------------------------------------------
# Rosters / players (per scoring period, requires mBoxscore)
# ---------------------------------------------------------------------------


def _player_week_points(player: dict, week: int, source_id: int) -> float | None:
    for stat in player.get("stats") or []:
        if _int(stat.get("statSourceId")) != source_id:
            continue
        if _int(stat.get("statSplitTypeId")) != STAT_SPLIT_WEEK:
            continue
        if _int(stat.get("scoringPeriodId")) != week:
            continue
        return _num(stat.get("appliedTotal"))
    return None


def extract_week_rosters(
    season: int,
    week: int,
    payload: dict,
    teams: list[dict],
) -> tuple[list[dict], dict[int, dict]]:
    """Per-player lineup rows for one scoring period, plus a player index."""
    owner_by_team = {t["team_id"]: t.get("owner_id") for t in teams}
    rows: list[dict] = []
    players: dict[int, dict] = {}

    for game in payload.get("schedule") or []:
        if _int(game.get("matchupPeriodId")) != week:
            continue
        for side_key in ("home", "away"):
            side = game.get(side_key) or {}
            team_id = _int(side.get("teamId"))
            if team_id is None:
                continue
            entries = (
                (side.get("rosterForCurrentScoringPeriod") or {}).get("entries")
                or (side.get("rosterForMatchupPeriod") or {}).get("entries")
                or []
            )
            for entry in entries:
                pool = entry.get("playerPoolEntry") or {}
                player = pool.get("player") or {}
                player_id = _int(pool.get("id") or player.get("id") or entry.get("playerId"))
                if player_id is None:
                    continue
                slot_id = _int(entry.get("lineupSlotId"), -1)
                actual = _num(pool.get("appliedStatTotal"))
                if actual is None:
                    actual = _player_week_points(player, week, STAT_SOURCE_ACTUAL)
                projected = _player_week_points(player, week, STAT_SOURCE_PROJECTED)

                players.setdefault(
                    player_id,
                    {
                        "player_id": player_id,
                        "name": (player.get("fullName") or "").strip() or f"Player {player_id}",
                        "position": position_name(player.get("defaultPositionId")),
                        "nfl_team": pro_team(player.get("proTeamId")),
                    },
                )
                rows.append(
                    {
                        "season": int(season),
                        "week": week,
                        "team_id": team_id,
                        "owner_id": owner_by_team.get(team_id),
                        "player_id": player_id,
                        "lineup_slot_id": slot_id,
                        "lineup_slot": slot_name(slot_id),
                        "started": slot_id not in NON_STARTER_SLOT_IDS and slot_id >= 0,
                        "points": actual,
                        "projected": projected,
                    }
                )
    rows.sort(key=lambda r: (r["team_id"], not r["started"], -(r["points"] or 0)))
    return rows, players


# ---------------------------------------------------------------------------
# Drafts
# ---------------------------------------------------------------------------


def extract_draft(season: int, payload: dict, teams: list[dict]) -> list[dict]:
    detail = payload.get("draftDetail") or {}
    picks = detail.get("picks") or []
    owner_by_team = {t["team_id"]: t.get("owner_id") for t in teams}
    name_by_team = {t["team_id"]: t.get("team_name") for t in teams}
    rows = []
    for pick in picks:
        team_id = _int(pick.get("teamId"))
        rows.append(
            {
                "season": int(season),
                "overall_pick": _int(pick.get("overallPickNumber")),
                "round": _int(pick.get("roundId")),
                "round_pick": _int(pick.get("roundPickNumber")),
                "team_id": team_id,
                "owner_id": owner_by_team.get(team_id),
                "team_name": name_by_team.get(team_id),
                "player_id": _int(pick.get("playerId")),
                "keeper": bool(pick.get("keeper")),
                "bid_amount": _num(pick.get("bidAmount")),
                "auto_pick": bool(pick.get("autoDraftTypeId")),
            }
        )
    rows.sort(key=lambda r: (r["overall_pick"] or 0))
    return rows


def extract_transactions(season: int, payload: dict, teams: list[dict]) -> list[dict]:
    owner_by_team = {t["team_id"]: t.get("owner_id") for t in teams}
    rows = []
    for txn in payload.get("transactions") or []:
        team_id = _int(txn.get("teamId"))
        for item in txn.get("items") or []:
            rows.append(
                {
                    "season": int(season),
                    "transaction_id": str(txn.get("id") or ""),
                    "type": txn.get("type"),
                    "status": txn.get("status"),
                    "proposed_date": _int(txn.get("proposedDate")),
                    "team_id": team_id,
                    "owner_id": owner_by_team.get(team_id),
                    "action": item.get("type"),
                    "player_id": _int(item.get("playerId")),
                    "from_team_id": _int(item.get("fromTeamId")),
                    "to_team_id": _int(item.get("toTeamId")),
                    "bid_amount": _num(txn.get("bidAmount")),
                }
            )
    return rows


# ---------------------------------------------------------------------------
# Orchestration for a single season
# ---------------------------------------------------------------------------


def load_season(
    client: EspnClient,
    season: int,
    registry: OwnerRegistry,
    *,
    with_rosters: bool = True,
    with_draft: bool = True,
    with_transactions: bool = True,
) -> dict:
    """Fetch and normalize one season. Raises on unusable core data."""
    log.info("season %s: fetching core views", season)
    core = client.fetch_league(season, SEASON_VIEWS)
    payload = core.payload

    if not payload.get("teams"):
        raise EspnApiError(
            f"season {season}: ESPN returned no teams. Refusing to treat this "
            "as a valid season."
        )

    meta = extract_season_meta(season, payload)
    team_to_owner = registry.register_season(
        season, payload.get("members") or [], payload.get("teams") or []
    )
    teams = extract_teams(season, payload, team_to_owner)
    matchups, team_weeks = extract_matchups(season, payload, meta, teams)
    finish = determine_champion(meta, matchups, teams)

    result = {
        "meta": meta,
        "teams": teams,
        "matchups": matchups,
        "team_weeks": team_weeks,
        "finish": finish,
        "rosters": [],
        "players": {},
        "draft": [],
        "transactions": [],
        "endpoint": core.endpoint,
        "limitations": [],
    }

    completed_weeks = sorted({m["week"] for m in matchups if m["completed"]})

    if with_rosters and completed_weeks:
        result["rosters"], result["players"] = _load_rosters(
            client, season, completed_weeks, teams, result["limitations"]
        )

    if with_draft:
        try:
            draft_payload = client.fetch_league(
                season, ["mDraftDetail"], cache_key=f"{season}/draft"
            ).payload
            result["draft"] = extract_draft(season, draft_payload, teams)
            if not result["draft"]:
                result["limitations"].append(
                    f"{season}: ESPN returned no draft picks for this season."
                )
        except EspnApiError as exc:
            log.warning("season %s: draft unavailable (%s)", season, exc)
            result["limitations"].append(f"{season}: draft data unavailable ({exc}).")

    if with_transactions:
        try:
            txn_payload = client.fetch_transactions(season)
            result["transactions"] = extract_transactions(season, txn_payload, teams)
            if not result["transactions"]:
                result["limitations"].append(
                    f"{season}: ESPN returned no transaction history."
                )
        except EspnApiError as exc:
            log.warning("season %s: transactions unavailable (%s)", season, exc)
            result["limitations"].append(f"{season}: transactions unavailable ({exc}).")

    # Resolve any drafted players who never appeared on a weekly roster.
    missing = {
        p["player_id"]
        for p in result["draft"]
        if p["player_id"] and p["player_id"] not in result["players"]
    }
    if missing:
        try:
            extra = client.fetch_player_names(season, sorted(missing))
            for pid, player in extra.items():
                result["players"].setdefault(
                    pid,
                    {
                        "player_id": pid,
                        "name": (player.get("fullName") or "").strip() or f"Player {pid}",
                        "position": position_name(player.get("defaultPositionId")),
                        "nfl_team": pro_team(player.get("proTeamId")),
                    },
                )
        except EspnApiError as exc:
            log.warning("season %s: player name lookup failed (%s)", season, exc)

    return result


def _load_rosters(
    client: EspnClient,
    season: int,
    weeks: Iterable[int],
    teams: list[dict],
    limitations: list[str],
) -> tuple[list[dict], dict[int, dict]]:
    rows: list[dict] = []
    players: dict[int, dict] = {}
    failures = 0
    weeks = list(weeks)
    for week in weeks:
        try:
            payload = client.fetch_league(
                season,
                ["mMatchupScore", "mMatchup", "mBoxscore"],
                scoring_period=week,
                cache_key=f"{season}/boxscore_wk{week}",
            ).payload
        except NotAvailableError:
            failures += 1
            continue
        except EspnApiError as exc:
            log.warning("season %s week %s: boxscore failed (%s)", season, week, exc)
            failures += 1
            continue
        week_rows, week_players = extract_week_rosters(season, week, payload, teams)
        if not week_rows:
            failures += 1
        rows.extend(week_rows)
        players.update(week_players)

    if failures:
        limitations.append(
            f"{season}: lineup-level data missing for {failures} of "
            f"{len(weeks)} completed weeks. ESPN does not reliably serve "
            "historical boxscores for older seasons."
        )
    return rows, players
