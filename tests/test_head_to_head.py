"""Head-to-head aggregation tests."""

import pytest
from conftest import pair

from pipeline import head_to_head
from pipeline.constants import GAME_PLAYOFF, GAME_REGULAR


class TestPairKey:
    def test_symmetric(self):
        assert head_to_head.pair_key("b", "a") == head_to_head.pair_key("a", "b")
        assert head_to_head.pair_key("a", "b") == "a__b"


@pytest.fixture
def rivalry():
    rows = []
    rows += pair(2023, 1, 1, 120, 2, 100)                        # owner-1 W
    rows += pair(2023, 5, 1, 90, 2, 130)                         # owner-1 L
    rows += pair(2023, 15, 1, 150, 2, 149, game_type=GAME_PLAYOFF)  # owner-1 W, playoff
    rows += pair(2024, 3, 1, 80, 2, 200)                         # owner-1 L
    rows += pair(2024, 9, 1, 110, 2, 105)                        # owner-1 W
    owners = {"owner-1": {"name": "One"}, "owner-2": {"name": "Two"}}
    return head_to_head.build_head_to_head(rows, owners)


class TestRivalryRecord:
    def test_one_record_per_pair_not_two(self, rivalry):
        assert list(rivalry) == ["owner-1__owner-2"]

    def test_overall_record(self, rivalry):
        record = rivalry["owner-1__owner-2"]
        assert record["overall"]["games"] == 5
        assert record["overall"]["left_wins"] == 3
        assert record["overall"]["right_wins"] == 2
        assert record["overall"]["left_win_pct"] == 0.6

    def test_regular_and_playoff_split(self, rivalry):
        record = rivalry["owner-1__owner-2"]
        assert record["regular"]["games"] == 4
        assert record["regular"]["left_wins"] == 2
        assert record["playoff"]["games"] == 1
        assert record["playoff"]["left_wins"] == 1

    def test_points_and_margins(self, rivalry):
        record = rivalry["owner-1__owner-2"]
        # 120 + 90 + 150 + 80 + 110 = 550
        assert record["left_points"] == 550.0
        assert record["right_points"] == 684.0
        assert record["avg_margin"] == pytest.approx((550 - 684) / 5, abs=0.01)

    def test_notable_meetings(self, rivalry):
        record = rivalry["owner-1__owner-2"]
        assert record["biggest_left_win"]["margin"] == 20.0
        assert record["biggest_right_win"]["margin"] == 120.0
        assert record["closest_meeting"]["margin"] == 1.0
        assert record["highest_scoring_meeting"]["combined"] == 299.0
        assert record["last_meeting"]["season"] == 2024
        assert record["last_meeting"]["week"] == 9

    def test_current_streak_from_left_perspective(self, rivalry):
        streak = rivalry["owner-1__owner-2"]["current_streak"]
        assert streak["owner_id"] == "owner-1"
        assert streak["type"] == "W"
        assert streak["length"] == 1

    def test_meetings_are_chronological(self, rivalry):
        meetings = rivalry["owner-1__owner-2"]["meetings"]
        keys = [(m["season"], m["week"]) for m in meetings]
        assert keys == sorted(keys)


class TestRivalryIndex:
    def test_bounded_zero_to_hundred(self, rivalry):
        score = rivalry["owner-1__owner-2"]["rivalry_index"]["score"]
        assert 0 <= score <= 100

    def test_even_close_series_beats_lopsided_blowouts(self):
        even = []
        for week in range(1, 11):
            winner_score, loser_score = (110, 108) if week % 2 else (108, 110)
            even += pair(2024, week, 1, winner_score, 2, loser_score)
        lopsided = []
        for week in range(1, 11):
            lopsided += pair(2024, week, 3, 180, 4, 80)
        owners = {f"owner-{i}": {"name": str(i)} for i in (1, 2, 3, 4)}
        even_score = head_to_head.build_head_to_head(even, owners)[
            "owner-1__owner-2"
        ]["rivalry_index"]["score"]
        lop_score = head_to_head.build_head_to_head(lopsided, owners)[
            "owner-3__owner-4"
        ]["rivalry_index"]["score"]
        assert even_score > lop_score


class TestHighlights:
    def test_favorite_victim_and_nemesis_need_a_minimum_sample(self):
        rows = []
        # owner-1 dominates owner-2 over 4 meetings.
        for week in range(1, 5):
            rows += pair(2024, week, 1, 150, 2, 90)
        # owner-1 loses once to owner-3: only 1 meeting, below the minimum.
        rows += pair(2024, 5, 1, 90, 3, 150)
        owners = {f"owner-{i}": {"name": f"O{i}"} for i in (1, 2, 3)}
        pairs = head_to_head.build_head_to_head(rows, owners)
        highlights = head_to_head.h2h_highlights(pairs, "owner-1")
        assert highlights["favorite_victim"]["opponent_owner_id"] == "owner-2"
        # owner-3 is excluded from nemesis for lack of meetings, so the only
        # qualifying opponent is owner-2, who owner-1 beats.
        assert highlights["nemesis"]["opponent_owner_id"] == "owner-2"
        assert highlights["min_meetings"] == 3
        assert len(highlights["opponents"]) == 2

    def test_perspective_is_flipped_correctly(self):
        rows = pair(2024, 1, 1, 150, 2, 90) * 1
        rows += pair(2024, 2, 1, 150, 2, 90)
        rows += pair(2024, 3, 1, 150, 2, 90)
        owners = {f"owner-{i}": {"name": f"O{i}"} for i in (1, 2)}
        pairs = head_to_head.build_head_to_head(rows, owners)
        one = head_to_head.h2h_highlights(pairs, "owner-1")["opponents"][0]
        two = head_to_head.h2h_highlights(pairs, "owner-2")["opponents"][0]
        assert (one["wins"], one["losses"]) == (3, 0)
        assert (two["wins"], two["losses"]) == (0, 3)
