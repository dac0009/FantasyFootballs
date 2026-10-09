"""ESPN enumeration mappings and the vocabulary of our normalized schema.

ESPN's v3 API returns integer ids for positions, NFL teams and lineup slots.
These maps are the only place those magic numbers should appear.
"""

from __future__ import annotations

# -- our own vocabulary ------------------------------------------------------

GAME_REGULAR = "regular"
GAME_PLAYOFF = "playoff"
GAME_CONSOLATION = "consolation"
GAME_POSTSEASON_UNKNOWN = "postseason_other"

ALL_GAME_TYPES = (GAME_REGULAR, GAME_PLAYOFF, GAME_CONSOLATION, GAME_POSTSEASON_UNKNOWN)

RESULT_WIN = "W"
RESULT_LOSS = "L"
RESULT_TIE = "T"

# -- ESPN -> our vocabulary --------------------------------------------------

PLAYOFF_TIER_WINNERS = "WINNERS_BRACKET"
PLAYOFF_TIER_CONSOLATION = {
    "LOSERS_CONSOLATION_LADDER",
    "WINNERS_CONSOLATION_LADDER",
    "LOSERS_BRACKET",
    "CONSOLATION",
}

POSITION_BY_ID = {
    1: "QB",
    2: "RB",
    3: "WR",
    4: "TE",
    5: "K",
    7: "P",
    9: "DT",
    10: "DE",
    11: "LB",
    12: "CB",
    13: "S",
    14: "DB",
    16: "D/ST",
    17: "K",
}

LINEUP_SLOT_BY_ID = {
    0: "QB",
    1: "TQB",
    2: "RB",
    3: "RB/WR",
    4: "WR",
    5: "WR/TE",
    6: "TE",
    7: "OP",
    8: "DT",
    9: "DE",
    10: "LB",
    11: "DL",
    12: "CB",
    13: "S",
    14: "DB",
    15: "DP",
    16: "D/ST",
    17: "K",
    18: "P",
    19: "HC",
    20: "BE",
    21: "IR",
    23: "FLEX",
    24: "EDR",
}

BENCH_SLOT_IDS = {20}
IR_SLOT_IDS = {21}
NON_STARTER_SLOT_IDS = BENCH_SLOT_IDS | IR_SLOT_IDS

#: Which real positions may legally fill a given lineup slot. Used by the
#: optimal-lineup (manager efficiency) solver.
SLOT_ELIGIBILITY = {
    0: {"QB"},
    2: {"RB"},
    3: {"RB", "WR"},
    4: {"WR"},
    5: {"WR", "TE"},
    6: {"TE"},
    7: {"QB", "RB", "WR", "TE"},
    16: {"D/ST"},
    17: {"K"},
    23: {"RB", "WR", "TE"},
}

PRO_TEAM_BY_ID = {
    0: "FA",
    1: "ATL",
    2: "BUF",
    3: "CHI",
    4: "CIN",
    5: "CLE",
    6: "DAL",
    7: "DEN",
    8: "DET",
    9: "GB",
    10: "TEN",
    11: "IND",
    12: "KC",
    13: "LV",
    14: "LAR",
    15: "MIA",
    16: "MIN",
    17: "NE",
    18: "NO",
    19: "NYG",
    20: "NYJ",
    21: "PHI",
    22: "ARI",
    23: "PIT",
    24: "LAC",
    25: "SF",
    26: "SEA",
    27: "TB",
    28: "WSH",
    29: "CAR",
    30: "JAX",
    33: "BAL",
    34: "HOU",
}

#: ESPN statSourceId: 0 = actual, 1 = projection.
STAT_SOURCE_ACTUAL = 0
STAT_SOURCE_PROJECTED = 1
#: statSplitTypeId 1 = single scoring period.
STAT_SPLIT_WEEK = 1

TRANSACTION_LABELS = {
    "WAIVER": "Waiver claim",
    "FREEAGENT": "Free agent add",
    "TRADE_ACCEPT": "Trade",
    "ROSTER": "Roster move",
    "DRAFT": "Draft",
    "TRADE_PROPOSAL": "Trade proposal",
}


def position_name(position_id) -> str:
    try:
        return POSITION_BY_ID.get(int(position_id), "UNK")
    except (TypeError, ValueError):
        return "UNK"


def slot_name(slot_id) -> str:
    try:
        return LINEUP_SLOT_BY_ID.get(int(slot_id), f"SLOT{slot_id}")
    except (TypeError, ValueError):
        return "UNK"


def pro_team(team_id) -> str:
    try:
        return PRO_TEAM_BY_ID.get(int(team_id), "FA")
    except (TypeError, ValueError):
        return "FA"
