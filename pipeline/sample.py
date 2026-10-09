"""Deterministic synthetic league, in ESPN's own response shape.

Why this exists
---------------
1. The site must build and be reviewable without ESPN credentials, so the
   repository ships a complete ``data/`` directory generated from here. Every
   page is clearly marked as sample data (``meta.source == "sample"``).
2. Because the generator emits *ESPN-shaped* payloads rather than normalized
   rows, running it exercises the real :mod:`pipeline.extract` code path. A
   bug in matchup classification or owner resolution shows up in the sample
   build, not only in production.
3. It deliberately includes the awkward cases: a league that grew from 10 to
   12 teams, owners who join and leave, teams renamed almost every year, a
   tie, a playoff bye, and a current season that is only partly played.

The names here are fictional. Nothing in this module touches the network.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence

from .espn_client import FetchResult, NotAvailableError

FIRST_SEASON = 2019
LAST_SEASON = 2026
CURRENT_SEASON = 2026
CURRENT_COMPLETED_WEEKS = 4

PEOPLE = [
    ("Avery Lind", 0.00),
    ("Marcus Oyelaran", 0.00),
    ("Dev Patel", 0.00),
    ("Nora Kristiansen", 0.00),
    ("Theo Barros", 0.00),
    ("Ruth Mwangi", 0.00),
    ("Caleb Ferraro", 0.00),
    ("Priya Raghunathan", 0.00),
    ("Jonah Weiss", 0.00),
    ("Sasha Petrova", 0.00),
    ("Elliot Nakamura", 0.00),
    ("Imani Brooks", 0.00),
    ("Diego Salcedo", 0.00),
    ("Hollis Vance", 0.00),
    ("Mira Oduya", 0.00),
]

#: Each person gets a persistent fake ESPN member GUID.
def _guid(index: int) -> str:
    block = f"{index:08X}"
    return f"{{{block}-1111-2222-3333-{block}00000000}}"


TEAM_NAME_POOL = [
    "Gridiron Collective",
    "Northside Athletic",
    "Harbor City FC",
    "The Analytics Dept",
    "Sunset Blvd Sharks",
    "Pine Street Pilots",
    "Mallard Point",
    "Union Hall United",
    "Cedar Gap Giants",
    "Westfield Works",
    "Ironworks",
    "Lantern District",
    "Quarry Road Royals",
    "Delta Fog",
    "Birchwood Bandits",
    "Summit Supply Co",
    "Riverbend Rail",
    "Ninth Ward Nine",
    "Copper Line",
    "Halstead Heat",
    "Granite Row",
    "The Standard",
    "Foundry FC",
    "Kestrel Club",
]

POSITIONS = [
    ("QB", 1, 2),
    ("RB", 2, 5),
    ("WR", 3, 6),
    ("TE", 4, 2),
    ("K", 5, 1),
    ("D/ST", 16, 1),
]

PRO_TEAM_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

LINEUP_SLOT_COUNTS = {"0": 1, "2": 2, "4": 2, "6": 1, "23": 1, "16": 1, "17": 1, "20": 7}
STARTER_SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17]

FIRST_NAMES = [
    "Jalen", "Brock", "Kyren", "Tank", "Rome", "Puka", "Deebo", "Jaxon",
    "Garrett", "Trey", "Zay", "Rashee", "Tyjae", "Bijan", "Drake", "Kendre",
    "Chigoziem", "Marvin", "Xavier", "Ladd", "Bo", "Caleb", "Keon", "Jermaine",
]
LAST_NAMES = [
    "Whitfield", "Okonkwo", "Marchetti", "Delgado", "Haverford", "Nkemdiche",
    "Ruggiero", "Sandoval", "Ahuja", "Bergstrom", "Castellanos", "Dubois",
    "Eriksen", "Fontaine", "Gallardo", "Halvorsen", "Ivarsson", "Jensen",
]


class SampleLeague:
    """Builds every ESPN-shaped payload for a fictional 8-season league."""

    def __init__(self, league_id: int = 61253603, seed: int = 20261008) -> None:
        self.league_id = league_id
        self.rng = random.Random(seed)
        self.people = [
            {
                "id": _guid(i + 1),
                "name": name,
                "firstName": name.split()[0],
                "lastName": " ".join(name.split()[1:]),
                "skill": self.rng.uniform(-9.0, 9.0),
            }
            for i, (name, _) in enumerate(PEOPLE)
        ]
        self.players = self._build_players()
        self._seasons: dict[int, dict] = {}
        for season in range(FIRST_SEASON, LAST_SEASON + 1):
            self._seasons[season] = self._build_season(season)

    # -- players ----------------------------------------------------------

    def _build_players(self) -> dict[int, dict]:
        players: dict[int, dict] = {}
        pid = 1000
        for position, position_id, _ in POSITIONS:
            count = 60 if position in {"RB", "WR"} else 32
            for _ in range(count):
                pid += 1
                if position == "D/ST":
                    name = f"{self.rng.choice(LAST_NAMES)} D/ST"
                else:
                    name = f"{self.rng.choice(FIRST_NAMES)} {self.rng.choice(LAST_NAMES)}"
                players[pid] = {
                    "id": pid,
                    "fullName": name,
                    "defaultPositionId": position_id,
                    "proTeamId": self.rng.choice(PRO_TEAM_IDS),
                    "position": position,
                }
        return players

    def _players_for(self, position: str) -> list[int]:
        return [pid for pid, p in self.players.items() if p["position"] == position]

    # -- season construction ---------------------------------------------

    def _build_season(self, season: int) -> dict:
        team_count = 10 if season <= 2020 else 12
        regular_weeks = 13 if season <= 2020 else 14
        playoff_rounds = 3
        rng = random.Random(f"{season}-roster")

        # Owner churn: a stable core plus turnover at the edges.
        pool = list(range(len(self.people)))
        rotation = (season - FIRST_SEASON) % 3
        participants = [i for i in pool if (i + rotation) % 5 != 4][:team_count]
        while len(participants) < team_count:
            for candidate in pool:
                if candidate not in participants:
                    participants.append(candidate)
                    break

        name_offset = (season - FIRST_SEASON) * 5
        teams = []
        taken_names: set[int] = set()

        def claim(preferred: int) -> int:
            index = preferred % len(TEAM_NAME_POOL)
            while index in taken_names:
                index = (index + 1) % len(TEAM_NAME_POOL)
            taken_names.add(index)
            return index

        for slot, person_index in enumerate(participants):
            person = self.people[person_index]
            team_id = slot + 1
            # Rename most teams most years, but let a couple persist so the
            # frontend has both the "renamed again" and "never renames" cases.
            if person_index % 4 == 0 and season > FIRST_SEASON:
                name_index = claim(person_index)
            else:
                name_index = claim(person_index * 3 + name_offset)
            teams.append(
                {
                    "id": team_id,
                    "abbrev": "".join(w[0] for w in TEAM_NAME_POOL[name_index].split()[:3]).upper(),
                    "name": TEAM_NAME_POOL[name_index],
                    "owners": [person["id"]],
                    "logo": None,
                    "divisionId": 0,
                    "playoffSeed": 0,
                    "rankCalculatedFinal": 0,
                    "record": {"overall": {}},
                    "_person_index": person_index,
                    "_strength": person["skill"] + rng.uniform(-4, 4),
                }
            )

        schedule = self._build_schedule(season, teams, regular_weeks, playoff_rounds, rng)
        self._apply_records(teams, schedule, regular_weeks)
        return {
            "season": season,
            "team_count": team_count,
            "regular_weeks": regular_weeks,
            "teams": teams,
            "schedule": schedule,
            "draft": self._build_draft(season, teams, rng),
        }

    def _build_schedule(
        self,
        season: int,
        teams: Sequence[dict],
        regular_weeks: int,
        playoff_rounds: int,
        rng: random.Random,
    ) -> list[dict]:
        ids = [t["id"] for t in teams]
        strength = {t["id"]: t["_strength"] for t in teams}
        schedule: list[dict] = []
        matchup_id = 1

        def score_for(team_id: int, week: int) -> float:
            base = 118 + strength[team_id]
            noise = rng.gauss(0, 21)
            value = max(48.0, base + noise)
            return round(value, 2)

        max_week = regular_weeks + playoff_rounds
        completed_through = (
            CURRENT_COMPLETED_WEEKS if season == CURRENT_SEASON else max_week
        )

        # Regular season: rotating round robin.
        for week in range(1, regular_weeks + 1):
            pairs = _round_robin_pairs(ids, week)
            for home, away in pairs:
                completed = week <= completed_through
                home_score = score_for(home, week) if completed else 0.0
                away_score = score_for(away, week) if completed else 0.0
                # Seed exactly one tie into league history.
                if season == 2022 and week == 7 and matchup_id % 6 == 1:
                    away_score = home_score
                schedule.append(
                    self._matchup(
                        matchup_id, week, home, away, home_score, away_score, completed, "NONE"
                    )
                )
                matchup_id += 1

        if completed_through < regular_weeks:
            return schedule

        # Playoff seeding from regular-season results.
        standings = self._regular_standings(schedule, ids, regular_weeks)
        playoff_count = 6
        seeds = [row["team_id"] for row in standings[:playoff_count]]
        consolation = [row["team_id"] for row in standings[playoff_count:]]

        for index, team_id in enumerate(seeds, start=1):
            next(t for t in teams if t["id"] == team_id)["playoffSeed"] = index
        for index, team_id in enumerate(consolation, start=playoff_count + 1):
            next(t for t in teams if t["id"] == team_id)["playoffSeed"] = index

        # Round 1: top two seeds get a bye.
        week = regular_weeks + 1
        round_one = [(seeds[2], seeds[5]), (seeds[3], seeds[4])]
        for home, away in round_one:
            completed = week <= completed_through
            schedule.append(
                self._matchup(
                    matchup_id,
                    week,
                    home,
                    away,
                    score_for(home, week) if completed else 0.0,
                    score_for(away, week) if completed else 0.0,
                    completed,
                    "WINNERS_BRACKET",
                )
            )
            matchup_id += 1
        for bye_team in seeds[:2]:
            schedule.append(
                {
                    "id": matchup_id,
                    "matchupPeriodId": week,
                    "playoffTierType": "WINNERS_BRACKET",
                    "winner": "BYE",
                    "home": {"teamId": bye_team, "totalPoints": 0.0},
                }
            )
            matchup_id += 1
        for home, away in [(consolation[0], consolation[-1])]:
            schedule.append(
                self._matchup(
                    matchup_id,
                    week,
                    home,
                    away,
                    score_for(home, week),
                    score_for(away, week),
                    True,
                    "LOSERS_CONSOLATION_LADDER",
                )
            )
            matchup_id += 1

        winners_r1 = [
            self._winner_of(schedule, week, home, away) for home, away in round_one
        ]

        # Semifinals.
        week += 1
        semis = [(seeds[0], winners_r1[1]), (seeds[1], winners_r1[0])]
        for home, away in semis:
            schedule.append(
                self._matchup(
                    matchup_id,
                    week,
                    home,
                    away,
                    score_for(home, week),
                    score_for(away, week),
                    True,
                    "WINNERS_BRACKET",
                )
            )
            matchup_id += 1
        semi_winners = [self._winner_of(schedule, week, h, a) for h, a in semis]
        semi_losers = [
            a if self._winner_of(schedule, week, h, a) == h else h for h, a in semis
        ]

        # Final + third place.
        week += 1
        schedule.append(
            self._matchup(
                matchup_id,
                week,
                semi_winners[0],
                semi_winners[1],
                score_for(semi_winners[0], week),
                score_for(semi_winners[1], week),
                True,
                "WINNERS_BRACKET",
            )
        )
        matchup_id += 1
        schedule.append(
            self._matchup(
                matchup_id,
                week,
                semi_losers[0],
                semi_losers[1],
                score_for(semi_losers[0], week),
                score_for(semi_losers[1], week),
                True,
                "WINNERS_CONSOLATION_LADDER",
            )
        )
        matchup_id += 1

        champion = self._winner_of(schedule, week, semi_winners[0], semi_winners[1])
        runner_up = semi_winners[1] if champion == semi_winners[0] else semi_winners[0]
        third = self._winner_of(schedule, week, semi_losers[0], semi_losers[1])

        final_order = [champion, runner_up, third]
        final_order += [t for t in seeds if t not in final_order]
        final_order += [t for t in consolation if t not in final_order]
        for rank, team_id in enumerate(final_order, start=1):
            next(t for t in teams if t["id"] == team_id)["rankCalculatedFinal"] = rank

        return schedule

    def _matchup(
        self,
        matchup_id: int,
        week: int,
        home: int,
        away: int,
        home_score: float,
        away_score: float,
        completed: bool,
        tier: str,
    ) -> dict:
        if not completed:
            winner = "UNDECIDED"
        elif home_score > away_score:
            winner = "HOME"
        elif away_score > home_score:
            winner = "AWAY"
        else:
            winner = "TIE"
        return {
            "id": matchup_id,
            "matchupPeriodId": week,
            "playoffTierType": tier,
            "winner": winner,
            "home": {
                "teamId": home,
                "totalPoints": home_score if completed else 0.0,
                "pointsByScoringPeriod": {str(week): home_score} if completed else {},
            },
            "away": {
                "teamId": away,
                "totalPoints": away_score if completed else 0.0,
                "pointsByScoringPeriod": {str(week): away_score} if completed else {},
            },
        }

    @staticmethod
    def _winner_of(schedule: Sequence[dict], week: int, home: int, away: int) -> int:
        for game in schedule:
            if game.get("matchupPeriodId") != week:
                continue
            if (game.get("home") or {}).get("teamId") != home:
                continue
            if (game.get("away") or {}).get("teamId") != away:
                continue
            return home if game["winner"] == "HOME" else away
        return home

    @staticmethod
    def _regular_standings(schedule: Sequence[dict], ids: Sequence[int], regular_weeks: int):
        rows = {tid: {"team_id": tid, "wins": 0.0, "points": 0.0} for tid in ids}
        for game in schedule:
            week = game.get("matchupPeriodId")
            if week is None or week > regular_weeks or game["winner"] == "UNDECIDED":
                continue
            home = game.get("home") or {}
            away = game.get("away") or {}
            if "teamId" not in home or "teamId" not in away:
                continue
            h, a = home["teamId"], away["teamId"]
            rows[h]["points"] += home["totalPoints"]
            rows[a]["points"] += away["totalPoints"]
            if game["winner"] == "HOME":
                rows[h]["wins"] += 1
            elif game["winner"] == "AWAY":
                rows[a]["wins"] += 1
            else:
                rows[h]["wins"] += 0.5
                rows[a]["wins"] += 0.5
        return sorted(rows.values(), key=lambda r: (-r["wins"], -r["points"]))

    @staticmethod
    def _apply_records(teams: Sequence[dict], schedule: Sequence[dict], regular_weeks: int) -> None:
        agg = {
            t["id"]: {"wins": 0, "losses": 0, "ties": 0, "pf": 0.0, "pa": 0.0} for t in teams
        }
        for game in schedule:
            if game["winner"] in {"UNDECIDED", "BYE"}:
                continue
            home = game.get("home") or {}
            away = game.get("away") or {}
            if "teamId" not in home or "teamId" not in away:
                continue
            h, a = home["teamId"], away["teamId"]
            agg[h]["pf"] += home["totalPoints"]
            agg[h]["pa"] += away["totalPoints"]
            agg[a]["pf"] += away["totalPoints"]
            agg[a]["pa"] += home["totalPoints"]
            if game["winner"] == "HOME":
                agg[h]["wins"] += 1
                agg[a]["losses"] += 1
            elif game["winner"] == "AWAY":
                agg[a]["wins"] += 1
                agg[h]["losses"] += 1
            else:
                agg[h]["ties"] += 1
                agg[a]["ties"] += 1
        for team in teams:
            row = agg[team["id"]]
            team["record"] = {
                "overall": {
                    "wins": row["wins"],
                    "losses": row["losses"],
                    "ties": row["ties"],
                    "pointsFor": round(row["pf"], 2),
                    "pointsAgainst": round(row["pa"], 2),
                }
            }

    def _build_draft(self, season: int, teams: Sequence[dict], rng: random.Random) -> list[dict]:
        order = [t["id"] for t in teams]
        rng.shuffle(order)
        pool = (
            self._players_for("RB")
            + self._players_for("WR")
            + self._players_for("QB")
            + self._players_for("TE")
            + self._players_for("K")
            + self._players_for("D/ST")
        )
        rng.shuffle(pool)
        picks = []
        overall = 1
        rounds = 16
        for round_id in range(1, rounds + 1):
            sequence = order if round_id % 2 == 1 else list(reversed(order))
            for round_pick, team_id in enumerate(sequence, start=1):
                if not pool:
                    break
                picks.append(
                    {
                        "overallPickNumber": overall,
                        "roundId": round_id,
                        "roundPickNumber": round_pick,
                        "teamId": team_id,
                        "playerId": pool.pop(),
                        "keeper": False,
                        "bidAmount": 0,
                    }
                )
                overall += 1
        return picks

    # -- payload builders -------------------------------------------------

    def members(self) -> list[dict]:
        return [
            {
                "id": person["id"],
                "displayName": person["name"].lower().replace(" ", ""),
                "firstName": person["firstName"],
                "lastName": person["lastName"],
            }
            for person in self.people
        ]

    def core_payload(self, season: int) -> dict:
        if season not in self._seasons:
            raise NotAvailableError(f"sample league has no season {season}")
        data = self._seasons[season]
        teams = [
            {k: v for k, v in team.items() if not k.startswith("_")}
            for team in data["teams"]
        ]
        completed_weeks = sorted(
            {
                g["matchupPeriodId"]
                for g in data["schedule"]
                if g["winner"] not in {"UNDECIDED", "BYE"}
            }
        )
        return {
            "id": self.league_id,
            "seasonId": season,
            "members": self.members(),
            "teams": teams,
            "schedule": data["schedule"],
            "settings": {
                "name": "Sample Fantasy League",
                "size": data["team_count"],
                "scoringSettings": {"scoringType": "H2H_POINTS"},
                "scheduleSettings": {
                    "matchupPeriodCount": data["regular_weeks"],
                    "playoffTeamCount": 6,
                    "playoffMatchupPeriodLength": 1,
                    "matchupPeriods": {
                        str(w): [w] for w in range(1, data["regular_weeks"] + 4)
                    },
                },
                "rosterSettings": {"lineupSlotCounts": LINEUP_SLOT_COUNTS},
            },
            "status": {
                "currentMatchupPeriod": (completed_weeks[-1] + 1) if completed_weeks else 1,
                "latestScoringPeriod": completed_weeks[-1] if completed_weeks else 1,
                "finalScoringPeriod": data["regular_weeks"] + 3,
                "isActive": season == CURRENT_SEASON,
                "previousSeasons": list(range(FIRST_SEASON, season)),
            },
        }

    def boxscore_payload(self, season: int, week: int) -> dict:
        data = self._seasons[season]
        rng = random.Random(f"{season}-{week}-box")
        games = []
        for game in data["schedule"]:
            if game.get("matchupPeriodId") != week:
                continue
            entry = {
                "id": game["id"],
                "matchupPeriodId": week,
                "playoffTierType": game["playoffTierType"],
                "winner": game["winner"],
            }
            for side_key in ("home", "away"):
                side = game.get(side_key)
                if not side or "teamId" not in side:
                    continue
                entry[side_key] = {
                    "teamId": side["teamId"],
                    "totalPoints": side.get("totalPoints", 0.0),
                    "rosterForCurrentScoringPeriod": {
                        "entries": self._roster_entries(
                            side["teamId"], week, side.get("totalPoints") or 0.0, rng
                        )
                    },
                }
            games.append(entry)
        return {"seasonId": season, "schedule": games}

    def _roster_entries(
        self, team_id: int, week: int, team_score: float, rng: random.Random
    ) -> list[dict]:
        """Starters sum exactly to the team score; bench is independent."""
        starter_positions = [
            ("QB", 0),
            ("RB", 2),
            ("RB", 2),
            ("WR", 4),
            ("WR", 4),
            ("TE", 6),
            ("RB", 23),
            ("D/ST", 16),
            ("K", 17),
        ]
        weights = [max(0.3, rng.gauss(1.0, 0.45)) for _ in starter_positions]
        total_weight = sum(weights)
        entries = []
        used: set[int] = set()

        for (position, slot_id), weight in zip(starter_positions, weights):
            pid = self._pick_player(position, used, rng)
            points = round(team_score * weight / total_weight, 2)
            entries.append(self._entry(pid, slot_id, points, week))

        # Reconcile rounding so the starters sum exactly to the team score.
        drift = round(team_score - sum(e["playerPoolEntry"]["appliedStatTotal"] for e in entries), 2)
        if entries and abs(drift) >= 0.01:
            entries[0]["playerPoolEntry"]["appliedStatTotal"] = round(
                entries[0]["playerPoolEntry"]["appliedStatTotal"] + drift, 2
            )

        for _ in range(7):
            position = rng.choice(["RB", "WR", "WR", "QB", "TE"])
            pid = self._pick_player(position, used, rng)
            points = round(max(0.0, rng.gauss(9.5, 7.5)), 2)
            entries.append(self._entry(pid, 20, points, week))
        return entries

    def _pick_player(self, position: str, used: set[int], rng: random.Random) -> int:
        candidates = self._players_for(position)
        for _ in range(40):
            pid = rng.choice(candidates)
            if pid not in used:
                used.add(pid)
                return pid
        return rng.choice(candidates)

    def _entry(self, player_id: int, slot_id: int, points: float, week: int) -> dict:
        player = self.players[player_id]
        return {
            "playerId": player_id,
            "lineupSlotId": slot_id,
            "playerPoolEntry": {
                "id": player_id,
                "appliedStatTotal": points,
                "player": {
                    "id": player_id,
                    "fullName": player["fullName"],
                    "defaultPositionId": player["defaultPositionId"],
                    "proTeamId": player["proTeamId"],
                    "stats": [
                        {
                            "statSourceId": 0,
                            "statSplitTypeId": 1,
                            "scoringPeriodId": week,
                            "appliedTotal": points,
                        },
                        {
                            "statSourceId": 1,
                            "statSplitTypeId": 1,
                            "scoringPeriodId": week,
                            "appliedTotal": round(points * 0.85 + 2.5, 2),
                        },
                    ],
                },
            },
        }

    def draft_payload(self, season: int) -> dict:
        return {"draftDetail": {"drafted": True, "picks": self._seasons[season]["draft"]}}


class SampleClient:
    """Drop-in stand-in for :class:`~pipeline.espn_client.EspnClient`."""

    def __init__(self, league_id: int = 61253603, seed: int = 20261008) -> None:
        self.league = SampleLeague(league_id, seed)
        self.league_id = league_id

    def fetch_league(
        self,
        season: int,
        views: Iterable[str],
        *,
        scoring_period: int | None = None,
        cache_key: str | None = None,
        **_kwargs,
    ) -> FetchResult:
        views = set(views)
        if "mDraftDetail" in views:
            return FetchResult(self.league.draft_payload(season), "sample")
        if "mBoxscore" in views and scoring_period is not None:
            return FetchResult(self.league.boxscore_payload(season, scoring_period), "sample")
        return FetchResult(self.league.core_payload(season), "sample")

    def fetch_transactions(self, season: int) -> dict:
        # Deliberately empty: ESPN frequently returns nothing here for older
        # seasons, and the pipeline must handle that as a documented
        # limitation rather than a crash.
        return {"transactions": []}

    def fetch_player_names(self, season: int, player_ids: Sequence[int]) -> dict[int, dict]:
        return {
            int(pid): self.league.players[int(pid)]
            for pid in player_ids
            if int(pid) in self.league.players
        }


def _round_robin_pairs(ids: Sequence[int], week: int) -> list[tuple[int, int]]:
    """Circle-method round robin; every team plays exactly once per week."""
    teams = list(ids)
    if len(teams) % 2:
        teams.append(None)  # bye placeholder (unused: league sizes are even)
    n = len(teams)
    rotation = (week - 1) % (n - 1)
    fixed = teams[0]
    rotating = teams[1:]
    rotating = rotating[rotation:] + rotating[:rotation]
    order = [fixed] + rotating
    pairs = []
    for i in range(n // 2):
        home, away = order[i], order[n - 1 - i]
        if home is None or away is None:
            continue
        if week % 2 == 0:
            home, away = away, home
        pairs.append((home, away))
    return pairs
