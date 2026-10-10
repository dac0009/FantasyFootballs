"""Assemble the public-facing payloads from normalized tables + metrics.

This is the layer that decides what the website actually receives. The
frontend should never have to compute a statistic; it should only ever
format, sort and chart what it is given.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Sequence

from . import metrics
from .constants import (
    GAME_CONSOLATION,
    GAME_PLAYOFF,
    GAME_REGULAR,
    RESULT_LOSS,
    RESULT_WIN,
)
from .metrics import r2

# ---------------------------------------------------------------------------
# Standings
# ---------------------------------------------------------------------------


def build_standings(
    season: int,
    team_weeks: Sequence[dict],
    teams: Sequence[dict],
    finish: dict,
    *,
    game_types: Sequence[str] = (GAME_REGULAR,),
) -> list[dict]:
    """One row per owner for a season, with every season metric merged in."""
    summary = metrics.summarize(team_weeks, season=season, game_types=game_types)
    ap = metrics.all_play(team_weeks, season=season, game_types=game_types)
    exp = metrics.expected_wins(summary, ap["totals"])
    sos = metrics.strength_of_schedule(team_weeks, season=season, game_types=game_types)
    luck = metrics.luck_indices(team_weeks, season=season, game_types=game_types)
    dominance = metrics.dominance_rating(summary, ap["totals"])
    season_streaks = metrics.streaks(
        [r for r in team_weeks if r["season"] == season], game_types=game_types
    )

    team_by_owner = {}
    for team in teams:
        if team.get("owner_id"):
            team_by_owner[team["owner_id"]] = team

    final_ranks = finish.get("final_ranks") or {}

    rows = []
    for owner_id, row in summary.items():
        team = team_by_owner.get(owner_id, {})
        team_id = team.get("team_id")
        rows.append(
            {
                "owner_id": owner_id,
                "team_id": team_id,
                "team_name": team.get("team_name"),
                "abbrev": team.get("abbrev"),
                "logo": team.get("logo"),
                **{k: v for k, v in row.items() if k != "id"},
                **{k: v for k, v in ap["totals"].get(owner_id, {}).items() if k != "id"},
                **exp.get(owner_id, {}),
                **sos.get(owner_id, {}),
                **luck.get(owner_id, {}),
                **(dominance.get(owner_id) or {}),
                **season_streaks.get(owner_id, {}),
                "playoff_seed": team.get("playoff_seed"),
                "final_rank": (
                    int(final_ranks[str(team_id)]) if str(team_id) in final_ranks else team.get("final_rank")
                ),
                "is_champion": team_id is not None and team_id == finish.get("champion_team_id"),
                "is_runner_up": team_id is not None and team_id == finish.get("runner_up_team_id"),
                "is_last": team_id is not None and team_id == finish.get("last_place_team_id"),
            }
        )

    # League rank: wins, then points for. This mirrors the most common ESPN
    # tiebreak; ESPN's own configured tiebreak is not exposed reliably, so
    # ``playoff_seed`` is published alongside as ESPN's authoritative answer.
    rows.sort(key=lambda r: (-(r["wins"] + 0.5 * r["ties"]), -(r["points_for"] or 0)))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


# ---------------------------------------------------------------------------
# Careers
# ---------------------------------------------------------------------------


def build_careers(
    team_weeks: Sequence[dict],
    owners: Sequence[dict],
    standings_by_season: dict[int, list[dict]],
    finishes: dict[int, dict],
    *,
    game_types: Sequence[str] = (GAME_REGULAR,),
) -> list[dict]:
    career = metrics.summarize(team_weeks, game_types=game_types)
    career_ap = metrics.all_play(team_weeks, game_types=game_types)
    career_streaks = metrics.streaks(team_weeks, game_types=game_types)
    playoff_summary = metrics.summarize(team_weeks, game_types=(GAME_PLAYOFF,))
    all_games = metrics.summarize(team_weeks, game_types=None)

    rows = []
    for owner in owners:
        owner_id = owner["owner_id"]
        base = career.get(owner_id)
        season_rows = []
        championships = 0
        runner_ups = 0
        playoff_appearances = 0
        finishes_list: list[int] = []

        for season in sorted(owner.get("seasons") or []):
            standings = standings_by_season.get(season) or []
            entry = next((s for s in standings if s["owner_id"] == owner_id), None)
            if entry is None:
                continue
            if entry.get("is_champion"):
                championships += 1
            if entry.get("is_runner_up"):
                runner_ups += 1
            if entry.get("final_rank"):
                finishes_list.append(int(entry["final_rank"]))
            played_playoff = any(
                r["owner_id"] == owner_id
                and r["season"] == season
                and r["game_type"] == GAME_PLAYOFF
                for r in team_weeks
            )
            if played_playoff:
                playoff_appearances += 1
            season_rows.append(
                {
                    "season": season,
                    "team_name": entry.get("team_name"),
                    "record": entry.get("record"),
                    "wins": entry.get("wins"),
                    "losses": entry.get("losses"),
                    "ties": entry.get("ties"),
                    "win_pct": entry.get("win_pct"),
                    "points_for": entry.get("points_for"),
                    "points_against": entry.get("points_against"),
                    "avg_score": entry.get("avg_score"),
                    "rank": entry.get("rank"),
                    "final_rank": entry.get("final_rank"),
                    "playoff_seed": entry.get("playoff_seed"),
                    "all_play_win_pct": entry.get("all_play_win_pct"),
                    "expected_wins": entry.get("expected_wins"),
                    "schedule_luck": entry.get("schedule_luck"),
                    "dominance": entry.get("dominance"),
                    "made_playoffs": played_playoff,
                    "is_champion": entry.get("is_champion"),
                    "is_runner_up": entry.get("is_runner_up"),
                    "is_last": entry.get("is_last"),
                }
            )

        best_season = (
            max(season_rows, key=lambda s: (s["win_pct"] or 0, s["points_for"] or 0))
            if season_rows
            else None
        )
        worst_season = (
            min(season_rows, key=lambda s: (s["win_pct"] or 0, s["points_for"] or 0))
            if season_rows
            else None
        )

        owner_weeks = [r for r in team_weeks if r["owner_id"] == owner_id]
        best_week = max(owner_weeks, key=lambda r: r["score"], default=None)
        worst_week = min(owner_weeks, key=lambda r: r["score"], default=None)
        biggest_win = max(owner_weeks, key=lambda r: r["differential"], default=None)
        worst_loss = min(owner_weeks, key=lambda r: r["differential"], default=None)

        rows.append(
            {
                "owner_id": owner_id,
                "name": owner["name"],
                "member_hash": owner.get("member_hash"),
                "current_team_name": owner.get("current_team_name"),
                "team_name_timeline": owner.get("team_name_timeline"),
                "seasons": owner.get("seasons"),
                "seasons_played": len(owner.get("seasons") or []),
                "first_season": owner.get("first_season"),
                "last_season": owner.get("last_season"),
                "unlinked": owner.get("unlinked", False),
                "note": owner.get("note"),
                **{k: v for k, v in (base or {}).items() if k != "id"},
                **{
                    k: v
                    for k, v in (career_ap["totals"].get(owner_id) or {}).items()
                    if k != "id"
                },
                **career_streaks.get(owner_id, {}),
                "playoff_record": _record_block(playoff_summary.get(owner_id)),
                "all_games_record": _record_block(all_games.get(owner_id)),
                "championships": championships,
                "runner_ups": runner_ups,
                "playoff_appearances": playoff_appearances,
                "avg_finish": r2(statistics.fmean(finishes_list)) if finishes_list else None,
                "best_finish": min(finishes_list) if finishes_list else None,
                "worst_finish": max(finishes_list) if finishes_list else None,
                "seasons_detail": season_rows,
                "best_season": best_season,
                "worst_season": worst_season,
                "best_week": _week_ref(best_week),
                "worst_week": _week_ref(worst_week),
                "biggest_win": _week_ref(biggest_win),
                "worst_loss": _week_ref(worst_loss),
            }
        )

    rows.sort(key=lambda r: (-(r.get("wins") or 0), -(r.get("points_for") or 0)))
    return rows


def _record_block(summary: dict | None) -> dict:
    if not summary:
        return {"games": 0, "record": "0-0", "win_pct": None, "points_for": None}
    return {
        "games": summary["games"],
        "wins": summary["wins"],
        "losses": summary["losses"],
        "ties": summary["ties"],
        "record": summary["record"],
        "win_pct": summary["win_pct"],
        "points_for": summary["points_for"],
        "avg_score": summary["avg_score"],
    }


def _week_ref(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "season": row["season"],
        "week": row["week"],
        "team_name": row.get("team_name"),
        "score": row["score"],
        "opponent_owner_id": row.get("opponent_owner_id"),
        "opponent_team_name": row.get("opponent_team_name"),
        "opponent_score": row.get("opponent_score"),
        "result": row.get("result"),
        "margin": r2(abs(row["differential"])) if row.get("differential") is not None else None,
        "game_type": row.get("game_type"),
        "matchup_id": row.get("matchup_id"),
    }


# ---------------------------------------------------------------------------
# Season and week payloads
# ---------------------------------------------------------------------------


def build_week_payload(
    season: int,
    week: int,
    matchups: Sequence[dict],
    team_weeks: Sequence[dict],
) -> dict:
    week_matchups = [m for m in matchups if m["season"] == season and m["week"] == week]
    week_rows = [r for r in team_weeks if r["season"] == season and r["week"] == week]
    scores = [r["score"] for r in week_rows]
    completed = [m for m in week_matchups if m["completed"] and not m["is_bye"]]

    ranked = sorted(week_rows, key=lambda r: -r["score"])
    leaderboard = [
        {
            "rank": index,
            "owner_id": row["owner_id"],
            "team_name": row["team_name"],
            "score": row["score"],
            "result": row["result"],
            "opponent_owner_id": row["opponent_owner_id"],
            "opponent_team_name": row["opponent_team_name"],
            "opponent_score": row["opponent_score"],
            "game_type": row["game_type"],
            "matchup_id": row["matchup_id"],
        }
        for index, row in enumerate(ranked, start=1)
    ]

    wins = [r for r in week_rows if r["result"] == RESULT_WIN]
    losses = [r for r in week_rows if r["result"] == RESULT_LOSS]

    return {
        "season": season,
        "week": week,
        "has_results": bool(completed),
        "matchups": week_matchups,
        "leaderboard": leaderboard,
        "summary": {
            "teams_played": len(week_rows),
            "league_mean": r2(statistics.fmean(scores)) if scores else None,
            "league_median": r2(statistics.median(scores)) if scores else None,
            "league_stdev": r2(statistics.stdev(scores)) if len(scores) > 1 else None,
            "high": leaderboard[0] if leaderboard else None,
            "low": leaderboard[-1] if leaderboard else None,
            "biggest_blowout": max(completed, key=lambda m: m["margin"], default=None),
            "closest_game": min(completed, key=lambda m: m["margin"], default=None),
            "highest_combined": max(completed, key=lambda m: m["combined"], default=None),
            "lowest_combined": min(completed, key=lambda m: m["combined"], default=None),
            "highest_score_in_loss": _week_ref(
                max(losses, key=lambda r: r["score"], default=None)
            ),
            "lowest_score_in_win": _week_ref(
                min(wins, key=lambda r: r["score"], default=None)
            ),
        },
    }


def build_season_payload(
    season: int,
    season_data: dict,
    standings: Sequence[dict],
    team_weeks: Sequence[dict],
    owners_by_id: dict[str, dict],
) -> dict:
    meta = season_data["meta"]
    matchups = season_data["matchups"]
    finish = season_data["finish"]

    completed_weeks = sorted({m["week"] for m in matchups if m["completed"]})
    scheduled_weeks = sorted({m["week"] for m in matchups})

    weeks = [
        build_week_payload(season, week, matchups, team_weeks) for week in scheduled_weeks
    ]

    season_rows = [r for r in team_weeks if r["season"] == season]
    scores = [r["score"] for r in season_rows if r["game_type"] == GAME_REGULAR]

    champion = next((s for s in standings if s.get("is_champion")), None)
    runner_up = next((s for s in standings if s.get("is_runner_up")), None)

    return {
        "season": season,
        "meta": meta,
        "completed_weeks": completed_weeks,
        "scheduled_weeks": scheduled_weeks,
        "standings": standings,
        "weeks": weeks,
        "bracket": build_bracket(matchups, standings),
        "champion": champion
        and {
            "owner_id": champion["owner_id"],
            "owner_name": (owners_by_id.get(champion["owner_id"]) or {}).get("name"),
            "team_name": champion["team_name"],
            "record": champion["record"],
            "points_for": champion["points_for"],
        },
        "runner_up": runner_up
        and {
            "owner_id": runner_up["owner_id"],
            "owner_name": (owners_by_id.get(runner_up["owner_id"]) or {}).get("name"),
            "team_name": runner_up["team_name"],
        },
        "champion_source": finish.get("source"),
        "league_scoring": {
            "mean": r2(statistics.fmean(scores)) if scores else None,
            "median": r2(statistics.median(scores)) if scores else None,
            "stdev": r2(statistics.stdev(scores)) if len(scores) > 1 else None,
            "high": r2(max(scores)) if scores else None,
            "low": r2(min(scores)) if scores else None,
        },
        "weekly_series": metrics.weekly_series(team_weeks, season=season),
        "leaders": season_leaders(standings),
        "limitations": season_data.get("limitations", []),
    }


def season_leaders(standings: Sequence[dict]) -> list[dict]:
    """Small leaderboards used on season pages."""
    specs = [
        ("points_for", "Points For", True, "points"),
        ("avg_score", "Scoring Average", True, "points per game"),
        ("point_diff", "Point Differential", True, "points"),
        ("all_play_win_pct", "All-Play Win %", True, "win %"),
        ("schedule_luck", "Luckiest", True, "wins above expected"),
        ("schedule_luck", "Unluckiest", False, "wins above expected"),
        ("score_stdev", "Most Consistent", False, "std dev"),
        ("high_score", "Best Single Week", True, "points"),
        ("dominance", "Dominance Rating", True, "0-100"),
        ("sos_z", "Toughest Schedule", True, "opponent z-score"),
    ]
    out = []
    for field, label, descending, unit in specs:
        rows = [s for s in standings if s.get(field) is not None]
        if not rows:
            continue
        rows = sorted(rows, key=lambda s: s[field], reverse=descending)[:5]
        out.append(
            {
                "id": f"{field}-{'desc' if descending else 'asc'}",
                "label": label,
                "unit": unit,
                "entries": [
                    {
                        "owner_id": r["owner_id"],
                        "team_name": r["team_name"],
                        "value": r[field],
                    }
                    for r in rows
                ],
            }
        )
    return out


def build_bracket(matchups: Sequence[dict], standings: Sequence[dict]) -> dict:
    """Group postseason games into rounds for bracket rendering."""
    seed_by_owner = {s["owner_id"]: s.get("playoff_seed") for s in standings}
    post = [
        m
        for m in matchups
        if m["game_type"] in (GAME_PLAYOFF, GAME_CONSOLATION) or m["is_bye"]
    ]
    rounds: dict[int, list[dict]] = defaultdict(list)
    for matchup in sorted(post, key=lambda m: (m["week"], m["matchup_id"])):
        rounds[matchup["week"]].append(
            {
                **matchup,
                "home_seed": seed_by_owner.get(matchup.get("home_owner_id")),
                "away_seed": seed_by_owner.get(matchup.get("away_owner_id")),
            }
        )
    return {
        "rounds": [
            {"week": week, "games": games} for week, games in sorted(rounds.items())
        ],
        "has_playoffs": any(m["game_type"] == GAME_PLAYOFF for m in post),
    }


# ---------------------------------------------------------------------------
# Milestones (used by the homepage "notable" rail)
# ---------------------------------------------------------------------------


def detect_milestones(
    season: int,
    week: int,
    team_weeks: Sequence[dict],
    matchups: Sequence[dict],
    owners_by_id: dict[str, dict],
) -> list[dict]:
    """Which all-time top-10 lists did this week's results enter?"""
    out: list[dict] = []
    if week is None:
        return out

    def owner_name(owner_id):
        return (owners_by_id.get(owner_id) or {}).get("name", owner_id)

    all_scores = sorted(
        (r for r in team_weeks if r.get("score") is not None),
        key=lambda r: -r["score"],
    )
    top_scores = all_scores[:10]
    for rank, row in enumerate(top_scores, start=1):
        if row["season"] == season and row["week"] == week:
            out.append(
                {
                    "kind": "top-score",
                    "rank": rank,
                    "headline": f"{owner_name(row['owner_id'])} posted the #{rank} score in league history",
                    "detail": f"{row['score']:.2f} points as {row['team_name']}",
                    "owner_id": row["owner_id"],
                    "record_id": "highest-score",
                }
            )

    games = [m for m in matchups if m["completed"] and not m["is_bye"]]
    by_margin = sorted(games, key=lambda m: m["margin"])[:10]
    for rank, game in enumerate(by_margin, start=1):
        if game["season"] == season and game["week"] == week:
            out.append(
                {
                    "kind": "closest-game",
                    "rank": rank,
                    "headline": f"#{rank} closest game in league history",
                    "detail": (
                        f"{game['home_team_name']} {game['home_score']:.2f} - "
                        f"{game['away_score']:.2f} {game['away_team_name']}"
                    ),
                    "record_id": "closest-game",
                }
            )

    by_combined = sorted(games, key=lambda m: -m["combined"])[:10]
    for rank, game in enumerate(by_combined, start=1):
        if game["season"] == season and game["week"] == week:
            out.append(
                {
                    "kind": "highest-combined",
                    "rank": rank,
                    "headline": f"#{rank} highest-scoring matchup in league history",
                    "detail": f"{game['combined']:.2f} combined points",
                    "record_id": "highest-combined",
                }
            )

    losses = sorted(
        (r for r in team_weeks if r["result"] == RESULT_LOSS),
        key=lambda r: -r["score"],
    )[:10]
    for rank, row in enumerate(losses, start=1):
        if row["season"] == season and row["week"] == week:
            out.append(
                {
                    "kind": "bad-beat",
                    "rank": rank,
                    "headline": f"#{rank} highest score in a loss, all time",
                    "detail": (
                        f"{owner_name(row['owner_id'])} scored {row['score']:.2f} "
                        f"and lost to {row['opponent_team_name']}"
                    ),
                    "owner_id": row["owner_id"],
                    "record_id": "highest-score-loss",
                }
            )
    return out[:6]
