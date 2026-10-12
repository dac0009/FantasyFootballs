"""Trade Analyzer: a composite, signed trade-value score for a proposed trade.

A manager comparing a trade usually has one question underneath all the
others: "who actually wins this?" Raw season points-per-game answers a
different question (who is better, in general), so this module builds a
**player value** that is adjusted for the team on the other end of a specific
deal, and the frontend (``web/src/lib/tradeAnalyzer.ts``) combines those
player values live for whatever trade is currently proposed — the same split
used for the playoff explorer: this module precomputes everything that is
reusable across any trade, the browser only does the trade-specific sum.

The composite
--------------
For a player P evaluated **for a specific team T**::

    value(P, T) = value_base(P)
                  * reliability_factor(P)
                  * recent_form_factor(P)
                  * need_fit_factor(P.position, T)
                  * leverage_factor(T)

``value_base`` and ``reliability_factor`` are properties of the player alone.
``need_fit_factor`` and ``leverage_factor`` depend on the team receiving (or
losing) him. A trade where team A sends players ``a`` to team B and receives
players ``b`` back scores as::

    team_A_trade_value = sum(value(p, A) for p in b) - sum(value(p, A) for p in a)
    team_B_trade_value = sum(value(p, B) for p in a) - sum(value(p, B) for p in b)

Positive means that team's roster is worth more after the trade than before,
by this metric; negative means less. The two numbers are not required to be
opposites of each other — need_fit and leverage are team-specific, so the
same players can reasonably be worth more to one side than the other. That is
the point of the tool, not a bug in it.

The four components
--------------------
**value_base** — the player's standing per-game value. ESPN does not expose a
projection for a future, unplayed week outside of a live scoring period (the
same limitation already documented for Game of the Week in
``docs/METRICS.md``), so this is not a forecast for next week specifically.
It is the player's average *projected* points per game this season — ESPN's
own standing estimate of his role and expected usage — shrunk toward his own
career average when the season sample is thin. A player with no roster-row
history at all has no value_base; the frontend falls back to the player's
position-wide rate (published separately, see ``position_value_rate``) for
that explicitly-labeled edge case. See ``player_value_base``.

**reliability_factor** — the unique, unborrowed signal this league's eight
seasons of `projected` vs `points` make possible. A player who has reliably
out-scored his own projection is worth more than his raw number; a chronic
underperformer is worth less. Computed as a career-long
``sum(points) / sum(projected)`` ratio (not an average of weekly ratios,
which a single tiny-projection week could distort wildly), normalized against
the player's position so a 1.08 means "8% more reliable than a typical player
at his position," not "...than the league." Small samples are shrunk toward
the neutral 1.0 and the result is clamped so one hot or cold handful of games
cannot swing a trade valuation as hard as a true, sustained difference would.
See ``player_reliability``.

**need_fit_factor** — a team-specific nudge: a player is worth more to a team
that is scoring below the league average at his position, less to a team
already strong there. Computed from this season's *started* lineup rows,
credited to the real position of whoever filled the slot (a WR started at
FLEX still counts as a WR), shrunk toward neutral for a team with few
started-weeks on record, and clamped to a modest range. See
``team_need_fit``.

**leverage_factor** — production is worth more to a team whose playoff fate
is still undecided than to one that is clinched or already eliminated. Pulled
from this season's precomputed playoff odds
(``pipeline.playoffs.build_playoff_picture``) as a frozen snapshot: the Trade
Analyzer does not re-run the playoff simulation for a hypothetical trade, it
only asks how much is riding on this team's remaining production right now.
See ``team_leverage``.

**recent_form_factor** — labeled, deliberately approximate. The one input
the brief asked for that this league's data cannot support cleanly is
schedule strength (an upcoming opponent's defense against the position) —
there is no NFL schedule or defensive-ranking data anywhere in this pipeline,
and fetching one is a bigger lift than this module should casually take on.
Rather than fabricate that signal, this uses the player's own most recent
weeks this season as a rough stand-in for "is he trending hot or cold right
now," which folds in matchup difficulty along with everything else (role
change, injury recovery, a new quarterback) indistinguishably. It is a small,
bounded nudge, not a forecast, and the UI must label it as an approximation.
See ``player_recent_form``.

What this does not do
----------------------
* It does not know about bye weeks, injuries, or suspensions at the moment a
  trade is proposed — it is exactly as current as the last published roster
  snapshot.
* ``need_fit_factor`` measures what a team *has* scored at a position, not
  what is realistically available to acquire; a team with only bench-quality
  options at a thin position will look needier than the trade market can
  actually fix.
* ``leverage_factor`` is a snapshot of the current playoff race, not
  recomputed for the hypothetical world where the trade already happened.
* All of the shrinkage constants and clamp ranges below are free parameters,
  chosen so that a thin sample pulls hard toward "we don't know yet" rather
  than toward a loud, confident number. They are not fit to any data; they
  are documented so the choice is visible, not hidden in a black box.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Mapping, Sequence

from .metrics import r2, r3

#: Real player positions this module scores. Anything else is skipped.
POSITIONS = ("QB", "RB", "WR", "TE", "K", "D/ST")

#: value_base: games of "trust the career/position rate" prior evidence.
VALUE_BASE_SHRINKAGE_GAMES = 4.0
#: reliability: games of "assume average" prior evidence before trusting the
#: player's own record. Larger than the value_base constant because
#: reliability is a claim about a persistent personal trait, not a rate.
RELIABILITY_SHRINKAGE_GAMES = 8.0
RELIABILITY_CLAMP = (0.75, 1.25)
#: need_fit: games (started weeks) of prior evidence before trusting a team's
#: in-season positional average, deliberately small since it must react
#: within a single partially-played season.
NEED_FIT_SHRINKAGE_GAMES = 3.0
NEED_FIT_CLAMP = (0.85, 1.15)
#: leverage: how far the factor can swing from neutral in either direction.
LEVERAGE_SPAN = 0.10
#: recent form: how many of the player's most recent season games to use,
#: and the minimum before it is anything but neutral.
RECENT_FORM_WINDOW = 3
RECENT_FORM_MIN_GAMES = 2
RECENT_FORM_CLAMP = (0.90, 1.10)


def _position_of(player_id: int, players: Mapping[int, dict]) -> str | None:
    return (players.get(player_id) or {}).get("position")


def position_reliability_baseline(
    roster_rows: Sequence[dict], players: Mapping[int, dict]
) -> dict[str, float]:
    """League-wide ``sum(points)/sum(projected)`` per position, all seasons.

    Positions are not equally predictable — this league's own D/ST
    projections run about 10% hot, kicker and QB projections are nearly
    exact, RBs and WRs run a little cold — so a player's reliability factor
    (see ``player_reliability``) is judged against players at his own
    position, not against one global number that would otherwise just flag
    entire positions as over- or under-performing.
    """
    totals: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in roster_rows:
        proj, pts = row.get("projected"), row.get("points")
        if proj is None or pts is None or proj <= 0:
            continue
        pos = _position_of(row["player_id"], players)
        if pos not in POSITIONS:
            continue
        bucket = totals[pos]
        bucket[0] += pts
        bucket[1] += proj
    return {pos: (pts / proj) for pos, (pts, proj) in totals.items() if proj}


def position_value_rate(
    roster_rows: Sequence[dict], players: Mapping[int, dict]
) -> dict[str, float]:
    """Average weekly ESPN projection per position, all seasons.

    The fallback anchor for ``player_value_base`` when a player has no
    projection history of his own at all (e.g. a true rookie's first
    roster-row).
    """
    totals: dict[str, list[float]] = defaultdict(lambda: [0.0, 0])
    for row in roster_rows:
        proj = row.get("projected")
        if proj is None or proj <= 0:
            continue
        pos = _position_of(row["player_id"], players)
        if pos not in POSITIONS:
            continue
        bucket = totals[pos]
        bucket[0] += proj
        bucket[1] += 1
    return {pos: (total / n) for pos, (total, n) in totals.items() if n}


def player_reliability(
    roster_rows: Sequence[dict],
    players: Mapping[int, dict],
    baselines: Mapping[str, float],
) -> dict[int, dict]:
    """Career-long projection-beat rate per player.

    See the module docstring's "reliability_factor" section for the formula
    and reasoning. Players with no roster-row carrying a nonzero projection
    (never actually rostered for a scored week) have no entry; callers treat
    a missing player as neutral (``reliability_factor`` of 1.0).
    """
    totals: dict[int, list] = defaultdict(lambda: [0.0, 0.0, 0])
    for row in roster_rows:
        proj, pts = row.get("projected"), row.get("points")
        if proj is None or pts is None or proj <= 0:
            continue
        bucket = totals[row["player_id"]]
        bucket[0] += pts
        bucket[1] += proj
        bucket[2] += 1

    out: dict[int, dict] = {}
    for player_id, (pts, proj, n) in totals.items():
        baseline = baselines.get(_position_of(player_id, players), 1.0) or 1.0
        raw_ratio = pts / proj if proj else 1.0
        normalized = raw_ratio / baseline
        shrunk = (n * normalized + RELIABILITY_SHRINKAGE_GAMES * 1.0) / (
            n + RELIABILITY_SHRINKAGE_GAMES
        )
        clamped = max(RELIABILITY_CLAMP[0], min(RELIABILITY_CLAMP[1], shrunk))
        out[player_id] = {
            "games": n,
            "raw_ratio": r3(raw_ratio),
            "position_baseline": r3(baseline),
            "reliability_factor": r3(clamped),
        }
    return out


def player_value_base(
    roster_rows: Sequence[dict],
    season: int,
) -> dict[int, dict]:
    """Each player's standing per-game value: a shrunk average weekly projection.

    See the module docstring's "value_base" section. ``career`` here means
    every season on record for this player, including the current one — a
    current-season row always contributes to both totals, so a player can
    only appear here with ``career_games >= season_games >= 1``; there is no
    player with season data but zero career data to fall back from. A player
    with genuinely no roster-row history at all (never rostered for a scored
    week — e.g. a brand-new waiver add with no games yet) has no entry here;
    ``build_trade_values`` publishes league-wide position rates separately so
    the frontend has an explicit, labeled fallback for that case.
    """
    season_totals: dict[int, list] = defaultdict(lambda: [0.0, 0])
    career_totals: dict[int, list] = defaultdict(lambda: [0.0, 0])
    for row in roster_rows:
        proj = row.get("projected")
        if proj is None or proj <= 0:
            continue
        pid = row["player_id"]
        career_totals[pid][0] += proj
        career_totals[pid][1] += 1
        if row["season"] == season:
            season_totals[pid][0] += proj
            season_totals[pid][1] += 1

    out: dict[int, dict] = {}
    for pid, (c_total, c_n) in career_totals.items():
        career_rate = c_total / c_n
        s_total, s_n = season_totals.get(pid, (0.0, 0))
        season_rate = (s_total / s_n) if s_n else career_rate
        shrunk = (s_n * season_rate + VALUE_BASE_SHRINKAGE_GAMES * career_rate) / (
            s_n + VALUE_BASE_SHRINKAGE_GAMES
        )
        out[pid] = {
            "season_games": s_n,
            "season_rate": r2(season_rate) if s_n else None,
            "career_rate": r2(career_rate),
            "value_base": r2(shrunk),
        }
    return out


def player_recent_form(
    roster_rows: Sequence[dict],
    players: Mapping[int, dict],
    season: int,
    baselines: Mapping[str, float],
) -> dict[int, dict]:
    """A short-term, explicitly-approximate trend factor.

    See the module docstring's "recent_form_factor" section: this is a
    labeled stand-in for schedule strength, which this pipeline has no clean
    data source for, not a schedule-aware projection.
    """
    by_player: dict[int, list[tuple[int, float, float]]] = defaultdict(list)
    for row in roster_rows:
        if row["season"] != season:
            continue
        proj, pts = row.get("projected"), row.get("points")
        if proj is None or pts is None or proj <= 0:
            continue
        by_player[row["player_id"]].append((row["week"], pts, proj))

    out: dict[int, dict] = {}
    for pid, rows in by_player.items():
        rows.sort(key=lambda r: r[0])
        recent = rows[-RECENT_FORM_WINDOW:]
        if len(recent) < RECENT_FORM_MIN_GAMES:
            out[pid] = {"games": len(recent), "recent_form_factor": 1.0}
            continue
        baseline = baselines.get(_position_of(pid, players), 1.0) or 1.0
        pts_sum = sum(p for _, p, _ in recent)
        proj_sum = sum(p for _, _, p in recent)
        ratio = (pts_sum / proj_sum if proj_sum else 1.0) / baseline
        clamped = max(RECENT_FORM_CLAMP[0], min(RECENT_FORM_CLAMP[1], ratio))
        out[pid] = {"games": len(recent), "recent_form_factor": r3(clamped)}
    return out


def team_need_fit(
    roster_rows: Sequence[dict], players: Mapping[int, dict], season: int
) -> dict[str, dict[str, dict]]:
    """How much each team's current lineup needs each position.

    See the module docstring's "need_fit_factor" section. Credits every
    *started* row to the real position of the player who filled the slot, so
    a WR started at FLEX still counts as a WR start — a team's "RB scoring"
    reflects everyone who has actually started at running back for them, not
    only the two labeled RB slots.
    """
    team_pos: dict[tuple[str, str], list[float]] = defaultdict(list)
    league_pos: dict[str, list[float]] = defaultdict(list)
    for row in roster_rows:
        if row["season"] != season or not row.get("started"):
            continue
        pts, owner = row.get("points"), row.get("owner_id")
        if pts is None or not owner:
            continue
        pos = _position_of(row["player_id"], players)
        if pos not in POSITIONS:
            continue
        team_pos[(owner, pos)].append(pts)
        league_pos[pos].append(pts)

    league_avg = {pos: statistics.fmean(vals) for pos, vals in league_pos.items() if vals}

    out: dict[str, dict[str, dict]] = defaultdict(dict)
    for (owner, pos), vals in team_pos.items():
        league = league_avg.get(pos)
        if not league:
            continue
        team_avg = statistics.fmean(vals)
        n = len(vals)
        raw = (league / team_avg) if team_avg > 0 else 1.0
        shrunk = (n * raw + NEED_FIT_SHRINKAGE_GAMES * 1.0) / (n + NEED_FIT_SHRINKAGE_GAMES)
        clamped = max(NEED_FIT_CLAMP[0], min(NEED_FIT_CLAMP[1], shrunk))
        out[owner][pos] = {
            "team_avg": r2(team_avg),
            "league_avg": r2(league),
            "started_weeks": n,
            "need_fit_factor": r3(clamped),
        }
    return dict(out)


def team_leverage(playoff_teams: Sequence[dict] | None) -> dict[str, dict]:
    """Stakes multiplier from this season's precomputed playoff odds.

    See the module docstring's "leverage_factor" section. ``stakes`` peaks at
    the 50% bubble and is zero for a team mathematically in or out; the
    factor is a modest linear map of that onto ``[1 - LEVERAGE_SPAN, 1 +
    LEVERAGE_SPAN]``. A team missing from ``playoff_teams`` (no playoff
    format configured, or the odds model has no data for it) has no entry;
    callers treat that as neutral.
    """
    out: dict[str, dict] = {}
    for team in playoff_teams or []:
        p = team.get("playoff_pct")
        owner = team.get("owner_id")
        if p is None or not owner:
            continue
        stakes = 4.0 * p * (1.0 - p)
        factor = (1.0 - LEVERAGE_SPAN) + 2.0 * LEVERAGE_SPAN * stakes
        out[owner] = {
            "playoff_pct": r3(p),
            "stakes": r3(stakes),
            "leverage_factor": r3(factor),
        }
    return out


def build_trade_values(
    season: int,
    roster_rows: Sequence[dict],
    players: Mapping[int, dict],
    playoff_teams: Sequence[dict] | None,
) -> dict | None:
    """Assemble the full, precomputed Trade Analyzer payload.

    Everything here is reusable across every possible trade: a player's
    ``value_base``/``reliability_factor``/``recent_form_factor`` never change
    based on who else is in the proposal, and a team's ``need_fit`` /
    ``leverage_factor`` are properties of its current roster and playoff
    position, not of any specific trade. ``web/src/lib/tradeAnalyzer.ts``
    combines these for one specific proposal, live in the browser — the same
    split as the playoff scenario explorer.

    Returns ``None`` when there is no roster data to build from (e.g. a
    pipeline run with ``--skip-rosters``), so the caller can omit the file
    and record the limitation, the same way manager efficiency does.
    """
    if not roster_rows:
        return None

    rel_baselines = position_reliability_baseline(roster_rows, players)
    value_rates = position_value_rate(roster_rows, players)

    reliability = player_reliability(roster_rows, players, rel_baselines)
    value_base = player_value_base(roster_rows, season)
    recent_form = player_recent_form(roster_rows, players, season, rel_baselines)
    need_fit = team_need_fit(roster_rows, players, season)
    leverage = team_leverage(playoff_teams)

    out_players: dict[str, dict] = {}
    for pid in set(value_base) | set(reliability):
        meta = players.get(pid) or {}
        if meta.get("position") not in POSITIONS:
            continue
        vb = value_base.get(pid, {})
        rel = reliability.get(pid) or {"games": 0, "reliability_factor": 1.0}
        rf = recent_form.get(pid) or {"games": 0, "recent_form_factor": 1.0}
        out_players[str(pid)] = {
            "player_id": pid,
            "name": meta.get("name"),
            "position": meta.get("position"),
            "nfl_team": meta.get("nfl_team"),
            "value_base": vb.get("value_base"),
            "season_games": vb.get("season_games", 0),
            "career_rate": vb.get("career_rate"),
            "reliability_factor": rel.get("reliability_factor", 1.0),
            "reliability_games": rel.get("games", 0),
            "recent_form_factor": rf.get("recent_form_factor", 1.0),
            "recent_form_games": rf.get("games", 0),
        }

    out_teams: dict[str, dict] = {}
    for owner in set(need_fit) | set(leverage):
        lev = leverage.get(owner) or {}
        out_teams[owner] = {
            "owner_id": owner,
            "need_fit": need_fit.get(owner, {}),
            "leverage_factor": lev.get("leverage_factor", 1.0),
            "playoff_pct": lev.get("playoff_pct"),
        }

    return {
        "season": season,
        "players": out_players,
        "teams": out_teams,
        "positions": {
            pos: {
                "reliability_baseline": r3(rel_baselines.get(pos, 1.0)),
                "value_rate": r2(value_rates.get(pos, 0.0)),
            }
            for pos in POSITIONS
        },
        "model": {
            "value_base_shrinkage_games": VALUE_BASE_SHRINKAGE_GAMES,
            "reliability_shrinkage_games": RELIABILITY_SHRINKAGE_GAMES,
            "reliability_clamp": list(RELIABILITY_CLAMP),
            "need_fit_shrinkage_games": NEED_FIT_SHRINKAGE_GAMES,
            "need_fit_clamp": list(NEED_FIT_CLAMP),
            "leverage_span": LEVERAGE_SPAN,
            "recent_form_window": RECENT_FORM_WINDOW,
            "recent_form_clamp": list(RECENT_FORM_CLAMP),
            "notes": (
                "value_base is each player's shrunk average weekly ESPN "
                "projection, not an actual-points average and not a forecast "
                "for a specific upcoming week. reliability_factor and "
                "recent_form_factor scale it up or down based on how this "
                "player has historically performed against his own "
                "projection; need_fit_factor and leverage_factor depend on "
                "the team being evaluated, not the player alone. Full "
                "formula and limitations: docs/METRICS.md."
            ),
        },
    }
