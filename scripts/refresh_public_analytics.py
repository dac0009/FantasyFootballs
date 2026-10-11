"""Recompute derived previews from committed results; never fetch or invent scores."""
import json
from pathlib import Path

from pipeline import gotw, metrics, playoffs
from pipeline.config import write_json


def refresh(data_dir: Path) -> None:
    def read(name):
        return json.loads((data_dir / name).read_text())

    current = read("current.json")
    season = current["season"]
    matchups = read("matchups.json")
    weeks = read("team_weeks.json")
    picture = playoffs.build_playoff_picture(
        season, current["standings"], matchups, weeks,
        playoff_teams=current["playoff_team_count"],
        regular_season_weeks=current["regular_season_weeks"],
    )
    current["playoff_picture"] = picture
    previews = {p["matchup_id"]: p for p in (picture or {}).get("previews", [])}
    for game in current["upcoming_matchups"]:
        game["preview"] = previews.get(game["matchup_id"])
    ap = metrics.all_play(weeks, season=season, game_types=("regular",))
    pick = gotw.select_game_of_the_week(
        matchups, weeks, current["standings"], ap["totals"], read("head_to_head.json"), season,
        playoff_team_count=current["playoff_team_count"],
        regular_season_weeks=current["regular_season_weeks"], playoff_picture=picture,
    )
    if pick:
        for candidate in [pick["pick"], *pick["ranked"]]:
            candidate["preview"] = previews.get(candidate["matchup_id"])
    manifest = read("manifest.json")
    for name, payload in {"current.json": current, "playoffs.json": picture, "game_of_week.json": pick}.items():
        write_json(data_dir / name, payload)
        manifest["files"][name] = (data_dir / name).stat().st_size
    # Preserve the ESPN collection timestamp: this is a derived-data rebuild.
    manifest["total_bytes"] = sum(manifest["files"].values())
    write_json(data_dir / "manifest.json", manifest, pretty=True)


if __name__ == "__main__":
    refresh(Path("data"))
