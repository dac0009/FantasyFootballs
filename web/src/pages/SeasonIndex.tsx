import { Link } from "react-router-dom";
import { Band, ErrorState, Loading, OwnerLink } from "../components/primitives";
import { useSeasonIndex } from "../lib/data";
import { total } from "../lib/format";

export default function SeasonIndex() {
  const seasons = useSeasonIndex();
  if (seasons.state === "loading") return <Loading what="the archive" />;
  if (seasons.state === "error") return <ErrorState error={seasons.error} what="The archive" />;

  const ordered = [...seasons.data].sort((a, b) => b.season - a.season);

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)" }}>Season archive</h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        Every season the league has played, rebuilt from ESPN's own record. Open a season for its
        standings, full schedule, playoff bracket and week-by-week results.
      </p>

      <Band title="Seasons" note={`${ordered.length} seasons on record`} />
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ordered.map((season) => (
          <li key={season.season} className="season-row">
            <Link to={`/seasons/${season.season}`} className="season-year">
              {season.season}
            </Link>
            <div>
              {season.champion ? (
                <p style={{ margin: 0 }}>
                  <span className="tag tag-champ" style={{ marginRight: "0.5rem" }}>
                    Champion
                  </span>
                  <OwnerLink ownerId={season.champion.owner_id}>
                    {season.champion.owner_name ?? season.champion.team_name}
                  </OwnerLink>
                  <span style={{ color: "var(--color-low)" }}>
                    {" "}
                    as {season.champion.team_name} &middot; {season.champion.record} &middot;{" "}
                    {total(season.champion.points_for)} points
                  </span>
                </p>
              ) : (
                <p style={{ margin: 0, color: "var(--color-mid)" }}>
                  {season.is_current ? "Season in progress" : "No champion on record"}
                </p>
              )}
              <p style={{ margin: "0.25rem 0 0", color: "var(--color-low)", fontSize: "0.83rem" }}>
                {season.team_count} teams &middot; {season.regular_season_weeks}-week regular season
                &middot; {season.completed_weeks.length} weeks played
                {season.runner_up ? ` \u00b7 runner-up ${season.runner_up.team_name}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <style>{`
        .season-row {
          display: grid; grid-template-columns: 4.5rem 1fr; gap: 1rem;
          align-items: baseline; padding: 0.9rem 0;
          border-bottom: 1px solid var(--color-line-soft);
        }
        .season-year {
          font-family: var(--font-display); font-weight: 700; font-size: 1.5rem;
          letter-spacing: -0.03em; color: var(--color-hi);
        }
        .season-year:hover { color: var(--color-brass); }
      `}</style>
    </div>
  );
}
