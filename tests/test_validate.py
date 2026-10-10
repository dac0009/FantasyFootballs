"""Validation and the regression guard."""

import json

import pytest
from conftest import pair

from pipeline import validate
from pipeline.constants import GAME_REGULAR


def season_data(**overrides):
    # ESPN's pointsFor is regular-season only; match the fixture's week-1 scores.
    espn_pf = {1: 120.0, 2: 100.0, 3: 110.0, 4: 90.0}
    teams = [
        {"season": 2024, "team_id": i, "owner_id": f"o{i}", "team_name": f"T{i}",
         "espn_points_for": espn_pf[i], "espn_points_against": 190.0, "playoff_seed": i,
         "final_rank": i, "abbrev": None, "logo": None, "espn_wins": 1,
         "espn_losses": 1, "espn_ties": 0, "division_id": 0}
        for i in (1, 2, 3, 4)
    ]
    matchups = [
        {"matchup_id": "2024-1-1-2", "season": 2024, "week": 1, "game_type": GAME_REGULAR,
         "is_bye": False, "completed": True, "home_team_id": 1, "away_team_id": 2,
         "home_score": 120.0, "away_score": 100.0, "winner": "HOME", "margin": 20.0,
         "combined": 220.0, "home_owner_id": "o1", "away_owner_id": "o2",
         "home_team_name": "T1", "away_team_name": "T2", "playoff_tier": "NONE",
         "espn_matchup_id": 1},
        {"matchup_id": "2024-1-3-4", "season": 2024, "week": 1, "game_type": GAME_REGULAR,
         "is_bye": False, "completed": True, "home_team_id": 3, "away_team_id": 4,
         "home_score": 110.0, "away_score": 90.0, "winner": "HOME", "margin": 20.0,
         "combined": 200.0, "home_owner_id": "o3", "away_owner_id": "o4",
         "home_team_name": "T3", "away_team_name": "T4", "playoff_tier": "NONE",
         "espn_matchup_id": 2},
    ]
    team_weeks = pair(2024, 1, 1, 120, 2, 100) + pair(2024, 1, 3, 110, 4, 90)
    for row in team_weeks:
        row["owner_id"] = f"o{row['team_id']}"
    data = {
        "meta": {"season": 2024, "regular_season_weeks": 14, "playoff_team_count": 2},
        "teams": teams,
        "matchups": matchups,
        "team_weeks": team_weeks,
        "finish": {},
        "rosters": [],
        "draft": [],
        "transactions": [],
    }
    data.update(overrides)
    return data


class TestSeasonValidation:
    def test_clean_season_passes(self):
        report = validate.validate_season(season_data(), expected_team_count=4)
        assert report.ok, report.render()
        assert not any("but ESPN reports" in w for w in report.warnings)

    def test_too_few_teams_is_an_error(self):
        data = season_data()
        data["teams"] = data["teams"][:2]
        report = validate.validate_season(data)
        assert not report.ok
        assert any("only 2 teams" in e for e in report.errors)

    def test_unexpected_team_count_is_only_a_warning(self):
        report = validate.validate_season(season_data(), expected_team_count=12)
        assert report.ok
        assert any("expected 12" in w for w in report.warnings)

    def test_missing_owner_is_an_error(self):
        data = season_data()
        data["teams"][0]["owner_id"] = None
        report = validate.validate_season(data)
        assert not report.ok
        assert any("without a resolved owner" in e for e in report.errors)

    def test_empty_schedule_is_an_error(self):
        report = validate.validate_season(season_data(matchups=[]))
        assert not report.ok
        assert any("no schedule" in e for e in report.errors)

    def test_implausible_week_number_is_an_error(self):
        data = season_data()
        data["matchups"][0]["week"] = 99
        report = validate.validate_season(data)
        assert not report.ok
        assert any("implausible week" in e for e in report.errors)

    def test_team_week_count_must_match_completed_matchups(self):
        data = season_data()
        data["team_weeks"] = data["team_weeks"][:3]  # drop one side
        report = validate.validate_season(data)
        assert not report.ok
        assert any("team-week rows" in e for e in report.errors)

    def test_team_playing_itself_is_an_error(self):
        data = season_data()
        data["matchups"][0]["away_team_id"] = 1
        report = validate.validate_season(data)
        assert not report.ok
        assert any("playing itself" in e for e in report.errors)

    def test_misclassified_game_raises_a_warning(self):
        data = season_data()
        # Our regular-season rows now sum to far more than ESPN's pointsFor.
        for row in data["team_weeks"]:
            row["score"] += 500
        report = validate.validate_season(data)
        assert any("but ESPN reports" in w for w in report.warnings)

    def test_postseason_points_do_not_trip_the_cross_check(self):
        """ESPN's pointsFor is regular season only, so playoff games we hold
        must not be counted against it. This was a real false positive."""
        from conftest import pair

        from pipeline.constants import GAME_PLAYOFF

        data = season_data()
        extra = pair(2024, 15, 1, 150, 2, 140, game_type=GAME_PLAYOFF)
        for row in extra:
            row["owner_id"] = f"o{row['team_id']}"
        data["team_weeks"] += extra
        data["matchups"].append({**data["matchups"][0], "matchup_id": "2024-15-1-2",
                                 "week": 15, "game_type": GAME_PLAYOFF,
                                 "home_score": 150.0, "away_score": 140.0,
                                 "margin": 10.0, "combined": 290.0, "espn_matchup_id": 9})
        report = validate.validate_season(data)
        assert not any("but ESPN reports" in w for w in report.warnings)


class TestOwnerValidation:
    def test_no_owners_is_an_error(self):
        report = validate.validate_owners([], [2024])
        assert not report.ok

    def test_duplicate_owner_id_is_an_error(self):
        owners = [
            {"owner_id": "a", "name": "A", "seasons": [2024]},
            {"owner_id": "a", "name": "B", "seasons": [2024]},
        ]
        report = validate.validate_owners(owners, [2024])
        assert not report.ok

    def test_season_with_no_owners_is_an_error(self):
        owners = [{"owner_id": "a", "name": "A", "seasons": [2024]}]
        report = validate.validate_owners(owners, [2023, 2024])
        assert not report.ok
        assert any("2023" in e for e in report.errors)

    def test_shared_display_name_is_a_warning_to_merge(self):
        owners = [
            {"owner_id": "a", "name": "John Smith", "seasons": [2024]},
            {"owner_id": "a-2", "name": "John Smith", "seasons": [2023]},
        ]
        report = validate.validate_owners(owners, [2023, 2024])
        assert report.ok
        assert any("probably one person" in w for w in report.warnings)
        # The warning must hand the user a paste-ready merge snippet.
        assert any("espn_member_hashes" in w for w in report.warnings)

    def test_unlinked_owner_is_a_warning(self):
        owners = [{"owner_id": "unlinked-2019-3", "name": "T", "seasons": [2019],
                   "unlinked": True}]
        report = validate.validate_owners(owners, [2019])
        assert report.ok
        assert any("could not be linked" in w for w in report.warnings)


class TestRegressionGuard:
    def _write_meta(self, tmp_path, counts):
        (tmp_path / "meta.json").write_text(json.dumps({"counts": counts}))

    def test_shrinking_dataset_is_blocked(self, tmp_path):
        self._write_meta(tmp_path, {"completed_matchups": 600, "team_weeks": 1200})
        report = validate.check_no_regression(
            tmp_path, {"completed_matchups": 0, "team_weeks": 0}
        )
        assert not report.ok
        assert any("would shrink" in e for e in report.errors)

    def test_growing_dataset_is_fine(self, tmp_path):
        self._write_meta(tmp_path, {"completed_matchups": 600})
        report = validate.check_no_regression(tmp_path, {"completed_matchups": 612})
        assert report.ok

    def test_equal_dataset_is_fine(self, tmp_path):
        self._write_meta(tmp_path, {"completed_matchups": 600})
        report = validate.check_no_regression(tmp_path, {"completed_matchups": 600})
        assert report.ok

    def test_override_downgrades_to_warning(self, tmp_path):
        self._write_meta(tmp_path, {"completed_matchups": 600})
        report = validate.check_no_regression(
            tmp_path, {"completed_matchups": 10}, allow_shrink=True
        )
        assert report.ok
        assert any("overridden" in w for w in report.warnings)

    def test_first_ever_run_is_allowed(self, tmp_path):
        report = validate.check_no_regression(tmp_path, {"completed_matchups": 5})
        assert report.ok
        assert any("no previously published data" in w for w in report.warnings)

    def test_corrupt_previous_meta_does_not_block(self, tmp_path):
        (tmp_path / "meta.json").write_text("{not json")
        report = validate.check_no_regression(tmp_path, {"completed_matchups": 5})
        assert report.ok
