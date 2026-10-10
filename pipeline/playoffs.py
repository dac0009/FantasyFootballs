"""Playoff odds and matchup win probabilities.

The most practical question a manager has mid-season is "where do I stand and
what do I need?". The standings alone cannot answer it, because the answer
depends on who everyone else still has to play. This module simulates the
remainder of the regular season many times and reports what fraction of
those futures end with each team in the bracket.

The model
---------
Each team's weekly score is treated as normally distributed. The mean is the
team's season average, **shrunk toward the league average** in proportion to
how few games have been played, because four games is not much evidence:

    mean_i = (n_i * avg_i + k * league_avg) / (n_i + k)      with k = 4

The standard deviation is pooled across the league (a single team's standard
deviation from a handful of games is far too noisy to use) and inflated
slightly for the same reason. Scores for the two teams in a matchup are drawn
independently, and the higher score wins. Ties are vanishingly rare with
continuous draws and are counted as half a win in the final record.

Final standings in each simulated season rank by wins, then total points for
(actual points plus simulated points). The top ``playoff_team_count`` teams
make the bracket. If the bracket is not a power of two, the top seeds get
byes: a 6-team bracket has 2 byes, a 4- or 8-team bracket has none.

Everything is derived from one seeded random generator, so a rerun on the
same data produces identical numbers.

What it does not do
-------------------
* It does not know ESPN's configured tiebreaker. Wins-then-points is the most
  common and matches this league's published seeds historically, but a league
  with a head-to-head or division tiebreak would differ at the margins.
* It does not model injuries, byes, trades, or roster changes. "Scores like it
  has so far" is the entire assumption.
* With very few games played it leans heavily on the league average, so early
  season odds are deliberately conservative and will cluster near the
  uninformed baseline (playoff spots divided by teams).
"""

from __future__ import annotations

import math
import random
import statistics
from collections import defaultdict
from collections.abc import Sequence

from .constants import GAME_REGULAR
from .metrics import filter_weeks, r2, r3

SIMULATIONS = 5000
SHRINKAGE_GAMES = 4.0
#: Extra variance early in the season when team means are poorly estimated.
EARLY_SEASON_SD_INFLATION = 1.10
MIN_SD = 12.0


def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def scoring_models(
    team_weeks: Sequence[dict],
    season: int,
    owners: Sequence[str],
) -> dict[str, dict]:
    """Per-owner (mean, sd) for the season, with shrinkage and a pooled sd."""
    rows = filter_weeks(team_weeks, game_types=(GAME_REGULAR,), season=season, key="owner_id")
    by_owner: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        by_owner[row["owner_id"]].append(row["score"])

    all_scores = [r["score"] for r in rows]
    league_avg = statistics.fmean(all_scores) if all_scores else 110.0

    # Pooled within-team variance across the league.
    residuals = []
    for scores in by_owner.values():
        if len(scores) > 1:
            mean = statistics.fmean(scores)
            residuals.extend((s - mean) ** 2 for s in scores)
    pooled_sd = (
        math.sqrt(sum(residuals) / max(1, len(residuals) - len(by_owner)))
        if residuals
        else 22.0
    )
    pooled_sd = max(pooled_sd, MIN_SD)
    games_so_far = statistics.fmean([len(v) for v in by_owner.values()]) if by_owner else 0
    if games_so_far < 6:
        pooled_sd *= EARLY_SEASON_SD_INFLATION

    out = {}
    for owner in owners:
        scores = by_owner.get(owner, [])
        n = len(scores)
        raw_mean = statistics.fmean(scores) if scores else league_avg
        shrunk = (n * raw_mean + SHRINKAGE_GAMES * league_avg) / (n + SHRINKAGE_GAMES)
        out[owner] = {
            "games": n,
            "raw_mean": r2(raw_mean),
            "mean": r2(shrunk),
            "sd": r2(pooled_sd),
            "low": r2(shrunk - pooled_sd),
            "high": r2(shrunk + pooled_sd),
        }
    out["_league"] = {"mean": r2(league_avg), "sd": r2(pooled_sd), "games_per_team": r2(games_so_far)}
    return out


def win_probability(model_a: dict, model_b: dict) -> float:
    """P(score_a > score_b) for two independent normals."""
    diff_mean = model_a["mean"] - model_b["mean"]
    diff_sd = math.sqrt(model_a["sd"] ** 2 + model_b["sd"] ** 2)
    if diff_sd <= 0:
        return 0.5
    return _normal_cdf(diff_mean / diff_sd)


def bye_count(playoff_teams: int) -> int:
    if playoff_teams <= 0:
        return 0
    slots = 1 << (playoff_teams - 1).bit_length()  # next power of two
    return slots - playoff_teams


def simulate_season(
    standings: Sequence[dict],
    remaining: Sequence[dict],
    models: dict[str, dict],
    *,
    playoff_teams: int,
    simulations: int = SIMULATIONS,
    seed: int = 20260101,
    condition: dict[str, str] | None = None,
) -> dict[str, dict]:
    """Run the simulation. Returns per-owner outcome frequencies.

    ``condition`` forces the result of specific matchups (``{matchup_id:
    "HOME"|"AWAY"}``) and is how "what if you win this week" is computed.
    """
    rng = random.Random(seed)
    owners = [s["owner_id"] for s in standings]
    base_wins = {s["owner_id"]: s["wins"] + 0.5 * s["ties"] for s in standings}
    base_pf = {s["owner_id"]: float(s["points_for"] or 0.0) for s in standings}
    byes = bye_count(playoff_teams)
    condition = condition or {}

    games = [
        (m["matchup_id"], m["home_owner_id"], m["away_owner_id"])
        for m in remaining
        if m.get("home_owner_id") and m.get("away_owner_id")
    ]

    made = defaultdict(int)
    bye = defaultdict(int)
    seed_counts = defaultdict(lambda: defaultdict(int))
    total_wins = defaultdict(float)

    for _ in range(simulations):
        wins = dict(base_wins)
        pf = dict(base_pf)
        for matchup_id, home, away in games:
            forced = condition.get(matchup_id)
            if forced == "HOME":
                home_score, away_score = 1.0, 0.0
                # Still accumulate plausible points so PF tiebreaks stay sane.
                pf[home] += models[home]["mean"]
                pf[away] += models[away]["mean"]
            elif forced == "AWAY":
                home_score, away_score = 0.0, 1.0
                pf[home] += models[home]["mean"]
                pf[away] += models[away]["mean"]
            else:
                home_score = rng.gauss(models[home]["mean"], models[home]["sd"])
                away_score = rng.gauss(models[away]["mean"], models[away]["sd"])
                pf[home] += home_score
                pf[away] += away_score
            if home_score > away_score:
                wins[home] += 1
            elif away_score > home_score:
                wins[away] += 1
            else:
                wins[home] += 0.5
                wins[away] += 0.5

        order = sorted(owners, key=lambda o: (-wins[o], -pf[o]))
        for position, owner in enumerate(order, start=1):
            seed_counts[owner][position] += 1
            total_wins[owner] += wins[owner]
            if position <= playoff_teams:
                made[owner] += 1
                if position <= byes:
                    bye[owner] += 1

    out = {}
    for owner in owners:
        out[owner] = {
            "playoff_pct": r3(made[owner] / simulations),
            "bye_pct": r3(bye[owner] / simulations) if byes else None,
            "expected_final_wins": r2(total_wins[owner] / simulations),
            "seed_distribution": {
                str(position): r3(count / simulations)
                for position, count in sorted(seed_counts[owner].items())
            },
            "top_seed_pct": r3(seed_counts[owner][1] / simulations),
        }
    return out


def build_playoff_picture(
    season: int,
    standings: Sequence[dict],
    matchups: Sequence[dict],
    team_weeks: Sequence[dict],
    *,
    playoff_teams: int | None,
    regular_season_weeks: int | None,
    simulations: int = SIMULATIONS,
) -> dict | None:
    """The full payload for the playoff picture and this week's swing."""
    if not standings or not playoff_teams:
        return None

    season_games = [m for m in matchups if m["season"] == season and not m["is_bye"]]
    remaining = [
        m
        for m in season_games
        if not m["completed"]
        and (regular_season_weeks is None or m["week"] <= regular_season_weeks)
    ]
    owners = [s["owner_id"] for s in standings]
    models = scoring_models(team_weeks, season, owners)
    league_model = models.pop("_league")

    base = simulate_season(
        standings, remaining, models, playoff_teams=playoff_teams, simulations=simulations
    )

    # This week's games and their swing.
    this_week = min((m["week"] for m in remaining), default=None)
    week_games = [m for m in remaining if m["week"] == this_week] if this_week else []
    swing: dict[str, dict] = {}
    previews = []
    for game in week_games:
        home, away = game["home_owner_id"], game["away_owner_id"]
        if_home = simulate_season(
            standings, remaining, models, playoff_teams=playoff_teams,
            simulations=max(1000, simulations // 3), condition={game["matchup_id"]: "HOME"},
        )
        if_away = simulate_season(
            standings, remaining, models, playoff_teams=playoff_teams,
            simulations=max(1000, simulations // 3), condition={game["matchup_id"]: "AWAY"},
        )
        swing[home] = {
            "if_win": if_home[home]["playoff_pct"],
            "if_loss": if_away[home]["playoff_pct"],
        }
        swing[away] = {
            "if_win": if_away[away]["playoff_pct"],
            "if_loss": if_home[away]["playoff_pct"],
        }
        p_home = win_probability(models[home], models[away])
        previews.append(
            {
                "matchup_id": game["matchup_id"],
                "week": game["week"],
                "home_owner_id": home,
                "away_owner_id": away,
                "home_team_name": game["home_team_name"],
                "away_team_name": game["away_team_name"],
                "home_win_pct": r3(p_home),
                "away_win_pct": r3(1 - p_home),
                "home_model": models[home],
                "away_model": models[away],
                "home_swing": swing[home],
                "away_swing": swing[away],
                # How much this single game moves the two teams' futures.
                "leverage": r3(
                    abs(swing[home]["if_win"] - swing[home]["if_loss"])
                    + abs(swing[away]["if_win"] - swing[away]["if_loss"])
                ),
            }
        )
    previews.sort(key=lambda p: -(p["leverage"] or 0))

    standings_by_owner = {s["owner_id"]: s for s in standings}
    rows = []
    for owner in owners:
        row = base[owner]
        s = standings_by_owner[owner]
        status = (
            "clinched" if row["playoff_pct"] >= 0.9995
            else "eliminated" if row["playoff_pct"] <= 0.0005
            else "alive"
        )
        rows.append(
            {
                "owner_id": owner,
                "team_name": s["team_name"],
                "rank": s["rank"],
                "record": s["record"],
                "points_for": s["points_for"],
                "status": status,
                **row,
                "model": models[owner],
                "this_week": swing.get(owner),
            }
        )
    rows.sort(key=lambda r: (-r["playoff_pct"], -r["expected_final_wins"]))

    return {
        "season": season,
        "as_of_week": this_week - 1 if this_week else regular_season_weeks,
        "next_week": this_week,
        "remaining_regular_season_games": len(remaining),
        "playoff_teams": playoff_teams,
        "byes": bye_count(playoff_teams),
        "simulations": simulations,
        "league_model": league_model,
        "teams": rows,
        "previews": previews,
        "model": {
            "shrinkage_games": SHRINKAGE_GAMES,
            "tiebreak": "wins, then points for",
            "notes": (
                "Weekly scores modelled as normal with the team mean shrunk "
                "toward the league mean and a league-pooled standard "
                "deviation; remaining regular-season games simulated "
                f"{simulations} times."
            ),
        },
    }
