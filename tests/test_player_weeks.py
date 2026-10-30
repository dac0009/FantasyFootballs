"""Complete weekly lines for Fourteen and Fantasy (pipeline/player_weeks.py)."""

from __future__ import annotations

import json

from pipeline import player_weeks
from pipeline.espn_client import EspnClient


def stat(week, source, total, team=17, season=2023, split=1):
    return {
        "seasonId": season,
        "scoringPeriodId": week,
        "statSourceId": source,
        "statSplitTypeId": split,
        "appliedTotal": total,
        "proTeamId": team,
    }


def card(pid, *stats):
    return {"id": pid, "stats": list(stats)}


def test_parse_player_keeps_this_seasons_weekly_lines_only():
    player = card(
        1,
        stat(1, 0, 12.4), stat(1, 1, 10.0),
        stat(2, 1, 11.0),  # projected, no actual line yet
        stat(3, 0, 5.0, season=2022),  # other season
        stat(0, 0, 200.0, split=0),  # season total
        stat(4, 0, 7.0, team=0),  # free agent team code
    )
    points, projected, team = player_weeks.parse_player(player, 2023, range(1, 15))
    assert points == {1: 12.4, 4: 7.0}
    assert projected == {1: 10.0, 2: 11.0}
    assert team == {1: "NE", 2: "NE"}


def test_build_payload_is_indexed_by_week():
    built = player_weeks.build_payload(2023, [1, 2, 3], [card(7, stat(1, 0, 3.0), stat(3, 1, 9.5)), card(8)])
    assert built == {
        "season": 2023,
        "weeks": [1, 2, 3],
        "players": {"7": [[3.0, None, None], [None, None, 9.5], ["NE", None, "NE"]]},
    }


def test_agreement_counts_matches_and_missing_nonzero_lines():
    built = player_weeks.build_payload(2023, [1, 2], [card(7, stat(1, 0, 3.0), stat(2, 0, 4.0))])
    rows = [
        {"player_id": 7, "week": 1, "points": 3.02},  # within tolerance
        {"player_id": 7, "week": 2, "points": 9.0},  # mismatch
        {"player_id": 9, "week": 1, "points": 5.0},  # unknown player: ignored
    ]
    assert player_weeks.agreement(built, rows) == (1, 2)


class FakeClient:
    def __init__(self, cards, fail=False):
        self.cards = cards
        self.fail = fail
        self.calls = []

    def fetch_player_cards(self, season, ids):
        self.calls.append((season, sorted(set(ids))))
        if self.fail:
            raise RuntimeError("ESPN said no")
        return self.cards


def assembled_for(rows, weeks=14):
    return {
        "current_season": 2024,
        "rosters": rows,
        "season_payloads": {2023: {"meta": {"regular_season_weeks": weeks}}, 2024: {"meta": {"regular_season_weeks": weeks}}},
    }


def league_rows(n=30):
    return [{"season": 2023, "week": 1 + i % 14, "player_id": 100 + i, "points": float(i)} for i in range(n)]


def matching_cards(rows):
    return [card(r["player_id"], stat(r["week"], 0, r["points"]), stat(r["week"], 1, 10.0)) for r in rows]


def test_refresh_writes_once_skips_current_season_and_keeps_existing(tmp_path):
    rows = league_rows()
    client = FakeClient(matching_cards(rows))
    result = player_weeks.refresh(client, assembled_for(rows), tmp_path)
    assert result[2023].startswith("written: 30 players, 30/30 agree")
    assert 2024 not in result
    written = json.loads((tmp_path / "player_weeks" / "2023.json").read_text())
    assert written["weeks"] == list(range(1, 15)) and len(written["players"]) == 30
    again = player_weeks.refresh(client, assembled_for(rows), tmp_path)
    assert again == {2023: "kept"}
    assert len(client.calls) == 1


def test_refresh_refuses_a_scoring_mismatch(tmp_path):
    rows = league_rows()
    cards = [card(r["player_id"], stat(r["week"], 0, r["points"] + 3)) for r in rows]
    result = player_weeks.refresh(FakeClient(cards), assembled_for(rows), tmp_path)
    assert result[2023].startswith("skipped: ESPN agreed on 0 of")
    assert not (tmp_path / "player_weeks" / "2023.json").exists()


def test_refresh_never_raises(tmp_path):
    rows = league_rows()
    result = player_weeks.refresh(FakeClient([], fail=True), assembled_for(rows), tmp_path)
    assert result[2023].startswith("error: ESPN said no")
    assert player_weeks.refresh(None, {"season_payloads": None}, tmp_path) == {}
    assert -1 in player_weeks.refresh(None, {"rosters": [{"bad": 1}]}, tmp_path)


def test_fetch_player_cards_asks_for_every_week_in_chunks(monkeypatch):
    client = EspnClient.__new__(EspnClient)
    seen = []

    class Result:
        def __init__(self, payload):
            self.payload = payload

    def fake_fetch(season, views, **kw):
        seen.append((season, views, kw))
        ids = kw["filter_header"]["players"]["filterIds"]["value"]
        return Result({"players": [{"id": i, "player": {"stats": []}} for i in ids]})

    monkeypatch.setattr(client, "fetch_league", fake_fetch)
    out = client.fetch_player_cards(2021, [3, 1, 2, 2, 0, None], chunk=2)
    assert [p["id"] for p in out] == [1, 2, 3]
    assert len(seen) == 2
    season, views, kw = seen[0]
    assert season == 2021 and views == ["kona_playercard"]
    flt = kw["filter_header"]["players"]
    assert flt["filterStatsForTopScoringPeriodIds"] == {"value": 18, "additionalValue": ["002021", "102021"]}
    assert kw["cache_key"] == "2021/playercards_0" and kw["allow_history"] is False
