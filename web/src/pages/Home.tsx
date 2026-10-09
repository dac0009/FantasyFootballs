import { Link } from "react-router-dom";
import { GameOfWeekPanel } from "../components/GameOfWeekPanel";
import { Scoreboard } from "../components/Scoreboard";
import { StandingsTable } from "../components/StandingsTable";
import { DivergingBars } from "../components/charts/DivergingBars";
import { QuadrantScatter } from "../components/charts/QuadrantScatter";
import { Band, Empty, ErrorState, Figure, Loading, Metric, OwnerLink, WeekLink } from "../components/primitives";
import { useCurrent, useGameOfWeek } from "../lib/data";
import { points, signed, total } from "../lib/format";
import type { CurrentPayload, Meta, WeekPayload } from "../lib/types";

/**
 * The homepage answers three questions in order: what just happened, what
 * matters right now, what happens next. The lede is a single sentence written
 * from the data rather than a wall of metric cards.
 */
export default function Home({ meta }: { meta: Meta }) {
  const current = useCurrent();
  const gotw = useGameOfWeek();

  if (current.state === "loading") return <Loading what="this week" />;
  if (current.state === "error") return <ErrorState error={current.error} what="This week" />;

  const data = current.data;
  const week = data.week;

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <p style={{ color: "var(--color-brass)", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
        {week ? `Week ${week.week}` : "Preseason"} &middot; {data.season} season
      </p>
      <h1 className="lede" style={{ marginTop: "0.6rem" }}>
        {lede(data, week)}
      </h1>

      {week ? (
        <>
          <div className="home-figures">
            <Figure
              value={points(week.summary.high?.score, 1)}
              label={
                <>
                  High score &middot;{" "}
                  <OwnerLink ownerId={week.summary.high?.owner_id}>
                    {week.summary.high?.team_name}
                  </OwnerLink>
                </>
              }
            />
            <Figure
              value={points(week.summary.closest_game?.margin, 2)}
              label="Closest margin"
            />
            <Figure
              value={points(week.summary.biggest_blowout?.margin, 1)}
              label="Biggest blowout"
            />
            <Figure value={points(week.summary.league_mean, 1)} label="League average" />
          </div>

          <Band
            title={`Week ${week.week} results`}
            action={
              <p className="band-note">
                <WeekLink season={data.season} week={week.week}>
                  Full breakdown
                </WeekLink>
              </p>
            }
          />
          <div className="home-split">
            <Scoreboard matchups={week.matchups} showType />
            {gotw.state === "ready" && gotw.data ? (
              <GameOfWeekPanel data={gotw.data} />
            ) : data.upcoming_matchups.length ? (
              <section className="panel">
                <p style={{ color: "var(--color-brass)", fontSize: "0.8rem", margin: 0, fontWeight: 600 }}>
                  Next up &middot; Week {data.upcoming_week}
                </p>
                <div style={{ marginTop: "0.6rem" }}>
                  <Scoreboard matchups={data.upcoming_matchups} />
                </div>
              </section>
            ) : null}
          </div>
        </>
      ) : (
        <Empty>
          No completed games yet this season. The{" "}
          <Link to="/seasons" className="link-quiet">
            season archive
          </Link>{" "}
          has every result since {meta.seasons[0]}.
        </Empty>
      )}

      {data.milestones.length ? (
        <>
          <Band title="Into the record book" note="All-time lists this week's results entered" />
          <ul style={{ listStyle: "none", padding: 0, margin: "0.8rem 0 0", display: "grid", gap: "0.75rem" }}>
            {data.milestones.map((milestone, index) => (
              <li
                key={`${milestone.kind}-${index}`}
                style={{ display: "grid", gridTemplateColumns: "2.6rem 1fr", gap: "0.8rem", alignItems: "baseline" }}
              >
                <span className="figure" style={{ fontSize: "1.25rem", color: "var(--color-brass)" }}>
                  #{milestone.rank}
                </span>
                <span>
                  <Link
                    to={milestone.record_id ? `/records#${milestone.record_id}` : "/records"}
                    className="link-quiet"
                  >
                    {milestone.headline}
                  </Link>
                  <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.85rem" }}>
                    {milestone.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Band
        title={`${data.season} standings`}
        action={
          <p className="band-note">
            <Link to="/season" className="link-quiet">
              Full season analytics
            </Link>
          </p>
        }
      />
      <StandingsTable rows={data.standings} season={data.season} />

      <Band
        title="Scoring against schedule"
        note="Where every team sits relative to the league average on both axes"
      />
      <div className="home-split" style={{ marginTop: "1rem" }}>
        <QuadrantScatter rows={data.standings} />
        <DivergingBars
          data={data.standings
            .filter((r) => r.schedule_luck !== null)
            .map((r) => ({
              name: r.team_name ?? r.owner_id,
              value: r.schedule_luck as number,
              detail: `${r.record} \u00b7 expected ${points(r.expected_wins, 1)}`,
            }))}
          axisLabel="Wins above or below expected"
          negativeLabel="Unlucky"
          positiveLabel="Lucky"
        />
      </div>
      <p className="prose-narrow" style={{ marginTop: "0.9rem", fontSize: "0.84rem" }}>
        <Metric name="schedule_luck">Schedule luck</Metric> is actual wins minus{" "}
        <Metric name="expected_wins">expected wins</Metric>, where expected wins come from each
        team's <Metric name="all_play">all-play record</Metric>. Across the league it always sums
        to zero.
      </p>

      {data.movement.length ? (
        <>
          <Band title="Standings movement" note={`Change caused by week ${week?.week}`} />
          <ul className="move-list">
            {data.movement.slice(0, 6).map((row) => (
              <li key={row.owner_id}>
                <OwnerLink ownerId={row.owner_id}>{row.team_name}</OwnerLink>
                <span
                  className={row.change > 0 ? "num-pos" : row.change < 0 ? "num-neg" : ""}
                  style={{ fontSize: "0.85rem" }}
                >
                  {row.change === 0 ? "no change" : `${signed(row.change, 2).replace(".00", "")} to ${row.rank}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Band title="Scoring leaders" note="Highest average score this season" />
      <ul className="move-list">
        {data.scoring_leaders.map((row) => (
          <li key={row.owner_id}>
            <OwnerLink ownerId={row.owner_id}>{row.team_name}</OwnerLink>
            <span style={{ fontSize: "0.85rem", color: "var(--color-mid)" }}>
              {points(row.avg_score, 1)} per game &middot; {total(row.points_for)} total
            </span>
          </li>
        ))}
      </ul>

      <style>{`
        .home-figures {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.4rem 1rem;
          margin-top: 1.8rem;
          padding-top: 1.4rem;
          border-top: 1px solid var(--color-line);
        }
        @media (min-width: 760px) {
          .home-figures { grid-template-columns: repeat(4, 1fr); }
        }
        .home-split { display: grid; gap: 1.6rem; margin-top: 1rem; }
        @media (min-width: 1000px) {
          .home-split { grid-template-columns: 1.25fr 1fr; align-items: start; gap: 2.4rem; }
        }
        .move-list { list-style: none; padding: 0; margin: 0.8rem 0 0; display: grid; gap: 0; }
        .move-list li {
          display: flex; justify-content: space-between; gap: 1rem;
          padding: 0.5rem 0; border-bottom: 1px solid var(--color-line-soft);
        }
      `}</style>
    </div>
  );
}

/** A one-sentence summary of the week, chosen from what was actually notable. */
function lede(data: CurrentPayload, week: WeekPayload | null): string {
  if (!week) {
    return `The ${data.season} season has not started yet.`;
  }
  const { high, closest_game, biggest_blowout, highest_score_in_loss } = week.summary;
  const parts: string[] = [];

  if (high) {
    parts.push(`${high.team_name} led week ${week.week} with ${points(high.score, 2)}`);
  }
  if (highest_score_in_loss && high && highest_score_in_loss.score > (high.score ?? 0) * 0.92) {
    parts.push(
      `and ${highest_score_in_loss.team_name} lost with ${points(highest_score_in_loss.score, 2)}`,
    );
  } else if (closest_game && (closest_game.margin ?? 99) < 3) {
    parts.push(
      `and ${closest_game.margin === 0 ? "one game ended level" : `one game came down to ${points(closest_game.margin, 2)}`}`,
    );
  } else if (biggest_blowout && (biggest_blowout.margin ?? 0) > 50) {
    parts.push(`and ${biggest_blowout.away_team_name ?? ""} was buried by ${points(biggest_blowout.margin, 1)}`);
  }
  return `${parts.join(" ")}.`;
}
