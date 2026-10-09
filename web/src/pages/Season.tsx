import { Link, useParams } from "react-router-dom";
import { Scoreboard } from "../components/Scoreboard";
import { Band, Empty, ErrorState, Figure, Loading, OwnerLink } from "../components/primitives";
import { SeasonAnalytics } from "./CurrentSeason";
import { useSeason } from "../lib/data";
import { gameTypeLabel, points, total } from "../lib/format";

export default function Season() {
  const { year } = useParams();
  const season = useSeason(year ?? null);

  if (season.state === "loading") return <Loading what={`the ${year} season`} />;
  if (season.state === "error") return <ErrorState error={season.error} what={`The ${year} season`} />;

  const data = season.data;

  return (
    <div>
      <div className="shell" style={{ paddingTop: "2.2rem" }}>
        <p style={{ color: "var(--color-brass)", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
          Season archive
        </p>
        <h1 style={{ fontSize: "clamp(2rem, 7vw, 3.4rem)", marginTop: "0.4rem" }}>
          {data.season}
          {data.meta.league_name ? (
            <span style={{ color: "var(--color-low)", fontWeight: 500, fontSize: "0.4em" }}>
              {" "}
              {data.meta.league_name}
            </span>
          ) : null}
        </h1>

        {data.champion ? (
          <div className="champ-strip">
            <Figure
              value={
                <OwnerLink ownerId={data.champion.owner_id}>
                  {data.champion.team_name}
                </OwnerLink>
              }
              label={`Champion \u00b7 ${data.champion.owner_name ?? ""} \u00b7 ${data.champion.record}`}
              size="1.6rem"
              tone="var(--color-brass)"
            />
            {data.runner_up ? (
              <Figure
                value={
                  <OwnerLink ownerId={data.runner_up.owner_id}>
                    {data.runner_up.team_name}
                  </OwnerLink>
                }
                label="Runner-up"
                size="1.1rem"
              />
            ) : null}
            <Figure value={points(data.league_scoring.mean, 1)} label="League average score" size="1.1rem" />
            <Figure value={points(data.league_scoring.high, 1)} label="Highest score" size="1.1rem" />
          </div>
        ) : null}

        {data.limitations.length ? (
          <ul className="notice" style={{ marginTop: "1.4rem", paddingLeft: "1.6rem" }}>
            {data.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {data.bracket.has_playoffs ? (
          <>
            <Band title="Postseason" note={`Champion determined from ${data.champion_source ?? "ESPN"}`} />
            <div className="bracket">
              {data.bracket.rounds.map((round) => (
                <section key={round.week}>
                  <h3 style={{ fontSize: "0.9rem", color: "var(--color-mid)", marginBottom: "0.4rem" }}>
                    Week {round.week}
                  </h3>
                  {round.games.map((game) => (
                    <div key={game.matchup_id} style={{ marginBottom: "0.2rem" }}>
                      <Scoreboard matchups={[game]} />
                      <p style={{ color: "var(--color-low)", fontSize: "0.72rem", margin: "0 0 0.6rem" }}>
                        {gameTypeLabel(game.game_type)}
                      </p>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </>
        ) : null}

        <Band
          title="Weeks"
          note="Every scheduled week this season"
          action={
            <div className="pill-row">
              {data.scheduled_weeks.map((week) => (
                <Link
                  key={week}
                  to={`/seasons/${data.season}/weeks/${week}`}
                  className="pill"
                  style={{ textDecoration: "none" }}
                >
                  {week}
                </Link>
              ))}
            </div>
          }
        />
        {!data.completed_weeks.length ? <Empty>No games have been played yet.</Empty> : null}

        <Band title="Final standings" note="Where ESPN ranked each team at the end of the season" />
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {[...data.standings]
            .filter((r) => r.final_rank)
            .sort((a, b) => (a.final_rank ?? 99) - (b.final_rank ?? 99))
            .map((row) => (
              <li key={row.owner_id} className="final-row">
                <span className="figure" style={{ fontSize: "1.1rem", color: "var(--color-low)" }}>
                  {row.final_rank}
                </span>
                <span>
                  <OwnerLink ownerId={row.owner_id}>{row.team_name}</OwnerLink>
                  {row.is_champion ? <span className="tag tag-champ" style={{ marginLeft: "0.5rem" }}>Champion</span> : null}
                  {row.is_last ? <span className="tag" style={{ marginLeft: "0.5rem" }}>Last place</span> : null}
                </span>
                <span style={{ color: "var(--color-mid)", fontSize: "0.85rem" }}>{row.record}</span>
                <span style={{ color: "var(--color-mid)", fontSize: "0.85rem" }}>
                  {total(row.points_for)}
                </span>
              </li>
            ))}
        </ol>
        {!data.standings.some((r) => r.final_rank) ? (
          <Empty>ESPN did not report final standings for this season.</Empty>
        ) : null}
      </div>

      <SeasonAnalytics data={data} title={`${data.season} analytics`} />

      <style>{`
        .champ-strip {
          display: grid; gap: 1.4rem 1.6rem; margin-top: 1.6rem; padding-top: 1.4rem;
          border-top: 1px solid var(--color-line); grid-template-columns: repeat(2, 1fr);
        }
        @media (min-width: 820px) { .champ-strip { grid-template-columns: 1.4fr 1fr 1fr 1fr; } }
        .bracket { display: grid; gap: 1.6rem; margin-top: 1rem; }
        @media (min-width: 860px) { .bracket { grid-template-columns: repeat(3, 1fr); } }
        .final-row {
          display: grid; grid-template-columns: 2rem 1fr auto auto; gap: 0.8rem;
          align-items: baseline; padding: 0.42rem 0; border-bottom: 1px solid var(--color-line-soft);
        }
      `}</style>
    </div>
  );
}
