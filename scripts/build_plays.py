"""Build data/plays/<season>.json: real NFL plays for Fourteen and Fantasy.

Source: nflverse play-by-play (https://github.com/nflverse/nflverse-data,
CC-BY 4.0), which has every NFL play since 1999. For each completed league
season this writes, per week, the fantasy-relevant plays of every player
who was on a league roster that season, plus every team defense, keyed by
ESPN player id:

    {"season": 2023,
     "games": {"<game>": "CIN@ARI", ...},
     "weeks": {"5": {"<espn id>": [[qtr, seconds_left_in_qtr, game, text, points, play], ...]}}}

Big plays (touchdowns, 20+ yard gains, turnovers, kicks, defensive plays)
are listed one by one; a player's routine plays in a quarter are folded into
one line ("4 catches, 38 yds"). Points use this league's scoring, which was
fitted from our ESPN numbers; the game adds a final "bonuses and
adjustments" line so every player's total always equals his real ESPN score.

Historical seasons never change, so this is run by hand once per finished
season:  python scripts/build_plays.py 2019 2020 ... (downloads ~20 MB a season).
"""

from __future__ import annotations

import collections
import json
import sys
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PBP = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
CACHE = Path("/tmp/nflverse")

# nflverse team codes -> ESPN team defense ids (-16000 - ESPN team id).
ESPN_TEAM = {
    "ATL": 1, "BUF": 2, "CHI": 3, "CIN": 4, "CLE": 5, "DAL": 6, "DEN": 7, "DET": 8, "GB": 9, "TEN": 10,
    "IND": 11, "KC": 12, "LV": 13, "OAK": 13, "LA": 14, "LAR": 14, "MIA": 15, "MIN": 16, "NE": 17, "NO": 18,
    "NYG": 19, "NYJ": 20, "PHI": 21, "ARI": 22, "PIT": 23, "LAC": 24, "SD": 24, "SF": 25, "SEA": 26,
    "TB": 27, "WAS": 28, "WSH": 28, "CAR": 29, "JAX": 30, "BAL": 33, "HOU": 34,
}
NICK = {
    "ATL": "Falcons", "BUF": "Bills", "CHI": "Bears", "CIN": "Bengals", "CLE": "Browns", "DAL": "Cowboys",
    "DEN": "Broncos", "DET": "Lions", "GB": "Packers", "TEN": "Titans", "IND": "Colts", "KC": "Chiefs",
    "LV": "Raiders", "OAK": "Raiders", "LA": "Rams", "LAR": "Rams", "MIA": "Dolphins", "MIN": "Vikings",
    "NE": "Patriots", "NO": "Saints", "NYG": "Giants", "NYJ": "Jets", "PHI": "Eagles", "ARI": "Cardinals",
    "PIT": "Steelers", "LAC": "Chargers", "SF": "49ers", "SEA": "Seahawks", "TB": "Buccaneers",
    "WAS": "Commanders", "JAX": "Jaguars", "BAL": "Ravens", "HOU": "Texans", "CAR": "Panthers",
}

COLS = [
    "play_id", "game_id", "week", "season_type", "qtr", "quarter_seconds_remaining", "posteam", "defteam",
    "home_team", "away_team", "play_type", "yards_gained", "passer_player_id", "receiver_player_id",
    "rusher_player_id", "complete_pass", "pass_touchdown", "rush_touchdown", "return_touchdown", "td_team",
    "td_player_id", "interception", "fumble_lost", "fumbled_1_player_id", "fumble_recovery_1_team", "sack",
    "safety", "field_goal_result", "kick_distance", "extra_point_result", "two_point_conv_result",
    "two_point_attempt", "kicker_player_id", "passing_yards", "receiving_yards", "rushing_yards",
    "blocked_player_id",
]

BIG_GAIN = 20
# The league changed its scoring in 2022 (fitted from our own ESPN scores):
# (points per passing yard, passing TD points, long-TD bonuses on or off).
SCORING = {2019: (0.04, 4.0, False), 2020: (0.04, 4.0, False), 2021: (0.04, 4.0, False)}
SCORING_DEFAULT = (0.05, 6.0, True)


def fetch(url: str, name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        with urllib.request.urlopen(url) as resp:  # noqa: S310 - fixed public URL
            path.write_bytes(resp.read())
    return path


def num(v) -> float:
    try:
        f = float(v)
        return 0.0 if f != f else f
    except (TypeError, ValueError):
        return 0.0


def has(v) -> bool:
    return isinstance(v, str) and bool(v)


def last_name(display: str) -> str:
    parts = [p for p in str(display).split() if p.rstrip(".") not in {"Jr", "Sr", "II", "III", "IV", "V"}]
    return parts[-1] if parts else str(display)


LONG_TD_BONUS = True


def td_bonus(yards: float) -> float:
    if not LONG_TD_BONUS:
        return 0.0
    return 3.0 if yards >= 50 else 1.0 if yards >= 40 else 0.0


def fg_points(dist: float) -> float:
    return 5.0 if dist >= 50 else 4.0 if dist >= 40 else 3.0


def build_season(season: int, gsis_to_espn: dict, names: dict, wanted: set[int]) -> dict[int, dict]:
    df = pd.read_csv(fetch(PBP.format(season=season), f"pbp_{season}.csv.gz"), usecols=COLS, low_memory=False)
    df = df[df.season_type == "REG"]
    global LONG_TD_BONUS
    pass_yd, pass_td, LONG_TD_BONUS = SCORING.get(season, SCORING_DEFAULT)
    weeks: dict[int, dict] = {}
    # player-week-quarter routine totals: key -> [pts, catches, rec yds, carries, rush yds, pass yds, last clock]
    routine: dict[tuple, list] = collections.defaultdict(lambda: [0.0, 0, 0.0, 0, 0.0, 0.0, 900])

    def entry(week, espn_id, qtr, clock, game, text, pts, play):
        if espn_id not in wanted:
            return
        w = weeks.setdefault(week, {"games": {}, "players": collections.defaultdict(list)})
        w["players"][espn_id].append([qtr, clock, game, text, round(pts, 2), play])

    for r in df.itertuples(index=False):
        week = int(r.week)
        qtr = int(num(r.qtr))
        if qtr < 1:
            continue
        clock = int(num(r.quarter_seconds_remaining))
        game = f"{r.away_team}@{r.home_team}"
        weeks.setdefault(week, {"games": {}, "players": collections.defaultdict(list)})["games"][r.game_id] = game
        gid = r.game_id
        play = f"{gid}:{int(num(r.play_id))}"
        qtr = min(qtr, 5)
        pid = lambda g: gsis_to_espn.get(g) if has(g) else None  # noqa: E731
        nm = lambda g: names.get(g, "?") if has(g) else "?"  # noqa: E731
        two_pt = num(r.two_point_attempt) == 1

        if two_pt:
            if r.two_point_conv_result == "success":
                for g in (r.passer_player_id, r.receiver_player_id, r.rusher_player_id):
                    if pid(g):
                        entry(week, pid(g), qtr, clock, gid, f"{nm(g)} two-point conversion", 2.0, play)
            continue

        # Passing / receiving
        if r.play_type == "pass" and has(r.passer_player_id):
            qb = r.passer_player_id
            pyds = num(r.passing_yards)
            ptd = num(r.pass_touchdown) == 1
            inter = num(r.interception) == 1
            rec = r.receiver_player_id if has(r.receiver_player_id) else None
            ryds = num(r.receiving_yards)
            if num(r.complete_pass) == 1 and rec:
                rpts = 1.0 + ryds * 0.1 + (6.0 + td_bonus(ryds) if ptd and r.td_player_id == rec else 0.0)
                if ptd or ryds >= BIG_GAIN:
                    text = f"{nm(rec)} {int(ryds)}-yd {'TD catch' if ptd else 'catch'} from {nm(qb)}"
                    entry(week, pid(rec), qtr, clock, gid, text, rpts, play)
                else:
                    k = (week, pid(rec), qtr, gid, "rec")
                    t = routine[k]
                    t[0] += rpts
                    t[1] += 1
                    t[2] += ryds
                    t[6] = min(t[6], clock)
            qpts = pyds * pass_yd + (pass_td + td_bonus(pyds) if ptd else 0.0) - (2.0 if inter else 0.0)
            if ptd or inter or pyds >= BIG_GAIN:
                if inter:
                    text = f"{nm(qb)} intercepted"
                elif ptd:
                    text = f"{nm(qb)} {int(pyds)}-yd TD pass to {nm(rec)}"
                else:
                    text = f"{nm(qb)} {int(pyds)}-yd completion to {nm(rec)}"
                entry(week, pid(qb), qtr, clock, gid, text, qpts, play)
            elif pyds:
                t = routine[(week, pid(qb), qtr, gid, "pass")]
                t[0] += qpts
                t[5] += pyds
                t[6] = min(t[6], clock)

        # Rushing
        if r.play_type == "run" and has(r.rusher_player_id):
            rb = r.rusher_player_id
            uyds = num(r.rushing_yards)
            utd = num(r.rush_touchdown) == 1 and r.td_player_id == rb
            upts = uyds * 0.1 + (6.0 + td_bonus(uyds) if utd else 0.0)
            if utd or uyds >= BIG_GAIN:
                entry(week, pid(rb), qtr, clock, gid, f"{nm(rb)} {int(uyds)}-yd {'TD run' if utd else 'run'}", upts, play)
            else:
                t = routine[(week, pid(rb), qtr, gid, "rush")]
                t[0] += upts
                t[3] += 1
                t[4] += uyds
                t[6] = min(t[6], clock)

        # Fumbles lost
        if num(r.fumble_lost) == 1 and has(r.fumbled_1_player_id) and pid(r.fumbled_1_player_id):
            entry(week, pid(r.fumbled_1_player_id), qtr, clock, gid, f"{nm(r.fumbled_1_player_id)} fumble lost", -2.0, play)

        # Kicking
        if r.play_type == "field_goal" and has(r.kicker_player_id) and pid(r.kicker_player_id):
            k = r.kicker_player_id
            dist = num(r.kick_distance)
            if r.field_goal_result == "made":
                entry(week, pid(k), qtr, clock, gid, f"{nm(k)} {int(dist)}-yd field goal", fg_points(dist), play)
            else:
                entry(week, pid(k), qtr, clock, gid, f"{nm(k)} misses from {int(dist)}", -1.0, play)
        if r.play_type == "extra_point" and has(r.kicker_player_id) and pid(r.kicker_player_id):
            k = r.kicker_player_id
            good = r.extra_point_result == "good"
            entry(week, pid(k), qtr, clock, gid, f"{nm(k)} extra point{'' if good else ' missed'}", 1.0 if good else -1.0, play)

        # Team defense (the side without the ball)
        defense = r.defteam if has(r.defteam) else None
        if defense and defense in ESPN_TEAM:
            dst = -16000 - ESPN_TEAM[defense]
            nick = NICK.get(defense, defense)
            if num(r.sack) == 1:
                entry(week, dst, qtr, clock, gid, f"{nick} sack", 1.0, play)
            if num(r.interception) == 1:
                entry(week, dst, qtr, clock, gid, f"{nick} interception", 2.0, play)
            if num(r.fumble_lost) == 1:
                entry(week, dst, qtr, clock, gid, f"{nick} fumble recovery", 2.0, play)
            if num(r.safety) == 1:
                entry(week, dst, qtr, clock, gid, f"{nick} safety", 2.0, play)
            if num(r.return_touchdown) == 1 and r.td_team == defense:
                entry(week, dst, qtr, clock, gid, f"{nick} defensive touchdown", 6.0, play)
            if has(r.blocked_player_id) and r.play_type in ("field_goal", "punt", "extra_point"):
                entry(week, dst, qtr, clock, gid, f"{nick} blocked kick", 2.0, play)
        # Special-teams return touchdowns by the kicking-receiving team
        if num(r.return_touchdown) == 1 and r.play_type in ("kickoff", "punt") and has(r.td_team) and r.td_team in ESPN_TEAM:
            dst = -16000 - ESPN_TEAM[r.td_team]
            entry(week, dst, qtr, clock, gid, f"{NICK.get(r.td_team, r.td_team)} return touchdown", 6.0, play)

    # Fold routine plays into one line per player per quarter.
    for (week, espn_id, qtr, gid, kind), t in routine.items():
        if espn_id is None or abs(t[0]) < 0.05:
            continue
        if kind == "rec":
            text = f"{t[1]} catch{'es' if t[1] != 1 else ''}, {int(t[2])} yds"
        elif kind == "rush":
            text = f"{t[3]} carr{'ies' if t[3] != 1 else 'y'}, {int(t[4])} yds"
        else:
            text = f"{int(t[5])} passing yds"
        entry(week, espn_id, qtr, t[6], gid, text, t[0], f"{gid}:{kind}:{qtr}:{espn_id}")

    out = {}
    for week, w in weeks.items():
        players = {}
        for espn_id, events in w["players"].items():
            events.sort(key=lambda e: (e[0], -e[1]))
            players[str(espn_id)] = events
        out[week] = {"season": season, "week": week, "games": w["games"], "players": players}
    return out


def main(seasons: list[int]) -> None:
    pl = pd.read_csv(fetch(PLAYERS, "players.csv"), usecols=["gsis_id", "espn_id", "display_name"], low_memory=False)
    pl = pl.dropna(subset=["gsis_id"])
    gsis_to_espn = {g: int(e) for g, e in zip(pl.gsis_id, pl.espn_id) if e == e}
    names = {g: last_name(n) for g, n in zip(pl.gsis_id, pl.display_name)}
    seasons_index = {s["season"]: s for s in json.loads((DATA / "seasons.json").read_text())}
    for season in seasons:
        meta = seasons_index.get(season)
        if not meta or meta.get("is_current"):
            print(f"{season}: skipped (not a finished league season)")
            continue
        last = int(meta.get("regular_season_weeks") or 0)
        rows = json.loads((DATA / "rosters" / f"{season}.json").read_text())
        wanted = {r["player_id"] for r in rows} | {-16000 - t for t in set(ESPN_TEAM.values())}
        built = build_season(season, gsis_to_espn, names, wanted)
        games: dict[str, str] = {}
        weeks_out: dict[str, dict] = {}
        for week, payload in sorted(built.items()):
            if week > last:
                continue
            games.update(payload["games"])
            weeks_out[str(week)] = payload["players"]
        target = DATA / "plays" / f"{season}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps({"season": season, "games": games, "weeks": weeks_out}, separators=(",", ":"), ensure_ascii=False)
        target.write_text(text)
        print(f"{season}: {len(weeks_out)} weeks, {len(text) / 1024:.0f} KB")


if __name__ == "__main__":
    main([int(a) for a in sys.argv[1:]] or [2019, 2020, 2021, 2022, 2023, 2024, 2025])
