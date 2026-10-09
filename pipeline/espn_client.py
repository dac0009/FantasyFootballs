"""Thin, defensive client for the ESPN Fantasy Football v3 API.

Design notes
------------
* Two endpoint shapes exist. ``/seasons/{year}/segments/0/leagues/{id}`` works
  for any season the authenticated user can see (verified 2019-2026 for this
  league). ``/leagueHistory/{id}?seasonId={year}`` is the documented route for
  completed seasons and returns a *list* rather than an object. We try the
  former and fall back to the latter, normalising the shape either way.
* Every raw response is optionally written to ``.cache/raw/`` so that the
  transform/metrics layers can be developed, tested and re-run without
  touching ESPN. ``.cache/`` is gitignored.
* Cookies are never logged. ``AuthError`` is raised distinctly from
  ``EspnApiError`` so the workflow can tell "your cookies expired" apart from
  "ESPN is having a bad day".
"""

from __future__ import annotations

import json
import logging
import random
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from .config import RAW_DIR, Credentials

log = logging.getLogger(__name__)

BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
USER_AGENT = (
    "FFBFFL-Archive/1.0 (+https://github.com/dac0009/FantasyFootballs) "
    "python-requests"
)

RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 5


class EspnApiError(RuntimeError):
    """ESPN returned something we cannot use."""


class AuthError(EspnApiError):
    """ESPN rejected our credentials (401/403). Cookies likely expired."""


class NotAvailableError(EspnApiError):
    """ESPN has no data for this season/view (404). Not necessarily fatal."""


@dataclass
class FetchResult:
    payload: dict[str, Any]
    endpoint: str
    from_cache: bool = False


class EspnClient:
    def __init__(
        self,
        league_id: int,
        credentials: Credentials | None = None,
        *,
        cache_dir: Path | None = None,
        use_cache: bool = True,
        write_cache: bool = True,
        session: requests.Session | None = None,
        timeout: float = 30.0,
        min_interval: float = 0.4,
    ) -> None:
        self.league_id = int(league_id)
        self.credentials = credentials or Credentials()
        self.cache_dir = cache_dir or RAW_DIR
        self.use_cache = use_cache
        self.write_cache = write_cache
        self.timeout = timeout
        self.min_interval = min_interval
        self._last_call = 0.0
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
        if self.credentials.present:
            self.session.cookies.update(self.credentials.as_cookies())

    # -- internals ---------------------------------------------------------

    def _throttle(self) -> None:
        delta = time.monotonic() - self._last_call
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last_call = time.monotonic()

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def _read_cache(self, key: str) -> dict | None:
        if not self.use_cache:
            return None
        path = self._cache_path(key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            log.warning("ignoring unreadable cache entry %s", path.name)
            return None

    def _write_cache(self, key: str, payload: dict) -> None:
        if not self.write_cache:
            return
        path = self._cache_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def _request(
        self,
        url: str,
        params: Sequence[tuple[str, Any]],
        headers: dict[str, str] | None = None,
    ) -> Any:
        last_error: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._throttle()
            try:
                response = self.session.get(
                    url, params=list(params), headers=headers, timeout=self.timeout
                )
            except requests.RequestException as exc:  # network-level
                last_error = exc
                sleep_for = min(2**attempt, 20) + random.random()
                log.warning("network error (attempt %s/%s): %s", attempt, MAX_ATTEMPTS, exc)
                time.sleep(sleep_for)
                continue

            if response.status_code in (401, 403):
                raise AuthError(
                    "ESPN rejected the request with HTTP "
                    f"{response.status_code}. The SWID / ESPN_S2 cookies are "
                    "missing, expired or belong to an account without access "
                    "to this league. See docs/SECURITY.md for how to refresh "
                    "them."
                )
            if response.status_code == 404:
                raise NotAvailableError(f"HTTP 404 for {response.url.split('?')[0]}")
            if response.status_code in RETRY_STATUS:
                last_error = EspnApiError(f"HTTP {response.status_code}")
                sleep_for = min(2**attempt, 20) + random.random()
                log.warning(
                    "ESPN HTTP %s (attempt %s/%s), retrying in %.1fs",
                    response.status_code,
                    attempt,
                    MAX_ATTEMPTS,
                    sleep_for,
                )
                time.sleep(sleep_for)
                continue
            if not response.ok:
                raise EspnApiError(f"HTTP {response.status_code} from ESPN")

            try:
                return response.json()
            except json.JSONDecodeError as exc:
                raise EspnApiError(
                    "ESPN returned a non-JSON body. This usually means an "
                    "HTML login/interstitial page, i.e. an auth problem."
                ) from exc

        raise EspnApiError(f"giving up after {MAX_ATTEMPTS} attempts: {last_error}")

    @staticmethod
    def _normalise(payload: Any) -> dict[str, Any]:
        """leagueHistory returns ``[{...}]``; the seasons route returns ``{...}``."""
        if isinstance(payload, list):
            if not payload:
                raise EspnApiError("ESPN returned an empty list")
            payload = payload[0]
        if not isinstance(payload, dict):
            raise EspnApiError(f"unexpected ESPN payload type: {type(payload).__name__}")
        return payload

    # -- public API --------------------------------------------------------

    def fetch_league(
        self,
        season: int,
        views: Iterable[str],
        *,
        scoring_period: int | None = None,
        cache_key: str | None = None,
        extra_params: Sequence[tuple[str, Any]] = (),
        filter_header: dict | None = None,
        allow_history: bool = True,
    ) -> FetchResult:
        views = list(views)
        key = cache_key or self._default_cache_key(season, views, scoring_period)
        cached = self._read_cache(key)
        if cached is not None:
            return FetchResult(payload=cached, endpoint="cache", from_cache=True)

        params: list[tuple[str, Any]] = [("view", v) for v in views]
        if scoring_period is not None:
            params.append(("scoringPeriodId", scoring_period))
        params.extend(extra_params)
        headers = {}
        if filter_header:
            headers["x-fantasy-filter"] = json.dumps(filter_header)

        season_url = f"{BASE}/seasons/{season}/segments/0/leagues/{self.league_id}"
        history_url = f"{BASE}/leagueHistory/{self.league_id}"

        try:
            payload = self._normalise(self._request(season_url, params, headers or None))
            endpoint = "seasons"
        except NotAvailableError:
            if not allow_history:
                raise
            log.info("season endpoint 404 for %s; trying leagueHistory", season)
            payload = self._normalise(
                self._request(history_url, [("seasonId", season), *params], headers or None)
            )
            endpoint = "leagueHistory"

        self._write_cache(key, payload)
        return FetchResult(payload=payload, endpoint=endpoint)

    @staticmethod
    def _default_cache_key(season: int, views: list[str], scoring_period: int | None) -> str:
        view_part = "+".join(sorted(views)) or "none"
        sp = f"_sp{scoring_period}" if scoring_period is not None else ""
        return f"{season}/{view_part}{sp}"

    def fetch_status(self, season: int) -> dict:
        return self.fetch_league(season, ["mStatus", "mSettings"]).payload

    def available_seasons(self, probe_season: int) -> list[int]:
        """Ask ESPN which seasons it associates with this league id."""
        payload = self.fetch_status(probe_season)
        status = payload.get("status") or {}
        previous = [int(y) for y in (status.get("previousSeasons") or [])]
        current = payload.get("seasonId")
        if current:
            previous.append(int(current))
        return sorted(set(previous))

    def fetch_transactions(self, season: int) -> dict:
        """Transactions need an x-fantasy-filter; availability varies by season."""
        return self.fetch_league(
            season,
            ["mTransactions2"],
            cache_key=f"{season}/transactions",
            filter_header={
                "transactions": {
                    "filterType": {"value": ["WAIVER", "TRADE_ACCEPT", "FREEAGENT", "ROSTER"]}
                }
            },
        ).payload

    def fetch_player_names(self, season: int, player_ids: Sequence[int]) -> dict[int, dict]:
        """Resolve player ids that never appeared on a roster (e.g. drafted then dropped)."""
        ids = [int(p) for p in player_ids if p]
        if not ids:
            return {}
        out: dict[int, dict] = {}
        chunk = 250
        for start in range(0, len(ids), chunk):
            batch = ids[start : start + chunk]
            try:
                payload = self.fetch_league(
                    season,
                    ["kona_player_info"],
                    cache_key=f"{season}/players_{start // chunk}",
                    filter_header={"players": {"filterIds": {"value": batch}}},
                ).payload
            except EspnApiError as exc:
                log.warning("player lookup failed for %s (%s): %s", season, start, exc)
                continue
            for entry in payload.get("players") or []:
                player = entry.get("player") or {}
                pid = entry.get("id") or player.get("id")
                if pid:
                    out[int(pid)] = player
        return out
