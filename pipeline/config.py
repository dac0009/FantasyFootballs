"""Configuration for the FFBFFL data pipeline.

Everything that is *not* a secret lives in ``config/league.yml`` and
``config/owners.yml``. Secrets (``SWID``, ``ESPN_S2``) are read from the
process environment only -- never from a tracked file.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "config"
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = REPO_ROOT / ".cache" / "raw"

PIPELINE_VERSION = "1.0.0"
SCHEMA_VERSION = 1


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    return loaded or {}


@dataclass
class Credentials:
    """ESPN session cookies. Never logged, never serialised."""

    swid: str | None = None
    espn_s2: str | None = None

    @property
    def present(self) -> bool:
        return bool(self.swid and self.espn_s2)

    def as_cookies(self) -> dict[str, str]:
        if not self.present:
            return {}
        return {"SWID": self.swid or "", "espn_s2": self.espn_s2 or ""}

    @classmethod
    def from_env(cls) -> Credentials:
        swid = os.environ.get("SWID") or os.environ.get("ESPN_SWID")
        s2 = os.environ.get("ESPN_S2")
        if swid:
            swid = swid.strip()
            if not swid.startswith("{"):  # accept with or without braces
                swid = "{" + swid.strip("{}") + "}"
        return cls(swid=swid, espn_s2=s2.strip() if s2 else None)

    def __repr__(self) -> str:  # defensive: keep secrets out of tracebacks
        return f"Credentials(present={self.present})"


@dataclass
class LeagueConfig:
    league_id: int
    first_season: int
    timezone: str = "America/New_York"
    name: str = "Fantasy League"
    short_name: str = "League"
    site_title: str = "League Archive"
    team_count_hint: int = 12
    last_season: int | None = None
    seasons_override: list[int] = field(default_factory=list)

    def seasons(self, now: datetime | None = None) -> list[int]:
        """Seasons the pipeline should attempt, inferred from the clock.

        A fantasy season labelled ``Y`` runs Sep ``Y`` through Jan ``Y+1``, so
        before August we are still looking at last season as the newest one.
        New seasons are therefore picked up automatically with no code change.
        """
        if self.seasons_override:
            return sorted({int(s) for s in self.seasons_override})
        now = now or datetime.now(ZoneInfo(self.timezone))
        inferred_last = now.year if now.month >= 8 else now.year - 1
        last = int(self.last_season) if self.last_season else inferred_last
        last = max(last, self.first_season)
        return list(range(self.first_season, last + 1))


def load_league_config(path: Path | None = None) -> LeagueConfig:
    path = path or CONFIG_DIR / "league.yml"
    raw = load_yaml(path)
    league = raw.get("league", raw)
    return LeagueConfig(
        league_id=int(os.environ.get("LEAGUE_ID") or league["league_id"]),
        first_season=int(league["first_season"]),
        last_season=league.get("last_season"),
        timezone=league.get("timezone", "America/New_York"),
        name=league.get("name", "Fantasy League"),
        short_name=league.get("short_name", "League"),
        site_title=league.get("site_title", league.get("name", "League Archive")),
        team_count_hint=int(league.get("team_count_hint", 12)),
        seasons_override=league.get("seasons") or [],
    )


def load_owner_overrides(path: Path | None = None) -> dict:
    path = path or CONFIG_DIR / "owners.yml"
    if not path.exists():
        return {}
    raw = load_yaml(path)
    return raw if isinstance(raw, dict) else {}


def write_json(path: Path, payload, *, pretty: bool = False) -> int:
    """Write JSON deterministically; returns bytes written.

    ``allow_nan=False`` is deliberate: NaN is not valid JSON and would break
    the frontend silently. A NaN reaching this function is a pipeline bug and
    should raise.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        text = json.dumps(payload, indent=2, allow_nan=False, ensure_ascii=False)
    else:
        text = json.dumps(payload, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
    text += "\n"
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))
