"""Command line interface.

    python -m pipeline refresh            # pull from ESPN and publish data/
    python -m pipeline refresh --no-cache # ignore the local raw cache
    python -m pipeline sample             # publish data/ from the sample league
    python -m pipeline probe              # report what ESPN exposes per season
    python -m pipeline inspect            # summarise the published data/
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from . import build
from .config import DATA_DIR, Credentials, load_league_config, load_owner_overrides
from .espn_client import EspnApiError, EspnClient
from .sample import SampleClient

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"

PROBE_VIEWS = [
    ("mTeam", "teams, owners, records"),
    ("mMatchupScore", "weekly scores and winners"),
    ("mSettings", "league settings, schedule length, playoff format"),
    ("mStatus", "current week, previous seasons"),
    ("mRoster", "current rosters"),
    ("mBoxscore", "per-week lineups and player scores"),
    ("mDraftDetail", "draft picks"),
    ("mTransactions2", "adds, drops, waivers, trades"),
    ("mStandings", "standings detail"),
]


def _load_dotenv(path: Path = Path(".env")) -> None:
    """Minimal .env support so local runs do not need shell exports."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def cmd_refresh(args: argparse.Namespace) -> int:
    try:
        result = build.run(
            seasons=args.season,
            use_cache=not args.no_cache,
            with_rosters=not args.skip_rosters,
            allow_shrink=args.allow_shrink,
            data_dir=Path(args.data_dir) if args.data_dir else None,
        )
    except build.PipelineError as exc:
        print(f"\nPIPELINE FAILED\n{exc}", file=sys.stderr)
        return 1
    except EspnApiError as exc:
        print(f"\nESPN ERROR\n{exc}", file=sys.stderr)
        return 2

    report = result["report"]
    print(report.render())
    print(f"\nWrote {len(result['files'])} files to data/")
    return 0


def cmd_sample(args: argparse.Namespace) -> int:
    league = load_league_config()
    client = SampleClient(league.league_id, seed=args.seed)
    dataset = build.collect(
        league,
        Credentials(swid="{sample}", espn_s2="sample"),
        seasons=args.season or list(range(2019, 2027)),
        use_cache=False,
        client=client,
    )
    dataset["source"] = "sample"
    assembled = build.assemble(dataset)
    assembled["source"] = "sample"
    try:
        result = build.publish(
            assembled,
            Path(args.data_dir) if args.data_dir else None,
            allow_shrink=True,
        )
    except build.PipelineError as exc:
        print(f"\nPIPELINE FAILED\n{exc}", file=sys.stderr)
        return 1
    print(result["report"].render())
    counts = assembled["counts"]
    print(
        f"\nSample league published: {counts['seasons']} seasons, "
        f"{counts['owners']} owners, {counts['completed_matchups']} completed "
        f"matchups, {counts['roster_rows']} roster rows."
    )
    print(f"Wrote {len(result['files'])} files to data/")
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    """Report, per season and view, what ESPN actually returns."""
    league = load_league_config()
    credentials = Credentials.from_env()
    if not credentials.present:
        print(
            "SWID and ESPN_S2 are required for probing. See docs/SECURITY.md.",
            file=sys.stderr,
        )
        return 1
    client = EspnClient(league.league_id, credentials, use_cache=not args.no_cache)
    seasons = args.season or league.seasons()
    rows = []
    for season in seasons:
        for view, description in PROBE_VIEWS:
            try:
                if view == "mTransactions2":
                    payload = client.fetch_transactions(season)
                    endpoint = "seasons"
                elif view == "mBoxscore":
                    result = client.fetch_league(
                        season,
                        ["mMatchupScore", "mBoxscore"],
                        scoring_period=1,
                        cache_key=f"{season}/probe_boxscore",
                    )
                    payload, endpoint = result.payload, result.endpoint
                else:
                    result = client.fetch_league(
                        season, [view], cache_key=f"{season}/probe_{view}"
                    )
                    payload, endpoint = result.payload, result.endpoint
                summary = _summarize_payload(view, payload)
                status = "ok" if summary["present"] else "empty"
            except EspnApiError as exc:
                summary = {"present": False, "detail": str(exc)[:120]}
                status = "error"
                endpoint = "-"
            rows.append(
                {
                    "season": season,
                    "view": view,
                    "status": status,
                    "endpoint": endpoint,
                    "detail": summary.get("detail"),
                    "description": description,
                }
            )
            print(
                f"{season}  {view:<16} {status:<6} {endpoint:<14} {summary.get('detail') or ''}"
            )
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"\nWrote probe report to {args.out}")
    return 0


def _summarize_payload(view: str, payload: dict) -> dict:
    checks = {
        "mTeam": ("teams", lambda p: len(p.get("teams") or [])),
        "mMatchupScore": ("schedule", lambda p: len(p.get("schedule") or [])),
        "mSettings": ("settings", lambda p: len(p.get("settings") or {})),
        "mStatus": ("status", lambda p: len(p.get("status") or {})),
        "mRoster": (
            "rostered players",
            lambda p: sum(
                len((t.get("roster") or {}).get("entries") or [])
                for t in (p.get("teams") or [])
            ),
        ),
        "mBoxscore": (
            "lineup entries",
            lambda p: sum(
                len(

                        ((g.get(side) or {}).get("rosterForCurrentScoringPeriod") or {}).get(
                            "entries"
                        )
                        or []

                )
                for g in (p.get("schedule") or [])
                for side in ("home", "away")
            ),
        ),
        "mDraftDetail": (
            "draft picks",
            lambda p: len((p.get("draftDetail") or {}).get("picks") or []),
        ),
        "mTransactions2": ("transactions", lambda p: len(p.get("transactions") or [])),
        "mStandings": ("teams", lambda p: len(p.get("teams") or [])),
    }
    label, counter = checks.get(view, ("keys", lambda p: len(p)))
    try:
        count = counter(payload)
    except Exception:  # noqa: BLE001 - probe must never crash
        count = 0
    return {"present": count > 0, "detail": f"{count} {label}"}


def cmd_inspect(args: argparse.Namespace) -> int:
    data_dir = Path(args.data_dir) if args.data_dir else DATA_DIR
    meta_path = data_dir / "meta.json"
    if not meta_path.exists():
        print(f"no data found at {data_dir}", file=sys.stderr)
        return 1
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    print(f"source:        {meta.get('source')}")
    print(f"generated at:  {meta.get('generated_at')}")
    print(f"seasons:       {meta.get('seasons')}")
    print(f"current:       {meta.get('current_season')} week {meta.get('current_week')}")
    for key, value in (meta.get("counts") or {}).items():
        print(f"  {key:<22} {value}")
    if meta.get("limitations"):
        print("\nDocumented limitations:")
        for item in meta["limitations"]:
            print(f"  - {item}")
    if meta.get("warnings"):
        print("\nValidation warnings:")
        for item in meta["warnings"]:
            print(f"  - {item}")
    return 0


def cmd_owners(args: argparse.Namespace) -> int:
    """Print the owner identity map; useful when filling in config/owners.yml."""
    overrides = load_owner_overrides()
    print("Configured owner overrides:")
    for spec in overrides.get("owners") or []:
        print(f"  {spec.get('owner_id')}: {spec.get('name')}")
    if not overrides.get("owners"):
        print("  (none - identities come straight from ESPN member accounts)")
    data_dir = Path(args.data_dir) if args.data_dir else DATA_DIR
    owners_path = data_dir / "owners.json"
    if owners_path.exists():
        owners = json.loads(owners_path.read_text(encoding="utf-8"))
        print(f"\nResolved owners in published data ({len(owners)}):")
        for owner in owners:
            names = " -> ".join(
                f"{row['season']}:{row['team_name']}"
                for row in owner.get("team_name_timeline") or []
            )
            flag = " [UNLINKED]" if owner.get("unlinked") else ""
            print(f"  {owner['owner_id']:<24}{flag} {owner['name']}")
            print(f"      {names}")
    return 0


def main(argv: list[str] | None = None) -> int:
    _load_dotenv()
    parser = argparse.ArgumentParser(prog="pipeline", description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p):
        p.add_argument("--season", type=int, action="append", help="limit to season(s)")
        p.add_argument("--data-dir", help="output directory (default: data/)")

    refresh = sub.add_parser("refresh", help="pull from ESPN and publish data/")
    add_common(refresh)
    refresh.add_argument("--no-cache", action="store_true", help="ignore the raw cache")
    refresh.add_argument("--skip-rosters", action="store_true", help="skip per-week boxscores")
    refresh.add_argument(
        "--allow-shrink",
        action="store_true",
        help="permit publishing a smaller dataset than the previous run",
    )
    refresh.set_defaults(func=cmd_refresh)

    sample = sub.add_parser("sample", help="publish data/ from the synthetic league")
    add_common(sample)
    sample.add_argument("--seed", type=int, default=20261008)
    sample.set_defaults(func=cmd_sample)

    probe = sub.add_parser("probe", help="report what ESPN exposes per season/view")
    add_common(probe)
    probe.add_argument("--no-cache", action="store_true")
    probe.add_argument("--out", help="write the probe report as JSON")
    probe.set_defaults(func=cmd_probe)

    inspect = sub.add_parser("inspect", help="summarise the published data/")
    add_common(inspect)
    inspect.set_defaults(func=cmd_inspect)

    owners = sub.add_parser("owners", help="print the owner identity map")
    add_common(owners)
    owners.set_defaults(func=cmd_owners)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, format=LOG_FORMAT
    )
    return args.func(args)
