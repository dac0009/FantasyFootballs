import { Link } from "react-router-dom";
import { GameOfWeekPanel } from "../components/GameOfWeekPanel";
import { MatchupPreviewCard, PreviewLegend } from "../components/MatchupPreview";
import { PlayoffPicture } from "../components/PlayoffPicture";
import { Scoreboard } from "../components/Scoreboard";
import { ShareButton } from "../components/ShareButton";
import { StandingsTable } from "../components/StandingsTable";
import { DivergingBars } from "../components/charts/DivergingBars";
import { QuadrantScatter } from "../components/charts/QuadrantScatter";
import { Band, Empty, ErrorState, Figure, Loading, Metric, OwnerLink, WeekLink } from "../components/primitives";
import { useCurrent, useGameOfWeek } from "../lib/data";
import { points, total } from "../lib/format";
import type { CurrentPayload, Meta } from "../lib/types";

/**
 * The homepage answers, in order: where do I stand, what happens this week,
 * what just happened. No generated prose -- the numbers carry it.
 */
export default function Home({ meta }: { meta: Meta }) {
  const current = useCurrent();
  const gotw = useGameOfWeek();

  if (current.state === "loading") return <Loading what="this week" />;
  if (current.state === "error") return <ErrorState error={current.error} what="This week" />;

  const data = current.data;
  const week = data.week;
  const picture = data.playoff_picture;
  const previews = picture?.previews ?? [];
  const pick = gotw.state === "ready" && gotw.data ? gotw.data : null;
  const siteUrl = typeof window !== "undefined" ? window.location.origin + import.meta.env.BASE_URL : "";

  return (
    <div className="shell" style={{ paddingTop: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "var(--color-brass)", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
            {meta.league.name} &middot; {data.season}
          </p>
          <h1 style={{ fontSize: "clamp(1.7rem, 5vw, 2.4rem)", marginTop: "0.3rem" }}>
            {week ? `Week ${week.week} is in the books` : "Preseason"}
            {data.upcoming_week ? (
              <span style={{ color: "var(--color-low)", fontWeight: 500 }}>
                {" "}
                &middot; Week {data.upcoming_week} next
              </span>
            ) : null}
          </h1>
        </div>
        <ShareButton
          title={`${meta.league.name} \u2014 Week ${week?.week ?? ""}`}
          text={shareText(data, meta)}
          url={siteUrl}
        />
      </div>

      {picture ? (
        <>
          <Band
            title="Playoff picture"
            note={`After week ${picture.as_of_week} \u00b7 ${picture.remaining_regular_season_games} games left`}
          />
          <PlayoffPicture picture={picture} />
        </>
      ) : null}

      {previews.length ? (
        <>
          <Band
            title={`Week ${picture?.next_week} preview`}
            note="Ordered by how much each game moves the playoff picture"
          />
          <div className="home-split" style={{ marginTop: "0.4rem" }}>
            <div>
              {previews.map((preview) => (
                <MatchupPreviewCard key={preview.matchup_id} preview={preview} />
              ))}
              <PreviewLegend />
            </div>
            {pick ? <GameOfWeekPanel data={pick} /> : null}
          </div>
        </>
      ) : null}

      {week ? (
        <>
          <Band
            title={`Week ${week.week} results`}
            action={
              <p className="band-note">
                <WeekLink season={data.season} week={week.week}>
                  Full breakdown and player highlights
                </WeekLink>
              </p>
            }
          />
          <div className="home-figures">
            <Figure
              value={points(week.summary.high?.score, 1)}
              label={
                <>
                  High &middot;{" "}
                  <OwnerLink ownerId={week.summary.high?.owner_id}>{week.summary.high?.team_name}</OwnerLink>
                </>
              }
              size="1.6rem"
            />
            <Figure
              value={points(week.summary.low?.score, 1)}
              label={
                <>
                  Low &middot;{" "}
                  <OwnerLink ownerId={week.summary.low?.owner_id}>{week.summary.low?.team_name}</OwnerLink>
                </>
              }
              size="1.6rem"
            />
            <Figure value={points(week.summary.league_mean, 1)} label="League average" size="1.6rem" />
            <Figure value={points(week.summary.closest_game?.margin, 2)} label="Closest margin" size="1.6rem" />
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <Scoreboard matchups={week.matchups} showType />
          </div>
        </>
      ) : (
        <Empty>
          No completed games yet this season. The{" "}
          <Link to="/seasons" className="link-quiet">
            archive
          </Link>{" "}
          has every result since {meta.seasons[0]}.
        </Empty>
      )}

      {data.milestones.length ? (
        <>
          <Band title="Into the record book" note="All-time lists this week's results entered" />
          <ul style={{ listStyle: "none", padding: 0, margin: "0.8rem 0 0", display: "grid", gap: "0.7rem" }}>
            {data.milestones.map((milestone, index) => (
              <li
                key={`${milestone.kind}-${index}`}
                style={{ display: "grid", gridTemplateColumns: "2.6rem 1fr", gap: "0.8rem", alignItems: "baseline" }}
              >
                <span className="figure" style={{ fontSize: "1.2rem", color: "var(--color-brass)" }}>
                  #{milestone.rank}
                </span>
                <span>
                  <Link to={milestone.record_id ? `/records#${milestone.record_id}` : "/records"} className="link-quiet">
                    {milestone.headline}
                  </Link>
                  <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.84rem" }}>
                    {milestone.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Band
        title="Standings"
        action={
          <p className="band-note">
            <Link to="/season" className="link-quiet">
              Full season analytics
            </Link>
          </p>
        }
      />
      <StandingsTable rows={data.standings} season={data.season} />

      <Band title="Record versus performance" note="Who is better, or worse, than their record" />
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
        <Metric name="expected_wins">expected wins</Metric> from each team's{" "}
        <Metric name="all_play">all-play record</Metric>. A team far left of zero is better than its record.
      </p>

      <Band title="Scoring leaders" note="Highest average this season" />
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
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.2rem 1rem;
          margin-top: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--color-line-soft);
        }
        @media (min-width: 760px) { .home-figures { grid-template-columns: repeat(4, 1fr); } }
        .home-split { display: grid; gap: 1.6rem; margin-top: 1rem; }
        @media (min-width: 1000px) {
          .home-split { grid-template-columns: 1.25fr 1fr; align-items: start; gap: 2.4rem; }
        }
        .move-list { list-style: none; padding: 0; margin: 0.8rem 0 0; }
        .move-list li {
          display: flex; justify-content: space-between; gap: 1rem;
          padding: 0.5rem 0; border-bottom: 1px solid var(--color-line-soft);
        }
      `}</style>
    </div>
  );
}

/** Plain-text summary for the share sheet: facts only, one per line. */
function shareText(data: CurrentPayload, meta: Meta): string {
  const lines: string[] = [];
  const week = data.week;
  if (week) {
    lines.push(`${meta.league.name} \u2014 Week ${week.week}`);
    if (week.summary.high) lines.push(`High: ${week.summary.high.team_name} ${points(week.summary.high.score, 1)}`);
    if (week.summary.low) lines.push(`Low: ${week.summary.low.team_name} ${points(week.summary.low.score, 1)}`);
    if (week.summary.closest_game) {
      const g = week.summary.closest_game;
      lines.push(`Closest: ${g.away_team_name} ${points(g.away_score, 1)} at ${g.home_team_name} ${points(g.home_score, 1)}`);
    }
  }
  const picture = data.playoff_picture;
  if (picture) {
    const cut = picture.playoff_teams;
    const inside = picture.teams.slice(0, cut).map((t) => `${t.team_name} ${Math.round(t.playoff_pct * 100)}%`);
    lines.push(`Playoff line: ${inside.join(", ")}`);
    const bubble = picture.teams.slice(cut, cut + 2).map((t) => `${t.team_name} ${Math.round(t.playoff_pct * 100)}%`);
    if (bubble.length) lines.push(`Chasing: ${bubble.join(", ")}`);
    if (picture.previews[0]) {
      const p = picture.previews[0];
      lines.push(
        `Biggest game week ${p.week}: ${p.away_team_name} (${Math.round(p.away_win_pct * 100)}%) at ${p.home_team_name} (${Math.round(p.home_win_pct * 100)}%)`,
      );
    }
  }
  return lines.join("\n");
}
