"""Validation. The gate between "we fetched something" and "we publish it".

Two severities:

``error``
    Publishing would put wrong or incomplete data on a public site. The
    pipeline exits non-zero and the workflow does not deploy.

``warning``
    Worth knowing, logged in the run summary and surfaced in
    ``data/meta.json`` so the site can show a data-quality note, but not a
    reason to block.

The most important check is :func:`check_no_regression`. A pull that succeeds
at the HTTP level but returns a hollow league (expired cookies sometimes
return 200 with an empty body shape) must never overwrite a good dataset.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from .constants import ALL_GAME_TYPES

MAX_WEEK = 25
MIN_TEAMS = 4
#: Cross-check tolerance against ESPN's own pointsFor totals, in points.
PF_TOLERANCE = 1.0
#: Allow a tiny decrease in completed games (a corrected/voided matchup).
REGRESSION_TOLERANCE = 0


@dataclass
class ValidationReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    @property
    def ok(self) -> bool:
        return not self.errors

    def extend(self, other: ValidationReport) -> None:
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        self.stats.update(other.stats)

    def render(self) -> str:
        lines = []
        if self.errors:
            lines.append(f"{len(self.errors)} ERROR(S):")
            lines.extend(f"  [error] {m}" for m in self.errors)
        if self.warnings:
            lines.append(f"{len(self.warnings)} warning(s):")
            lines.extend(f"  [warn]  {m}" for m in self.warnings)
        if not lines:
            lines.append("All validation checks passed.")
        return "\n".join(lines)


def validate_season(season_data: dict, expected_team_count: int | None = None) -> ValidationReport:
    report = ValidationReport()
    season = season_data["meta"]["season"]
    teams = season_data["teams"]
    matchups = season_data["matchups"]
    team_weeks = season_data["team_weeks"]
    tag = f"season {season}"

    # -- teams ------------------------------------------------------------
    if len(teams) < MIN_TEAMS:
        report.error(f"{tag}: only {len(teams)} teams found (minimum {MIN_TEAMS}).")
    if expected_team_count and len(teams) != expected_team_count:
        report.warn(
            f"{tag}: {len(teams)} teams, expected {expected_team_count}. "
            "League size has changed over time, so this may be correct."
        )
    missing_owner = [t["team_id"] for t in teams if not t.get("owner_id")]
    if missing_owner:
        report.error(f"{tag}: teams without a resolved owner: {missing_owner}")

    duplicate_team_ids = [tid for tid, n in Counter(t["team_id"] for t in teams).items() if n > 1]
    if duplicate_team_ids:
        report.error(f"{tag}: duplicate team ids {duplicate_team_ids}")

    # -- matchups ---------------------------------------------------------
    if not matchups:
        report.error(f"{tag}: ESPN returned no schedule at all.")
        return report

    bad_weeks = sorted({m["week"] for m in matchups if not (1 <= m["week"] <= MAX_WEEK)})
    if bad_weeks:
        report.error(f"{tag}: implausible week numbers {bad_weeks}")

    bad_types = sorted({m["game_type"] for m in matchups if m["game_type"] not in ALL_GAME_TYPES})
    if bad_types:
        report.error(f"{tag}: unknown game_type values {bad_types}")

    unknown_postseason = [m for m in matchups if m["game_type"] == "postseason_other"]
    if unknown_postseason:
        report.warn(
            f"{tag}: {len(unknown_postseason)} postseason game(s) could not be "
            "classified as playoff or consolation; ESPN did not supply a "
            "playoffTierType and seeds were unavailable."
        )

    completed = [m for m in matchups if m["completed"] and not m["is_bye"]]
    for matchup in completed:
        if matchup["home_score"] is None or matchup["away_score"] is None:
            report.error(f"{tag}: completed matchup {matchup['matchup_id']} has a null score.")
        if matchup["winner"] == "UNDECIDED":
            report.error(f"{tag}: matchup {matchup['matchup_id']} is completed but UNDECIDED.")
        if matchup["home_team_id"] == matchup["away_team_id"]:
            report.error(f"{tag}: matchup {matchup['matchup_id']} has a team playing itself.")

    # A completed matchup must yield exactly two team-week rows.
    expected_rows = 2 * len(completed)
    if len(team_weeks) != expected_rows:
        report.error(
            f"{tag}: {len(team_weeks)} team-week rows for {len(completed)} "
            f"completed matchups (expected {expected_rows})."
        )

    # Duplicate detection: a team must appear at most once per matchup period.
    seen = Counter((r["week"], r["team_id"]) for r in team_weeks)
    dupes = [key for key, count in seen.items() if count > 1]
    if dupes:
        report.warn(
            f"{tag}: {len(dupes)} team(s) appear more than once in the same "
            f"matchup period: {dupes[:5]}. This is legitimate when a playoff "
            "round spans two scoring periods."
        )

    # -- record consistency ----------------------------------------------
    for row in team_weeks:
        if row["score"] is None or row["opponent_score"] is None:
            report.error(f"{tag}: null score in team-week {row['team_id']} wk{row['week']}.")
        if row["result"] not in {"W", "L", "T"}:
            report.error(f"{tag}: bad result '{row['result']}' for team {row['team_id']}.")

    _cross_check_points(report, tag, teams, team_weeks)

    report.stats[f"season_{season}"] = {
        "teams": len(teams),
        "matchups": len(matchups),
        "completed_matchups": len(completed),
        "team_weeks": len(team_weeks),
        "rosters": len(season_data.get("rosters") or []),
        "draft_picks": len(season_data.get("draft") or []),
        "transactions": len(season_data.get("transactions") or []),
        "weeks_completed": sorted({m["week"] for m in completed}),
    }
    return report


def _cross_check_points(
    report: ValidationReport,
    tag: str,
    teams: Sequence[dict],
    team_weeks: Sequence[dict],
) -> None:
    """Our summed points vs ESPN's own record totals.

    ESPN's ``record.overall.pointsFor`` includes every game it counts toward
    the standings, which for most leagues is the regular season plus playoff
    games the team played. We therefore compare against all games and allow a
    small tolerance; a large mismatch means we are dropping or double-counting
    games.
    """
    totals: dict[int, float] = defaultdict(float)
    for row in team_weeks:
        totals[row["team_id"]] += row["score"]

    for team in teams:
        espn_pf = team.get("espn_points_for")
        if not espn_pf:
            continue
        ours = round(totals.get(team["team_id"], 0.0), 2)
        if ours == 0:
            continue
        # ESPN's total can legitimately exceed ours (it may include games we
        # classify as consolation). Only flag when *we* have more points than
        # ESPN, which would indicate double counting.
        if ours - espn_pf > PF_TOLERANCE:
            report.warn(
                f"{tag}: team {team['team_id']} ({team['team_name']}) sums to "
                f"{ours} points but ESPN reports {espn_pf}. Check for "
                "duplicated matchups."
            )


def validate_owners(owners: Sequence[dict], seasons: Sequence[int]) -> ValidationReport:
    report = ValidationReport()
    if not owners:
        report.error("no owners resolved at all.")
        return report

    unlinked = [o["owner_id"] for o in owners if o.get("unlinked")]
    if unlinked:
        report.warn(
            f"{len(unlinked)} team(s) could not be linked to an ESPN member "
            f"account and are shown as placeholder owners: {unlinked[:6]}. Add "
            "them to config/owners.yml to merge their history."
        )

    duplicate_ids = [oid for oid, n in Counter(o["owner_id"] for o in owners).items() if n > 1]
    if duplicate_ids:
        report.error(f"duplicate owner_id values: {duplicate_ids}")

    # Suspicious: two owners sharing an identical display name usually means a
    # GUID change that should be merged in config/owners.yml.
    name_counts = Counter(o["name"] for o in owners if not o.get("unlinked"))
    shared = [name for name, n in name_counts.items() if n > 1]
    if shared:
        report.warn(
            f"owners sharing a display name: {shared}. If these are the same "
            "person, merge their espn_member_ids in config/owners.yml."
        )

    covered = {s for o in owners for s in (o.get("seasons") or [])}
    missing = sorted(set(seasons) - covered)
    if missing:
        report.error(f"no owners registered for season(s) {missing}")

    report.stats["owners"] = {
        "count": len(owners),
        "unlinked": len(unlinked),
    }
    return report


def check_no_regression(
    data_dir: Path,
    new_stats: dict,
    *,
    allow_shrink: bool = False,
) -> ValidationReport:
    """Compare against the previously published dataset.

    Blocks a publish that would reduce the number of completed games, which is
    the signature of a partially-failed pull.
    """
    report = ValidationReport()
    previous_path = data_dir / "meta.json"
    if not previous_path.exists():
        report.warn("no previously published data found; skipping regression check.")
        return report

    try:
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.warn(f"could not read previous meta.json ({exc}); skipping regression check.")
        return report

    old_counts = (previous.get("counts") or {})
    new_counts = new_stats
    for field_name in ("completed_matchups", "team_weeks", "owners", "seasons"):
        old = old_counts.get(field_name)
        new = new_counts.get(field_name)
        if old is None or new is None:
            continue
        if new < old - REGRESSION_TOLERANCE:
            message = (
                f"published dataset would shrink: {field_name} goes from "
                f"{old} to {new}. This usually means the ESPN pull partly "
                "failed. Refusing to publish."
            )
            if allow_shrink:
                report.warn(message + " (overridden by --allow-shrink)")
            else:
                report.error(message)
    return report
