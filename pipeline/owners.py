"""Owner identity resolution.

The central modelling decision of this project: **teams are not identities,
people are**. ESPN team ids are reused and team names change every year, so
neither can anchor a career record.

Resolution order
----------------
1. ESPN ``members[].id`` -- a per-account GUID that is stable across every
   season of the league. This is the primary key.
2. ``config/owners.yml`` may merge several GUIDs into one person (someone who
   rebuilt their ESPN account) and may pin a display name.
3. If a season predates ESPN exposing members, or a team has no owner GUID,
   we fall back to a deterministic ``season:team_id`` placeholder so the
   pipeline still produces a complete dataset. The validator reports these.

Privacy
-------
An ESPN member GUID *is* that person's SWID. We therefore never publish it.
Public datasets carry a salted, truncated hash plus a human-readable slug.
The salt is not a secret (the hash only needs to be stable and non-reversible
for casual readers), but keeping the raw GUID out of ``data/`` means the
public site never leaks another league member's account identifier.
"""

from __future__ import annotations

import hashlib
import logging
import re
import unicodedata

log = logging.getLogger(__name__)

HASH_SALT = "ffbffl-owner-v1"
PLACEHOLDER_PREFIX = "unlinked"


def slugify(value: str, *, fallback: str = "owner") -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = re.sub(r"-{2,}", "-", text)
    return text or fallback


def hash_member_id(member_id: str) -> str:
    digest = hashlib.sha256(f"{HASH_SALT}:{member_id}".encode()).hexdigest()
    return digest[:12]


def member_display_name(member: dict) -> str:
    """Best human name available from an ESPN member record."""
    first = (member.get("firstName") or "").strip()
    last = (member.get("lastName") or "").strip()
    full = f"{first} {last}".strip()
    if full:
        return full
    display = (member.get("displayName") or "").strip()
    return display or "Unknown Owner"


class OwnerRegistry:
    """Builds and holds the owner identity map for the whole league history."""

    def __init__(self, overrides: dict | None = None) -> None:
        overrides = overrides or {}
        self._owner_specs: list[dict] = list(overrides.get("owners") or [])
        self._guid_to_owner: dict[str, str] = {}
        self._pinned_name: dict[str, str] = {}
        self._notes: dict[str, str] = {}
        self._hidden: set[str] = set()
        self._owners: dict[str, dict] = {}
        self._unresolved: set[str] = set()
        self._load_overrides()

    # -- overrides ---------------------------------------------------------

    def _load_overrides(self) -> None:
        for spec in self._owner_specs:
            owner_id = spec.get("owner_id") or slugify(spec.get("name", ""))
            if not owner_id:
                continue
            if spec.get("name"):
                self._pinned_name[owner_id] = str(spec["name"])
            if spec.get("note"):
                self._notes[owner_id] = str(spec["note"])
            if spec.get("hidden"):
                self._hidden.add(owner_id)
            for guid in spec.get("espn_member_ids") or []:
                self._guid_to_owner[self._canonical_guid(guid)] = owner_id

    @staticmethod
    def _canonical_guid(guid: str) -> str:
        text = str(guid or "").strip().upper()
        if text and not text.startswith("{"):
            text = "{" + text.strip("{}") + "}"
        return text

    # -- registration ------------------------------------------------------

    def register_season(self, season: int, members: list[dict], teams: list[dict]) -> dict[int, str]:
        """Register one season. Returns ``{espn_team_id: owner_id}``."""
        members_by_guid = {
            self._canonical_guid(m.get("id")): m for m in members or [] if m.get("id")
        }

        team_to_owner: dict[int, str] = {}
        for team in teams or []:
            team_id = int(team.get("id"))
            guids = [self._canonical_guid(g) for g in (team.get("owners") or []) if g]
            # Co-owned teams exist; the first listed owner is ESPN's primary.
            primary = guids[0] if guids else None

            if primary:
                owner_id = self._owner_id_for_guid(primary, members_by_guid.get(primary))
            else:
                owner_id = f"{PLACEHOLDER_PREFIX}-{season}-{team_id}"
                self._unresolved.add(owner_id)
                self._ensure_owner(
                    owner_id,
                    name=team_display_name(team) or f"Team {team_id}",
                    member_hash=None,
                    unlinked=True,
                )
                log.warning(
                    "season %s team %s has no ESPN owner GUID; using placeholder %s",
                    season,
                    team_id,
                    owner_id,
                )

            team_to_owner[team_id] = owner_id
            record = self._owners[owner_id]
            record["seasons"].add(int(season))
            record["co_owner_hashes"].update(
                hash_member_id(g) for g in guids[1:] if g
            )
            record["team_names"].append(
                {
                    "season": int(season),
                    "team_id": team_id,
                    "team_name": team_display_name(team),
                    "abbrev": (team.get("abbrev") or "").strip() or None,
                }
            )
        return team_to_owner

    def _owner_id_for_guid(self, guid: str, member: dict | None) -> str:
        if guid in self._guid_to_owner:
            owner_id = self._guid_to_owner[guid]
            self._ensure_owner(
                owner_id,
                name=self._pinned_name.get(owner_id)
                or (member_display_name(member) if member else owner_id),
                member_hash=hash_member_id(guid),
            )
            return owner_id

        name = member_display_name(member) if member else "Unknown Owner"
        base = slugify(name, fallback=f"owner-{hash_member_id(guid)}")
        if base in {"unknown-owner", "owner"}:
            base = f"owner-{hash_member_id(guid)}"
        owner_id = base
        # Two different GUIDs can produce the same slug (two "Mike Smith"s).
        suffix = 2
        while owner_id in self._owners and self._owners[owner_id]["primary_hash"] != hash_member_id(guid):
            owner_id = f"{base}-{suffix}"
            suffix += 1
        self._guid_to_owner[guid] = owner_id
        self._ensure_owner(owner_id, name=name, member_hash=hash_member_id(guid))
        return owner_id

    def _ensure_owner(
        self,
        owner_id: str,
        *,
        name: str,
        member_hash: str | None,
        unlinked: bool = False,
    ) -> dict:
        record = self._owners.get(owner_id)
        if record is None:
            record = {
                "owner_id": owner_id,
                "name": self._pinned_name.get(owner_id, name),
                "primary_hash": member_hash,
                "co_owner_hashes": set(),
                "seasons": set(),
                "team_names": [],
                "unlinked": unlinked,
                "note": self._notes.get(owner_id),
            }
            self._owners[owner_id] = record
        else:
            if owner_id in self._pinned_name:
                record["name"] = self._pinned_name[owner_id]
            elif name and name != "Unknown Owner":
                record["name"] = name
            if member_hash and not record["primary_hash"]:
                record["primary_hash"] = member_hash
        return record

    # -- output ------------------------------------------------------------

    @property
    def unresolved(self) -> set[str]:
        return set(self._unresolved)

    def owner_ids(self) -> list[str]:
        return sorted(self._owners)

    def display_name(self, owner_id: str) -> str:
        record = self._owners.get(owner_id)
        return record["name"] if record else owner_id

    def to_records(self) -> list[dict]:
        """Public owner rows: no raw ESPN GUIDs, deterministic ordering."""
        out = []
        for owner_id in sorted(self._owners):
            record = self._owners[owner_id]
            timeline = sorted(
                record["team_names"], key=lambda row: (row["season"], row["team_id"])
            )
            seasons = sorted(record["seasons"])
            out.append(
                {
                    "owner_id": owner_id,
                    "name": record["name"],
                    "member_hash": record["primary_hash"],
                    "co_owner_hashes": sorted(record["co_owner_hashes"]),
                    "seasons": seasons,
                    "first_season": seasons[0] if seasons else None,
                    "last_season": seasons[-1] if seasons else None,
                    "team_name_timeline": timeline,
                    "current_team_name": timeline[-1]["team_name"] if timeline else None,
                    "unlinked": bool(record["unlinked"]),
                    "hidden": owner_id in self._hidden,
                    "note": record["note"],
                }
            )
        return out


def team_display_name(team: dict) -> str:
    """ESPN moved from location+nickname to a single ``name`` field mid-history."""
    name = (team.get("name") or "").strip()
    if name:
        return name
    location = (team.get("location") or "").strip()
    nickname = (team.get("nickname") or "").strip()
    combined = f"{location} {nickname}".strip()
    if combined:
        return combined
    abbrev = (team.get("abbrev") or "").strip()
    return abbrev or f"Team {team.get('id')}"
