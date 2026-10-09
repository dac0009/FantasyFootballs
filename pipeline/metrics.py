"""The statistical engine.

Every function takes plain ``team_week`` rows (as produced by
:mod:`pipeline.extract`) and returns plain dicts, so each one is directly
unit-testable with hand-written fixtures.

Conventions that apply everywhere
---------------------------------
* A tie counts as half a win in every win-percentage calculation.
* Only ``completed`` games are ever counted. ``extract`` already drops
  incomplete games from ``team_weeks``, but callers may pass filtered views.
* ``game_types`` filters on our own vocabulary (``regular``, ``playoff``,
  ``consolation``). The default everywhere is regular season only, because
  mixing a 12-team consolation ladder into a career win percentage produces
  numbers nobody can interpret.
* Sample standard deviation (n-1) is used; a single game yields ``None``
  rather than ``0``, which would falsely imply perfect consistency.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Iterable, Sequence

from .constants import GAME_REGULAR, RESULT_LOSS, RESULT_TIE, RESULT_WIN

DEFAULT_GAME_TYPES: tuple[str, ...] = (GAME_REGULAR,)


def r2(value):
    return None if value is None else round(float(value), 2)


def r3(value):
    return None if value is None else round(float(value), 3)


def filter_weeks(
    team_weeks: Iterable[dict],
    *,
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
    season: int | None = None,
    key: str = "owner_id",
) -> list[dict]:
    rows = []
    for row in team_weeks:
        if season is not None and row.get("season") != season:
            continue
        if game_types is not None and row.get("game_type") not in game_types:
            continue
        if row.get(key) is None or row.get("score") is None:
            continue
        rows.append(row)
    return rows


def win_pct(wins: float, losses: float, ties: float) -> float | None:
    games = wins + losses + ties
    if not games:
        return None
    return (wins + 0.5 * ties) / games


# ---------------------------------------------------------------------------
# Core per-entity summary
# ---------------------------------------------------------------------------


def summarize(
    team_weeks: Iterable[dict],
    *,
    key: str = "owner_id",
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
    season: int | None = None,
) -> dict[str, dict]:
    """Aggregate scoring and record for each entity (owner or team).

    Returns ``{entity_id: summary}``.
    """
    rows = filter_weeks(team_weeks, game_types=game_types, season=season, key=key)
    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[row[key]].append(row)

    out: dict[str, dict] = {}
    for entity, entity_rows in buckets.items():
        scores = [r["score"] for r in entity_rows]
        against = [r["opponent_score"] for r in entity_rows]
        wins = sum(1 for r in entity_rows if r["result"] == RESULT_WIN)
        losses = sum(1 for r in entity_rows if r["result"] == RESULT_LOSS)
        ties = sum(1 for r in entity_rows if r["result"] == RESULT_TIE)
        games = len(entity_rows)

        out[entity] = {
            "id": entity,
            "games": games,
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "record": format_record(wins, losses, ties),
            "win_pct": r3(win_pct(wins, losses, ties)),
            "points_for": r2(sum(scores)),
            "points_against": r2(sum(against)),
            "point_diff": r2(sum(scores) - sum(against)),
            "avg_score": r2(statistics.fmean(scores)),
            "avg_against": r2(statistics.fmean(against)),
            "median_score": r2(statistics.median(scores)),
            "high_score": r2(max(scores)),
            "low_score": r2(min(scores)),
            "score_stdev": r2(statistics.stdev(scores)) if games > 1 else None,
            "avg_margin": r2(statistics.fmean([r["differential"] for r in entity_rows])),
            "games_150_plus": sum(1 for s in scores if s >= 150),
            "games_under_100": sum(1 for s in scores if s < 100),
        }
        sd = out[entity]["score_stdev"]
        avg = out[entity]["avg_score"]
        out[entity]["coefficient_of_variation"] = (
            r3(sd / avg) if sd is not None and avg else None
        )
    return out


def format_record(wins: int, losses: int, ties: int) -> str:
    return f"{wins}-{losses}-{ties}" if ties else f"{wins}-{losses}"


# ---------------------------------------------------------------------------
# All-play, expected wins, schedule luck
# ---------------------------------------------------------------------------


def all_play(
    team_weeks: Iterable[dict],
    *,
    key: str = "owner_id",
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
    season: int | None = None,
) -> dict[str, dict]:
    """All-play record: every team's score versus every other score that week.

    Definition
    ----------
    For each (season, week), each participating team is compared with every
    other participating team's score. A higher score is a win, lower a loss,
    equal a tie.

    Limitation
    ----------
    In postseason weeks only a subset of the league plays, so the comparison
    pool shrinks. That is why the default filter is the regular season, where
    every team plays every week and all-play is a clean measure of weekly
    scoring strength.
    """
    rows = filter_weeks(team_weeks, game_types=game_types, season=season, key=key)
    by_week: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for row in rows:
        by_week[(row["season"], row["week"])].append(row)

    totals: dict[str, dict] = defaultdict(
        lambda: {"wins": 0, "losses": 0, "ties": 0, "weeks": 0}
    )
    per_week: list[dict] = []

    for (season_id, week), week_rows in sorted(by_week.items()):
        # Guard against the same entity appearing twice in one week (a data
        # bug, or an owner holding two teams); aggregate deterministically.
        scores = [(r[key], r["score"]) for r in week_rows]
        for entity, score in scores:
            wins = sum(1 for other, other_score in scores if other != entity and other_score < score)
            losses = sum(1 for other, other_score in scores if other != entity and other_score > score)
            ties = sum(1 for other, other_score in scores if other != entity and other_score == score)
            totals[entity]["wins"] += wins
            totals[entity]["losses"] += losses
            totals[entity]["ties"] += ties
            totals[entity]["weeks"] += 1
            per_week.append(
                {
                    "season": season_id,
                    "week": week,
                    key: entity,
                    "score": score,
                    "all_play_wins": wins,
                    "all_play_losses": losses,
                    "all_play_ties": ties,
                    "weekly_rank": losses + 1,
                    "field_size": len(scores),
                }
            )

    out: dict[str, dict] = {}
    for entity, agg in totals.items():
        pct = win_pct(agg["wins"], agg["losses"], agg["ties"])
        out[entity] = {
            "id": entity,
            "all_play_wins": agg["wins"],
            "all_play_losses": agg["losses"],
            "all_play_ties": agg["ties"],
            "all_play_record": format_record(agg["wins"], agg["losses"], agg["ties"]),
            "all_play_win_pct": r3(pct),
            "weeks": agg["weeks"],
        }
    return {"totals": out, "per_week": per_week}


def expected_wins(summary: dict[str, dict], all_play_totals: dict[str, dict]) -> dict[str, dict]:
    """Expected wins and schedule luck.

    ``expected_wins = all_play_win_pct * games_played``

    This answers: "given how this team scored each week, how many games would
    an average schedule have won?" ``schedule_luck`` is actual minus expected,
    so +1.5 means the schedule handed the team roughly a win and a half.

    Limitation: all-play treats every week as independent and ignores who was
    actually played. It measures scoring strength, not roster skill, and a
    team that happens to peak in weeks when the league is cold will look
    luckier than it is.
    """
    out: dict[str, dict] = {}
    for entity, row in summary.items():
        ap = all_play_totals.get(entity)
        if not ap or ap["all_play_win_pct"] is None or not row["games"]:
            out[entity] = {"expected_wins": None, "schedule_luck": None}
            continue
        exp = ap["all_play_win_pct"] * row["games"]
        actual = row["wins"] + 0.5 * row["ties"]
        out[entity] = {
            "expected_wins": r2(exp),
            "actual_wins": r2(actual),
            "schedule_luck": r2(actual - exp),
            "luck_per_game": r3((actual - exp) / row["games"]),
        }
    return out


# ---------------------------------------------------------------------------
# Strength of schedule
# ---------------------------------------------------------------------------


def league_week_stats(
    team_weeks: Iterable[dict],
    *,
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
    season: int | None = None,
) -> dict[tuple[int, int], dict]:
    rows = filter_weeks(team_weeks, game_types=game_types, season=season, key="team_id")
    by_week: dict[tuple[int, int], list[float]] = defaultdict(list)
    for row in rows:
        by_week[(row["season"], row["week"])].append(row["score"])
    out = {}
    for week_key, scores in by_week.items():
        out[week_key] = {
            "mean": statistics.fmean(scores),
            "median": statistics.median(scores),
            "stdev": statistics.stdev(scores) if len(scores) > 1 else None,
            "count": len(scores),
            "high": max(scores),
            "low": min(scores),
        }
    return out


def strength_of_schedule(
    team_weeks: Iterable[dict],
    *,
    key: str = "owner_id",
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
    season: int | None = None,
) -> dict[str, dict]:
    """How hard were the scores a team actually had to beat?

    Two complementary numbers:

    ``sos_points``
        Mean opponent score faced minus the league mean score over the same
        weeks. Positive means tougher-than-average opponents. Units: points.

    ``sos_z``
        Mean of the opponent's weekly z-score (opponent score minus that
        week's league mean, divided by that week's league standard deviation).
        Unitless, so it is comparable across seasons with different scoring
        settings, and it is not distorted by a single high-scoring week.

    Limitation: both treat the opponent's actual score as the difficulty of
    the matchup. That is the honest measure for a fantasy schedule (you play
    a score, not a roster), but it is backward-looking -- it is not a forecast
    of future schedule difficulty.
    """
    rows = filter_weeks(team_weeks, game_types=game_types, season=season, key=key)
    week_stats = league_week_stats(team_weeks, game_types=game_types, season=season)

    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[row[key]].append(row)

    out: dict[str, dict] = {}
    for entity, entity_rows in buckets.items():
        point_deltas = []
        z_scores = []
        for row in entity_rows:
            stats = week_stats.get((row["season"], row["week"]))
            if not stats:
                continue
            point_deltas.append(row["opponent_score"] - stats["mean"])
            if stats["stdev"]:
                z_scores.append((row["opponent_score"] - stats["mean"]) / stats["stdev"])
        out[entity] = {
            "sos_points": r2(statistics.fmean(point_deltas)) if point_deltas else None,
            "sos_z": r3(statistics.fmean(z_scores)) if z_scores else None,
            "opponent_avg_score": r2(
                statistics.fmean([r["opponent_score"] for r in entity_rows])
            )
            if entity_rows
            else None,
        }
    return out


# ---------------------------------------------------------------------------
# Luck-flavoured indices
# ---------------------------------------------------------------------------


def luck_indices(
    team_weeks: Iterable[dict],
    *,
    key: str = "owner_id",
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
    season: int | None = None,
) -> dict[str, dict]:
    """Bad Beat Index and Fortunate Win Index.

    ``bad_beat_index``
        Sum over losses of ``max(0, z)`` where ``z`` is the team's own weekly
        z-score. A team that loses while scoring two standard deviations above
        the league mean contributes 2.0. High values mean strong performances
        were repeatedly wasted.

    ``fortunate_win_index``
        Sum over wins of ``max(0, -z)``. High values mean wins were collected
        while scoring below the league norm.

    Both are *sums*, so they grow with games played; the per-game variants are
    provided for cross-season comparison. Neither is predictive -- they
    describe what happened, not skill.
    """
    rows = filter_weeks(team_weeks, game_types=game_types, season=season, key=key)
    week_stats = league_week_stats(team_weeks, game_types=game_types, season=season)

    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[row[key]].append(row)

    out: dict[str, dict] = {}
    for entity, entity_rows in buckets.items():
        bad_beat = 0.0
        fortunate = 0.0
        worst_beat = None
        luckiest_win = None
        counted = 0
        for row in entity_rows:
            stats = week_stats.get((row["season"], row["week"]))
            if not stats or not stats["stdev"]:
                continue
            z = (row["score"] - stats["mean"]) / stats["stdev"]
            counted += 1
            if row["result"] == RESULT_LOSS and z > 0:
                bad_beat += z
                if worst_beat is None or z > worst_beat["z"]:
                    worst_beat = {"z": r3(z), **_ref(row)}
            elif row["result"] == RESULT_WIN and z < 0:
                fortunate += -z
                if luckiest_win is None or -z > luckiest_win["z"]:
                    luckiest_win = {"z": r3(-z), **_ref(row)}
        out[entity] = {
            "bad_beat_index": r3(bad_beat),
            "fortunate_win_index": r3(fortunate),
            "bad_beat_per_game": r3(bad_beat / counted) if counted else None,
            "fortunate_win_per_game": r3(fortunate / counted) if counted else None,
            "worst_bad_beat": worst_beat,
            "luckiest_win": luckiest_win,
        }
    return out


def _ref(row: dict) -> dict:
    return {
        "season": row["season"],
        "week": row["week"],
        "team_name": row.get("team_name"),
        "score": row["score"],
        "opponent_owner_id": row.get("opponent_owner_id"),
        "opponent_team_name": row.get("opponent_team_name"),
        "opponent_score": row.get("opponent_score"),
    }


# ---------------------------------------------------------------------------
# Streaks and trends
# ---------------------------------------------------------------------------


def streaks(
    team_weeks: Iterable[dict],
    *,
    key: str = "owner_id",
    game_types: Sequence[str] | None = DEFAULT_GAME_TYPES,
) -> dict[str, dict]:
    """Longest win/loss streaks and the current streak, in chronological order."""
    rows = sorted(
        filter_weeks(team_weeks, game_types=game_types, key=key),
        key=lambda r: (r["season"], r["week"]),
    )
    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[row[key]].append(row)

    out: dict[str, dict] = {}
    for entity, entity_rows in buckets.items():
        best_w = best_l = 0
        run_type = None
        run_len = 0
        for row in entity_rows:
            result = row["result"]
            if result == run_type:
                run_len += 1
            else:
                run_type, run_len = result, 1
            if result == RESULT_WIN:
                best_w = max(best_w, run_len)
            elif result == RESULT_LOSS:
                best_l = max(best_l, run_len)
        out[entity] = {
            "longest_win_streak": best_w,
            "longest_loss_streak": best_l,
            "current_streak": f"{run_type}{run_len}" if run_type else None,
            "current_streak_type": run_type,
            "current_streak_length": run_len if run_type else 0,
        }
    return out


def weekly_series(
    team_weeks: Iterable[dict],
    *,
    season: int,
    key: str = "owner_id",
    game_types: Sequence[str] | None = None,
) -> list[dict]:
    """Per-week score series for charting, with the league mean per week."""
    rows = filter_weeks(team_weeks, game_types=game_types, season=season, key=key)
    week_stats = league_week_stats(team_weeks, game_types=game_types, season=season)
    out = []
    for row in sorted(rows, key=lambda r: (r["week"], r[key])):
        stats = week_stats.get((row["season"], row["week"])) or {}
        out.append(
            {
                "week": row["week"],
                key: row[key],
                "team_name": row.get("team_name"),
                "score": row["score"],
                "opponent_score": row["opponent_score"],
                "result": row["result"],
                "game_type": row["game_type"],
                "league_mean": r2(stats.get("mean")),
                "weekly_rank": _rank_in_week(rows, row, key),
            }
        )
    return out


def _rank_in_week(rows: list[dict], target: dict, key: str) -> int:
    peers = [r for r in rows if r["season"] == target["season"] and r["week"] == target["week"]]
    higher = sum(1 for r in peers if r["score"] > target["score"])
    return higher + 1


# ---------------------------------------------------------------------------
# Composite rating
# ---------------------------------------------------------------------------


def dominance_rating(
    summary: dict[str, dict],
    all_play_totals: dict[str, dict],
) -> dict[str, dict]:
    """A composite 0-100 power score.

    ``dominance = 100 * (0.50 * all_play_pct_scaled
                       + 0.30 * avg_score_scaled
                       + 0.20 * point_diff_scaled)``

    Each component is min-max scaled across the entities being compared, so
    the rating is *relative to the group*: it answers "who was strongest in
    this league, this season", not "how good is this team in the abstract".
    All-play carries the most weight because it is the least schedule-
    dependent signal available. A rating cannot be compared across seasons
    unless both seasons were scaled together.

    With fewer than two entities, or no spread in a component, the component
    contributes its neutral midpoint (0.5) rather than dividing by zero.
    """
    entities = [e for e in summary if e in all_play_totals]
    if not entities:
        return {}

    def scaled(values: dict[str, float | None]) -> dict[str, float]:
        present = [v for v in values.values() if v is not None]
        if len(present) < 2:
            return dict.fromkeys(values, 0.5)
        lo, hi = min(present), max(present)
        if hi == lo:
            return dict.fromkeys(values, 0.5)
        return {
            k: (0.5 if v is None else (v - lo) / (hi - lo)) for k, v in values.items()
        }

    ap = scaled({e: all_play_totals[e]["all_play_win_pct"] for e in entities})
    avg = scaled({e: summary[e]["avg_score"] for e in entities})
    diff = scaled({e: summary[e]["point_diff"] for e in entities})

    return {
        e: {
            "dominance": r2(100 * (0.50 * ap[e] + 0.30 * avg[e] + 0.20 * diff[e])),
            "components": {
                "all_play": r3(ap[e]),
                "avg_score": r3(avg[e]),
                "point_diff": r3(diff[e]),
            },
        }
        for e in entities
    }


# ---------------------------------------------------------------------------
# Roster-derived: manager efficiency / bench regret
# ---------------------------------------------------------------------------


def optimal_lineup(
    entries: Sequence[dict],
    slot_counts: dict[int, int],
    eligibility: dict[int, set[str]],
) -> tuple[float, list[dict]]:
    """Greedy-by-scarcity optimal lineup.

    Slots are filled from most restrictive (fewest eligible positions) to
    least restrictive, taking the highest remaining scorer each time. For
    standard fantasy slot sets this is provably optimal because the
    eligibility sets are nested (QB subset of superflex, RB subset of flex,
    and so on); it is a heuristic only if a league defines overlapping,
    non-nested slots.
    """
    available = sorted(
        [e for e in entries if e.get("points") is not None],
        key=lambda e: -e["points"],
    )
    used: set[int] = set()
    chosen: list[dict] = []
    ordered_slots: list[int] = []
    for slot_id, count in slot_counts.items():
        ordered_slots.extend([slot_id] * int(count))
    ordered_slots.sort(key=lambda s: len(eligibility.get(s, set())) or 99)

    for slot_id in ordered_slots:
        eligible_positions = eligibility.get(slot_id)
        best = None
        for idx, entry in enumerate(available):
            if idx in used:
                continue
            if eligible_positions and entry.get("position") not in eligible_positions:
                continue
            best = idx
            break
        if best is None:
            continue
        used.add(best)
        chosen.append({**available[best], "assigned_slot_id": slot_id})
    total = round(sum(e["points"] for e in chosen), 2)
    return total, chosen


def manager_efficiency(
    roster_rows: Iterable[dict],
    players: dict[int, dict],
    slot_counts: dict[int, int],
    eligibility: dict[int, set[str]],
    *,
    key: str = "owner_id",
) -> dict[str, dict]:
    """Actual starting-lineup score versus the best lineup that was available.

    ``efficiency = actual_started_points / optimal_points``
    ``bench_regret = optimal_points - actual_started_points``

    Limitations: this is pure hindsight. It assumes the manager should have
    known which bench player would outscore which starter, ignores players who
    were injured or on bye at lock time, and ignores the IR slot's eligibility
    rules. It is best read as "points left on the table", not as a verdict on
    decision quality.
    """
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for row in roster_rows:
        entity = row.get(key)
        if entity is None:
            continue
        buckets[(entity, row["season"], row["week"])].append(row)

    per_entity: dict[str, dict] = defaultdict(
        lambda: {
            "actual": 0.0,
            "optimal": 0.0,
            "weeks": 0,
            "worst_week": None,
            "biggest_bench": None,
        }
    )

    for (entity, season, week), rows in buckets.items():
        enriched = []
        for row in rows:
            player = players.get(row["player_id"]) or {}
            enriched.append(
                {
                    **row,
                    "position": player.get("position", "UNK"),
                    "name": player.get("name", f"Player {row['player_id']}"),
                }
            )
        actual = round(
            sum(e["points"] for e in enriched if e.get("started") and e.get("points") is not None),
            2,
        )
        best, _chosen = optimal_lineup(enriched, slot_counts, eligibility)
        if best <= 0:
            continue
        agg = per_entity[entity]
        agg["actual"] += actual
        agg["optimal"] += best
        agg["weeks"] += 1
        regret = round(best - actual, 2)
        if agg["worst_week"] is None or regret > agg["worst_week"]["regret"]:
            agg["worst_week"] = {
                "season": season,
                "week": week,
                "regret": regret,
                "actual": actual,
                "optimal": best,
            }
        bench_best = max(
            (e for e in enriched if not e.get("started") and e.get("points") is not None),
            key=lambda e: e["points"],
            default=None,
        )
        if bench_best and (
            agg["biggest_bench"] is None or bench_best["points"] > agg["biggest_bench"]["points"]
        ):
            agg["biggest_bench"] = {
                "season": season,
                "week": week,
                "player": bench_best["name"],
                "position": bench_best["position"],
                "points": bench_best["points"],
            }

    out: dict[str, dict] = {}
    for entity, agg in per_entity.items():
        if not agg["optimal"]:
            continue
        out[entity] = {
            "started_points": r2(agg["actual"]),
            "optimal_points": r2(agg["optimal"]),
            "manager_efficiency": r3(agg["actual"] / agg["optimal"]),
            "bench_regret_total": r2(agg["optimal"] - agg["actual"]),
            "bench_regret_per_week": r2((agg["optimal"] - agg["actual"]) / agg["weeks"]),
            "weeks_measured": agg["weeks"],
            "worst_lineup_week": agg["worst_week"],
            "biggest_bench_performance": agg["biggest_bench"],
        }
    return out
