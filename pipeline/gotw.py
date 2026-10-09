"""Game of the Week selection.

The model scores every *scheduled, not-yet-played* matchup in the next
unplayed week and returns a ranked list plus a plain-English explanation of
why the winner was chosen.

Scoring model (documented so it can be argued with)
---------------------------------------------------
Each component returns 0-1 and is weighted:

================  ======  ==================================================
component         weight  meaning
================  ======  ==================================================
quality            0.30   mean of the two teams' all-play win percentage.
                          Rewards two genuinely good teams.
parity             0.25   1 - |all_play_a - all_play_b|, scaled. Rewards two
                          evenly matched teams; a 1-11 team against an 11-1
                          team scores 0.
stakes             0.20   how close both teams are to the playoff cut line,
                          and how late in the season it is. Rewards games
                          that actually decide something.
form               0.15   mean of each team's scoring z-score over the last
                          three completed weeks. Rewards teams playing well
                          right now rather than in September.
rivalry            0.10   the pair's rivalry index / 100.
================  ======  ==================================================

No ESPN projection is used. ESPN's ``mMatchupScore`` exposes projected team
totals only for the *current* scoring period and only while a week is live;
it is not reliably available for a future week, and it is never available
historically. Rather than fake a projected margin, the model reports a
"projected margin" only when every participating team has at least three
completed games, and derives it from each team's own mean score -- which is
labelled as such on the page.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence

from .constants import GAME_REGULAR
from .head_to_head import pair_key
from .metrics import filter_weeks, r2, r3

WEIGHTS = {
    "quality": 0.30,
    "parity": 0.25,
    "stakes": 0.20,
    "form": 0.15,
    "rivalry": 0.10,
}
FORM_WINDOW = 3
MIN_GAMES_FOR_PROJECTION = 3


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def recent_form(
    team_weeks: Sequence[dict],
    season: int,
    *,
    window: int = FORM_WINDOW,
) -> dict[str, float]:
    """Mean z-score of each owner's last ``window`` completed weeks."""
    rows = filter_weeks(team_weeks, game_types=(GAME_REGULAR,), season=season, key="owner_id")
    if not rows:
        return {}
    by_week: dict[int, list[float]] = {}
    for row in rows:
        by_week.setdefault(row["week"], []).append(row["score"])
    stats = {
        week: (statistics.fmean(scores), statistics.stdev(scores) if len(scores) > 1 else None)
        for week, scores in by_week.items()
    }
    recent_weeks = sorted(by_week)[-window:]
    out: dict[str, list[float]] = {}
    for row in rows:
        if row["week"] not in recent_weeks:
            continue
        mean, sd = stats[row["week"]]
        if not sd:
            continue
        out.setdefault(row["owner_id"], []).append((row["score"] - mean) / sd)
    return {owner: statistics.fmean(values) for owner, values in out.items() if values}


def select_game_of_the_week(
    matchups: Sequence[dict],
    team_weeks: Sequence[dict],
    standings: Sequence[dict],
    all_play_totals: dict[str, dict],
    h2h_pairs: dict[str, dict],
    season: int,
    *,
    playoff_team_count: int | None,
    regular_season_weeks: int | None,
) -> dict | None:
    upcoming_week = next_unplayed_week(matchups, season)
    if upcoming_week is None:
        return None

    candidates = [
        m
        for m in matchups
        if m["season"] == season
        and m["week"] == upcoming_week
        and not m["completed"]
        and not m["is_bye"]
        and m["home_owner_id"]
        and m["away_owner_id"]
    ]
    if not candidates:
        return None

    standings_by_owner = {s["owner_id"]: s for s in standings}
    form = recent_form(team_weeks, season)
    total_teams = len(standings_by_owner) or 1
    cut = playoff_team_count or max(1, total_teams // 2)

    scored = []
    for matchup in candidates:
        home, away = matchup["home_owner_id"], matchup["away_owner_id"]
        components, reasons = _score_matchup(
            home,
            away,
            standings_by_owner,
            all_play_totals,
            h2h_pairs,
            form,
            cut=cut,
            total_teams=total_teams,
            week=upcoming_week,
            regular_season_weeks=regular_season_weeks,
        )
        score = sum(WEIGHTS[name] * value for name, value in components.items())
        scored.append(
            {
                "matchup_id": matchup["matchup_id"],
                "week": upcoming_week,
                "season": season,
                "home_owner_id": home,
                "away_owner_id": away,
                "home_team_name": matchup["home_team_name"],
                "away_team_name": matchup["away_team_name"],
                "score": r3(score),
                "components": {k: r3(v) for k, v in components.items()},
                "weights": WEIGHTS,
                "reasons": reasons,
                "projection": _projection(home, away, standings_by_owner),
            }
        )

    scored.sort(key=lambda row: -row["score"])
    return {
        "season": season,
        "week": upcoming_week,
        "model": {
            "weights": WEIGHTS,
            "form_window": FORM_WINDOW,
            "notes": (
                "Components are each scaled 0-1 and combined with the weights "
                "shown. No ESPN projection is used; the projected margin is "
                "derived from each team's own season scoring average."
            ),
        },
        "pick": scored[0],
        "ranked": scored,
    }


def next_unplayed_week(matchups: Sequence[dict], season: int) -> int | None:
    season_games = [m for m in matchups if m["season"] == season and not m["is_bye"]]
    if not season_games:
        return None
    pending = sorted({m["week"] for m in season_games if not m["completed"]})
    return pending[0] if pending else None


def _score_matchup(
    home: str,
    away: str,
    standings_by_owner: dict[str, dict],
    all_play_totals: dict[str, dict],
    h2h_pairs: dict[str, dict],
    form: dict[str, float],
    *,
    cut: int,
    total_teams: int,
    week: int,
    regular_season_weeks: int | None,
) -> tuple[dict[str, float], list[str]]:
    reasons: list[str] = []

    ap_home = (all_play_totals.get(home) or {}).get("all_play_win_pct")
    ap_away = (all_play_totals.get(away) or {}).get("all_play_win_pct")
    if ap_home is not None and ap_away is not None:
        quality = (ap_home + ap_away) / 2
        parity = _clamp(1.0 - abs(ap_home - ap_away) * 2.0)
        ranked = sorted(
            [o for o in all_play_totals if all_play_totals[o]["all_play_win_pct"] is not None],
            key=lambda o: -all_play_totals[o]["all_play_win_pct"],
        )
        if home in ranked and away in ranked:
            reasons.append(
                f"#{ranked.index(home) + 1} vs #{ranked.index(away) + 1} in all-play record"
            )
        if quality >= 0.55:
            reasons.append(
                f"both teams above .500 in all-play ({ap_home:.3f} and {ap_away:.3f})"
            )
        if parity >= 0.8:
            reasons.append("the two teams are nearly indistinguishable by all-play")
    else:
        quality, parity = 0.5, 0.5

    home_rank = (standings_by_owner.get(home) or {}).get("rank")
    away_rank = (standings_by_owner.get(away) or {}).get("rank")
    stakes = 0.4
    if home_rank and away_rank:
        # Closeness to the playoff cut line, averaged, plus a lateness boost.
        bubble = statistics.fmean(
            [
                _clamp(1.0 - abs(home_rank - cut - 0.5) / max(total_teams / 2, 1)),
                _clamp(1.0 - abs(away_rank - cut - 0.5) / max(total_teams / 2, 1)),
            ]
        )
        lateness = _clamp(week / regular_season_weeks) if regular_season_weeks else 0.5
        stakes = _clamp(0.6 * bubble + 0.4 * lateness)
        if min(home_rank, away_rank) <= 3 and max(home_rank, away_rank) <= 6:
            reasons.append(f"both teams in the top six ({home_rank} and {away_rank} in the standings)")
        elif abs(home_rank - cut) <= 2 and abs(away_rank - cut) <= 2:
            reasons.append("both teams are on the playoff bubble")
        if regular_season_weeks and week >= regular_season_weeks - 2:
            reasons.append(f"week {week} of a {regular_season_weeks}-week regular season")

    form_home = form.get(home)
    form_away = form.get(away)
    if form_home is not None and form_away is not None:
        form_score = _clamp((statistics.fmean([form_home, form_away]) + 1.5) / 3.0)
        if min(form_home, form_away) > 0.3:
            reasons.append(
                f"both scoring above league average over the last {FORM_WINDOW} weeks"
            )
    else:
        form_score = 0.5

    rivalry = h2h_pairs.get(pair_key(home, away))
    rivalry_score = 0.0
    if rivalry:
        rivalry_score = (rivalry["rivalry_index"]["score"] or 0) / 100.0
        overall = rivalry["overall"]
        is_left = rivalry["left_owner_id"] == home
        home_wins = overall["left_wins"] if is_left else overall["right_wins"]
        away_wins = overall["right_wins"] if is_left else overall["left_wins"]
        if overall["games"] >= 3:
            if home_wins == away_wins:
                reasons.append(f"career series dead even at {home_wins}-{away_wins}")
            else:
                reasons.append(f"career series {home_wins}-{away_wins}")
        if rivalry["playoff"]["games"]:
            reasons.append(
                f"{rivalry['playoff']['games']} previous playoff meeting(s)"
            )

    return (
        {
            "quality": quality,
            "parity": parity,
            "stakes": stakes,
            "form": form_score,
            "rivalry": rivalry_score,
        },
        reasons,
    )


def _projection(home: str, away: str, standings_by_owner: dict[str, dict]) -> dict | None:
    home_row = standings_by_owner.get(home) or {}
    away_row = standings_by_owner.get(away) or {}
    if (home_row.get("games") or 0) < MIN_GAMES_FOR_PROJECTION:
        return None
    if (away_row.get("games") or 0) < MIN_GAMES_FOR_PROJECTION:
        return None
    home_avg = home_row.get("avg_score")
    away_avg = away_row.get("avg_score")
    if home_avg is None or away_avg is None:
        return None
    return {
        "basis": "season scoring average",
        "home_expected": r2(home_avg),
        "away_expected": r2(away_avg),
        "expected_margin": r2(abs(home_avg - away_avg)),
        "favorite_owner_id": home if home_avg >= away_avg else away,
        "caveat": (
            "Derived from each team's own season average, not from an ESPN "
            "projection. ESPN does not expose reliable projected totals for "
            "a future week."
        ),
    }
