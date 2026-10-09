"""League record book.

Every record entry carries enough context to be read on its own: who, how
much, which season and week, and the opponent where that matters. Records are
emitted as a list of *categories*, each with a stable ``id`` so the frontend
can deep-link to one.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence

from .constants import GAME_REGULAR, RESULT_LOSS, RESULT_TIE, RESULT_WIN
from .metrics import filter_weeks, format_record, r2, win_pct

TOP_N = 15


def _team_week_entry(row: dict, value: float, label: str | None = None) -> dict:
    return {
        "value": r2(value),
        "display": label or f"{value:.2f}",
        "owner_id": row.get("owner_id"),
        "team_name": row.get("team_name"),
        "season": row.get("season"),
        "week": row.get("week"),
        "game_type": row.get("game_type"),
        "opponent_owner_id": row.get("opponent_owner_id"),
        "opponent_team_name": row.get("opponent_team_name"),
        "opponent_score": row.get("opponent_score"),
        "score": row.get("score"),
        "result": row.get("result"),
        "matchup_id": row.get("matchup_id"),
    }


def _matchup_entry(row: dict, value: float) -> dict:
    return {
        "value": r2(value),
        "display": f"{value:.2f}",
        "season": row.get("season"),
        "week": row.get("week"),
        "game_type": row.get("game_type"),
        "matchup_id": row.get("matchup_id"),
        "home_owner_id": row.get("home_owner_id"),
        "home_team_name": row.get("home_team_name"),
        "home_score": row.get("home_score"),
        "away_owner_id": row.get("away_owner_id"),
        "away_team_name": row.get("away_team_name"),
        "away_score": row.get("away_score"),
        "margin": row.get("margin"),
        "combined": row.get("combined"),
    }


def _top(
    rows: Iterable[dict],
    value_fn: Callable[[dict], float | None],
    *,
    reverse: bool,
    builder: Callable[[dict, float], dict],
    limit: int = TOP_N,
) -> list[dict]:
    scored = []
    for row in rows:
        value = value_fn(row)
        if value is None:
            continue
        scored.append((value, row))
    scored.sort(key=lambda pair: pair[0], reverse=reverse)
    return [builder(row, value) for value, row in scored[:limit]]


def _category(
    cat_id: str,
    title: str,
    entries: list[dict],
    *,
    description: str,
    group: str,
    unit: str = "points",
    better: str = "high",
) -> dict:
    return {
        "id": cat_id,
        "title": title,
        "group": group,
        "description": description,
        "unit": unit,
        "better": better,
        "entries": entries,
    }


# ---------------------------------------------------------------------------
# Single-game records
# ---------------------------------------------------------------------------


def single_game_records(
    team_weeks: Sequence[dict],
    matchups: Sequence[dict],
    *,
    game_types: Sequence[str] | None = None,
) -> list[dict]:
    weeks = filter_weeks(team_weeks, game_types=game_types, key="owner_id")
    games = [
        m
        for m in matchups
        if m.get("completed")
        and not m.get("is_bye")
        and (game_types is None or m.get("game_type") in game_types)
    ]
    wins = [w for w in weeks if w["result"] == RESULT_WIN]
    losses = [w for w in weeks if w["result"] == RESULT_LOSS]

    return [
        _category(
            "highest-score",
            "Highest Single-Game Score",
            _top(weeks, lambda r: r["score"], reverse=True, builder=_team_week_entry),
            description="Most points scored by one team in a single fantasy week.",
            group="single-game",
        ),
        _category(
            "lowest-score",
            "Lowest Single-Game Score",
            _top(weeks, lambda r: r["score"], reverse=False, builder=_team_week_entry),
            description="Fewest points scored by one team in a single fantasy week.",
            group="single-game",
            better="low",
        ),
        _category(
            "highest-score-loss",
            "Highest Score in a Loss",
            _top(losses, lambda r: r["score"], reverse=True, builder=_team_week_entry),
            description="The cruellest weeks in league history: huge scores that still lost.",
            group="single-game",
        ),
        _category(
            "lowest-score-win",
            "Lowest Score in a Win",
            _top(wins, lambda r: r["score"], reverse=False, builder=_team_week_entry),
            description="Wins collected with the least possible effort.",
            group="single-game",
            better="low",
        ),
        _category(
            "biggest-blowout",
            "Biggest Blowout",
            _top(games, lambda r: r["margin"], reverse=True, builder=_matchup_entry),
            description="Largest margin of victory in a single matchup.",
            group="single-game",
            unit="point margin",
        ),
        _category(
            "closest-game",
            "Closest Matchup",
            _top(games, lambda r: r["margin"], reverse=False, builder=_matchup_entry),
            description="Smallest margin of victory. Ties are excluded; see the ties list.",
            group="single-game",
            unit="point margin",
            better="low",
        ),
        _category(
            "highest-combined",
            "Highest Combined Score",
            _top(games, lambda r: r["combined"], reverse=True, builder=_matchup_entry),
            description="The biggest shootouts: most total points in one matchup.",
            group="single-game",
            unit="combined points",
        ),
        _category(
            "lowest-combined",
            "Lowest Combined Score",
            _top(games, lambda r: r["combined"], reverse=False, builder=_matchup_entry),
            description="The ugliest games in league history.",
            group="single-game",
            unit="combined points",
            better="low",
        ),
    ]


# ---------------------------------------------------------------------------
# Season records
# ---------------------------------------------------------------------------


def season_records(
    team_weeks: Sequence[dict],
    *,
    game_types: Sequence[str] = (GAME_REGULAR,),
) -> list[dict]:
    """Records held by an owner-season (e.g. most points in a single season)."""
    rows = filter_weeks(team_weeks, game_types=game_types, key="owner_id")
    buckets: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in rows:
        buckets[(row["owner_id"], row["season"])].append(row)

    seasons = []
    for (owner_id, season), season_rows in buckets.items():
        scores = [r["score"] for r in season_rows]
        wins = sum(1 for r in season_rows if r["result"] == RESULT_WIN)
        losses = sum(1 for r in season_rows if r["result"] == RESULT_LOSS)
        ties = sum(1 for r in season_rows if r["result"] == RESULT_TIE)
        seasons.append(
            {
                "owner_id": owner_id,
                "season": season,
                "team_name": season_rows[-1].get("team_name"),
                "games": len(season_rows),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "record": format_record(wins, losses, ties),
                "win_pct": win_pct(wins, losses, ties),
                "points_for": round(sum(scores), 2),
                "points_against": round(sum(r["opponent_score"] for r in season_rows), 2),
                "avg_score": round(statistics.fmean(scores), 2),
                "score_stdev": round(statistics.stdev(scores), 2) if len(scores) > 1 else None,
                "games_150_plus": sum(1 for s in scores if s >= 150),
                "games_under_100": sum(1 for s in scores if s < 100),
            }
        )

    def builder(row: dict, value: float) -> dict:
        return {
            "value": r2(value),
            "display": f"{value:g}" if float(value).is_integer() else f"{value:.2f}",
            "owner_id": row["owner_id"],
            "team_name": row["team_name"],
            "season": row["season"],
            "record": row["record"],
            "points_for": row["points_for"],
            "avg_score": row["avg_score"],
            "games": row["games"],
        }

    # Only rank win percentage for seasons with a meaningful sample.
    full_seasons = [s for s in seasons if s["games"] >= 8]

    return [
        _category(
            "most-points-season",
            "Most Points in a Season",
            _top(seasons, lambda r: r["points_for"], reverse=True, builder=builder),
            description="Highest regular-season points total.",
            group="season",
        ),
        _category(
            "fewest-points-season",
            "Fewest Points in a Season",
            _top(seasons, lambda r: r["points_for"], reverse=False, builder=builder),
            description="Lowest regular-season points total.",
            group="season",
            better="low",
        ),
        _category(
            "highest-avg-season",
            "Highest Scoring Average",
            _top(seasons, lambda r: r["avg_score"], reverse=True, builder=builder),
            description="Best points-per-game in a single regular season.",
            group="season",
            unit="points per game",
        ),
        _category(
            "most-wins-season",
            "Most Wins in a Season",
            _top(seasons, lambda r: r["wins"], reverse=True, builder=builder),
            description="Most regular-season wins. Season lengths differ; the game count is shown.",
            group="season",
            unit="wins",
        ),
        _category(
            "most-losses-season",
            "Most Losses in a Season",
            _top(seasons, lambda r: r["losses"], reverse=True, builder=builder),
            description="Most regular-season losses.",
            group="season",
            unit="losses",
            better="low",
        ),
        _category(
            "best-win-pct-season",
            "Best Winning Percentage",
            _top(full_seasons, lambda r: r["win_pct"], reverse=True, builder=builder),
            description="Best regular-season win percentage (minimum 8 games).",
            group="season",
            unit="win %",
        ),
        _category(
            "most-150-season",
            "Most 150-Point Games",
            _top(seasons, lambda r: r["games_150_plus"], reverse=True, builder=builder),
            description="Most weeks above 150 points in one season.",
            group="season",
            unit="games",
        ),
        _category(
            "most-sub100-season",
            "Most Sub-100 Games",
            _top(seasons, lambda r: r["games_under_100"], reverse=True, builder=builder),
            description="Most weeks below 100 points in one season.",
            group="season",
            unit="games",
            better="low",
        ),
        _category(
            "most-consistent-season",
            "Most Consistent Season",
            _top(
                [s for s in full_seasons if s["score_stdev"] is not None],
                lambda r: r["score_stdev"],
                reverse=False,
                builder=builder,
            ),
            description=(
                "Lowest week-to-week standard deviation (minimum 8 games). "
                "Consistency is not the same as quality -- a reliably bad "
                "team scores here too."
            ),
            group="season",
            unit="std dev",
            better="low",
        ),
        _category(
            "most-volatile-season",
            "Most Volatile Season",
            _top(
                [s for s in full_seasons if s["score_stdev"] is not None],
                lambda r: r["score_stdev"],
                reverse=True,
                builder=builder,
            ),
            description="Highest week-to-week standard deviation (minimum 8 games).",
            group="season",
            unit="std dev",
        ),
    ]


# ---------------------------------------------------------------------------
# Career records
# ---------------------------------------------------------------------------


def career_records(career: Sequence[dict]) -> list[dict]:
    """``career`` rows come from :func:`pipeline.transform.build_careers`."""

    def builder(row: dict, value: float) -> dict:
        return {
            "value": r2(value),
            "display": f"{value:g}" if float(value).is_integer() else f"{value:.3f}",
            "owner_id": row["owner_id"],
            "owner_name": row.get("name"),
            "team_name": row.get("current_team_name"),
            "seasons": row.get("seasons_played"),
            "record": row.get("record"),
        }

    qualified = [c for c in career if (c.get("games") or 0) >= 20]

    return [
        _category(
            "career-wins",
            "Career Wins",
            _top(career, lambda r: r.get("wins"), reverse=True, builder=builder),
            description="Total regular-season wins across every season in the league.",
            group="career",
            unit="wins",
        ),
        _category(
            "career-losses",
            "Career Losses",
            _top(career, lambda r: r.get("losses"), reverse=True, builder=builder),
            description="Total regular-season losses.",
            group="career",
            unit="losses",
            better="low",
        ),
        _category(
            "career-win-pct",
            "Career Winning Percentage",
            _top(qualified, lambda r: r.get("win_pct"), reverse=True, builder=builder),
            description="Regular-season win percentage, minimum 20 games played.",
            group="career",
            unit="win %",
        ),
        _category(
            "career-points",
            "Career Points For",
            _top(career, lambda r: r.get("points_for"), reverse=True, builder=builder),
            description="Total regular-season points scored. Favours long-tenured owners.",
            group="career",
        ),
        _category(
            "career-avg",
            "Career Scoring Average",
            _top(qualified, lambda r: r.get("avg_score"), reverse=True, builder=builder),
            description="Career points per game, minimum 20 games played.",
            group="career",
            unit="points per game",
        ),
        _category(
            "career-championships",
            "Championships",
            _top(career, lambda r: r.get("championships"), reverse=True, builder=builder),
            description="League titles won.",
            group="career",
            unit="titles",
        ),
        _category(
            "career-playoff-appearances",
            "Playoff Appearances",
            _top(career, lambda r: r.get("playoff_appearances"), reverse=True, builder=builder),
            description="Seasons in which the owner played at least one winners-bracket game.",
            group="career",
            unit="appearances",
        ),
        _category(
            "career-avg-finish",
            "Best Average Finish",
            _top(
                [c for c in career if c.get("avg_finish") is not None],
                lambda r: r.get("avg_finish"),
                reverse=False,
                builder=builder,
            ),
            description=(
                "Mean final standing across seasons where ESPN reported one. "
                "League size has changed over time, so a finish of 6th in a "
                "10-team season is not identical to 6th in a 12-team season."
            ),
            group="career",
            unit="place",
            better="low",
        ),
        _category(
            "career-longest-win-streak",
            "Longest Winning Streak",
            _top(career, lambda r: r.get("longest_win_streak"), reverse=True, builder=builder),
            description="Longest run of consecutive regular-season wins, spanning seasons.",
            group="career",
            unit="games",
        ),
        _category(
            "career-longest-loss-streak",
            "Longest Losing Streak",
            _top(career, lambda r: r.get("longest_loss_streak"), reverse=True, builder=builder),
            description="Longest run of consecutive regular-season losses, spanning seasons.",
            group="career",
            unit="games",
            better="low",
        ),
    ]


# ---------------------------------------------------------------------------
# Player records (only when roster data exists)
# ---------------------------------------------------------------------------


def player_records(
    rosters: Sequence[dict],
    players: dict[int, dict],
    owners_by_id: dict[str, dict],
) -> list[dict]:
    if not rosters:
        return []

    def enrich(row: dict) -> dict:
        player = players.get(row["player_id"]) or {}
        return {
            **row,
            "player_name": player.get("name", f"Player {row['player_id']}"),
            "position": player.get("position", "UNK"),
            "nfl_team": player.get("nfl_team"),
        }

    enriched = [enrich(r) for r in rosters if r.get("points") is not None]
    started = [r for r in enriched if r.get("started")]
    benched = [r for r in enriched if not r.get("started")]

    def builder(row: dict, value: float) -> dict:
        return {
            "value": r2(value),
            "display": f"{value:.2f}",
            "player_name": row["player_name"],
            "position": row["position"],
            "nfl_team": row["nfl_team"],
            "owner_id": row.get("owner_id"),
            "owner_name": (owners_by_id.get(row.get("owner_id")) or {}).get("name"),
            "season": row["season"],
            "week": row["week"],
            "lineup_slot": row.get("lineup_slot"),
        }

    categories = [
        _category(
            "player-best-week",
            "Best Individual Player Week",
            _top(enriched, lambda r: r["points"], reverse=True, builder=builder),
            description="Highest single-week score by any player on any roster.",
            group="player",
        ),
        _category(
            "player-biggest-bench",
            "Biggest Bench Performance",
            _top(benched, lambda r: r["points"], reverse=True, builder=builder),
            description="Most points scored by a player who was left on the bench.",
            group="player",
        ),
        _category(
            "player-worst-starter",
            "Biggest Starter Dud",
            _top(
                [r for r in started if r["position"] not in {"K", "D/ST"}],
                lambda r: r["points"],
                reverse=False,
                builder=builder,
            ),
            description=(
                "Lowest score by a started player, excluding kickers and "
                "defences where low scores are routine."
            ),
            group="player",
            better="low",
        ),
    ]

    for position in ("QB", "RB", "WR", "TE", "K", "D/ST"):
        pool = [r for r in enriched if r["position"] == position]
        if not pool:
            continue
        categories.append(
            _category(
                f"player-best-{position.lower().replace('/', '')}",
                f"Best {position} Week",
                _top(pool, lambda r: r["points"], reverse=True, builder=builder),
                description=f"Highest single-week score by a {position}.",
                group="player-position",
            )
        )
    return categories


def build_record_book(
    team_weeks: Sequence[dict],
    matchups: Sequence[dict],
    career: Sequence[dict],
    rosters: Sequence[dict],
    players: dict[int, dict],
    owners_by_id: dict[str, dict],
) -> dict:
    """Assemble the full record book with regular-season and all-games views."""
    return {
        "scopes": {
            "regular": {
                "label": "Regular Season",
                "categories": single_game_records(team_weeks, matchups, game_types=(GAME_REGULAR,)),
            },
            "all": {
                "label": "All Games",
                "categories": single_game_records(team_weeks, matchups, game_types=None),
            },
        },
        "season": season_records(team_weeks),
        "career": career_records(career),
        "player": player_records(rosters, players, owners_by_id),
    }
