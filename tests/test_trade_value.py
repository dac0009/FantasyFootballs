"""Trade Analyzer: hand-calculated values and invariants for every component.

See pipeline/trade_value.py's module docstring for the full formula. Each
test below works a small, hand-checkable example so a failure identifies
which definition changed, not just that a number moved.
"""

import pytest

from pipeline import trade_value as tv


def roster_row(season, week, owner, player_id, *, points, projected, started=True, slot="RB"):
    return {
        "season": season,
        "week": week,
        "team_id": 1,
        "owner_id": owner,
        "player_id": player_id,
        "lineup_slot_id": 2,
        "lineup_slot": slot,
        "started": started,
        "points": points,
        "projected": projected,
    }


def players(*entries):
    """entries: (player_id, position, name)"""
    return {pid: {"player_id": pid, "position": pos, "name": name, "nfl_team": "KC"} for pid, pos, name in entries}


class TestPositionBaselines:
    def test_reliability_baseline_hand_calculated(self):
        rows = [
            roster_row(2026, 1, "a", 1, points=15, projected=10),
            roster_row(2026, 2, "a", 1, points=15, projected=10),
            roster_row(2026, 1, "b", 2, points=4, projected=5),
            roster_row(2026, 2, "b", 2, points=4, projected=5),
        ]
        ps = players((1, "RB", "RB One"), (2, "WR", "WR One"))
        out = tv.position_reliability_baseline(rows, ps)
        assert out["RB"] == pytest.approx(30 / 20)  # 1.5
        assert out["WR"] == pytest.approx(8 / 10)  # 0.8

    def test_zero_projected_rows_are_excluded(self):
        rows = [roster_row(2026, 1, "a", 1, points=0.0, projected=0.0)]
        ps = players((1, "RB", "RB One"))
        assert tv.position_reliability_baseline(rows, ps) == {}

    def test_value_rate_is_average_projection(self):
        rows = [
            roster_row(2026, 1, "a", 1, points=1, projected=10),
            roster_row(2026, 2, "a", 1, points=1, projected=20),
        ]
        ps = players((1, "QB", "QB One"))
        out = tv.position_value_rate(rows, ps)
        assert out["QB"] == pytest.approx(15.0)


class TestReliability:
    def test_shrinkage_pulls_toward_neutral(self):
        # raw_ratio = 45/30 = 1.5, baseline 1.0 given directly.
        rows = [roster_row(2026, w, "a", 1, points=15, projected=10) for w in (1, 2, 3)]
        ps = players((1, "RB", "RB One"))
        out = tv.player_reliability(rows, ps, {"RB": 1.0})
        # shrunk = (3*1.5 + 8*1.0) / 11 = 12.5/11
        assert out[1]["reliability_factor"] == pytest.approx(12.5 / 11, abs=1e-3)
        assert out[1]["games"] == 3

    def test_extreme_small_sample_is_clamped(self):
        # raw_ratio = 20/2 = 10 -> shrunk = (2*10+8)/10 = 2.8 -> clamp to 1.25
        rows = [roster_row(2026, w, "a", 1, points=10, projected=1) for w in (1, 2)]
        ps = players((1, "RB", "RB One"))
        out = tv.player_reliability(rows, ps, {"RB": 1.0})
        assert out[1]["reliability_factor"] == tv.RELIABILITY_CLAMP[1]

    def test_player_with_no_valid_rows_has_no_entry(self):
        rows = [roster_row(2026, 1, "a", 1, points=0.0, projected=0.0)]
        ps = players((1, "RB", "RB One"))
        assert tv.player_reliability(rows, ps, {"RB": 1.0}) == {}


class TestValueBase:
    def test_season_rate_shrinks_toward_career_rate(self):
        rows = [
            roster_row(2025, 1, "a", 1, points=1, projected=20),
            roster_row(2025, 2, "a", 1, points=1, projected=20),
            roster_row(2026, 1, "a", 1, points=1, projected=30),
            roster_row(2026, 2, "a", 1, points=1, projected=30),
        ]
        out = tv.player_value_base(rows, 2026)
        # career_rate = 100/4 = 25.0, season_rate = 60/2 = 30.0
        # shrunk = (2*30 + 4*25) / 6 = 160/6
        assert out[1]["career_rate"] == pytest.approx(25.0)
        assert out[1]["season_rate"] == pytest.approx(30.0)
        assert out[1]["value_base"] == pytest.approx(160 / 6, abs=1e-2)

    def test_player_with_no_rows_has_no_entry(self):
        assert tv.player_value_base([], 2026) == {}

    def test_rookie_with_only_current_season_data(self):
        rows = [
            roster_row(2026, 1, "a", 1, points=5, projected=10),
            roster_row(2026, 2, "a", 1, points=5, projected=10),
        ]
        out = tv.player_value_base(rows, 2026)
        # No prior-season rows, so career == season == 10.0; shrinkage is a no-op.
        assert out[1]["career_rate"] == pytest.approx(10.0)
        assert out[1]["value_base"] == pytest.approx(10.0)


class TestRecentForm:
    def test_insufficient_games_is_neutral(self):
        rows = [roster_row(2026, 1, "a", 1, points=5, projected=5)]
        ps = players((1, "WR", "WR One"))
        out = tv.player_recent_form(rows, ps, 2026, {"WR": 1.0})
        assert out[1]["recent_form_factor"] == 1.0
        assert out[1]["games"] == 1

    def test_uses_most_recent_window_only(self):
        # Weeks 1-2 run cold (ratio 0.5), weeks 3-4 run hot (ratio 1.5); with a
        # window of 3 the most recent 3 games should dominate the result.
        rows = [
            roster_row(2026, 1, "a", 1, points=5, projected=10),
            roster_row(2026, 2, "a", 1, points=5, projected=10),
            roster_row(2026, 3, "a", 1, points=15, projected=10),
            roster_row(2026, 4, "a", 1, points=15, projected=10),
        ]
        ps = players((1, "WR", "WR One"))
        out = tv.player_recent_form(rows, ps, 2026, {"WR": 1.0})
        # recent 3 games (weeks 2-4): points 5+15+15=35, projected 30 -> ratio 35/30
        # clamped to RECENT_FORM_CLAMP upper bound (1.10) since 35/30 > 1.10.
        assert out[1]["recent_form_factor"] == tv.RECENT_FORM_CLAMP[1]
        assert out[1]["games"] == 3


class TestNeedFit:
    def test_below_average_team_gets_boosted_need(self):
        rows = [
            roster_row(2026, 1, "strong", 1, points=20, projected=20, started=True),
            roster_row(2026, 2, "strong", 1, points=20, projected=20, started=True),
            roster_row(2026, 1, "weak", 2, points=10, projected=10, started=True),
            roster_row(2026, 2, "weak", 2, points=10, projected=10, started=True),
        ]
        ps = players((1, "RB", "Strong RB"), (2, "RB", "Weak RB"))
        out = tv.team_need_fit(rows, ps, 2026)
        # league_avg = mean(20,20,10,10) = 15
        # weak: raw = 15/10 = 1.5 -> shrunk (2*1.5+3*1)/5 = 1.2 -> clamp 1.15
        # strong: raw = 15/20 = 0.75 -> shrunk (2*0.75+3*1)/5 = 0.9
        assert out["weak"]["RB"]["need_fit_factor"] == tv.NEED_FIT_CLAMP[1]
        assert out["strong"]["RB"]["need_fit_factor"] == pytest.approx(0.9, abs=1e-3)

    def test_bench_rows_are_excluded(self):
        rows = [roster_row(2026, 1, "a", 1, points=50, projected=50, started=False)]
        ps = players((1, "RB", "Bench RB"))
        assert tv.team_need_fit(rows, ps, 2026) == {}


class TestLeverage:
    def test_bubble_team_gets_max_leverage(self):
        out = tv.team_leverage([{"owner_id": "a", "playoff_pct": 0.5}])
        assert out["a"]["leverage_factor"] == pytest.approx(1.0 + tv.LEVERAGE_SPAN)

    def test_clinched_and_eliminated_both_get_min_leverage(self):
        out = tv.team_leverage(
            [{"owner_id": "a", "playoff_pct": 1.0}, {"owner_id": "b", "playoff_pct": 0.0}]
        )
        assert out["a"]["leverage_factor"] == pytest.approx(1.0 - tv.LEVERAGE_SPAN)
        assert out["b"]["leverage_factor"] == pytest.approx(1.0 - tv.LEVERAGE_SPAN)

    def test_intermediate_value_hand_calculated(self):
        # stakes = 4*0.25*0.75 = 0.75 -> factor = 0.9 + 0.2*0.75 = 1.05
        out = tv.team_leverage([{"owner_id": "a", "playoff_pct": 0.25}])
        assert out["a"]["leverage_factor"] == pytest.approx(1.05)

    def test_missing_playoff_pct_has_no_entry(self):
        assert tv.team_leverage([{"owner_id": "a"}]) == {}
        assert tv.team_leverage(None) == {}


class TestBuildTradeValues:
    def test_no_roster_rows_returns_none(self):
        assert tv.build_trade_values(2026, [], {}, []) is None

    def test_full_payload_shape(self):
        rows = [
            roster_row(2026, 1, "a", 1, points=20, projected=18, started=True),
            roster_row(2026, 2, "a", 1, points=20, projected=18, started=True),
            roster_row(2026, 1, "b", 2, points=10, projected=12, started=True),
            roster_row(2026, 2, "b", 2, points=10, projected=12, started=True),
        ]
        ps = players((1, "RB", "RB One"), (2, "WR", "WR Two"))
        picture_teams = [
            {"owner_id": "a", "playoff_pct": 0.5},
            {"owner_id": "b", "playoff_pct": 0.9},
        ]
        out = tv.build_trade_values(2026, rows, ps, picture_teams)
        assert out["season"] == 2026
        assert set(out["players"]) == {"1", "2"}
        assert out["players"]["1"]["position"] == "RB"
        assert out["teams"]["a"]["leverage_factor"] == pytest.approx(1.0 + tv.LEVERAGE_SPAN)
        assert "RB" in out["positions"] and "value_rate" in out["positions"]["RB"]
        assert out["model"]["reliability_clamp"] == list(tv.RELIABILITY_CLAMP)

    def test_non_tradeable_positions_are_skipped(self):
        rows = [roster_row(2026, 1, "a", 1, points=5, projected=5, started=True, slot="BE")]
        ps = players((1, "UNK", "Unknown"))
        out = tv.build_trade_values(2026, rows, ps, [])
        assert out["players"] == {}


class TestInvariants:
    """Every factor must stay inside its documented, legible bounds."""

    def test_factors_never_escape_their_clamp(self):
        rows = []
        for pid, proj, pts in [(1, 1.0, 50.0), (2, 50.0, 1.0), (3, 10.0, 10.0)]:
            for week in range(1, 6):
                rows.append(roster_row(2026, week, "team", pid, points=pts, projected=proj, started=True))
        ps = players((1, "RB", "Boom"), (2, "RB", "Bust"), (3, "RB", "Average"))
        baselines = tv.position_reliability_baseline(rows, ps)
        reliability = tv.player_reliability(rows, ps, baselines)
        for row in reliability.values():
            assert tv.RELIABILITY_CLAMP[0] <= row["reliability_factor"] <= tv.RELIABILITY_CLAMP[1]

        need_fit = tv.team_need_fit(rows, ps, 2026)
        for positions in need_fit.values():
            for row in positions.values():
                assert tv.NEED_FIT_CLAMP[0] <= row["need_fit_factor"] <= tv.NEED_FIT_CLAMP[1]

        leverage = tv.team_leverage([{"owner_id": "team", "playoff_pct": p / 10} for p in range(11)])
        for row in leverage.values():
            assert (1 - tv.LEVERAGE_SPAN) <= row["leverage_factor"] <= (1 + tv.LEVERAGE_SPAN)
