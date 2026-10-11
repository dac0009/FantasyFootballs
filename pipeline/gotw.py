"""Game of the Week selection.

The model scores every *scheduled, not-yet-played* matchup in the next
unplayed week and returns a ranked list plus a plain-English explanation of
why the winner was chosen.

Scoring model (documented so it can be argued with)
---------------------------------------------------
Every component is about *this season* -- what the game means right now, not
what the two franchises have done over the league's history. Each returns
0-1 and is weighted:

================  ======  ==================================================
component         weight  meaning
================  ======  ==================================================
leverage           0.45   how much the game swings both teams' playoff odds,
                          taken straight from the playoff simulation. This is
                          the honest measure of "does this game matter": a
                          game that moves nobody's odds scores 0.
quality            0.30   mean of the two teams' all-play win percentage
                          *this season*. Rewards two teams playing well now.
closeness          0.25   1 - |win prob - 0.5| * 2, from the two teams'
                          current scoring. A coin-flip scores 1, a blowout 0.
================  ======  ==================================================

Rivalry history is deliberately *not* a factor. An eight-year head-to-head
record says nothing about whether a Week 5 game is worth watching, and
folding it in was making old grudges outrank live playoff races. Rivalry
lives on its own pages instead.

No ESPN projection is used. ESPN's ``mMatchupScore`` exposes projected team
totals only for the *current* scoring period and only while a week is live;
it is not reliably available for a future week, and never historically.
The "projected margin" shown with the pick is derived from each team's own
season scoring average and is labelled as such.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence

from .constants import GAME_REGULAR
from .metrics import filter_weeks, r2, r3

WEIGHTS = {
    "leverage": 0.45,
    "quality": 0.30,
    "closeness": 0.25,
}
FORM_WINDOW = 3  # retained for recent_form, used elsewhere
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
    playoff_picture: dict | None = None,
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

    # Leverage and win probability come from the playoff simulation's previews,
    # keyed by matchup. Without a simulation (e.g. no playoff format), leverage
    # falls back to a neutral value and the game is scored on quality and
    # closeness alone.
    previews = {p["matchup_id"]: p for p in (playoff_picture or {}).get("previews", [])}
    max_leverage = max(
        (p.get("leverage") or 0.0 for p in previews.values()),
        default=0.0,
    )

    scored = []
    for matchup in candidates:
        home, away = matchup["home_owner_id"], matchup["away_owner_id"]
        components, reasons = _score_matchup(
            home,
            away,
            standings_by_owner,
            all_play_totals,
            preview=previews.get(matchup["matchup_id"]),
            max_leverage=max_leverage,
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
            "notes": (
                "Every component is about the current season. Leverage is the "
                "combined swing in both teams' playoff odds from the "
                "simulation; quality is this season's all-play; closeness is "
                "the current win probability. Rivalry history is not a factor."
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
    *,
    preview: dict | None,
    max_leverage: float,
) -> tuple[dict[str, float], list[str]]:
    """Score one matchup on three current-season components.

    ``leverage``   how much the game swings both teams' playoff odds, taken
                   from the simulation preview and normalised against the
                   week's most pivotal game. The honest "does it matter".
    ``quality``    mean of the two teams' all-play win % this season.
    ``closeness``  how close the game projects to be, from win probability.
    """
    reasons: list[str] = []

    # leverage ------------------------------------------------------------
    if preview is not None and max_leverage > 0:
        leverage = _clamp((preview.get("leverage") or 0.0) / max_leverage)
    else:
        leverage = 0.0
    if preview is not None:
        swings = []
        for side in ("home_swing", "away_swing"):
            sw = preview.get(side) or {}
            if "if_win" in sw and "if_loss" in sw:
                swings.append(round((sw["if_win"] - sw["if_loss"]) * 100))
        big = max(swings) if swings else 0
        if big >= 25:
            reasons.append(f"swings a playoff spot by up to {big} points")
        elif big >= 12:
            reasons.append("moves both teams' playoff odds meaningfully")

    # quality -------------------------------------------------------------
    ap_home = (all_play_totals.get(home) or {}).get("all_play_win_pct")
    ap_away = (all_play_totals.get(away) or {}).get("all_play_win_pct")
    if ap_home is not None and ap_away is not None:
        quality = (ap_home + ap_away) / 2
        ranked = sorted(
            (o for o in all_play_totals if all_play_totals[o]["all_play_win_pct"] is not None),
            key=lambda o: -all_play_totals[o]["all_play_win_pct"],
        )
        if home in ranked and away in ranked:
            reasons.append(
                f"#{ranked.index(home) + 1} vs #{ranked.index(away) + 1} in all-play this season"
            )
        if quality >= 0.55:
            reasons.append("both teams scoring above the league this season")
    else:
        quality = 0.5

    # closeness -----------------------------------------------------------
    if preview is not None and preview.get("home_win_pct") is not None:
        p_home = preview["home_win_pct"]
        closeness = _clamp(1.0 - abs(p_home - 0.5) * 2.0)
        fav = max(p_home, 1 - p_home)
        if fav <= 0.56:
            reasons.append(f"a coin flip ({round(p_home * 100)}% / {round((1 - p_home) * 100)}%)")
    else:
        closeness = 0.5

    return {"leverage": leverage, "quality": quality, "closeness": closeness}, reasons


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
