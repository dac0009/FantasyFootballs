"""Playoff simulation: invariants that must hold for any correct model."""

import pytest
from conftest import pair

from pipeline import playoffs


def standings(rows):
    return [
        {"owner_id": o, "team_name": o, "rank": i + 1, "wins": w, "losses": losses, "ties": 0,
         "record": f"{w}-{losses}", "points_for": pf}
        for i, (o, w, losses, pf) in enumerate(rows)
    ]


def game(mid, week, home, away):
    return {"matchup_id": mid, "season": 2026, "week": week, "is_bye": False, "completed": False,
            "home_owner_id": home, "away_owner_id": away, "home_team_name": home, "away_team_name": away}


@pytest.fixture
def league():
    # Four teams, two weeks played, two games each remaining.
    tw = []
    tw += pair(2026, 1, 1, 140, 2, 100, owner="a", opp_owner="b")
    tw += pair(2026, 1, 3, 120, 4, 90, owner="c", opp_owner="d")
    tw += pair(2026, 2, 1, 130, 3, 110, owner="a", opp_owner="c")
    tw += pair(2026, 2, 2, 105, 4, 95, owner="b", opp_owner="d")
    st = standings([("a", 2, 0, 270), ("c", 1, 1, 230), ("b", 1, 1, 205), ("d", 0, 2, 185)])
    rem = [game("g1", 3, "a", "d"), game("g2", 3, "b", "c"), game("g3", 4, "a", "b"), game("g4", 4, "c", "d")]
    return tw, st, rem


class TestModels:
    def test_shrinkage_pulls_toward_league_mean(self, league):
        tw, st, _ = league
        models = playoffs.scoring_models(tw, 2026, ["a", "b", "c", "d"])
        league_mean = models["_league"]["mean"]
        for o in "abcd":
            raw, shrunk = models[o]["raw_mean"], models[o]["mean"]
            # Shrunk mean lies strictly between raw mean and league mean.
            assert min(raw, league_mean) <= shrunk <= max(raw, league_mean)

    def test_win_probability_is_symmetric_and_bounded(self):
        a = {"mean": 120.0, "sd": 20.0}
        b = {"mean": 100.0, "sd": 20.0}
        p = playoffs.win_probability(a, b)
        assert 0.5 < p < 1.0
        assert playoffs.win_probability(b, a) == pytest.approx(1 - p, abs=1e-9)
        assert playoffs.win_probability(a, a) == pytest.approx(0.5)

    def test_bye_count(self):
        assert playoffs.bye_count(6) == 2
        assert playoffs.bye_count(4) == 0
        assert playoffs.bye_count(8) == 0
        assert playoffs.bye_count(5) == 3


class TestSimulation:
    def test_playoff_probabilities_sum_to_bracket_size(self, league):
        tw, st, rem = league
        pic = playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=2,
                                             regular_season_weeks=4, simulations=2000)
        total = sum(t["playoff_pct"] for t in pic["teams"])
        assert total == pytest.approx(2.0, abs=0.01)

    def test_deterministic(self, league):
        tw, st, rem = league
        a = playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=2, regular_season_weeks=4, simulations=500)
        b = playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=2, regular_season_weeks=4, simulations=500)
        assert a["teams"] == b["teams"]

    def test_winning_this_week_never_hurts(self, league):
        tw, st, rem = league
        pic = playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=2, regular_season_weeks=4, simulations=2000)
        for t in pic["teams"]:
            if t["this_week"]:
                assert t["this_week"]["if_win"] >= t["this_week"]["if_loss"]

    def test_clinched_team_is_flagged(self):
        # Team a has 10 wins with one game left; nobody else can reach 10.
        st = standings([("a", 10, 0, 1500), ("b", 2, 8, 1000), ("c", 2, 8, 990), ("d", 1, 9, 900)])
        tw = pair(2026, 1, 1, 120, 2, 100, owner="a", opp_owner="b")
        rem = [game("g1", 11, "a", "b"), game("g2", 11, "c", "d")]
        pic = playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=1, regular_season_weeks=11, simulations=500)
        a = next(t for t in pic["teams"] if t["owner_id"] == "a")
        assert a["status"] == "clinched"
        assert a["playoff_pct"] == 1.0
        d = next(t for t in pic["teams"] if t["owner_id"] == "d")
        assert d["status"] == "eliminated"

    def test_no_remaining_games_means_standings_decide(self):
        st = standings([("a", 3, 0, 300), ("b", 2, 1, 280), ("c", 1, 2, 250), ("d", 0, 3, 200)])
        tw = pair(2026, 1, 1, 120, 2, 100, owner="a", opp_owner="b")
        pic = playoffs.build_playoff_picture(2026, st, [], tw, playoff_teams=2, regular_season_weeks=3, simulations=100)
        by = {t["owner_id"]: t["playoff_pct"] for t in pic["teams"]}
        assert by == {"a": 1.0, "b": 1.0, "c": 0.0, "d": 0.0}
        assert pic["previews"] == []

    def test_previews_sorted_by_leverage(self, league):
        tw, st, rem = league
        pic = playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=2, regular_season_weeks=4, simulations=1000)
        lev = [p["leverage"] for p in pic["previews"]]
        assert lev == sorted(lev, reverse=True)
        assert len(pic["previews"]) == 2  # only week 3's games

    def test_returns_none_without_playoff_format(self, league):
        tw, st, rem = league
        assert playoffs.build_playoff_picture(2026, st, rem, tw, playoff_teams=None, regular_season_weeks=4) is None
