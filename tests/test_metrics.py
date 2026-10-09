"""Tests for the statistical engine.

Expected values are computed by hand in the docstrings so a failure tells you
which definition changed, not just that a number moved.
"""

import pytest
from conftest import pair, tw

from pipeline import metrics
from pipeline.constants import GAME_PLAYOFF, GAME_REGULAR


class TestSummarize:
    def test_record_and_scoring(self, four_team_season):
        summary = metrics.summarize(four_team_season)
        team1 = summary["owner-1"]
        # Team 1: 120 + 130 + 135 = 385 for; 100 + 125 + 140 = 365 against
        assert team1["games"] == 3
        assert team1["wins"] == 2
        assert team1["losses"] == 1
        assert team1["record"] == "2-1"
        assert team1["points_for"] == 385.0
        assert team1["points_against"] == 365.0
        assert team1["point_diff"] == 20.0
        assert team1["avg_score"] == pytest.approx(128.33, abs=0.01)
        assert team1["median_score"] == 130.0
        assert team1["high_score"] == 135.0
        assert team1["low_score"] == 120.0

    def test_stdev_is_sample_not_population(self):
        rows = pair(2024, 1, 1, 100, 2, 90) + pair(2024, 2, 1, 120, 2, 90)
        summary = metrics.summarize(rows)
        # sample stdev of (100, 120) = sqrt(((-10)^2 + 10^2)/1) = 14.14
        assert summary["owner-1"]["score_stdev"] == pytest.approx(14.14, abs=0.01)

    def test_single_game_stdev_is_none_not_zero(self):
        rows = pair(2024, 1, 1, 100, 2, 90)
        summary = metrics.summarize(rows)
        assert summary["owner-1"]["score_stdev"] is None

    def test_tie_counts_as_half_a_win(self, tie_season):
        summary = metrics.summarize(tie_season)
        team1 = summary["owner-1"]
        assert (team1["wins"], team1["losses"], team1["ties"]) == (1, 0, 1)
        assert team1["record"] == "1-0-1"
        # (1 + 0.5*1) / 2 = 0.75
        assert team1["win_pct"] == 0.75

    def test_playoff_games_excluded_by_default(self):
        rows = pair(2024, 1, 1, 100, 2, 90)
        rows += pair(2024, 15, 1, 200, 2, 50, game_type=GAME_PLAYOFF)
        regular = metrics.summarize(rows)
        assert regular["owner-1"]["games"] == 1
        assert regular["owner-1"]["points_for"] == 100.0

        combined = metrics.summarize(rows, game_types=None)
        assert combined["owner-1"]["games"] == 2
        assert combined["owner-1"]["points_for"] == 300.0


class TestAllPlay:
    def test_all_play_in_one_week(self, four_team_season):
        """Week 1 scores: 120, 110, 100, 90.

        Team 1 (120) beats all 3 -> 3-0.
        Team 3 (110) beats 100 and 90, loses to 120 -> 2-1.
        Team 2 (100) beats 90 -> 1-2.
        Team 4 (90)  beats nobody -> 0-3.
        """
        week1 = [r for r in four_team_season if r["week"] == 1]
        result = metrics.all_play(week1)
        totals = result["totals"]
        assert (totals["owner-1"]["all_play_wins"], totals["owner-1"]["all_play_losses"]) == (3, 0)
        assert (totals["owner-3"]["all_play_wins"], totals["owner-3"]["all_play_losses"]) == (2, 1)
        assert (totals["owner-2"]["all_play_wins"], totals["owner-2"]["all_play_losses"]) == (1, 2)
        assert (totals["owner-4"]["all_play_wins"], totals["owner-4"]["all_play_losses"]) == (0, 3)

    def test_all_play_wins_and_losses_balance(self, four_team_season):
        """Across the league, every all-play win is somebody's all-play loss."""
        totals = metrics.all_play(four_team_season)["totals"]
        wins = sum(t["all_play_wins"] for t in totals.values())
        losses = sum(t["all_play_losses"] for t in totals.values())
        assert wins == losses

    def test_all_play_full_season(self, four_team_season):
        """Team 1 scores 120 (wk1), 130 (wk2), 135 (wk3).

        wk1 field 120/110/100/90 -> 3-0
        wk2 field 130/125/105/80 -> 3-0
        wk3 field 140/135/115/70 -> 2-1
        Total 8-1, pct = 8/9 = 0.889
        """
        totals = metrics.all_play(four_team_season)["totals"]
        assert totals["owner-1"]["all_play_record"] == "8-1"
        assert totals["owner-1"]["all_play_win_pct"] == pytest.approx(0.889, abs=0.001)

    def test_ties_counted_as_half(self):
        rows = pair(2024, 1, 1, 100, 2, 100) + pair(2024, 1, 3, 90, 4, 80)
        totals = metrics.all_play(rows)["totals"]
        # Team 1 (100): beats 90 and 80, ties 100 -> 2-0-1 -> (2+0.5)/3
        assert totals["owner-1"]["all_play_record"] == "2-0-1"
        assert totals["owner-1"]["all_play_win_pct"] == pytest.approx(0.833, abs=0.001)

    def test_weekly_rank_recorded(self, four_team_season):
        per_week = metrics.all_play(four_team_season)["per_week"]
        wk1 = {r["owner_id"]: r["weekly_rank"] for r in per_week if r["week"] == 1}
        assert wk1 == {"owner-1": 1, "owner-3": 2, "owner-2": 3, "owner-4": 4}


class TestExpectedWinsAndLuck:
    def test_expected_wins_and_schedule_luck(self, four_team_season):
        """Team 1: all-play 8/9 over 3 games -> expected 2.667 wins, actual 2.

        Schedule luck = 2 - 2.667 = -0.67 (scored like a 2.7-win team, got 2).
        """
        summary = metrics.summarize(four_team_season)
        ap = metrics.all_play(four_team_season)["totals"]
        exp = metrics.expected_wins(summary, ap)
        assert exp["owner-1"]["expected_wins"] == pytest.approx(2.67, abs=0.01)
        assert exp["owner-1"]["actual_wins"] == 2.0
        assert exp["owner-1"]["schedule_luck"] == pytest.approx(-0.67, abs=0.01)

    def test_lucky_team_has_positive_luck(self, four_team_season):
        """Team 2 wins 2 games on weak scores, so luck must be positive."""
        summary = metrics.summarize(four_team_season)
        ap = metrics.all_play(four_team_season)["totals"]
        exp = metrics.expected_wins(summary, ap)
        assert exp["owner-2"]["schedule_luck"] > 0
        assert exp["owner-1"]["schedule_luck"] < 0

    def test_schedule_luck_sums_to_zero_across_league(self, four_team_season):
        """A closed league cannot be collectively lucky."""
        summary = metrics.summarize(four_team_season)
        ap = metrics.all_play(four_team_season)["totals"]
        exp = metrics.expected_wins(summary, ap)
        total = sum(v["schedule_luck"] for v in exp.values())
        assert total == pytest.approx(0.0, abs=0.05)

    def test_expected_wins_none_when_no_all_play(self):
        summary = metrics.summarize(pair(2024, 1, 1, 100, 2, 90))
        exp = metrics.expected_wins(summary, {})
        assert exp["owner-1"]["expected_wins"] is None


class TestStrengthOfSchedule:
    def test_tougher_schedule_is_positive(self, four_team_season):
        sos = metrics.strength_of_schedule(four_team_season)
        # Team 4 faced 110, 105, 70 -> easier than average; team 3 faced 90, 130, 115.
        assert sos["owner-4"]["opponent_avg_score"] == pytest.approx(95.0, abs=0.01)
        assert sos["owner-3"]["opponent_avg_score"] == pytest.approx(111.67, abs=0.01)
        assert sos["owner-3"]["sos_points"] > sos["owner-4"]["sos_points"]

    def test_sos_points_sums_to_zero(self, four_team_season):
        """Every point faced by one team was scored by another."""
        sos = metrics.strength_of_schedule(four_team_season)
        assert sum(v["sos_points"] for v in sos.values()) == pytest.approx(0.0, abs=0.05)


class TestLuckIndices:
    def test_bad_beat_requires_a_loss_with_an_above_average_score(self):
        """Team 1 scores 160 (far above the field) and still loses."""
        rows = pair(2024, 1, 1, 160, 2, 170)
        rows += pair(2024, 1, 3, 90, 4, 85)
        indices = metrics.luck_indices(rows)
        assert indices["owner-1"]["bad_beat_index"] > 0
        assert indices["owner-1"]["worst_bad_beat"]["score"] == 160.0
        # Team 3 lost but scored below average -> no bad beat credit.
        assert indices["owner-3"]["bad_beat_index"] == 0.0

    def test_fortunate_win_requires_a_win_with_a_below_average_score(self):
        rows = pair(2024, 1, 1, 80, 2, 75)
        rows += pair(2024, 1, 3, 150, 4, 140)
        indices = metrics.luck_indices(rows)
        assert indices["owner-1"]["fortunate_win_index"] > 0
        assert indices["owner-3"]["fortunate_win_index"] == 0.0


class TestStreaks:
    def test_streaks_span_seasons_in_chronological_order(self):
        rows = []
        rows += pair(2023, 13, 1, 120, 2, 100)   # W
        rows += pair(2023, 14, 1, 120, 2, 100)   # W
        rows += pair(2024, 1, 1, 90, 2, 100)     # L
        rows += pair(2024, 2, 1, 90, 2, 100)     # L
        rows += pair(2024, 3, 1, 90, 2, 100)     # L
        result = metrics.streaks(rows)
        assert result["owner-1"]["longest_win_streak"] == 2
        assert result["owner-1"]["longest_loss_streak"] == 3
        assert result["owner-1"]["current_streak"] == "L3"
        assert result["owner-2"]["current_streak"] == "W3"


class TestDominance:
    def test_best_team_scores_highest(self, four_team_season):
        summary = metrics.summarize(four_team_season)
        ap = metrics.all_play(four_team_season)["totals"]
        dom = metrics.dominance_rating(summary, ap)
        ranked = sorted(dom, key=lambda k: -dom[k]["dominance"])
        assert ranked[0] == "owner-1"
        assert all(0 <= d["dominance"] <= 100 for d in dom.values())

    def test_single_entity_does_not_divide_by_zero(self):
        rows = pair(2024, 1, 1, 100, 2, 90)
        summary = {k: v for k, v in metrics.summarize(rows).items() if k == "owner-1"}
        ap = {"owner-1": {"all_play_win_pct": 1.0}}
        dom = metrics.dominance_rating(summary, ap)
        assert dom["owner-1"]["dominance"] == 50.0


class TestOptimalLineup:
    def test_picks_best_eligible_player_per_slot(self):
        entries = [
            {"player_id": 1, "position": "QB", "points": 20.0},
            {"player_id": 2, "position": "QB", "points": 30.0},
            {"player_id": 3, "position": "RB", "points": 10.0},
            {"player_id": 4, "position": "WR", "points": 25.0},
        ]
        slot_counts = {0: 1, 2: 1}  # 1 QB, 1 RB
        from pipeline.constants import SLOT_ELIGIBILITY

        total, chosen = metrics.optimal_lineup(entries, slot_counts, SLOT_ELIGIBILITY)
        # Best QB (30) + only RB (10) = 40. The 25-point WR is not eligible.
        assert total == 40.0
        assert {c["player_id"] for c in chosen} == {2, 3}

    def test_flex_takes_the_leftover_best(self):
        from pipeline.constants import SLOT_ELIGIBILITY

        entries = [
            {"player_id": 1, "position": "RB", "points": 30.0},
            {"player_id": 2, "position": "RB", "points": 20.0},
            {"player_id": 3, "position": "WR", "points": 25.0},
        ]
        slot_counts = {2: 1, 23: 1}  # 1 RB, 1 FLEX
        total, chosen = metrics.optimal_lineup(entries, slot_counts, SLOT_ELIGIBILITY)
        # RB slot takes the 30; flex takes the 25 WR over the 20 RB.
        assert total == 55.0

    def test_manager_efficiency_is_one_when_lineup_was_optimal(self):
        from pipeline.constants import SLOT_ELIGIBILITY

        rosters = [
            {"season": 2024, "week": 1, "owner_id": "o1", "player_id": 1,
             "started": True, "points": 30.0},
            {"season": 2024, "week": 1, "owner_id": "o1", "player_id": 2,
             "started": False, "points": 5.0},
        ]
        players = {1: {"position": "QB", "name": "A"}, 2: {"position": "QB", "name": "B"}}
        result = metrics.manager_efficiency(rosters, players, {0: 1}, SLOT_ELIGIBILITY)
        assert result["o1"]["manager_efficiency"] == 1.0
        assert result["o1"]["bench_regret_total"] == 0.0

    def test_bench_regret_detects_the_wrong_start(self):
        from pipeline.constants import SLOT_ELIGIBILITY

        rosters = [
            {"season": 2024, "week": 1, "owner_id": "o1", "player_id": 1,
             "started": True, "points": 5.0},
            {"season": 2024, "week": 1, "owner_id": "o1", "player_id": 2,
             "started": False, "points": 30.0},
        ]
        players = {1: {"position": "QB", "name": "A"}, 2: {"position": "QB", "name": "B"}}
        result = metrics.manager_efficiency(rosters, players, {0: 1}, SLOT_ELIGIBILITY)
        assert result["o1"]["bench_regret_total"] == 25.0
        assert result["o1"]["manager_efficiency"] == pytest.approx(5 / 30, abs=0.001)
        assert result["o1"]["biggest_bench_performance"]["points"] == 30.0


class TestFiltering:
    def test_incomplete_rows_are_dropped(self):
        rows = pair(2024, 1, 1, 100, 2, 90)
        rows.append({**rows[0], "week": 2, "score": None})
        summary = metrics.summarize(rows)
        assert summary["owner-1"]["games"] == 1

    def test_season_filter(self):
        rows = pair(2023, 1, 1, 100, 2, 90) + pair(2024, 1, 1, 200, 2, 90)
        assert metrics.summarize(rows, season=2024)["owner-1"]["points_for"] == 200.0
        assert metrics.summarize(rows, season=2023)["owner-1"]["points_for"] == 100.0
