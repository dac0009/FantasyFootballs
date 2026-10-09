"""Record book tests."""

import pytest
from conftest import pair

from pipeline import records
from pipeline.constants import GAME_PLAYOFF, GAME_REGULAR


def matchup(season, week, home, away, hs, aws, game_type=GAME_REGULAR):
    return {
        "matchup_id": f"{season}-{week}-{home}-{away}",
        "season": season,
        "week": week,
        "game_type": game_type,
        "is_bye": False,
        "completed": True,
        "home_team_id": home,
        "away_team_id": away,
        "home_owner_id": f"owner-{home}",
        "away_owner_id": f"owner-{away}",
        "home_team_name": f"Team {home}",
        "away_team_name": f"Team {away}",
        "home_score": float(hs),
        "away_score": float(aws),
        "winner": "HOME" if hs > aws else "AWAY" if aws > hs else "TIE",
        "margin": round(abs(hs - aws), 2),
        "combined": round(hs + aws, 2),
    }


@pytest.fixture
def league():
    team_weeks = []
    team_weeks += pair(2023, 1, 1, 180, 2, 190)   # 180 loses: bad beat
    team_weeks += pair(2023, 2, 1, 70, 2, 65)     # 70 wins: ugly win
    team_weeks += pair(2024, 1, 1, 200, 2, 100)   # blowout, high score
    matchups = [
        matchup(2023, 1, 1, 2, 180, 190),
        matchup(2023, 2, 1, 2, 70, 65),
        matchup(2024, 1, 1, 2, 200, 100),
    ]
    return team_weeks, matchups


def find(categories, cat_id):
    return next(c for c in categories if c["id"] == cat_id)


class TestSingleGame:
    def test_highest_and_lowest_score(self, league):
        cats = records.single_game_records(*league)
        assert find(cats, "highest-score")["entries"][0]["value"] == 200.0
        assert find(cats, "lowest-score")["entries"][0]["value"] == 65.0

    def test_highest_score_in_a_loss(self, league):
        entry = find(records.single_game_records(*league), "highest-score-loss")["entries"][0]
        assert entry["value"] == 180.0
        assert entry["result"] == "L"
        assert entry["opponent_score"] == 190.0
        assert entry["season"] == 2023 and entry["week"] == 1

    def test_lowest_score_in_a_win(self, league):
        entry = find(records.single_game_records(*league), "lowest-score-win")["entries"][0]
        assert entry["value"] == 70.0
        assert entry["result"] == "W"

    def test_blowout_and_closest(self, league):
        cats = records.single_game_records(*league)
        assert find(cats, "biggest-blowout")["entries"][0]["value"] == 100.0
        assert find(cats, "closest-game")["entries"][0]["value"] == 5.0

    def test_combined_records(self, league):
        cats = records.single_game_records(*league)
        assert find(cats, "highest-combined")["entries"][0]["value"] == 370.0
        assert find(cats, "lowest-combined")["entries"][0]["value"] == 135.0

    def test_every_entry_carries_context(self, league):
        for category in records.single_game_records(*league):
            for entry in category["entries"]:
                assert entry["season"] is not None
                assert entry["week"] is not None
                assert entry["value"] is not None

    def test_playoff_scope_filtering(self):
        team_weeks = pair(2024, 1, 1, 100, 2, 90)
        team_weeks += pair(2024, 15, 1, 250, 2, 90, game_type=GAME_PLAYOFF)
        matchups = [
            matchup(2024, 1, 1, 2, 100, 90),
            matchup(2024, 15, 1, 2, 250, 90, GAME_PLAYOFF),
        ]
        regular = records.single_game_records(team_weeks, matchups, game_types=(GAME_REGULAR,))
        assert find(regular, "highest-score")["entries"][0]["value"] == 100.0
        every = records.single_game_records(team_weeks, matchups, game_types=None)
        assert find(every, "highest-score")["entries"][0]["value"] == 250.0


class TestSeasonRecords:
    def test_most_points_in_a_season(self, league):
        team_weeks, _ = league
        cats = records.season_records(team_weeks)
        top = find(cats, "most-points-season")["entries"][0]
        # 2023 team 1: 180 + 70 = 250; 2023 team 2: 190 + 65 = 255
        assert top["value"] == 255.0
        assert top["season"] == 2023

    def test_win_pct_record_requires_a_minimum_sample(self, league):
        team_weeks, _ = league
        cats = records.season_records(team_weeks)
        # No season here reaches 8 games, so the category must be empty
        # rather than crowning a 1-0 team.
        assert find(cats, "best-win-pct-season")["entries"] == []

    def test_consistency_category_excludes_single_game_seasons(self, league):
        team_weeks, _ = league
        cats = records.season_records(team_weeks)
        assert find(cats, "most-consistent-season")["entries"] == []


class TestCareerRecords:
    def test_career_categories_respect_minimums(self):
        career = [
            {"owner_id": "a", "name": "A", "games": 30, "wins": 20, "losses": 10,
             "win_pct": 0.667, "points_for": 3000.0, "avg_score": 100.0,
             "championships": 2, "playoff_appearances": 3, "avg_finish": 2.5,
             "longest_win_streak": 7, "longest_loss_streak": 3, "record": "20-10",
             "seasons_played": 3},
            {"owner_id": "b", "name": "B", "games": 5, "wins": 5, "losses": 0,
             "win_pct": 1.0, "points_for": 700.0, "avg_score": 140.0,
             "championships": 0, "playoff_appearances": 0, "avg_finish": 8.0,
             "longest_win_streak": 5, "longest_loss_streak": 0, "record": "5-0",
             "seasons_played": 1},
        ]
        cats = records.career_records(career)
        # B has a perfect record but only 5 games, below the 20-game minimum.
        assert [e["owner_id"] for e in find(cats, "career-win-pct")["entries"]] == ["a"]
        # Wins has no minimum.
        assert find(cats, "career-wins")["entries"][0]["owner_id"] == "a"
        assert find(cats, "career-championships")["entries"][0]["value"] == 2.0
        # Average finish: lower is better.
        assert find(cats, "career-avg-finish")["entries"][0]["owner_id"] == "a"


class TestPlayerRecords:
    def test_empty_when_no_roster_data(self):
        assert records.player_records([], {}, {}) == []

    def test_bench_and_dud_records(self):
        rosters = [
            {"season": 2024, "week": 1, "owner_id": "o1", "player_id": 1,
             "started": True, "points": 2.5, "lineup_slot": "QB"},
            {"season": 2024, "week": 1, "owner_id": "o1", "player_id": 2,
             "started": False, "points": 41.0, "lineup_slot": "BE"},
            {"season": 2024, "week": 1, "owner_id": "o2", "player_id": 3,
             "started": True, "points": 1.0, "lineup_slot": "K"},
        ]
        players = {
            1: {"name": "Dud QB", "position": "QB", "nfl_team": "KC"},
            2: {"name": "Bench Hero", "position": "RB", "nfl_team": "GB"},
            3: {"name": "Bad Kicker", "position": "K", "nfl_team": "NE"},
        }
        cats = records.player_records(rosters, players, {"o1": {"name": "One"}})
        assert find(cats, "player-best-week")["entries"][0]["player_name"] == "Bench Hero"
        assert find(cats, "player-biggest-bench")["entries"][0]["value"] == 41.0
        # Kickers are excluded from the dud record, so the QB is the worst.
        assert find(cats, "player-worst-starter")["entries"][0]["player_name"] == "Dud QB"
