import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.constants import GAME_PLAYOFF, GAME_REGULAR  # noqa: E402


def tw(season, week, team, score, opp, opp_score, *, game_type=GAME_REGULAR, owner=None,
       opp_owner=None, team_name=None, opp_name=None):
    """Build one team_week row with the result derived, never hand-written."""
    if score > opp_score:
        result = "W"
    elif score < opp_score:
        result = "L"
    else:
        result = "T"
    return {
        "season": season,
        "week": week,
        "matchup_id": f"{season}-{week}-{min(team, opp)}-{max(team, opp)}",
        "game_type": game_type,
        "team_id": team,
        "owner_id": owner or f"owner-{team}",
        "team_name": team_name or f"Team {team}",
        "score": float(score),
        "opponent_team_id": opp,
        "opponent_owner_id": opp_owner or f"owner-{opp}",
        "opponent_team_name": opp_name or f"Team {opp}",
        "opponent_score": float(opp_score),
        "differential": round(float(score) - float(opp_score), 2),
        "result": result,
        "is_home": True,
    }


def pair(season, week, a, a_score, b, b_score, **kwargs):
    """Both sides of one matchup."""
    return [
        tw(season, week, a, a_score, b, b_score, **kwargs),
        tw(season, week, b, b_score, a, a_score, **kwargs),
    ]


@pytest.fixture
def four_team_season():
    """A 4-team, 3-week season with a deliberately lopsided schedule.

    Week 1: 1 beats 2 (120-100), 3 beats 4 (110-90)
    Week 2: 1 beats 3 (130-125), 2 beats 4 (105-80)
    Week 3: 2 beats 1 (140-135), 4 beats 3 (115-70)

    Team 1 scores the most but goes 2-1; team 2 wins 2 with weak scores. This
    is the canonical schedule-luck setup.
    """
    rows = []
    rows += pair(2024, 1, 1, 120, 2, 100)
    rows += pair(2024, 1, 3, 110, 4, 90)
    rows += pair(2024, 2, 1, 130, 3, 125)
    rows += pair(2024, 2, 2, 105, 4, 80)
    rows += pair(2024, 3, 2, 140, 1, 135)
    rows += pair(2024, 3, 4, 115, 3, 70)
    return rows


@pytest.fixture
def tie_season():
    rows = []
    rows += pair(2023, 1, 1, 100, 2, 100)
    rows += pair(2023, 2, 1, 120, 2, 110)
    return rows
