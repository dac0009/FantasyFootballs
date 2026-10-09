"""Owner-vs-owner head-to-head aggregation.

Pairs are keyed by the two owner ids sorted alphabetically and joined with
``__``, so ``a__b`` and ``b__a`` are the same record and the frontend can look
up a rivalry without knowing which way round the user picked.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Sequence

from .constants import GAME_CONSOLATION, GAME_PLAYOFF, GAME_REGULAR, RESULT_TIE, RESULT_WIN
from .metrics import format_record, r2, r3, win_pct


def pair_key(owner_a: str, owner_b: str) -> str:
    return "__".join(sorted([owner_a, owner_b]))


def build_head_to_head(
    team_weeks: Sequence[dict],
    owners_by_id: dict[str, dict],
) -> dict:
    """Return ``{pair_key: rivalry record}`` covering all completed games."""
    pairs: dict[str, list[dict]] = defaultdict(list)
    for row in team_weeks:
        owner = row.get("owner_id")
        opponent = row.get("opponent_owner_id")
        if not owner or not opponent or owner == opponent:
            continue
        pairs[pair_key(owner, opponent)].append(row)

    out: dict[str, dict] = {}
    for key, rows in pairs.items():
        left, right = key.split("__")
        # Each meeting appears twice (once per team); keep the left-owner view.
        meetings = sorted(
            [r for r in rows if r["owner_id"] == left],
            key=lambda r: (r["season"], r["week"]),
        )
        if not meetings:
            continue
        out[key] = _summarize_pair(left, right, meetings, owners_by_id)
    return out


def _summarize_pair(
    left: str,
    right: str,
    meetings: Sequence[dict],
    owners_by_id: dict[str, dict],
) -> dict:
    def scope(rows, game_types=None):
        rows = [r for r in rows if game_types is None or r["game_type"] in game_types]
        wins = sum(1 for r in rows if r["result"] == RESULT_WIN)
        ties = sum(1 for r in rows if r["result"] == RESULT_TIE)
        losses = len(rows) - wins - ties
        return {
            "games": len(rows),
            "left_wins": wins,
            "right_wins": losses,
            "ties": ties,
            "record": format_record(wins, losses, ties),
            "left_win_pct": r3(win_pct(wins, losses, ties)),
        }

    overall = scope(meetings)
    regular = scope(meetings, (GAME_REGULAR,))
    playoff = scope(meetings, (GAME_PLAYOFF,))
    consolation = scope(meetings, (GAME_CONSOLATION,))

    left_scores = [m["score"] for m in meetings]
    right_scores = [m["opponent_score"] for m in meetings]
    margins = [m["differential"] for m in meetings]

    biggest_left = max(meetings, key=lambda m: m["differential"])
    biggest_right = min(meetings, key=lambda m: m["differential"])
    closest = min(meetings, key=lambda m: abs(m["differential"]))
    highest_combined = max(meetings, key=lambda m: m["score"] + m["opponent_score"])
    latest = meetings[-1]

    # Current streak, from the left owner's perspective.
    streak_type = latest["result"]
    streak_len = 0
    for meeting in reversed(meetings):
        if meeting["result"] != streak_type:
            break
        streak_len += 1

    return {
        "pair_key": pair_key(left, right),
        "left_owner_id": left,
        "right_owner_id": right,
        "left_owner_name": (owners_by_id.get(left) or {}).get("name", left),
        "right_owner_name": (owners_by_id.get(right) or {}).get("name", right),
        "overall": overall,
        "regular": regular,
        "playoff": playoff,
        "consolation": consolation,
        "left_points": r2(sum(left_scores)),
        "right_points": r2(sum(right_scores)),
        "left_avg": r2(statistics.fmean(left_scores)),
        "right_avg": r2(statistics.fmean(right_scores)),
        "avg_margin": r2(statistics.fmean(margins)),
        "avg_abs_margin": r2(statistics.fmean([abs(m) for m in margins])),
        "first_meeting": {"season": meetings[0]["season"], "week": meetings[0]["week"]},
        "last_meeting": _meeting_ref(latest),
        "biggest_left_win": _meeting_ref(biggest_left),
        "biggest_right_win": _meeting_ref(biggest_right),
        "closest_meeting": _meeting_ref(closest),
        "highest_scoring_meeting": _meeting_ref(highest_combined),
        "current_streak": {
            "owner_id": left if streak_type == RESULT_WIN else right,
            "type": streak_type,
            "length": streak_len,
        },
        "rivalry_index": rivalry_index(meetings, overall, playoff),
        "meetings": [_meeting_ref(m) for m in meetings],
    }


def _meeting_ref(row: dict) -> dict:
    return {
        "season": row["season"],
        "week": row["week"],
        "matchup_id": row.get("matchup_id"),
        "game_type": row["game_type"],
        "left_team_name": row.get("team_name"),
        "right_team_name": row.get("opponent_team_name"),
        "left_score": row["score"],
        "right_score": row["opponent_score"],
        "margin": r2(abs(row["differential"])),
        "combined": r2(row["score"] + row["opponent_score"]),
        "result": row["result"],
    }


def rivalry_index(meetings: Sequence[dict], overall: dict, playoff: dict) -> dict:
    """A 0-100 score for "how much of a rivalry is this?".

    Four equally-weighted components, each clamped to 0-1:

    ``volume``     meetings / 20, i.e. 20+ meetings maxes it out.
    ``parity``     1 - 2 * |win_pct - 0.5|, peaking at a dead-even series.
    ``closeness``  1 - (mean absolute margin / 40), so a series averaging
                   0-point margins scores 1 and 40+ points scores 0.
    ``stakes``     playoff meetings / 3, capped.

    This is a *descriptive* convenience for sorting rivalry pages, not a
    statistical claim. The weights and the 20/40/3 scale constants were chosen
    to spread a typical 8-year league across the range; they are arbitrary and
    documented here so nobody mistakes the number for a measurement.
    """
    games = overall["games"]
    if not games:
        return {"score": 0.0, "components": {}}
    pct = overall["left_win_pct"] or 0.5
    mean_margin = statistics.fmean([abs(m["differential"]) for m in meetings])

    volume = min(games / 20.0, 1.0)
    parity = max(0.0, 1.0 - 2.0 * abs(pct - 0.5))
    closeness = max(0.0, 1.0 - (mean_margin / 40.0))
    stakes = min(playoff["games"] / 3.0, 1.0)
    score = 100 * (0.25 * volume + 0.25 * parity + 0.25 * closeness + 0.25 * stakes)
    return {
        "score": r2(score),
        "components": {
            "volume": r3(volume),
            "parity": r3(parity),
            "closeness": r3(closeness),
            "stakes": r3(stakes),
        },
    }


def h2h_highlights(pairs: dict[str, dict], owner_id: str) -> dict:
    """Favourite victim and nemesis for one owner, with a minimum sample."""
    MIN_MEETINGS = 3
    best = worst = None
    rows = []
    for record in pairs.values():
        if owner_id not in (record["left_owner_id"], record["right_owner_id"]):
            continue
        is_left = record["left_owner_id"] == owner_id
        other = record["right_owner_id"] if is_left else record["left_owner_id"]
        overall = record["overall"]
        wins = overall["left_wins"] if is_left else overall["right_wins"]
        losses = overall["right_wins"] if is_left else overall["left_wins"]
        pct = win_pct(wins, losses, overall["ties"])
        row = {
            "opponent_owner_id": other,
            "opponent_name": record["right_owner_name"] if is_left else record["left_owner_name"],
            "games": overall["games"],
            "wins": wins,
            "losses": losses,
            "ties": overall["ties"],
            "record": format_record(wins, losses, overall["ties"]),
            "win_pct": r3(pct),
            "pair_key": record["pair_key"],
            "rivalry_index": record["rivalry_index"]["score"],
        }
        rows.append(row)
        if overall["games"] >= MIN_MEETINGS and pct is not None:
            if best is None or pct > best["win_pct"] or (
                pct == best["win_pct"] and overall["games"] > best["games"]
            ):
                best = row
            if worst is None or pct < worst["win_pct"] or (
                pct == worst["win_pct"] and overall["games"] > worst["games"]
            ):
                worst = row
    rows.sort(key=lambda r: (-r["games"], r["opponent_name"]))
    return {
        "favorite_victim": best,
        "nemesis": worst,
        "min_meetings": MIN_MEETINGS,
        "opponents": rows,
    }
