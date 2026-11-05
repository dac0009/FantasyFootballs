"""FFBucks sportsbook: odds math, line model, lock times."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from pipeline import build
from pipeline import sportsbook as sb
from pipeline.config import Credentials, LeagueConfig
from pipeline.sample import SampleClient

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)  # a Wednesday

SCHEDULE_CSV = """game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score
2026_09_JAX_BAL,2026,REG,9,2026-11-05,Thursday,20:15,JAX,,BAL,
2026_09_CIN_ATL,2026,REG,9,2026-11-08,Sunday,09:30,CIN,,ATL,
2026_09_LA_WAS,2026,REG,9,2026-11-08,Sunday,13:00,LA,,WAS,
2026_09_HOU_LAC,2026,REG,9,2026-11-08,Sunday,16:05,HOU,,LAC,
2026_09_BUF_MIN,2026,REG,9,2026-11-09,Monday,20:15,BUF,,MIN,
2026_10_KC_DEN,2026,REG,10,2026-11-15,Sunday,,KC,,DEN,
2026_01_DAL_PHI,2026,REG,1,2026-09-10,Thursday,20:20,DAL,,PHI,
2025_09_JAX_BAL,2025,REG,9,2025-11-06,Thursday,20:15,JAX,,BAL,
"""


@pytest.fixture
def schedule():
    return sb.parse_schedule(SCHEDULE_CSV, 2026)


def line(**kw):
    base = {
        "line_id": "2026-9-1-2",
        "week": 9,
        "nfl_weeks": [9],
        "home_team_id": 1,
        "away_team_id": 2,
        "lock_at": None,
        "lock_game": None,
        "lock_source": None,
    }
    base.update(kw)
    return base


class TestOddsMath:
    def test_round_half(self):
        assert sb.round_half(6.24) == 6.0
        assert sb.round_half(6.25) == 6.5
        assert sb.round_half(-6.25) == -6.5
        assert sb.round_half(0.2) == 0.0
        assert sb.round_half(0.0) == 0.0

    def test_american_odds(self):
        assert sb.american_from_probability(110 / 210) == -110
        assert sb.american_from_probability(0.5) == -100
        assert sb.american_from_probability(0.25) == 300
        assert sb.american_from_probability(0.8) == -400
        assert sb.american_from_probability(0.6) % 5 == 0

    def test_decimal_odds(self):
        assert sb.decimal_from_american(-110) == pytest.approx(1 + 100 / 110)
        assert sb.decimal_from_american(150) == pytest.approx(2.5)
        with pytest.raises(ValueError):
            sb.decimal_from_american(0)

    def test_coin_flip_is_minus_110_both_ways(self):
        assert sb.moneylines(0.5) == (-110, -110)

    @pytest.mark.parametrize("p", [0.1, 0.3, 0.5, 0.62, 0.85, 0.97])
    def test_moneylines_carry_juice(self, p):
        home, away = sb.moneylines(p)
        implied = sum(1 / sb.decimal_from_american(x) for x in (home, away))
        # Both sides together cost more than 100%: the book's margin.
        assert implied > 1.0
        assert implied < 1.10

    def test_favorite_gets_the_negative_price(self):
        home, away = sb.moneylines(0.7)
        assert home < 0 < away

    def test_extreme_probabilities_are_capped(self):
        home, away = sb.moneylines(0.9999)
        assert home >= -9900
        assert away > 0


class TestPricing:
    def test_spread_total_and_prices(self):
        priced = sb.price_matchup({"expected": 130, "sd": 25}, {"expected": 120, "sd": 25})
        assert priced["home_spread"] == -10.0  # home favored by 10
        assert priced["total"] == 250.0
        assert priced["spread_price"] == priced["total_price"] == -110
        assert priced["home_ml"] < 0 < priced["away_ml"]
        assert 0.5 < priced["home_win_prob"] < 1

    def test_underdog_home_gets_plus_points(self):
        priced = sb.price_matchup({"expected": 110.2, "sd": 25}, {"expected": 116.4, "sd": 25})
        assert priced["home_spread"] == 6.0

    def test_two_week_playoff_matchup_scales(self):
        one = sb.price_matchup({"expected": 130, "sd": 25}, {"expected": 120, "sd": 25})
        two = sb.price_matchup({"expected": 130, "sd": 25}, {"expected": 120, "sd": 25}, periods=2)
        assert two["total"] == 500.0
        assert two["home_spread"] == -20.0
        # More games means the better team is more certain to win.
        assert two["home_win_prob"] > one["home_win_prob"]

    def test_form_moves_expected_score(self):
        from conftest import pair

        weeks = []
        for week in range(1, 7):
            hot = 100 if week <= 3 else 150  # same season average, hot lately
            weeks += pair(2026, week, 1, hot, 2, 125)
        models = sb.team_models(weeks, 2026, ["owner-1", "owner-2"])
        assert models["owner-1"]["form_z"] > 0
        assert models["owner-1"]["expected"] > models["owner-1"]["season_mean"]


class TestSchedule:
    def test_parses_one_season_in_utc(self, schedule):
        assert {g["nfl_week"] for g in schedule} == {1, 9, 10}
        thursday = next(g for g in schedule if g["home"] == "BAL")
        # 8:15 PM Eastern Standard Time is 01:15 UTC the next day.
        assert thursday["kickoff"] == datetime(2026, 11, 6, 1, 15, tzinfo=UTC)
        opener = next(g for g in schedule if g["home"] == "PHI")
        # September is daylight time: 8:20 PM EDT is 00:20 UTC.
        assert opener["kickoff"] == datetime(2026, 9, 11, 0, 20, tzinfo=UTC)

    def test_team_codes_match_espn(self, schedule):
        rams = next(g for g in schedule if g["home"] == "WSH")
        assert rams["away"] == "LAR"
        assert rams["label"] == "LAR @ WSH"

    def test_missing_kickoff_time_is_treated_as_early(self, schedule):
        game = next(g for g in schedule if g["home"] == "DEN")
        assert game["kickoff"] == datetime(2026, 11, 15, 5, 0, tzinfo=UTC)  # midnight ET

    def test_rosters_from_mroster_skip_free_agents(self):
        payload = {
            "teams": [
                {
                    "id": 1,
                    "roster": {
                        "entries": [
                            {"playerPoolEntry": {"player": {"proTeamId": 33}}},  # BAL
                            {"playerPoolEntry": {"player": {"proTeamId": 0}}},  # FA
                        ]
                    },
                },
                {"id": 2, "roster": {"entries": []}},
            ]
        }
        assert sb.extract_current_rosters(payload) == {1: ["BAL"], 2: []}


class TestLocks:
    def test_locks_at_earliest_kickoff_including_bench(self, schedule):
        rosters = {1: ["MIN", "LAC"], 2: ["WSH"]}  # bench players count too
        lock = sb.compute_lock(line(), schedule, rosters, NOW)
        assert lock == {
            "lock_at": "2026-11-08T18:00:00Z",
            "lock_game": "LAR @ WSH",
            "lock_source": "rosters",
        }

    def test_thursday_pickup_moves_lock_earlier(self, schedule):
        rosters = {1: ["MIN"], 2: ["WSH"]}
        first = line(**sb.compute_lock(line(), schedule, rosters, NOW))
        rosters[2].append("JAX")
        moved = sb.compute_lock(first, schedule, rosters, NOW + timedelta(hours=6))
        assert moved["lock_at"] == "2026-11-06T01:15:00Z"
        assert moved["lock_game"] == "JAX @ BAL"

    def test_a_passed_lock_never_reopens(self, schedule):
        locked = line(lock_at="2026-11-06T01:15:00Z", lock_game="JAX @ BAL", lock_source="rosters")
        friday = datetime(2026, 11, 6, 15, 0, tzinfo=UTC)
        # The Thursday player was dropped after kickoff: the lock still stands.
        lock = sb.compute_lock(locked, schedule, {1: ["MIN"], 2: ["WSH"]}, friday)
        assert lock["lock_at"] == "2026-11-06T01:15:00Z"

    def test_lock_can_move_later_before_it_passes(self, schedule):
        early = line(lock_at="2026-11-06T01:15:00Z", lock_game="JAX @ BAL", lock_source="rosters")
        lock = sb.compute_lock(early, schedule, {1: ["MIN"], 2: ["LAC"]}, NOW)
        assert lock["lock_at"] == "2026-11-08T21:05:00Z"

    def test_missing_rosters_fall_back_to_first_kickoff_of_the_week(self, schedule):
        lock = sb.compute_lock(line(), schedule, None, NOW)
        assert lock["lock_at"] == "2026-11-06T01:15:00Z"
        assert lock["lock_source"] == "week_start"
        lock = sb.compute_lock(line(), schedule, {1: ["MIN"], 2: []}, NOW)
        assert lock["lock_source"] == "week_start"

    def test_no_schedule_keeps_previous_or_leaves_unlocked(self):
        assert sb.compute_lock(line(), None, {1: ["MIN"]}, NOW)["lock_at"] is None
        kept = line(lock_at="2026-11-08T18:00:00Z", lock_game="x", lock_source="rosters")
        assert sb.compute_lock(kept, [], None, NOW)["lock_at"] == "2026-11-08T18:00:00Z"

    def test_multi_week_matchup_uses_its_first_nfl_week(self, schedule):
        lock = sb.compute_lock(
            line(week=15, nfl_weeks=[9, 10]), schedule, {1: ["DEN"], 2: ["MIN"]}, NOW
        )
        assert lock["lock_game"] == "BUF @ MIN"


# ---------------------------------------------------------------------------
# Whole-file behaviour over the synthetic league
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def assembled():
    league = LeagueConfig(
        league_id=1, first_season=2019, last_season=2026, team_count_hint=12, name="Test"
    )
    dataset = build.collect(
        league,
        Credentials(swid="{x}", espn_s2="y"),
        seasons=[2025, 2026],
        use_cache=False,
        client=SampleClient(1),
    )
    return build.assemble(dataset)


class FakeClient:
    def __init__(self, team_ids, fail=False):
        self.team_ids = team_ids
        self.fail = fail
        self.use_cache = True
        self.seen_cache_flag = None

    def fetch_league(self, season, views, **kw):
        self.seen_cache_flag = self.use_cache
        if self.fail:
            raise RuntimeError("ESPN down")
        teams = [
            {"id": t, "roster": {"entries": [{"playerPoolEntry": {"player": {"proTeamId": 33}}}]}}
            for t in self.team_ids
        ]

        class Result:
            payload = {"teams": teams}

        return Result()


def _sched_for(week):
    return lambda season: sb.parse_schedule(SCHEDULE_CSV.replace("REG,9,", f"REG,{week},"), season)


def _team_ids(assembled):
    return list({t["team_id"] for t in assembled["season_data"][2026]["teams"]})


class TestPublishedFile:
    def test_lines_cover_the_upcoming_week_only(self, assembled):
        payload = sb.build_lines(assembled, None, NOW)
        week = assembled["current"]["upcoming_week"]
        assert payload["week"] == week
        assert payload["lines"]
        for item in payload["lines"]:
            assert item["week"] == week
            assert item["home_owner_id"] != item["away_owner_id"]
            assert item["spread_price"] == item["total_price"] == -110
            assert item["lock_at"] is None  # build_lines never invents a lock
        assert all(r["winner"] in {"HOME", "AWAY", "TIE"} for r in payload["results"])
        assert not payload["season_complete"]

    def test_posted_lines_are_frozen_for_the_week(self, assembled):
        first = sb.build_lines(assembled, None, NOW)
        tampered = json.loads(json.dumps(first))
        tampered["lines"][0]["home_spread"] = 99.5
        again = sb.build_lines(assembled, tampered, NOW + timedelta(days=2))
        assert again["lines"][0]["home_spread"] == 99.5
        assert again["lines"][0]["posted_at"] == first["lines"][0]["posted_at"]

    def test_refresh_writes_locks_and_reads_rosters_fresh(self, assembled, tmp_path):
        week = assembled["current"]["upcoming_week"]
        client = FakeClient(_team_ids(assembled))
        status = sb.refresh(client, assembled, tmp_path, schedule_loader=_sched_for(week), now=NOW)
        assert "with lock times" in status
        assert client.seen_cache_flag is False and client.use_cache is True
        written = json.loads((tmp_path / "sportsbook" / "lines.json").read_text())
        assert all(item["lock_game"] == "JAX @ BAL" for item in written["lines"])
        assert written["credit"].startswith("NFL schedule data: nflverse")

    def test_refresh_never_raises(self, assembled, tmp_path):
        def broken(season):
            raise OSError("nflverse down")

        status = sb.refresh(
            FakeClient([], fail=True), assembled, tmp_path, schedule_loader=broken, now=NOW
        )
        assert "error" not in status
        written = json.loads((tmp_path / "sportsbook" / "lines.json").read_text())
        # No schedule: lines are posted but unlocked, which the app treats as closed.
        assert all(item["lock_at"] is None for item in written["lines"])
        assert sb.refresh(None, {}, tmp_path).startswith("error")

    def test_locks_command_only_moves_lock_times(self, assembled, tmp_path):
        week = assembled["current"]["upcoming_week"]
        team_ids = _team_ids(assembled)
        sb.refresh(
            FakeClient(team_ids, fail=True),
            assembled,
            tmp_path,
            schedule_loader=_sched_for(week),
            now=NOW,
        )
        path = tmp_path / "sportsbook" / "lines.json"
        before = json.loads(path.read_text())
        assert all(item["lock_source"] == "week_start" for item in before["lines"])
        status = sb.refresh_locks(
            FakeClient(team_ids), tmp_path, schedule_loader=_sched_for(week), now=NOW
        )
        n = len(before["lines"])
        assert status == f"lock times updated for {n} of {n} lines"
        after = json.loads(path.read_text())
        # BAL still kicks off first, so the time is the same; only the source changed.
        assert all(item["lock_source"] == "rosters" for item in after["lines"])
        assert [i["lock_at"] for i in after["lines"]] == [i["lock_at"] for i in before["lines"]]
        for old, new in zip(before["lines"], after["lines"], strict=True):
            assert {k: v for k, v in old.items() if not k.startswith("lock")} == {
                k: v for k, v in new.items() if not k.startswith("lock")
            }
        again = sb.refresh_locks(
            FakeClient(team_ids), tmp_path, schedule_loader=_sched_for(week), now=NOW
        )
        assert again == "lock times unchanged"

    def test_season_complete_only_after_the_final_week(self):
        meta = {
            "final_scoring_period": 17,
            "matchup_period_scoring_periods": {str(w): [w] for w in range(1, 18)},
        }
        games = [{"week": w, "is_bye": False, "completed": True} for w in range(1, 15)]
        # Regular season done, playoff games not on ESPN's schedule yet: not complete.
        assert not sb._season_complete(games, meta)
        games += [{"week": w, "is_bye": False, "completed": True} for w in (15, 16, 17)]
        assert sb._season_complete(games, meta)
        games.append({"week": 17, "is_bye": False, "completed": False})
        assert not sb._season_complete(games, meta)

    def test_locks_command_with_nothing_posted(self, tmp_path):
        assert sb.refresh_locks(FakeClient([]), tmp_path) == "no lines posted; nothing to do"
