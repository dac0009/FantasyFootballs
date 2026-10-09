"""End-to-end integration over the synthetic league.

This runs the real collect -> assemble -> publish path (only the HTTP client is
swapped) and asserts league-wide invariants that must hold for any correct
dataset, real or synthetic.
"""

import json
import math

import pytest

from pipeline import build
from pipeline.config import Credentials, LeagueConfig
from pipeline.sample import SampleClient


@pytest.fixture(scope="module")
def assembled():
    league = LeagueConfig(league_id=1, first_season=2019, last_season=2026,
                          team_count_hint=12, name="Test")
    dataset = build.collect(
        league,
        Credentials(swid="{x}", espn_s2="y"),
        seasons=list(range(2019, 2027)),
        use_cache=False,
        client=SampleClient(1),
    )
    return build.assemble(dataset)


class TestCollection:
    def test_all_seasons_present(self, assembled):
        assert sorted(assembled["season_payloads"]) == list(range(2019, 2027))

    def test_no_validation_errors(self, assembled):
        report = assembled["report"]
        assert report.ok, report.render()

    def test_owner_count_is_plausible(self, assembled):
        assert 10 <= len(assembled["owners"]) <= 20

    def test_current_season_is_the_latest(self, assembled):
        assert assembled["current_season"] == 2026


class TestInvariants:
    def test_every_completed_matchup_yields_exactly_two_team_weeks(self, assembled):
        completed = [m for m in assembled["matchups"] if m["completed"] and not m["is_bye"]]
        assert len(assembled["team_weeks"]) == 2 * len(completed)

    def test_no_team_plays_itself(self, assembled):
        for row in assembled["team_weeks"]:
            assert row["team_id"] != row["opponent_team_id"]

    def test_every_team_week_has_a_mirror(self, assembled):
        index = {
            (r["season"], r["week"], r["team_id"], r["opponent_team_id"]): r
            for r in assembled["team_weeks"]
        }
        for key, row in index.items():
            season, week, team, opponent = key
            mirror = index.get((season, week, opponent, team))
            assert mirror is not None, f"no mirror for {key}"
            assert mirror["score"] == row["opponent_score"]
            assert mirror["opponent_score"] == row["score"]

    def test_results_are_consistent_with_scores(self, assembled):
        for row in assembled["team_weeks"]:
            if row["score"] > row["opponent_score"]:
                assert row["result"] == "W"
            elif row["score"] < row["opponent_score"]:
                assert row["result"] == "L"
            else:
                assert row["result"] == "T"

    def test_league_wide_points_for_equals_points_against(self, assembled):
        """Every point scored is a point allowed by somebody."""
        scored = sum(r["score"] for r in assembled["team_weeks"])
        allowed = sum(r["opponent_score"] for r in assembled["team_weeks"])
        assert scored == pytest.approx(allowed, abs=0.01)

    def test_wins_equal_losses_league_wide(self, assembled):
        rows = assembled["team_weeks"]
        assert sum(1 for r in rows if r["result"] == "W") == sum(
            1 for r in rows if r["result"] == "L"
        )

    def test_future_games_are_never_in_team_weeks(self, assembled):
        completed_keys = {
            m["matchup_id"] for m in assembled["matchups"] if m["completed"]
        }
        for row in assembled["team_weeks"]:
            assert row["matchup_id"] in completed_keys


class TestStandings:
    def test_schedule_luck_sums_to_zero_each_season(self, assembled):
        for season, standings in assembled["standings_by_season"].items():
            total = sum(
                row["schedule_luck"] for row in standings
                if row["schedule_luck"] is not None
            )
            assert total == pytest.approx(0.0, abs=0.15), f"season {season}"

    def test_expected_wins_sum_matches_actual_wins(self, assembled):
        for season, standings in assembled["standings_by_season"].items():
            actual = sum(r["wins"] + 0.5 * r["ties"] for r in standings)
            expected = sum(r["expected_wins"] or 0 for r in standings)
            assert expected == pytest.approx(actual, abs=0.2), f"season {season}"

    def test_ranks_are_dense_and_unique(self, assembled):
        for standings in assembled["standings_by_season"].values():
            ranks = sorted(r["rank"] for r in standings)
            assert ranks == list(range(1, len(standings) + 1))

    def test_points_for_matches_summed_team_weeks(self, assembled):
        from pipeline.constants import GAME_REGULAR

        for season, standings in assembled["standings_by_season"].items():
            for row in standings:
                manual = sum(
                    r["score"] for r in assembled["team_weeks"]
                    if r["season"] == season
                    and r["owner_id"] == row["owner_id"]
                    and r["game_type"] == GAME_REGULAR
                )
                assert row["points_for"] == pytest.approx(manual, abs=0.02)

    def test_exactly_one_champion_per_completed_season(self, assembled):
        for season, standings in assembled["standings_by_season"].items():
            champions = [r for r in standings if r["is_champion"]]
            if season == 2026:  # season in progress
                assert champions == []
            else:
                assert len(champions) == 1, f"season {season}"


class TestCareers:
    def test_career_totals_equal_the_sum_of_seasons(self, assembled):
        for career in assembled["careers"]:
            season_wins = sum(s["wins"] for s in career["seasons_detail"])
            assert career["wins"] == season_wins
            season_points = sum(s["points_for"] for s in career["seasons_detail"])
            assert career["points_for"] == pytest.approx(season_points, abs=0.05)

    def test_championships_are_conserved(self, assembled):
        total = sum(c["championships"] for c in assembled["careers"])
        completed_seasons = len(assembled["season_payloads"]) - 1  # 2026 in progress
        assert total == completed_seasons

    def test_team_name_timeline_covers_every_season_played(self, assembled):
        for career in assembled["careers"]:
            timeline_seasons = [row["season"] for row in career["team_name_timeline"]]
            assert timeline_seasons == sorted(career["seasons"])


class TestHeadToHead:
    def test_each_pair_appears_once(self, assembled):
        keys = list(assembled["head_to_head"])
        assert len(keys) == len(set(keys))
        for key in keys:
            left, right = key.split("__")
            assert left < right

    def test_pair_records_are_internally_consistent(self, assembled):
        for record in assembled["head_to_head"].values():
            overall = record["overall"]
            assert (
                overall["left_wins"] + overall["right_wins"] + overall["ties"]
                == overall["games"]
            )
            assert len(record["meetings"]) == overall["games"]

    def test_pair_games_equal_matchup_counts(self, assembled):
        from collections import Counter

        from pipeline.head_to_head import pair_key

        counts = Counter()
        for row in assembled["team_weeks"]:
            if row["owner_id"] and row["opponent_owner_id"]:
                counts[pair_key(row["owner_id"], row["opponent_owner_id"])] += 1
        for key, record in assembled["head_to_head"].items():
            # Each meeting contributes two team_week rows.
            assert record["overall"]["games"] * 2 == counts[key]


class TestRecordBook:
    def test_record_book_has_entries_in_every_group(self, assembled):
        book = assembled["records"]
        assert book["scopes"]["regular"]["categories"]
        assert book["season"]
        assert book["career"]
        assert book["player"]

    def test_highest_score_is_actually_the_highest(self, assembled):
        book = assembled["records"]
        category = next(
            c for c in book["scopes"]["all"]["categories"] if c["id"] == "highest-score"
        )
        best = max(r["score"] for r in assembled["team_weeks"])
        assert category["entries"][0]["value"] == pytest.approx(best, abs=0.01)

    def test_highest_score_in_a_loss_really_lost(self, assembled):
        category = next(
            c for c in assembled["records"]["scopes"]["all"]["categories"]
            if c["id"] == "highest-score-loss"
        )
        assert all(e["result"] == "L" for e in category["entries"])

    def test_lowest_score_in_a_win_really_won(self, assembled):
        category = next(
            c for c in assembled["records"]["scopes"]["all"]["categories"]
            if c["id"] == "lowest-score-win"
        )
        assert all(e["result"] == "W" for e in category["entries"])


class TestGameOfTheWeek:
    def test_pick_is_an_unplayed_matchup(self, assembled):
        gotw = assembled["game_of_week"]
        assert gotw is not None
        pick = gotw["pick"]
        matchup = next(
            m for m in assembled["matchups"] if m["matchup_id"] == pick["matchup_id"]
        )
        assert matchup["completed"] is False

    def test_pick_is_the_highest_scored_candidate(self, assembled):
        gotw = assembled["game_of_week"]
        scores = [c["score"] for c in gotw["ranked"]]
        assert scores == sorted(scores, reverse=True)
        assert gotw["pick"]["score"] == scores[0]

    def test_pick_explains_itself(self, assembled):
        assert assembled["game_of_week"]["pick"]["reasons"]

    def test_weights_sum_to_one(self):
        from pipeline.gotw import WEIGHTS

        assert sum(WEIGHTS.values()) == pytest.approx(1.0)


class TestRosters:
    def test_started_points_reconcile_with_the_team_score(self, assembled):
        """The sample generator makes starters sum to the team score, so this
        also proves the roster extraction maps players to the right team-week."""
        by_key = {}
        for row in assembled["rosters"]:
            if row["started"] and row["points"] is not None:
                key = (row["season"], row["week"], row["owner_id"])
                by_key[key] = by_key.get(key, 0) + row["points"]
        checked = 0
        for row in assembled["team_weeks"]:
            key = (row["season"], row["week"], row["owner_id"])
            if key in by_key:
                assert by_key[key] == pytest.approx(row["score"], abs=0.05), key
                checked += 1
        assert checked > 100

    def test_manager_efficiency_is_between_zero_and_one(self, assembled):
        assert assembled["efficiency"]
        for row in assembled["efficiency"].values():
            assert 0 < row["manager_efficiency"] <= 1.0
            assert row["bench_regret_total"] >= 0


class TestPublishing:
    def test_publish_writes_valid_json_without_nan(self, assembled, tmp_path):
        result = build.publish(assembled, tmp_path, allow_shrink=True)
        assert result["files"]
        for relative in result["files"]:
            payload = json.loads((tmp_path / relative).read_text())
            assert _no_nan(payload), relative

    def test_meta_records_the_source_and_counts(self, assembled, tmp_path):
        build.publish(assembled, tmp_path, allow_shrink=True)
        meta = json.loads((tmp_path / "meta.json").read_text())
        assert meta["counts"]["seasons"] == 8
        assert meta["current_season"] == 2026
        assert meta["schema_version"] >= 1

    def test_no_espn_guid_leaks_into_published_files(self, assembled, tmp_path):
        import re

        build.publish(assembled, tmp_path, allow_shrink=True)
        guid = re.compile(r"\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}")
        for path in tmp_path.rglob("*.json"):
            assert not guid.search(path.read_text()), path

    def test_regression_guard_blocks_a_hollow_second_run(self, assembled, tmp_path):
        build.publish(assembled, tmp_path, allow_shrink=True)
        hollow = dict(assembled)
        hollow["counts"] = {**assembled["counts"], "completed_matchups": 0}
        from pipeline.validate import ValidationReport

        hollow["report"] = ValidationReport()
        with pytest.raises(build.PipelineError, match="would shrink"):
            build.publish(hollow, tmp_path)


def _no_nan(node) -> bool:
    if isinstance(node, float):
        return not (math.isnan(node) or math.isinf(node))
    if isinstance(node, dict):
        return all(_no_nan(v) for v in node.values())
    if isinstance(node, list):
        return all(_no_nan(v) for v in node)
    return True
