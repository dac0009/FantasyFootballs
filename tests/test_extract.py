"""Tests for ESPN payload normalization: the gnarly edge cases."""

import pytest

from pipeline import extract
from pipeline.constants import (
    GAME_CONSOLATION,
    GAME_PLAYOFF,
    GAME_POSTSEASON_UNKNOWN,
    GAME_REGULAR,
)
from pipeline.owners import OwnerRegistry


def espn_team(team_id, name, guid, **extra):
    return {
        "id": team_id,
        "name": name,
        "abbrev": name[:4].upper(),
        "owners": [guid] if guid else [],
        "record": {"overall": {"wins": 0, "losses": 0, "ties": 0, "pointsFor": 0}},
        **extra,
    }


def espn_game(week, home, away, hs, aws, winner, tier="NONE", game_id=1):
    return {
        "id": game_id,
        "matchupPeriodId": week,
        "playoffTierType": tier,
        "winner": winner,
        "home": {"teamId": home, "totalPoints": hs},
        "away": {"teamId": away, "totalPoints": aws},
    }


BASE_PAYLOAD = {
    "seasonId": 2024,
    "settings": {
        "name": "Test League",
        "size": 4,
        "scheduleSettings": {"matchupPeriodCount": 2, "playoffTeamCount": 2},
        "rosterSettings": {"lineupSlotCounts": {"0": 1, "2": 2, "20": 6}},
    },
    "status": {"currentMatchupPeriod": 3, "latestScoringPeriod": 3},
    "members": [],
    "teams": [],
    "schedule": [],
}


class TestSeasonMeta:
    def test_matchup_period_count_is_the_regular_season_length(self):
        meta = extract.extract_season_meta(2024, BASE_PAYLOAD)
        assert meta["regular_season_weeks"] == 2
        assert meta["playoff_team_count"] == 2
        assert meta["lineup_slot_counts"] == {"0": 1, "2": 2, "20": 6}

    def test_falls_back_when_settings_missing(self):
        payload = {
            "settings": {},
            "status": {},
            "schedule": [
                espn_game(1, 1, 2, 100, 90, "HOME"),
                espn_game(2, 1, 2, 100, 90, "HOME"),
                espn_game(3, 1, 2, 100, 90, "HOME", tier="WINNERS_BRACKET"),
            ],
        }
        meta = extract.extract_season_meta(2024, payload)
        # First bracket week is 3, so the regular season must have been 2 weeks.
        assert meta["regular_season_weeks"] == 2


class TestGameClassification:
    def test_regular_season_by_week_number(self):
        assert extract.classify_game(1, "NONE", 14, {}, 6, 1, 2) == GAME_REGULAR
        assert extract.classify_game(14, "NONE", 14, {}, 6, 1, 2) == GAME_REGULAR

    def test_winners_bracket_is_playoff(self):
        assert extract.classify_game(15, "WINNERS_BRACKET", 14, {}, 6, 1, 2) == GAME_PLAYOFF

    def test_consolation_ladders_are_consolation(self):
        for tier in ("LOSERS_CONSOLATION_LADDER", "WINNERS_CONSOLATION_LADDER"):
            assert extract.classify_game(15, tier, 14, {}, 6, 1, 2) == GAME_CONSOLATION

    def test_playoff_week_with_no_tier_uses_seeds(self):
        seeds = {1: 2, 2: 3, 3: 9, 4: 10}
        # Both teams made the 6-team bracket -> playoff.
        assert extract.classify_game(15, None, 14, seeds, 6, 1, 2) == GAME_PLAYOFF
        # Both missed it -> consolation.
        assert extract.classify_game(15, None, 14, seeds, 6, 3, 4) == GAME_CONSOLATION

    def test_unclassifiable_postseason_is_flagged_not_guessed(self):
        assert (
            extract.classify_game(15, None, 14, {}, None, 1, 2)
            == GAME_POSTSEASON_UNKNOWN
        )


class TestMatchupExtraction:
    def _run(self, schedule, teams=None, **settings_override):
        payload = {
            **BASE_PAYLOAD,
            "teams": teams or [espn_team(i, f"Team {i}", f"{{G{i}}}") for i in (1, 2, 3, 4)],
            "schedule": schedule,
        }
        if settings_override:
            payload["settings"] = {**payload["settings"], **settings_override}
        meta = extract.extract_season_meta(2024, payload)
        registry = OwnerRegistry()
        mapping = registry.register_season(2024, payload["members"], payload["teams"])
        team_rows = extract.extract_teams(2024, payload, mapping)
        return extract.extract_matchups(2024, payload, meta, team_rows)

    def test_completed_matchup_produces_two_team_weeks(self):
        matchups, team_weeks = self._run([espn_game(1, 1, 2, 120.5, 100.25, "HOME")])
        assert len(matchups) == 1
        assert len(team_weeks) == 2
        assert matchups[0]["margin"] == 20.25
        assert matchups[0]["combined"] == 220.75
        results = {r["team_id"]: r["result"] for r in team_weeks}
        assert results == {1: "W", 2: "L"}

    def test_future_matchup_is_retained_but_not_counted(self):
        matchups, team_weeks = self._run([espn_game(2, 1, 2, 0, 0, "UNDECIDED")])
        assert len(matchups) == 1
        assert matchups[0]["completed"] is False
        assert matchups[0]["margin"] is None
        assert team_weeks == []

    def test_tie_is_recorded_as_a_tie_for_both_sides(self):
        matchups, team_weeks = self._run([espn_game(1, 1, 2, 110.0, 110.0, "TIE")])
        assert matchups[0]["margin"] == 0.0
        assert {r["result"] for r in team_weeks} == {"T"}

    def test_playoff_bye_is_not_a_game(self):
        schedule = [
            {
                "id": 9,
                "matchupPeriodId": 3,
                "playoffTierType": "WINNERS_BRACKET",
                "winner": "BYE",
                "home": {"teamId": 1, "totalPoints": 0},
            }
        ]
        matchups, team_weeks = self._run(schedule)
        assert matchups[0]["is_bye"] is True
        assert matchups[0]["completed"] is False
        assert team_weeks == []

    def test_duplicate_schedule_entry_is_dropped(self):
        game = espn_game(1, 1, 2, 120, 100, "HOME", game_id=7)
        matchups, team_weeks = self._run([game, dict(game)])
        assert len(matchups) == 1
        assert len(team_weeks) == 2

    def test_null_scores_on_a_completed_game_are_not_counted(self):
        game = espn_game(1, 1, 2, None, None, "HOME")
        matchups, team_weeks = self._run([game])
        assert matchups[0]["completed"] is False
        assert team_weeks == []

    def test_points_by_scoring_period_used_when_total_missing(self):
        game = {
            "id": 1,
            "matchupPeriodId": 1,
            "playoffTierType": "NONE",
            "winner": "HOME",
            "home": {"teamId": 1, "pointsByScoringPeriod": {"1": 60.0, "2": 50.0}},
            "away": {"teamId": 2, "pointsByScoringPeriod": {"1": 40.0, "2": 30.0}},
        }
        matchups, _ = self._run([game])
        assert matchups[0]["home_score"] == 110.0
        assert matchups[0]["away_score"] == 70.0

    def test_owner_ids_are_attached_to_both_sides(self):
        _, team_weeks = self._run([espn_game(1, 1, 2, 120, 100, "HOME")])
        assert all(r["owner_id"] for r in team_weeks)
        assert all(r["opponent_owner_id"] for r in team_weeks)


class TestChampion:
    def test_champion_from_winners_bracket_final(self):
        meta = {"season": 2024}
        matchups = [
            {
                "game_type": GAME_PLAYOFF, "completed": True, "is_bye": False, "week": 16,
                "winner": "AWAY", "home_team_id": 1, "away_team_id": 2, "combined": 250.0,
            }
        ]
        finish = extract.determine_champion(meta, matchups, [])
        assert finish["champion_team_id"] == 2
        assert finish["runner_up_team_id"] == 1
        assert finish["source"] == "winners_bracket_final"

    def test_falls_back_to_final_rank(self):
        teams = [
            {"team_id": 1, "final_rank": 3},
            {"team_id": 2, "final_rank": 1},
            {"team_id": 3, "final_rank": 2},
        ]
        finish = extract.determine_champion({"season": 2024}, [], teams)
        assert finish["champion_team_id"] == 2
        assert finish["runner_up_team_id"] == 3
        assert finish["third_place_team_id"] == 1
        assert finish["last_place_team_id"] == 1
        assert finish["source"] == "rankCalculatedFinal"

    def test_no_data_means_no_champion_not_a_guess(self):
        finish = extract.determine_champion({"season": 2026}, [], [])
        assert finish["champion_team_id"] is None
        assert finish["source"] is None


class TestRosterExtraction:
    def test_starters_and_bench_separated(self):
        payload = {
            "schedule": [
                {
                    "matchupPeriodId": 1,
                    "home": {
                        "teamId": 1,
                        "rosterForCurrentScoringPeriod": {
                            "entries": [
                                {
                                    "lineupSlotId": 0,
                                    "playerPoolEntry": {
                                        "id": 50,
                                        "appliedStatTotal": 24.5,
                                        "player": {
                                            "id": 50,
                                            "fullName": "Starter Guy",
                                            "defaultPositionId": 1,
                                            "proTeamId": 12,
                                            "stats": [
                                                {"statSourceId": 1, "statSplitTypeId": 1,
                                                 "scoringPeriodId": 1, "appliedTotal": 18.0}
                                            ],
                                        },
                                    },
                                },
                                {
                                    "lineupSlotId": 20,
                                    "playerPoolEntry": {
                                        "id": 51,
                                        "appliedStatTotal": 31.0,
                                        "player": {
                                            "id": 51,
                                            "fullName": "Bench Guy",
                                            "defaultPositionId": 2,
                                            "proTeamId": 9,
                                        },
                                    },
                                },
                            ]
                        },
                    },
                }
            ]
        }
        teams = [{"team_id": 1, "owner_id": "o1", "team_name": "T"}]
        rows, players = extract.extract_week_rosters(2024, 1, payload, teams)
        by_id = {r["player_id"]: r for r in rows}
        assert by_id[50]["started"] is True
        assert by_id[50]["lineup_slot"] == "QB"
        assert by_id[50]["projected"] == 18.0
        assert by_id[51]["started"] is False
        assert by_id[51]["lineup_slot"] == "BE"
        assert players[50]["position"] == "QB"
        assert players[51]["nfl_team"] == "GB"
