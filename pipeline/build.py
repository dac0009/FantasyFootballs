"""Orchestrator: ESPN -> normalized tables -> public datasets in ``data/``.

Writes atomically-ish: everything is computed in memory and validated before
a single file is touched, so a failed run leaves the previously published
dataset intact.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from . import extract, gotw, head_to_head, metrics, playoffs, records, transform
from .config import (
    DATA_DIR,
    PIPELINE_VERSION,
    SCHEMA_VERSION,
    Credentials,
    LeagueConfig,
    load_league_config,
    load_owner_overrides,
    write_json,
)
from .constants import GAME_REGULAR, SLOT_ELIGIBILITY
from .espn_client import EspnApiError, EspnClient, NotAvailableError
from .owners import OwnerRegistry
from .validate import ValidationReport, check_no_regression, validate_owners, validate_season

log = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


def collect(
    league: LeagueConfig,
    credentials: Credentials,
    *,
    seasons: Sequence[int] | None = None,
    use_cache: bool = True,
    with_rosters: bool = True,
    client: EspnClient | None = None,
) -> dict:
    """Fetch and normalize every season. Returns the in-memory dataset."""
    client = client or EspnClient(
        league.league_id, credentials, use_cache=use_cache, write_cache=True
    )
    registry = OwnerRegistry(load_owner_overrides())
    target_seasons = list(seasons or league.seasons())

    season_data: dict[int, dict] = {}
    report = ValidationReport()
    failures: list[str] = []

    for season in target_seasons:
        try:
            season_data[season] = extract.load_season(
                client, season, registry, with_rosters=with_rosters
            )
            log.info(
                "season %s: %s teams, %s matchups (%s completed)",
                season,
                len(season_data[season]["teams"]),
                len(season_data[season]["matchups"]),
                sum(1 for m in season_data[season]["matchups"] if m["completed"]),
            )
        except NotAvailableError as exc:
            # A season ESPN simply does not have is not fatal (a brand new
            # season before the draft, say), but it is recorded.
            log.warning("season %s unavailable: %s", season, exc)
            report.warn(f"season {season} is not available from ESPN ({exc}).")
        except EspnApiError as exc:
            log.error("season %s failed: %s", season, exc)
            failures.append(f"season {season}: {exc}")

    if failures:
        raise PipelineError(
            "ESPN data collection failed for one or more seasons:\n  "
            + "\n  ".join(failures)
        )
    if not season_data:
        raise PipelineError("no seasons could be retrieved from ESPN.")

    owners = registry.to_records()
    report.extend(validate_owners(owners, sorted(season_data)))
    for season in sorted(season_data):
        report.extend(validate_season(season_data[season], league.team_count_hint))

    return {
        "league": league,
        "seasons": season_data,
        "owners": owners,
        "registry": registry,
        "report": report,
        "source": "espn",
    }


def assemble(dataset: dict) -> dict:
    """Compute every derived payload. Pure: no network, no file writes."""
    league: LeagueConfig = dataset["league"]
    season_data: dict[int, dict] = dataset["seasons"]
    owners: list[dict] = dataset["owners"]
    owners_by_id = {o["owner_id"]: o for o in owners}

    all_matchups: list[dict] = []
    all_team_weeks: list[dict] = []
    all_rosters: list[dict] = []
    players: dict[int, dict] = {}
    drafts: dict[int, list[dict]] = {}
    transactions: dict[int, list[dict]] = {}
    limitations: list[str] = []

    for season in sorted(season_data):
        data = season_data[season]
        all_matchups.extend(data["matchups"])
        all_team_weeks.extend(data["team_weeks"])
        all_rosters.extend(data["rosters"])
        players.update(data["players"])
        drafts[season] = data["draft"]
        transactions[season] = data["transactions"]
        limitations.extend(data.get("limitations") or [])

    # -- per season -------------------------------------------------------
    standings_by_season: dict[int, list[dict]] = {}
    for season in sorted(season_data):
        standings_by_season[season] = transform.build_standings(
            season,
            all_team_weeks,
            season_data[season]["teams"],
            season_data[season]["finish"],
        )

    finishes = {s: season_data[s]["finish"] for s in season_data}
    careers = transform.build_careers(
        all_team_weeks, owners, standings_by_season, finishes
    )
    careers_by_id = {c["owner_id"]: c for c in careers}

    h2h = head_to_head.build_head_to_head(all_team_weeks, owners_by_id)

    record_book = records.build_record_book(
        all_team_weeks, all_matchups, careers, all_rosters, players, owners_by_id
    )

    # -- manager efficiency (roster data permitting) ----------------------
    efficiency: dict[str, dict] = {}
    if all_rosters:
        latest = max(season_data)
        slot_counts = {
            int(slot): count
            for slot, count in (
                season_data[latest]["meta"].get("lineup_slot_counts") or {}
            ).items()
            if int(slot) not in {20, 21}
        }
        if slot_counts:
            efficiency = metrics.manager_efficiency(
                all_rosters, players, slot_counts, SLOT_ELIGIBILITY
            )
        else:
            limitations.append(
                "Manager efficiency unavailable: ESPN did not expose lineup "
                "slot counts for this league."
            )
    else:
        limitations.append(
            "Manager efficiency, bench regret and player records are "
            "unavailable because ESPN returned no lineup-level data."
        )

    # -- current season / this week --------------------------------------
    current_season = max(season_data)
    current_payload, game_of_week = build_current(
        current_season,
        season_data,
        standings_by_season,
        all_matchups,
        all_team_weeks,
        h2h,
        owners_by_id,
    )

    season_payloads = {
        season: transform.build_season_payload(
            season,
            season_data[season],
            standings_by_season[season],
            all_team_weeks,
            owners_by_id,
        )
        for season in sorted(season_data)
    }

    owner_payloads = {}
    for career in careers:
        owner_id = career["owner_id"]
        highlights = head_to_head.h2h_highlights(h2h, owner_id)
        owner_payloads[owner_id] = {
            **career,
            "head_to_head": highlights,
            "efficiency": efficiency.get(owner_id),
            "weekly_history": [
                {
                    "season": r["season"],
                    "week": r["week"],
                    "team_name": r["team_name"],
                    "score": r["score"],
                    "opponent_owner_id": r["opponent_owner_id"],
                    "opponent_team_name": r["opponent_team_name"],
                    "opponent_score": r["opponent_score"],
                    "result": r["result"],
                    "game_type": r["game_type"],
                    "matchup_id": r["matchup_id"],
                }
                for r in all_team_weeks
                if r["owner_id"] == owner_id
            ],
        }

    counts = {
        "seasons": len(season_data),
        "owners": len(owners),
        "matchups": len(all_matchups),
        "completed_matchups": sum(1 for m in all_matchups if m["completed"]),
        "team_weeks": len(all_team_weeks),
        "roster_rows": len(all_rosters),
        "players": len(players),
        "draft_picks": sum(len(v) for v in drafts.values()),
        "transactions": sum(len(v) for v in transactions.values()),
        "head_to_head_pairs": len(h2h),
    }

    return {
        "league": league,
        "counts": counts,
        "owners": owners,
        "owners_by_id": owners_by_id,
        "careers": careers,
        "careers_by_id": careers_by_id,
        "owner_payloads": owner_payloads,
        "standings_by_season": standings_by_season,
        "season_payloads": season_payloads,
        "season_data": season_data,
        "matchups": all_matchups,
        "team_weeks": all_team_weeks,
        "rosters": all_rosters,
        "players": players,
        "drafts": drafts,
        "transactions": transactions,
        "records": record_book,
        "head_to_head": h2h,
        "efficiency": efficiency,
        "current": current_payload,
        "game_of_week": game_of_week,
        "current_season": current_season,
        "limitations": sorted(set(limitations)),
        "report": dataset.get("report") or ValidationReport(),
        "source": dataset.get("source", "espn"),
    }


def build_current(
    season: int,
    season_data: dict[int, dict],
    standings_by_season: dict[int, list[dict]],
    all_matchups: Sequence[dict],
    all_team_weeks: Sequence[dict],
    h2h: dict,
    owners_by_id: dict[str, dict],
) -> tuple[dict, dict | None]:
    meta = season_data[season]["meta"]
    standings = standings_by_season[season]
    season_matchups = [m for m in all_matchups if m["season"] == season]
    completed_weeks = sorted({m["week"] for m in season_matchups if m["completed"]})
    latest_week = completed_weeks[-1] if completed_weeks else None

    week_payload = (
        transform.build_week_payload(season, latest_week, all_matchups, all_team_weeks)
        if latest_week
        else None
    )
    upcoming_week = gotw.next_unplayed_week(season_matchups, season)
    upcoming = [
        m for m in season_matchups if upcoming_week and m["week"] == upcoming_week
    ]

    ap = metrics.all_play(all_team_weeks, season=season, game_types=(GAME_REGULAR,))
    game_of_week = gotw.select_game_of_the_week(
        season_matchups,
        all_team_weeks,
        standings,
        ap["totals"],
        h2h,
        season,
        playoff_team_count=meta.get("playoff_team_count"),
        regular_season_weeks=meta.get("regular_season_weeks"),
    )

    picture = playoffs.build_playoff_picture(
        season,
        standings,
        season_matchups,
        all_team_weeks,
        playoff_teams=meta.get("playoff_team_count"),
        regular_season_weeks=meta.get("regular_season_weeks"),
    )
    previews_by_id = {p["matchup_id"]: p for p in (picture or {}).get("previews", [])}
    if game_of_week:
        for candidate in [game_of_week["pick"], *game_of_week["ranked"]]:
            candidate["preview"] = previews_by_id.get(candidate["matchup_id"])

    milestones = (
        transform.detect_milestones(
            season, latest_week, all_team_weeks, all_matchups, owners_by_id
        )
        if latest_week
        else []
    )

    movement = _standings_movement(season, latest_week, all_team_weeks, standings)

    return (
        {
            "season": season,
            "latest_completed_week": latest_week,
            "upcoming_week": upcoming_week,
            "regular_season_weeks": meta.get("regular_season_weeks"),
            "playoff_team_count": meta.get("playoff_team_count"),
            "is_active": meta.get("is_active"),
            "week": week_payload,
            "upcoming_matchups": [
                {**m, "preview": previews_by_id.get(m["matchup_id"])} for m in upcoming
            ],
            "playoff_picture": picture,
            "standings": standings,
            "milestones": milestones,
            "movement": movement,
            "scoring_leaders": [
                {
                    "owner_id": s["owner_id"],
                    "team_name": s["team_name"],
                    "avg_score": s["avg_score"],
                    "points_for": s["points_for"],
                    "all_play_win_pct": s["all_play_win_pct"],
                    "dominance": s.get("dominance"),
                }
                for s in sorted(standings, key=lambda s: -(s["avg_score"] or 0))[:5]
            ],
        },
        game_of_week,
    )


def _standings_movement(
    season: int,
    week: int | None,
    team_weeks: Sequence[dict],
    standings: Sequence[dict],
) -> list[dict]:
    """Rank change caused by the most recent completed week."""
    if not week or week < 2:
        return []
    prior = [r for r in team_weeks if r["season"] == season and r["week"] < week]
    if not prior:
        return []
    prior_summary = metrics.summarize(prior, game_types=(GAME_REGULAR,))
    prior_rank = {
        row["id"]: index
        for index, row in enumerate(
            sorted(
                prior_summary.values(),
                key=lambda r: (-(r["wins"] + 0.5 * r["ties"]), -(r["points_for"] or 0)),
            ),
            start=1,
        )
    }
    out = []
    for row in standings:
        before = prior_rank.get(row["owner_id"])
        if before is None:
            continue
        out.append(
            {
                "owner_id": row["owner_id"],
                "team_name": row["team_name"],
                "rank": row["rank"],
                "previous_rank": before,
                "change": before - row["rank"],
            }
        )
    out.sort(key=lambda r: -abs(r["change"]))
    return out


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------


def publish(assembled: dict, data_dir: Path | None = None, *, allow_shrink: bool = False) -> dict:
    data_dir = data_dir or DATA_DIR
    report: ValidationReport = assembled["report"]
    report.extend(
        check_no_regression(data_dir, assembled["counts"], allow_shrink=allow_shrink)
    )

    if not report.ok:
        raise PipelineError(
            "validation failed; nothing was published.\n" + report.render()
        )

    league: LeagueConfig = assembled["league"]
    generated_at = datetime.now(UTC).isoformat(timespec="seconds")
    written: dict[str, int] = {}

    def emit(relative: str, payload, pretty: bool = False):
        written[relative] = write_json(data_dir / relative, payload, pretty=pretty)

    season_index = []
    for season, payload in assembled["season_payloads"].items():
        meta = payload["meta"]
        season_index.append(
            {
                "season": season,
                "team_count": meta.get("team_count"),
                "regular_season_weeks": meta.get("regular_season_weeks"),
                "completed_weeks": payload["completed_weeks"],
                "champion": payload.get("champion"),
                "runner_up": payload.get("runner_up"),
                "league_name": meta.get("league_name"),
                "is_current": season == assembled["current_season"],
            }
        )

    emit(
        "meta.json",
        {
            "schema_version": SCHEMA_VERSION,
            "pipeline_version": PIPELINE_VERSION,
            "generated_at": generated_at,
            "source": assembled["source"],
            "league": {
                "league_id": league.league_id,
                "name": league.name,
                "short_name": league.short_name,
                "site_title": league.site_title,
                "timezone": league.timezone,
            },
            "seasons": sorted(assembled["season_payloads"]),
            "current_season": assembled["current_season"],
            "current_week": assembled["current"]["latest_completed_week"],
            "upcoming_week": assembled["current"]["upcoming_week"],
            "counts": assembled["counts"],
            "limitations": assembled["limitations"],
            "warnings": report.warnings,
        },
        pretty=True,
    )

    emit("seasons.json", season_index, pretty=True)
    emit(
        "owners.json",
        [
            {
                key: career.get(key)
                for key in (
                    "owner_id",
                    "name",
                    "member_hash",
                    "current_team_name",
                    "seasons",
                    "seasons_played",
                    "first_season",
                    "last_season",
                    "games",
                    "wins",
                    "losses",
                    "ties",
                    "record",
                    "win_pct",
                    "points_for",
                    "points_against",
                    "point_diff",
                    "avg_score",
                    "high_score",
                    "low_score",
                    "score_stdev",
                    "all_play_win_pct",
                    "championships",
                    "runner_ups",
                    "playoff_appearances",
                    "avg_finish",
                    "best_finish",
                    "longest_win_streak",
                    "longest_loss_streak",
                    "unlinked",
                    "team_name_timeline",
                )
            }
            for career in assembled["careers"]
        ],
    )

    for owner_id, payload in assembled["owner_payloads"].items():
        emit(f"owners/{owner_id}.json", payload)

    for season, payload in assembled["season_payloads"].items():
        emit(f"seasons/{season}.json", payload)

    emit("matchups.json", assembled["matchups"])
    emit("team_weeks.json", assembled["team_weeks"])
    emit("records.json", assembled["records"])
    emit("head_to_head.json", assembled["head_to_head"])
    emit("current.json", assembled["current"])
    emit("playoffs.json", assembled["current"].get("playoff_picture"))
    emit("game_of_week.json", assembled["game_of_week"])
    emit("players.json", list(assembled["players"].values()))

    for season, picks in assembled["drafts"].items():
        if picks:
            emit(f"drafts/{season}.json", picks)
    for season, rows in _rosters_by_season(assembled["rosters"]).items():
        emit(f"rosters/{season}.json", rows)
    for season, rows in assembled["transactions"].items():
        if rows:
            emit(f"transactions/{season}.json", rows)

    emit(
        "manifest.json",
        {
            "generated_at": generated_at,
            "files": dict(sorted(written.items())),
            "total_bytes": sum(written.values()),
        },
        pretty=True,
    )

    log.info(
        "published %s files, %.1f KB total",
        len(written),
        sum(written.values()) / 1024,
    )
    return {"files": written, "report": report}


def _rosters_by_season(rosters: Sequence[dict]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {}
    for row in rosters:
        out.setdefault(row["season"], []).append(row)
    return out


def run(
    *,
    seasons: Sequence[int] | None = None,
    use_cache: bool = True,
    with_rosters: bool = True,
    allow_shrink: bool = False,
    data_dir: Path | None = None,
) -> dict:
    league = load_league_config()
    credentials = Credentials.from_env()
    if not credentials.present:
        raise PipelineError(
            "ESPN credentials are missing. Set SWID and ESPN_S2 in the "
            "environment (locally: a .env file; in CI: repository secrets). "
            "See docs/SECURITY.md."
        )
    dataset = collect(
        league,
        credentials,
        seasons=seasons,
        use_cache=use_cache,
        with_rosters=with_rosters,
    )
    assembled = assemble(dataset)
    return publish(assembled, data_dir, allow_shrink=allow_shrink)
