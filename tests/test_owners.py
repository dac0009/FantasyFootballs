"""Owner identity: the thing that must not break."""

import pytest

from pipeline.owners import OwnerRegistry, hash_member_id, slugify, team_display_name

GUID_A = "{AAAAAAAA-1111-2222-3333-AAAAAAAAAAAA}"
GUID_B = "{BBBBBBBB-1111-2222-3333-BBBBBBBBBBBB}"
GUID_C = "{CCCCCCCC-1111-2222-3333-CCCCCCCCCCCC}"


def member(guid, first, last):
    return {"id": guid, "firstName": first, "lastName": last, "displayName": f"{first}{last}"}


def team(team_id, name, guid):
    return {"id": team_id, "name": name, "abbrev": name[:3].upper(), "owners": [guid]}


class TestSlugify:
    def test_basic(self):
        assert slugify("John Smith") == "john-smith"

    def test_strips_punctuation_and_accents(self):
        assert slugify("Renée O'Brien-Pérez!") == "renee-o-brien-perez"

    def test_empty_falls_back(self):
        assert slugify("", fallback="anon") == "anon"
        assert slugify("•••") == "owner"


class TestRenamedTeams:
    def test_same_owner_across_four_renames_is_one_identity(self):
        registry = OwnerRegistry()
        names = {
            2019: "Team A",
            2020: "Some Other Name",
            2021: "Another Name",
            2026: "Current Team Name",
        }
        for season, name in names.items():
            mapping = registry.register_season(
                season, [member(GUID_A, "John", "Smith")], [team(1, name, GUID_A)]
            )
            assert mapping[1] == "john-smith"

        records = registry.to_records()
        assert len(records) == 1
        record = records[0]
        assert record["owner_id"] == "john-smith"
        assert record["name"] == "John Smith"
        assert record["seasons"] == [2019, 2020, 2021, 2026]
        assert [row["team_name"] for row in record["team_name_timeline"]] == list(names.values())
        assert record["current_team_name"] == "Current Team Name"

    def test_same_team_id_reused_by_a_different_person_is_two_identities(self):
        """ESPN reuses team ids; the person is the identity, not the slot."""
        registry = OwnerRegistry()
        registry.register_season(
            2023, [member(GUID_A, "John", "Smith")], [team(3, "Shared Slot", GUID_A)]
        )
        registry.register_season(
            2024, [member(GUID_B, "Jane", "Doe")], [team(3, "Shared Slot", GUID_B)]
        )
        records = {r["owner_id"]: r for r in registry.to_records()}
        assert set(records) == {"john-smith", "jane-doe"}
        assert records["john-smith"]["seasons"] == [2023]
        assert records["jane-doe"]["seasons"] == [2024]

    def test_identical_team_name_for_two_people_does_not_merge_them(self):
        registry = OwnerRegistry()
        registry.register_season(
            2024,
            [member(GUID_A, "John", "Smith"), member(GUID_B, "Jane", "Doe")],
            [team(1, "Cruise Control", GUID_A), team(2, "Cruise Control", GUID_B)],
        )
        assert len(registry.to_records()) == 2


class TestOverrides:
    def test_two_espn_accounts_merge_into_one_owner(self):
        overrides = {
            "owners": [
                {
                    "owner_id": "john-smith",
                    "name": "John Smith",
                    "espn_member_ids": [GUID_A, GUID_B],
                }
            ]
        }
        registry = OwnerRegistry(overrides)
        registry.register_season(2019, [member(GUID_A, "John", "Smith")], [team(1, "Old", GUID_A)])
        registry.register_season(
            2024, [member(GUID_B, "Johnny", "S")], [team(5, "New", GUID_B)]
        )
        records = registry.to_records()
        assert len(records) == 1
        assert records[0]["owner_id"] == "john-smith"
        assert records[0]["name"] == "John Smith"  # pinned, not ESPN's "Johnny S"
        assert records[0]["seasons"] == [2019, 2024]

    def test_two_accounts_merge_by_published_hash(self):
        """Merging must work from the public member_hash alone, because raw
        ESPN GUIDs are deliberately never published."""
        overrides = {
            "owners": [
                {
                    "owner_id": "jakob-frank",
                    "name": "Jakob Frank",
                    "espn_member_hashes": [hash_member_id(GUID_A), hash_member_id(GUID_B)],
                }
            ]
        }
        registry = OwnerRegistry(overrides)
        registry.register_season(2019, [member(GUID_A, "Jakob", "Frank")], [team(6, "Lil B", GUID_A)])
        registry.register_season(2020, [member(GUID_B, "Jakob", "Frank")], [team(16, "Other", GUID_B)])
        records = registry.to_records()
        assert len(records) == 1
        assert records[0]["owner_id"] == "jakob-frank"
        assert records[0]["seasons"] == [2019, 2020]

    def test_two_accounts_merge_by_display_name(self):
        """An explicit espn_display_names entry merges every account whose
        ESPN name matches, so a known duplicate can be fixed before any
        hashes have ever been published."""
        overrides = {
            "owners": [
                {
                    "owner_id": "jakob-frank",
                    "name": "Jakob Frank",
                    "espn_display_names": ["Jakob  Frank"],  # whitespace-insensitive
                }
            ]
        }
        registry = OwnerRegistry(overrides)
        registry.register_season(2019, [member(GUID_A, "Jakob", "Frank")], [team(6, "Lil B", GUID_A)])
        registry.register_season(2020, [member(GUID_B, "Jakob", "Frank")], [team(16, "Other", GUID_B)])
        records = registry.to_records()
        assert len(records) == 1
        assert records[0]["owner_id"] == "jakob-frank"
        assert records[0]["seasons"] == [2019, 2020]

    def test_guid_without_braces_in_config_still_matches(self):
        overrides = {
            "owners": [
                {"owner_id": "x", "name": "X", "espn_member_ids": [GUID_A.strip("{}")]}
            ]
        }
        registry = OwnerRegistry(overrides)
        mapping = registry.register_season(
            2024, [member(GUID_A, "A", "B")], [team(1, "T", GUID_A)]
        )
        assert mapping[1] == "x"

    def test_pinned_name_wins_over_espn_display_name(self):
        overrides = {"owners": [{"owner_id": "real-name", "name": "Real Name",
                                 "espn_member_ids": [GUID_C]}]}
        registry = OwnerRegistry(overrides)
        registry.register_season(
            2024, [member(GUID_C, "xXx_gamer", "420")], [team(1, "T", GUID_C)]
        )
        assert registry.to_records()[0]["name"] == "Real Name"


class TestUnlinkedTeams:
    def test_team_with_no_owner_gets_a_deterministic_placeholder(self):
        registry = OwnerRegistry()
        mapping = registry.register_season(2019, [], [{"id": 4, "name": "Orphan", "owners": []}])
        assert mapping[4] == "unlinked-2019-4"
        record = registry.to_records()[0]
        assert record["unlinked"] is True
        assert record["name"] == "Orphan"
        assert registry.unresolved == {"unlinked-2019-4"}

    def test_missing_member_record_still_resolves_by_guid(self):
        """ESPN sometimes omits the members block but keeps team owners."""
        registry = OwnerRegistry()
        mapping = registry.register_season(2019, [], [team(1, "T", GUID_A)])
        owner_id = mapping[1]
        assert owner_id.startswith("owner-")
        assert registry.to_records()[0]["unlinked"] is False


class TestPrivacy:
    def test_raw_espn_guid_never_appears_in_published_records(self):
        registry = OwnerRegistry()
        registry.register_season(
            2024, [member(GUID_A, "John", "Smith")], [team(1, "T", GUID_A)]
        )
        serialized = str(registry.to_records())
        assert GUID_A not in serialized
        assert "AAAAAAAA" not in serialized
        assert registry.to_records()[0]["member_hash"] == hash_member_id(GUID_A)

    def test_hash_is_stable_and_short(self):
        assert hash_member_id(GUID_A) == hash_member_id(GUID_A)
        assert hash_member_id(GUID_A) != hash_member_id(GUID_B)
        assert len(hash_member_id(GUID_A)) == 12


class TestCoOwners:
    def test_primary_owner_anchors_the_team_and_co_owner_is_recorded(self):
        registry = OwnerRegistry()
        mapping = registry.register_season(
            2024,
            [member(GUID_A, "John", "Smith"), member(GUID_B, "Jane", "Doe")],
            [{"id": 1, "name": "Duo", "owners": [GUID_A, GUID_B]}],
        )
        assert mapping[1] == "john-smith"
        record = registry.to_records()[0]
        assert record["co_owner_hashes"] == [hash_member_id(GUID_B)]


class TestTeamDisplayName:
    def test_prefers_name_field(self):
        assert team_display_name({"id": 1, "name": "Real Name"}) == "Real Name"

    def test_falls_back_to_location_and_nickname(self):
        assert (
            team_display_name({"id": 1, "location": "Harbor", "nickname": "Sharks"})
            == "Harbor Sharks"
        )

    def test_falls_back_to_abbrev_then_team_id(self):
        assert team_display_name({"id": 7, "abbrev": "HRB"}) == "HRB"
        assert team_display_name({"id": 7}) == "Team 7"
